import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { db } from "./db/database";
import { studyRepository } from "./db/repository";
import { questionQueue, type QueueProgress } from "./services/questionQueue";
import { makeQuestion } from "./test/fixtures";
import type { ClinicalQuestion } from "./lib/contracts";
import { questionUrl } from "./lib/questionNavigation";

vi.mock("./services/questionQueue", async (importOriginal) => ({
  ...await importOriginal<typeof import("./services/questionQueue")>(),
  questionQueue: { fill: vi.fn(async () => undefined) },
  fetchModels: vi.fn(async () => ({ models: [] }))
}));

let onProgress: ((progress: QueueProgress) => void) | undefined;

async function enqueue(...questions: ClinicalQuestion[]) {
  for (const [index, question] of questions.entries()) {
    await studyRepository.enqueue(question);
    await db.queueItems.where("questionId").equals(question.id)
      .modify({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() });
  }
}

async function complete(question: ClinicalQuestion) {
  await studyRepository.enqueue(question);
  const encounter = await studyRepository.beginEncounter(question, "fresh");
  const completed = await studyRepository.recordSelection(encounter.id, "A", true);
  await studyRepository.removeFromQueue(question.id);
  return completed;
}

async function traverse(direction: "back" | "forward") {
  await act(async () => {
    const popped = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
    history[direction]();
    await popped;
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("question navigation", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(db.tables.map((table) => table.clear()));
    // Start a new branch so a prior test's forward entries do not affect length.
    history.pushState(null, "", "/");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
    })));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ answer: "Saved explanation" }))));
    onProgress = undefined;
    vi.mocked(questionQueue.fill).mockReset().mockImplementation(async (callback) => { onProgress = callback; });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("applies focus to Next, preserves answers and saved history, and returns to the mixed queue", async () => {
    const focus = { discipline: "medicine" as const, objectiveId: "14" };
    const first = makeQuestion({ stem: "Which mixed treatment is most appropriate?" });
    const second = makeQuestion({ stem: "Which remaining mixed treatment is most appropriate?" });
    const focused = makeQuestion({ generationFocus: focus, stem: "Which focused treatment is most appropriate?" });
    await enqueue(first, second, focused);
    render(<App />);
    await screen.findByRole("heading", { name: first.stem });
    fireEvent.click(screen.getByRole("button", { name: /B\s*Outpatient/ }));
    await screen.findByText(first.options[1].hint);
    const originalEncounterId = history.state.iworldEncounterId;
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.change(screen.getByLabelText("Practice"), { target: { value: "focused" } });
    fireEvent.change(screen.getByLabelText("MCC topic"), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply focus" }));
    await screen.findByText(/Focus saved/);
    expect(await studyRepository.getStudyFocus()).toEqual(focus);
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.getByRole("heading", { name: first.stem })).toBeInTheDocument();
    expect(screen.getByText(first.options[1].hint)).toBeInTheDocument();
    expect(history.state.iworldEncounterId).toBe(originalEncounterId);
    expect(screen.getByText(/Applies to the next question/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /A\s*Immediate/ }));
    await screen.findByText("Answer: A");
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await screen.findByRole("heading", { name: focused.stem });
    expect(screen.queryByText(/Applies to the next question/)).not.toBeInTheDocument();
    const focusedEncounterId = history.state.iworldEncounterId;
    await traverse("back");
    await screen.findByRole("heading", { name: first.stem });
    expect(history.state.iworldEncounterId).toBe(originalEncounterId);
    expect(screen.getByText("Answer: A")).toBeInTheDocument();
    await traverse("forward");
    await screen.findByRole("heading", { name: focused.stem });
    fireEvent.click(screen.getByRole("button", { name: /B\s*Outpatient/ }));
    await screen.findByText(focused.options[1].hint);
    fireEvent.click(screen.getByRole("button", { name: "Return to mixed practice" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Return to mixed practice" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: focused.stem })).toBeInTheDocument();
    expect(screen.getByText(focused.options[1].hint)).toBeInTheDocument();
    expect(history.state.iworldEncounterId).toBe(focusedEncounterId);
    fireEvent.click(screen.getByRole("button", { name: /A\s*Immediate/ }));
    await screen.findByText("Answer: A");
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await screen.findByRole("heading", { name: second.stem });
    expect(await studyRepository.getStudyFocus()).toBeNull();
    expect((await studyRepository.getCorrectRates()).recent20).toEqual({ correct: 0, total: 2 });
  });

  it("restores focused practice after reload and waits for fresh questions instead of reviewing", async () => {
    const focus = { discipline: "medicine" as const, objectiveId: "14" };
    const past = makeQuestion({ stem: "Which old treatment is most appropriate?", generationFocus: focus });
    await complete(past);
    await studyRepository.setStudyFocus(focus);
    const view = render(<App />);
    await screen.findByRole("heading", { name: "You’re offline" });
    expect(screen.queryByText("Review question")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: past.stem })).not.toBeInTheDocument();
    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { name: "You’re offline" });
    expect(await studyRepository.getStudyFocus()).toEqual(focus);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(onProgress).toBeDefined());
    const focused = makeQuestion({ generationFocus: focus, stem: "Which fresh focused treatment is most appropriate?" });
    await enqueue(focused);
    await act(async () => onProgress?.({ ready: 1, target: 3, generating: true, focus }));
    await screen.findByRole("heading", { name: focused.stem });
    expect(screen.queryByText("Review question")).not.toBeInTheDocument();
  });

  it("returns immediately from focused waiting to the preserved mixed queue", async () => {
    const mixed = makeQuestion({ stem: "Which queued mixed treatment is most appropriate?" });
    await enqueue(mixed);
    await studyRepository.setStudyFocus({ discipline: "psychiatry" });
    render(<App />);
    await screen.findByRole("heading", { name: "You’re offline" });
    fireEvent.click(screen.getByRole("button", { name: "Return to mixed practice" }));
    await screen.findByRole("heading", { name: mixed.stem });
    expect(await studyRepository.getStudyFocus()).toBeNull();
  });

  it("shows a focused-generation failure with retry and a path back to mixed practice", async () => {
    await studyRepository.setStudyFocus({ discipline: "medicine", objectiveId: "14" });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.mocked(questionQueue.fill).mockRejectedValueOnce(new Error("Generation unavailable"));
    render(<App />);
    await screen.findByRole("heading", { name: "Focused generation is paused" });
    expect(screen.getByText("Generation unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(questionQueue.fill).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Return to mixed practice" })).toBeInTheDocument();
  });

  it("resets an obsolete persisted focus and shows a brief notice", async () => {
    await studyRepository.setSetting("studyFocus", { discipline: "medicine", objectiveId: "removed" });
    const mixed = makeQuestion();
    await enqueue(mixed);
    render(<StrictMode><App /></StrictMode>);
    await screen.findByRole("heading", { name: mixed.stem });
    expect(await screen.findByText("Your saved focus is no longer available. Returned to mixed practice.")).toBeInTheDocument();
    expect(await studyRepository.getStudyFocus()).toBeNull();
  });

  it("ignores progress from the inactive queue after changing focus during generation", async () => {
    const mixed = makeQuestion();
    await enqueue(mixed);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const pending = deferred<void>();
    vi.mocked(questionQueue.fill).mockImplementation((callback) => { onProgress = callback; return pending.promise; });
    render(<App />);
    await screen.findByRole("heading", { name: mixed.stem });
    await waitFor(() => expect(onProgress).toBeDefined());
    const reportProgress = onProgress!;
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.change(screen.getByLabelText("Practice"), { target: { value: "focused" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply focus" }));
    await screen.findByText(/Focus saved/);
    await act(async () => reportProgress({ ready: 3, target: 3, generating: false, focus: null }));
    expect(screen.getByRole("status")).toHaveTextContent("Focused practice · Generating · 0/3 ready");
    await act(async () => reportProgress({ ready: 2, target: 3, generating: true, focus: { discipline: "medicine" } }));
    expect(screen.getByRole("status")).toHaveTextContent("Focused practice · Generating · 2/3 ready");
    await act(async () => pending.resolve());
  });

  it("replaces root, pushes Next, and restores answers through Back, Forward, and refresh", async () => {
    const first = makeQuestion({ stem: "Which first treatment is most appropriate?" });
    const second = makeQuestion({ stem: "Which second treatment is most appropriate?" });
    await enqueue(first, second);
    const initialLength = history.length;
    const view = render(<StrictMode><App /></StrictMode>);
    await screen.findByRole("heading", { name: first.stem });
    expect(location.pathname).toBe(questionUrl(first.id));
    expect(history.length).toBe(initialLength);
    expect(await db.encounters.count()).toBe(1);
    const firstEncounterId = history.state.iworldEncounterId;

    fireEvent.click(screen.getByRole("button", { name: /B\s*Outpatient/ }));
    await screen.findByText(first.options[1].hint);
    fireEvent.click(screen.getByRole("button", { name: /A\s*Immediate/ }));
    await screen.findByText("Answer: A");
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await screen.findByRole("heading", { name: second.stem });
    expect(history.length).toBe(initialLength + 1);
    const secondEncounterId = history.state.iworldEncounterId;
    fireEvent.click(screen.getByRole("button", { name: /B\s*Outpatient/ }));
    await screen.findByText(second.options[1].hint);

    await traverse("back");
    await screen.findByRole("heading", { name: first.stem });
    expect(history.state.iworldEncounterId).toBe(firstEncounterId);
    expect(screen.getByText("Answer: A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /B\s*Outpatient/ })).toHaveAttribute("aria-pressed", "true");
    await traverse("forward");
    await screen.findByRole("heading", { name: second.stem });
    expect(history.state.iworldEncounterId).toBe(secondEncounterId);
    expect(screen.getByText(second.options[1].hint)).toBeInTheDocument();

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { name: second.stem });
    expect(screen.getByText(second.options[1].hint)).toBeInTheDocument();
    expect(await db.encounters.count()).toBe(2);
    expect((await studyRepository.getCorrectRates()).recent20).toEqual({ correct: 0, total: 2 });
    expect((await studyRepository.getFreshQuestions()).map((question) => question.id)).toEqual([second.id]);
  });

  it("prefers history's encounter on refresh and the latest saved attempt for a copied URL", async () => {
    const question = makeQuestion();
    const original = await complete(question);
    await studyRepository.setFollowUpMessages(original.id, [{ role: "assistant", text: "Original conversation" }]);
    const review = await studyRepository.beginEncounter(question, "review");
    await studyRepository.recordSelection(review.id, "B", false);
    await db.encounters.update(review.id, { startedAt: "2099-01-01T00:00:00Z" });
    const before = await db.encounters.toArray();
    history.replaceState({ iworldEncounterId: original.id }, "", questionUrl(question.id));
    const view = render(<App />);
    await screen.findByText("Original conversation");
    expect(screen.getByText("Answer: A")).toBeInTheDocument();
    view.unmount();

    history.replaceState(null, "", questionUrl(question.id));
    render(<App />);
    await screen.findByText(question.options[1].hint);
    expect(screen.queryByText("Answer: A")).not.toBeInTheDocument();
    expect(history.state.iworldEncounterId).toBe(review.id);
    expect(await db.encounters.toArray()).toEqual(before);
  });

  it("opens the completed attempt listed in Settings, closes Settings, and returns to the current question", async () => {
    const past = makeQuestion({ topicTitle: "Saved past question" });
    const completed = await complete(past);
    const review = await studyRepository.beginEncounter(past, "review");
    await db.encounters.update(review.id, { startedAt: "2099-01-01T00:00:00Z" });
    const current = makeQuestion({ stem: "Which current treatment is most appropriate?" });
    await enqueue(current);
    render(<App />);
    await screen.findByRole("heading", { name: current.stem });
    const originalLength = history.length;
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(await screen.findByRole("link", { name: past.topicTitle }));
    await screen.findByText("Answer: A");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(history.state.iworldEncounterId).toBe(completed.id);
    expect(history.length).toBe(originalLength + 1);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(await screen.findByRole("link", { name: past.topicTitle }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(history.length).toBe(originalLength + 1);
    await traverse("back");
    await screen.findByRole("heading", { name: current.stem });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await db.encounters.count()).toBe(3);
  });

  it("Next from a past question resumes the queue and discards forward history", async () => {
    const past = makeQuestion({ stem: "Which past treatment is most appropriate?" });
    const pastEncounter = await complete(past);
    const queued = makeQuestion({ stem: "Which queued treatment is most appropriate?" });
    await enqueue(queued);
    history.replaceState({ iworldEncounterId: pastEncounter.id }, "", questionUrl(past.id));
    render(<App />);
    await screen.findByText("Answer: A");
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await screen.findByRole("heading", { name: queued.stem });
    await traverse("back");
    await screen.findByText("Answer: A");
    const lengthWithForwardEntry = history.length;
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await screen.findByRole("heading", { name: queued.stem });
    expect(history.length).toBe(lengthWithForwardEntry);
    expect((await db.encounters.where("questionId").equals(queued.id).toArray())).toHaveLength(1);
  });

  it.each(["malformed", "missing", "obsolete"])("keeps a %s URL unavailable during refill and replaces it on Continue", async (kind) => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const queued = makeQuestion();
    await enqueue(queued);
    const absent = makeQuestion();
    if (kind === "obsolete") await db.table("questions").put({ ...absent, schemaVersion: 1 });
    const path = kind === "malformed" ? "/questions/not-a-uuid" : questionUrl(absent.id);
    history.replaceState(null, "", path);
    const initialLength = history.length;
    render(<App />);
    await screen.findByText("Question unavailable in this browser");
    await waitFor(() => expect(onProgress).toBeDefined());
    act(() => onProgress!({ ready: 1, target: 3, generating: true }));
    expect(location.pathname).toBe(path);
    expect(screen.getByText("Question unavailable in this browser")).toBeInTheDocument();
    expect(await db.encounters.count()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Continue studying" }));
    await screen.findByRole("heading", { name: queued.stem });
    expect(location.pathname).toBe(questionUrl(queued.id));
    expect(history.length).toBe(initialLength);
  });

  it("creates one fresh encounter for a directly linked, unseen queued question", async () => {
    const question = makeQuestion();
    await enqueue(question);
    history.replaceState(null, "", questionUrl(question.id));
    render(<StrictMode><App /></StrictMode>);
    await screen.findByRole("heading", { name: question.stem });
    expect(await db.encounters.count()).toBe(1);
    expect(await studyRepository.isQueued(question.id)).toBe(true);
  });

  it("shows storage errors separately and retries the requested route", async () => {
    const question = makeQuestion();
    const saved = await complete(question);
    history.replaceState(null, "", questionUrl(question.id));
    const read = vi.spyOn(studyRepository, "getQuestionById").mockRejectedValueOnce(new Error("Storage blocked"));
    render(<App />);
    await screen.findByText("Could not load local study data");
    expect(screen.queryByText("Question unavailable in this browser")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Answer: A");
    expect(history.state.iworldEncounterId).toBe(saved.id);
    expect(read).toHaveBeenCalledTimes(2);
    expect(await db.encounters.count()).toBe(1);
  });

  it("ignores superseded loads and refill while navigating", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const slow = makeQuestion({ stem: "Which slow treatment is most appropriate?" });
    const fast = makeQuestion({ stem: "Which fast treatment is most appropriate?" });
    await enqueue(slow, fast);
    const pending = deferred<ClinicalQuestion | undefined>();
    const read = vi.spyOn(studyRepository, "getQuestionById").mockImplementationOnce(() => pending.promise);
    history.replaceState(null, "", questionUrl(slow.id));
    render(<App />);
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    await waitFor(() => expect(onProgress).toBeDefined());
    act(() => {
      history.pushState(null, "", questionUrl(fast.id));
      window.dispatchEvent(new PopStateEvent("popstate"));
      onProgress!({ ready: 2, target: 3, generating: false });
    });
    await act(async () => pending.resolve(slow));
    await screen.findByRole("heading", { name: fast.stem });
    expect(location.pathname).toBe(questionUrl(fast.id));
    expect(await db.encounters.count()).toBe(1);
    expect(await studyRepository.getSavedEncounter(slow.id)).toBeUndefined();
  });

  it("opens an initially empty queue once when refill reports multiple updates", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const question = makeQuestion();
    render(<StrictMode><App /></StrictMode>);
    await screen.findByText("Preparing your first question");
    await waitFor(() => expect(onProgress).toBeDefined());
    await enqueue(question);
    act(() => {
      onProgress!({ ready: 1, target: 3, generating: true });
      onProgress!({ ready: 1, target: 3, generating: false });
    });
    await screen.findByRole("heading", { name: question.stem });
    expect(location.pathname).toBe(questionUrl(question.id));
    expect(await db.encounters.count()).toBe(1);
  });

  it.each([false, true])("saves a late follow-up to its original encounter (returned before reply: %s)", async (returnBeforeReply) => {
    const past = makeQuestion({ stem: "Which past treatment is most appropriate?" });
    const saved = await complete(past);
    const next = makeQuestion({ stem: "Which next treatment is most appropriate?" });
    await enqueue(next);
    history.replaceState({ iworldEncounterId: saved.id }, "", questionUrl(past.id));
    const reply = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => reply.promise);
    render(<App />);
    const input = await screen.findByRole("textbox", { name: "Ask about this question" });
    fireEvent.change(input, { target: { value: "Why this treatment?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Answering…");
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await screen.findByRole("heading", { name: next.stem });
    if (returnBeforeReply) {
      await traverse("back");
      await screen.findByRole("heading", { name: past.stem });
    }
    await act(async () => reply.resolve(new Response(JSON.stringify({ answer: "Late explanation" }))));
    await waitFor(async () => expect((await studyRepository.getSavedEncounter(past.id, saved.id))?.followUpMessages).toHaveLength(2));
    if (!returnBeforeReply) {
      expect(screen.getByRole("heading", { name: next.stem })).toBeInTheDocument();
      expect(screen.queryByText("Late explanation")).not.toBeInTheDocument();
      await traverse("back");
    }
    await screen.findByText("Late explanation");
    expect(screen.getByRole("textbox", { name: "Ask about this question" })).toHaveValue("");
  });

  it("keeps a delayed answer save attached to the question being answered", async () => {
    const past = makeQuestion({ topicTitle: "Past question", stem: "Which past treatment is most appropriate?" });
    await complete(past);
    const current = makeQuestion({ stem: "Which current treatment is most appropriate?" });
    await enqueue(current);
    render(<App />);
    await screen.findByRole("heading", { name: current.stem });
    const currentEncounterId = history.state.iworldEncounterId;
    const pending = deferred<void>();
    const save = studyRepository.recordSelection.bind(studyRepository);
    vi.spyOn(studyRepository, "recordSelection").mockImplementationOnce(async (...args) => {
      await pending.promise;
      return save(...args);
    });
    fireEvent.click(screen.getByRole("button", { name: /B\s*Outpatient/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(await screen.findByRole("link", { name: past.topicTitle }));
    await screen.findByRole("heading", { name: past.stem });
    await act(async () => pending.resolve());
    await waitFor(async () => expect((await studyRepository.getSavedEncounter(current.id, currentEncounterId))?.selectedOptionIds).toEqual(["B"]));
    expect(screen.getByRole("heading", { name: past.stem })).toBeInTheDocument();
    expect(screen.getByText("Answer: A")).toBeInTheDocument();
    await traverse("back");
    await screen.findByText(current.options[1].hint);
  });

  it("keeps repeated single-question offline reviews as distinct history entries", async () => {
    const question = makeQuestion();
    const original = await complete(question);
    history.replaceState({ iworldEncounterId: original.id }, "", questionUrl(question.id));
    render(<App />);
    await screen.findByText("Answer: A");
    const length = history.length;
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await screen.findByText("Review question");
    const firstReviewId = history.state.iworldEncounterId;
    expect(firstReviewId).not.toBe(original.id);
    expect(screen.queryByText("Answer: A")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /A\s*Immediate/ }));
    await screen.findByText("Answer: A");
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await screen.findByRole("button", { name: "Reveal answer" });
    const secondReviewId = history.state.iworldEncounterId;
    expect(secondReviewId).not.toBe(firstReviewId);
    expect(location.pathname).toBe(questionUrl(question.id));
    expect(history.length).toBe(length + 2);
    await traverse("back");
    await screen.findByText("Answer: A");
    expect(history.state.iworldEncounterId).toBe(firstReviewId);
    await traverse("back");
    await screen.findByText("Answer: A");
    expect(history.state.iworldEncounterId).toBe(original.id);
    expect(await db.encounters.count()).toBe(3);
  });
});
