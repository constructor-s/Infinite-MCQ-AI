import { type FormEvent, useState } from "react";
import type { ClinicalQuestion } from "../lib/contracts";

type ChatMessage = { role: "user" | "assistant"; text: string };

export function QuestionFollowUp({ question }: { question: ClinicalQuestion }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", text }];
    setMessages(nextMessages);
    setDraft("");
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/questions/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, messages: nextMessages.slice(-10) })
      });
      const body = await response.json() as { answer?: string; error?: { message?: string } };
      if (!response.ok || !body.answer) throw new Error(body.error?.message || "Follow-up is unavailable");
      setMessages((current) => [...current, { role: "assistant", text: body.answer! }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Follow-up is unavailable");
    } finally {
      setSending(false);
    }
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
    </section>
  );
}
