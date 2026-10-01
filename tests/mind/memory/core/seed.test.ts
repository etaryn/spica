/**
 * Seeding her core mind: snapshot v0 from the seed self, and the canon people she has always known.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { seedCore, seedSnapshot } from "@/mind/memory/core/seed";
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
  expect(snap).toMatchObject({ version: 0, model: "seed", prompt_version: "v4" });
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

test("seedCore writes snapshot v0 and her canon people, stamped now, once", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await seedCore(deps);
  all.clock.advance(60_000);
  await seedCore(deps);
  const people = await deps.core.memory.entities();
  expect(people.map((e) => e.name)).toEqual(deps.config.core.world.canon_entities);
  expect(people[0]!.first_seen.getTime()).toBe(deps.clock.now().getTime() - 60_000);
  expect((await deps.core.memory.latestSnapshot())!.version).toBe(0);
});

test("canon people never count as someone new", async () => {
  const deps = coreDepsOf(makeTestDeps());
  await seedCore(deps);
  expect(await deps.core.memory.latestEntityFirstSeen(deps.config.core.world.canon_entities)).toBe(
    null,
  );
});
