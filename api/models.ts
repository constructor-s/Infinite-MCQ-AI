import { GoogleGenAI } from "@google/genai";
import { MODEL_OPTIONS } from "../src/server/questionGeneration.js";

export async function fetch(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET" } }, { status: 405 });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: { code: "MISSING_API_KEY", message: "GEMINI_API_KEY is not configured" } }, { status: 503 });
  }
  try {
    const ai = new GoogleGenAI({ apiKey });
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const availableIds = new Set<string>();
    for await (const model of pager) {
      if (model.name) availableIds.add(model.name.replace(/^models\//, ""));
    }
    return Response.json({
      models: MODEL_OPTIONS.map((model) => ({ ...model, available: availableIds.has(model.id) }))
    }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return Response.json({
      models: MODEL_OPTIONS.map((model) => ({ ...model, available: true })),
      availabilityUnverified: true
    });
  }
}
