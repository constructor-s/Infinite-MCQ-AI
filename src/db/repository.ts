import { db, type GenerationEvent, type IWorldDatabase, type QuestionFeedback } from "./database";
import { clinicalQuestionSchema, questionQualityWarningSchema, type ClinicalQuestion, type Encounter, type EncounterMode, type FollowUpMessage, type OptionId, type QuestionQualityWarning } from "../lib/contracts";
import { createLocalId } from "../lib/createLocalId";
import { blueprint, blueprintTagsSchema } from "../lib/blueprint";
import type { SamplingContext, CoverageRecord, ObjectiveStats } from "../lib/blueprintSampler";
import { sameStudyFocus, studyFocusSchema, type StudyFocus } from "../lib/studyFocus";

export type RecentQuestionTopic = ClinicalQuestion & { encounterId: string; outcome: "correct" | "incorrect" | "unknown" };

export type CorrectRate = { correct: number; total: number };
export type CorrectRates = { recent20: CorrectRate; recent100: CorrectRate; lastHour: CorrectRate; last24Hours: CorrectRate };
export type LatestGenerationQcReport = { timestamp: string; topicId: string; qualityWarnings: QuestionQualityWarning[] };

export class LocalStudyRepository {
  constructor(private database: IWorldDatabase = db) {}

  async getQuestionFeedback(questionId: string): Promise<QuestionFeedback | undefined> {
    return this.database.questionFeedback.get(questionId);
  }

  async setQuestionFeedback(questionId: string, encounterId: string, rating: QuestionFeedback["rating"] | null): Promise<void> {
    await this.database.transaction("rw", this.database.questionFeedback, this.database.encounters, this.database.questions, async () => {
      const encounter = await this.database.encounters.get(encounterId);
      if (!encounter?.completedAt || encounter.questionId !== questionId || !await this.database.questions.get(questionId)) {
        throw new Error("Feedback requires a completed encounter for this question");
      }
      if (rating === null) {
        await this.database.questionFeedback.delete(questionId);
        return;
      }
      const previous = await this.database.questionFeedback.get(questionId);
      const now = new Date().toISOString();
      await this.database.questionFeedback.put({ questionId, encounterId, rating, createdAt: previous?.createdAt ?? now, updatedAt: now });
    });
  }

  /** Local review data, including existing model/prompt provenance. No upload. */
  async getQuestionFeedbackReviewData() {
    return this.database.transaction("r", this.database.questionFeedback, this.database.questions, this.database.encounters, async () => {
      const feedback = await this.database.questionFeedback.orderBy("updatedAt").reverse().toArray();
      return Promise.all(feedback.map(async (vote) => ({
        feedback: vote,
        question: await this.database.questions.get(vote.questionId),
        encounter: await this.database.encounters.get(vote.encounterId)
      })));
    });
  }

  async getQuestionById(questionId: string): Promise<ClinicalQuestion | undefined> {
    const question = await this.database.questions.get(questionId);
    return clinicalQuestionSchema.safeParse(question).success ? question : undefined;
  }

