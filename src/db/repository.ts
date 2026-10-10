import { db, type GenerationEvent, type IWorldDatabase } from "./database";
import type { ClinicalQuestion, Encounter, EncounterMode, OptionId } from "../lib/contracts";
import { shuffleQuestionOptions } from "../lib/shuffleQuestion";
import { createLocalId } from "../lib/createLocalId";

export class LocalStudyRepository {
  constructor(private database: IWorldDatabase = db) {}

  async getFreshQuestions(): Promise<ClinicalQuestion[]> {
    const items = await this.database.queueItems.orderBy("createdAt").toArray();
    const questions = await this.database.questions.bulkGet(items.map((item) => item.questionId));
    return Promise.all(
      questions
        .filter((question): question is ClinicalQuestion => Boolean(question))
        .map((question) => this.ensureRandomized(question))
    );
  }

  async getFreshCount(): Promise<number> {
    return this.database.queueItems.count();
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

  async getRecentCompletedQuestions(limit = 5): Promise<ClinicalQuestion[]> {
    const encounters = (await this.database.encounters.where("completedAt").above("").reverse().sortBy("completedAt")).slice(0, limit);
    const uniqueIds = [...new Set(encounters.map((encounter) => encounter.questionId))];
    const questions = await this.database.questions.bulkGet(uniqueIds);
    return questions.filter((question): question is ClinicalQuestion => Boolean(question));
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
    const ranked = [...freshByQuestion.values()]
      .filter((encounter) => encounter.questionId !== excludeQuestionId)
      .sort((a, b) => {
        const aMissed = a.firstAttemptCorrect === false || a.revealedAnswer ? 0 : 1;
        const bMissed = b.firstAttemptCorrect === false || b.revealedAnswer ? 0 : 1;
        if (aMissed !== bMissed) return aMissed - bMissed;
        const reviewOrder = (lastReview.get(a.questionId) ?? "").localeCompare(lastReview.get(b.questionId) ?? "");
        return reviewOrder || Math.random() - 0.5;
      });
    const selected = ranked[0] ?? [...freshByQuestion.values()][0];
    const question = selected ? await this.database.questions.get(selected.questionId) : undefined;
    return question ? this.ensureRandomized(question) : undefined;
  }

  private async ensureRandomized(question: ClinicalQuestion): Promise<ClinicalQuestion> {
    return this.database.transaction("rw", this.database.questions, this.database.encounters, async () => {
      const current = await this.database.questions.get(question.id) ?? question;
      if (current.optionOrderVersion === 1) return current;

      // A started encounter means the old letters have already been shown and possibly recorded.
      // Preserve that order; only unseen cached questions are safe to shuffle during migration.
      const wasAlreadyPresented = await this.database.encounters.where("questionId").equals(current.id).count() > 0;
      const migrated = {
        ...(wasAlreadyPresented ? current : shuffleQuestionOptions(current)),
        optionOrderVersion: 1 as const
      };
      await this.database.questions.put(migrated);
      return migrated;
    });
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
