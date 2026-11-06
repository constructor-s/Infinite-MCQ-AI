import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { clinicalQuestionSchema } from "../lib/contracts.js";
import { GenerationError, MODEL_OPTIONS } from "./questionGeneration.js";

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(2_000)
});

export const followUpRequestSchema = z.object({
  question: clinicalQuestionSchema,
  messages: z.array(chatMessageSchema).min(1).max(10)
}).superRefine((value, context) => {
  if (value.messages.at(-1)?.role !== "user") {
    context.addIssue({ code: "custom", path: ["messages"], message: "The final message must be from the user" });
  }
  if (!MODEL_OPTIONS.some((model) => model.id === value.question.model)) {
    context.addIssue({ code: "custom", path: ["question", "model"], message: "Model is not allowed" });
  }
});

const SYSTEM_INSTRUCTION = `Answer concise follow-up questions about the supplied medical exam question. Use the vignette, answer, rationale, and options as context. Explain clinical reasoning at a graduating medical student level. If uncertain, say so. Do not invent citations. This is educational, not patient-specific medical advice.`;

function makeContext(question: z.infer<typeof clinicalQuestionSchema>): string {
  return JSON.stringify({
    vignette: question.vignette,
    stem: question.stem,
    options: question.options.map(({ id, text, explanation }) => ({ id, text, explanation })),
    correctOptionId: question.correctOptionId,
    pearl: question.highYieldPearl
  });
}

export async function answerQuestionFollowUp(rawInput: unknown, apiKey = process.env.GEMINI_API_KEY): Promise<string> {
  if (!apiKey) throw new GenerationError("MISSING_API_KEY", "GEMINI_API_KEY is not configured", 503);
  const input = followUpRequestSchema.parse(rawInput);
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: input.question.model,
      contents: [
        { role: "user", parts: [{ text: `Question context:\n${makeContext(input.question)}` }] },
        { role: "model", parts: [{ text: "Understood. Ask a follow-up about this question." }] },
        ...input.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.text }]
        }))
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ codeExecution: {} }],
        temperature: 0.3,
        maxOutputTokens: 700
      }
    });
    if (!response.text?.trim()) throw new GenerationError("EMPTY_RESPONSE", "Gemini returned no answer", 502);
    return response.text.trim();
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    const message = error instanceof Error ? error.message : "Follow-up failed";
    if (/429|resource_exhausted|quota/i.test(message)) {
      throw new GenerationError("QUOTA_EXHAUSTED", "Gemini free-tier quota is temporarily exhausted", 429);
    }
    throw new GenerationError("FOLLOW_UP_FAILED", "Unable to answer the follow-up", 502);
  }
}
