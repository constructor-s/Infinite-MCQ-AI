import { clinicalQuestionSchema, type ClinicalQuestion, type ModelOption } from "../lib/contracts";
import { selectBlueprint } from "../lib/blueprintSampler";
import { blueprint, PROMPT_VERSION, sameBlueprint } from "../lib/blueprint";
import { curriculumVersion, crosswalkVersion } from "../data/curriculum";
import { studyRepository, type LocalStudyRepository } from "../db/repository";
import { focusCombinations, sameStudyFocus, type StudyFocus } from "../lib/studyFocus";

export const QUEUE_TARGET = 3;

export type QueueProgress = { ready: number; target: number; generating: boolean; focus?: StudyFocus; generationSucceeded?: boolean };

type ModelsResponse = { models: ModelOption[]; availabilityUnverified?: boolean };

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

// Allow for background generation, two reviews and bounded revisions.
// Keep this slightly longer than the function's Vercel execution window so a
// server response (including a timeout response) wins over a browser abort.
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 305_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchModels(): Promise<ModelsResponse> {
  const response = await fetch("/api/models", { headers: { Accept: "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error?.code ?? "MODEL_LIST_FAILED", body.error?.message ?? "Could not load models", response.status);
  return body as ModelsResponse;
}

export class QuestionQueueService {
  private filling: Promise<void> | null = null;
  private refillRequested = false;

  constructor(private repository: LocalStudyRepository = studyRepository) {}

  fill(onProgress?: (progress: QueueProgress) => void): Promise<void> {
    this.refillRequested = true;
    if (this.filling) return this.filling;
    this.filling = this.withBrowserLock(async () => {
      do {
        this.refillRequested = false;
        await this.fillUnlocked(onProgress);
      } while (this.refillRequested);
    }).finally(() => {
      this.filling = null;
    });
    return this.filling;
  }

  private async withBrowserLock(task: () => Promise<void>): Promise<void> {
    if ("locks" in navigator && navigator.locks) {
      await navigator.locks.request("iworld-question-generation", task);
      return;
    }
    await task();
  }

  private async fillUnlocked(onProgress?: (progress: QueueProgress) => void): Promise<void> {
    let generatedForFocus: StudyFocus | undefined;
    while (true) {
      const focus = await this.repository.getStudyFocus();
      const ready = await this.repository.getFreshCount(focus);
      onProgress?.({ ready, target: QUEUE_TARGET, generating: ready < QUEUE_TARGET, focus,
        ...(generatedForFocus !== undefined && sameStudyFocus(generatedForFocus, focus) ? { generationSucceeded: true } : {}) });
      generatedForFocus = undefined;
      if (ready >= QUEUE_TARGET) {
        if (sameStudyFocus(focus, await this.repository.getStudyFocus())) return;
        continue;
      }
      const model = await this.repository.getSetting("selectedModel", "gemini-3.5-flash-lite");
      const recentQuestions = await this.repository.getRecentGeneratedQuestions(5);
      const context = await this.repository.getSamplingContext(focus);
      // A settings change may have happened while IndexedDB reads were pending.
      if (!sameStudyFocus(focus, await this.repository.getStudyFocus())) continue;
      const selection = selectBlueprint(context, Math.random, Date.now(), focusCombinations(focus));
      const metadata = { blueprint: selection.blueprint, blueprintVersion: blueprint.version, curriculumVersion, crosswalkVersion, promptVersion: PROMPT_VERSION, enablingObjectiveId: selection.enablingObjectiveId,
        ...(focus ? { generationFocus: focus } : {}) };
      try {
        const response = await fetchWithTimeout("/api/questions/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            ...selection,
            model,
            avoidSignatures: recentQuestions.map((question) => question.vignetteSignature).slice(0, 5)
          })
        });
        const body = await response.json();
        if (!response.ok) throw new ApiError(body.error?.code ?? "GENERATION_FAILED", body.error?.message ?? "Generation failed", response.status);
        const question: ClinicalQuestion = clinicalQuestionSchema.parse({ ...body, generationFocus: focus ?? undefined });
        if (question.topicId !== selection.topicId || !sameBlueprint(question.blueprint, selection.blueprint)) {
          throw new ApiError("BLUEPRINT_MISMATCH", "Generated question does not match its selected blueprint", 502);
        }
        await this.repository.enqueue(question);
        await this.repository.logGeneration({ topicId: selection.topicId, model, outcome: "success", ...metadata });
        // The next existing progress update reports this success before another
        // request begins, without changing queue reads or refill behavior.
        generatedForFocus = focus;
      } catch (error) {
        const code = error instanceof ApiError ? error.code : error instanceof DOMException && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
        try {
          await this.repository.logGeneration({ topicId: selection.topicId, model, outcome: "error", code, ...metadata });
        } catch {
          // Preserve the generation error if diagnostic persistence is unavailable.
        }
        // A failure in an old scope must not pause the newly selected focus.
        if (sameStudyFocus(focus, await this.repository.getStudyFocus())) throw error;
      }
    }
  }
}

export const questionQueue = new QuestionQueueService();
