import type { QuestionDraft } from "./questionDraft.js";

export const DISTRACTOR_INSTRUCTION = `Use five homogeneous choices with parallel grammar, scope and detail. Build each distractor as an almost-correct alternative with one specific mistaken fact, phrase, timing, priority or decision rule. For action/communication choices, start from a sound response and change one decision-relevant element, keeping the rest plausible. The supplied case must make that error decisive. Eliminating the alternative should require the case, not merely spotting universally inappropriate behaviour. Keep tone and professionalism comparable, especially for ethics and communication; do not make the key the only respectful or comprehensive response. Avoid absurd actions, gratuitous absolutes, overlapping answers and two defensible best answers. Move shared care details into the vignette.`;

export const OPTION_CONSTRUCTION_INSTRUCTION = `${DISTRACTOR_INSTRUCTION} Keep option lengths comparable without padding; code measures lengths separately.`;

export function optionLengthMetrics(question: Pick<QuestionDraft, "correctAnswer" | "distractors">) {
  const words = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
  const correctWords = words(question.correctAnswer);
  const distractors = question.distractors.map((text) => ({ text, words: words(text) }));
  const lengths = distractors.map(({ words }) => words).sort((a, b) => a - b);
  const distractorMedianWords = (lengths[1] + lengths[2]) / 2;
  return { correctWords, distractors, distractorMedianWords,
    maximumKeyWords: Math.max(5, Math.floor(distractorMedianWords * 11 / 10)),
    exceedsLimit: correctWords > 5 && correctWords * 10 > distractorMedianWords * 11 };
}

export function optionLengthIssue(question: Pick<QuestionDraft, "correctAnswer" | "distractors">): string | undefined {
  const { correctWords, distractorMedianWords, maximumKeyWords, exceedsLimit } = optionLengthMetrics(question);
  if (!exceedsLimit) return undefined;
  return `The correct answer has ${correctWords} words; the distractor median is ${distractorMedianWords}, allowing at most ${maximumKeyWords} words. Rewrite the distractors as substantive near-misses of comparable length, or shorten the key while retaining necessary meaning. Keep one best answer and write teaching for the final choices; do not add filler.`;
}
