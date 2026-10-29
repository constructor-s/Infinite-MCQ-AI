import { useCallback, useEffect, useRef, useState } from "react";
import { studyRepository } from "../db/repository";
import type { ClinicalQuestion, Encounter } from "../lib/contracts";
import { historyEncounterId, parseQuestionRoute, writeQuestionHistory, type HistoryAction } from "../lib/questionNavigation";

type DisplayedQuestion = { question: ClinicalQuestion; encounter: Encounter };
type Status = "loading" | "ready" | "empty" | "unavailable" | "error";
type Request =
  | { kind: "location"; pathname: string; state: unknown }
  | { kind: "saved"; questionId: string; encounterId: string }
  | { kind: "next"; historyAction: HistoryAction; completed?: DisplayedQuestion };

export function useQuestionNavigation() {
  const [displayed, setDisplayed] = useState<DisplayedQuestion>();
  const [status, setStatus] = useState<Status>("loading");
  const currentRef = useRef<DisplayedQuestion | undefined>(undefined);
  const statusRef = useRef<Status>("loading");
  const requestRef = useRef<Request | undefined>(undefined);
  const versionRef = useRef(0);
  const sequenceRef = useRef(Promise.resolve());

  const navigate = useCallback((request: Request): Promise<void> => {
    const version = ++versionRef.current;
    const active = () => version === versionRef.current;
    requestRef.current = request;
    currentRef.current = undefined;
    statusRef.current = "loading";
    setDisplayed(undefined);
    setStatus("loading");

    // Only one selection/restoration runs at a time. New requests supersede
    // pending work; refill callbacks cannot start duplicate selections.
    const task = sequenceRef.current.then(async () => {
      if (!active()) return;
      const finish = (nextStatus: Status) => {
        if (!active()) return;
        statusRef.current = nextStatus;
        setStatus(nextStatus);
      };
      try {
        let historyAction: HistoryAction = "replace";
        let next: DisplayedQuestion | undefined;
        const route = request.kind === "location" ? parseQuestionRoute(request.pathname) : undefined;
        if (route?.kind === "unavailable") {
          finish("unavailable");
          return;
        }

        if (request.kind === "saved" || route?.kind === "question") {
          const questionId = request.kind === "saved" ? request.questionId : route?.kind === "question" ? route.questionId : "";
          const encounterId = request.kind === "saved" ? request.encounterId : request.kind === "location" ? historyEncounterId(request.state) : undefined;
          const question = await studyRepository.getQuestionById(questionId);
          if (!active()) return;
          if (!question) { finish("unavailable"); return; }
          let encounter = await studyRepository.getSavedEncounter(questionId, encounterId);
          if (!active()) return;
          if (!encounter && await studyRepository.isQueued(questionId)) {
            if (!active()) return;
            encounter = await studyRepository.beginEncounter(question, "fresh");
          }
          if (!encounter) { finish("unavailable"); return; }
          next = { question, encounter };
          historyAction = request.kind === "saved" ? "push" : "replace";
        } else {
          // A home route uses the same study selection as Next.
          const selection: Extract<Request, { kind: "next" }> = request.kind === "next" ? request : { kind: "next", historyAction: "replace" };
          historyAction = selection.historyAction;
          const completed = selection.completed;
          if (completed?.encounter.mode === "fresh") {
            await studyRepository.removeFromQueue(completed.question.id);
            if (!active()) return;
          }
          const fresh = await studyRepository.getFreshQuestions();
          if (!active()) return;
          let question: ClinicalQuestion | undefined = fresh[0];
          const mode = question ? "fresh" : "review";
          if (!question) {
            question = await studyRepository.getReviewQuestion(completed?.question.id);
            if (!active()) return;
          }
          if (!question) {
            // Remember the intended history action when generation fills an
            // initially empty queue later.
            requestRef.current = { kind: "next", historyAction };
            finish("empty");
            return;
          }
          const encounter = await studyRepository.beginEncounter(question, mode);
          next = { question, encounter };
        }

        if (!active()) return;
        writeQuestionHistory(historyAction, next.question.id, next.encounter.id);
        currentRef.current = next;
        setDisplayed(next);
        finish("ready");
        window.scrollTo({ top: 0, behavior: "auto" });
      } catch {
        finish("error");
      }
    });
    sequenceRef.current = task;
    return task;
  }, []);

  const loadLocation = useCallback(() => navigate({ kind: "location", pathname: location.pathname, state: history.state }), [navigate]);

  useEffect(() => {
    void loadLocation();
    const onPopState = () => { void loadLocation(); };
    window.addEventListener("popstate", onPopState);
    return () => {
      ++versionRef.current;
      currentRef.current = undefined;
      window.removeEventListener("popstate", onPopState);
    };
  }, [loadLocation]);

  const openQuestion = useCallback((questionId: string, encounterId: string) => {
    if (currentRef.current?.question.id === questionId && currentRef.current.encounter.id === encounterId) return;
    void navigate({ kind: "saved", questionId, encounterId });
  }, [navigate]);

  const nextQuestion = useCallback(() => {
    const completed = currentRef.current;
    if (!completed?.encounter.completedAt) return Promise.resolve();
    return navigate({ kind: "next", historyAction: "push", completed });
  }, [navigate]);

  const resumeWhenReady = useCallback(() => {
    if (statusRef.current !== "empty" || requestRef.current?.kind !== "next") return;
    void navigate(requestRef.current);
  }, [navigate]);

  const retryNavigation = useCallback(() => {
    if (requestRef.current) void navigate(requestRef.current);
  }, [navigate]);

  const continueStudying = useCallback(() => {
    history.replaceState({}, "", "/");
    void navigate({ kind: "next", historyAction: "replace" });
  }, [navigate]);

  const updateEncounter = useCallback((encounter: Encounter) => {
    const current = currentRef.current;
    if (!current || current.encounter.id !== encounter.id) return;
    const updated = { ...current, encounter };
    currentRef.current = updated;
    setDisplayed(updated);
  }, []);

  return { displayed, status, openQuestion, nextQuestion, resumeWhenReady, retryNavigation, continueStudying, updateEncounter };
}
