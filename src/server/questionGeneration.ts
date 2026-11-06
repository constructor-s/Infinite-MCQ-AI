import { GoogleGenAI, ThinkingLevel, type GroundingMetadata } from "@google/genai";
import { z } from "zod";
import { curriculumVersion, crosswalkVersion } from "../data/curriculum.js";
import { blueprint, PROMPT_VERSION, type BlueprintTags } from "../lib/blueprint.js";
import { sourceObjectivesById } from "./objectives.js";
import { alignmentIssue, assignmentIsEligible, buildPrompt, SYSTEM_INSTRUCTION } from "./questionPrompts.js";
import {
  generateQuestionRequestSchema,
  type ClinicalQuestion,
  type GenerateQuestionRequest,
  type ModelOption
} from "../lib/contracts.js";
import { shuffleValues } from "../lib/shuffleQuestion.js";
import { clinicalReviewSchema, readClinicalReview, editorialReviewSchema, CLINICAL_REVIEW_INSTRUCTION, EDITORIAL_REVIEW_INSTRUCTION, EDITORIAL_EXAMPLES, reviewContext, reviewFindings, refinementSchema, readRefinedQuestion, changedQuestionFields, refinementPrompt, REFINEMENT_INSTRUCTION, type ClinicalReview, type EditorialReview } from "./questionReview.js";
import { questionDraftSchema, readQuestionDraft, questionCoreContent, toGeneratedQuestion, type QuestionDraft, type RefinedQuestion } from "./questionDraft.js";
import { optionLengthIssue } from "./questionOptions.js";

export const GENERATION_THINKING_LEVELS = Object.freeze({
  candidate: ThinkingLevel.MEDIUM,
  clinical: ThinkingLevel.LOW,
  editorial: ThinkingLevel.LOW,
  refinement: ThinkingLevel.LOW
});

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

export function validateQuestionQuality(question: RefinedQuestion, avoidSignatures: string[], assignment: BlueprintTags): void {
  const issue = alignmentIssue(question, assignment);
  if (issue) throw new GenerationError("BLUEPRINT_MISMATCH", issue, 502);
  if (avoidSignatures.some((signature) => signature.toLowerCase() === question.vignetteSignature.toLowerCase())) {
    throw new GenerationError("DUPLICATE_SCENARIO", "Generated scenario duplicates a recent question", 502);
  }
  const lengthIssue = optionLengthIssue(questionCoreContent(question));
  if (lengthIssue) throw new GenerationError("ANSWER_LENGTH_GIVEAWAY", lengthIssue, 502);
  const correctText = question.correctAnswer.text.toLowerCase();
  for (const option of question.distractors) {
    if (correctText.length > 5 && option.hint.toLowerCase().includes(correctText)) {
      throw new GenerationError("ANSWER_LEAK", "A hint reveals the correct answer", 502);
    }
  }
}

