import { db, type GenerationEvent, type IWorldDatabase } from "./database";
import type { ClinicalQuestion, Encounter, EncounterMode, OptionId } from "../lib/contracts";
import { createLocalId } from "../lib/createLocalId";
import { blueprint } from "../lib/blueprint";
import type { SamplingContext, CoverageRecord, ObjectiveStats } from "../lib/blueprintSampler";

export type CorrectRate = { correct: number; total: number };
export type CorrectRates = { recent20: CorrectRate; recent100: CorrectRate };

export class LocalStudyRepository {
  constructor(private database: IWorldDatabase = db) {}

  async getCorrectRates(): Promise<CorrectRates> {
    const encounters = await this.database.encounters.orderBy("startedAt").reverse()
      .filter((encounter) => encounter.mode === "fresh" &&
        (encounter.firstAttemptCorrect !== undefined || encounter.revealedAnswer))
      .limit(100).toArray();
    const summarize = (limit: number): CorrectRate => {
      const window = encounters.slice(0, limit);
      return {
        correct: window.filter((encounter) => encounter.firstAttemptCorrect === true && !encounter.revealedAnswer).length,
        total: window.length
      };
    };
    return { recent20: summarize(20), recent100: summarize(100) };
  }

  async getFreshQuestions(): Promise<ClinicalQuestion[]> {
    const items = await this.database.queueItems.orderBy("createdAt").toArray();
    const questions = await this.database.questions.bulkGet(items.map((item) => item.questionId));
    return questions.filter((question): question is ClinicalQuestion => Boolean(question) && question?.schemaVersion === 2);
  }

  async getFreshCount(): Promise<number> {
    return (await this.getFreshQuestions()).length;
  }

  async enqueue(question: ClinicalQuestion): Promise<void> {
    await this.database.transaction("rw", this.database.questions, this.database.queueItems, async () => {
      await this.database.questions.put(question);
      const existing = await this.database.queueItems.where("questionId").equals(question.id).first();
      if (!existing) {
        await this.database.queueItems.add({
          id: createLocalId(),
          questionId: question.id,
          topicId: question.topicId,
          createdAt: new Date().toISOString()
        });
      }
    });
  }

  async removeFromQueue(questionId: string): Promise<void> {
    await this.database.queueItems.where("questionId").equals(questionId).delete();
  }

  async getQueuedTopicIds(): Promise<string[]> {
    return (await this.database.queueItems.toArray()).map((item) => item.topicId);
  }

  async getSamplingContext(): Promise<SamplingContext> {
    return this.database.transaction("r", this.database.questions, this.database.encounters, async () => {
      const tagged = await this.database.questions.orderBy("generatedAt").reverse()
        .filter((q) => q.schemaVersion === 2).limit(blueprint.coverageWindow).toArray();
      const questions: CoverageRecord[] = tagged.reverse().map((q) => ({ id: q.id, generatedAt: q.generatedAt, blueprint: q.blueprint }));
      const objectiveStats: Record<string, ObjectiveStats> = {};
      const statsFor = (id: string) => objectiveStats[id] ??= { attempts: 0, errors: 0, recentCount: 0 };
      for (const question of questions) {
        for (const id of question.blueprint.mccObjectiveIds) statsFor(id).recentCount += 1;
      }
      const encounters = await this.database.encounters.orderBy("startedAt").toArray();
      // Use at most the latest 20 first-attempt outcomes per objective. Repeated
      // guesses in one encounter never become extra evidence of weakness.
      const outcomes = new Map<string, boolean[]>();
      for (const encounter of encounters) {
        const tags = encounter.blueprint;
        if (!tags) continue;
        for (const id of tags.mccObjectiveIds) {
          statsFor(id).lastExposedAt = encounter.startedAt;
          if (encounter.firstAttemptCorrect !== undefined || encounter.revealedAnswer) {
            const values = outcomes.get(id) ?? [];
            values.push(encounter.firstAttemptCorrect === true && !encounter.revealedAnswer);
            outcomes.set(id, values.slice(-20));
          }
        }
      }
      for (const [id, values] of outcomes) {
        Object.assign(statsFor(id), { attempts: values.length, errors: values.filter((correct) => !correct).length });
      }
      return { questions, objectiveStats };
    });
  }

  async getRecentCompletedQuestions(limit = 5): Promise<ClinicalQuestion[]> {
    const encounters = (await this.database.encounters.where("completedAt").above("").reverse().sortBy("completedAt")).slice(0, limit);
    const uniqueIds = [...new Set(encounters.map((encounter) => encounter.questionId))];
    const questions = await this.database.questions.bulkGet(uniqueIds);
    return questions.filter((question): question is ClinicalQuestion => Boolean(question) && question?.schemaVersion === 2);
  }

