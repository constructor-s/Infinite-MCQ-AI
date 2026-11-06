import { z } from "zod";
import { generatedQuestionSchema, type GeneratedQuestion, type OptionId } from "../lib/contracts.js";
import { shuffleValues } from "../lib/shuffleQuestion.js";
import type { BlueprintTags } from "../lib/blueprint.js";

const optionIds: OptionId[] = ["A", "B", "C", "D", "E"];
const { vignette, stem, highYieldPearl, vignetteSignature } = generatedQuestionSchema.shape;
const optionText = generatedQuestionSchema.shape.options.element.shape.text;
const optionHint = generatedQuestionSchema.shape.options.element.shape.hint;
const optionExplanation = generatedQuestionSchema.shape.options.element.shape.explanation;

function uniqueTexts(texts: string[], ctx: z.RefinementCtx) {
  if (new Set(texts.map((text) => text.trim().toLowerCase())).size !== texts.length) {
    ctx.addIssue({ code: "custom", path: ["distractors"], message: "Option text must be unique" });
  }
}

export const questionDraftSchema = z.object({
  vignette, stem, correctAnswer: optionText, distractors: z.array(optionText).length(4)
}).strict().superRefine((draft, ctx) => uniqueTexts([draft.correctAnswer, ...draft.distractors], ctx));
export type QuestionDraft = z.infer<typeof questionDraftSchema>;
export function readQuestionDraft(value: unknown): QuestionDraft {
  return questionDraftSchema.parse(value);
}

export function questionCoreContent(question: QuestionDraft | RefinedQuestion): QuestionDraft {
  return { vignette: question.vignette, stem: question.stem,
    correctAnswer: typeof question.correctAnswer === "string" ? question.correctAnswer : question.correctAnswer.text,
    distractors: question.distractors.map((option) => typeof option === "string" ? option : option.text) };
}

// Teaching is required directly by each answer role in the provider schema.
export const refinementSchema = z.object({
  vignette, stem,
  correctAnswer: z.object({ text: optionText, explanation: z.string().min(25) }).strict(),
  distractors: z.array(z.object({ text: optionText, hint: optionHint, explanation: optionExplanation }).strict()).length(4),
  highYieldPearl, vignetteSignature
}).strict().superRefine((question, ctx) => {
  uniqueTexts([question.correctAnswer.text, ...question.distractors.map(({ text }) => text)], ctx);
});

export type RefinedQuestion = z.infer<typeof refinementSchema>;

export function readRefinedQuestion(value: unknown): RefinedQuestion {
  return refinementSchema.parse(value);
}

/** The only generation boundary that adds option IDs for storage/display. */
export function toGeneratedQuestion(final: RefinedQuestion, blueprint: BlueprintTags, random: () => number = Math.random): GeneratedQuestion {
  const choices = shuffleValues([
    { text: final.correctAnswer.text, hint: "Consider how the case findings support this choice.", explanation: final.correctAnswer.explanation },
    ...final.distractors
  ], random);
  return generatedQuestionSchema.parse({
    vignette: final.vignette, stem: final.stem, blueprint,
    options: choices.map((option, index) => ({ ...option, id: optionIds[index] })),
    correctOptionId: optionIds[choices.findIndex(({ text }) => text === final.correctAnswer.text)],
    highYieldPearl: final.highYieldPearl, vignetteSignature: final.vignetteSignature
  });
}

export function changedQuestionFields(original: QuestionDraft, final: QuestionDraft | RefinedQuestion): (keyof QuestionDraft)[] {
  const before = questionCoreContent(original);
  const after = questionCoreContent(final);
  return (Object.keys(before) as (keyof QuestionDraft)[]).filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}
