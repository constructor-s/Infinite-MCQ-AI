import Dexie, { type EntityTable } from "dexie";
import type { ClinicalQuestion, Encounter } from "../lib/contracts";
import type { BlueprintTags } from "../lib/blueprint";
import type { FocusedStudy } from "../lib/studyFocus";

export type QueueItem = {
  id: string;
  questionId: string;
  topicId: string;
  createdAt: string;
};

export type Setting = { key: string; value: unknown };

export type QuestionFeedback = {
  questionId: string;
  encounterId: string;
  rating: "up" | "down";
  createdAt: string;
  updatedAt: string;
};

export type GenerationEvent = {
  id: string;
  timestamp: string;
  topicId: string;
  model: string;
  outcome: "success" | "error";
  code?: string;
  blueprint?: BlueprintTags;
  blueprintVersion?: string;
  curriculumVersion?: string;
  crosswalkVersion?: string;
  promptVersion?: string;
  enablingObjectiveId?: string;
  generationFocus?: FocusedStudy;
};

export class IWorldDatabase extends Dexie {
  questions!: EntityTable<ClinicalQuestion, "id">;
  queueItems!: EntityTable<QueueItem, "id">;
  encounters!: EntityTable<Encounter, "id">;
  settings!: EntityTable<Setting, "key">;
  generationEvents!: EntityTable<GenerationEvent, "id">;
  questionFeedback!: EntityTable<QuestionFeedback, "questionId">;

  constructor(name = "iworld") {
    super(name);
    this.version(1).stores({
      questions: "id, topicId, generatedAt, vignetteSignature",
      queueItems: "id, &questionId, topicId, createdAt",
      encounters: "id, questionId, topicId, mode, startedAt, completedAt, [questionId+mode]",
      settings: "key",
      generationEvents: "id, timestamp, topicId, outcome"
    });
    // Additive migration: keep every existing question, encounter, queue and setting.
    this.version(2).stores({ questionFeedback: "questionId, rating, updatedAt" });
  }
}

export const db = new IWorldDatabase();
