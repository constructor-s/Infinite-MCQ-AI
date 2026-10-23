import { useEffect, useState } from "react";
import type { ModelOption, Theme } from "../lib/contracts";
import { fetchModels } from "../services/questionQueue";
import { studyRepository, type CorrectRates } from "../db/repository";

type Props = {
  open: boolean;
  selectedModel: string;
  theme: Theme;
  onClose: () => void;
  onSelectModel: (model: ModelOption["id"]) => Promise<void>;
  onSelectTheme: (theme: Theme) => Promise<void>;
};

const FALLBACK_MODELS: ModelOption[] = [
  { id: "gemini-3.5-flash-lite", label: "Economy · Gemini 3.5 Flash-Lite", description: "Fast, efficient background generation", available: true },
  { id: "gemini-3.8-flash", label: "Quality · Gemini 3.8 Flash", description: "Stronger reasoning with potentially lower throughput", available: true }
];

export function SettingsDialog({ open, selectedModel, theme, onClose, onSelectModel, onSelectTheme }: Props) {
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [error, setError] = useState("");
  const [correctRates, setCorrectRates] = useState<CorrectRates | null>(null);
  const [ratesError, setRatesError] = useState("");

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
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-heading">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-button" type="button" aria-label="Close settings" onClick={onClose}>×</button>
        </div>
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
                {([["Recent 20", correctRates.recent20], ["Recent 100", correctRates.recent100]] as const).map(([label, rate]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{rate.total ? `${Math.round(rate.correct / rate.total * 100)}% · ${rate.correct}/${rate.total}` : "No answers yet"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <p className="settings-note">First try on fresh questions only. Reveals count as incorrect; reviews are excluded. Uses history on this device.</p>
        </section>
        {error && <p className="inline-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