  async getSavedEncounter(questionId: string, encounterId?: string): Promise<Encounter | undefined> {
    if (encounterId) {
      const encounter = await this.database.encounters.get(encounterId);
      if (encounter?.questionId === questionId) return encounter;
    }
    const encounters = await this.database.encounters.where("questionId").equals(questionId).toArray();
    return encounters.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))[0];
  }

  async isQueued(questionId: string): Promise<boolean> {
    return Boolean(await this.database.queueItems.where("questionId").equals(questionId).first());
  }

  async getCorrectRates(): Promise<CorrectRates> {
    const now = Date.now();
    const eligible = (encounter: Encounter) => encounter.mode === "fresh" &&
      (encounter.firstAttemptCorrect !== undefined || encounter.revealedAnswer);
    const [encounters, dayEncounters] = await Promise.all([
      this.database.encounters.orderBy("startedAt").reverse().filter(eligible).limit(100).toArray(),
      this.database.encounters.where("startedAt")
        .between(new Date(now - 24 * 60 * 60 * 1000).toISOString(), new Date(now).toISOString(), true, true)
        .filter(eligible).toArray()
    ]);
    const summarize = (window: Encounter[]): CorrectRate => ({
      correct: window.filter((encounter) => encounter.firstAttemptCorrect === true && !encounter.revealedAnswer).length,
      total: window.length
    });
    return {
      recent20: summarize(encounters.slice(0, 20)),
      recent100: summarize(encounters),
      lastHour: summarize(dayEncounters.filter((encounter) => Date.parse(encounter.startedAt) >= now - 60 * 60 * 1000)),
      last24Hours: summarize(dayEncounters)
    };
  }

  async getFreshQuestions(focus: StudyFocus = null): Promise<ClinicalQuestion[]> {
    const items = await this.database.queueItems.orderBy("createdAt").toArray();
    const questions = await this.database.questions.bulkGet(items.map((item) => item.questionId));
    return questions.filter((question): question is ClinicalQuestion => Boolean(question) && question?.schemaVersion === 2 &&
      sameStudyFocus(question.generationFocus, focus));
  }

  async getFreshCount(focus: StudyFocus = null): Promise<number> {
    return (await this.getFreshQuestions(focus)).length;
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

  async getSamplingContext(focus: StudyFocus = null): Promise<SamplingContext> {
    return this.database.transaction("r", this.database.questions, this.database.encounters, async () => {
      const tagged = await this.database.questions.orderBy("generatedAt").reverse()
        .filter((q) => q.schemaVersion === 2 && sameStudyFocus(q.generationFocus, focus)).limit(blueprint.coverageWindow).toArray();
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

  async getRecentQuestionTopics(limit = 20): Promise<RecentQuestionTopic[]> {
    return this.database.transaction("r", this.database.encounters, this.database.questions, async () => {
      const completed = await this.database.encounters.where("completedAt").above("")
        .reverse().sortBy("completedAt");
      const latest = new Map<string, Encounter>();
      for (const encounter of completed) {
        if (!latest.has(encounter.questionId)) latest.set(encounter.questionId, encounter);
      }
      const ids = [...latest.keys()];
      const questions = await this.database.questions.bulkGet(ids);
      return questions.filter((question): question is ClinicalQuestion =>
        Boolean(question) && question?.schemaVersion === 2 && blueprintTagsSchema.safeParse(question.blueprint).success
      ).slice(0, limit).map((question) => {
        const encounter = latest.get(question.id)!;
        const outcome = encounter.revealedAnswer || encounter.firstAttemptCorrect === false ? "incorrect"
          : encounter.firstAttemptCorrect === true ? "correct" : "unknown";
        return { ...question, encounterId: encounter.id, outcome };
      });
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

  async getLatestSuccessfulGenerationQcReport(): Promise<LatestGenerationQcReport | undefined> {
    const event = await this.database.generationEvents.orderBy("timestamp").reverse()
      .filter((candidate) => candidate.outcome === "success").first();
    if (!event) return undefined;
    const parsedWarnings = questionQualityWarningSchema.array().safeParse(event.qualityWarnings ?? []);
    return {
      timestamp: event.timestamp,
      topicId: event.topicId,
      qualityWarnings: parsedWarnings.success ? parsedWarnings.data : []
    };
  }

  async beginEncounter(question: ClinicalQuestion, mode: EncounterMode): Promise<Encounter> {
    // Serialize read/create across startup, navigation, and other tabs.
    return this.database.transaction("rw", this.database.encounters, this.database.queueItems, async () => {
      const encounters = await this.database.encounters
        .where("[questionId+mode]")
        .equals([question.id, mode])
        .toArray();
      const queued = mode === "fresh" && Boolean(
        await this.database.queueItems.where("questionId").equals(question.id).first()
      );
      const candidates = queued ? encounters : encounters.filter((encounter) => !encounter.completedAt);
      const existing = candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
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
    });
  }

  async setFollowUpMessages(encounterId: string, messages: FollowUpMessage[]): Promise<Encounter> {
    return this.database.transaction("rw", this.database.encounters, async () => {
      const encounter = await this.database.encounters.get(encounterId);
      if (!encounter) throw new Error("Encounter not found");
      const updated = {
        ...encounter,
        followUpMessages: structuredClone(messages),
        updatedAt: new Date().toISOString()
      };
      await this.database.encounters.put(updated);
      return updated;
    });
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

  async getStudyFocus(): Promise<StudyFocus> {
    return this.database.transaction("rw", this.database.settings, async () => {
      const stored = await this.database.settings.get("studyFocus");
      const parsed = studyFocusSchema.safeParse(stored?.value ?? null);
      if (parsed.success) return parsed.data;
      await this.database.settings.put({ key: "studyFocus", value: null });
      await this.database.settings.put({ key: "studyFocusResetNotice", value: true });
      return null;
    });
  }

  async takeStudyFocusResetNotice(): Promise<boolean> {
    return this.database.transaction("rw", this.database.settings, async () => {
      const notice = await this.database.settings.get("studyFocusResetNotice");
      await this.database.settings.delete("studyFocusResetNotice");
      return notice?.value === true;
    });
  }

  async setStudyFocus(focus: StudyFocus): Promise<void> {
    await this.setSetting("studyFocus", studyFocusSchema.parse(focus));
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    await this.database.settings.put({ key, value });
  }

  async logGeneration(event: Omit<GenerationEvent, "id" | "timestamp">): Promise<void> {
    await this.database.generationEvents.add({ ...event, id: createLocalId(), timestamp: new Date().toISOString() });
  }
}

export const studyRepository = new LocalStudyRepository();
