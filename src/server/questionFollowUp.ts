import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { clinicalQuestionSchema } from "../lib/contracts.js";
import { GenerationError, MODEL_OPTIONS } from "./questionGeneration.js";

const chatMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), text: z.string().trim().min(1).max(2_000) }),
  z.object({ role: z.literal("assistant"), text: z.string().trim().min(1) })
]);

export const followUpRequestSchema = z.object({
  model: z.string(),
  question: z.object({
    vignette: clinicalQuestionSchema.shape.vignette,
    stem: clinicalQuestionSchema.shape.stem,
    options: z.array(clinicalQuestionSchema.shape.options.element.pick({ id: true, text: true })).length(5)
  }),
  messages: z.array(chatMessageSchema).min(1).max(10)
}).superRefine((value, context) => {
  if (value.messages.at(-1)?.role !== "user") {
    context.addIssue({ code: "custom", path: ["messages"], message: "The final message must be from the user" });
  }
  if (!MODEL_OPTIONS.some((model) => model.id === value.model)) {
    context.addIssue({ code: "custom", path: ["model"], message: "Model is not allowed" });
  }
});

const SYSTEM_INSTRUCTION = `Answer follow-up questions about the supplied medical exam vignette, question, and answer options. Use plain text without Markdown formatting. Be concise by default, using short paragraphs, and provide more detail when asked. Explain clinical reasoning at a graduating medical student level. If uncertain, say so. Do not invent citations. This is educational, not patient-specific medical advice.`;

function redactProviderMessage(message: string, apiKey: string): string {
  return message.replaceAll(apiKey, "[REDACTED]")
    .replace(/(["']?(?:api[-_]?key|access[-_]?token|token|authorization|x-goog-api-key)["']?\s*:\s*)(["'])(.*?)\2/gi, "$1$2[REDACTED]$2")
    .replace(/([?&](?:api[-_]?key|key|token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(x-goog-api-key\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]");
}

export async function answerQuestionFollowUp(rawInput: unknown, apiKey = process.env.GEMINI_API_KEY): Promise<string> {
  if (!apiKey) throw new GenerationError("MISSING_API_KEY", "GEMINI_API_KEY is not configured", 503);
  const input = followUpRequestSchema.parse(rawInput);
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: input.model,
      contents: [
        { role: "user", parts: [{ text: `Vignette:\n${input.question.vignette}\n\nQuestion:\n${input.question.stem}\n\nOptions:\n${input.question.options.map(({ id, text }) => `${id}. ${text}`).join("\n")}` }] },
        ...input.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.text }]
        }))
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ googleSearch: {} }, { codeExecution: {} }],
        temperature: 0.3,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        httpOptions: { retryOptions: { attempts: 1 } }
      }
    });
    if (!response.text?.trim()) throw new GenerationError("EMPTY_RESPONSE", "Gemini returned no answer", 502);
    return response.text.trim();
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    const details = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
    const nested = typeof details.error === "object" && details.error !== null ? details.error as Record<string, unknown> : {};
    const rawMessage = typeof details.message === "string" ? details.message
      : typeof nested.message === "string" ? nested.message
      : typeof error === "string" ? error : "Follow-up failed";
    const message = redactProviderMessage(rawMessage, apiKey);
    const rawStatus = details.status ?? details.statusCode ?? nested.code;
    const status = typeof rawStatus === "number" && Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : undefined;
    const quota = status === 429 || /429|resource_exhausted|quota/i.test(message);
    const rawCode = nested.status ?? details.code;
    const code = typeof rawCode === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode)
      ? rawCode : quota ? "QUOTA_EXHAUSTED" : "FOLLOW_UP_FAILED";
    throw new GenerationError(code, message, status ?? (quota ? 429 : 502));
  }
}
