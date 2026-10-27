import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentQuestionTopic } from "../db/repository";
import { makeQuestion } from "../test/fixtures";
import { SettingsDialog } from "./SettingsDialog";
import { studyRepository, type CorrectRates } from "../db/repository";

vi.mock("../db/repository", () => ({ studyRepository: { getCorrectRates: vi.fn(), getRecentQuestionTopics: vi.fn() } }));

const props = {
  open: true,
  ready: 4,
  target: 10,
  generating: false,
  offline: false,
  reviewMode: false,
  selectedModel: "gemini-3.5-flash-lite",
  theme: "light" as const,
  onClose: vi.fn(),
  onSelectModel: vi.fn(async () => undefined),
  onSelectTheme: vi.fn(async () => undefined)
};

describe("SettingsDialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.mocked(studyRepository.getRecentQuestionTopics).mockReset().mockResolvedValue([]);
    vi.mocked(studyRepository.getCorrectRates).mockReset().mockResolvedValue({
      lastHour: { correct: 0, total: 0 }, last24Hours: { correct: 0, total: 0 }, recent20: { correct: 0, total: 0 }, recent100: { correct: 0, total: 0 }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })));
  });

  it("shows completed question titles and readable dimensions", async () => {
    vi.mocked(studyRepository.getRecentQuestionTopics).mockResolvedValue([{ ...makeQuestion({
      topicTitle: "Consent", blueprint: { discipline: "phelo", physicianActivity: "professional_behaviours",
        careDimension: "psychosocial", cognitiveTask: "capacity_consent", mccObjectiveIds: ["14"] }
    }), outcome: "correct" }]);
    render(<SettingsDialog {...props} />);
    expect(await screen.findByLabelText("Correct")).toHaveClass("is-correct");
    expect(await screen.findByText("Consent")).toBeInTheDocument();
    for (const label of ["Population health, ethics, and legal obligations", "Professional behaviours", "Psychosocial", "Capacity / consent"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText(/ongoing central chest pressure/)).not.toBeInTheDocument();
  });

  it("labels incorrect and unavailable outcomes without relying on color", async () => {
    vi.mocked(studyRepository.getRecentQuestionTopics).mockResolvedValue([
      { ...makeQuestion(), outcome: "incorrect" }, { ...makeQuestion(), outcome: "unknown" }
    ]);
    render(<SettingsDialog {...props} />);
    expect(await screen.findByLabelText("Incorrect")).toHaveClass("is-incorrect");
    expect(screen.getByLabelText("Result unavailable")).toBeInTheDocument();
  });

  it("loads history again on reopening and ignores stale results", async () => {
    let resolveOld!: (questions: RecentQuestionTopic[]) => void;
    vi.mocked(studyRepository.getRecentQuestionTopics).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(<SettingsDialog {...props} />);
    expect(screen.getByText("Loading recent question topics…")).toBeInTheDocument();
    rerender(<SettingsDialog {...props} open={false} />);
    rerender(<SettingsDialog {...props} />);
    expect(await screen.findByText("No completed questions yet.")).toBeInTheDocument();
    await act(async () => resolveOld([{ ...makeQuestion({ topicTitle: "Stale title" }), outcome: "incorrect" }]));
    expect(screen.queryByText("Stale title")).not.toBeInTheDocument();
    rerender(<SettingsDialog {...props} open={false} />);
    vi.mocked(studyRepository.getRecentQuestionTopics).mockRejectedValueOnce(new Error("Unavailable"));
    rerender(<SettingsDialog {...props} />);
    expect(await screen.findByText("Could not load recent question topics.")).toBeInTheDocument();
  });

  it("updates queue status at the bottom, after model errors, and hides it when closed", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Models offline"));
    const { rerender } = render(<SettingsDialog {...props} />);
    await screen.findByRole("alert");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Ready · 4/10");
    expect(screen.getByRole("dialog").lastElementChild).toBe(screen.getByRole("region", { name: "Recent question topics" }));
    expect(status.compareDocumentPosition(screen.getByRole("region", { name: "Recent question topics" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const [state, text] of [
      [{ generating: true }, "Generating · 4/10 ready"],
      [{ offline: true }, "Offline · 4/10 ready"],
      [{ offline: true, reviewMode: true }, "Offline · Review"],
      [{ generationError: "Failed" }, "Generation paused · 4/10 ready"],
      [{ generationError: "Failed", reviewMode: true }, "Generation paused · Review"]
    ] as const) {
      rerender(<SettingsDialog {...props} {...state} />);
      expect(screen.getByRole("status")).toHaveTextContent(text);
    }
    rerender(<SettingsDialog {...props} open={false} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows auto, light, and dark choices and reports a theme change", async () => {
    const onSelectTheme = vi.fn(async () => undefined);
    render(
      <SettingsDialog
        {...props}
        selectedModel="gemini-3.5-flash-lite"
        theme="light"
        onClose={vi.fn()}
        onSelectModel={vi.fn(async () => undefined)}
        onSelectTheme={onSelectTheme}
      />
    );

    expect(screen.getByRole("radio", { name: "Auto" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Auto" }));
    expect(onSelectTheme).toHaveBeenCalledWith("auto");
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onSelectTheme).toHaveBeenCalledWith("dark");
    await screen.findAllByText("0/0");
  });

  it("shows rounded percentages and actual sample sizes independently of model availability", async () => {
    vi.mocked(studyRepository.getCorrectRates).mockResolvedValue({
      lastHour: { correct: 0, total: 2 }, last24Hours: { correct: 3, total: 4 }, recent20: { correct: 2, total: 3 }, recent100: { correct: 15, total: 23 }
    });
    vi.mocked(fetch).mockRejectedValue(new Error("Models offline"));
    render(<SettingsDialog {...props} />);
    expect(await screen.findByText("67% · 2/3")).toBeInTheDocument();
    expect(screen.getByText("65% · 15/23")).toBeInTheDocument();
    expect(screen.getByText("0% · 0/2")).toBeInTheDocument();
    expect(screen.getByText("75% · 3/4")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Models offline");
  });

  it("shows loading followed by empty history", async () => {
    let resolve!: (rates: CorrectRates) => void;
    vi.mocked(studyRepository.getCorrectRates).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<SettingsDialog {...props} />);
    expect(screen.getByText("Loading correct rates…")).toBeInTheDocument();
    await act(async () => resolve({ lastHour: { correct: 0, total: 0 }, last24Hours: { correct: 0, total: 0 }, recent20: { correct: 0, total: 0 }, recent100: { correct: 0, total: 0 } }));
    expect(screen.getAllByText("0/0")).toHaveLength(4);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("shows a local history failure and retries when reopened", async () => {
    vi.mocked(studyRepository.getCorrectRates).mockRejectedValueOnce(new Error("Storage unavailable"));
    const { rerender } = render(<SettingsDialog {...props} />);
    expect(await screen.findByText("Could not load correct rates.")).toBeInTheDocument();
    rerender(<SettingsDialog {...props} open={false} />);
    vi.mocked(studyRepository.getCorrectRates).mockResolvedValue({
      lastHour: { correct: 0, total: 0 }, last24Hours: { correct: 0, total: 0 }, recent20: { correct: 15, total: 20 }, recent100: { correct: 60, total: 100 }
    });
    rerender(<SettingsDialog {...props} />);
    expect(await screen.findByText("75% · 15/20")).toBeInTheDocument();
    expect(screen.getByText("60% · 60/100")).toBeInTheDocument();
    expect(screen.queryByText("Could not load correct rates.")).not.toBeInTheDocument();
  });

  it("ignores a previous open's result after closing and reopening", async () => {
    let resolveOld!: (rates: CorrectRates) => void;
    vi.mocked(studyRepository.getCorrectRates).mockReturnValueOnce(new Promise((done) => { resolveOld = done; }));
    const { rerender } = render(<SettingsDialog {...props} />);
    rerender(<SettingsDialog {...props} open={false} />);
    rerender(<SettingsDialog {...props} />);
    await screen.findAllByText("0/0");
    await act(async () => resolveOld({ lastHour: { correct: 0, total: 0 }, last24Hours: { correct: 0, total: 0 }, recent20: { correct: 20, total: 20 }, recent100: { correct: 100, total: 100 } }));
    const section = screen.getByRole("region", { name: "Correct rate" });
    await waitFor(() => expect(within(section).getAllByText("0/0")).toHaveLength(4));
  });
});
