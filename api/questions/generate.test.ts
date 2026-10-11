import { afterEach, describe, expect, it } from "vitest";
import { fetch as handler } from "./generate";

const originalKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

describe("POST /api/questions/generate", () => {
  it("rejects unsupported methods", async () => {
    const response = await handler(new Request("http://localhost/api/questions/generate", { method: "GET" }));
    expect(response.status).toBe(405);
  });

  it("returns an actionable error when the server key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const response = await handler(new Request("http://localhost/api/questions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId: "cardio.acs", model: "gemini-3.5-flash-lite", difficulty: 3, avoidSignatures: [] })
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MISSING_API_KEY" } });
  });
});