export const GENERATION_DEADLINE_MS = 285_000;
export const REVIEW_DEADLINE_MS = 90_000;
export type GenerationTrace = {
  requestId: string;
  stage: "candidate" | "clinical" | "editorial" | "refinement" | "validation" | "decision" | "call";
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
  async function call(stage: "candidate" | "clinical" | "editorial" | "refinement", round: number, contents: string, schema: z.ZodType, instruction: string, callSignal = signal) {
    callSignal.throwIfAborted();
    const thinkingLevel = GENERATION_THINKING_LEVELS[stage];
    const callNumber = ++calls;
    const callStarted = Date.now();
    console.info(`[question-generation] requestId=${requestId} stage=${stage} round=${round} call=${callNumber} model=${input.model} thinkingLevel=${thinkingLevel} started`);
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
            thinkingConfig: { thinkingLevel },
            abortSignal: callSignal,
            httpOptions: { timeout: Math.max(1, GENERATION_DEADLINE_MS - (Date.now() - startedAt)) },
            ...(stage === "clinical" ? { tools: [{ googleSearch: {} }, { codeExecution: {} }] }
              : stage !== "editorial" ? { tools: [{ codeExecution: {} }] } : {})
          }
        }),
        new Promise<never>((_, reject) => {
          abortListener = () => reject(new GenerationError("GENERATION_TIMEOUT", "Question generation timed out", 504));
          callSignal.addEventListener("abort", abortListener, { once: true });
          if (callSignal.aborted) abortListener();
        })
      ]);
      trace("call", round, { stage, call: callNumber, thinkingLevel, status: "success", durationMs: Date.now() - callStarted, usage: response.usageMetadata });
      if (verboseLogging) {
        const raw = response.text ?? null;
        let result: unknown = raw;
        try { if (raw !== null) result = JSON.parse(raw); } catch { /* Preserve malformed JSON for diagnosis. */ }
        verbose({ stage, round, call: callNumber, thinkingLevel, status: "success", durationMs: Date.now() - callStarted,
          result, usage: response.usageMetadata, finishReason: response.candidates?.[0]?.finishReason,
          grounding: response.candidates?.[0]?.groundingMetadata });
      }
      return response;
    } catch (error) {
      trace("call", round, { stage, call: callNumber, thinkingLevel, status: "error", durationMs: Date.now() - callStarted, code: failureCode(error) });
      const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
      verbose({ stage, round, call: callNumber, thinkingLevel, status: "error", durationMs: Date.now() - callStarted,
        error: { code: failureCode(error), ...(typeof status === "number" ? { httpStatus: status } : {}) } });
      throw error;
    } finally {
      callSignal.removeEventListener("abort", abortListener);
      console.info(`[question-generation] requestId=${requestId} stage=${stage} round=${round} call=${callNumber} thinkingLevel=${thinkingLevel} durationMs=${Date.now() - callStarted}`);
    }
  }
  const failureCode = (error: unknown): string => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return "INVALID_REVIEW";
    if (error instanceof GenerationError) return error.code;
    if (/429|resource_exhausted|quota/i.test(error instanceof Error ? error.message : "")) return "QUOTA_EXHAUSTED";
    return "PROVIDER_UNAVAILABLE";
  };
  const reportValidation = (stage: "candidate" | "refinement", round: number, error: z.ZodError | SyntaxError | GenerationError) => {
    const category = error instanceof z.ZodError ? "schema" : error instanceof SyntaxError ? "json" : "quality";
    const code = error instanceof SyntaxError ? "INVALID_JSON" : error instanceof GenerationError ? error.code
      : stage === "candidate" ? "INVALID_GENERATED_QUESTION" : "INVALID_REFINEMENT";
    const qualityMessages: Record<string, string> = {
      ANSWER_LENGTH_GIVEAWAY: "The correct option exceeds the distractor-median word-count limit.",
      BLUEPRINT_MISMATCH: "The question does not match its assigned task or prose format.",
      DUPLICATE_SCENARIO: "The scenario duplicates a recent question.",
      ANSWER_LEAK: "A distractor hint reveals the correct answer."
    };
    // Unknown property names and JSON parser errors can contain model text.
    // Emit only known schema paths and bounded, input-free error descriptions.
    const fields = new Set(["vignette", "stem", "correctAnswer", "distractors", "options", "text", "hint", "explanation", "highYieldPearl", "vignetteSignature", "blueprint"]);
    const source = error instanceof z.ZodError ? error.issues : [{ path: [], code,
      message: error instanceof SyntaxError ? "Response is not valid JSON." : qualityMessages[code] ?? "Question failed an application validation check." }];
    const issues = source.slice(0, 10).map((issue) => ({
      path: issue.path.slice(0, 8).map((part) => typeof part === "number" ? part : typeof part === "string" && fields.has(part) ? part : "[field]"),
      code: issue.code,
      message: (issue.code === "unrecognized_keys" ? "Unexpected fields in structured response."
        : issue.code === "invalid_value" ? "Field is outside the allowed values."
        : issue.code === "invalid_union" ? "Field does not match an allowed type."
        : issue.message).replaceAll(apiKey, "[REDACTED]").replace(/[\r\n\t]/g, " ").slice(0, 240)
    }));
    const line = JSON.stringify({ requestId, stage, category, code, issues, issueCount: source.length, truncated: source.length > issues.length }).replaceAll(apiKey, "[REDACTED]");
    console.warn(`[question-generation:validation] ${line}`);
    trace("validation", round, JSON.parse(line));
  };
  let candidateCalls = 0;
  async function candidate(): Promise<QuestionDraft> {
    candidateCalls += 1;
    const response = await call("candidate", candidateCalls, makePrompt(input, feedback, previousDraft), questionDraftSchema, SYSTEM_INSTRUCTION);
    previousDraft = response.text?.slice(0, 40_000) ?? "";
    try {
      const parsed = readQuestionDraft(JSON.parse(response.text ?? ""));
      previousDraft = questionCoreContent(parsed);
      trace("candidate", candidateCalls, parsed);
      const issue = alignmentIssue(parsed, input.blueprint);
      if (issue) throw new GenerationError("BLUEPRINT_MISMATCH", issue, 502);
      return parsed;
    } catch (error) {
      if (!(error instanceof z.ZodError || error instanceof SyntaxError || error instanceof GenerationError)) throw error;
      feedback = error instanceof z.ZodError
        ? { structuralErrors: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 3000) }
        : { structuralErrors: error instanceof SyntaxError ? "Return valid JSON matching the question schema." : (error as Error).message };
      reportValidation("candidate", candidateCalls, error);
      lastError = error instanceof GenerationError ? error : new GenerationError("INVALID_GENERATED_QUESTION", "Generated question did not match its schema", 502);
      throw lastError;
    }
  }
  try {
    let parsed: QuestionDraft;
    try { parsed = await candidate(); }
    catch (error) {
      // Only structural validation gets one repair. Provider errors are real
      // request failures, and there is no draft to fall back to at this point.
      if (error !== lastError) throw error;
      parsed = await candidate();
    }
    const original = parsed;
    const context = reviewContext(input);
    const blindDraft = { vignette: parsed.vignette, stem: parsed.stem, options: shuffleValues([parsed.correctAnswer, ...parsed.distractors]) };
    const reviewSignal = AbortSignal.any([signal, AbortSignal.timeout(REVIEW_DEADLINE_MS)]);
    // Independent results: a failed reviewer must not cancel or discard the other.
    const results = await Promise.allSettled([
      call("clinical", candidateCalls, JSON.stringify({ context, question: blindDraft }), clinicalReviewSchema, CLINICAL_REVIEW_INSTRUCTION, reviewSignal)
        .then((result) => ({ review: readClinicalReview(JSON.parse(result.text ?? ""), blindDraft.options), grounding: result.candidates?.[0]?.groundingMetadata })),
      call("editorial", candidateCalls, JSON.stringify({ context, question: parsed, annotatedExamples: EDITORIAL_EXAMPLES }), editorialReviewSchema, EDITORIAL_REVIEW_INSTRUCTION, reviewSignal)
        .then((result) => editorialReviewSchema.parse(JSON.parse(result.text ?? "")))
    ]);
    signal.throwIfAborted();
    let clinical: ClinicalReview | undefined;
    let editorial: EditorialReview | undefined;
    let grounding: GroundingMetadata | undefined;
    const reviewFailures: string[] = [];
    if (results[0].status === "fulfilled") {
      clinical = results[0].value.review;
      grounding = results[0].value.grounding;
      trace("clinical", candidateCalls, { review: clinical, blindQuestion: blindDraft, grounding });
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
    const refinementRound = candidateCalls + 1;
    const reviewFeedback = {
      corrections: findings.corrections, advisories: findings.advisories,
      clinical: clinical ? { answerText: clinical.answerText, strongestAlternativeText: clinical.strongestAlternativeText, decisiveCaseFact: clinical.decisiveCaseFact } : null,
      reviewFailures
    };
    trace("decision", candidateCalls, { accepted: false, outcome: "refinement_requested", issues, advisories: findings.advisories, reviewFailures, calls });
    let final: RefinedQuestion;
    let changedFields: ReturnType<typeof changedQuestionFields>;
    try {
      const response = await call("refinement", refinementRound, refinementPrompt(input, original, reviewFeedback), refinementSchema, REFINEMENT_INSTRUCTION);
      final = readRefinedQuestion(JSON.parse(response.text ?? ""));
      validateQuestionQuality(final, input.avoidSignatures, input.blueprint);
      changedFields = changedQuestionFields(original, final);
      trace("refinement", refinementRound, { question: final, changed: changedFields.length > 0, changedFields });
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof GenerationError) {
        reportValidation("refinement", refinementRound, error);
      }
      const refinementFailure = error instanceof z.ZodError || error instanceof SyntaxError ? "INVALID_REFINEMENT" : failureCode(error);
      trace("refinement", refinementRound, { unavailable: true, code: refinementFailure });
      trace("decision", refinementRound, { accepted: false, outcome: "rejected_refinement", issues, refinementFailure, reviewFailures, calls });
      verbose({ event: "refinement_result", stage: "refinement", round: refinementRound, outcome: "rejected_refinement", refinementFailure, calls });
      // The lean draft cannot be delivered: it has no final teaching content.
      // Preserve provider errors for the normal quota/transport handling below.
      if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof GenerationError) {
        throw new GenerationError("QUALITY_REJECTED", "Unable to produce a complete valid final question", 502);
      }
      throw error;
    }
    signal.throwIfAborted();
    const changed = changedFields.length > 0;
    const outcome = changed ? "refined_changed" : "refined_unchanged";
    verbose({ event: "refinement_result", stage: "refinement", round: refinementRound, outcome, changed, changedFields, calls });
    trace("decision", refinementRound, {
      accepted: true, outcome, issues: [], advisories: findings.advisories,
      reviewIncomplete: reviewFailures.length > 0, reviewFailures,
      changed, changedFields, initialCandidateCalls: candidateCalls, calls
    });
    console.info(`[question-generation] requestId=${requestId} delivered outcome=${outcome} reviewIncomplete=${reviewFailures.length > 0} advisories=${findings.advisories.length} initialCandidates=${candidateCalls} calls=${calls} durationMs=${Date.now() - startedAt}`);
    return {
      ...toGeneratedQuestion(final, input.blueprint), id: crypto.randomUUID(), topicId: input.topicId,
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
