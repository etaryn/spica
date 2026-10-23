/** Her self as the core loops read it: the snapshot headed by its night, or the seed self. */
import { expect, test } from "vitest";
import { latestSelf } from "@/mind/memory/core/self";
import { renderTimes } from "@/mind/platform/time-anchors";

const now = new Date("2026-01-15T10:00:00Z");

test("the latest snapshot comes headed by the day it was written", async () => {
  const memory = {
    latestSnapshot: async () => ({
      version: 3,
      embedding: null,
      content: "### Lately\n- tides",
      sections: {},
      source_ids: [],
      rendered_at: new Date("2026-01-14T22:00:00Z"),
      model: "m",
      prompt_version: "v",
    }),
  };
  expect(renderTimes(await latestSelf(memory, "SEED", "UTC"), now, 6)).toBe(
    "(written yesterday, Wednesday 14 January)\n### Lately\n- tides",
  );
});

test("before any snapshot it's the seed self, unstamped", async () => {
  expect(await latestSelf({ latestSnapshot: async () => null }, "SEED", "UTC")).toBe("SEED");
});
