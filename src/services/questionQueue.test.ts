import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClinicalQuestion, QuestionGenerationDiagnostic } from "../lib/contracts";
import type { LocalStudyRepository } from "../db/repository";
import { makeQuestion } from "../test/fixtures";
import { ApiError, formatApiError, QUEUE_TARGET, QuestionQueueService } from "./questionQueue";
import { sameStudyFocus, type StudyFocus } from "../lib/studyFocus";

function makeRepository(initial: ClinicalQuestion[] = []) {
  const questions = [...initial];
  return {
    questions,
    getStudyFocus: vi.fn<() => Promise<StudyFocus>>(async () => null),
    getFreshCount: vi.fn(async (focus: StudyFocus = null) => questions.filter((q) => sameStudyFocus(q.generationFocus, focus)).length),
    getQueuedTopicIds: vi.fn(async () => questions.map((question) => question.topicId)),
    getRecentCompletedQuestions: vi.fn(async () => []),
    getRecentGeneratedQuestions: vi.fn(async () => questions.slice(-5).reverse()),
    getSetting: vi.fn(async () => "gemini-3.5-flash-lite"),
    getSamplingContext: vi.fn(async () => ({ questions, objectiveStats: {} })),
    enqueue: vi.fn(async (question: ClinicalQuestion) => { questions.push(question); }),
    logGeneration: vi.fn(async () => undefined)
  };
}

