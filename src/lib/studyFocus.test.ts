import { describe, expect, it } from "vitest";
import { disciplineSchema } from "./blueprint";
import { eligibleCombinations, eligibility } from "../data/curriculum";
import { selectBlueprint } from "./blueprintSampler";
import { focusCombinations, focusObjectives, studyFocusSchema } from "./studyFocus";

describe("study focus", () => {
  it("defaults to mixed and rejects unknown, obsolete, and ineligible selections", () => {
    expect(studyFocusSchema.parse(null)).toBeNull();
    for (const value of [{ discipline: "cardiology" }, { discipline: "medicine", objectiveId: "removed" },
      { discipline: "medicine", objectiveId: "3-1" }, { discipline: "medicine", steer: "anything" }]) {
      expect(studyFocusSchema.safeParse(value).success).toBe(false);
    }
  });

  it.each(disciplineSchema.options)("offers only eligible %s objectives and generates valid restricted assignments", (discipline) => {
    const topics = focusObjectives(discipline);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.map((topic) => topic.title)).toEqual(topics.map((topic) => topic.title).sort((a, b) => a.localeCompare(b)));
    for (const objective of topics) {
      const focus = { discipline, objectiveId: objective.id };
      expect(studyFocusSchema.safeParse(focus).success).toBe(true);
      const combinations = focusCombinations(focus);
      const selection = selectBlueprint({ questions: [], objectiveStats: {} }, () => 0, 0, combinations);
      expect(selection.blueprint.discipline).toBe(discipline);
      expect(selection.topicId).toBe(`mcc.${objective.id}`);
      expect(eligibility.some((entry) => entry.objectiveId === objective.id && entry.discipline === discipline &&
        entry.physicianActivity === selection.blueprint.physicianActivity && entry.careDimension === selection.blueprint.careDimension &&
        entry.cognitiveTasks.includes(selection.blueprint.cognitiveTask) && entry.enablingObjectiveId === selection.enablingObjectiveId)).toBe(true);
    }
    expect([...focusCombinations({ discipline }).values()].flat().every((entry) => entry.discipline === discipline)).toBe(true);
  });

  it("leaves the mixed-practice candidate set unchanged", () => {
    expect(focusCombinations(null)).toBe(eligibleCombinations);
  });
});
