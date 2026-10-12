import { useEffect, useState } from "react";
import type { ModelOption, Theme } from "../lib/contracts";
import { fetchModels } from "../services/questionQueue";

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
        {error && <p className="inline-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
