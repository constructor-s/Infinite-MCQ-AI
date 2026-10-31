import { GoogleGenAI, ThinkingLevel, type GroundingMetadata } from "@google/genai";
import { z } from "zod";
import { curriculumVersion, crosswalkVersion } from "../data/curriculum.js";
import { blueprint, PROMPT_VERSION, type BlueprintTags } from "../lib/blueprint.js";
import { sourceObjectivesById } from "./objectives.js";
import { alignmentIssue, assignmentIsEligible, buildPrompt, SYSTEM_INSTRUCTION } from "./questionPrompts.js";
import {
  generateQuestionRequestSchema,
  generatedQuestionSchema,
  type ClinicalQuestion,
  type GenerateQuestionRequest,
  type GeneratedQuestion,
  type ModelOption,
  type OptionId
} from "../lib/contracts.js";
import { shuffleQuestionOptions } from "../lib/shuffleQuestion.js";
import { clinicalReviewSchema, editorialReviewSchema, CLINICAL_REVIEW_INSTRUCTION, EDITORIAL_REVIEW_INSTRUCTION, EDITORIAL_EXAMPLES, reviewContext, reviewFindings, type ClinicalReview, type EditorialReview } from "./questionReview.js";

export const MODEL_OPTIONS: Omit<ModelOption, "available">[] = [
  {
    id: "gemini-3.5-flash-lite",
    label: "Economy · Gemini 3.5 Flash-Lite",
    description: "Fast, efficient background generation"
  },
  {
    id: "gemini-3.8-flash",
    label: "Quality · Gemini 3.8 Flash",
    description: "Stronger reasoning with potentially lower throughput"
  }
];

export function makePrompt(input: GenerateQuestionRequest, feedback?: unknown, previousDraft?: unknown): string {
  if (!assignmentIsEligible(input)) throw new GenerationError("INELIGIBLE_BLUEPRINT", "The objective, enabling objective and blueprint task are not an eligible combination", 400);
  return buildPrompt(input, feedback, previousDraft);
}

export class GenerationError extends Error {
  constructor(public code: string, message: string, public status = 500) {
    super(message);
  }
}

export function validateQuestionQuality(question: GeneratedQuestion, avoidSignatures: string[], expected?: BlueprintTags): void {
  const issue = alignmentIssue(question, expected);
  if (issue) throw new GenerationError("BLUEPRINT_MISMATCH", issue, 502);
  if (avoidSignatures.some((signature) => signature.toLowerCase() === question.vignetteSignature.toLowerCase())) {
    throw new GenerationError("DUPLICATE_SCENARIO", "Generated scenario duplicates a recent question", 502);
  }
  const correctText = question.options.find((option) => option.id === question.correctOptionId)?.text.toLowerCase() ?? "";
  for (const option of question.options) {
    if (option.id !== question.correctOptionId && correctText.length > 5 && option.hint.toLowerCase().includes(correctText)) {
      throw new GenerationError("ANSWER_LEAK", "A hint reveals the correct answer", 502);
    }
  }
}

export const GENERATION_DEADLINE_MS = 285_000;
export const REVIEW_DEADLINE_MS = 90_000;
export type GenerationTrace = {
  requestId: string;
  stage: "candidate" | "clinical" | "editorial" | "validation" | "decision";
  round: number;
  data: unknown;
};
export type GenerationOptions = {
  /** Local evaluation only; never included in HTTP responses or routine logs. */
  onTrace?: (trace: GenerationTrace) => void;
  signal?: AbortSignal;
};

