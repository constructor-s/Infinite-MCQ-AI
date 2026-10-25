import type { ClinicalQuestion, Encounter, FollowUpMessage, OptionId } from "../lib/contracts";
import { QuestionFollowUp } from "./QuestionFollowUp";

type Props = {
  question: ClinicalQuestion;
  encounter: Encounter;
  mode: "fresh" | "review";
  busy: boolean;
  onSelect: (id: OptionId) => void;
  onReveal: () => void;
  onNext: () => void;
  onFollowUpMessagesChange: (messages: FollowUpMessage[]) => Promise<void>;
};

export function QuestionView({ question, encounter, mode, busy, onSelect, onReveal, onNext, onFollowUpMessagesChange }: Props) {
  const resolved = Boolean(encounter.completedAt);
  const lastWrongId = [...encounter.selectedOptionIds].reverse().find((id) => id !== question.correctOptionId);
  const lastWrong = question.options.find((option) => option.id === lastWrongId);

  return (
    <main className="question-shell">
      <section className="question-card" aria-labelledby="question-stem">
        {mode === "review" && <p className="review-label">Review question</p>}

        <div className="vignette"><p className="narrative">{question.vignette}</p></div>

        <h1 id="question-stem" className="stem">{question.stem}</h1>

        <div className="options" role="group" aria-label="Answer options">
          {question.options.map((option, index) => {
            const selected = encounter.selectedOptionIds.includes(option.id);
            const isCorrect = option.id === question.correctOptionId;
            const classNames = ["option"];
            if (selected && !isCorrect) classNames.push("is-wrong");
            if (resolved && isCorrect) classNames.push("is-correct");
            return (
              <button
                key={option.id}
                type="button"
                className={classNames.join(" ")}
                disabled={busy || resolved || selected}
                aria-pressed={selected}
                onClick={() => onSelect(option.id)}
              >
                <span className="option-letter">{option.id}</span>
                <span>{option.text}</span>
                <span className="key-hint" aria-hidden="true">{index + 1}</span>
              </button>
            );
          })}
        </div>

        {!resolved && lastWrong && (
          <aside className="hint" aria-live="polite">
            <strong>Think again</strong>
            <p>{lastWrong.hint}</p>
          </aside>
        )}

        {!resolved && (
          <div className="question-actions">
            <button className="text-button" type="button" disabled={busy} onClick={onReveal}>Reveal answer</button>
          </div>
        )}

        {resolved && (
          <section className="resolution" aria-live="polite">
            <p className="answer-label">Answer: {question.correctOptionId}</p>
            <p>{question.shortExplanation}</p>
            <p className="pearl"><strong>Clinical pearl:</strong> {question.highYieldPearl}</p>
            <details>
              <summary>Review all answer options</summary>
              <div className="explanations">
                {question.options.map((option) => (
                  <div key={option.id}>
                    <h3>{option.id}. {option.text}</h3>
                    <p>{option.explanation}</p>
                  </div>
                ))}
              </div>
            </details>
            <QuestionFollowUp
              question={question}
              messages={encounter.followUpMessages ?? []}
              onMessagesChange={onFollowUpMessagesChange}
            />
            <button className="primary-button" type="button" disabled={busy} onClick={onNext}>Next question</button>
          </section>
        )}
      </section>
    </main>
  );
}
