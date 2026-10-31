import { z } from "zod";
import config from "../../curriculum/blueprint.json" with { type: "json" };

export const disciplineSchema = z.enum(["medicine", "surgery", "pediatrics", "obgyn", "psychiatry", "phelo"]);
export const physicianActivitySchema = z.enum(["assessment_diagnosis", "management", "communication", "professional_behaviours"]);
export const careDimensionSchema = z.enum(["acute", "chronic", "prevention", "psychosocial"]);
export type Discipline = z.infer<typeof disciplineSchema>;
export type PhysicianActivity = z.infer<typeof physicianActivitySchema>;
export type CareDimension = z.infer<typeof careDimensionSchema>;
export type CognitiveTask = keyof typeof config.cognitiveTasks;
export const cognitiveTaskSchema = z.enum(Object.keys(config.cognitiveTasks) as [CognitiveTask, ...CognitiveTask[]]);
export const blueprintTagsSchema = z.object({
  discipline: disciplineSchema,
  physicianActivity: physicianActivitySchema,
  careDimension: careDimensionSchema,
  cognitiveTask: cognitiveTaskSchema,
  mccObjectiveIds: z.array(z.string().min(1)).min(1).max(5)
});
export type BlueprintTags = z.infer<typeof blueprintTagsSchema>;
export const blueprint = config;
export const PROMPT_VERSION = "mccqe-refined-v7";

export function sameBlueprint(a: BlueprintTags, b: BlueprintTags): boolean {
  return a.discipline === b.discipline && a.physicianActivity === b.physicianActivity &&
    a.careDimension === b.careDimension && a.cognitiveTask === b.cognitiveTask &&
    a.mccObjectiveIds.length === b.mccObjectiveIds.length &&
    a.mccObjectiveIds.every((id, index) => id === b.mccObjectiveIds[index]);
}
