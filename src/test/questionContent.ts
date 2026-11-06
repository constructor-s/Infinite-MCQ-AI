import type { GeneratedQuestion } from "../lib/contracts";
import { questionCoreContent } from "../server/questionDraft";

// Historical fixtures use the database/UI contract. Convert at the test boundary.
export function finalContent(question: GeneratedQuestion) {
  const correct = question.options.find(({ id }) => id === question.correctOptionId)!;
  return { vignette: question.vignette, stem: question.stem,
    correctAnswer: { text: correct.text, explanation: correct.explanation },
    distractors: question.options.filter(({ id }) => id !== question.correctOptionId).map(({ text, hint, explanation }) => ({ text, hint, explanation })),
    highYieldPearl: question.highYieldPearl, vignetteSignature: question.vignetteSignature };
}

export function draftContent(question: GeneratedQuestion) {
  return questionCoreContent(finalContent(question));
}
