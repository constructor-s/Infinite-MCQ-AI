import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog";
import { studyRepository, type CorrectRates } from "../db/repository";

vi.mock("../db/repository", () => ({ studyRepository: { getCorrectRates: vi.fn() } }));

const props = {
  open: true,
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
    vi.mocked(studyRepository.getCorrectRates).mockReset().mockResolvedValue({
      recent20: { correct: 0, total: 0 }, recent100: { correct: 0, total: 0 }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })));
  });

  it("shows auto, light, and dark choices and reports a theme change", async () => {
    const onSelectTheme = vi.fn(async () => undefined);
    render(
      <SettingsDialog
        open
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
    await screen.findAllByText("No answers yet");
  });

  it("shows rounded percentages and actual sample sizes independently of model availability", async () => {
    vi.mocked(studyRepository.getCorrectRates).mockResolvedValue({
      recent20: { correct: 2, total: 3 }, recent100: { correct: 15, total: 23 }
    });
    vi.mocked(fetch).mockRejectedValue(new Error("Models offline"));
    render(<SettingsDialog {...props} />);
    expect(await screen.findByText("67% · 2/3")).toBeInTheDocument();
    expect(screen.getByText("65% · 15/23")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Models offline");
  });

  it("shows loading followed by empty history", async () => {
    let resolve!: (rates: CorrectRates) => void;
    vi.mocked(studyRepository.getCorrectRates).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<SettingsDialog {...props} />);
    expect(screen.getByText("Loading correct rates…")).toBeInTheDocument();
    await act(async () => resolve({ recent20: { correct: 0, total: 0 }, recent100: { correct: 0, total: 0 } }));
    expect(screen.getAllByText("No answers yet")).toHaveLength(2);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("shows a local history failure and retries when reopened", async () => {
    vi.mocked(studyRepository.getCorrectRates).mockRejectedValueOnce(new Error("Storage unavailable"));
    const { rerender } = render(<SettingsDialog {...props} />);
    expect(await screen.findByText("Could not load correct rates.")).toBeInTheDocument();
    rerender(<SettingsDialog {...props} open={false} />);
    vi.mocked(studyRepository.getCorrectRates).mockResolvedValue({
      recent20: { correct: 15, total: 20 }, recent100: { correct: 60, total: 100 }
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
    await screen.findAllByText("No answers yet");
    await act(async () => resolveOld({ recent20: { correct: 20, total: 20 }, recent100: { correct: 100, total: 100 } }));
    const section = screen.getByRole("region", { name: "Correct rate" });
    await waitFor(() => expect(within(section).getAllByText("No answers yet")).toHaveLength(2));
  });
});
