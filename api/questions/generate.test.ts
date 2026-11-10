import { afterEach, describe, expect, it } from "vitest";
import { fetch as handler, generationErrorResponse, generationSuccessResponse } from "./generate";
import { GenerationError } from "../../src/server/questionGeneration";
import type { QuestionGenerationDiagnostic, QuestionQualityWarning } from "../../src/lib/contracts";
import { makeQuestion } from "../../src/test/fixtures";

const originalKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

describe("POST /api/questions/generate", () => {
  it("returns QC warnings beside the successful question", async () => {
    const question = makeQuestion();
    const warning: QuestionQualityWarning = {
      requestId: "request-id", stage: "refinement", category: "quality", code: "BLUEPRINT_MISMATCH",
      issues: [{ path: [], code: "BLUEPRINT_MISMATCH", message: "The stem must directly test risk_stratification." }],
      issueCount: 1, truncated: false
    };
    const response = generationSuccessResponse(question, [warning]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ...question, qualityWarnings: [warning] });
  });

  it("returns the same sanitized validation diagnostic attached to a generation error", async () => {
    const diagnostic: QuestionGenerationDiagnostic & { requestId: string } = {
      requestId: "request-id", stage: "refinement", category: "schema", code: "INVALID_REFINEMENT",
      issues: [{ path: ["distractors", 0, "hint"], code: "too_small", message: "Too small: expected string to have >=15 characters" }],
      issueCount: 1, truncated: false
    };
    const response = generationErrorResponse(new GenerationError("INVALID_REFINEMENT", "INVALID_REFINEMENT", 502, diagnostic));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: {
      code: "INVALID_REFINEMENT", message: "INVALID_REFINEMENT", diagnostic
    } });
  });

  it("rejects unsupported methods", async () => {
    const response = await handler(new Request("http://localhost/api/questions/generate", { method: "GET" }));
    expect(response.status).toBe(405);
  });

  it("returns an actionable error when the server key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const response = await handler(new Request("http://localhost/api/questions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId: "cardio.acs", model: "gemini-3.5-flash-lite", avoidSignatures: [] })
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MISSING_API_KEY" } });
  });
});
