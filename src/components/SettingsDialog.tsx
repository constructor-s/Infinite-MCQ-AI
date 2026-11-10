import { useEffect, useState } from "react";
import type { ModelOption, Theme } from "../lib/contracts";
import { fetchModels } from "../services/questionQueue";
import { studyRepository, type CorrectRates, type LatestGenerationQcReport, type RecentQuestionTopic } from "../db/repository";
import { questionUrl } from "../lib/questionNavigation";
import { StudyFocusSettings } from "./StudyFocusSettings";
import type { StudyFocus } from "../lib/studyFocus";

type Props = {
  open: boolean;
  ready: number;
  target: number;
  generating: boolean;
  offline: boolean;
  reviewMode: boolean;
  generationError?: string;
  lastGenerationError?: string;
  qcRefreshVersion?: number;
  selectedModel: string;
  theme: Theme;
  studyFocus: StudyFocus;
  onApplyFocus: (focus: StudyFocus) => Promise<void>;
  onClose: () => void;
  onOpenQuestion: (questionId: string, encounterId: string) => void;
  onSelectModel: (model: ModelOption["id"]) => Promise<void>;
  onSelectTheme: (theme: Theme) => Promise<void>;
};

const FALLBACK_MODELS: ModelOption[] = [
  { id: "gemini-3.5-flash-lite", label: "Economy · Gemini 3.5 Flash-Lite", description: "Fast, efficient background generation", available: true },
  { id: "gemini-3.8-flash", label: "Quality · Gemini 3.8 Flash", description: "Stronger reasoning with potentially lower throughput", available: true }
];

const dimensionLabels: Record<string, string> = {
  medicine: "Medicine", surgery: "Surgery", pediatrics: "Pediatrics", obgyn: "Obstetrics / gynecology",
  psychiatry: "Psychiatry", phelo: "Population health, ethics, and legal obligations",
  assessment_diagnosis: "Assessment / diagnosis", professional_behaviours: "Professional behaviours",
  capacity_consent: "Capacity / consent", ecg_interpretation: "ECG interpretation"
};

