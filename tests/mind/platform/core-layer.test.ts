/**
 * The core data layer can't name a user: no core interface takes a user id, and what a core loop
 * receives holds no database handle.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import { makeTestDeps } from "../../helpers/deps";

const INTERFACE_FILES = [
  "src/mind/platform/core.ts",
  "src/mind/memory/core/types.ts",
  "src/mind/state/core/types.ts",
  "src/mind/world/types.ts",
];

test("no core interface mentions a user id", () => {
  for (const file of INTERFACE_FILES) {
    expect(readFileSync(file, "utf8"), file).not.toMatch(/user_?id/i);
  }
});

test("core loops get no database, queue, push, event bus or module bus", () => {
  const core = coreDepsOf(makeTestDeps());
  for (const key of ["db", "queue", "pusher", "events", "modules"])
    expect(core).not.toHaveProperty(key);
  expect(Object.keys(core).sort()).toEqual(
    [
      "clock",
      "config",
      "core",
      "emitCore",
      "embedder",
      "llm",
      "log",
      "reelTools",
      "webSources",
    ].sort(),
  );
});
