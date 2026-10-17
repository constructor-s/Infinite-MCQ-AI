import { describe, expect, it } from "vitest";
import snapshot from "../../curriculum/objectives.json";
import crosswalk from "../../curriculum/crosswalk.json";
import exemplars from "../../curriculum/exemplars.json";
import evaluation from "../../curriculum/evaluation.json";
import calibration from "../../curriculum/practice-calibration.json";
import { assignmentIsEligible } from "../server/questionPrompts";
import { generateQuestionRequestSchema } from "../lib/contracts";
import { blueprint } from "../lib/blueprint";
import { eligibility, objectives, curriculumVersion, eligibleCombinations } from "./curriculum";
import { sourceObjectivesById } from "../server/objectives";

describe("MCC curriculum integrity", () => {
  it("preserves all source IDs, child IDs, metadata and role objectives", () => {
    expect(objectives.filter((o) => o.role === "expert")).toHaveLength(192);
    expect(objectives.filter((o) => o.role !== "expert")).toHaveLength(6);
    expect(new Set(objectives.map((o) => o.id)).size).toBe(198);
    expect(sourceObjectivesById.get("3-1")?.group.id).toBe("Group-3");
    expect(sourceObjectivesById.get("3-2")?.id).not.toBe("3-1");
    expect(snapshot.version).toBe(curriculumVersion);
    expect(crosswalk.curriculumVersion).toBe(curriculumVersion);
    for (const objective of snapshot.objectives) {
      expect(objective.language).toBe("en");
      expect(objective.sourceUrl).toMatch(/^https:\/\/mcc.ca\//);
      expect(objective.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(objective.content).not.toMatch(/Portals login|All Rights Reserved|Thomas Spratt/);
      expect(objective.enablingObjectives.length).toBeGreaterThan(0);
      if (objective.role === "expert") {
        expect(objective.sourceId).toBe(objective.id);
        expect(objective.sourceVersion).toBeTruthy();
      } else {
        expect(objective.identifierKind).toBe("source_url_derived");
        expect(objective.sourceId).toBeNull();
      }
    }
  });

  it("has complete, source-grounded eligibility for every objective and task", () => {
    expect(crosswalk.provenance).toBe("application_authored");
    expect(new Set(eligibility.map((entry) => entry.objectiveId)).size).toBe(objectives.length);
    expect(new Set(eligibility.flatMap((entry) => entry.cognitiveTasks))).toEqual(new Set(Object.keys(blueprint.cognitiveTasks)));
    for (const entry of eligibility) {
      const objective = sourceObjectivesById.get(entry.objectiveId)!;
      expect(objective.enablingObjectives.some((clause) => clause.id === entry.enablingObjectiveId)).toBe(true);
      for (const task of entry.cognitiveTasks) expect(blueprint.cognitiveTasks[task].physicianActivity).toBe(entry.physicianActivity);
    }
    expect(eligibleCombinations.size).toBe(6 * 4 * 4);
    expect(eligibility.some((e) => e.objectiveId === "82" && e.discipline === "medicine")).toBe(false);
    expect(eligibility.some((e) => e.objectiveId === "82" && e.careDimension === "psychosocial")).toBe(false);
    expect(eligibility.some((e) => e.careDimension !== "acute" && e.cognitiveTasks.includes("initial_stabilization"))).toBe(false);
  });

  it("defines valid marginal weights and rotating original exemplars", () => {
    for (const weights of [blueprint.physicianActivities, blueprint.careDimensions, blueprint.disciplines]) expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(blueprint.physicianActivities.management).toBe(.35);
    for (const task of Object.keys(blueprint.cognitiveTasks) as (keyof typeof exemplars.tasks)[]) {
      expect(exemplars.tasks[task]).toHaveLength(2);
      expect(exemplars.tasks[task][0].vignette).not.toBe(exemplars.tasks[task][1].vignette);
      for (const example of exemplars.tasks[task]) {
        expect(example.options).toHaveLength(5);
        expect(new Set(example.options).size).toBe(5);
      }
    }
  });

  it("reserves valid offline cases spanning every blueprint axis and records all 55 reference structures", () => {
    const cases = evaluation.cases.map((item) => generateQuestionRequestSchema.parse(item.request));
    for (const input of cases) expect(assignmentIsEligible(input)).toBe(true);
    expect(new Set(cases.map((input) => input.blueprint.discipline)).size).toBe(6);
    expect(new Set(cases.map((input) => input.blueprint.physicianActivity)).size).toBe(4);
    expect(new Set(cases.map((input) => input.blueprint.careDimension)).size).toBe(4);
    expect(calibration.items.map((item) => item.questionNumber)).toEqual(Array.from({ length: 55 }, (_, i) => i + 1));
  });
});
