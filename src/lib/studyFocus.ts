import { z } from "zod";
import { disciplineSchema, type Discipline } from "./blueprint.js";
import { eligibleCombinations, eligibility, objectives, objectivesById, type Eligibility } from "../data/curriculum.js";

export const disciplineLabels: Record<Discipline, string> = {
  medicine: "Medicine", surgery: "Surgery", pediatrics: "Pediatrics",
  obgyn: "Obstetrics / gynecology", psychiatry: "Psychiatry",
  phelo: "Population health, ethics, and legal obligations"
};

const objectiveIdsByDiscipline = new Map(disciplineSchema.options.map((discipline) => [
  discipline, new Set(eligibility.filter((entry) => entry.discipline === discipline).map((entry) => entry.objectiveId))
]));

export const focusedStudySchema = z.object({
  discipline: disciplineSchema,
  objectiveId: z.string().min(1).optional()
}).strict();

export const studyFocusSchema = focusedStudySchema.nullable().refine((focus) => !focus?.objectiveId ||
  (objectivesById.has(focus.objectiveId) && objectiveIdsByDiscipline.get(focus.discipline)!.has(focus.objectiveId)),
{ message: "Choose an objective eligible for this discipline" });
export type FocusedStudy = z.infer<typeof focusedStudySchema>;
export type StudyFocus = z.infer<typeof studyFocusSchema>;

export function focusKey(focus?: StudyFocus): string {
  return focus ? `${focus.discipline}/${focus.objectiveId ?? "all"}` : "mixed";
}

export function sameStudyFocus(a?: StudyFocus, b?: StudyFocus): boolean {
  return focusKey(a) === focusKey(b);
}

export function studyFocusLabel(focus: StudyFocus): string {
  if (!focus) return "Mixed practice";
  const discipline = disciplineLabels[focus.discipline];
  return focus.objectiveId ? `${discipline} · ${objectivesById.get(focus.objectiveId)!.title}` : `${discipline} · All topics`;
}

export function focusObjectives(discipline: Discipline) {
  const ids = objectiveIdsByDiscipline.get(discipline)!;
  return objectives.filter((objective) => ids.has(objective.id)).sort((a, b) => a.title.localeCompare(b.title));
}

export function focusCombinations(focus: StudyFocus): Map<string, Eligibility[]> {
  if (!focus) return eligibleCombinations;
  const combinations = new Map<string, Eligibility[]>();
  for (const [key, entries] of eligibleCombinations) {
    const matching = entries.filter((entry) => entry.discipline === focus.discipline &&
      (!focus.objectiveId || entry.objectiveId === focus.objectiveId));
    if (matching.length) combinations.set(key, matching);
  }
  return combinations;
}
