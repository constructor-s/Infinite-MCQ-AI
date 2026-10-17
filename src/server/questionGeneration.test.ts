import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerateQuestionRequest, GeneratedQuestion } from "../lib/contracts";
import { makeQuestion } from "../test/fixtures";
import { generateQuestion, GenerationError, makePrompt, validateQuestionQuality } from "./questionGeneration";
import { shuffleQuestionOptions } from "../lib/shuffleQuestion";
import { eligibility } from "../data/curriculum";
import { sourceObjectivesById } from "./objectives";
import { assignmentIsEligible, alignmentIssue } from "./questionPrompts";
import exemplars from "../../curriculum/exemplars.json";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent }; } }));
afterEach(() => { generateContent.mockReset(); vi.restoreAllMocks(); });

function request(): GenerateQuestionRequest {
  const entry = eligibility.find((e) => e.objectiveId === "14" && e.physicianActivity === "management" && e.careDimension === "acute")!;
  return { topicId: "mcc.14", model: "gemini-3.5-flash-lite", difficulty: 3, avoidSignatures: [], enablingObjectiveId: entry.enablingObjectiveId,
    blueprint: { discipline: entry.discipline, physicianActivity: entry.physicianActivity, careDimension: entry.careDimension, cognitiveTask: entry.cognitiveTasks[0], mccObjectiveIds: ["14"] } };
}

function generated(): GeneratedQuestion {
  const { id: _id, topicId: _topicId, topicTitle: _topicTitle, category: _category, model: _model, generatedAt: _generatedAt, schemaVersion: _schemaVersion, ...question } = makeQuestion();
  return question;
}