export async function generateQuestion(rawInput: unknown, apiKey = process.env.GEMINI_API_KEY, options: GenerationOptions = {}): Promise<ClinicalQuestion> {
  if (!apiKey) throw new GenerationError("MISSING_API_KEY", "GEMINI_API_KEY is not configured", 503);
  const input = generateQuestionRequestSchema.parse(rawInput);
  if (!assignmentIsEligible(input)) throw new GenerationError("INELIGIBLE_BLUEPRINT", "The objective, enabling objective and blueprint task are not an eligible combination", 400);
  const objective = sourceObjectivesById.get(input.blueprint.mccObjectiveIds[0])!;
  const ai = new GoogleGenAI({ apiKey });
  const requestId = crypto.randomUUID();
  const deadline = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(), GENERATION_DEADLINE_MS);
  timer.unref?.();
  const startedAt = Date.now();
  const verboseLogging = ["verbose", "debug"].includes((process.env.QUESTION_GENERATION_LOG_LEVEL ?? "info").toLowerCase());
  let calls = 0;
  let feedback: unknown;
  let previousDraft: unknown;
  let lastError: GenerationError | undefined;
  const trace = (stage: GenerationTrace["stage"], round: number, data: unknown) => {
    try { options.onTrace?.({ requestId, stage, round, data }); }
    catch { console.warn(`[question-generation] requestId=${requestId} trace failed`); }
  };
  const verbose = (data: Record<string, unknown>) => {
    if (!verboseLogging) return;
    try {
      // Explicit response fields only; never dump SDK objects, prompts, headers
      // or raw exceptions. Redact the configured credential defensively too.
      const line = JSON.stringify({ level: "verbose", event: "call_result", requestId, model: input.model, ...data });
      console.debug(`[question-generation:verbose] ${line.replaceAll(apiKey, "[REDACTED]")}`);
    } catch {
      console.warn(`[question-generation] requestId=${requestId} verbose logging failed`);
    }
  };
  async function call(stage: "candidate" | "clinical" | "editorial", round: number, contents: string, schema: z.ZodType, instruction: string, callSignal = signal) {
    callSignal.throwIfAborted();
    const callNumber = ++calls;
    const callStarted = Date.now();
    console.info(`[question-generation] requestId=${requestId} stage=${stage} round=${round} call=${callNumber} model=${input.model} started`);
    // Race the provider so the deadline also holds if a transport ignores cancellation.
    let abortListener: () => void = () => {};
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model: input.model, contents,
          config: {
            systemInstruction: instruction,
            responseMimeType: "application/json",
            responseJsonSchema: z.toJSONSchema(schema),
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
            abortSignal: callSignal,
            httpOptions: { timeout: Math.max(1, GENERATION_DEADLINE_MS - (Date.now() - startedAt)) },
            ...(stage === "clinical" ? { tools: [{ googleSearch: {} }] } : {})
          }
        }),
        new Promise<never>((_, reject) => {
          abortListener = () => reject(new GenerationError("GENERATION_TIMEOUT", "Question generation timed out", 504));
          callSignal.addEventListener("abort", abortListener, { once: true });
          if (callSignal.aborted) abortListener();
        })
      ]);
      if (verboseLogging) {
        const raw = response.text ?? null;
        let result: unknown = raw;
        try { if (raw !== null) result = JSON.parse(raw); } catch { /* Preserve malformed JSON for diagnosis. */ }
        verbose({ stage, round, call: callNumber, status: "success", durationMs: Date.now() - callStarted,
          result, usage: response.usageMetadata, finishReason: response.candidates?.[0]?.finishReason,
          grounding: response.candidates?.[0]?.groundingMetadata });
      }
      return response;
    } catch (error) {
      const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
      verbose({ stage, round, call: callNumber, status: "error", durationMs: Date.now() - callStarted,
        error: { code: failureCode(error), ...(typeof status === "number" ? { httpStatus: status } : {}) } });
      throw error;
    } finally {
      callSignal.removeEventListener("abort", abortListener);
      console.info(`[question-generation] requestId=${requestId} stage=${stage} round=${round} call=${callNumber} durationMs=${Date.now() - callStarted}`);
    }
  }
  const failureCode = (error: unknown): string => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return "INVALID_REVIEW";
    if (error instanceof GenerationError) return error.code;
    if (/429|resource_exhausted|quota/i.test(error instanceof Error ? error.message : "")) return "QUOTA_EXHAUSTED";
    return "PROVIDER_UNAVAILABLE";
  };
  let candidateCalls = 0;
  async function candidate(): Promise<GeneratedQuestion> {
    candidateCalls += 1;
    const response = await call("candidate", candidateCalls, makePrompt(input, feedback, previousDraft), generatedQuestionSchema, SYSTEM_INSTRUCTION);
    previousDraft = response.text?.slice(0, 40_000) ?? "";
    try {
      const parsed = generatedQuestionSchema.parse(JSON.parse(response.text ?? ""));
      previousDraft = parsed;
      trace("candidate", candidateCalls, parsed);
      validateQuestionQuality(parsed, input.avoidSignatures, input.blueprint);
      return parsed;
    } catch (error) {
      if (!(error instanceof z.ZodError || error instanceof SyntaxError || error instanceof GenerationError)) throw error;
      feedback = error instanceof z.ZodError
        ? { structuralErrors: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 3000) }
        : { structuralErrors: error instanceof SyntaxError ? "Return valid JSON matching the question schema." : (error as Error).message };
      trace("validation", candidateCalls, feedback);
      lastError = error instanceof GenerationError ? error : new GenerationError("INVALID_GENERATED_QUESTION", "Generated question did not match its schema", 502);
      throw lastError;
    }
  }
  try {
    let parsed: GeneratedQuestion;
    try { parsed = await candidate(); }
    catch (error) {
      // Only structural validation gets one repair. Provider errors are real
      // request failures, and there is no draft to fall back to at this point.
      if (error !== lastError) throw error;
      parsed = await candidate();
    }
    const original = parsed;
    const context = reviewContext(input);
    const blinded = shuffleQuestionOptions(parsed);
    const blindDraft = { vignette: blinded.vignette, stem: blinded.stem, options: blinded.options.map(({ id, text }) => ({ id, text })) };
    const reviewSignal = AbortSignal.any([signal, AbortSignal.timeout(REVIEW_DEADLINE_MS)]);
    // Independent results: a failed reviewer must not cancel or discard the other.
    const results = await Promise.allSettled([
      call("clinical", candidateCalls, JSON.stringify({ context, question: blindDraft }), clinicalReviewSchema, CLINICAL_REVIEW_INSTRUCTION, reviewSignal)
        .then((result) => ({ review: clinicalReviewSchema.parse(JSON.parse(result.text ?? "")), grounding: result.candidates?.[0]?.groundingMetadata })),
      call("editorial", candidateCalls, JSON.stringify({ context, question: parsed, annotatedExamples: EDITORIAL_EXAMPLES }), editorialReviewSchema, EDITORIAL_REVIEW_INSTRUCTION, reviewSignal)
        .then((result) => editorialReviewSchema.parse(JSON.parse(result.text ?? "")))
    ]);
    signal.throwIfAborted();
    let clinical: ClinicalReview | undefined;
    let editorial: EditorialReview | undefined;
    let grounding: GroundingMetadata | undefined;
    const reviewFailures: string[] = [];
    if (results[0].status === "fulfilled") {
      const raw = results[0].value.review;
      const originalId = (id: OptionId | null) => id === null ? null : parsed.options.find((option) => option.text === blinded.options.find((option) => option.id === id)?.text)!.id;
      clinical = { ...raw, answerId: originalId(raw.answerId), strongestDistractorId: originalId(raw.strongestDistractorId) };
      grounding = results[0].value.grounding;
      trace("clinical", candidateCalls, { review: clinical, blindQuestion: blindDraft, blindAnswerId: raw.answerId, grounding });
    } else {
      reviewFailures.push(`clinical.${failureCode(results[0].reason)}`);
      trace("clinical", candidateCalls, { unavailable: true, code: failureCode(results[0].reason) });
    }
    if (results[1].status === "fulfilled") {
      editorial = results[1].value;
      trace("editorial", candidateCalls, editorial);
    } else {
      reviewFailures.push(`editorial.${failureCode(results[1].reason)}`);
      trace("editorial", candidateCalls, { unavailable: true, code: failureCode(results[1].reason) });
    }
    const findings = reviewFindings(parsed, clinical, editorial);
    const issues = findings.corrections.map((finding) => `${finding.reviewer}.${finding.kind}`);
    if (reviewFailures.length) console.warn(`[question-generation] requestId=${requestId} reviewIncomplete=${reviewFailures.join(",")}`);
    let outcome = candidateCalls > 1 ? "repaired" : "unchanged";
    let revisionFailure: string | undefined;
    if (issues.length && candidateCalls < 2) {
      trace("decision", candidateCalls, { accepted: false, outcome: "revision_requested", issues, advisories: findings.advisories, reviewFailures, calls });
      console.info(`[question-generation] requestId=${requestId} revising once issues=${issues.join(",")}`);
      feedback = { corrections: findings.corrections, advisories: findings.advisories, clinical, editorial, grounding };
      previousDraft = original;
      try {
        parsed = await candidate();
        outcome = "revised";
      } catch (error) {
        if (signal.aborted) throw error;
        revisionFailure = failureCode(error);
        if (findings.hasCorrectnessDefect) {
          trace("decision", candidateCalls, { accepted: false, outcome: "rejected_correctness", issues: [], revisionFailure, reviewFailures, calls });
          throw new GenerationError("QUALITY_REJECTED", "Unable to correct a demonstrated question defect", 502);
        }
        parsed = original;
        outcome = "fallback";
        console.warn(`[question-generation] requestId=${requestId} revisionFailed=${revisionFailure} delivering original valid draft`);
      }
    } else if (findings.hasCorrectnessDefect) {
      // A structural repair already consumed the second candidate call.
      trace("decision", candidateCalls, { accepted: false, outcome: "rejected_correctness", issues, reviewFailures, calls });
      throw new GenerationError("QUALITY_REJECTED", "A demonstrated question defect remains after the available repair", 502);
    }
    signal.throwIfAborted();
    trace("decision", candidateCalls, {
      accepted: true, outcome, issues: [], advisories: findings.advisories,
      unresolvedSuggestions: outcome === "revised" ? [] : issues,
      reviewIncomplete: reviewFailures.length > 0, reviewFailures, revisionFailure, calls
    });
    console.info(`[question-generation] requestId=${requestId} delivered outcome=${outcome} reviewIncomplete=${reviewFailures.length > 0} advisories=${findings.advisories.length} candidates=${candidateCalls} calls=${calls} durationMs=${Date.now() - startedAt}`);
    return {
      ...shuffleQuestionOptions(parsed), id: crypto.randomUUID(), topicId: input.topicId,
      topicTitle: objective.title, category: input.blueprint.discipline, model: input.model,
      generatedAt: new Date().toISOString(), schemaVersion: 2, blueprintVersion: blueprint.version,
      curriculumVersion, crosswalkVersion, promptVersion: PROMPT_VERSION,
      enablingObjectiveId: input.enablingObjectiveId, optionOrderVersion: 1
    };
  } catch (error) {
    if (signal.aborted) throw new GenerationError("GENERATION_TIMEOUT", "Question generation timed out", 504);
    if (error instanceof GenerationError) throw error;
    const message = error instanceof Error ? error.message : "Question generation failed";
    if (/429|resource_exhausted|quota/i.test(message)) throw new GenerationError("QUOTA_EXHAUSTED", "Gemini quota is temporarily exhausted", 429);
    // Provider messages can contain request content; expose a stable public error.
    throw new GenerationError("GENERATION_FAILED", "Unable to generate and review a question", 502);
  } finally {
    clearTimeout(timer);
    console.info(`[question-generation] requestId=${requestId} finished calls=${calls} durationMs=${Date.now() - startedAt}`);
  }
}
