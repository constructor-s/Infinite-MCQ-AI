import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionFollowUp } from "./QuestionFollowUp";
import { makeQuestion } from "../test/fixtures";
import type { FollowUpMessage } from "../lib/contracts";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function ask(text = "Why this treatment?") {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

describe("QuestionFollowUp", () => {
  it("sends minimal context and the recent conversation using the current model", async () => {
    const question = makeQuestion({ model: "gemini-3.5-flash-lite" });
    const messages: FollowUpMessage[] = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `Message ${index}` }));
    const onMessagesChange = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ answer: "First paragraph.\n\nSecond paragraph." }));
    vi.stubGlobal("fetch", fetchMock);
    const props = { question, messages, onMessagesChange };
    const { rerender } = render(<QuestionFollowUp {...props} selectedModel="gemini-3.5-flash-lite" />);
    rerender(<QuestionFollowUp {...props} selectedModel="gemini-3.8-flash" />);
    ask();
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: "gemini-3.8-flash", question: {
        vignette: question.vignette, stem: question.stem,
        options: question.options.map(({ id, text }) => ({ id, text }))
      },
      messages: [...messages, { role: "user", text: "Why this treatment?" }].slice(-10)
    });
    expect(onMessagesChange.mock.calls[0][0].at(-1)).toEqual({ role: "assistant", text: "First paragraph.\n\nSecond paragraph." });
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "2000");
  });

  it("shows server errors and retries manually with the new model without duplicating the user turn", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: "UNAVAILABLE", message: "Exact provider error" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ answer: "Recovered answer" }));
    vi.stubGlobal("fetch", fetchMock);
    const props = { question: makeQuestion(), messages: [], onMessagesChange: vi.fn().mockResolvedValue(undefined) };
    const { rerender } = render(<QuestionFollowUp {...props} selectedModel="gemini-3.5-flash-lite" />);
    ask();
    expect(await screen.findByRole("alert")).toHaveTextContent("Exact provider error (HTTP 503; UNAVAILABLE)");
    expect(fetchMock).toHaveBeenCalledOnce();
    rerender(<QuestionFollowUp {...props} selectedModel="gemini-3.8-flash" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(props.onMessagesChange).toHaveBeenCalledOnce());
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second).toEqual({ ...first, model: "gemini-3.8-flash" });
    expect(props.onMessagesChange.mock.calls[0][0]).toEqual([
      { role: "user", text: "Why this treatment?" }, { role: "assistant", text: "Recovered answer" }
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows non-JSON errors verbatim as text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<h1>Gateway timed out</h1>", { status: 504 })));
    render(<QuestionFollowUp question={makeQuestion()} selectedModel="gemini-3.8-flash" messages={[]} onMessagesChange={vi.fn()} />);
    ask();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("<h1>Gateway timed out</h1> (HTTP 504)");
    expect(alert.querySelector("h1")).toBeNull();
  });

  it("keeps a generated answer visible and retries saving without another provider call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ answer: "Answer to retain" }));
    vi.stubGlobal("fetch", fetchMock);
    const onMessagesChange = vi.fn().mockRejectedValueOnce(new Error("Local save failed")).mockResolvedValueOnce(undefined);
    render(<QuestionFollowUp question={makeQuestion()} selectedModel="gemini-3.8-flash" messages={[]} onMessagesChange={onMessagesChange} />);
    ask();
    expect(await screen.findByRole("alert")).toHaveTextContent("Local save failed");
    expect(screen.getByText("Answer to retain")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onMessagesChange.mock.calls[0]).toEqual(onMessagesChange.mock.calls[1]);
  });
});
