import { describe, expect, it } from "vitest";
import { z } from "zod";
import { makeQuestion } from "../test/fixtures";
import { optionLengthIssue, optionLengthMetrics } from "./questionOptions";
import { reviewFindings } from "./questionReview";
import { questionDraftSchema, readQuestionDraft, refinementSchema, readRefinedQuestion, questionCoreContent, changedQuestionFields } from "./questionDraft";
import emptyTeaching from "../test/fixtures/correct-option-empty-teaching.json";
import regression from "../test/fixtures/long-capacity-answer.json";
import { generatedQuestionSchema } from "../lib/contracts";

function withLengths(key: number, distractors: number[]) {
  const question = makeQuestion();
  [key, ...distractors].forEach((count, index) => { question.options[index].text = Array(count).fill(`word${index}`).join(" "); });
  return question;
}

describe("option length and lean/final schemas", () => {
  it("flags the supplied failure even without either reviewer", () => {
    const question = generatedQuestionSchema.parse(regression.question);
    expect(optionLengthIssue(question)).toContain("23 words; the distractor median is 18");
    expect(optionLengthMetrics(question)).toMatchObject({ correctWords: 23, distractorMedianWords: 18, maximumKeyWords: 19, exceedsLimit: true,
      optionWords: [{ id: "A", words: 18 }, { id: "B", words: 14 }, { id: "C", words: 23 }, { id: "D", words: 19 }, { id: "E", words: 18 }] });
    expect(reviewFindings(question)).toMatchObject({ hasLengthGiveaway: true, hasCorrectnessDefect: false,
      corrections: [expect.objectContaining({ kind: "answer_giveaway", reviewer: "construction" })] });
  });

  it("uses the four distractors' median and accepts exactly 10%", () => {
    expect(optionLengthIssue(withLengths(11, [2, 9, 11, 30]))).toBeUndefined();
    expect(optionLengthIssue(withLengths(12, [2, 9, 11, 30]))).toContain("at most 11 words");
    expect(optionLengthIssue(withLengths(6, [5, 5, 6, 20]))).toBeUndefined();
  });

  it("exempts keys of at most five words but checks six words", () => {
    expect(optionLengthIssue(withLengths(5, [1, 1, 1, 1]))).toBeUndefined();
    expect(optionLengthMetrics(withLengths(5, [1, 1, 1, 1]))).toMatchObject({ maximumKeyWords: 5, exceedsLimit: false });
    expect(optionLengthIssue(withLengths(6, [1, 1, 1, 1]))).toBeDefined();
  });

  it("ignores surrounding/multiple whitespace and treats hyphenated terms as one word", () => {
    const question = withLengths(6, [6, 6, 6, 6]);
    question.options[0].text = "  decision-specific\tconsent\nrequires  assessment of understanding  ";
    expect(optionLengthIssue(question)).toBeUndefined();
  });

  it("validates the four-field draft and assigns IDs without teaching", () => {
    const question = makeQuestion();
    const content = questionCoreContent(question);
    const core = readQuestionDraft(content, question.blueprint);
    expect(Object.keys(content).sort()).toEqual(["correctIndex", "options", "stem", "vignette"]);
    expect(core.options.map(({ id }) => id)).toEqual(["A", "B", "C", "D", "E"]);
    expect(core.options.every((option) => Object.keys(option).sort().join() === "id,text")).toBe(true);
    expect(core.blueprint).toEqual(question.blueprint);
    expect(core.correctOptionId).toBe("A");
    for (const invalid of [-1, 5, 1.5]) expect(questionDraftSchema.safeParse({ ...content, correctIndex: invalid }).success).toBe(false);
    expect(questionDraftSchema.safeParse({ ...content, options: content.options.slice(0, 4) }).success).toBe(false);
    expect(questionDraftSchema.safeParse({ ...content, options: ["same", " SAME ", "three", "four", "five"] }).success).toBe(false);
    expect(questionDraftSchema.safeParse({ ...content, shortExplanation: question.shortExplanation }).success).toBe(false);
  });

  function finalContent(): z.input<typeof refinementSchema> {
    const question = makeQuestion();
    return { ...questionCoreContent(question), options: question.options.map((option, index) => index === 0
      ? { text: option.text } : { text: option.text, hint: option.hint, explanation: option.explanation }),
      shortExplanation: question.shortExplanation, highYieldPearl: question.highYieldPearl, vignetteSignature: question.vignetteSignature };
  }

  it("requires a complete final question and teaching for every distractor", () => {
    const content = finalContent();
    expect(refinementSchema.safeParse(content).success).toBe(true);
    for (const field of ["hint", "explanation"] as const) {
      const invalid = structuredClone(content);
      delete invalid.options[1][field];
      expect(refinementSchema.safeParse(invalid).success).toBe(false);
    }
    expect(refinementSchema.safeParse({ edits: {}, summary: "Preserved." }).success).toBe(false);
    expect(refinementSchema.safeParse({ ...content, blueprint: makeQuestion().blueprint }).success).toBe(false);
    expect(refinementSchema.safeParse({ ...content, summary: "Preserved." }).success).toBe(false);
    expect(refinementSchema.safeParse({ ...content, options: Array(5).fill(content.options[1]) }).success).toBe(false);
    expect(refinementSchema.safeParse({ ...content, correctIndex: 5 }).success).toBe(false);
  });

  it.each([undefined, "", null, "Unneeded provider teaching must be ignored."])("ignores correct-option teaching placeholders: %s", (placeholder) => {
    const content = finalContent();
    content.options[content.correctIndex].hint = placeholder;
    content.options[content.correctIndex].explanation = placeholder;
    const normalized = readRefinedQuestion(content, makeQuestion().blueprint);
    const correct = normalized.options.find(({ id }) => id === normalized.correctOptionId)!;
    expect(correct.explanation).toBe(content.shortExplanation);
    expect(correct.hint).toBe("Consider how the case findings support this choice.");
    expect(generatedQuestionSchema.safeParse(normalized).success).toBe(true);
  });

  it.each(["hint", "explanation"] as const)("still rejects incomplete distractor %s", (field) => {
    for (const invalid of [undefined, null, "", "too short"]) {
      const content = finalContent();
      content.options[1][field] = invalid;
      const result = refinementSchema.safeParse(content);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["options", 1, field] }));
    }
  });

  it("transmits optional string-or-null teaching fields while retaining runtime distractor checks", () => {
    const schema = z.toJSONSchema(refinementSchema);
    const option = (schema.properties!.options as { items: { required: string[]; properties: Record<string, { type: string[] }> } }).items;
    expect(option.required).toEqual(["text"]);
    for (const field of ["hint", "explanation"]) {
      expect(option.properties[field].type).toEqual(expect.arrayContaining(["string", "null"]));
    }
  });

  it.each(emptyTeaching.responses)("replays the exact failed response $requestId without model calls", ({ response }) => {
    // Original assignment tags were not in the log. These test tags exercise
    // normalization only; this fixture does not validate clinical alignment.
    const normalized = readRefinedQuestion(response, makeQuestion().blueprint);
    expect(normalized.vignette).toBe(response.vignette);
    expect(normalized.stem).toBe(response.stem);
    expect(normalized.options.map(({ text }) => text)).toEqual(response.options.map(({ text }) => text));
    const correct = normalized.options[response.correctIndex];
    expect(correct.id).toBe(normalized.correctOptionId);
    expect(correct.explanation).toBe(response.shortExplanation);
    expect(correct.hint).toBe("Consider how the case findings support this choice.");
    expect(response.options[response.correctIndex].hint).toBe("");
    expect(response.options[response.correctIndex].explanation).toBe("");
    expect(optionLengthIssue(normalized)).toBeUndefined();
    expect(generatedQuestionSchema.safeParse(normalized).success).toBe(true);
  });

  it("reuses the main explanation and returns the unchanged public contract", () => {
    const content = finalContent();
    const question = readRefinedQuestion(content, makeQuestion().blueprint);
    expect(question.options[0].explanation).toBe(content.shortExplanation);
    expect(question.options[0].hint).toBe("Consider how the case findings support this choice.");
    expect(generatedQuestionSchema.safeParse(question).success).toBe(true);
    expect(question.options[1]).toMatchObject(content.options[1]);
  });

  it("compares core content rather than new teaching or signatures", () => {
    const question = makeQuestion();
    const core = readQuestionDraft(questionCoreContent(question), question.blueprint);
    expect(changedQuestionFields(core, question)).toEqual([]);
    expect(changedQuestionFields(core, { ...question, stem: "Which treatment is the best initial choice?", correctOptionId: "B" })).toEqual(["stem", "correctIndex"]);
    expect(changedQuestionFields(core, { ...question, options: question.options.map((option, index) => index === 1 ? { ...option, text: "Different investigation" } : option) })).toEqual(["options"]);
  });
});
