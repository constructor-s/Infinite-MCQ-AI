import { describe, expect, it } from "vitest";
import rawTopics from "../../curriculum/topics.json";
import { clinicalQuestionSchema, topicDefinitionSchema } from "./contracts";
import { makeQuestion } from "../test/fixtures";
import { z } from "zod";

describe("curriculum and question contracts", () => {
  it("contains exactly 60 valid curated topics", () => {
    expect(z.array(topicDefinitionSchema).length(60).parse(rawTopics)).toHaveLength(60);
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
