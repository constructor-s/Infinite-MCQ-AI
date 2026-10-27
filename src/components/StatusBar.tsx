import { useEffect, useState } from "react";

type Props = {
  questionStartedAt?: string;
  questionCompletedAt?: string;
  onOpenSettings: () => void;
};

function elapsedSeconds(startedAt: string, completedAt?: string): number {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1_000));
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function StatusBar({
  questionStartedAt,
  questionCompletedAt,
  onOpenSettings
}: Props) {
  const [questionSeconds, setQuestionSeconds] = useState(() =>
    questionStartedAt ? elapsedSeconds(questionStartedAt, questionCompletedAt) : 0
  );

  useEffect(() => {
    if (!questionStartedAt) return;

    const updateTimer = () => setQuestionSeconds(elapsedSeconds(questionStartedAt, questionCompletedAt));
    updateTimer();
    if (questionCompletedAt) return;

    const interval = window.setInterval(updateTimer, 1_000);
    return () => window.clearInterval(interval);
  }, [questionCompletedAt, questionStartedAt]);

  return (
    <header className="status-bar">
      {questionStartedAt && (
        <span className="question-timer" aria-label={`Question time ${formatElapsed(questionSeconds)}`}>
          {formatElapsed(questionSeconds)}
        </span>
      )}
      <button className="icon-button" type="button" aria-label="Open settings" onClick={onOpenSettings}>⚙︎</button>
    </header>
  );
}
