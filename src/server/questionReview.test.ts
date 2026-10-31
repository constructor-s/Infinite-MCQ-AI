import { describe, expect, it } from "vitest";
import { clinicalReviewSchema, editorialReviewSchema, reviewFindings, type ClinicalReview, type EditorialReview } from "./questionReview";
import { makeQuestion } from "../test/fixtures";

function reviews(): { clinical: ClinicalReview; editorial: EditorialReview } {
  return {
    clinical: { answerId: "A", strongestDistractorId: "B", decisiveCaseFact: "The supplied ECG distinguishes the choices.", corrections: [], advisories: [] },
    editorial: { corrections: [], advisories: ["A sentence could be shorter."] }
  };
}

describe("lenient review findings", () => {
  it("keeps disagreement and a missing strong distractor advisory", () => {
    const { clinical, editorial } = reviews();
    clinical.answerId = "B";
    const findings = reviewFindings(makeQuestion(), clinical, editorial);
    expect(findings.corrections).toEqual([]);
    expect(findings.hasCorrectnessDefect).toBe(false);
    expect(findings.advisories).toHaveLength(3);
  });

  it("distinguishes demonstrated correctness defects from editorial improvement", () => {
    const { clinical, editorial } = reviews();
    editorial.corrections.push({ kind: "answer_giveaway", evidence: "One choice bundles uniquely comprehensive care.", correction: "Compare equivalent dispositions." });
    expect(reviewFindings(makeQuestion(), clinical, editorial).hasCorrectnessDefect).toBe(false);
    clinical.corrections.push({ kind: "ambiguity", evidence: "Two choices fit all supplied facts with no priority.", correction: "Supply the decisive timing fact." });
    expect(reviewFindings(makeQuestion(), clinical, editorial).hasCorrectnessDefect).toBe(true);
  });

  it("requires no citation or verification fields, and ignores legacy reference gaps", () => {
    const { clinical, editorial } = reviews();
    const parsed = clinicalReviewSchema.parse({ ...clinical, verificationCategory: "jurisdiction", references: [{ chunkIndex: 999 }] });
    expect(parsed).not.toHaveProperty("references");
    expect(parsed).not.toHaveProperty("verificationCategory");
    expect(reviewFindings(makeQuestion(), parsed, editorial).corrections).toEqual([]);
  });

  it("requires explicit, actionable corrections but tolerates unavailable reviewers", () => {
    expect(editorialReviewSchema.safeParse({ corrections: [{ kind: "clinical_error", evidence: "", correction: "" }], advisories: [] }).success).toBe(false);
    expect(clinicalReviewSchema.safeParse({}).success).toBe(false);
    expect(reviewFindings(makeQuestion()).corrections).toEqual([]);
  });
});