describe("QuestionQueueService", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("keeps an in-flight response in its original scope and fills the new focus", async () => {
    const focused = { discipline: "medicine" as const, objectiveId: "14" };
    let focus: StudyFocus = null;
    const repository = makeRepository([
      ...Array.from({ length: QUEUE_TARGET - 1 }, () => makeQuestion()),
      ...Array.from({ length: QUEUE_TARGET - 1 }, () => makeQuestion({ generationFocus: focused }))
    ]);
    repository.getStudyFocus.mockImplementation(async () => focus);
    let finishFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => { finishFirst = resolve; });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body));
      requests.push(input);
      if (requests.length === 1) { firstStarted(); await firstResponse; }
      return new Response(JSON.stringify(makeQuestion({ topicId: input.topicId, blueprint: input.blueprint })), { status: 200 });
    }));
    const service = new QuestionQueueService(repository as unknown as LocalStudyRepository);
    const progress = vi.fn();
    const filling = service.fill(progress);
    await started;
    focus = focused;
    const coalesced = service.fill();
    expect(coalesced).toBe(filling);
    finishFirst();
    await filling;
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ topicId: "mcc.14", blueprint: { discipline: "medicine", mccObjectiveIds: ["14"] } });
    expect(requests[1]).not.toHaveProperty("generationFocus");
    expect(repository.questions[2 * (QUEUE_TARGET - 1)].generationFocus).toBeUndefined();
    expect(repository.questions[2 * (QUEUE_TARGET - 1) + 1].generationFocus).toEqual(focused);
    expect(await repository.getFreshCount()).toBe(QUEUE_TARGET);
    expect(await repository.getFreshCount(focused)).toBe(QUEUE_TARGET);
    expect(progress).toHaveBeenLastCalledWith({ ready: QUEUE_TARGET, target: QUEUE_TARGET, generating: false, focus: focused });
  });

  it("continues a newly selected scope when the previous request fails", async () => {
    const focused = { discipline: "medicine" as const };
    let focus: StudyFocus = focused;
    const repository = makeRepository(Array.from({ length: QUEUE_TARGET }, () => makeQuestion()));
    repository.getStudyFocus.mockImplementation(async () => focus);
    vi.stubGlobal("fetch", vi.fn(async () => {
      focus = null;
      return new Response(JSON.stringify({ error: { code: "GENERATION_FAILED", message: "Old failure" } }), { status: 502 });
    }));
    await new QuestionQueueService(repository as unknown as LocalStudyRepository).fill();
    expect(fetch).toHaveBeenCalledOnce();
    expect(repository.logGeneration).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", generationFocus: focused }));
  });

  it("uses the current focus after waiting for the browser generation lock", async () => {
    const focus = { discipline: "pediatrics" as const };
    const repository = makeRepository(Array.from({ length: QUEUE_TARGET }, () => makeQuestion({ generationFocus: focus })));
    let enterLock!: () => void;
    const gate = new Promise<void>((resolve) => { enterLock = resolve; });
    const request = vi.fn(async (_name: string, task: () => Promise<void>) => { await gate; await task(); });
    vi.stubGlobal("navigator", { locks: { request } });
    vi.stubGlobal("fetch", vi.fn());
    const filling = new QuestionQueueService(repository as unknown as LocalStudyRepository).fill();
    repository.getStudyFocus.mockResolvedValue(focus);
    enterLock();
    await filling;
    expect(request).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(repository.getFreshCount).toHaveBeenCalledWith(focus);
  });

  it("fills a new profile to exactly three questions", async () => {
    const repository = makeRepository();
    let count = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      count += 1;
      const input = JSON.parse(String(init.body));
      return new Response(JSON.stringify(makeQuestion({
        topicId: input.topicId,
        blueprint: input.blueprint,
        topicTitle: "Generated topic",
        vignetteSignature: `generated-scenario-${count}`
      })), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const service = new QuestionQueueService(repository as unknown as LocalStudyRepository);
    await service.fill();
    expect(repository.questions).toHaveLength(QUEUE_TARGET);
    expect(fetch).toHaveBeenCalledTimes(QUEUE_TARGET);
    expect(repository.getSamplingContext).toHaveBeenCalledTimes(QUEUE_TARGET);
    expect(repository.logGeneration).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success", blueprint: expect.any(Object), promptVersion: expect.any(String), curriculumVersion: expect.any(String) }));
  });

  it("shares concurrent fill calls and only tops up the deficit", async () => {
    const repository = makeRepository(Array.from({ length: QUEUE_TARGET - 2 }, (_, index) => makeQuestion({ vignetteSignature: `existing-${index}` })));
    let count = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      count += 1;
      const input = JSON.parse(String(init.body));
      return new Response(JSON.stringify(makeQuestion({ topicId: input.topicId, blueprint: input.blueprint, vignetteSignature: `top-up-${count}` })), { status: 200 });
    }));
    const service = new QuestionQueueService(repository as unknown as LocalStudyRepository);
    await Promise.all([service.fill(), service.fill()]);
    expect(repository.questions).toHaveLength(QUEUE_TARGET);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports a saved question before a later refill failure", async () => {
    const repository = makeRepository();
    const progress = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (repository.questions.length) throw new Error("Later request failed");
      const input = JSON.parse(String(init.body));
      return new Response(JSON.stringify(makeQuestion({ topicId: input.topicId, blueprint: input.blueprint })));
    }));
    await expect(new QuestionQueueService(repository as unknown as LocalStudyRepository).fill(progress)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(progress).toHaveBeenCalledWith({ ready: 1, target: QUEUE_TARGET, generating: true, focus: null, generationSucceeded: true });
    expect(repository.questions).toHaveLength(1);
  });

  it("does not persist or count a failed generation and can resume filling", async () => {
    const repository = makeRepository(Array.from({ length: QUEUE_TARGET - 1 }, () => makeQuestion()));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "GENERATION_FAILED", message: "Unavailable" } }), { status: 502 })));
    const service = new QuestionQueueService(repository as unknown as LocalStudyRepository);
    await expect(service.fill()).rejects.toThrow("Unavailable");
    expect(repository.questions).toHaveLength(QUEUE_TARGET - 1);
    expect(repository.logGeneration).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", blueprint: expect.any(Object) }));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body));
      return new Response(JSON.stringify(makeQuestion({ topicId: input.topicId, blueprint: input.blueprint })), { status: 200 });
    }));
    await service.fill();
    expect(repository.questions).toHaveLength(QUEUE_TARGET);
  });

  it("preserves logged validation codes and issue messages for status display", async () => {
    const repository = makeRepository(Array.from({ length: QUEUE_TARGET - 1 }, () => makeQuestion()));
    const diagnostic: QuestionGenerationDiagnostic = {
      stage: "refinement", category: "schema", code: "INVALID_REFINEMENT",
      issues: [{ path: ["distractors", 0, "hint"], code: "too_small", message: "Too small: expected string to have >=15 characters" }],
      issueCount: 1, truncated: false
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: {
      code: "INVALID_REFINEMENT", message: "INVALID_REFINEMENT", diagnostic
    } }), { status: 502 })));
    await expect(new QuestionQueueService(repository as unknown as LocalStudyRepository).fill()).rejects.toMatchObject({
      code: "INVALID_REFINEMENT", diagnostic
    });
    const error = new ApiError("INVALID_REFINEMENT", "INVALID_REFINEMENT", 502, diagnostic);
    expect(formatApiError(error)).toBe("INVALID_REFINEMENT (refinement/schema): distractors.0.hint: too_small: Too small: expected string to have >=15 characters");
    expect(repository.logGeneration).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", code: "INVALID_REFINEMENT" }));
  });

  it("lets an existing larger queue drain without deleting questions or generating more", async () => {
    const repository = makeRepository(Array.from({ length: 10 }, () => makeQuestion()));
    vi.stubGlobal("fetch", vi.fn());
    await new QuestionQueueService(repository as unknown as LocalStudyRepository).fill();
    expect(repository.questions).toHaveLength(10);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a successful HTTP response carrying the wrong assignment", async () => {
    const repository = makeRepository();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(makeQuestion({ topicId: "wrong-topic" })), { status: 200 })));
    await expect(new QuestionQueueService(repository as unknown as LocalStudyRepository).fill()).rejects.toThrow(/selected blueprint/);
    expect(repository.enqueue).not.toHaveBeenCalled();
  });
});
