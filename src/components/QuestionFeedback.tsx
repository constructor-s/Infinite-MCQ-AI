import { useEffect, useRef, useState } from "react";
import { studyRepository, type LocalStudyRepository } from "../db/repository";
import type { QuestionFeedback as Feedback } from "../db/database";

type Props = {
  questionId: string;
  encounterId: string;
  repository?: Pick<LocalStudyRepository, "getQuestionFeedback" | "setQuestionFeedback">;
};

// Key the stateful child so late reads/writes cannot affect another question.
export function QuestionFeedback(props: Props) {
  return <FeedbackControl key={props.questionId} {...props} />;
}

function FeedbackControl({ questionId, encounterId, repository = studyRepository }: Props) {
  const [rating, setRating] = useState<Feedback["rating"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void repository.getQuestionFeedback(questionId).then((vote) => {
      if (active) setRating(vote?.rating ?? null);
    }).catch(() => {
      if (active) setError("Couldn't load feedback.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [questionId, repository]);

  async function vote(value: Feedback["rating"]) {
    if (loading || savingRef.current) return;
    savingRef.current = true;
    const previous = rating;
    const next = rating === value ? null : value;
    setRating(next);
    setSaving(true);
    setError("");
    try {
      await repository.setQuestionFeedback(questionId, encounterId, next);
    } catch {
      if (mounted.current) { setRating(previous); setError("Couldn't save feedback."); }
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div className="question-feedback" role="group" aria-label="Question quality feedback">
      {(["up", "down"] as const).map((value) => {
        const label = value === "up" ? "Good question" : "Needs improvement";
        return (
          <button key={value} type="button" className="feedback-thumb" title={label} aria-label={label}
            aria-pressed={rating === value} disabled={loading || saving} onClick={() => void vote(value)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              style={value === "down" ? { transform: "rotate(180deg)" } : undefined}>
              <path d="M7 10v11H3V10h4Zm0 0 5-8c2 0 3 1 2 5l-1 3h6a2 2 0 0 1 2 2l-2 7a3 3 0 0 1-3 2H7" />
            </svg>
          </button>
        );
      })}
      <span className="feedback-error" role="status">{error}</span>
    </div>
  );
}
