import { ZodError } from "zod";
import { generateQuestion, GenerationError } from "../../src/server/questionGeneration";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } }, { status: 405 });
  }
  try {
    const body = await request.json();
    const question = await generateQuestion(body);
    return Response.json(question, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid generation request" } }, { status: 400 });
    }
    if (error instanceof GenerationError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Unable to generate a question" } }, { status: 500 });
  }
}