function dimensionLabel(value: string): string {
  return dimensionLabels[value] ?? value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function SettingsDialog({ open, selectedModel, theme, studyFocus, onApplyFocus, onClose, onOpenQuestion, onSelectModel, onSelectTheme, ready, target, generating, offline, reviewMode, generationError, lastGenerationError, qcRefreshVersion = 0 }: Props) {
  const [recentQuestions, setRecentQuestions] = useState<RecentQuestionTopic[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [error, setError] = useState("");
  const [correctRates, setCorrectRates] = useState<CorrectRates | null>(null);
  const [ratesError, setRatesError] = useState("");
  const [qcReport, setQcReport] = useState<LatestGenerationQcReport | null>(null);
  const [qcLoading, setQcLoading] = useState(false);
  const [qcError, setQcError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setRecentQuestions(null);
    setHistoryError("");
    void studyRepository.getRecentQuestionTopics()
      .then((questions) => { if (active) setRecentQuestions(questions); })
      .catch(() => { if (active) setHistoryError("Could not load recent question topics."); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setQcReport(null);
    setQcLoading(true);
    setQcError("");
    void studyRepository.getLatestSuccessfulGenerationQcReport()
      .then((report) => { if (active) setQcReport(report ?? null); })
      .catch(() => { if (active) setQcError("Could not load the latest question QC report."); })
      .finally(() => { if (active) setQcLoading(false); });
    return () => { active = false; };
  }, [open, qcRefreshVersion]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setCorrectRates(null);
    setRatesError("");
    void studyRepository.getCorrectRates()
      .then((rates) => { if (active) setCorrectRates(rates); })
      .catch(() => { if (active) setRatesError("Could not load correct rates."); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError("");
    void fetchModels()
      .then((response) => setModels(response.models))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not verify model availability"));
  }, [open]);

  if (!open) return null;

  let status = `Ready · ${ready}/${target}`;
  if (offline && reviewMode && !studyFocus) status = "Offline · Review";
  else if (offline) status = `Offline · ${ready}/${target} ready`;
  else if (generating) status = `Generating · ${ready}/${target} ready`;
  else if (generationError && reviewMode && !studyFocus) status = "Generation paused · Review";
  else if (generationError) status = `Generation paused · ${ready}/${target} ready`;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-heading">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-button" type="button" aria-label="Close settings" onClick={onClose}>×</button>
        </div>
        <StudyFocusSettings focus={studyFocus} onApply={onApplyFocus} />
        <fieldset>
          <legend>Question model</legend>
          {models.map((model) => (
            <label className={`model-option ${!model.available ? "is-unavailable" : ""}`} key={model.id}>
              <input
                type="radio"
                name="model"
                value={model.id}
                checked={selectedModel === model.id}
                disabled={!model.available}
                onChange={() => void onSelectModel(model.id)}
              />
              <span><strong>{model.label}</strong><small>{model.available ? model.description : "Unavailable for this API key"}</small></span>
            </label>
          ))}
        </fieldset>
        <p className="settings-note">Changes apply to newly generated questions. Existing questions stay in your local queue.</p>
        <fieldset className="appearance-settings">
          <legend>Appearance</legend>
          <div className="theme-options">
            {(["auto", "light", "dark"] as Theme[]).map((option) => (
              <label className="theme-option" key={option}>
                <input
                  type="radio"
                  name="theme"
                  value={option}
                  checked={theme === option}
                  onChange={() => void onSelectTheme(option)}
                />
                <span>{option === "auto" ? "Auto" : option === "light" ? "Light" : "Dark"}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <section className="correct-rate-settings" aria-labelledby="correct-rate-title">
          <h3 id="correct-rate-title">Correct rate</h3>
          <div aria-live="polite">
            {ratesError ? <p className="inline-error">{ratesError}</p> : !correctRates ? <p className="settings-note">Loading correct rates…</p> : (
              <dl className="correct-rates">
                {([["Recent 20", correctRates.recent20], ["Recent 100", correctRates.recent100], ["Last 1 hour", correctRates.lastHour], ["Last 24 hours", correctRates.last24Hours]] as const).map(([label, rate]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{rate.total > 0 && `${Math.round(rate.correct / rate.total * 100)}% · `}{rate.correct}/{rate.total}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <p className="settings-note">First try on fresh questions only. Reveals count as incorrect; reviews are excluded. Uses history on this device.</p>
        </section>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="settings-status status-copy" role="status" aria-live="polite">
          <span className={`status-dot ${generating ? "is-generating" : ""}`} aria-hidden="true" />
          {studyFocus ? "Focused practice · " : ""}{status}
        </div>
        {lastGenerationError && (
          <p className="settings-generation-error" aria-live="polite">Last generation error: {lastGenerationError}</p>
        )}
        <section className="quality-warning-settings" aria-labelledby="quality-warning-title">
          <h3 id="quality-warning-title">Latest generated question QC</h3>
          <div aria-live="polite">
            {qcError ? <p className="inline-error">{qcError}</p> : qcLoading ? <p className="settings-note">Loading QC findings…</p> : !qcReport ? (
              <p className="settings-note">No successful generation recorded yet.</p>
            ) : qcReport.qualityWarnings.length === 0 ? (
              <p className="settings-note">No QC warnings on the latest generated question.</p>
            ) : (
              <ul className="quality-warning-list">
                {qcReport.qualityWarnings.flatMap((warning, warningIndex) => warning.issues.map((issue, issueIndex) => (
                  <li key={`${warningIndex}-${issueIndex}`}>
                    <strong><code>{warning.code}</code></strong>
                    <span> · issue <code>{issue.code}</code></span>
                    {issue.path.length > 0 && <span> · {issue.path.join(".")}</span>}
                    <p>{issue.message}</p>
                  </li>
                )))}
              </ul>
            )}
          </div>
        </section>
        <section className="recent-question-settings" aria-labelledby="recent-question-title">
          <h3 id="recent-question-title">Recent question topics</h3>
          <p className="settings-note">Last 20 completed questions, newest first. Reviews appear once, using the latest completion. Results reflect the first try; reveals count as incorrect.</p>
          <div aria-live="polite">
            {historyError ? <p className="inline-error">{historyError}</p> : recentQuestions === null ? (
              <p className="settings-note">Loading recent question topics…</p>
            ) : recentQuestions.length === 0 ? (
              <p className="settings-note">No completed questions yet.</p>
            ) : (
              <ol className="recent-question-list">
                {recentQuestions.map((question) => (
                  <li key={question.id}>
                    <div className="recent-question-heading">
                      <a href={questionUrl(question.id)} onClick={(event) => {
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        event.preventDefault();
                        onOpenQuestion(question.id, question.encounterId);
                      }}>{question.topicTitle}</a>
                      <span className={`question-outcome is-${question.outcome}`} aria-label={question.outcome === "correct" ? "Correct" : question.outcome === "incorrect" ? "Incorrect" : "Result unavailable"}>
                        <span aria-hidden="true">{question.outcome === "correct" ? "✓" : question.outcome === "incorrect" ? "✕" : "?"}</span>
                      </span>
                    </div>
                    <dl>
                      {([["Discipline", question.blueprint.discipline], ["Physician activity", question.blueprint.physicianActivity],
                        ["Care dimension", question.blueprint.careDimension], ["Cognitive task", question.blueprint.cognitiveTask]] as const).map(([label, value]) => (
                        <div key={label}><dt>{label}</dt><dd>{dimensionLabel(value)}</dd></div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </section>
    </div>
  );
}
