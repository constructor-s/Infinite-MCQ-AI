import { describe, expect, it } from "vitest";
import { clinicalQuestionSchema, generateQuestionRequestSchema } from "./contracts";
import { makeQuestion } from "../test/fixtures";

describe("curriculum and question contracts", () => {
  it("requires blueprint assignments on generation requests", () => {
    expect(() => generateQuestionRequestSchema.parse({ topicId: "mcc.14", model: "gemini-3.5-flash-lite" })).toThrow();
  });

  it("accepts only the current paragraph format with provenance", () => {
    expect(() => clinicalQuestionSchema.parse({ ...makeQuestion(), schemaVersion: 1 })).toThrow();
    expect(() => clinicalQuestionSchema.parse({ ...makeQuestion(), vignette: { narrative: "An old structured case." } })).toThrow();
    expect(() => clinicalQuestionSchema.parse({ ...makeQuestion(), curriculumVersion: undefined })).toThrow();
  });

  it("accepts a complete five-option question", () => {
    expect(clinicalQuestionSchema.parse(makeQuestion()).options).toHaveLength(5);
  });

  it("rejects duplicate option text", () => {
    const question = makeQuestion();
    question.options[4].text = question.options[0].text;
    expect(() => clinicalQuestionSchema.parse(question)).toThrow(/unique/i);
  });

  it("rejects missing answer options", () => {
    const question = makeQuestion();
    question.options.pop();
    expect(() => clinicalQuestionSchema.parse(question)).toThrow();
  });
});
