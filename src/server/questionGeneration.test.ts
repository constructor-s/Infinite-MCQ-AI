import { afterEach, describe, expect, it, vi } from "vitest";
import { clinicalQuestionSchema, generateQuestionRequestSchema, generatedQuestionSchema, type GenerateQuestionRequest, type GeneratedQuestion } from "../lib/contracts";
import { PROMPT_VERSION } from "../lib/blueprint";
import { makeQuestion } from "../test/fixtures";
import { generateQuestion, GenerationError, makePrompt, validateQuestionQuality, GENERATION_DEADLINE_MS } from "./questionGeneration";
import { shuffleQuestionOptions } from "../lib/shuffleQuestion";
import { eligibility } from "../data/curriculum";
import { sourceObjectivesById } from "./objectives";
import { assignmentIsEligible, alignmentIssue } from "./questionPrompts";
import { clinicalReviewSchema, editorialReviewSchema } from "./questionReview";
import exemplars from "../../curriculum/exemplars.json";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async () => ({ ...await vi.importActual("@google/genai"), GoogleGenAI: class { models = { generateContent }; } }));
afterEach(() => { generateContent.mockReset(); vi.restoreAllMocks(); vi.useRealTimers(); });

function request(): GenerateQuestionRequest {
  const entry = eligibility.find((e) => e.objectiveId === "14" && e.physicianActivity === "management" && e.careDimension === "acute")!;
  return { topicId: "mcc.14", model: "gemini-3.5-flash-lite", avoidSignatures: [], enablingObjectiveId: entry.enablingObjectiveId,
    blueprint: { discipline: entry.discipline, physicianActivity: entry.physicianActivity, careDimension: entry.careDimension, cognitiveTask: entry.cognitiveTasks[0], mccObjectiveIds: ["14"] } };
}

function generated(): GeneratedQuestion {
  const { id: _id, topicId: _topicId, topicTitle: _topicTitle, category: _category, model: _model, generatedAt: _generatedAt, schemaVersion: _schemaVersion, ...question } = makeQuestion();
  return question;
}

function reviewProvider(candidates: GeneratedQuestion[], failRounds = 0) {
  let round = 0;
  generateContent.mockImplementation(async (arg) => {
    const prompt = JSON.parse(arg.contents);
    if (!prompt.question) {
      round += 1;
      return { text: JSON.stringify(candidates[Math.min(round - 1, candidates.length - 1)]) };
    }
    const pass = { status: "pass", evidence: "The supplied case establishes this criterion.", correction: "" };
    if (prompt.annotatedExamples) {
      const criteria = Object.fromEntries(Object.keys(editorialReviewSchema.shape.criteria.shape).map((key) => [key, pass]));
      if (round <= failRounds) criteria.noAnswerGiveaways = { status: "fail", evidence: "One answer bundles uniquely detailed care.", correction: "Compare equivalent dispositions." };
      return { text: JSON.stringify({ criteria, polish: { status: "fail", evidence: "One sentence could be shorter.", correction: "Optional shortening." } }) };
    }
    const candidate = candidates[Math.min(round - 1, candidates.length - 1)];
    const answerText = candidate.options.find((o) => o.id === candidate.correctOptionId)!.text;
    const answerId = prompt.question.options.find((o: { text: string }) => o.text === answerText).id;
    return { text: JSON.stringify({
      answerId, strongestDistractorId: prompt.question.options.find((o: { id: string }) => o.id !== answerId).id,
      distractorAppeal: "The alternative would fit a related presentation.", decisiveCaseFact: candidate.vignette,
      verificationCategory: "none", references: [],
      criteria: Object.fromEntries(Object.keys(clinicalReviewSchema.shape.criteria.shape).map((key) => [key, pass]))
    }) };
  });
}

