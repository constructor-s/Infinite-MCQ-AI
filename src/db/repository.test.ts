import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IWorldDatabase } from "./database";
import { LocalStudyRepository } from "./repository";
import { makeQuestion } from "../test/fixtures";

describe("LocalStudyRepository", () => {
  let database: IWorldDatabase;
  let repository: LocalStudyRepository;

  beforeEach(() => {
    database = new IWorldDatabase(`test-${crypto.randomUUID()}`);
    repository = new LocalStudyRepository(database);
  });

  afterEach(async () => database.delete());

  it("persists queue order and removes completed queue items", async () => {
    const first = makeQuestion();
    const second = makeQuestion({ topicId: "respi.pe", vignetteSignature: "pulmonary-embolism-case" });
    await repository.enqueue(first);
    await repository.enqueue(second);
    expect((await repository.getFreshQuestions()).map((item) => item.id)).toEqual([first.id, second.id]);
    await repository.removeFromQueue(first.id);
    expect((await repository.getFreshQuestions()).map((item) => item.id)).toEqual([second.id]);
  });

  it("randomizes a legacy cached question once before presenting it", async () => {
    const legacy = makeQuestion();
    await repository.enqueue(legacy);
    const firstLoad = (await repository.getFreshQuestions())[0];
    const secondLoad = (await repository.getFreshQuestions())[0];
    expect(firstLoad.optionOrderVersion).toBe(1);
    expect(secondLoad).toEqual(firstLoad);
    expect((await database.questions.get(legacy.id))?.optionOrderVersion).toBe(1);
  });

  it("preserves legacy option letters after an encounter has started", async () => {
    const legacy = makeQuestion();
    await repository.enqueue(legacy);
    await repository.beginEncounter(legacy, "fresh");
    const loaded = (await repository.getFreshQuestions())[0];
    expect(loaded.options).toEqual(legacy.options);
    expect(loaded.correctOptionId).toBe(legacy.correctOptionId);
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
});
