import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionView } from "./QuestionView";
import { makeQuestion } from "../test/fixtures";
import type { Encounter } from "../lib/contracts";

function makeEncounter(overrides: Partial<Encounter> = {}): Encounter {
  return {
    id: crypto.randomUUID(), questionId: "question", topicId: "cardio.acs", mode: "fresh",
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), selectedOptionIds: [],
    revealedAnswer: false, eventuallyCorrect: false, ...overrides
  };
}

describe("QuestionView", () => {
  it("does not reveal the topic and uses exam-style clinical section tables", () => {
    const question = makeQuestion();
    render(<QuestionView question={question} encounter={makeEncounter()} mode="fresh" busy={false} onSelect={vi.fn()} onReveal={vi.fn()} onNext={vi.fn()} />);
    expect(screen.queryByText(question.topicTitle)).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Measurement" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Examination" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Investigations" })).toBeInTheDocument();
  });

  it("shows the selected distractor hint without revealing the answer", () => {
    const question = makeQuestion();
    render(<QuestionView question={question} encounter={makeEncounter({ selectedOptionIds: ["B"] })} mode="fresh" busy={false} onSelect={vi.fn()} onReveal={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(question.options[1].hint)).toBeInTheDocument();
    expect(screen.queryByText(/Answer: A/)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Ask about this question" })).not.toBeInTheDocument();
  });

  it("reveals explanations and enables Next after resolution", () => {
    const question = makeQuestion();
    const onNext = vi.fn();
    render(<QuestionView question={question} encounter={makeEncounter({ selectedOptionIds: ["A"], eventuallyCorrect: true, completedAt: new Date().toISOString() })} mode="fresh" busy={false} onSelect={vi.fn()} onReveal={vi.fn()} onNext={onNext} />);
    expect(screen.getByText("Answer: A")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ask about this question" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(onNext).toHaveBeenCalledOnce();
  });
});
