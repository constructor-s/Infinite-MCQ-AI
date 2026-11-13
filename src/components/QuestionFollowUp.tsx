import { type FormEvent, useState } from "react";
import type { ClinicalQuestion, FollowUpMessage, ModelOption } from "../lib/contracts";

type Props = {
  question: ClinicalQuestion;
  selectedModel: ModelOption["id"];
  messages: FollowUpMessage[];
  onMessagesChange: (messages: FollowUpMessage[]) => Promise<void>;
};

type FailedRequest = { messages: FollowUpMessage[]; answer?: string };

async function readAnswer(response: Response): Promise<string> {
  const raw = await response.text();
  let body: { answer?: unknown; error?: { code?: unknown; message?: unknown } } | undefined;
  try { body = JSON.parse(raw) ?? undefined; } catch { /* Preserve non-JSON server errors below. */ }
  if (!response.ok) {
    const code = typeof body?.error?.code === "string" ? body.error.code : "";
    const message = typeof body?.error?.message === "string" ? body.error.message : raw || response.statusText || "Follow-up is unavailable";
    throw new Error(`${message} (HTTP ${response.status}${code ? `; ${code}` : ""})`);
  }
  if (typeof body?.answer !== "string" || !body.answer.trim()) {
    throw new Error(`${raw || "Gemini returned no answer"} (HTTP ${response.status}; INVALID_RESPONSE)`);
  }
  return body.answer;
}

export function QuestionFollowUp({ question, selectedModel, messages: savedMessages, onMessagesChange }: Props) {
  const [draft, setDraft] = useState("");
  const [pendingMessages, setPendingMessages] = useState<FollowUpMessage[]>();
  const messages = pendingMessages ?? savedMessages;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [failedRequest, setFailedRequest] = useState<FailedRequest>();

  const send = async (nextMessages: FollowUpMessage[], savedAnswer?: string) => {
    if (sending) return;
    setPendingMessages(nextMessages);
    setSending(true);
    setError("");
    setFailedRequest(undefined);
    let answer = savedAnswer;
    try {
      if (answer === undefined) {
        const response = await fetch("/api/questions/follow-up", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: selectedModel,
            question: {
              vignette: question.vignette,
              stem: question.stem,
              options: question.options.map(({ id, text }) => ({ id, text }))
            },
            messages: nextMessages.slice(-10)
          })
        });
        answer = await readAnswer(response);
      }
      const completedMessages: FollowUpMessage[] = [...nextMessages, { role: "assistant", text: answer }];
      setPendingMessages(completedMessages);
      await onMessagesChange(completedMessages);
      setPendingMessages(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Follow-up is unavailable");
      setFailedRequest({ messages: nextMessages, answer });
    } finally {
      setSending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    void send([...messages, { role: "user", text }]);
  };

  return (
    <section className="follow-up" aria-labelledby="follow-up-heading">
      <h2 id="follow-up-heading">Ask a follow-up</h2>
      {messages.length > 0 && (
        <div className="chat-messages" aria-live="polite">
          {messages.map((message, index) => (
            <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
              <strong>{message.role === "user" ? "You" : "IWorld"}</strong>
              <p>{message.text}</p>
            </div>
          ))}
          {sending && <p className="chat-working">Answering…</p>}
        </div>
      )}
      <form className="follow-up-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="follow-up-input">Ask about this question</label>
        <textarea
          id="follow-up-input"
          rows={2}
          maxLength={2_000}
          value={draft}
          disabled={sending}
          placeholder="Ask about this question…"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={sending || !draft.trim()}>Ask</button>
      </form>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {failedRequest && <button className="text-button" type="button" disabled={sending} onClick={() => void send(failedRequest.messages, failedRequest.answer)}>Retry</button>}
    </section>
  );
}
