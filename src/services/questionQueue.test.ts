import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClinicalQuestion } from "../lib/contracts";
import type { LocalStudyRepository } from "../db/repository";
import { makeQuestion } from "../test/fixtures";
import { QUEUE_TARGET, QuestionQueueService } from "./questionQueue";

function makeRepository(initial: ClinicalQuestion[] = []) {
  const questions = [...initial];
  return {
    questions,
    getFreshCount: vi.fn(async () => questions.length),
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

  it("fills a new profile to exactly ten questions", async () => {
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
    expect(new Set(repository.questions.map((q) => q.blueprint.physicianActivity)).size).toBeGreaterThan(1);
    expect(repository.logGeneration).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success", blueprint: expect.any(Object), promptVersion: expect.any(String), curriculumVersion: expect.any(String) }));
  });

  it("shares concurrent fill calls and only tops up the deficit", async () => {
    const repository = makeRepository(Array.from({ length: 8 }, (_, index) => makeQuestion({ vignetteSignature: `existing-${index}` })));
    let count = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      count += 1;
      const input = JSON.parse(String(init.body));
      return new Response(JSON.stringify(makeQuestion({ topicId: input.topicId, blueprint: input.blueprint, vignetteSignature: `top-up-${count}` })), { status: 200 });
    }));
    const service = new QuestionQueueService(repository as unknown as LocalStudyRepository);
    await Promise.all([service.fill(), service.fill()]);
    expect(repository.questions).toHaveLength(10);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not persist or count a failed generation and can resume filling", async () => {
    const repository = makeRepository(Array.from({ length: 9 }, () => makeQuestion()));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "GENERATION_FAILED", message: "Unavailable" } }), { status: 502 })));
    const service = new QuestionQueueService(repository as unknown as LocalStudyRepository);
    await expect(service.fill()).rejects.toThrow("Unavailable");
    expect(repository.questions).toHaveLength(9);
    expect(repository.logGeneration).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", blueprint: expect.any(Object) }));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body));
      return new Response(JSON.stringify(makeQuestion({ topicId: input.topicId, blueprint: input.blueprint })), { status: 200 });
    }));
    await service.fill();
    expect(repository.questions).toHaveLength(10);
  });

  it("rejects a successful HTTP response carrying the wrong assignment", async () => {
    const repository = makeRepository();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(makeQuestion({ topicId: "wrong-topic" })), { status: 200 })));
    await expect(new QuestionQueueService(repository as unknown as LocalStudyRepository).fill()).rejects.toThrow(/selected blueprint/);
    expect(repository.enqueue).not.toHaveBeenCalled();
  });
});
