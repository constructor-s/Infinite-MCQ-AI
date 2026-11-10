import { ZodError } from "zod";
import { generateQuestion, GenerationError } from "../../src/server/questionGeneration.js";

export function generationErrorResponse(error: GenerationError): Response {
  return Response.json({ error: { code: error.code, message: error.message,
    ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}) } }, { status: error.status });
}

export async function fetch(request: Request): Promise<Response> {
  const startedAt = Date.now();
  console.info("[question-generation] request started");
  if (request.method !== "POST") {
    console.warn(`[question-generation] request rejected code=METHOD_NOT_ALLOWED durationMs=${Date.now() - startedAt}`);
    return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } }, { status: 405 });
  }
  try {
    const body = await request.json();
    const question = await generateQuestion(body, undefined, { signal: request.signal });
    console.info(`[question-generation] request completed status=200 durationMs=${Date.now() - startedAt}`);
    return Response.json(question, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) {
      console.warn(`[question-generation] request failed code=INVALID_REQUEST durationMs=${Date.now() - startedAt}`);
      return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid generation request" } }, { status: 400 });
    }
    if (error instanceof GenerationError) {
      console.warn(`[question-generation] request failed code=${error.code} durationMs=${Date.now() - startedAt}`);
      return generationErrorResponse(error);
    }
    console.error(`[question-generation] request failed code=INTERNAL_ERROR durationMs=${Date.now() - startedAt}`);
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Unable to generate a question" } }, { status: 500 });
  }
}
