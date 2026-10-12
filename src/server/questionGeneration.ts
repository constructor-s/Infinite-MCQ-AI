import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { topicsById } from "../data/topics.js";
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

const SYSTEM_INSTRUCTION = `Write one MCCQE-style Canadian clinical reasoning MCQ for a graduating medical student. Use one unambiguously best answer and five plausible options. Keep the vignette focused and clinically consistent. For every option, give a concise misconception hint that guides without naming or quoting the correct answer, plus a concise explanation. The highYieldPearl should include a relevant, clinically accepted mnemonic, expanding each letter or component when useful (for example, **SIGECAPS** for a major depressive episode). Never refer to answer letters in prose because the server reorders the choices. Use SI units when relevant. Do not invent citations. Return only schema-conforming JSON.`;

export function makePrompt(input: GenerateQuestionRequest): string {
  const topic = topicsById.get(input.topicId);
  if (!topic) throw new GenerationError("UNKNOWN_TOPIC", "Unknown curriculum topic", 400);
  const avoid = input.avoidSignatures.length ? ` Avoid scenarios: ${input.avoidSignatures.join("; ")}.` : "";
  return `Topic: ${topic.title}. Focus: ${topic.description} Difficulty: ${input.difficulty}/5.${avoid}`;
}

export class GenerationError extends Error {
  constructor(public code: string, message: string, public status = 500) {
    super(message);
  }
}

export function validateQuestionQuality(question: GeneratedQuestion, avoidSignatures: string[]): void {
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
  const topic = topicsById.get(input.topicId);
  if (!topic) throw new GenerationError("UNKNOWN_TOPIC", "Unknown curriculum topic", 400);

  const ai = new GoogleGenAI({ apiKey });
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptNumber = attempt + 1;
    const attemptStartedAt = Date.now();
    console.info(`[question-generation] Gemini attempt=${attemptNumber} started model=${input.model} topicId=${input.topicId}`);
    try {
      const response = await ai.models.generateContent({
        model: input.model,
        contents: makePrompt(input),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(generatedQuestionSchema),
          temperature: 0.8
        }
      });
      if (!response.text) throw new GenerationError("EMPTY_RESPONSE", "Gemini returned no question", 502);
      const parsed = generatedQuestionSchema.parse(JSON.parse(response.text));
      validateQuestionQuality(parsed, input.avoidSignatures);
      const randomized = shuffleQuestionOptions(parsed);
      console.info(`[question-generation] Gemini attempt=${attemptNumber} completed durationMs=${Date.now() - attemptStartedAt}`);
      return {
        ...randomized,
        id: crypto.randomUUID(),
        topicId: topic.id,
        topicTitle: topic.title,
        category: topic.category,
        model: input.model,
        generatedAt: new Date().toISOString(),
        schemaVersion: 1,
        optionOrderVersion: 1
      };
    } catch (error) {
      lastError = error;
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
