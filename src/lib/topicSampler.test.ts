import { describe, expect, it } from "vitest";
import { selectWeightedTopic } from "./topicSampler";
import type { TopicDefinition } from "./contracts";

const sample: TopicDefinition[] = [
  { id: "one", category: "Test", title: "One", description: "A sufficiently long description for one.", weight: 1, status: "curated" },
  { id: "two", category: "Test", title: "Two", description: "A sufficiently long description for two.", weight: 3, status: "curated" }
];

describe("selectWeightedTopic", () => {
  it("honours exclusions", () => expect(selectWeightedTopic(sample, ["one"], () => 0).id).toBe("two"));
  it("uses relative weights deterministically", () => {
    expect(selectWeightedTopic(sample, [], () => 0.1).id).toBe("one");
    expect(selectWeightedTopic(sample, [], () => 0.9).id).toBe("two");
  });
  it("relaxes exclusions when all topics are excluded", () => expect(selectWeightedTopic(sample, ["one", "two"], () => 0).id).toBe("one"));
});
