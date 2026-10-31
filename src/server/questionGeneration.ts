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
import { clinicalReviewSchema, editorialReviewSchema, CLINICAL_REVIEW_INSTRUCTION, EDITORIAL_REVIEW_INSTRUCTION, EDITORIAL_EXAMPLES, reviewContext, reviewIssues, type ClinicalReview, type EditorialReview } from "./questionReview.js";

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
  let calls = 0;
  let feedback: unknown;
  let previousDraft: unknown;
  let lastError: GenerationError | undefined;
  let forceVerification = false;
  const trace = (stage: GenerationTrace["stage"], round: number, data: unknown) => {
    try { options.onTrace?.({ requestId, stage, round, data }); }
    catch { console.warn(`[question-generation] requestId=${requestId} trace failed`); }
  };
  async function call(stage: "candidate" | "clinical" | "editorial", round: number, contents: string, schema: z.ZodType, instruction: string, callSignal = signal) {
    callSignal.throwIfAborted();
    calls += 1;
    const callStarted = Date.now();
    console.info(`[question-generation] requestId=${requestId} stage=${stage} round=${round} call=${calls} model=${input.model} started`);
    // Race the provider so the deadline also holds if a transport ignores cancellation.
    let abortListener: () => void = () => {};
    try {
      return await Promise.race([
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
    } finally {
      callSignal.removeEventListener("abort", abortListener);
      console.info(`[question-generation] requestId=${requestId} stage=${stage} round=${round} durationMs=${Date.now() - callStarted}`);
    }
  }
  try {
    for (let round = 1; round <= 3; round += 1) {
      const response = await call("candidate", round, makePrompt(input, feedback, previousDraft), generatedQuestionSchema, SYSTEM_INSTRUCTION);
      // Preserve the actual draft for both structural repair and semantic revision.
      previousDraft = response.text?.slice(0, 40_000) ?? "";
      let parsed: GeneratedQuestion;
      try {
        parsed = generatedQuestionSchema.parse(JSON.parse(response.text ?? ""));
        previousDraft = parsed;
        trace("candidate", round, parsed);
        validateQuestionQuality(parsed, input.avoidSignatures, input.blueprint);
      } catch (error) {
        if (!(error instanceof z.ZodError || error instanceof SyntaxError || error instanceof GenerationError)) throw error;
        feedback = error instanceof z.ZodError
          ? { structuralErrors: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 3000) }
          : { structuralErrors: error instanceof SyntaxError ? "Return valid JSON matching the question schema." : (error as Error).message };
        lastError = error instanceof GenerationError ? error : new GenerationError("INVALID_GENERATED_QUESTION", "Generated question did not match its schema", 502);
        trace("validation", round, feedback);
        console.warn(`[question-generation] requestId=${requestId} round=${round} rejected code=${lastError.code}`);
        continue;
      }

      const context = reviewContext(input);
      const blinded = shuffleQuestionOptions(parsed);
      // The shuffled key stays in this server scope. Project only learner-visible fields.
      const blindDraft = { vignette: blinded.vignette, stem: blinded.stem, options: blinded.options.map(({ id, text }) => ({ id, text })) };
      const siblings = new AbortController();
      const reviewSignal = AbortSignal.any([signal, siblings.signal]);
      let clinical: ClinicalReview;
      let editorial: EditorialReview;
      let grounding: GroundingMetadata | undefined;
      try {
        const results = await Promise.all([
          call("clinical", round, JSON.stringify({ context, question: blindDraft, forceVerification }), clinicalReviewSchema, CLINICAL_REVIEW_INSTRUCTION + (forceVerification ? " The prior round had a disputed clinical conclusion; search verification is mandatory. Set verificationCategory to uncertain_or_disputed or another applicable non-none category." : ""), reviewSignal)
            .then((result) => ({ review: clinicalReviewSchema.parse(JSON.parse(result.text ?? "")), grounding: result.candidates?.[0]?.groundingMetadata })),
          call("editorial", round, JSON.stringify({ context, question: parsed, annotatedExamples: EDITORIAL_EXAMPLES }), editorialReviewSchema, EDITORIAL_REVIEW_INSTRUCTION, reviewSignal)
            .then((result) => editorialReviewSchema.parse(JSON.parse(result.text ?? "")))
        ]);
        clinical = results[0].review;
        grounding = results[0].grounding;
        editorial = results[1];
      } catch (error) {
        siblings.abort();
        if (error instanceof z.ZodError || error instanceof SyntaxError) throw new GenerationError("EVALUATION_FAILED", "Question evaluation returned an invalid review", 502);
        if (error instanceof GenerationError || signal.aborted || /429|resource_exhausted|quota/i.test(error instanceof Error ? error.message : "")) throw error;
        throw new GenerationError("EVALUATION_FAILED", "Unable to evaluate the generated question", 502);
      }
      const blindAnswerId = clinical.answerId;
      // Map the blind reviewer IDs to the original draft without leaking the key.
      const originalId = (id: OptionId | null) => id === null ? null : parsed.options.find((option) => option.text === blinded.options.find((option) => option.id === id)?.text)!.id;
      clinical = { ...clinical, answerId: originalId(clinical.answerId), strongestDistractorId: originalId(clinical.strongestDistractorId) };
      trace("clinical", round, { review: clinical, blindQuestion: blindDraft, blindAnswerId, grounding });
      trace("editorial", round, editorial);
      const issues = reviewIssues(parsed, clinical, editorial, grounding);
      if (forceVerification && clinical.verificationCategory === "none") issues.push("clinical.disputedVerificationRequired");
      trace("decision", round, { accepted: !issues.length, issues, calls });
      if (issues.length) {
        console.warn(`[question-generation] requestId=${requestId} round=${round} rejected criteria=${issues.join(",")}`);
        feedback = { issues, clinical, editorial, grounding };
        forceVerification ||= clinical.answerId !== parsed.correctOptionId || clinical.criteria.clinicalAccuracy.status !== "pass";
        lastError = new GenerationError("QUALITY_REJECTED", "Question did not pass quality review", 502);
        continue;
      }
      signal.throwIfAborted();
      console.info(`[question-generation] requestId=${requestId} accepted rounds=${round} calls=${calls} durationMs=${Date.now() - startedAt}`);
      return {
        ...shuffleQuestionOptions(parsed), id: crypto.randomUUID(), topicId: input.topicId,
        topicTitle: objective.title, category: input.blueprint.discipline, model: input.model,
        generatedAt: new Date().toISOString(), schemaVersion: 2, blueprintVersion: blueprint.version,
        curriculumVersion, crosswalkVersion, promptVersion: PROMPT_VERSION,
        enablingObjectiveId: input.enablingObjectiveId, optionOrderVersion: 1
      };
    }
    throw lastError ?? new GenerationError("QUALITY_REJECTED", "Question did not pass quality review", 502);
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
