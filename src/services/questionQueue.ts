import { clinicalQuestionSchema, questionQualityWarningSchema, type ClinicalQuestion, type ModelOption, type QuestionGenerationDiagnostic, type QuestionQualityWarning } from "../lib/contracts";
import { selectBlueprint } from "../lib/blueprintSampler";
import { blueprint, PROMPT_VERSION, sameBlueprint } from "../lib/blueprint";
import { curriculumVersion, crosswalkVersion } from "../data/curriculum";
import { studyRepository, type LocalStudyRepository } from "../db/repository";
import { focusCombinations, sameStudyFocus, type StudyFocus } from "../lib/studyFocus";

export const QUEUE_TARGET = 3;

export type QueueProgress = { ready: number; target: number; generating: boolean; focus?: StudyFocus; generationSucceeded?: boolean; qualityWarnings?: QuestionQualityWarning[] };

type ModelsResponse = { models: ModelOption[]; availabilityUnverified?: boolean };

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public diagnostic?: QuestionGenerationDiagnostic) {
    super(message);
  }
}

export function formatApiError(error: ApiError): string {
  const diagnostic = error.diagnostic;
  const issues = diagnostic?.issues.map((issue) => {
    const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  }).join("; ");
  const message = error.message && error.message !== error.code ? error.message : undefined;
  const detail = issues ? `${diagnostic!.stage}/${diagnostic!.category}: ${issues}` : undefined;
  const summary = [message, detail].filter(Boolean).join(" — ") || `Request failed${error.status ? ` (HTTP ${error.status})` : ""}`;
  const status = error.status > 0 && !summary.includes(`HTTP ${error.status}`) ? ` (HTTP ${error.status})` : "";
  return `${summary}${status}`;
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
    let generatedQualityWarnings: QuestionQualityWarning[] | undefined;
    while (true) {
      const focus = await this.repository.getStudyFocus();
      const ready = await this.repository.getFreshCount(focus);
      onProgress?.({ ready, target: QUEUE_TARGET, generating: ready < QUEUE_TARGET, focus,
        ...(generatedForFocus !== undefined && sameStudyFocus(generatedForFocus, focus)
          ? { generationSucceeded: true, qualityWarnings: generatedQualityWarnings ?? [] } : {}) });
      generatedForFocus = undefined;
      generatedQualityWarnings = undefined;
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
        if (!response.ok) throw new ApiError(body.error?.code ?? "GENERATION_FAILED", body.error?.message ?? "Generation failed", response.status, body.error?.diagnostic);
        const warningsResult = questionQualityWarningSchema.array().safeParse(body.qualityWarnings ?? []);
        const qualityWarnings: QuestionQualityWarning[] = warningsResult.success ? warningsResult.data : [];
        const { qualityWarnings: _qualityWarnings, ...questionResponse } = body;
        const question: ClinicalQuestion = clinicalQuestionSchema.parse({ ...questionResponse, generationFocus: focus ?? undefined });
        const assignmentWarnings: QuestionQualityWarning[] = [];
        if (question.topicId !== selection.topicId) assignmentWarnings.push({
          stage: "refinement", category: "quality", code: "TOPIC_MISMATCH",
          issues: [{ path: ["topicId"], code: "TOPIC_MISMATCH", message: `Generated topic ${question.topicId} differs from selected topic ${selection.topicId}.` }],
          issueCount: 1, truncated: false
        });
        if (!sameBlueprint(question.blueprint, selection.blueprint)) assignmentWarnings.push({
          stage: "refinement", category: "quality", code: "BLUEPRINT_MISMATCH",
          issues: [{ path: ["blueprint"], code: "BLUEPRINT_MISMATCH", message: "Generated blueprint differs from the selected blueprint." }],
          issueCount: 1, truncated: false
        });
        const allQualityWarnings = [...qualityWarnings, ...assignmentWarnings];
        await this.repository.enqueue(question);
        await this.repository.logGeneration({ topicId: selection.topicId, model, outcome: "success", qualityWarnings: allQualityWarnings, ...metadata });
        // The next existing progress update reports this success before another
        // request begins, without changing queue reads or refill behavior.
        generatedForFocus = focus;
        generatedQualityWarnings = allQualityWarnings;
      } catch (error) {
        const code = error instanceof ApiError ? error.code : error instanceof DOMException && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
        try {
          await this.repository.logGeneration({ topicId: selection.topicId, model, outcome: "error", code, ...metadata });
        } catch {
          // Preserve the generation error if diagnostic persistence is unavailable.
        }
        // A failure in an old scope must not pause the newly selected focus.
        if (sameStudyFocus(focus, await this.repository.getStudyFocus())) {
          if (error instanceof ApiError) throw error;
          const message = error instanceof Error && error.message ? error.message : code === "TIMEOUT" ? "Generation timed out" : "Network request failed";
          throw new ApiError(code, message, error instanceof DOMException && error.name === "AbortError" ? 408 : 0);
        }
      }
    }
  }
}

export const questionQueue = new QuestionQueueService();
