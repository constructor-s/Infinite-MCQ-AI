import type { ClinicalQuestion, Encounter, OptionId } from "../lib/contracts";

type Props = {
  question: ClinicalQuestion;
  encounter: Encounter;
  mode: "fresh" | "review";
  busy: boolean;
  onSelect: (id: OptionId) => void;
  onReveal: () => void;
  onNext: () => void;
};

export function QuestionView({ question, encounter, mode, busy, onSelect, onReveal, onNext }: Props) {
  const resolved = Boolean(encounter.completedAt);
  const lastWrongId = [...encounter.selectedOptionIds].reverse().find((id) => id !== question.correctOptionId);
  const lastWrong = question.options.find((option) => option.id === lastWrongId);

  return (
    <main className="question-shell">
      <section className="question-card" aria-labelledby="question-stem">
        {mode === "review" && <p className="review-label">Review question</p>}

        <div className="vignette">
          <p className="narrative">{question.vignette.narrative}</p>
          {question.vignette.vitalSigns.length > 0 && (
            <ClinicalTable
              title="Vital signs"
              headers={["Measurement", "Value"]}
              rows={question.vignette.vitalSigns.map((item) => [item.name, item.value])}
            />
          )}
          {question.vignette.physicalExam.length > 0 && (
            <ClinicalList title="Examination" items={question.vignette.physicalExam} />
          )}
          {question.vignette.laboratoryResults.length > 0 && (
            <ClinicalTable
              title="Laboratory results"
              headers={["Test", "Result", "Reference range"]}
              rows={question.vignette.laboratoryResults.map((item) => [item.test, `${item.value} ${item.unit}`.trim(), item.referenceRange])}
            />
          )}
          {question.vignette.investigations.length > 0 && (
            <div className="clinical-section">
              <h2>Investigations</h2>
              {question.vignette.investigations.map((item) => (
                <p key={`${item.type}-${item.findings}`}><strong>{item.type}:</strong> {item.findings}</p>
              ))}
            </div>
          )}
        </div>

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
            <button className="primary-button" type="button" disabled={busy} onClick={onNext}>Next question</button>
          </section>
        )}
      </section>
    </main>
  );
}

function ClinicalList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="clinical-section">
      <h2>{title}</h2>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

function ClinicalTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return (
    <section className="clinical-section">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${row.join("-")}-${rowIndex}`}>
                {row.map((cell, cellIndex) => cellIndex === 0
                  ? <th key={`${cell}-${cellIndex}`} scope="row">{cell}</th>
                  : <td key={`${cell}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
