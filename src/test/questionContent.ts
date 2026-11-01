import type { GeneratedQuestion } from "../lib/contracts";
import { questionCoreContent } from "../server/questionDraft";

// Historical fixtures use the database/UI contract. Convert at the test boundary.
export function finalContent(question: GeneratedQuestion) {
  return { vignette: question.vignette, stem: question.stem,
    correctAnswer: { text: question.options.find(({ id }) => id === question.correctOptionId)!.text, explanation: question.shortExplanation },
    distractors: question.options.filter(({ id }) => id !== question.correctOptionId).map(({ text, hint, explanation }) => ({ text, hint, explanation })),
    highYieldPearl: question.highYieldPearl, vignetteSignature: question.vignetteSignature };
}

export function draftContent(question: GeneratedQuestion) {
  return questionCoreContent(finalContent(question));
}
