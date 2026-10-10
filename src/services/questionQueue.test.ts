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
    getSetting: vi.fn(async () => "gemini-3.5-flash-lite"),
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
        topicTitle: "Generated topic",
        vignetteSignature: `generated-scenario-${count}`
      })), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const service = new QuestionQueueService(repository as unknown as LocalStudyRepository);
    await service.fill();
    expect(repository.questions).toHaveLength(QUEUE_TARGET);
    expect(fetch).toHaveBeenCalledTimes(QUEUE_TARGET);
  });

  it("shares concurrent fill calls and only tops up the deficit", async () => {
    const repository = makeRepository(Array.from({ length: 8 }, (_, index) => makeQuestion({ vignetteSignature: `existing-${index}` })));
    let count = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      count += 1;
      const input = JSON.parse(String(init.body));
      return new Response(JSON.stringify(makeQuestion({ topicId: input.topicId, vignetteSignature: `top-up-${count}` })), { status: 200 });
    }));
    const service = new QuestionQueueService(repository as unknown as LocalStudyRepository);
    await Promise.all([service.fill(), service.fill()]);
    expect(repository.questions).toHaveLength(10);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