describe("question generation safeguards", () => {
  it("grounds the prompt in the exact eligible task and enabling objective", () => {
    const entry = eligibility.find((e) => e.objectiveId === "14" && e.physicianActivity === "management")!;
    const input = { topicId: "mcc.14", blueprint: { discipline: entry.discipline, physicianActivity: entry.physicianActivity, careDimension: entry.careDimension, cognitiveTask: entry.cognitiveTasks[0], mccObjectiveIds: ["14"] }, enablingObjectiveId: entry.enablingObjectiveId, model: "gemini-3.5-flash-lite" as const, avoidSignatures: [] };
    const prompt = JSON.parse(makePrompt(input));
    expect(prompt.assignment).toEqual(input.blueprint);
    expect(prompt.objective.enablingObjective).toEqual(sourceObjectivesById.get("14")!.enablingObjectives.find((e) => e.id === input.enablingObjectiveId));
    expect(prompt).not.toHaveProperty("originalStyleExample");
    expect(prompt.formatInstruction).toMatch(/schema/);
    expect(() => makePrompt({ ...input, blueprint: { ...input.blueprint, mccObjectiveIds: ["not-an-objective"] } })).toThrow(/eligible/i);
  });

  it("sends the MCCQE level, strong distractor and review instructions to the provider", async () => {
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }]);
    const result = await generateQuestion(input, "test-key");
    const prompt = JSON.parse(generateContent.mock.calls[0][0].contents);
    expect(prompt).not.toHaveProperty("difficulty");
    expect(result).not.toHaveProperty("difficulty");
    expect(generateContent.mock.calls[0][0].config.responseJsonSchema.properties).not.toHaveProperty("difficulty");
    expect(prompt.levelInstruction).toMatch(/graduating medical student entering supervised practice in Canada/);
    expect(prompt.levelInstruction).toMatch(/application of the supplied findings/);
    expect(prompt.levelInstruction).not.toMatch(/numeric|difficulty level/i);
    expect(prompt.answerInstruction).toMatch(/exactly five homogeneous choices: one unambiguously best answer and four distractors/);
    expect(prompt.answerInstruction).toMatch(/at least one strong distractor/);
    expect(prompt.answerInstruction).toMatch(/specific finding, timing consideration, contraindication or decision priority supplied in the case/);
    expect(prompt.answerInstruction).toMatch(/short explanation identify the decisive distinction/);
    expect(prompt.answerInstruction).toMatch(/Keep hints from disclosing the decisive distinction/);
    expect(prompt.qualityInstruction).toMatch(/If both remain defensible, revise the case, stem or options/);
    expect(prompt.qualityInstruction).toMatch(/Do not create difficulty by omitting necessary information/);
    expect(result.promptVersion).toBe(PROMPT_VERSION);
  });

  it("preserves five unique choices and a single correct-option identifier in the schema", () => {
    const question = generated();
    expect(generatedQuestionSchema.safeParse(question).success).toBe(true);
    expect(generatedQuestionSchema.safeParse({ ...question, options: question.options.slice(0, 4) }).success).toBe(false);
    expect(generatedQuestionSchema.safeParse({ ...question, correctOptionId: ["A", "B"] }).success).toBe(false);
    expect(generatedQuestionSchema.safeParse({ ...question, options: [...question.options.slice(0, 4), question.options[0]] }).success).toBe(false);
  });

  it("accepts questions and requests without difficulty and strips legacy difficulty", () => {
    const input = request();
    const question = makeQuestion();
    const generatedQuestion = generated();
    expect(generateQuestionRequestSchema.parse(input)).toEqual(input);
    expect(generateQuestionRequestSchema.parse({ ...input, difficulty: 3 })).toEqual(input);
    expect(clinicalQuestionSchema.parse(question)).toEqual(question);
    expect(clinicalQuestionSchema.parse({ ...question, difficulty: 3 })).toEqual(question);
    const parsed = generatedQuestionSchema.parse(generatedQuestion);
    expect(parsed).not.toHaveProperty("difficulty");
    expect(generatedQuestionSchema.parse({ ...generatedQuestion, difficulty: 3 })).toEqual(parsed);
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

  it("repairs the actual structurally invalid draft and preserves the assignment", async () => {
    const input = request();
    const response = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([{ ...response, blueprint: { ...input.blueprint, discipline: "surgery" } }, response]);
    const result = await generateQuestion(input, "test-key");
    expect(result.blueprint).toEqual(input.blueprint);
    expect(generateContent).toHaveBeenCalledTimes(4);
    const second = JSON.parse(generateContent.mock.calls[1][0].contents);
    expect(second.correctionRequired.structuralErrors).toMatch(/exact assigned blueprint/);
    expect(second.previousDraft.blueprint.discipline).toBe("surgery");
  });

  it("uses three calls for accepted output and at most three candidates for structural errors", async () => {
    const input = request();
    const response = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([response]);
    await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(3);
    generateContent.mockClear();
    reviewProvider([{ ...response, blueprint: { ...input.blueprint, discipline: "surgery" } }]);
    await expect(generateQuestion(input, "test-key")).rejects.toThrow(/exact assigned/);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("keeps the blind reviewer free of keys, teaching and examples, and grounds only that reviewer", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([candidate]);
    const events: unknown[] = [];
    const result = await generateQuestion(input, "test-key", { onTrace: (event) => events.push(event) });
    const clinicalCall = generateContent.mock.calls.find(([arg]) => JSON.parse(arg.contents).question?.options?.[0]?.hint === undefined && JSON.parse(arg.contents).question)!;
    const clinical = JSON.parse(clinicalCall[0].contents);
    expect(Object.keys(clinical.question).sort()).toEqual(["options", "stem", "vignette"]);
    expect(clinical).not.toHaveProperty("annotatedExamples");
    expect(clinical.question.options.every((o: object) => Object.keys(o).sort().join() === "id,text")).toBe(true);
    expect(clinicalCall[0].config.tools).toEqual([{ googleSearch: {} }]);
    const editorialCall = generateContent.mock.calls.find(([arg]) => JSON.parse(arg.contents).annotatedExamples)!;
    expect(editorialCall[0].config.tools).toBeUndefined();
    expect(events).toHaveLength(4);
    expect(result).not.toHaveProperty("reviews");
    expect(generateContent.mock.calls[0][0].config).not.toHaveProperty("temperature");
  });

  it("revises weak distractors using both reviews and rechecks fresh output", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([candidate], 1);
    await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(6);
    const revision = JSON.parse(generateContent.mock.calls[3][0].contents);
    expect(revision.previousDraft).toEqual(generatedQuestionSchema.parse(candidate));
    expect(revision.correctionRequired.issues).toContain("editorial.noAnswerGiveaways");
    expect(revision.correctionRequired.clinical.answerId).toBe(candidate.correctOptionId);
    expect(JSON.parse(generateContent.mock.calls[4][0].contents)).not.toHaveProperty("correctionRequired");
  });

  it("rejects unresolved questions after nine calls", async () => {
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }], 3);
    await expect(generateQuestion(input, "test-key")).rejects.toMatchObject({ code: "QUALITY_REJECTED" });
    expect(generateContent).toHaveBeenCalledTimes(9);
  });

  it("accepts advisory polish without another round and rejects malformed reviews", async () => {
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }]);
    await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(3);
    const provider = generateContent.getMockImplementation()!;
    generateContent.mockImplementation((arg) => JSON.parse(arg.contents).annotatedExamples ? Promise.resolve({ text: "{}" }) : provider(arg));
    await expect(generateQuestion(input, "test-key")).rejects.toMatchObject({ code: "EVALUATION_FAILED" });
  });

  it("preserves quota errors and stops before calling providers on cancellation", async () => {
    generateContent.mockRejectedValue(new Error("429 quota exhausted"));
    await expect(generateQuestion(request(), "test-key")).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
    generateContent.mockClear();
    const controller = new AbortController(); controller.abort();
    await expect(generateQuestion(request(), "test-key", { signal: controller.signal })).rejects.toMatchObject({ code: "GENERATION_TIMEOUT" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("enforces the deadline even if a provider ignores cancellation", async () => {
    vi.useFakeTimers();
    generateContent.mockImplementation(() => new Promise(() => {}));
    const pending = expect(generateQuestion(request(), "test-key")).rejects.toMatchObject({ code: "GENERATION_TIMEOUT", status: 504 });
    await vi.advanceTimersByTimeAsync(GENERATION_DEADLINE_MS);
    await pending;
    expect(generateContent).toHaveBeenCalledTimes(1);
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
