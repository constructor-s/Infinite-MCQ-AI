import rawTopics from "../../curriculum/topics.json" with { type: "json" };
import { topicDefinitionSchema, type TopicDefinition } from "../lib/contracts.js";
import { z } from "zod";

// Starter curriculum reference; active generation uses data/curriculum.ts.
export const topics: TopicDefinition[] = z.array(topicDefinitionSchema).parse(rawTopics);

export const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
