import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IWorldDatabase } from "./database";
import { LocalStudyRepository } from "./repository";
import { makeQuestion } from "../test/fixtures";
import type { Encounter } from "../lib/contracts";

describe("LocalStudyRepository", () => {
  let database: IWorldDatabase;
  let repository: LocalStudyRepository;

  beforeEach(() => {
    database = new IWorldDatabase(`test-${crypto.randomUUID()}`);
    repository = new LocalStudyRepository(database);
  });

  afterEach(async () => database.delete());

  it("returns empty correct rates without answer history", async () => {
    expect(await repository.getCorrectRates()).toEqual({
      recent20: { correct: 0, total: 0 }, recent100: { correct: 0, total: 0 }
    });
  });

  it("uses the newest 20 and 100 eligible encounters by start time", async () => {
    const base = await repository.beginEncounter(makeQuestion(), "fresh");
    const rows: Encounter[] = Array.from({ length: 110 }, (_, i) => ({
      ...base,
      id: `encounter-${i}`,
      startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      firstAttemptCorrect: i < 100
    }));
    // Insertion order must not determine which outcomes enter the windows.
    await database.encounters.clear();
    await database.encounters.bulkPut(rows.reverse());
    await database.encounters.bulkPut([
      { ...base, id: "unanswered", startedAt: "2027-01-01T00:00:00Z" },
      { ...base, id: "review", mode: "review", firstAttemptCorrect: true, startedAt: "2027-01-01T00:00:01Z" }
    ]);
    expect(await repository.getCorrectRates()).toEqual({
      recent20: { correct: 10, total: 20 }, recent100: { correct: 90, total: 100 }
    });
  });

  it("scores first tries and reveals once, including unfinished wrong answers", async () => {
    const correct = await repository.beginEncounter(makeQuestion(), "fresh");
    await repository.recordSelection(correct.id, "A", true);
    const retry = await repository.beginEncounter(makeQuestion(), "fresh");
    await repository.recordSelection(retry.id, "B", false);
    await repository.recordSelection(retry.id, "A", true);
    const revealed = await repository.beginEncounter(makeQuestion(), "fresh");
    await repository.revealAnswer(revealed.id);
    const wrong = await repository.beginEncounter(makeQuestion(), "fresh");
    await repository.recordSelection(wrong.id, "B", false);
    const review = await repository.beginEncounter(makeQuestion(), "review");
    await repository.recordSelection(review.id, "A", true);
    await repository.beginEncounter(makeQuestion(), "fresh");
    expect(await repository.getCorrectRates()).toEqual({
      recent20: { correct: 1, total: 4 }, recent100: { correct: 1, total: 4 }
    });
  });

  it("persists queue order and removes completed queue items", async () => {
    const first = makeQuestion();
    const second = makeQuestion({ topicId: "respi.pe", vignetteSignature: "pulmonary-embolism-case" });
    await repository.enqueue(first);
    await repository.enqueue(second);
    expect((await repository.getFreshQuestions()).map((item) => item.id)).toEqual([first.id, second.id]);
    await repository.removeFromQueue(first.id);
    expect((await repository.getFreshQuestions()).map((item) => item.id)).toEqual([second.id]);
  });

  it("preserves persisted question options after an encounter has started", async () => {
    const question = makeQuestion();
    await repository.enqueue(question);
    await repository.beginEncounter(question, "fresh");
    const loaded = (await repository.getFreshQuestions())[0];
    expect(loaded.options).toEqual(question.options);
    expect(loaded.correctOptionId).toBe(question.correctOptionId);
    expect(loaded.optionOrderVersion).toBe(1);
  });

  it("records repeated guesses as one encounter", async () => {
    const question = makeQuestion();
    await repository.enqueue(question);
    const encounter = await repository.beginEncounter(question, "fresh");
    const wrong = await repository.recordSelection(encounter.id, "B", false);
    const duplicate = await repository.recordSelection(encounter.id, "B", false);
    const correct = await repository.recordSelection(encounter.id, "A", true);
    expect(wrong.firstAttemptCorrect).toBe(false);
    expect(duplicate.selectedOptionIds).toEqual(["B"]);
    expect(correct.selectedOptionIds).toEqual(["B", "A"]);
    expect(await database.encounters.count()).toBe(1);
  });

  it("prioritizes a missed question in review mode", async () => {
    const correctQuestion = makeQuestion();
    const missedQuestion = makeQuestion({ topicId: "respi.pe", vignetteSignature: "pulmonary-embolism-review" });
    await repository.enqueue(correctQuestion);
    await repository.enqueue(missedQuestion);
    const correctEncounter = await repository.beginEncounter(correctQuestion, "fresh");
    await repository.recordSelection(correctEncounter.id, "A", true);
    const missedEncounter = await repository.beginEncounter(missedQuestion, "fresh");
    await repository.recordSelection(missedEncounter.id, "B", false);
    await repository.revealAnswer(missedEncounter.id);
    expect((await repository.getReviewQuestion())?.id).toBe(missedQuestion.id);
  });

  it("counts queued and presented questions once across reloads, excluding reviews and failed generations", async () => {
    const first = makeQuestion({ generatedAt: "2026-10-16T10:00:00Z" });
    const second = makeQuestion({ generatedAt: "2026-10-16T10:00:01Z" });
    await repository.enqueue(first);
    await repository.enqueue(second);
    const encounter = await repository.beginEncounter(first, "fresh");
    expect(encounter.blueprint).toEqual(first.blueprint);
    await repository.recordSelection(encounter.id, "B", false);
    await repository.recordSelection(encounter.id, "C", false);
    await repository.recordSelection(encounter.id, "A", true);
    await repository.removeFromQueue(first.id);
    const review = await repository.beginEncounter(first, "review");
    await repository.recordSelection(review.id, "A", true);
    await repository.logGeneration({ topicId: second.topicId, model: second.model, outcome: "error", code: "TIMEOUT" });
    const reloaded = new LocalStudyRepository(database);
    const context = await reloaded.getSamplingContext();
    expect(context.questions.map((q) => q.id)).toEqual([first.id, second.id]);
    expect(context.objectiveStats["14"]).toMatchObject({ attempts: 2, errors: 1, recentCount: 2 });
    expect(await reloaded.getFreshCount()).toBe(1);
    expect((await database.encounters.get(encounter.id))?.blueprint).toEqual(first.blueprint);
    expect((await reloaded.getRecentGeneratedQuestions()).map((q) => q.id)).toEqual([second.id, first.id]);
  });

  it("retains only the last 200 generated questions for coverage", async () => {
    const questions = Array.from({ length: 205 }, (_, i) => makeQuestion({ generatedAt: new Date(Date.parse("2026-10-16T00:00:00Z") + i * 1000).toISOString() }));
    await database.questions.bulkPut(questions);
    const context = await repository.getSamplingContext();
    expect(context.questions).toHaveLength(200);
    expect(context.questions[0].id).toBe(questions[5].id);
    expect(context.questions[199].id).toBe(questions[204].id);
  });

  it("keeps an offline review available when it is the only completed question", async () => {
    const question = makeQuestion();
    await repository.enqueue(question);
    const encounter = await repository.beginEncounter(question, "fresh");
    await repository.revealAnswer(encounter.id);
    await repository.removeFromQueue(question.id);
    expect((await repository.getReviewQuestion(question.id))?.id).toBe(question.id);
    expect((await repository.getSamplingContext()).objectiveStats["14"]).toMatchObject({ attempts: 1, errors: 1 });
  });

  it("leaves obsolete stored rows untouched and excludes them from active study", async () => {
    const obsolete = { ...makeQuestion(), schemaVersion: 1 };
    // Represents records already present in IndexedDB before this format change.
    await database.table("questions").put(obsolete);
    await database.queueItems.add({ id: crypto.randomUUID(), questionId: obsolete.id, topicId: obsolete.topicId, createdAt: new Date().toISOString() });
    expect(await repository.getFreshCount()).toBe(0);
    expect((await repository.getSamplingContext()).questions).toHaveLength(0);
    expect(await database.table("questions").get(obsolete.id)).toMatchObject({ schemaVersion: 1 });
  });
});
