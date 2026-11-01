import { describe, expect, it } from "vitest";
import { shuffleValues } from "../lib/shuffleQuestion";
import { z } from "zod";
import { draftContent } from "../test/questionContent";
import { makeQuestion } from "../test/fixtures";
import { optionLengthIssue, optionLengthMetrics } from "./questionOptions";
import { reviewFindings } from "./questionReview";
import { questionDraftSchema, readQuestionDraft, refinementSchema, readRefinedQuestion, questionCoreContent, changedQuestionFields, toGeneratedQuestion } from "./questionDraft";
import emptyTeaching from "../test/fixtures/correct-option-empty-teaching.json";
import regression from "../test/fixtures/long-capacity-answer.json";
import { generatedQuestionSchema } from "../lib/contracts";

function withLengths(key: number, distractors: number[]) {
  const question = makeQuestion();
  [key, ...distractors].forEach((count, index) => { question.options[index].text = Array(count).fill(`word${index}`).join(" "); });
  return draftContent(question);
}

describe("option length and lean/final schemas", () => {
  it("flags the supplied failure even without either reviewer", () => {
    const question = draftContent(generatedQuestionSchema.parse(regression.question));
    expect(optionLengthIssue(question)).toContain("23 words; the distractor median is 18");
    expect(optionLengthMetrics(question)).toMatchObject({ correctWords: 23, distractorMedianWords: 18, maximumKeyWords: 19, exceedsLimit: true,
      distractors: [18, 14, 19, 18].map((words, index) => ({ text: question.distractors[index], words })) });
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
    question.correctAnswer = "  decision-specific\tconsent\nrequires  assessment of understanding  ";
    expect(optionLengthIssue(question)).toBeUndefined();
  });

  it("validates the four-field draft without adding IDs or teaching", () => {
    const question = makeQuestion();
    const content = draftContent(question);
    const core = readQuestionDraft(content);
    expect(Object.keys(content).sort()).toEqual(["correctAnswer", "distractors", "stem", "vignette"]);
    expect(core).toEqual(content);
    expect(core).not.toHaveProperty("blueprint");
    expect(core.distractors.every((text) => typeof text === "string")).toBe(true);
    for (const count of [3, 5]) expect(questionDraftSchema.safeParse({ ...content, distractors: Array(count).fill("Other answer") }).success).toBe(false);
    expect(questionDraftSchema.safeParse({ ...content, distractors: [content.correctAnswer.toUpperCase() + " ", ...content.distractors.slice(1)] }).success).toBe(false);
    expect(questionDraftSchema.safeParse({ ...content, distractors: ["same", " SAME ", "three", "four"] }).success).toBe(false);
    expect(questionDraftSchema.safeParse({ ...content, shortExplanation: question.shortExplanation }).success).toBe(false);
    expect(questionDraftSchema.safeParse({ vignette: content.vignette, stem: content.stem, options: question.options.map(({ text }) => text), correctIndex: 0 }).success).toBe(false);
  });

  function finalContent(): z.input<typeof refinementSchema> {
    const question = makeQuestion();
    return { vignette: question.vignette, stem: question.stem,
      correctAnswer: { text: question.options[0].text, explanation: question.shortExplanation },
      distractors: question.options.slice(1).map(({ text, hint, explanation }) => ({ text, hint, explanation })),
      highYieldPearl: question.highYieldPearl, vignetteSignature: question.vignetteSignature };
  }

  it("requires a complete strict final question with four unique distractors", () => {
    const content = finalContent();
    expect(refinementSchema.safeParse(content).success).toBe(true);
    for (const extra of [{ edits: {}, summary: "Preserved." }, { ...content, blueprint: makeQuestion().blueprint },
      { ...content, summary: "Preserved." }, { ...content, correctIndex: 0 },
      { ...content, correctAnswer: { ...content.correctAnswer, hint: "An unneeded hint." } },
      { ...content, distractors: content.distractors.map((option) => ({ ...option, id: "B" })) }]) {
      expect(refinementSchema.safeParse(extra).success).toBe(false);
    }
    for (const count of [3, 5]) expect(refinementSchema.safeParse({ ...content, distractors: content.distractors.slice(0, count).concat(count === 5 ? [content.distractors[0]] : []) }).success).toBe(false);
    expect(refinementSchema.safeParse({ ...content, distractors: Array(4).fill(content.distractors[0]) }).success).toBe(false);
    expect(refinementSchema.safeParse({ ...content, correctAnswer: { ...content.correctAnswer, text: content.distractors[0].text.toUpperCase() + " " } }).success).toBe(false);
    expect(refinementSchema.safeParse(emptyTeaching.responses[0].response).success).toBe(false);
  });

  it.each(["hint", "explanation"] as const)("rejects incomplete distractor %s", (field) => {
    for (const invalid of [undefined, null, "", "too short"]) {
      const content = finalContent();
      const result = refinementSchema.safeParse({ ...content, distractors: content.distractors.map((option, index) => index === 0 ? { ...option, [field]: invalid } : option) });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["distractors", 0, field] }));
    }
  });

  it("requires the correct answer explanation with the existing main-explanation minimum", () => {
    for (const invalid of [undefined, null, "", "x".repeat(24)]) {
      const content = finalContent();
      expect(refinementSchema.safeParse({ ...content, correctAnswer: { text: content.correctAnswer.text, explanation: invalid } }).success).toBe(false);
    }
    const content = finalContent();
    content.correctAnswer.explanation = "x".repeat(25);
    expect(refinementSchema.safeParse(content).success).toBe(true);
  });

  it("directly transmits required teaching and minimum lengths in provider JSON schema", () => {
    const schema = z.toJSONSchema(refinementSchema);
    const distractor = (schema.properties!.distractors as { items: { required: string[]; properties: Record<string, { type: string; minLength: number }>; additionalProperties: boolean } }).items;
    expect(distractor.required).toEqual(["text", "hint", "explanation"]);
    expect(distractor.additionalProperties).toBe(false);
    for (const field of ["hint", "explanation"]) expect(distractor.properties[field]).toMatchObject({ type: "string", minLength: 15 });
    const correct = schema.properties!.correctAnswer as { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean };
    expect(correct.required).toEqual(["text", "explanation"]);
    expect(Object.keys(correct.properties)).toEqual(["text", "explanation"]);
    expect(correct.properties.explanation).toMatchObject({ type: "string", minLength: 25 });
    expect(correct.additionalProperties).toBe(false);
  });

  it.each(emptyTeaching.responses)("converts historical response $requestId in the test without accepting its old wire format", ({ response }) => {
    const content = { vignette: response.vignette, stem: response.stem,
      correctAnswer: { text: response.options[response.correctIndex].text, explanation: response.shortExplanation },
      distractors: response.options.filter((_, index) => index !== response.correctIndex),
      highYieldPearl: response.highYieldPearl, vignetteSignature: response.vignetteSignature };
    expect(refinementSchema.safeParse(response).success).toBe(false);
    const normalized = toGeneratedQuestion(readRefinedQuestion(content), makeQuestion().blueprint, () => 0.999);
    expect(normalized.options[0].text).toBe(content.correctAnswer.text);
    expect(normalized.options[0].explanation).toBe(response.shortExplanation);
    expect(normalized.options[0].hint).toBe("Consider how the case findings support this choice.");
    expect(normalized.options.slice(1).map(({ text, hint, explanation }) => ({ text, hint, explanation }))).toEqual(content.distractors);
    expect(optionLengthIssue(draftContent(normalized))).toBeUndefined();
    expect(generatedQuestionSchema.safeParse(normalized).success).toBe(true);
  });

  it("reuses the correct explanation and returns the unchanged public contract", () => {
    const content = finalContent();
    const question = toGeneratedQuestion(readRefinedQuestion(content), makeQuestion().blueprint, () => 0.999);
    expect(question.shortExplanation).toBe(content.correctAnswer.explanation);
    expect(question.options[0].explanation).toBe(content.correctAnswer.explanation);
    expect(question.options[0].hint).toBe("Consider how the case findings support this choice.");
    expect(generatedQuestionSchema.safeParse(question).success).toBe(true);
    expect(question.options[1]).toMatchObject(content.distractors[0]);
  });

  it("adds IDs only in the final adapter and preserves teaching after shuffling", () => {
    const content = finalContent();
    const parsed = readRefinedQuestion(content);
    const before = structuredClone(parsed);
    expect(parsed).toEqual(content);
    expect(parsed).not.toHaveProperty("options");
    const result = toGeneratedQuestion(parsed, makeQuestion().blueprint, () => 0);
    expect(result.correctOptionId).toBe("E");
    expect(result.options.map(({ id }) => id)).toEqual(["A", "B", "C", "D", "E"]);
    expect(result.options[4]).toMatchObject({ text: content.correctAnswer.text, explanation: content.correctAnswer.explanation });
    for (const choice of content.distractors) expect(result.options.find(({ text }) => text === choice.text)).toMatchObject(choice);
    expect(result.shortExplanation).toBe(content.correctAnswer.explanation);
    expect(parsed).toEqual(before);
    const choices = [content.correctAnswer.text, ...content.distractors.map(({ text }) => text)];
    const shuffled = shuffleValues(choices, () => 0);
    expect(shuffled).toEqual([...choices.slice(1), choices[0]]);
    expect(choices[0]).toBe(content.correctAnswer.text);
  });

  it("compares core answer roles rather than IDs, new teaching or signatures", () => {
    const question = makeQuestion();
    const core = readQuestionDraft(draftContent(question));
    expect(changedQuestionFields(core, core)).toEqual([]);
    expect(changedQuestionFields(core, { ...core, stem: "Which treatment is the best initial choice?", correctAnswer: core.distractors[0], distractors: [core.correctAnswer, ...core.distractors.slice(1)] })).toEqual(["stem", "correctAnswer", "distractors"]);
    expect(changedQuestionFields(core, { ...core, distractors: ["Different investigation", ...core.distractors.slice(1)] })).toEqual(["distractors"]);
    const final = readRefinedQuestion(finalContent());
    expect(changedQuestionFields(core, { ...final, vignetteSignature: "different-signature" })).toEqual([]);
  });
});
