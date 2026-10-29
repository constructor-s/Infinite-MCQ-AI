import { describe, expect, it } from "vitest";
import { historyEncounterId, parseQuestionRoute, questionUrl } from "./questionNavigation";

describe("question URLs", () => {
  it("recognizes root and UUID question paths", () => {
    const id = "b6a68648-c18e-47eb-8083-b6072fe64fff";
    expect(parseQuestionRoute("/")).toEqual({ kind: "home" });
    expect(questionUrl(id)).toBe(`/questions/${id}`);
    expect(parseQuestionRoute(`/questions/${id.toUpperCase()}/`)).toEqual({ kind: "question", questionId: id });
    for (const path of ["/questions/", "/questions/not-a-uuid", `/questions/${id}/extra`, "/other", "/questions/%ZZ"]) {
      expect(parseQuestionRoute(path)).toEqual({ kind: "unavailable" });
    }
  });

  it("ignores unrelated or invalid history state", () => {
    for (const state of [null, undefined, "encounter", {}, { iworldEncounterId: 12 }]) {
      expect(historyEncounterId(state)).toBeUndefined();
    }
    expect(historyEncounterId({ iworldEncounterId: "encounter" })).toBe("encounter");
  });
});
