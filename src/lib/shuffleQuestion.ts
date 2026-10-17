import type { GeneratedQuestion, OptionId } from "./contracts.js";

const OPTION_IDS: OptionId[] = ["A", "B", "C", "D", "E"];

export function shuffleQuestionOptions<T extends Pick<GeneratedQuestion, "options" | "correctOptionId">>(
  question: T,
  random: () => number = Math.random
): T {
  const shuffled = question.options.map((option) => ({ ...option }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  const correctIndex = shuffled.findIndex((option) => option.id === question.correctOptionId);
  return {
    ...question,
    options: shuffled.map((option, index) => ({ ...option, id: OPTION_IDS[index] })),
    correctOptionId: OPTION_IDS[correctIndex]
  } as T;
}
