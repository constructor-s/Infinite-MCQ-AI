import { GoogleGenAI } from "@google/genai";
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
  type ModelOption
} from "../lib/contracts.js";
import { shuffleQuestionOptions } from "../lib/shuffleQuestion.js";

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

export function makePrompt(input: GenerateQuestionRequest, exampleIndex = 0, feedback?: string): string {
  if (!assignmentIsEligible(input)) throw new GenerationError("INELIGIBLE_BLUEPRINT", "The objective, enabling objective and blueprint task are not an eligible combination", 400);
  return buildPrompt(input, exampleIndex, feedback);
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

export async function generateQuestion(rawInput: unknown, apiKey = process.env.GEMINI_API_KEY): Promise<ClinicalQuestion> {
  if (!apiKey) throw new GenerationError("MISSING_API_KEY", "GEMINI_API_KEY is not configured", 503);
  const input = generateQuestionRequestSchema.parse(rawInput);
  if (!assignmentIsEligible(input)) throw new GenerationError("INELIGIBLE_BLUEPRINT", "The objective, enabling objective and blueprint task are not an eligible combination", 400);
  const objective = sourceObjectivesById.get(input.blueprint.mccObjectiveIds[0])!;

  const ai = new GoogleGenAI({ apiKey });
  let lastError: unknown;
  let feedback: string | undefined;
  const exampleIndex = Math.floor(Math.random() * 2);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptNumber = attempt + 1;
    const attemptStartedAt = Date.now();
    console.info(`[question-generation] Gemini attempt=${attemptNumber} started model=${input.model} topicId=${input.topicId}`);
    try {
      const response = await ai.models.generateContent({
        model: input.model,
        contents: makePrompt(input, exampleIndex, feedback),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(generatedQuestionSchema),
          temperature: 0.8
        }
      });
      if (!response.text) throw new GenerationError("EMPTY_RESPONSE", "Gemini returned no question", 502);
      const parsed = generatedQuestionSchema.parse(JSON.parse(response.text));
      validateQuestionQuality(parsed, input.avoidSignatures, input.blueprint);
      const randomized = shuffleQuestionOptions(parsed);
      console.info(`[question-generation] Gemini attempt=${attemptNumber} completed durationMs=${Date.now() - attemptStartedAt}`);
      return {
        ...randomized,
        id: crypto.randomUUID(),
        topicId: input.topicId,
        topicTitle: objective.title,
        category: input.blueprint.discipline,
        model: input.model,
        generatedAt: new Date().toISOString(),
        schemaVersion: 2,
        blueprintVersion: blueprint.version,
        curriculumVersion,
        crosswalkVersion,
        promptVersion: PROMPT_VERSION,
        enablingObjectiveId: input.enablingObjectiveId,
        optionOrderVersion: 1
      };
    } catch (error) {
      lastError = error;
      feedback = error instanceof z.ZodError ? `Correct the response schema: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 1500)}`
        : error instanceof SyntaxError ? "Return valid JSON matching the response schema."
        : error instanceof GenerationError ? error.message : undefined;
      const code = error instanceof GenerationError ? error.code : error instanceof Error ? error.name : "UNKNOWN_ERROR";
      console.warn(`[question-generation] Gemini attempt=${attemptNumber} failed code=${code} durationMs=${Date.now() - attemptStartedAt}`);
      if (error instanceof GenerationError && error.status < 500) throw error;
      if (attemptNumber < 2) console.info(`[question-generation] retrying after code=${code}`);
    }
  }
  if (lastError instanceof GenerationError) throw lastError;
  const message = lastError instanceof Error ? lastError.message : "Question generation failed";
  if (/429|resource_exhausted|quota/i.test(message)) {
    throw new GenerationError("QUOTA_EXHAUSTED", "Gemini free-tier quota is temporarily exhausted", 429);
  }
  throw new GenerationError("GENERATION_FAILED", message, 502);
}
