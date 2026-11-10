import { describe, expect, it } from "vitest";
import { clinicalReviewSchema, readClinicalReview, reviewFindings, CLINICAL_REVIEW_INSTRUCTION, type ClinicalReview } from "./questionReview";
import { draftContent } from "../test/questionContent";
import { makeQuestion } from "../test/fixtures";

function review(): ClinicalReview {
  return {
    independentAnswerText: makeQuestion().options[0].text,
    choiceStatus: "matched",
    answerText: makeQuestion().options[0].text,
    strongestAlternativeText: makeQuestion().options[1].text,
    decisiveCaseFact: "The supplied ECG distinguishes the choices.",
    calculation: null,
    corrections: [],
    advisories: []
  };
}

describe("clinical review findings", () => {
  it("keeps disagreement and a missing strong distractor advisory", () => {
    const clinical = review();
    clinical.answerText = makeQuestion().options[1].text;
    const findings = reviewFindings(draftContent(makeQuestion()), clinical);
    expect(findings.corrections).toEqual([]);
    expect(findings.hasCorrectnessDefect).toBe(false);
    expect(findings.advisories).toHaveLength(2);
  });

  it("distinguishes demonstrated correctness defects from answer giveaways", () => {
    const clinical = review();
    clinical.corrections.push({ kind: "answer_giveaway", evidence: "One choice bundles uniquely comprehensive care.", correction: "Compare equivalent dispositions." });
    expect(reviewFindings(draftContent(makeQuestion()), clinical).hasCorrectnessDefect).toBe(false);
    clinical.corrections.push({ kind: "ambiguity", evidence: "Two choices fit all supplied facts with no priority.", correction: "Supply the decisive timing fact." });
    expect(reviewFindings(draftContent(makeQuestion()), clinical).hasCorrectnessDefect).toBe(true);
  });

  it("accepts only verbatim choices or null and rejects legacy fields", () => {
    const clinical = review();
    const choices = [clinical.answerText!, clinical.strongestAlternativeText!];
    expect(readClinicalReview(clinical, choices)).toEqual(clinical);
    expect(readClinicalReview({ ...clinical, independentAnswerText: null, choiceStatus: "uncertain", answerText: null, strongestAlternativeText: null }, choices).answerText).toBeNull();
    for (const field of ["answerText", "strongestAlternativeText"] as const) {
      for (const invalid of ["Unknown selection", clinical[field]!.toUpperCase(), clinical[field]! + " "]) {
        expect(() => readClinicalReview({ ...clinical, [field]: invalid }, choices)).toThrow(/exactly match/);
      }
    }
    expect(clinicalReviewSchema.safeParse({ ...clinical, answerId: "A" }).success).toBe(false);
    expect(clinicalReviewSchema.safeParse({ ...clinical, strongestDistractorId: "B" }).success).toBe(false);
  });

  it("requires complete structured calculation details or null", () => {
    const clinical = review();
    expect(clinicalReviewSchema.safeParse(clinical).success).toBe(true);
    expect(clinicalReviewSchema.safeParse({ ...clinical, calculation: { formula: "PPV", substitution: "160/200", result: "80%" } }).success).toBe(true);
    for (const calculation of [
      { formula: "PPV", substitution: "160/200" },
      { formula: "", substitution: "160/200", result: "80%" },
      { formula: "PPV", substitution: "160/200", result: "80%", extra: true }
    ]) {
      expect(clinicalReviewSchema.safeParse({ ...clinical, calculation }).success).toBe(false);
    }
  });

  it("distinguishes an independently solved answer, a matched option, no defensible option, and uncertainty", () => {
    const clinical = review();
    const choices = [clinical.answerText!, clinical.strongestAlternativeText!];
    expect(readClinicalReview(clinical, choices)).toMatchObject({
      independentAnswerText: clinical.answerText, choiceStatus: "matched", answerText: clinical.answerText
    });

    const noneDefensible = {
      ...clinical,
      independentAnswerText: "A treatment not present among the choices",
      choiceStatus: "none_defensible" as const,
      answerText: null,
      corrections: [{ kind: "clinical_error" as const, evidence: "No choice offers the indicated treatment.", correction: "Add the independently solved treatment as the key." }]
    };
    expect(readClinicalReview(noneDefensible, choices)).toMatchObject({
      choiceStatus: "none_defensible", independentAnswerText: "A treatment not present among the choices", answerText: null
    });
    expect(reviewFindings(draftContent(makeQuestion()), noneDefensible).hasCorrectnessDefect).toBe(true);
    expect(clinicalReviewSchema.safeParse({ ...noneDefensible, corrections: [] }).success).toBe(false);
    expect(clinicalReviewSchema.safeParse({ ...noneDefensible, answerText: choices[0] }).success).toBe(false);
    expect(clinicalReviewSchema.safeParse({ ...noneDefensible, independentAnswerText: null }).success).toBe(false);

    const uncertain = { ...clinical, independentAnswerText: null, choiceStatus: "uncertain" as const, answerText: null };
    expect(readClinicalReview(uncertain, choices)).toMatchObject({ choiceStatus: "uncertain", answerText: null });
    expect(clinicalReviewSchema.safeParse({ ...uncertain, answerText: choices[0] }).success).toBe(false);
  });

  it("asks the single reviewer to check distractors and calculate material arithmetic", () => {
    expect(CLINICAL_REVIEW_INSTRUCTION).toContain("First solve the vignette and stem without using the options");
    expect(CLINICAL_REVIEW_INSTRUCTION).toContain("none_defensible");
    expect(CLINICAL_REVIEW_INSTRUCTION).toContain("as if the vignette were hidden");
    expect(CLINICAL_REVIEW_INSTRUCTION).toContain("use Python to calculate");
    expect(CLINICAL_REVIEW_INSTRUCTION).toContain("answer_giveaway");
    expect(CLINICAL_REVIEW_INSTRUCTION).toContain("Return empty corrections and advisories");
    expect(CLINICAL_REVIEW_INSTRUCTION).toContain("Do not put praise");
  });

  it("requires explicit, actionable corrections and tolerates an unavailable reviewer", () => {
    expect(clinicalReviewSchema.safeParse({ corrections: [{ kind: "clinical_error", evidence: "", correction: "" }], advisories: [] }).success).toBe(false);
    expect(clinicalReviewSchema.safeParse({}).success).toBe(false);
    expect(reviewFindings(draftContent(makeQuestion())).corrections).toEqual([]);
  });
});
