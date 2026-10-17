import { z } from "zod";
import catalogue from "../../curriculum/catalogue.json" with { type: "json" };
import rawCrosswalk from "../../curriculum/crosswalk.json" with { type: "json" };
import { cognitiveTaskSchema, disciplineSchema, physicianActivitySchema, careDimensionSchema } from "../lib/blueprint.js";

if (rawCrosswalk.curriculumVersion !== catalogue.version) throw new Error("MCC crosswalk must be rebuilt for the current curriculum snapshot");

const eligibilitySchema = z.object({
  objectiveId: z.string(),
  discipline: disciplineSchema,
  physicianActivity: physicianActivitySchema,
  careDimension: careDimensionSchema,
  cognitiveTasks: z.array(cognitiveTaskSchema).min(1),
  enablingObjectiveId: z.string(),
  baselinePriority: z.number().positive()
});
export type Eligibility = z.infer<typeof eligibilitySchema>;
export const eligibility = z.array(eligibilitySchema).min(1).parse(rawCrosswalk.entries);
export const curriculumVersion = catalogue.version;
export const crosswalkVersion = rawCrosswalk.version;
export const objectives = catalogue.objectives;
export const objectivesById = new Map(objectives.map((objective) => [objective.id, objective]));
export const objectiveTopicId = (id: string): string => `mcc.${id}`;
export const combinationKey = (entry: Pick<Eligibility, "discipline" | "physicianActivity" | "careDimension">): string =>
  `${entry.discipline}/${entry.physicianActivity}/${entry.careDimension}`;

export const eligibleCombinations = new Map<string, Eligibility[]>();
for (const entry of eligibility) {
  const key = combinationKey(entry);
  const entries = eligibleCombinations.get(key) ?? [];
  entries.push(entry);
  eligibleCombinations.set(key, entries);
}
