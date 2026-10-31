import { useEffect, useState } from "react";
import { disciplineSchema, type Discipline } from "../lib/blueprint";
import { disciplineLabels, focusObjectives, sameStudyFocus, studyFocusLabel, type StudyFocus } from "../lib/studyFocus";

type Props = {
  focus: StudyFocus;
  onApply: (focus: StudyFocus) => Promise<void>;
};

export function StudyFocusSettings({ focus, onApply }: Props) {
  const [draft, setDraft] = useState(focus);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(focus);
    setSearch("");
  }, [focus]);

  const topics = draft ? focusObjectives(draft.discipline) : [];
  const matching = topics.filter((topic) => topic.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  // Keep the selected option representable while the search text changes.
  const selected = topics.find((topic) => topic.id === draft?.objectiveId);
  const options = selected && !matching.includes(selected) ? [selected, ...matching] : matching;

  const changeDraft = (next: StudyFocus) => {
    setDraft(next);
    setMessage("");
    setError("");
  };

  const apply = async () => {
    setSaving(true);
    setError("");
    try {
      await onApply(draft);
      setMessage("Focus saved. Changes apply to the next question.");
    } catch {
      setError("Could not save question focus. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="focus-settings" disabled={saving}>
      <legend>Question focus</legend>
      <label htmlFor="practice-focus">Practice</label>
      <select id="practice-focus" value={draft ? "focused" : "mixed"} onChange={(event) => {
        changeDraft(event.target.value === "mixed" ? null : { discipline: "medicine" });
        setSearch("");
      }}>
        <option value="mixed">Mixed practice</option>
        <option value="focused">Focused practice</option>
      </select>
      {draft && <>
        <label htmlFor="focus-discipline">Discipline</label>
        <select id="focus-discipline" value={draft.discipline} onChange={(event) => {
          changeDraft({ discipline: event.target.value as Discipline });
          setSearch("");
        }}>
          {disciplineSchema.options.map((discipline) => <option key={discipline} value={discipline}>{disciplineLabels[discipline]}</option>)}
        </select>
        <label htmlFor="focus-search">Search MCC topics</label>
        <input id="focus-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. chest pain" />
        <label htmlFor="focus-objective">MCC topic</label>
        <select id="focus-objective" value={draft.objectiveId ?? ""} onChange={(event) => changeDraft({
          discipline: draft.discipline, ...(event.target.value ? { objectiveId: event.target.value } : {})
        })}>
          <option value="">All topics</option>
          {options.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
        </select>
        {matching.length === 0 && <p className="settings-note">No matching topics. Try another search.</p>}
      </>}
      <p className="settings-note">Active: {studyFocusLabel(focus)}. Focus stays on until you return to mixed practice. Your current question stays open.</p>
      <button className="primary-button" type="button" disabled={saving || sameStudyFocus(draft, focus)} onClick={() => void apply()}>{saving ? "Saving…" : "Apply focus"}</button>
      {message && <p className="settings-note" aria-live="polite">{message}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </fieldset>
  );
}
