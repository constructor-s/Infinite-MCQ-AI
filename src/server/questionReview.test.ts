import { describe, expect, it } from "vitest";
import { clinicalReviewSchema, editorialReviewSchema, reviewIssues, type ClinicalReview, type EditorialReview } from "./questionReview";
import { makeQuestion } from "../test/fixtures";

function reviews(): { clinical: ClinicalReview; editorial: EditorialReview } {
  const pass = { status: "pass", evidence: "Explicit supplied findings distinguish the alternatives.", correction: "" };
  return {
    clinical: clinicalReviewSchema.parse({
      answerId: "A", strongestDistractorId: "B", distractorAppeal: "A similar presentation could fit B.",
      decisiveCaseFact: "The supplied ECG identifies an urgent vascular presentation.",
      verificationCategory: "none", references: [],
      criteria: Object.fromEntries(Object.keys(clinicalReviewSchema.shape.criteria.shape).map((key) => [key, pass]))
    }),
    editorial: editorialReviewSchema.parse({
      criteria: Object.fromEntries(Object.keys(editorialReviewSchema.shape.criteria.shape).map((key) => [key, pass])),
      polish: { status: "fail", evidence: "A sentence could be shorter.", correction: "Optional trim." }
    })
  };
}

describe("semantic acceptance gate", () => {
  it("requires an independently agreed key and a different strong distractor", () => {
    const { clinical, editorial } = reviews();
    expect(reviewIssues(makeQuestion(), clinical, editorial)).toEqual([]);
    clinical.answerId = null;
    expect(reviewIssues(makeQuestion(), clinical, editorial)).toContain("clinical.answerDisagreement");
    clinical.answerId = "B";
    expect(reviewIssues(makeQuestion(), clinical, editorial)).toContain("clinical.missingStrongDistractor");
  });

  it("rejects ambiguity, topic drift and giveaway wording while allowing advisory polish", () => {
    const { clinical, editorial } = reviews();
    clinical.criteria.singleBestAnswer.status = "uncertain";
    clinical.criteria.topicAlignment.status = "fail";
    editorial.criteria.noAnswerGiveaways.status = "fail";
    const issues = reviewIssues(makeQuestion(), clinical, editorial);
    expect(issues).toEqual(["clinical.topicAlignment", "clinical.singleBestAnswer", "editorial.noAnswerGiveaways"]);
  });

  it("requires real retrieved references for a source-sensitive clinical claim", () => {
    const { clinical, editorial } = reviews();
    clinical.verificationCategory = "jurisdiction";
    clinical.references = [{ chunkIndex: 0, supportedClaim: "The specified jurisdiction requires reporting under these circumstances." }];
    expect(reviewIssues(makeQuestion(), clinical, editorial)).toContain("clinical.missingVerification");
    const grounding = { webSearchQueries: ["official regulator reporting requirements"], groundingChunks: [{ web: { uri: "https://www.cpso.on.ca/", title: "Official guidance" } }] };
    expect(reviewIssues(makeQuestion(), clinical, editorial, grounding)).toEqual([]);
    clinical.references[0].chunkIndex = 99;
    expect(reviewIssues(makeQuestion(), clinical, editorial, grounding)).toContain("clinical.unresolvedReference");
  });

  it("rejects incomplete reviews instead of treating omitted checks as passed", () => {
    const { clinical } = reviews();
    const incomplete = structuredClone(clinical) as Record<string, unknown>;
    incomplete.criteria = { clinicalAccuracy: clinical.criteria.clinicalAccuracy };
    expect(clinicalReviewSchema.safeParse(incomplete).success).toBe(false);
  });
});
