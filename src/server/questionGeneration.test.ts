import { afterEach, describe, expect, it, vi } from "vitest";
import { clinicalQuestionSchema, generateQuestionRequestSchema, generatedQuestionSchema, type GenerateQuestionRequest, type GeneratedQuestion } from "../lib/contracts";
import { PROMPT_VERSION } from "../lib/blueprint";
import { makeQuestion } from "../test/fixtures";
import { generateQuestion, GenerationError, makePrompt, validateQuestionQuality, GENERATION_DEADLINE_MS, REVIEW_DEADLINE_MS } from "./questionGeneration";
import { shuffleQuestionOptions } from "../lib/shuffleQuestion";
import { eligibility } from "../data/curriculum";
import { sourceObjectivesById } from "./objectives";
import { assignmentIsEligible, alignmentIssue } from "./questionPrompts";
import { type ClinicalReview, type EditorialReview } from "./questionReview";
import distractorRegression from "../test/fixtures/obvious-communication-distractors.json";
import exemplars from "../../curriculum/exemplars.json";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async () => ({ ...await vi.importActual("@google/genai"), GoogleGenAI: class { models = { generateContent }; } }));
afterEach(() => { generateContent.mockReset(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); });

function request(): GenerateQuestionRequest {
  const entry = eligibility.find((e) => e.objectiveId === "14" && e.physicianActivity === "management" && e.careDimension === "acute")!;
  return { topicId: "mcc.14", model: "gemini-3.5-flash-lite", avoidSignatures: [], enablingObjectiveId: entry.enablingObjectiveId,
    blueprint: { discipline: entry.discipline, physicianActivity: entry.physicianActivity, careDimension: entry.careDimension, cognitiveTask: entry.cognitiveTasks[0], mccObjectiveIds: ["14"] } };
}

function generated(): GeneratedQuestion {
  const { id: _id, topicId: _topicId, topicTitle: _topicTitle, category: _category, model: _model, generatedAt: _generatedAt, schemaVersion: _schemaVersion, ...question } = makeQuestion();
  return question;
}

type ReviewOptions = {
  clinical?: Partial<ClinicalReview> | "malformed" | "unavailable";
  editorial?: Partial<EditorialReview> | "malformed" | "unavailable";
  disagree?: boolean;
  grounding?: object;
  revisionError?: Error;
  refined?: GeneratedQuestion;
  refinementSummary?: string;
  malformedRefinement?: boolean;
};
const giveaway = { kind: "answer_giveaway" as const, evidence: "One option uniquely bundles detailed care.", correction: "Compare equivalent dispositions." };
const correctness = { kind: "clinical_error" as const, evidence: "The explanation contradicts the supplied ECG finding.", correction: "Correct the explanation to agree with the ECG." };

