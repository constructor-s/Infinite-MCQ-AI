import { describe, expect, it } from "vitest";
import { blueprint } from "./blueprint";
import { selectBlueprint, type CoverageRecord, type SamplingContext } from "./blueprintSampler";
import { eligibleCombinations, eligibility, objectives } from "../data/curriculum";

function seeded(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

describe("blueprint sampling", () => {
  it.each([false, true])("keeps every rolling 200-item window balanced over 10,000 selections (concentrated weakness=%s)", (weakness) => {
    const random = seeded(1729);
    const context: SamplingContext = { questions: [], objectiveStats: {} };
    if (weakness) for (const objective of objectives) {
      context.objectiveStats[objective.id] = { attempts: 20, errors: objective.id === "14" ? 20 : 0, recentCount: 0, lastExposedAt: "2026-10-16T00:00:00Z" };
    }
    const counts = { discipline: {} as Record<string, number>, physicianActivity: {} as Record<string, number>, careDimension: {} as Record<string, number> };
    const targets = { discipline: blueprint.disciplines, physicianActivity: blueprint.physicianActivities, careDimension: blueprint.careDimensions };
    let largestDeviation = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const choice = selectBlueprint(context, random, Date.parse("2026-10-16T00:00:00Z"));
      seen.add(choice.blueprint.mccObjectiveIds[0]);
      const record: CoverageRecord = { id: `q-${i}`, generatedAt: new Date(1_790_000_000_000 + i).toISOString(), blueprint: choice.blueprint };
      context.questions.push(record);
      for (const axis of ["discipline", "physicianActivity", "careDimension"] as const) counts[axis][choice.blueprint[axis]] = (counts[axis][choice.blueprint[axis]] ?? 0) + 1;
      if (context.questions.length > 200) {
        const removed = context.questions.shift()!;
        for (const axis of ["discipline", "physicianActivity", "careDimension"] as const) counts[axis][removed.blueprint[axis]] -= 1;
      }
      if (i >= 199) for (const axis of ["discipline", "physicianActivity", "careDimension"] as const) {
        for (const [key, target] of Object.entries(targets[axis])) largestDeviation = Math.max(largestDeviation, Math.abs((counts[axis][key] ?? 0) / 200 - target));
      }
    }
    expect(largestDeviation).toBeLessThanOrEqual(.05);
    expect(seen.size).toBe(objectives.length);
  }, 30_000);

  it("does not let objective abundance affect blueprint category selection", () => {
    const uneven = new Map([...eligibleCombinations].map(([key, entries]) => [key, key.startsWith("medicine/") ? Array.from({ length: 15 }, () => entries).flat() : entries]));
    const first = seeded(42), second = seeded(42);
    const context = { questions: [], objectiveStats: {} };
    for (let i = 0; i < 100; i += 1) {
      const a = selectBlueprint(context, first), b = selectBlueprint(context, second, Date.now(), uneven);
      expect([a.blueprint.discipline, a.blueprint.physicianActivity, a.blueprint.careDimension]).toEqual([b.blueprint.discipline, b.blueprint.physicianActivity, b.blueprint.careDimension]);
    }
  });

  it("adapts objective selection to weakness within a fixed category", () => {
    const entries = eligibility.filter((e) => e.discipline === "medicine" && e.physicianActivity === "assessment_diagnosis" && e.careDimension === "acute");
    const ids = [...new Set(entries.map((e) => e.objectiveId))].slice(0, 2);
    const combination = new Map([["fixed", entries.filter((e) => ids.includes(e.objectiveId))]]);
    const counts = [0, 0];
    const random = seeded(57);
    for (let i = 0; i < 10_000; i += 1) {
      const choice = selectBlueprint({ questions: [], objectiveStats: {
        [ids[0]]: { attempts: 20, errors: 20, recentCount: 0 },
        [ids[1]]: { attempts: 20, errors: 0, recentCount: 0 }
      } }, random, 0, combination);
      counts[ids.indexOf(choice.blueprint.mccObjectiveIds[0])] += 1;
      expect(choice.blueprint.physicianActivity).toBe("assessment_diagnosis");
    }
    expect(counts[0]).toBeGreaterThan(counts[1] * 1.1);
  });

  it("deduplicates coverage and chooses a less recently used eligible task", () => {
    const entry = eligibility.find((e) => e.cognitiveTasks.length > 1)!;
    const context: SamplingContext = { questions: [], objectiveStats: {} };
    const selected = selectBlueprint(context, () => 0, 0, new Map([["one", [entry]]]));
    const record = { id: "already-queued", generatedAt: "2026-10-16T00:00:00Z", blueprint: selected.blueprint };
    context.questions = [record, record];
    const next = selectBlueprint(context, () => 0, 0, new Map([["one", [entry]]]));
    expect(next.blueprint.cognitiveTask).not.toBe(selected.blueprint.cognitiveTask);
    expect(() => selectBlueprint(context, () => 0, 0, new Map())).toThrow(/eligible/);
  });
});
