import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionFeedback as Feedback } from "../db/database";
import { QuestionFeedback } from "./QuestionFeedback";

function repository() {
  return { getQuestionFeedback: vi.fn<() => Promise<Feedback | undefined>>(async () => undefined), setQuestionFeedback: vi.fn(async () => {}) };
}

describe("optional question feedback", () => {
  afterEach(cleanup);
  it("loads, saves, switches and clears a vote without requiring input", async () => {
    const store = repository();
    render(<QuestionFeedback questionId="one" encounterId="attempt" repository={store} />);
    const up = screen.getByRole("button", { name: "Good question" });
    const down = screen.getByRole("button", { name: "Needs improvement" });
    await waitFor(() => expect(up).toBeEnabled());
    fireEvent.click(up);
    await waitFor(() => expect(up).toBeEnabled());
    expect(up).toHaveAttribute("aria-pressed", "true");
    expect(store.setQuestionFeedback).toHaveBeenLastCalledWith("one", "attempt", "up");
    fireEvent.click(down);
    await waitFor(() => expect(down).toBeEnabled());
    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(down).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(down);
    await waitFor(() => expect(down).toBeEnabled());
    expect(store.setQuestionFeedback).toHaveBeenLastCalledWith("one", "attempt", null);
    expect(down).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("restores a saved rating when a question is reopened", async () => {
    const store = repository();
    store.getQuestionFeedback.mockResolvedValue({ questionId: "one", encounterId: "old-attempt", rating: "down", createdAt: "2026-10-30", updatedAt: "2026-10-30" });
    render(<QuestionFeedback questionId="one" encounterId="new-attempt" repository={store} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Needs improvement" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("rolls back a failed write and keeps the control usable", async () => {
    const store = repository();
    store.setQuestionFeedback.mockRejectedValueOnce(new Error("Storage unavailable"));
    render(<QuestionFeedback questionId="one" encounterId="attempt" repository={store} />);
    const down = screen.getByRole("button", { name: "Needs improvement" });
    await waitFor(() => expect(down).toBeEnabled());
    fireEvent.click(down);
    await screen.findByText("Couldn't save feedback.");
    expect(down).toHaveAttribute("aria-pressed", "false");
    expect(down).toBeEnabled();
  });

  it("ignores a previous question's late read after navigation", async () => {
    let resolveOld!: (value: undefined) => void;
    const store = repository();
    store.getQuestionFeedback.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(<QuestionFeedback questionId="old" encounterId="old-attempt" repository={store} />);
    rerender(<QuestionFeedback questionId="new" encounterId="new-attempt" repository={store} />);
    const up = screen.getByRole("button", { name: "Good question" });
    await waitFor(() => expect(up).toBeEnabled());
    fireEvent.click(up);
    await waitFor(() => expect(up).toBeEnabled());
    resolveOld(undefined);
    await waitFor(() => expect(up).toHaveAttribute("aria-pressed", "true"));
    expect(store.setQuestionFeedback).toHaveBeenLastCalledWith("new", "new-attempt", "up");
  });
});
