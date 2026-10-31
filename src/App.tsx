import { useCallback, useEffect, useRef, useState } from "react";
import { QuestionView } from "./components/QuestionView";
import { SettingsDialog } from "./components/SettingsDialog";
import { StatusBar } from "./components/StatusBar";
import { studyRepository } from "./db/repository";
import type { FollowUpMessage, ModelOption, OptionId, Theme } from "./lib/contracts";
import { useQuestionNavigation } from "./hooks/useQuestionNavigation";
import { activateTheme, getStoredTheme, normalizeTheme } from "./lib/theme";
import { ApiError, QUEUE_TARGET, questionQueue, type QueueProgress } from "./services/questionQueue";
import { sameStudyFocus, studyFocusLabel, type StudyFocus } from "./lib/studyFocus";

const DEFAULT_PROGRESS: QueueProgress = { ready: 0, target: QUEUE_TARGET, generating: false };

export default function App() {
  const { displayed, status: navigationStatus, openQuestion, nextQuestion, resumeWhenReady, retryNavigation, refreshStudySelection, continueStudying, updateEncounter } = useQuestionNavigation();
  const question = displayed?.question;
  const encounter = displayed?.encounter;
  const mode = encounter?.mode ?? "fresh";
  const [progress, setProgress] = useState(DEFAULT_PROGRESS);
  const [generationError, setGenerationError] = useState("");
  const [lastGenerationError, setLastGenerationError] = useState("");
  const [busyEncounterId, setBusyEncounterId] = useState<string>();
  const busy = Boolean(encounter && busyEncounterId === encounter.id);
  const [initialized, setInitialized] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelOption["id"]>("gemini-3.5-flash-lite");
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [studyFocus, setStudyFocus] = useState<StudyFocus>(null);
  const [focusNotice, setFocusNotice] = useState("");
  const [focusError, setFocusError] = useState("");
  const focusRef = useRef<StudyFocus>(null);
  const fillRequestRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const deactivateTheme = activateTheme(theme);
    try { localStorage.setItem("iworld-theme", theme); } catch { /* Theme still works when storage is unavailable. */ }
    return deactivateTheme;
  }, [theme]);

  const startFill = useCallback(() => {
    const request = ++fillRequestRef.current;
    if (!mountedRef.current || !navigator.onLine) return;
    window.clearTimeout(retryTimerRef.current);
    setGenerationError("");
    const requestedFocus = focusRef.current;
    void questionQueue.fill((nextProgress) => {
      if (!mountedRef.current || !sameStudyFocus(nextProgress.focus, focusRef.current)) return;
      setProgress(nextProgress);
      if (nextProgress.generationSucceeded) setLastGenerationError("");
      if (nextProgress.ready > 0) resumeWhenReady();
    }).then(() => {
      if (!mountedRef.current || request !== fillRequestRef.current || !sameStudyFocus(requestedFocus, focusRef.current)) return;
      retryCountRef.current = 0;
      resumeWhenReady();
    }).catch((reason: unknown) => {
      if (!mountedRef.current || request !== fillRequestRef.current || !sameStudyFocus(requestedFocus, focusRef.current)) return;
      const message = reason instanceof ApiError
        ? reason.message
        : reason instanceof Error && reason.name === "AbortError"
          ? "Generation timed out"
          : reason instanceof Error
            ? reason.message
            : "Question generation is unavailable";
      setGenerationError(message);
      setLastGenerationError(message);
      setProgress((previous) => ({ ...previous, generating: false }));
      const delays = [5_000, 15_000, 30_000, 60_000, 300_000];
      const delay = delays[Math.min(retryCountRef.current, delays.length - 1)];
      retryCountRef.current += 1;
      retryTimerRef.current = window.setTimeout(startFill, delay);
    });
  }, [resumeWhenReady]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [model, storedTheme, focus] = await Promise.all([
        studyRepository.getSetting<ModelOption["id"]>("selectedModel", "gemini-3.5-flash-lite"),
        studyRepository.getSetting<Theme>("theme", getStoredTheme()),
        studyRepository.getStudyFocus()
      ]);
      if (!active) return;
      const [ready, wasReset] = await Promise.all([
        studyRepository.getFreshCount(focus), studyRepository.takeStudyFocusResetNotice()
      ]);
      if (!active) return;
      setSelectedModel(model);
      setTheme(normalizeTheme(storedTheme));
      focusRef.current = focus;
      setStudyFocus(focus);
      if (wasReset) setFocusNotice("Your saved focus is no longer available. Returned to mixed practice.");
      setProgress({ ready, target: QUEUE_TARGET, generating: ready < QUEUE_TARGET && navigator.onLine, focus });
      setInitialized(true);
      startFill();
    })().catch(() => {
      if (!active) return;
      setInitialized(true);
      setGenerationError("Could not read local study settings. Reload to try again.");
      setLastGenerationError("Could not read local study settings. Reload to try again.");
      setProgress(DEFAULT_PROGRESS);
    });
    return () => {
      active = false;
      window.clearTimeout(retryTimerRef.current);
    };
  }, [startFill]);

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
    setBusyEncounterId(encounter.id);
    try {
      const updated = await studyRepository.recordSelection(encounter.id, optionId, optionId === question.correctOptionId);
      updateEncounter(updated);
    } finally {
      setBusyEncounterId((current) => current === encounter.id ? undefined : current);
    }
  }, [busy, encounter, question, updateEncounter]);

  const handleReveal = useCallback(async () => {
    if (!encounter || busy || encounter.completedAt) return;
    setBusyEncounterId(encounter.id);
    try { updateEncounter(await studyRepository.revealAnswer(encounter.id)); }
    finally { setBusyEncounterId((current) => current === encounter.id ? undefined : current); }
  }, [busy, encounter, updateEncounter]);

  const handleNext = useCallback(async () => {
    if (!encounter?.completedAt || busy) return;
    await nextQuestion();
    try {
      const focus = focusRef.current;
      const ready = await studyRepository.getFreshCount(focus);
      if (mountedRef.current && sameStudyFocus(focus, focusRef.current)) setProgress((previous) => ({ ...previous, ready }));
    } catch {
      if (mountedRef.current) setGenerationError("Could not read the local queue.");
    }
    startFill();
  }, [busy, encounter?.completedAt, nextQuestion, startFill]);

  const handleFollowUpMessagesChange = useCallback(async (messages: FollowUpMessage[]) => {
    if (!encounter) return;
    updateEncounter(await studyRepository.setFollowUpMessages(encounter.id, messages));
  }, [encounter, updateEncounter]);

  useEffect(() => {
    const closeSettings = () => setSettingsOpen(false);
    window.addEventListener("popstate", closeSettings);
    return () => window.removeEventListener("popstate", closeSettings);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (/^[1-5]$/.test(event.key) && question && encounter && !encounter.completedAt) {
        const option = question.options[Number(event.key) - 1];
        if (option) void handleSelect(option.id);
      }
      // Let native controls (including optional feedback) own their Enter key.
      if (event.key === "Enter" && target instanceof HTMLElement && target.closest("button, a, summary")) return;
      if (event.key === "Enter" && encounter?.completedAt) void handleNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [encounter, handleNext, handleSelect, question, settingsOpen]);

  const handleModelChange = async (model: ModelOption["id"]) => {
    await studyRepository.setSetting("selectedModel", model);
    setSelectedModel(model);
    setGenerationError("");
    setLastGenerationError("");
    retryCountRef.current = 0;
    startFill();
  };

  const handleThemeChange = async (nextTheme: Theme) => {
    setTheme(nextTheme);
    await studyRepository.setSetting("theme", nextTheme);
  };

  const handleFocusChange = async (focus: StudyFocus) => {
    await studyRepository.setStudyFocus(focus);
    focusRef.current = focus;
    setStudyFocus(focus);
    setFocusNotice("");
    setFocusError("");
    setGenerationError("");
    setLastGenerationError("");
    retryCountRef.current = 0;
    window.clearTimeout(retryTimerRef.current);
    setProgress({ ready: 0, target: QUEUE_TARGET, generating: navigator.onLine, focus });
    refreshStudySelection();
    startFill();
    try {
      const ready = await studyRepository.getFreshCount(focus);
      if (mountedRef.current && sameStudyFocus(focus, focusRef.current)) {
        setProgress((previous) => ({ ...previous, ready, generating: previous.generating && ready < QUEUE_TARGET }));
      }
    } catch {
      if (mountedRef.current && sameStudyFocus(focus, focusRef.current)) {
        setGenerationError("Could not read the local queue.");
        setLastGenerationError("Could not read the local queue.");
      }
    }
  };

  const returnToMixed = () => {
    void handleFocusChange(null).catch(() => setFocusError("Could not save question focus. Try again."));
  };

  const retry = () => {
    retryCountRef.current = 0;
    setOnline(navigator.onLine);
    startFill();
  };

  return (
    <div className="app">
      <StatusBar
        questionStartedAt={encounter?.startedAt}
        questionCompletedAt={encounter?.completedAt}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {focusNotice && <p className="focus-notice" role="status">{focusNotice}</p>}
      {focusError && <p className="focus-notice inline-error" role="alert">{focusError}</p>}
      {initialized && (studyFocus || (question && !sameStudyFocus(question.generationFocus, studyFocus))) && (
        <aside className="focus-banner" aria-label="Active question focus">
          <p><strong>{studyFocusLabel(studyFocus)}</strong>
            {question && !sameStudyFocus(question.generationFocus, studyFocus) && <small>Applies to the next question. Your current question stays open.</small>}
          </p>
          {studyFocus && question && <button className="text-button" type="button" onClick={returnToMixed}>Return to mixed practice</button>}
        </aside>
      )}

      {question && encounter ? (
        <QuestionView
          key={encounter.id}
          question={question}
          encounter={encounter}
          mode={mode}
          busy={busy}
          onSelect={handleSelect}
          onReveal={handleReveal}
          onNext={handleNext}
          onFollowUpMessagesChange={handleFollowUpMessagesChange}
        />
      ) : (
        <main className="empty-state">
          {navigationStatus === "unavailable" ? (
            <><h1>Question unavailable in this browser</h1><p>This link needs a question saved in this browser at this site address.</p><button className="primary-button" type="button" onClick={continueStudying}>Continue studying</button></>
          ) : navigationStatus === "error" ? (
            <><h1>Could not load local study data</h1><p>Your browser’s storage could not be read. Try loading the question again.</p><button className="primary-button" type="button" onClick={retryNavigation}>Try again</button></>
          ) : navigationStatus === "loading" ? (
            <><div className="loader" aria-hidden="true" /><h1>Loading question</h1></>
          ) : initialized && studyFocus ? (
            <>
              {online && progress.generating && <div className="loader" aria-hidden="true" />}
              <h1>{!online ? "You’re offline" : generationError ? "Focused generation is paused" : "Preparing a focused question"}</h1>
              <p>{!online ? "No fresh questions are ready for this focus. We’ll keep waiting for a connection, or you can return to mixed practice." : generationError || "Your next focused question will open when it’s ready. You can keep waiting or return to mixed practice."}</p>
              <button className="primary-button" type="button" onClick={retry}>Try again</button>
              <button className="text-button" type="button" onClick={returnToMixed}>Return to mixed practice</button>
            </>
          ) : !initialized || progress.generating ? (
            <><div className="loader" aria-hidden="true" /><h1>Preparing your first question</h1><p>IWorld is generating a fresh clinical vignette.</p></>
          ) : (
            <><h1>A connection is needed</h1><p>{generationError || "There are no generated questions available to review yet."}</p><button className="primary-button" type="button" onClick={retry}>Try again</button></>
          )}
        </main>
      )}

      <footer>AI-generated educational material may contain errors. Verify clinical guidance.</footer>
      <SettingsDialog
        {...progress}
        offline={!online}
        reviewMode={mode === "review"}
        generationError={generationError}
        lastGenerationError={lastGenerationError}
        open={settingsOpen}
        selectedModel={selectedModel}
        theme={theme}
        studyFocus={studyFocus}
        onClose={() => setSettingsOpen(false)}
        onOpenQuestion={(questionId, encounterId) => {
          setSettingsOpen(false);
          openQuestion(questionId, encounterId);
        }}
        onSelectModel={handleModelChange}
        onSelectTheme={handleThemeChange}
        onApplyFocus={handleFocusChange}
      />
    </div>
  );
}
