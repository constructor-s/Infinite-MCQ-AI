import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusBar } from "./StatusBar";

const baseProps = {
  onOpenSettings: vi.fn()
};

describe("StatusBar question timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T14:00:05.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps settings accessible without queue status", () => {
    render(<StatusBar {...baseProps} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(baseProps.onOpenSettings).toHaveBeenCalled();
  });

  it("shows persisted elapsed time and advances for an active question", () => {
    render(<StatusBar {...baseProps} questionStartedAt="2026-10-11T14:00:00.000Z" />);

    expect(screen.getByLabelText("Question time 0:05")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByLabelText("Question time 0:07")).toBeInTheDocument();
  });

  it("freezes at the completion time", () => {
    render(
      <StatusBar
        {...baseProps}
        questionStartedAt="2026-10-11T13:58:59.000Z"
        questionCompletedAt="2026-10-11T14:00:03.000Z"
      />
    );

    expect(screen.getByLabelText("Question time 1:04")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByLabelText("Question time 1:04")).toBeInTheDocument();
  });

  it("resets when a new encounter loads and hides without one", () => {
    const { container, rerender } = render(
      <StatusBar {...baseProps} questionStartedAt="2026-10-11T14:00:00.000Z" />
    );
    expect(screen.getByLabelText("Question time 0:05")).toBeInTheDocument();

    rerender(<StatusBar {...baseProps} questionStartedAt="2026-10-11T14:00:04.000Z" />);
    expect(screen.getByLabelText("Question time 0:01")).toBeInTheDocument();

    rerender(<StatusBar {...baseProps} />);
    expect(container.querySelector(".question-timer")).not.toBeInTheDocument();
  });
});
