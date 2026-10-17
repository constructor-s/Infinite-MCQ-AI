import Dexie, { type EntityTable } from "dexie";
import type { ClinicalQuestion, Encounter } from "../lib/contracts";
import type { BlueprintTags } from "../lib/blueprint";

export type QueueItem = {
  id: string;
  questionId: string;
  topicId: string;
  createdAt: string;
};

export type Setting = { key: string; value: unknown };

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
};

export class IWorldDatabase extends Dexie {
  questions!: EntityTable<ClinicalQuestion, "id">;
  queueItems!: EntityTable<QueueItem, "id">;
  encounters!: EntityTable<Encounter, "id">;
  settings!: EntityTable<Setting, "key">;
  generationEvents!: EntityTable<GenerationEvent, "id">;

  constructor(name = "iworld") {
    super(name);
    this.version(1).stores({
      questions: "id, topicId, generatedAt, vignetteSignature",
      queueItems: "id, &questionId, topicId, createdAt",
      encounters: "id, questionId, topicId, mode, startedAt, completedAt, [questionId+mode]",
      settings: "key",
      generationEvents: "id, timestamp, topicId, outcome"
    });
  }
}

export const db = new IWorldDatabase();
