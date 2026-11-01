import type { OptionId } from "./contracts.js";

const OPTION_IDS: OptionId[] = ["A", "B", "C", "D", "E"];

/** Return a shuffled copy without mutating the supplied values. */
export function shuffleValues<T>(values: readonly T[], random: () => number = Math.random): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function shuffleQuestionOptions<T extends { options: { id: OptionId; text: string }[]; correctOptionId: OptionId }>(
  question: T,
  random: () => number = Math.random
): T {
  const shuffled = shuffleValues(question.options.map((option) => ({ ...option })), random);

  const correctIndex = shuffled.findIndex((option) => option.id === question.correctOptionId);
  return {
    ...question,
    options: shuffled.map((option, index) => ({ ...option, id: OPTION_IDS[index] })),
    correctOptionId: OPTION_IDS[correctIndex]
  } as T;
}
