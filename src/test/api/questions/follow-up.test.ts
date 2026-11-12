import { afterEach, describe, expect, it } from "vitest";
import { makeQuestion } from "../../fixtures.js";
import { fetch as handler } from "../../../../api/questions/follow-up.js";

const originalKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

describe("POST /api/questions/follow-up", () => {
  it("rejects unsupported methods", async () => {
    const response = await handler(new Request("http://localhost/api/questions/follow-up", { method: "GET" }));
    expect(response.status).toBe(405);
  });

  it("returns an actionable error when the server key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const response = await handler(new Request("http://localhost/api/questions/follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: makeQuestion(), messages: [{ role: "user", text: "Why is this urgent?" }] })
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MISSING_API_KEY" } });
  });
});
