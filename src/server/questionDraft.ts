import { z } from "zod";
import { generatedQuestionSchema, type GeneratedQuestion, type OptionId } from "../lib/contracts.js";
import type { BlueprintTags } from "../lib/blueprint.js";

const optionIds: OptionId[] = ["A", "B", "C", "D", "E"];
const correctIndexSchema = z.number().int().min(0).max(4);
const { vignette, stem, shortExplanation, highYieldPearl, vignetteSignature } = generatedQuestionSchema.shape;
const optionText = generatedQuestionSchema.shape.options.element.shape.text;
const optionHint = generatedQuestionSchema.shape.options.element.shape.hint;
const optionExplanation = generatedQuestionSchema.shape.options.element.shape.explanation;

function uniqueTexts(texts: string[], ctx: z.RefinementCtx) {
  if (new Set(texts.map((text) => text.trim().toLowerCase())).size !== texts.length) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Option text must be unique" });
  }
}

export const questionDraftSchema = z.object({
  vignette, stem, options: z.array(optionText).length(5), correctIndex: correctIndexSchema
}).strict().superRefine((draft, ctx) => uniqueTexts(draft.options, ctx));
export type QuestionDraft = z.infer<typeof questionDraftSchema>;
export type QuestionCore = Pick<GeneratedQuestion, "vignette" | "stem" | "blueprint" | "correctOptionId"> & {
  options: { id: OptionId; text: string }[];
};

export function readQuestionDraft(value: unknown, blueprint: BlueprintTags): QuestionCore {
  const draft = questionDraftSchema.parse(value);
  return { vignette: draft.vignette, stem: draft.stem, blueprint,
    options: draft.options.map((text, index) => ({ id: optionIds[index], text })), correctOptionId: optionIds[draft.correctIndex] };
}

export function questionCoreContent(question: QuestionCore): QuestionDraft {
  return { vignette: question.vignette, stem: question.stem, options: question.options.map(({ text }) => text),
    correctIndex: question.options.findIndex(({ id }) => id === question.correctOptionId) };
}

// Teaching is written once against the final choices. Correct-choice teaching
// comes from shortExplanation; harmless provider placeholders are ignored.
// The provider's flat option array cannot express which index needs teaching,
// so role-dependent required/length checks remain in the application validator.
export const refinementSchema = z.object({
  vignette, stem,
  options: z.array(z.object({ text: optionText, hint: z.string().nullish(), explanation: z.string().nullish() }).strict()).length(5),
  correctIndex: correctIndexSchema, shortExplanation, highYieldPearl, vignetteSignature
}).strict().superRefine((question, ctx) => {
  uniqueTexts(question.options.map(({ text }) => text), ctx);
  question.options.forEach((option, index) => {
    if (index === question.correctIndex) return;
    for (const field of ["hint", "explanation"] as const) {
      const teachingSchema = field === "hint" ? optionHint : optionExplanation;
      if (!teachingSchema.safeParse(option[field]).success) {
        ctx.addIssue({ code: "custom", path: ["options", index, field], message: `Each distractor requires a valid ${field} of at least 15 characters` });
      }
    }
  });
});

export function readRefinedQuestion(value: unknown, blueprint: BlueprintTags): GeneratedQuestion {
  const final = refinementSchema.parse(value);
  return generatedQuestionSchema.parse({
    vignette: final.vignette, stem: final.stem, blueprint,
    options: final.options.map((option, index) => ({ id: optionIds[index], text: option.text,
      hint: index === final.correctIndex ? "Consider how the case findings support this choice." : option.hint,
      explanation: index === final.correctIndex ? final.shortExplanation : option.explanation })),
    correctOptionId: optionIds[final.correctIndex], shortExplanation: final.shortExplanation,
    highYieldPearl: final.highYieldPearl, vignetteSignature: final.vignetteSignature
  });
}

export function changedQuestionFields(original: QuestionCore, final: QuestionCore): (keyof QuestionDraft)[] {
  const before = questionCoreContent(original);
  const after = questionCoreContent(final);
  return (Object.keys(before) as (keyof QuestionDraft)[]).filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}
