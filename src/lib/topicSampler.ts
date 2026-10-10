import type { TopicDefinition } from "./contracts";

export function selectWeightedTopic(
  topics: TopicDefinition[],
  excludedIds: Iterable<string>,
  random: () => number = Math.random
): TopicDefinition {
  const excluded = new Set(excludedIds);
  let eligible = topics.filter((topic) => !excluded.has(topic.id));
  if (!eligible.length) eligible = topics;
  const total = eligible.reduce((sum, topic) => sum + topic.weight, 0);
  let point = random() * total;
  for (const topic of eligible) {
    point -= topic.weight;
    if (point <= 0) return topic;
  }
  return eligible[eligible.length - 1];
}
