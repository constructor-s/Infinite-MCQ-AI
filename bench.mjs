import { runQuestionDebugBench } from "./scripts/question-debug-bench.mjs";

const run = await runQuestionDebugBench({
  topicId: "mcc.78-2",
  blueprint: {
    discipline: "phelo",
    physicianActivity: "assessment_diagnosis",
    careDimension: "prevention",
    cognitiveTask: "evidence_statistical_interpretation",
    mccObjectiveIds: ["78-2"]
  },
  enablingObjectiveId: "enabling-7",
  model: "gemini-3.5-flash-lite",
  avoidSignatures: []
});

console.log(run.report.outcome, run.reportPath);
