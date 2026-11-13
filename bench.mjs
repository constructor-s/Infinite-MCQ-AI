import { runQuestionDebugBench } from "./scripts/question-debug-bench.mjs";

const started = performance.now();
const run = await runQuestionDebugBench({
  // Previous statistics assignment:
  // topicId: "mcc.78-2",
  // blueprint: {
  //   discipline: "phelo",
  //   physicianActivity: "assessment_diagnosis",
  //   careDimension: "prevention",
  //   cognitiveTask: "evidence_statistical_interpretation",
  //   mccObjectiveIds: ["78-2"]
  // },
  // enablingObjectiveId: "enabling-7",
  topicId: "mcc.42-1",
  blueprint: {
    discipline: "medicine",
    physicianActivity: "assessment_diagnosis",
    careDimension: "acute",
    cognitiveTask: "laboratory_interpretation",
    mccObjectiveIds: ["42-1"]
  },
  enablingObjectiveId: "enabling-4",
  model: "gemini-4-hydrogen",
  avoidSignatures: []
});

const elapsedMs = performance.now() - started;
const calls = run.report.traces
  .filter((trace) => trace.stage === "call")
  .map((trace) => trace.data);
const stages = ["candidate", "clinical", "refinement"];
const tokenTotal = (items, field) => {
  const values = items.map((item) => item.usage?.[field]).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : "unreported";
};
const cacheSummary = (items) => {
  const measured = items.filter((item) => Number.isFinite(item.usage?.promptTokenCount)
    && Number.isFinite(item.usage?.cachedContentTokenCount));
  const input = tokenTotal(measured, "promptTokenCount");
  const cached = tokenTotal(measured, "cachedContentTokenCount");
  return {
    cacheCoverage: `${measured.length}/${items.length} calls reported cache counts`,
    cachePercent: typeof input === "number" && input > 0
      ? `${(100 * cached / input).toFixed(2)}%` : "unreported"
  };
};

console.log(`Outcome: ${run.report.outcome}`);
if (run.report.error) console.log("Error:", run.report.error);
console.log(`Overall elapsed: ${(elapsedMs / 1000).toFixed(2)} s (includes benchmark setup and report writing)`);
console.log(`Generation elapsed: ${(run.report.durationMs / 1000).toFixed(2)} s`);
console.table(stages.map((stage) => {
  const items = calls.filter((call) => call.stage === stage);
  return {
    stage,
    calls: items.length,
    retries: Math.max(0, items.length - 1),
    failures: items.filter((call) => call.status === "error").length,
    requestSeconds: (items.reduce((sum, call) => sum + (call.durationMs ?? 0), 0) / 1000).toFixed(2),
    inputTokens: tokenTotal(items, "promptTokenCount"),
    thinkingTokens: tokenTotal(items, "thoughtsTokenCount"),
    outputTokens: tokenTotal(items, "candidatesTokenCount"),
    cachedTokens: tokenTotal(items, "cachedContentTokenCount"),
    ...cacheSummary(items)
  };
}));
console.log("Overall caching:", {
  reportedCachedTokens: tokenTotal(calls, "cachedContentTokenCount"),
  ...cacheSummary(calls)
});

console.table(calls.map((call) => {
  const parts = (call.nonTextParts ?? []).map((entry) => entry.part);
  return {
    stage: call.stage,
    call: call.call,
    status: call.status,
    seconds: ((call.durationMs ?? 0) / 1000).toFixed(2),
    thinkingLevel: call.thinkingLevel,
    codeExecutions: parts.filter((part) => part.executableCode).length,
    codeResults: parts.filter((part) => part.codeExecutionResult).length,
    functionCalls: parts.filter((part) => part.functionCall).length,
    toolInputTokens: call.usage?.toolUsePromptTokenCount ?? "unreported"
  };
}));
console.log("Tool counts reflect returned parts; search activity may not be exposed in this trace.");
console.log("Missing token counts are unreported, not assumed zero. Totals include only reported usage.");
console.log("Thinking tokens do not measure thinking time; request durations also include provider, network, and tool latency.");
console.log(`Full report: ${run.reportPath}`);
