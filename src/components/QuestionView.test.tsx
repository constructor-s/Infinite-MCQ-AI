import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionView } from "./QuestionView";
import { makeQuestion } from "../test/fixtures";
import type { Encounter } from "../lib/contracts";

function makeEncounter(overrides: Partial<Encounter> = {}): Encounter {
  return {
    id: crypto.randomUUID(), questionId: "question", topicId: "cardio.acs", mode: "fresh",
    blueprint: makeQuestion().blueprint,
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), selectedOptionIds: [],
    revealedAnswer: false, eventuallyCorrect: false, ...overrides
  };
}

const viewHandlers = () => ({
  selectedModel: "gemini-3.5-flash-lite" as const,
  onSelect: vi.fn(), onReveal: vi.fn(), onNext: vi.fn(), onFollowUpMessagesChange: vi.fn()
});

describe("QuestionView", () => {
  it("does not reveal the topic and uses a paragraph vignette", () => {
    const question = makeQuestion();
    render(<QuestionView question={question} encounter={makeEncounter()} mode="fresh" busy={false} {...viewHandlers()} />);
    expect(screen.queryByText(question.topicTitle)).not.toBeInTheDocument();
    expect(screen.getByText(question.vignette)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Good question" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^[A-E]/ })).toHaveLength(5);
  });

  it("shows the selected distractor hint without revealing the answer", () => {
    const question = makeQuestion();
    render(<QuestionView question={question} encounter={makeEncounter({ selectedOptionIds: ["B"] })} mode="fresh" busy={false} {...viewHandlers()} />);
    expect(screen.getByText(question.options[1].hint)).toBeInTheDocument();
    expect(screen.queryByText(/Answer: A/)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Ask about this question" })).not.toBeInTheDocument();
  });

  it("reveals explanations and enables Next after resolution", () => {
    const question = makeQuestion();
    const onNext = vi.fn();
    render(<QuestionView question={question} encounter={makeEncounter({ selectedOptionIds: ["A"], eventuallyCorrect: true, completedAt: new Date().toISOString() })} mode="fresh" busy={false} {...viewHandlers()} onNext={onNext} />);
    expect(screen.getByText("Answer: A")).toBeInTheDocument();
    expect(screen.getByText(question.highYieldPearl, { exact: false })).toBeInTheDocument();
    const details = screen.getByText("Review all answer options").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    for (const option of question.options) {
      const explanations = screen.getAllByText(option.explanation);
      expect(explanations).toHaveLength(1);
      expect(details).toContainElement(explanations[0]);
    }
    expect(screen.getByRole("button", { name: "Good question" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ask about this question" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("restores persisted follow-up messages", () => {
    const question = makeQuestion();
    const encounter = makeEncounter({
      completedAt: new Date().toISOString(),
      followUpMessages: [
        { role: "user", text: "Why reperfusion?" },
        { role: "assistant", text: "Because this is an acute STEMI." }
      ]
    });
    render(<QuestionView question={question} encounter={encounter} mode="fresh" busy={false} {...viewHandlers()} />);
    expect(screen.getByText("Why reperfusion?")).toBeInTheDocument();
    expect(screen.getByText("Because this is an acute STEMI.")).toBeInTheDocument();
  });
});
