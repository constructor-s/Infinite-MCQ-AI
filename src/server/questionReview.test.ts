import { describe, expect, it } from "vitest";
import { clinicalReviewSchema, readClinicalReview, editorialReviewSchema, reviewFindings, EDITORIAL_EXAMPLES, EDITORIAL_REVIEW_INSTRUCTION, CLINICAL_REVIEW_INSTRUCTION, type ClinicalReview, type EditorialReview } from "./questionReview";
import { draftContent } from "../test/questionContent";
import { makeQuestion } from "../test/fixtures";

function reviews(): { clinical: ClinicalReview; editorial: EditorialReview } {
  return {
    clinical: { answerText: makeQuestion().options[0].text, strongestAlternativeText: makeQuestion().options[1].text, decisiveCaseFact: "The supplied ECG distinguishes the choices.", corrections: [], advisories: [] },
    editorial: { corrections: [], advisories: ["Shorten the vignette's opening sentence without removing the decisive findings."] }
  };
}

describe("lenient review findings", () => {
  it("keeps disagreement and a missing strong distractor advisory", () => {
    const { clinical, editorial } = reviews();
    clinical.answerText = makeQuestion().options[1].text;
    const findings = reviewFindings(draftContent(makeQuestion()), clinical, editorial);
    expect(findings.corrections).toEqual([]);
    expect(findings.hasCorrectnessDefect).toBe(false);
    expect(findings.advisories).toHaveLength(3);
  });

  it("distinguishes demonstrated correctness defects from editorial improvement", () => {
    const { clinical, editorial } = reviews();
    editorial.corrections.push({ kind: "answer_giveaway", evidence: "One choice bundles uniquely comprehensive care.", correction: "Compare equivalent dispositions." });
    expect(reviewFindings(draftContent(makeQuestion()), clinical, editorial).hasCorrectnessDefect).toBe(false);
    clinical.corrections.push({ kind: "ambiguity", evidence: "Two choices fit all supplied facts with no priority.", correction: "Supply the decisive timing fact." });
    expect(reviewFindings(draftContent(makeQuestion()), clinical, editorial).hasCorrectnessDefect).toBe(true);
  });

  it("accepts only verbatim choices or null and rejects legacy fields", () => {
    const { clinical } = reviews();
    const choices = [clinical.answerText!, clinical.strongestAlternativeText!];
    expect(readClinicalReview(clinical, choices)).toEqual(clinical);
    expect(readClinicalReview({ ...clinical, answerText: null, strongestAlternativeText: null }, choices).answerText).toBeNull();
    for (const field of ["answerText", "strongestAlternativeText"] as const) {
      for (const invalid of ["Unknown selection", clinical[field]!.toUpperCase(), clinical[field]! + " "]) {
        expect(() => readClinicalReview({ ...clinical, [field]: invalid }, choices)).toThrow(/exactly match/);
      }
    }
    expect(clinicalReviewSchema.safeParse({ ...clinical, answerId: "A" }).success).toBe(false);
    expect(clinicalReviewSchema.safeParse({ ...clinical, strongestDistractorId: "B" }).success).toBe(false);
  });

  it("keeps a missing or repeated strongest alternative advisory", () => {
    const { clinical } = reviews();
    for (const strongestAlternativeText of [null, clinical.answerText]) {
      expect(reviewFindings(draftContent(makeQuestion()), { ...clinical, strongestAlternativeText }).advisories).toHaveLength(1);
    }
  });

  it("keeps compact semantic near-miss calibration in editorial context", () => {
    // These check calibration context delivery, not the model's medical judgments.
    expect(EDITORIAL_EXAMPLES).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterion: "strongDistractor", verdict: "pass", reason: expect.stringContaining("One changed decision rule") }),
      expect.objectContaining({ criterion: "strongDistractor", verdict: "pass", reason: expect.stringContaining("recognizable interpretation error") }),
      expect.objectContaining({ criterion: "strongDistractor", verdict: "pass", material: expect.stringContaining("hourly wages") })
    ]));
    expect(EDITORIAL_REVIEW_INSTRUCTION).toContain("as if the vignette were hidden");
    expect(EDITORIAL_REVIEW_INSTRUCTION).toContain("do not spend review findings on length arithmetic");
    for (const instruction of [EDITORIAL_REVIEW_INSTRUCTION, CLINICAL_REVIEW_INSTRUCTION]) {
      expect(instruction).toContain("Return empty corrections and advisories");
      expect(instruction).toContain("Do not put praise");
    }
  });

  it("requires explicit, actionable corrections but tolerates unavailable reviewers", () => {
    expect(editorialReviewSchema.safeParse({ corrections: [{ kind: "clinical_error", evidence: "", correction: "" }], advisories: [] }).success).toBe(false);
    expect(clinicalReviewSchema.safeParse({}).success).toBe(false);
    expect(reviewFindings(draftContent(makeQuestion())).corrections).toEqual([]);
  });
});