describe("question generation safeguards", () => {
  it("grounds the prompt in the exact eligible task and enabling objective", () => {
    const entry = eligibility.find((e) => e.objectiveId === "14" && e.physicianActivity === "management")!;
    const input = { topicId: "mcc.14", blueprint: { discipline: entry.discipline, physicianActivity: entry.physicianActivity, careDimension: entry.careDimension, cognitiveTask: entry.cognitiveTasks[0], mccObjectiveIds: ["14"] }, enablingObjectiveId: entry.enablingObjectiveId, model: "gemini-3.5-flash-lite" as const, difficulty: 3, avoidSignatures: [] };
    const prompt = JSON.parse(makePrompt(input));
    expect(prompt.assignment).toEqual(input.blueprint);
    expect(prompt.objective.enablingObjective).toEqual(sourceObjectivesById.get("14")!.enablingObjectives.find((e) => e.id === input.enablingObjectiveId));
    expect(prompt.originalStyleExample).toHaveProperty("bestAnswer");
    expect(makePrompt(input, 0)).not.toEqual(makePrompt(input, 1));
    expect(() => makePrompt({ ...input, blueprint: { ...input.blueprint, mccObjectiveIds: ["not-an-objective"] } })).toThrow(/eligible/i);
  });

  it("rejects a duplicate vignette signature", () => {
    const question = generated();
    expect(() => validateQuestionQuality(question, [question.vignetteSignature])).toThrow(GenerationError);
  });

  it("rejects a hint that quotes the correct answer", () => {
    const question = generated();
    question.options[1].hint = `The answer is ${question.options[0].text}, which should now be selected.`;
    expect(() => validateQuestionQuality(question, [])).toThrow(/reveals/i);
  });

  it("rejects management disguised as a diagnosis", () => {
    const question = generated();
    question.blueprint = { ...question.blueprint, physicianActivity: "assessment_diagnosis", cognitiveTask: "most_likely_diagnosis" };
    question.stem = "What is the most appropriate next step in management?";
    expect(() => validateQuestionQuality(question, [])).toThrow(/stem|treatment|management/);
    question.stem = "Which diagnosis is most likely?";
    question.options.forEach((o, index) => { o.text = ["Intravenous saline", "Oral aspirin", "Intramuscular epinephrine", "Urgent surgery", "Start antibiotics"][index]; });
    expect(() => validateQuestionQuality(question, [])).toThrow(/options/);
  });

  it("allows next-step diagnostic investigation and professional decisions", () => {
    const question = generated();
    question.blueprint = { ...question.blueprint, physicianActivity: "assessment_diagnosis", cognitiveTask: "diagnostic_investigation" };
    question.options.forEach((o, index) => { o.text = ["Troponin measurement", "Chest radiography", "Echocardiography", "D-dimer assay", "CT pulmonary angiography"][index]; });
    expect(() => validateQuestionQuality(question, [])).not.toThrow();
    question.blueprint = { ...question.blueprint, physicianActivity: "professional_behaviours", cognitiveTask: "confidentiality" };
    question.options.forEach((o, index) => { o.text = ["Seek consent before releasing information", "Release the entire chart", "Contact the employer", "Contact the patient's family", "Make a public statement"][index]; });
    expect(() => validateQuestionQuality(question, [])).not.toThrow();
  });

  it("rejects changed assignments, multiline vignettes and unavailable ECGs", () => {
    const question = generated();
    expect(() => validateQuestionQuality(question, [], { ...question.blueprint, discipline: "surgery" })).toThrow(/exact assigned/);
    question.vignette += "\nVital signs: BP 120/80.";
    expect(() => validateQuestionQuality(question, [])).toThrow(/paragraph/);
    question.vignette = "An adult has palpitations. The tracing is shown in the unavailable image.";
    question.stem = "Which rhythm is demonstrated?";
    question.blueprint = { ...question.blueprint, physicianActivity: "assessment_diagnosis", cognitiveTask: "ecg_interpretation" };
    expect(() => validateQuestionQuality(question, [])).toThrow(/ECG description/);
  });

  it("rejects an explanation admitting that an answer was forced to fit the task", () => {
    const question = generated();
    question.shortExplanation = "Antibiotics are the main treatment. However, options must reflect procedural interventions, so choose a procedure.";
    expect(() => validateQuestionQuality(question, [])).toThrow(/forces the answer/);
  });

  it("rejects mock-chart artifacts rather than displaying them as patient facts", () => {
    const question = generated();
    question.vignette += " A test was performed in a previous mock chart.";
    expect(() => validateQuestionQuality(question, [])).toThrow(/mock-chart/);
  });

  it("recognizes the task-specific style examples across all 31 tasks", () => {
    for (const task of Object.keys(exemplars.tasks) as (keyof typeof exemplars.tasks)[]) {
      for (const example of exemplars.tasks[task]) {
        const entry = eligibility.find((e) => e.cognitiveTasks.includes(task))!;
        expect(alignmentIssue({ ...example, options: example.options.map((text) => ({ text })), blueprint: {
          discipline: entry.discipline, physicianActivity: entry.physicianActivity, careDimension: entry.careDimension,
          cognitiveTask: task, mccObjectiveIds: [entry.objectiveId]
        } }), task).toBeUndefined();
      }
    }
  });

  it("rejects an ineligible combination before any provider call", async () => {
    const input = request();
    input.blueprint = { ...input.blueprint, mccObjectiveIds: ["82"] };
    input.topicId = "mcc.82";
    expect(assignmentIsEligible(input)).toBe(false);
    await expect(generateQuestion(input, "test-key")).rejects.toThrow(/eligible/);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("retries once with concrete feedback and preserves the assignment", async () => {
    const input = request();
    const response = { ...generated(), blueprint: input.blueprint };
    // Use a broadly valid management stem for this selected management task.
    response.stem = "Which treatment is most appropriate?";
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ ...response, blueprint: { ...input.blueprint, discipline: "surgery" } }) })
      .mockResolvedValueOnce({ text: JSON.stringify(response) });
    const result = await generateQuestion(input, "test-key");
    expect(result.blueprint).toEqual(input.blueprint);
    expect(result.schemaVersion).toBe(2);
    expect(generateContent).toHaveBeenCalledTimes(2);
    const secondPrompt = JSON.parse(generateContent.mock.calls[1][0].contents);
    expect(secondPrompt.correctionRequired).toMatch(/exact assigned blueprint/);
    expect(secondPrompt.assignment).toEqual(input.blueprint);
  });

  it("makes one provider call for valid output and at most two for invalid output", async () => {
    const input = request();
    const response = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    generateContent.mockResolvedValue({ text: JSON.stringify(response) });
    await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(1);
    generateContent.mockClear();
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...response, blueprint: { ...input.blueprint, discipline: "surgery" } }) });
    await expect(generateQuestion(input, "test-key")).rejects.toThrow(/exact assigned/);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("shuffles choices in code, relabels them, and remaps the correct answer", () => {
    const question = generated();
    const originalCorrect = question.options.find((option) => option.id === question.correctOptionId)!;
    const randomized = shuffleQuestionOptions(question, () => 0);

    expect(randomized.options.map((option) => option.id)).toEqual(["A", "B", "C", "D", "E"]);
    expect(randomized.options.map((option) => option.text)).toEqual([
      question.options[1].text,
      question.options[2].text,
      question.options[3].text,
      question.options[4].text,
      question.options[0].text
    ]);
    expect(randomized.correctOptionId).toBe("E");
    expect(randomized.options[4]).toMatchObject({
      text: originalCorrect.text,
      hint: originalCorrect.hint,
      explanation: originalCorrect.explanation
    });
  });

  it("does not mutate the model response while shuffling", () => {
    const question = generated();
    const original = structuredClone(question);
    shuffleQuestionOptions(question, () => 0.5);
    expect(question).toEqual(original);
  });
});