function reviewProvider(candidates: GeneratedQuestion[], options: ReviewOptions = {}) {
  let round = 0;
  generateContent.mockImplementation(async (arg) => {
    const prompt = JSON.parse(arg.contents);
    if (prompt.draft && prompt.reviewFeedback) {
      if (options.revisionError) throw options.revisionError;
      if (options.malformedRefinement) return { text: "{bad refinement" };
      return { text: JSON.stringify({ question: options.refined ?? candidates[Math.min(round, candidates.length - 1)],
        summary: options.refinementSummary ?? "Preserved the draft after considering all available feedback; no useful change was needed." }) };
    }
    if (!prompt.question) {
      round += 1;
      return { text: JSON.stringify(candidates[Math.min(round - 1, candidates.length - 1)]) };
    }
    const override = prompt.annotatedExamples ? options.editorial : options.clinical;
    if (override === "unavailable") throw new Error("Reviewer unavailable");
    if (override === "malformed") return { text: "{}" };
    if (prompt.annotatedExamples) {
      return { text: JSON.stringify({ corrections: [], advisories: ["Shorten the vignette's opening sentence without removing decisive findings."], ...override }) };
    }
    const candidate = candidates[Math.min(round - 1, candidates.length - 1)];
    const answerText = candidate.options.find((o) => o.id === candidate.correctOptionId)!.text;
    const bestId = prompt.question.options.find((o: { text: string }) => o.text === answerText).id;
    const alternativeId = prompt.question.options.find((o: { id: string }) => o.id !== bestId).id;
    return {
      text: JSON.stringify({ answerId: options.disagree ? alternativeId : bestId, strongestDistractorId: options.disagree ? bestId : alternativeId,
        decisiveCaseFact: candidate.vignette, corrections: [], advisories: [], ...override }),
      ...(options.grounding ? { candidates: [{ groundingMetadata: options.grounding }] } : {})
    };
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
    expect(generateContent).toHaveBeenCalledTimes(5);
    const second = JSON.parse(generateContent.mock.calls[1][0].contents);
    expect(second.correctionRequired.structuralErrors).toMatch(/exact assigned blueprint/);
    expect(second.previousDraft.blueprint.discipline).toBe("surgery");
  });

  it("uses four calls for valid output and at most two candidates for structural errors", async () => {
    const input = request();
    const response = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([response]);
    await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(4);
    generateContent.mockClear();
    reviewProvider([{ ...response, blueprint: { ...input.blueprint, discipline: "surgery" } }]);
    await expect(generateQuestion(input, "test-key")).rejects.toThrow(/exact assigned/);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("keeps the blind reviewer free of keys, teaching and examples, and grounds only that reviewer", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    const grounding = { webSearchQueries: ["optional clinical reference"], groundingChunks: [{ web: { uri: "https://example.org/reference" } }] };
    reviewProvider([candidate], { grounding });
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
    expect(events).toHaveLength(6);
    expect(events).toContainEqual(expect.objectContaining({ stage: "clinical", data: expect.objectContaining({ grounding }) }));
    expect(result).not.toHaveProperty("reviews");
    expect(generateContent.mock.calls[0][0].config).not.toHaveProperty("temperature");
  });

  it("always refines using the actual draft and both reviews without re-reviewing", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([candidate], { editorial: { corrections: [giveaway] } });
    const result = await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(4);
    const revision = JSON.parse(generateContent.mock.calls[3][0].contents);
    expect(revision.draft).toEqual(generatedQuestionSchema.parse(candidate));
    expect(revision.reviewFeedback.corrections).toEqual([expect.objectContaining({ reviewer: "editorial", kind: "answer_giveaway" })]);
    expect(revision.reviewFeedback.clinical.answerId).toBe(candidate.correctOptionId);
    expect(result.blueprint).toEqual(input.blueprint);
  });

  it("delivers despite answer disagreement, uncertainty, and absent grounding", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([candidate], { disagree: true, clinical: { advisories: ["A plausible alternative is worth discussing; no proven defect."] } });
    await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(4);
    generateContent.mockClear();
    reviewProvider([candidate], { clinical: { answerId: null, strongestDistractorId: null, advisories: ["Uncertain about one distinction; sources were unavailable."] }, grounding: { groundingChunks: [] } });
    await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(4);
    const clinicalCall = generateContent.mock.calls[1][0];
    expect(clinicalCall.config.responseJsonSchema.properties).not.toHaveProperty("references");
    expect(clinicalCall.config.responseJsonSchema.properties).not.toHaveProperty("verificationCategory");
    expect(JSON.parse(clinicalCall.contents)).not.toHaveProperty("forceVerification");
  });

  it.each(["malformed", "unavailable"] as const)("delivers a valid draft when a reviewer is %s", async (failure) => {
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }], { clinical: failure });
    const trace: { stage: string; data: unknown }[] = [];
    await generateQuestion(input, "test-key", { onTrace: (event) => trace.push(event) });
    expect(generateContent).toHaveBeenCalledTimes(4);
    expect(trace.at(-1)?.data).toMatchObject({ accepted: true, reviewIncomplete: true, outcome: "refined_unchanged" });
  });

  it("preserves a usable review when the other fails and spends only one revision", async () => {
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }], {
      clinical: "unavailable", editorial: { corrections: [correctness] }
    });
    await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(4);
    expect(JSON.parse(generateContent.mock.calls[3][0].contents).reviewFeedback.corrections[0].kind).toBe("clinical_error");
  });

  it("does not deliver a known correctness defect when revision fails", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    const invalid = { ...candidate, blueprint: { ...input.blueprint, discipline: "surgery" as const } };
    reviewProvider([candidate, invalid], { editorial: { corrections: [correctness] } });
    await expect(generateQuestion(input, "test-key")).rejects.toMatchObject({ code: "QUALITY_REJECTED" });
    expect(generateContent).toHaveBeenCalledTimes(4);
  });

  it("falls back to the valid original after an editorial-only revision fails", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([candidate], { editorial: { corrections: [giveaway] }, revisionError: new Error("429 quota exhausted") });
    const trace: { data: unknown }[] = [];
    const result = await generateQuestion(input, "test-key", { onTrace: (event) => trace.push(event) });
    expect(result.vignette).toBe(candidate.vignette);
    expect(trace.at(-1)?.data).toMatchObject({ accepted: true, outcome: "fallback", refinementFailure: "QUOTA_EXHAUSTED" });
    expect(generateContent).toHaveBeenCalledTimes(4);
  });

  it("also falls back after a structurally invalid editorial-only revision", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    const invalid = { ...candidate, blueprint: { ...input.blueprint, discipline: "surgery" as const } };
    reviewProvider([candidate, invalid], { editorial: { corrections: [giveaway] } });
    const result = await generateQuestion(input, "test-key");
    expect(result.blueprint).toEqual(input.blueprint);
    expect(result.vignette).toBe(candidate.vignette);
    expect(generateContent).toHaveBeenCalledTimes(4);
  });

  it("preserves final refinement after one initial repair, for at most five calls", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    const invalid = { ...candidate, blueprint: { ...input.blueprint, discipline: "surgery" as const } };
    reviewProvider([invalid, candidate], { editorial: { corrections: [correctness] } });
    await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(5);
    expect(JSON.parse(generateContent.mock.calls[4][0].contents).draft).toEqual(generatedQuestionSchema.parse(candidate));
    generateContent.mockClear();
    reviewProvider([invalid, candidate, invalid], { editorial: { corrections: [correctness] } });
    await expect(generateQuestion(input, "test-key")).rejects.toMatchObject({ code: "QUALITY_REJECTED" });
    expect(generateContent).toHaveBeenCalledTimes(5);
  });

  it("delivers when both reviewers fail without manufacturing a quality rejection", async () => {
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }], { clinical: "malformed", editorial: "unavailable" });
    await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(4);
  });

  it("times out review locally and delivers the valid draft within the request deadline", async () => {
    vi.useFakeTimers();
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }]);
    const provider = generateContent.getMockImplementation()!;
    generateContent.mockImplementation((arg) => JSON.parse(arg.contents).question ? new Promise(() => {}) : provider(arg));
    const reviewTimeout = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(reviewTimeout.signal);
    const pending = generateQuestion(input, "test-key");
    await vi.advanceTimersByTimeAsync(0);
    expect(REVIEW_DEADLINE_MS).toBeLessThan(GENERATION_DEADLINE_MS);
    expect(timeout).toHaveBeenCalledWith(REVIEW_DEADLINE_MS);
    reviewTimeout.abort();
    await pending;
    expect(generateContent).toHaveBeenCalledTimes(4);
  });

  it("routes the supplied wording-regression finding and advisory into a consistent final distractor edit", async () => {
    // This fixture labels construction only; it does not certify its legal or clinical content.
    expect(distractorRegression.provenance.clinicalReviewStatus).toBe("not_reviewed");
    expect(distractorRegression.provenance.legalReviewStatus).toBe("not_reviewed");
    const candidate = generatedQuestionSchema.parse(distractorRegression.question);
    const entry = eligibility.find((e) => e.objectiveId === candidate.blueprint.mccObjectiveIds[0] &&
      e.discipline === candidate.blueprint.discipline && e.physicianActivity === candidate.blueprint.physicianActivity &&
      e.careDimension === candidate.blueprint.careDimension && e.cognitiveTasks.includes(candidate.blueprint.cognitiveTask))!;
    const input = { ...request(), topicId: `mcc.${entry.objectiveId}`, blueprint: candidate.blueprint, enablingObjectiveId: entry.enablingObjectiveId };
    const correction = { kind: "answer_giveaway" as const,
      evidence: "Four obviously inappropriate responses contrast with the sole supportive legal-resource response.",
      correction: "Replace the employment-before-shelter filler with a respectful competing support response and keep one best answer." };
    const advisory = "For the employment-before-shelter option, use a respectful housing/income-support response so the vignette is needed to distinguish it from legal-resource support.";
    const replacement = {
      id: "D" as const,
      text: "Acknowledge her financial concerns and offer a social work consultation focused on emergency housing and income support.",
      hint: "Distinguish immediate housing and income support from advice about immigration status.",
      explanation: "Housing and income support may address economic barriers, but this response does not directly address the patient's specific fear about immigration status."
    };
    const refined = { ...candidate, options: candidate.options.map((o) => o.id === "D" ? replacement : o),
      shortExplanation: "Specialized legal support directly addresses the patient's stated immigration concern; housing and income support alone address a different part of her practical barriers." };
    reviewProvider([candidate], { editorial: { corrections: [correction], advisories: [advisory] }, refined,
      refinementSummary: "Replaced the employment-before-shelter filler with a respectful competing response and updated its hint and explanation." });
    const result = await generateQuestion(input, "test-key");
    expect(generateContent).toHaveBeenCalledTimes(4);
    const editor = JSON.parse(generateContent.mock.calls[3][0].contents);
    expect(editor.reviewFeedback.corrections).toContainEqual({ ...correction, reviewer: "editorial" });
    expect(editor.reviewFeedback.advisories).toContain(advisory);
    expect(result.options.find((o) => o.text === replacement.text)).toMatchObject({ text: replacement.text, hint: replacement.hint, explanation: replacement.explanation });
    expect(result.correctOptionId).toBe(result.options.find((o) => o.text === candidate.options.find((o) => o.id === candidate.correctOptionId)!.text)!.id);
    expect(clinicalQuestionSchema.safeParse(result).success).toBe(true);
  });

  it("passes every advisory to the final editor even without correction requests", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([candidate], { clinical: { advisories: ["The explanation assumes a condition is stable although the case never says so."] }, editorial: { advisories: ["Consider replacing the ambiguous competing option."] } });
    await generateQuestion(input, "test-key");
    const editor = JSON.parse(generateContent.mock.calls[3][0].contents);
    expect(editor.reviewFeedback.advisories).toHaveLength(2);
    expect(editor.reviewFeedback.corrections).toEqual([]);
    expect(editor.reviewFeedback.clinical.answerId).toBe(candidate.correctOptionId);
    expect(editor.context.assignment).toEqual(input.blueprint);
    expect(editor.context.objective.enablingObjective.id).toBe(input.enablingObjectiveId);
  });

  it("always refines with no findings and keeps the summary private", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([candidate], { editorial: { advisories: [] }, refinementSummary: "Preserved the question because both reviews found no useful changes." });
    const events: { data: unknown }[] = [];
    const result = await generateQuestion(input, "test-key", { onTrace: (event) => events.push(event) });
    expect(generateContent).toHaveBeenCalledTimes(4);
    expect(events.at(-1)?.data).toMatchObject({ outcome: "refined_unchanged", changed: false, refinementSummary: expect.stringContaining("both reviews") });
    expect(clinicalQuestionSchema.safeParse(result).success).toBe(true);
    expect(result).not.toHaveProperty("summary");
    expect(result).not.toHaveProperty("question");
    const finalCall = generateContent.mock.calls[3][0];
    expect(JSON.parse(finalCall.contents).reviewFeedback.advisories).toEqual([]);
    expect(finalCall.config.systemInstruction).toContain("Independently audit the actual draft");
    expect(finalCall.config.systemInstruction).toContain("reviewer agreement is not proof of quality");
  });

  it("determines changed content from validated output rather than the refinement summary", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    const refined = { ...candidate, shortExplanation: candidate.shortExplanation + " Prioritize the time-sensitive finding." };
    reviewProvider([candidate], { refined, refinementSummary: "Preserved the draft." });
    const events: { data: unknown }[] = [];
    const result = await generateQuestion(input, "test-key", { onTrace: (event) => events.push(event) });
    expect(result.shortExplanation).toBe(refined.shortExplanation);
    expect(events.at(-1)?.data).toMatchObject({ outcome: "refined_changed", changed: true });
  });

  it("does not count an internal signature-only edit as changed question content", async () => {
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([candidate], { refined: { ...candidate, vignetteSignature: "different-internal-signature" } });
    const events: { data: unknown }[] = [];
    await generateQuestion(input, "test-key", { onTrace: (event) => events.push(event) });
    expect(events.at(-1)?.data).toMatchObject({ outcome: "refined_unchanged", changed: false });
  });

  it("passes reviewer failure diagnostics to the final editor", async () => {
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }], { clinical: "malformed", editorial: "unavailable" });
    await generateQuestion(input, "test-key");
    const editor = JSON.parse(generateContent.mock.calls[3][0].contents);
    expect(editor.reviewFeedback.reviewFailures).toEqual(["clinical.INVALID_REVIEW", "editorial.PROVIDER_UNAVAILABLE"]);
    expect(editor.reviewFeedback.clinical).toBeNull();
    expect(editor.reviewFeedback.editorial).toBeNull();
  });

  it.each([false, true])("does not recursively repair a malformed final envelope (known defect=%s)", async (knownDefect) => {
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }], {
      malformedRefinement: true, editorial: { corrections: knownDefect ? [correctness] : [] }
    });
    if (knownDefect) await expect(generateQuestion(input, "test-key")).rejects.toMatchObject({ code: "QUALITY_REJECTED" });
    else await expect(generateQuestion(input, "test-key")).resolves.toHaveProperty("schemaVersion", 2);
    expect(generateContent).toHaveBeenCalledTimes(4);
  });

  it("honors cancellation during final refinement without returning a fallback", async () => {
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }]);
    const provider = generateContent.getMockImplementation()!;
    const controller = new AbortController();
    generateContent.mockImplementation((arg) => {
      if (JSON.parse(arg.contents).draft) { controller.abort(); return new Promise(() => {}); }
      return provider(arg);
    });
    await expect(generateQuestion(input, "test-key", { signal: controller.signal })).rejects.toMatchObject({ code: "GENERATION_TIMEOUT" });
    expect(generateContent).toHaveBeenCalledTimes(4);
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

  it("keeps model output out of normal server logs", async () => {
    vi.stubEnv("QUESTION_GENERATION_LOG_LEVEL", "info");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }]);
    await generateQuestion(input, "test-key");
    expect(debug).not.toHaveBeenCalled();
  });

  it("logs filterable verbose results with stable call numbers and redacted metadata", async () => {
    vi.stubEnv("QUESTION_GENERATION_LOG_LEVEL", "verbose");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const input = request();
    const candidate = { ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" };
    reviewProvider([candidate], { grounding: { webSearchQueries: ["reference test-key"] } });
    await generateQuestion(input, "test-key");
    expect(debug).toHaveBeenCalledTimes(5);
    const allRows = debug.mock.calls.map(([line]) => {
      expect(line).toMatch(/^\[question-generation:verbose\] /);
      expect(line).not.toContain("test-key");
      return JSON.parse(String(line).slice("[question-generation:verbose] ".length));
    });
    const rows = allRows.filter((row) => row.event === "call_result");
    expect(allRows.find((row) => row.event === "refinement_result")).toMatchObject({ outcome: "refined_unchanged", changed: false, summary: expect.any(String) });
    expect(rows.map(({ stage, call, round, status }) => ({ stage, call, round, status }))).toEqual([
      { stage: "candidate", call: 1, round: 1, status: "success" },
      { stage: "clinical", call: 2, round: 1, status: "success" },
      { stage: "editorial", call: 3, round: 1, status: "success" },
      { stage: "refinement", call: 4, round: 2, status: "success" }
    ]);
    expect(rows[0].result.vignette).toBe(candidate.vignette);
    expect(rows[1].grounding.webSearchQueries).toEqual(["reference [REDACTED]"]);
    expect(new Set(rows.map((row) => row.requestId)).size).toBe(1);
    expect(rows.every((row) => row.level === "verbose" && row.event === "call_result" && row.durationMs >= 0)).toBe(true);
  });

  it("supports debug level and logs malformed JSON and failed reviewers without changing fallback", async () => {
    vi.stubEnv("QUESTION_GENERATION_LOG_LEVEL", "debug");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const input = request();
    reviewProvider([{ ...generated(), blueprint: input.blueprint, stem: "Which treatment is most appropriate?" }], { editorial: "unavailable" });
    const provider = generateContent.getMockImplementation()!;
    generateContent.mockImplementation((arg) => {
      const prompt = JSON.parse(arg.contents);
      return prompt.question && !prompt.annotatedExamples ? Promise.resolve({ text: "{broken JSON" }) : provider(arg);
    });
    await generateQuestion(input, "test-key");
    const rows = debug.mock.calls.map(([line]) => JSON.parse(String(line).slice("[question-generation:verbose] ".length))).filter((row) => row.event === "call_result");
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.stage === "clinical").result).toBe("{broken JSON");
    expect(rows.find((row) => row.stage === "editorial")).toMatchObject({ status: "error", call: 3, error: { code: "PROVIDER_UNAVAILABLE" } });
  });

  it("logs failed calls with safe codes and HTTP status rather than raw provider exceptions", async () => {
    vi.stubEnv("QUESTION_GENERATION_LOG_LEVEL", "verbose");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    generateContent.mockRejectedValue(Object.assign(new Error("429 quota exhausted: ?key=secret-credential"), { status: 429 }));
    await expect(generateQuestion(request(), "secret-credential")).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
    expect(debug).toHaveBeenCalledTimes(1);
    const line = String(debug.mock.calls[0][0]);
    expect(line).not.toContain("secret-credential");
    expect(JSON.parse(line.slice("[question-generation:verbose] ".length))).toMatchObject({
      stage: "candidate", call: 1, status: "error", error: { code: "QUOTA_EXHAUSTED", httpStatus: 429 }
    });
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
