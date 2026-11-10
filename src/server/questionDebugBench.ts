import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  generateQuestion,
  GenerationError,
  type GenerationTrace
} from "./questionGeneration.js";
import {
  generateQuestionRequestSchema,
  type ClinicalQuestion,
  type GenerateQuestionRequest
} from "../lib/contracts.js";
import { blueprint, PROMPT_VERSION } from "../lib/blueprint.js";
import { curriculumVersion, crosswalkVersion } from "../data/curriculum.js";

export const QUESTION_DEBUG_BENCH_DIRECTORY = "/tmp/iworld-question-debug-bench";

export type QuestionDebugBenchError = {
  code: string;
  status: number;
};

export type QuestionDebugBenchReport = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  versions: {
    blueprint: string;
    curriculum: string;
    crosswalk: string;
    prompt: string;
  };
  request?: GenerateQuestionRequest;
  outcome: "success" | "error";
  question?: ClinicalQuestion;
  error?: QuestionDebugBenchError;
  traces: GenerationTrace[];
};

export type QuestionDebugBenchOptions = {
  /** Override the local report folder, mainly useful for tests. */
  reportDirectory?: string;
  /** Inject a generator implementation for tests; production defaults to generateQuestion. */
  generate?: typeof generateQuestion;
  /** Override clock and ID generation for deterministic tests. */
  now?: () => Date;
  id?: () => string;
};

function safeError(error: unknown): QuestionDebugBenchError {
  if (error instanceof GenerationError) return { code: error.code, status: error.status };
  if (error instanceof z.ZodError) return { code: "INVALID_REQUEST", status: 400 };
  return { code: "GENERATION_FAILED", status: 502 };
}

/** Run one manually selected blueprint assignment and save its full stage trace locally. */
export async function runQuestionDebugBench(
  rawRequest: unknown,
  options: QuestionDebugBenchOptions = {}
): Promise<{ reportPath: string; report: QuestionDebugBenchReport }> {
  const now = options.now ?? (() => new Date());
  const started = now();
  const traces: GenerationTrace[] = [];
  let request: GenerateQuestionRequest | undefined;
  let question: ClinicalQuestion | undefined;
  let error: QuestionDebugBenchError | undefined;

  try {
    request = generateQuestionRequestSchema.parse(rawRequest);
    question = await (options.generate ?? generateQuestion)(request, undefined, {
      onTrace: (trace) => traces.push(trace)
    });
  } catch (caught) {
    error = safeError(caught);
  }

  const completed = now();
  const report: QuestionDebugBenchReport = {
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationMs: Math.max(0, completed.getTime() - started.getTime()),
    versions: {
      blueprint: blueprint.version,
      curriculum: curriculumVersion,
      crosswalk: crosswalkVersion,
      prompt: PROMPT_VERSION
    },
    ...(request ? { request } : {}),
    outcome: error ? "error" : "success",
    ...(question ? { question } : {}),
    ...(error ? { error } : {}),
    traces
  };

  const reportDirectory = options.reportDirectory ?? QUESTION_DEBUG_BENCH_DIRECTORY;
  await mkdir(reportDirectory, { recursive: true });
  const filename = `${completed.toISOString().replaceAll(/[:.]/g, "-")}-${(options.id ?? randomUUID)()}.json`;
  const reportPath = join(reportDirectory, filename);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { reportPath, report };
}