  async getRecentGeneratedQuestions(limit = 5): Promise<ClinicalQuestion[]> {
    // Include unseen queued scenarios so a refill also avoids its own new items.
    return this.database.questions.orderBy("generatedAt").reverse()
      .filter((question) => question.schemaVersion === 2).limit(limit).toArray();
  }

  async beginEncounter(question: ClinicalQuestion, mode: EncounterMode): Promise<Encounter> {
    const existing = await this.database.encounters
      .where("[questionId+mode]")
      .equals([question.id, mode])
      .filter((encounter) => !encounter.completedAt)
      .first();
    if (existing) return existing;
    const now = new Date().toISOString();
    const encounter: Encounter = {
      id: createLocalId(),
      questionId: question.id,
      topicId: question.topicId,
      blueprint: structuredClone(question.blueprint),
      mode,
      startedAt: now,
      updatedAt: now,
      selectedOptionIds: [],
      revealedAnswer: false,
      eventuallyCorrect: false
    };
    await this.database.encounters.add(encounter);
    return encounter;
  }

  async recordSelection(encounterId: string, optionId: OptionId, correct: boolean): Promise<Encounter> {
    return this.database.transaction("rw", this.database.encounters, async () => {
      const encounter = await this.database.encounters.get(encounterId);
      if (!encounter) throw new Error("Encounter not found");
      if (encounter.completedAt || encounter.selectedOptionIds.includes(optionId)) return encounter;
      const now = new Date().toISOString();
      const selectedOptionIds = [...encounter.selectedOptionIds, optionId];
      const updated: Encounter = {
        ...encounter,
        firstSelectedOptionId: encounter.firstSelectedOptionId ?? optionId,
        firstAttemptCorrect: encounter.firstAttemptCorrect ?? correct,
        selectedOptionIds,
        eventuallyCorrect: correct || encounter.eventuallyCorrect,
        completedAt: correct ? now : undefined,
        updatedAt: now
      };
      await this.database.encounters.put(updated);
      return updated;
    });
  }

  async revealAnswer(encounterId: string): Promise<Encounter> {
    return this.database.transaction("rw", this.database.encounters, async () => {
      const encounter = await this.database.encounters.get(encounterId);
      if (!encounter) throw new Error("Encounter not found");
      if (encounter.completedAt) return encounter;
      const now = new Date().toISOString();
      const updated = { ...encounter, revealedAnswer: true, completedAt: now, updatedAt: now };
      await this.database.encounters.put(updated);
      return updated;
    });
  }

  async getReviewQuestion(excludeQuestionId?: string): Promise<ClinicalQuestion | undefined> {
    const all = await this.database.encounters.filter((encounter) => Boolean(encounter.completedAt)).toArray();
    const freshByQuestion = new Map<string, Encounter>();
    const lastReview = new Map<string, string>();
    for (const encounter of all) {
      if (encounter.mode === "fresh") freshByQuestion.set(encounter.questionId, encounter);
      if (encounter.mode === "review" && encounter.completedAt) {
        const previous = lastReview.get(encounter.questionId) ?? "";
        if (encounter.completedAt > previous) lastReview.set(encounter.questionId, encounter.completedAt);
      }
    }
    const stored = await this.database.questions.bulkGet([...freshByQuestion.keys()]);
    const available = new Map(stored.filter((q): q is ClinicalQuestion => Boolean(q) && q?.schemaVersion === 2).map((q) => [q.id, q]));
    const ranked = [...freshByQuestion.values()]
      .filter((encounter) => available.has(encounter.questionId))
      .filter((encounter) => encounter.questionId !== excludeQuestionId)
      .sort((a, b) => {
        const aMissed = a.firstAttemptCorrect === false || a.revealedAnswer ? 0 : 1;
        const bMissed = b.firstAttemptCorrect === false || b.revealedAnswer ? 0 : 1;
        if (aMissed !== bMissed) return aMissed - bMissed;
        const reviewOrder = (lastReview.get(a.questionId) ?? "").localeCompare(lastReview.get(b.questionId) ?? "");
        return reviewOrder || Math.random() - 0.5;
      });
    const selected = ranked[0] ?? [...freshByQuestion.values()].find((encounter) => available.has(encounter.questionId));
    return selected ? available.get(selected.questionId) : undefined;
  }

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const setting = await this.database.settings.get(key);
    return (setting?.value as T | undefined) ?? fallback;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    await this.database.settings.put({ key, value });
  }

  async logGeneration(event: Omit<GenerationEvent, "id" | "timestamp">): Promise<void> {
    await this.database.generationEvents.add({ ...event, id: createLocalId(), timestamp: new Date().toISOString() });
  }
}

export const studyRepository = new LocalStudyRepository();
