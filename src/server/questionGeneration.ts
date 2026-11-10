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
  type ModelOption,
  type QuestionGenerationDiagnostic,
  type QuestionQualityWarning
} from "../lib/contracts.js";
import { shuffleValues } from "../lib/shuffleQuestion.js";
import { clinicalReviewSchema, readClinicalReview, CLINICAL_REVIEW_INSTRUCTION, reviewContext, reviewFindings, refinementSchema, readRefinedQuestion, changedQuestionFields, refinementPrompt, REFINEMENT_INSTRUCTION, type ClinicalReview } from "./questionReview.js";
import { questionDraftSchema, readQuestionDraft, questionCoreContent, toGeneratedQuestion, type QuestionDraft, type RefinedQuestion } from "./questionDraft.js";
import { optionLengthIssue } from "./questionOptions.js";

export const GENERATION_THINKING_LEVELS = Object.freeze({
  candidate: ThinkingLevel.MEDIUM,
  clinical: ThinkingLevel.LOW,
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
  constructor(public code: string, message: string, public status = 500, public diagnostic?: QuestionGenerationDiagnostic) {
    super(message);
  }
}

export type QuestionQualityIssue = { code: string; message: string };

export function validateQuestionQuality(question: RefinedQuestion, avoidSignatures: string[], assignment: BlueprintTags): QuestionQualityIssue[] {
  const issues: QuestionQualityIssue[] = [];
  const issue = alignmentIssue(question, assignment);
  if (issue) issues.push({ code: "BLUEPRINT_MISMATCH", message: issue });
  if (avoidSignatures.some((signature) => signature.toLowerCase() === question.vignetteSignature.toLowerCase())) {
    issues.push({ code: "DUPLICATE_SCENARIO", message: "Generated scenario duplicates a recent question" });
  }
  const lengthIssue = optionLengthIssue(questionCoreContent(question));
  if (lengthIssue) issues.push({ code: "ANSWER_LENGTH_GIVEAWAY", message: lengthIssue });
  const correctText = question.correctAnswer.text.toLowerCase();
  for (const option of question.distractors) {
    if (correctText.length > 5 && option.hint.toLowerCase().includes(correctText)) {
      issues.push({ code: "ANSWER_LEAK", message: "A hint reveals the correct answer" });
      break;
    }
  }
  return issues;
}

export const GENERATION_DEADLINE_MS = 285_000;
export const REVIEW_DEADLINE_MS = 90_000;
export type GenerationTrace = {
  requestId: string;
  stage: "candidate" | "clinical" | "refinement" | "validation" | "decision" | "call";
  round: number;
  data: unknown;
};
export type GenerationOptions = {
  /** Local evaluation only; never included in HTTP responses or routine logs. */
  onTrace?: (trace: GenerationTrace) => void;
  /** Sanitized, non-blocking QC findings for successful generated questions. */
  onQualityWarning?: (warning: QuestionQualityWarning) => void;
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
  async function call(stage: "candidate" | "clinical" | "refinement", round: number, contents: string, schema: z.ZodType, instruction: string, callSignal = signal) {
    callSignal.throwIfAborted();
    const thinkingLevel = GENERATION_THINKING_LEVELS[stage];
    const callNumber = ++calls;
    const callStarted = Date.now();
    const tools = stage === "clinical" ? [{ googleSearch: {} }, { codeExecution: {} }] : undefined;
    const requestPayload = {
      model: input.model,
      contents,
      config: {
        systemInstruction: instruction,
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(schema),
        thinkingConfig: { thinkingLevel },
        httpOptions: { timeout: Math.max(1, GENERATION_DEADLINE_MS - (Date.now() - startedAt)) },
        ...(tools ? { tools } : {})
      }
    };
    console.info(`[question-generation] requestId=${requestId} stage=${stage} round=${round} call=${callNumber} model=${input.model} thinkingLevel=${thinkingLevel} started`);
    // Race the provider so the deadline also holds if a transport ignores cancellation.
    let abortListener: () => void = () => {};
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          ...requestPayload,
          config: { ...requestPayload.config, abortSignal: callSignal }
        }),
        new Promise<never>((_, reject) => {
          abortListener = () => reject(new GenerationError("GENERATION_TIMEOUT", "Question generation timed out", 504));
          callSignal.addEventListener("abort", abortListener, { once: true });
          if (callSignal.aborted) abortListener();
        })
      ]);
      const nonTextParts = (response.candidates ?? []).flatMap((candidate, candidateIndex) =>
        (candidate.content?.parts ?? []).flatMap((part, partIndex) => {
          const { text: _text, ...partContent } = part;
          return Object.keys(partContent).length ? [{ candidateIndex, partIndex, part: partContent }] : [];
        }));
      trace("call", round, {
        stage, call: callNumber, thinkingLevel, request: requestPayload, status: "success",
        durationMs: Date.now() - callStarted, usage: response.usageMetadata, nonTextParts
      });
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
      trace("call", round, {
        stage, call: callNumber, thinkingLevel, request: requestPayload, status: "error",
        durationMs: Date.now() - callStarted, code: failureCode(error), nonTextParts: []
      });
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
  const reportValidation = (stage: "candidate" | "refinement", round: number, error: z.ZodError | SyntaxError | GenerationError): QuestionGenerationDiagnostic => {
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
    const diagnostic = JSON.parse(line) as QuestionGenerationDiagnostic;
    trace("validation", round, diagnostic);
    return diagnostic;
  };
  const reportQualityIssues = (stage: "candidate" | "refinement", round: number, issues: QuestionQualityIssue[]) => {
    for (const issue of issues) {
      const diagnostic: QuestionQualityWarning = {
        requestId,
        stage, category: "quality", code: issue.code,
        issues: [{ path: [], code: issue.code, message: issue.message.replaceAll(apiKey, "[REDACTED]").replace(/[\r\n\t]/g, " ").slice(0, 240) }],
        issueCount: 1, truncated: false
      };
      const line = JSON.stringify({ requestId, ...diagnostic });
      console.warn(`[question-generation:validation] ${line}`);
      trace("validation", round, { requestId, ...diagnostic });
      try { options.onQualityWarning?.(diagnostic); }
      catch { console.warn(`[question-generation] requestId=${requestId} quality warning callback failed`); }
    }
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
      return parsed;
    } catch (error) {
      if (!(error instanceof z.ZodError || error instanceof SyntaxError || error instanceof GenerationError)) throw error;
      feedback = error instanceof z.ZodError
        ? { structuralErrors: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 3000) }
        : { structuralErrors: error instanceof SyntaxError ? "Return valid JSON matching the question schema." : (error as Error).message };
      const diagnostic = reportValidation("candidate", candidateCalls, error);
      lastError = new GenerationError(diagnostic.code, diagnostic.code, 502, diagnostic);
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
    let clinical: ClinicalReview | undefined;
    let grounding: GroundingMetadata | undefined;
    const reviewFailures: string[] = [];
    try {
      const result = await call("clinical", candidateCalls, JSON.stringify({ context, question: blindDraft }), clinicalReviewSchema, CLINICAL_REVIEW_INSTRUCTION, reviewSignal);
      clinical = readClinicalReview(JSON.parse(result.text ?? ""), blindDraft.options);
      grounding = result.candidates?.[0]?.groundingMetadata;
      trace("clinical", candidateCalls, { review: clinical, blindQuestion: blindDraft, grounding });
    } catch (error) {
      if (signal.aborted) throw error;
      reviewFailures.push(`clinical.${failureCode(error)}`);
      trace("clinical", candidateCalls, { unavailable: true, code: failureCode(error) });
    }
    signal.throwIfAborted();
    const findings = reviewFindings(parsed, clinical);
    const issues = findings.corrections.map((finding) => `${finding.reviewer}.${finding.kind}`);
    if (reviewFailures.length) console.warn(`[question-generation] requestId=${requestId} reviewIncomplete=${reviewFailures.join(",")}`);
    const refinementRound = candidateCalls + 1;
    const reviewFeedback = {
      corrections: findings.corrections, advisories: findings.advisories,
      clinical: clinical ? { independentAnswerText: clinical.independentAnswerText, choiceStatus: clinical.choiceStatus,
        answerText: clinical.answerText, strongestAlternativeText: clinical.strongestAlternativeText,
        decisiveCaseFact: clinical.decisiveCaseFact, calculation: clinical.calculation } : null,
      reviewFailures
    };
    trace("decision", candidateCalls, { accepted: false, outcome: "refinement_requested", issues, advisories: findings.advisories, reviewFailures, calls });
    let final: RefinedQuestion;
    let changedFields: ReturnType<typeof changedQuestionFields>;
    try {
      const response = await call("refinement", refinementRound, refinementPrompt(input, original, reviewFeedback), refinementSchema, REFINEMENT_INSTRUCTION);
      final = readRefinedQuestion(JSON.parse(response.text ?? ""));
      reportQualityIssues("refinement", refinementRound, validateQuestionQuality(final, input.avoidSignatures, input.blueprint));
      changedFields = changedQuestionFields(original, final);
      trace("refinement", refinementRound, { question: final, changed: changedFields.length > 0, changedFields });
    } catch (error) {
      if (signal.aborted) throw error;
      const diagnostic = error instanceof z.ZodError || error instanceof SyntaxError || error instanceof GenerationError
        ? reportValidation("refinement", refinementRound, error)
        : undefined;
      const refinementFailure = error instanceof z.ZodError || error instanceof SyntaxError ? "INVALID_REFINEMENT" : failureCode(error);
      trace("refinement", refinementRound, { unavailable: true, code: refinementFailure });
      trace("decision", refinementRound, { accepted: false, outcome: "rejected_refinement", issues, refinementFailure, reviewFailures, calls });
      verbose({ event: "refinement_result", stage: "refinement", round: refinementRound, outcome: "rejected_refinement", refinementFailure, calls });
      // The lean draft cannot be delivered: it has no final teaching content.
      // Preserve provider errors for the normal quota/transport handling below.
      if (diagnostic) throw new GenerationError(diagnostic.code, diagnostic.code, 502, diagnostic);
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
