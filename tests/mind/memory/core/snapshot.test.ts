import { afterAll, beforeEach, expect, test } from "vitest";
import { seedSnapshot } from "@/mind/memory/core/snapshot";
import { coreDepsOf } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("seeds version 0 from the seed self, once", async () => {
  const deps = coreDepsOf(makeTestDeps());
  expect(await seedSnapshot(deps)).toBe(true);
  expect(await seedSnapshot(deps)).toBe(false);
  const snap = await deps.core.memory.latestSnapshot();
  expect(snap).toMatchObject({ version: 0, model: "seed", prompt_version: "v3" });
  expect(snap!.content).toBe(loadPersona(deps.config).seedSelf);
});

test("never overwrites a later version", async () => {
  const deps = coreDepsOf(makeTestDeps());
  await deps.core.memory.insertSnapshot({
    version: 4,
    content: "later",
    sections: {},
    source_ids: [],
    rendered_at: deps.clock.now(),
    model: "m",
    prompt_version: "v1",
  });
  expect(await seedSnapshot(deps)).toBe(false);
  expect((await deps.core.memory.latestSnapshot())!.version).toBe(4);
});
