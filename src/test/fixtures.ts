import type { ClinicalQuestion } from "../lib/contracts";

export function makeQuestion(overrides: Partial<ClinicalQuestion> = {}): ClinicalQuestion {
  return {
    id: crypto.randomUUID(),
    topicId: "cardio.acs",
    topicTitle: "Acute coronary syndrome",
    category: "Internal Medicine",
    model: "gemini-3.5-flash-lite",
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    difficulty: 3,
    vignette: {
      narrative: "A 62-year-old patient presents with central chest pressure that began while walking and has persisted for forty minutes.",
      vitalSigns: [{ name: "Blood pressure", value: "138/84 mm Hg" }],
      physicalExam: ["The patient appears diaphoretic."],
      laboratoryResults: [],
      investigations: [{ type: "ECG", findings: "ST-segment elevation in leads II, III, and aVF." }]
    },
    stem: "Which of the following is the most appropriate next step?",
    options: [
      { id: "A", text: "Immediate reperfusion assessment", hint: "Consider whether this is a time-sensitive vascular occlusion.", explanation: "This presentation requires immediate assessment for reperfusion." },
      { id: "B", text: "Outpatient stress testing", hint: "Consider whether outpatient testing is safe in an unstable presentation.", explanation: "Stress testing is inappropriate during an acute infarction." },
      { id: "C", text: "Routine clinic follow-up", hint: "Consider the urgency suggested by ongoing symptoms and the ECG.", explanation: "Routine follow-up would dangerously delay treatment." },
      { id: "D", text: "Trial of an antacid", hint: "Anchor on the objective evidence rather than a benign symptom mimic.", explanation: "An antacid does not address an ECG-confirmed infarction." },
      { id: "E", text: "Elective echocardiography", hint: "Ask whether this investigation should precede urgent definitive care.", explanation: "Echocardiography must not delay reperfusion." }
    ],
    correctOptionId: "A",
    shortExplanation: "The symptoms and inferior ST elevation indicate an acute myocardial infarction requiring an immediate reperfusion pathway.",
    highYieldPearl: "Do not delay reperfusion for nonessential testing in diagnostic STEMI.",
    vignetteSignature: `acs-inferior-${Math.random()}`,
    ...overrides
  };
}
