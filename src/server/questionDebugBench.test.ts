import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerateQuestionRequest } from "../lib/contracts";
import { eligibility } from "../data/curriculum";
import { makeQuestion } from "../test/fixtures";
import { GenerationError, type GenerationTrace } from "./questionGeneration";
import { runQuestionDebugBench } from "./questionDebugBench";

const reportDirectories: string[] = [];

async function createReportDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "iworld-question-debug-bench-test-"));
  reportDirectories.push(directory);
  return directory;
}

function statsRequest(): GenerateQuestionRequest {
  const entry = eligibility.find((candidate) => candidate.objectiveId === "78-2" &&
    candidate.cognitiveTasks.includes("evidence_statistical_interpretation"))!;
  return {
    topicId: "mcc.78-2",
    model: "gemini-3.5-flash-lite",
    avoidSignatures: [],
    enablingObjectiveId: entry.enablingObjectiveId,
    blueprint: {
      discipline: entry.discipline,
      physicianActivity: entry.physicianActivity,
      careDimension: entry.careDimension,
      cognitiveTask: "evidence_statistical_interpretation",
      mccObjectiveIds: ["78-2"]
    }
  };
}

afterEach(async () => {
  await Promise.all(reportDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("question debug bench", () => {
  it("passes a manually specified assignment through and saves the full trace", async () => {
    const request = statsRequest();
    const expectedQuestion = makeQuestion();
    const events: GenerationTrace[] = [
      { requestId: "test-run", stage: "candidate", round: 1, data: { question: { stem: "candidate" } } },
      { requestId: "test-run", stage: "clinical", round: 1, data: { review: { answerText: "A" } } },
      { requestId: "test-run", stage: "editorial", round: 1, data: { corrections: [] } },
      { requestId: "test-run", stage: "decision", round: 1, data: { outcome: "refinement_requested" } },
      { requestId: "test-run", stage: "refinement", round: 2, data: { changed: true } },
      { requestId: "test-run", stage: "validation", round: 2, data: { category: "quality" } }
    ];
    const generate = vi.fn(async (received: unknown, _apiKey: string | undefined, options?: { onTrace?: (trace: GenerationTrace) => void }) => {
      expect(received).toEqual(request);
      events.forEach((event) => options?.onTrace?.(event));
      return expectedQuestion;
    });
    const directory = await createReportDirectory();
    const result = await runQuestionDebugBench({ ...request, apiKey: "must-not-be-saved" }, {
      reportDirectory: directory,
      generate
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(result.report.request).toEqual(request);
    expect(result.report.outcome).toBe("success");
    expect(result.report.traces).toEqual(events);
    expect(result.report.question).toEqual(expectedQuestion);
    expect(result.reportPath).toMatch(/\.json$/);
    const saved = await readFile(result.reportPath, "utf8");
    expect(JSON.parse(saved)).toEqual(result.report);
    expect(saved).not.toContain("must-not-be-saved");
    expect(saved).not.toContain("apiKey");
  });

  it("saves available traces and only a safe error summary when generation fails", async () => {
    const request = statsRequest();
    const generate = vi.fn(async (_request: unknown, _apiKey: string | undefined, options?: { onTrace?: (trace: GenerationTrace) => void }) => {
      options?.onTrace?.({ requestId: "failed-run", stage: "candidate", round: 1, data: { question: "candidate" } });
      throw new GenerationError("QUALITY_REJECTED", "private provider response and key", 502);
    });
    const directory = await createReportDirectory();
    const result = await runQuestionDebugBench(request, { reportDirectory: directory, generate });

    expect(result.report.outcome).toBe("error");
    expect(result.report.error).toEqual({ code: "QUALITY_REJECTED", status: 502 });
    expect(result.report.traces).toHaveLength(1);
    expect(await readFile(result.reportPath, "utf8")).not.toContain("private provider response and key");
  });

  it("writes a report for an invalid request without persisting unparsed input", async () => {
    const generate = vi.fn();
    const directory = await createReportDirectory();
    const result = await runQuestionDebugBench({ apiKey: "secret", arbitrary: "private" }, {
      reportDirectory: directory,
      generate
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.report).toMatchObject({ outcome: "error", error: { code: "INVALID_REQUEST", status: 400 }, traces: [] });
    expect(result.report).not.toHaveProperty("request");
    const files = await readdir(directory);
    expect(files).toEqual([result.reportPath.split("/").at(-1)]);
    const saved = await readFile(result.reportPath, "utf8");
    expect(saved).not.toContain("secret");
    expect(saved).not.toContain("private");
  });
});
