import { useCallback, useEffect, useRef, useState } from "react";
import { QuestionView } from "./components/QuestionView";
import { SettingsDialog } from "./components/SettingsDialog";
import { StatusBar } from "./components/StatusBar";
import { studyRepository } from "./db/repository";
import type { ClinicalQuestion, Encounter, EncounterMode, ModelOption, OptionId, Theme } from "./lib/contracts";
import { ApiError, QUEUE_TARGET, questionQueue, type QueueProgress } from "./services/questionQueue";

const DEFAULT_PROGRESS: QueueProgress = { ready: 0, target: QUEUE_TARGET, generating: false };

function initialTheme(): Theme {
  return localStorage.getItem("iworld-theme") === "dark" ? "dark" : "light";
}

export default function App() {
  const [question, setQuestion] = useState<ClinicalQuestion | undefined>(undefined);
  const [encounter, setEncounter] = useState<Encounter | undefined>(undefined);
  const [mode, setMode] = useState<EncounterMode>("fresh");
  const [progress, setProgress] = useState(DEFAULT_PROGRESS);
  const [generationError, setGenerationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelOption["id"]>("gemini-3.5-flash-lite");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const currentQuestionRef = useRef<ClinicalQuestion | undefined>(undefined);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const retryCountRef = useRef(0);

  useEffect(() => { currentQuestionRef.current = question; }, [question]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111111" : "#ffffff");
    localStorage.setItem("iworld-theme", theme);
  }, [theme]);

  const loadNextAvailable = useCallback(async (excludeReviewId?: string) => {
    const fresh = await studyRepository.getFreshQuestions();
    let next: ClinicalQuestion | undefined = fresh[0];
    let nextMode: EncounterMode = "fresh";
    if (!next) {
      next = await studyRepository.getReviewQuestion(excludeReviewId);
      nextMode = "review";
    }
    if (!next) {
      setQuestion(undefined);
      setEncounter(undefined);
      return;
    }
    const nextEncounter = await studyRepository.beginEncounter(next, nextMode);
    setMode(nextMode);
    setQuestion(next);
    setEncounter(nextEncounter);
  }, []);

  const startFill = useCallback(() => {
    if (!navigator.onLine) return;
    window.clearTimeout(retryTimerRef.current);
    setGenerationError("");
    void questionQueue.fill((nextProgress) => {
      setProgress(nextProgress);
      if (!currentQuestionRef.current && nextProgress.ready > 0) void loadNextAvailable();
    }).then(() => {
      retryCountRef.current = 0;
    }).catch((reason: unknown) => {
      const message = reason instanceof ApiError
        ? reason.message
        : reason instanceof Error && reason.name === "AbortError"
          ? "Generation timed out"
          : reason instanceof Error
            ? reason.message
            : "Question generation is unavailable";
      setGenerationError(message);
      setProgress((previous) => ({ ...previous, generating: false }));
      const delays = [5_000, 15_000, 30_000, 60_000, 300_000];
      const delay = delays[Math.min(retryCountRef.current, delays.length - 1)];
      retryCountRef.current += 1;
      retryTimerRef.current = window.setTimeout(startFill, delay);
    });
  }, [loadNextAvailable]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [model, storedTheme, ready] = await Promise.all([
        studyRepository.getSetting<ModelOption["id"]>("selectedModel", "gemini-3.5-flash-lite"),
        studyRepository.getSetting<Theme>("theme", initialTheme()),
        studyRepository.getFreshCount()
      ]);
      if (!active) return;
      setSelectedModel(model);
      setTheme(storedTheme);
      setProgress({ ready, target: QUEUE_TARGET, generating: ready < QUEUE_TARGET && navigator.onLine });
      await loadNextAvailable();
      if (!active) return;
      setInitialized(true);
      startFill();
    })();
    return () => {
      active = false;
      window.clearTimeout(retryTimerRef.current);
    };
  }, [loadNextAvailable, startFill]);

  useEffect(() => {
    const handleOnline = () => { setOnline(true); retryCountRef.current = 0; startFill(); };
    const handleOffline = () => { setOnline(false); setProgress((previous) => ({ ...previous, generating: false })); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [startFill]);

  const handleSelect = useCallback(async (optionId: OptionId) => {
    if (!question || !encounter || busy || encounter.completedAt || encounter.selectedOptionIds.includes(optionId)) return;
    setBusy(true);
    try {
      const updated = await studyRepository.recordSelection(encounter.id, optionId, optionId === question.correctOptionId);
      setEncounter(updated);
    } finally {
      setBusy(false);
    }
  }, [busy, encounter, question]);

  const handleReveal = useCallback(async () => {
    if (!encounter || busy || encounter.completedAt) return;
    setBusy(true);
    try { setEncounter(await studyRepository.revealAnswer(encounter.id)); }
    finally { setBusy(false); }
  }, [busy, encounter]);

  const handleNext = useCallback(async () => {
    if (!question || !encounter?.completedAt || busy) return;
    setBusy(true);
    const previousId = question.id;
    try {
      if (mode === "fresh") await studyRepository.removeFromQueue(previousId);
      const ready = await studyRepository.getFreshCount();
      setProgress((previous) => ({ ...previous, ready }));
      setQuestion(undefined);
      setEncounter(undefined);
      await loadNextAvailable(mode === "review" ? previousId : undefined);
      startFill();
      window.scrollTo({ top: 0, behavior: "auto" });
    } finally {
      setBusy(false);
    }
  }, [busy, encounter?.completedAt, loadNextAvailable, mode, question, startFill]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (/^[1-5]$/.test(event.key) && question && encounter && !encounter.completedAt) {
        const option = question.options[Number(event.key) - 1];
        if (option) void handleSelect(option.id);
      }
      if (event.key === "Enter" && encounter?.completedAt) void handleNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [encounter, handleNext, handleSelect, question, settingsOpen]);

  const handleModelChange = async (model: ModelOption["id"]) => {
    await studyRepository.setSetting("selectedModel", model);
    setSelectedModel(model);
    setGenerationError("");
    retryCountRef.current = 0;
    startFill();
  };

  const handleThemeChange = async (nextTheme: Theme) => {
    setTheme(nextTheme);
    await studyRepository.setSetting("theme", nextTheme);
  };

  const retry = () => {
    retryCountRef.current = 0;
    setOnline(navigator.onLine);
    startFill();
  };

  return (
    <div className="app">
      <StatusBar
        {...progress}
        offline={!online}
        reviewMode={mode === "review"}
        error={generationError}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {question && encounter ? (
        <QuestionView question={question} encounter={encounter} mode={mode} busy={busy} onSelect={handleSelect} onReveal={handleReveal} onNext={handleNext} />
      ) : (
        <main className="empty-state">
          {!initialized || progress.generating ? (
            <><div className="loader" aria-hidden="true" /><h1>Preparing your first question</h1><p>IWorld is generating a fresh clinical vignette.</p></>
          ) : (
            <><h1>A connection is needed</h1><p>{generationError || "There are no generated questions available to review yet."}</p><button className="primary-button" type="button" onClick={retry}>Try again</button></>
          )}
        </main>
      )}

      <footer>AI-generated educational material may contain errors. Verify clinical guidance.</footer>
      <SettingsDialog
        open={settingsOpen}
        selectedModel={selectedModel}
        theme={theme}
        onClose={() => setSettingsOpen(false)}
        onSelectModel={handleModelChange}
        onSelectTheme={handleThemeChange}
      />
    </div>
  );
}
