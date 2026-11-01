// Opt-in wording regression replay: one editorial check, one refinement. No production call path changes.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer, loadEnv } from "vite";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixturePath = process.argv[2] ?? fileURLToPath(new URL("../src/test/fixtures/obvious-communication-distractors.json", import.meta.url));
const output = process.argv[3] ?? "/tmp/iworld-review-fixture-evaluation.json";
const model = process.argv[4] ?? "gemini-3.5-flash-lite";
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const report = { fixtureId: fixture.id, provenance: fixture.provenance, model, calls: 0, clinicalReviewStatus: "not_reviewed", legalReviewStatus: "not_reviewed", purpose: "Known wording-regression replay, not a held-out quality or medical/legal validation study." };
const apiKey = process.env.GEMINI_API_KEY || loadEnv("development", root, "").GEMINI_API_KEY;
let server;
try {
  if (!apiKey) throw Object.assign(new Error("Missing API key"), { code: "MISSING_API_KEY" });
  server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom", logLevel: "error" });
  const review = await server.ssrLoadModule("/src/server/questionReview.ts");
  const contracts = await server.ssrLoadModule("/src/lib/contracts.ts");
  const curriculum = await server.ssrLoadModule("/src/data/curriculum.ts");
  const draftTools = await server.ssrLoadModule("/src/server/questionDraft.ts");
  const { validateQuestionQuality, GENERATION_THINKING_LEVELS } = await server.ssrLoadModule("/src/server/questionGeneration.ts");
  const { PROMPT_VERSION } = await server.ssrLoadModule("/src/lib/blueprint.ts");
  report.promptVersion = PROMPT_VERSION;
  const question = contracts.generatedQuestionSchema.parse(fixture.question);
  const tags = question.blueprint;
  const entry = curriculum.eligibility.find((e) => e.objectiveId === tags.mccObjectiveIds[0] && e.discipline === tags.discipline &&
    e.physicianActivity === tags.physicianActivity && e.careDimension === tags.careDimension && e.cognitiveTasks.includes(tags.cognitiveTask));
  if (!entry) throw Object.assign(new Error("Fixture assignment is no longer eligible"), { code: "INELIGIBLE_FIXTURE" });
  const input = contracts.generateQuestionRequestSchema.parse({ topicId: curriculum.objectiveTopicId(entry.objectiveId), blueprint: tags, enablingObjectiveId: entry.enablingObjectiveId, model, avoidSignatures: [] });
  report.original = question;
  const draft = draftTools.readQuestionDraft({ vignette: question.vignette, stem: question.stem,
    correctAnswer: question.options.find(({ id }) => id === question.correctOptionId).text,
    distractors: question.options.filter(({ id }) => id !== question.correctOptionId).map(({ text }) => text) });
  report.draft = draftTools.questionCoreContent(draft);
  const { optionLengthIssue } = await server.ssrLoadModule("/src/server/questionOptions.ts");
  report.lengthIssueBefore = optionLengthIssue(draft) ?? null;
  report.callMetrics = [];
  const ai = new GoogleGenAI({ apiKey });
  async function call(stage, contents, schema, instruction) {
    const thinkingLevel = GENERATION_THINKING_LEVELS[stage];
    report.calls += 1;
    report.stage = stage;
    console.log(`Review fixture ${fixture.id}: ${stage} call=${report.calls} model=${model} thinkingLevel=${thinkingLevel}`);
    const startedAt = Date.now();
    const response = await ai.models.generateContent({ model, contents, config: {
      systemInstruction: instruction, responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(schema),
      thinkingConfig: { thinkingLevel }, abortSignal: AbortSignal.timeout(90_000), httpOptions: { timeout: 90_000 }
    } });
    report.callMetrics.push({ stage, call: report.calls, thinkingLevel, durationMs: Date.now() - startedAt, usage: response.usageMetadata });
    return schema.parse(JSON.parse(response.text ?? ""));
  }
  report.editorial = await call("editorial", JSON.stringify({ context: review.reviewContext(input), question: draft, annotatedExamples: review.EDITORIAL_EXAMPLES }), review.editorialReviewSchema, review.EDITORIAL_REVIEW_INSTRUCTION);
  report.editorialExpectedFindingDetected = report.editorial.corrections.some((finding) => finding.kind === fixture.expected.correctionKind);
  report.constructionLengthIssueDetected = Boolean(report.lengthIssueBefore);
  report.expectedFindingDetected = report.editorialExpectedFindingDetected;
  const findings = review.reviewFindings(draft, undefined, report.editorial);
  report.reviewFeedback = { corrections: findings.corrections, advisories: findings.advisories, clinical: null, reviewFailures: ["clinical.NOT_RUN_IN_TARGETED_REPLAY"] };
  const final = await call("refinement", review.refinementPrompt(input, draft, report.reviewFeedback), review.refinementSchema, review.REFINEMENT_INSTRUCTION);
  report.refinement = { question: review.readRefinedQuestion(final) };
  report.lengthIssueAfter = optionLengthIssue(draftTools.questionCoreContent(report.refinement.question)) ?? null;
  validateQuestionQuality(report.refinement.question, [], tags);
  report.changedFields = review.changedQuestionFields(draft, report.refinement.question);
  report.changed = report.changedFields.length > 0;
  report.expectedFindingDetected = report.expectedFindingDetected || findings.corrections.some((finding) => finding.kind === fixture.expected.correctionKind);
  report.status = "completed";
  console.log(JSON.stringify({ fixtureId: fixture.id, calls: report.calls, expectedFindingDetected: report.expectedFindingDetected, changed: report.changed, output }));
} catch (error) {
  // Never dump raw SDK exceptions or the configured credential.
  const quota = /429|quota|resource_exhausted/i.test(error instanceof Error ? error.message : "");
  report.status = "failed";
  report.error = { code: quota ? "QUOTA_EXHAUSTED" : typeof error?.code === "string" ? error.code : "REPLAY_FAILED" };
  console.error(`Review fixture replay stopped: ${report.error.code}`);
  process.exitCode = 1;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  await server?.close();
}
