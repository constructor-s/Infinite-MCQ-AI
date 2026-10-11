import { ZodError } from "zod";
import { answerQuestionFollowUp } from "../../src/server/questionFollowUp";
import { GenerationError } from "../../src/server/questionGeneration";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } }, { status: 405 });
  }
  try {
    const answer = await answerQuestionFollowUp(await request.json());
    return Response.json({ answer }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid follow-up request" } }, { status: 400 });
    }
    if (error instanceof GenerationError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Unable to answer the follow-up" } }, { status: 500 });
  }
}
