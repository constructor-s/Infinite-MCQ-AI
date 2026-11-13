import { afterEach, describe, expect, it, vi } from "vitest";
import { makeQuestion } from "../../fixtures.js";
import { fetch as handler } from "../../../../api/questions/follow-up.js";

const originalKey = process.env.GEMINI_API_KEY;
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async () => ({ ...await vi.importActual("@google/genai"), GoogleGenAI: class { models = { generateContent }; } }));

function request(messages = [{ role: "user", text: "Why is this urgent?" }], model = "gemini-3.8-flash") {
  const { vignette, stem, options } = makeQuestion();
  return new Request("http://localhost/api/questions/follow-up", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, question: { vignette, stem, options: options.map(({ id, text }) => ({ id, text })) }, messages })
  });
}

afterEach(() => {
  generateContent.mockReset();
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
    const response = await handler(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MISSING_API_KEY" } });
  });

  it("accepts long assistant history and preserves the plain-text success response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    generateContent.mockResolvedValue({ text: "A concise answer.\n\nWith another paragraph." });
    const response = await handler(request([
      { role: "user", text: "Why?" }, { role: "assistant", text: "Long explanation. ".repeat(500) },
      { role: "user", text: "Explain more." }
    ]));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ answer: "A concise answer.\n\nWith another paragraph." });
    expect(generateContent.mock.calls[0][0].contents[2].parts[0].text).toHaveLength(8999);
  });

  it.each([
    { messages: [{ role: "user", text: "x".repeat(2001) }] },
    { messages: [{ role: "assistant", text: "An answer." }] },
    { model: "not-allowed" }
  ])("rejects invalid requests without calling the provider: %o", async ({ messages, model }) => {
    process.env.GEMINI_API_KEY = "test-key";
    const response = await handler(request(messages, model));
    expect(response.status).toBe(400);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it.each([429, 503])("preserves provider error details and status %s while redacting credentials", async (status) => {
    process.env.GEMINI_API_KEY = "test-secret-key";
    generateContent.mockRejectedValue(Object.assign(new Error("Provider unavailable: test-secret-key https://example.test/?key=another-secret Authorization: Bearer bearer-secret"), { status }));
    const response = await handler(request());
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error.message).toBe("Provider unavailable: [REDACTED] https://example.test/?key=[REDACTED] Authorization: Bearer [REDACTED]");
    expect(body.error.code).toBe(status === 429 ? "QUOTA_EXHAUSTED" : "FOLLOW_UP_FAILED");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
