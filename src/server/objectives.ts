import snapshot from "../../curriculum/objectives.json" with { type: "json" };
import { curriculumVersion } from "../data/curriculum.js";

if (snapshot.version !== curriculumVersion) throw new Error("MCC source snapshot and catalogue versions differ");
export const sourceObjectivesById = new Map(snapshot.objectives.map((objective) => [objective.id, objective]));
