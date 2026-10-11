import { afterEach, describe, expect, it } from "vitest";
import { fetch as handler } from "./models";

const originalKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

describe("GET /api/models", () => {
  it("rejects unsupported methods", async () => {
    const response = await handler(new Request("http://localhost/api/models", { method: "POST" }));
    expect(response.status).toBe(405);
  });

  it("returns an actionable error when the server key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const response = await handler(new Request("http://localhost/api/models"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MISSING_API_KEY" } });
  });
});
