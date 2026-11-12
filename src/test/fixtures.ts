import type { ClinicalQuestion } from "../lib/contracts.js";
import { blueprint, PROMPT_VERSION } from "../lib/blueprint.js";
import { curriculumVersion, crosswalkVersion } from "../data/curriculum.js";

export function makeQuestion(overrides: Partial<ClinicalQuestion> = {}): ClinicalQuestion {
  return {
    id: crypto.randomUUID(),
    topicId: "mcc.14", topicTitle: "Chest pain", category: "medicine",
    model: "gemini-3.5-flash-lite", generatedAt: new Date().toISOString(),
    schemaVersion: 2, optionOrderVersion: 1,
    blueprintVersion: blueprint.version, curriculumVersion, crosswalkVersion, promptVersion: PROMPT_VERSION,
    enablingObjectiveId: "enabling-1",
    blueprint: { discipline: "medicine", physicianActivity: "management", careDimension: "acute", cognitiveTask: "initial_stabilization", mccObjectiveIds: ["14"] },
    vignette: "A 62-year-old patient has ongoing central chest pressure for forty minutes and is diaphoretic. ECG shows ST elevation in leads II, III, and aVF.",
    stem: "Which of the following is the most appropriate next step?",
    options: [
      { id: "A", text: "Immediate reperfusion assessment", hint: "Consider whether this is a time-sensitive vascular occlusion.", explanation: "This presentation requires immediate assessment for reperfusion." },
      { id: "B", text: "Outpatient stress testing", hint: "Consider whether outpatient testing is safe in an unstable presentation.", explanation: "Stress testing is inappropriate during an acute infarction." },
      { id: "C", text: "Routine clinic follow-up", hint: "Consider the urgency suggested by ongoing symptoms and the ECG.", explanation: "Routine follow-up would dangerously delay treatment." },
      { id: "D", text: "Trial of an antacid", hint: "Anchor on the objective evidence rather than a benign symptom mimic.", explanation: "An antacid does not address an ECG-confirmed infarction." },
      { id: "E", text: "Elective echocardiography", hint: "Ask whether this investigation should precede urgent definitive care.", explanation: "Echocardiography must not delay reperfusion." }
    ],
    correctOptionId: "A",
    highYieldPearl: "Do not delay reperfusion for nonessential testing in diagnostic STEMI.",
    vignetteSignature: `acs-inferior-${Math.random()}`,
    ...overrides
  };
}
