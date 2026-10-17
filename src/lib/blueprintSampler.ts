import { blueprint, type BlueprintTags } from "./blueprint.js";
import { eligibleCombinations, type Eligibility } from "../data/curriculum.js";

export type CoverageRecord = { id: string; generatedAt: string; blueprint: BlueprintTags };
export type ObjectiveStats = { attempts: number; errors: number; lastExposedAt?: string; recentCount: number };
export type SamplingContext = { questions: CoverageRecord[]; objectiveStats: Record<string, ObjectiveStats> };
export type BlueprintSelection = { topicId: string; blueprint: BlueprintTags; enablingObjectiveId: string };

function pick<T>(items: T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

function weighted<T>(items: T[], weight: (item: T) => number, random: () => number): T {
  const weights = items.map(weight);
  let point = random() * weights.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < items.length; i += 1) {
    point -= weights[i];
    if (point < 0) return items[i];
  }
  return items[items.length - 1];
}

// All category candidates have one vote, regardless of how many source objectives
// or enabling clauses they contain. Personalization happens only AFTER this step.
export function selectBlueprint(
  context: SamplingContext,
  random: () => number = Math.random,
  now = Date.now(),
  combinations: Map<string, Eligibility[]> = eligibleCombinations
): BlueprintSelection {
  if (!combinations.size) throw new Error("No eligible MCC blueprint combinations");
  const history = [...new Map(context.questions.map((q) => [q.id, q])).values()]
    .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  // Drop the outgoing item before scoring the next 200-item rolling window.
  const window = history.slice(-(blueprint.coverageWindow - 1));
  const axes = [
    ["discipline", blueprint.disciplines],
    ["physicianActivity", blueprint.physicianActivities],
    ["careDimension", blueprint.careDimensions]
  ] as const;
  const counts = axes.map(([axis, targets]) => Object.fromEntries(Object.keys(targets).map((key) => [key, window.filter((q) => q.blueprint[axis] === key).length])));
  let bestScore = Infinity;
  let candidates: Eligibility[][] = [];
  for (const entries of combinations.values()) {
    if (!entries.length) continue;
    const candidate = entries[0];
    let score = 0;
    axes.forEach(([axis, targets], index) => {
      for (const [key, target] of Object.entries(targets)) {
        const proportion = (counts[index][key] + (candidate[axis] === key ? 1 : 0)) / (window.length + 1);
        score += (proportion - target) ** 2 / target;
      }
    });
    if (score < bestScore - 1e-12) {
      bestScore = score;
      candidates = [entries];
    } else if (Math.abs(score - bestScore) < 1e-12) candidates.push(entries);
  }
  const finiteScores = candidates.length > 0 && Number.isFinite(bestScore);
  if (!finiteScores) candidates = [...combinations.values()].filter((entries) => entries.length > 0);
  if (!candidates.length) throw new Error("No eligible MCC blueprint combinations");
  // Independence is only a fallback when the scoring result is non-finite.
  // Normal finite-score ties are randomized uniformly, as specified.
  const entries = finiteScores ? pick(candidates, random) : weighted(candidates, (items) =>
    blueprint.physicianActivities[items[0].physicianActivity] * blueprint.careDimensions[items[0].careDimension], random);
  const byObjective = new Map<string, Eligibility[]>();
  for (const entry of entries) {
    const list = byObjective.get(entry.objectiveId) ?? [];
    list.push(entry);
    byObjective.set(entry.objectiveId, list);
  }
  const objectiveEntries = [...byObjective.values()];
  const adaptive = random() < blueprint.adaptiveMix;
  const selected = weighted(objectiveEntries, (items) => {
    const priority = items[0].baselinePriority;
    if (!adaptive) return priority;
    const stats = context.objectiveStats[items[0].objectiveId];
    // Beta(1,1) smoothing gives unseen objectives neutral weakness (1.5).
    const weakness = 1 + ((stats?.errors ?? 0) + 1) / ((stats?.attempts ?? 0) + 2);
    const days = stats?.lastExposedAt ? Math.max(0, (now - Date.parse(stats.lastExposedAt)) / 86_400_000) : 30;
    const spacing = 1 + Math.min(1, days / 30);
    const coverage = 1 + 1 / (1 + (stats?.recentCount ?? 0));
    return priority * weakness * spacing * coverage;
  }, random);
  const tasks = [...new Set(selected.flatMap((entry) => entry.cognitiveTasks))];
  const lastTask = (task: string) => {
    // Track task diversity within the selected activity across objectives, not
    // merely the last task on this particular objective.
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].blueprint.physicianActivity === selected[0].physicianActivity && history[index].blueprint.cognitiveTask === task) return index;
    }
    return -1;
  };
  const oldest = Math.min(...tasks.map(lastTask));
  const task = pick(tasks.filter((item) => lastTask(item) === oldest), random);
  const entry = pick(selected.filter((item) => item.cognitiveTasks.includes(task)), random);
  return {
    topicId: `mcc.${entry.objectiveId}`,
    blueprint: { discipline: entry.discipline, physicianActivity: entry.physicianActivity, careDimension: entry.careDimension,
      cognitiveTask: task, mccObjectiveIds: [entry.objectiveId] },
    enablingObjectiveId: entry.enablingObjectiveId
  };
}
