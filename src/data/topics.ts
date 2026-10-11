import rawTopics from "../../curriculum/topics.json" with { type: "json" };
import { topicDefinitionSchema, type TopicDefinition } from "../lib/contracts.js";
import { z } from "zod";

export const topics: TopicDefinition[] = z.array(topicDefinitionSchema).length(60).parse(rawTopics);

export const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
