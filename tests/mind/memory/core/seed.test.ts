/**
 * Seeding her core mind: snapshot v0 from the seed self, and the canon people she has always known.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { seedCore, seedGoals, seedSnapshot } from "@/mind/memory/core/seed";
import { coreDepsOf } from "@/mind/platform/deps";
import { loadPersona, parseSeedGoals } from "@/mind/platform/persona";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("seeds version 0 from the seed self, once", async () => {
  const deps = coreDepsOf(makeTestDeps());
  expect(await seedSnapshot(deps)).toBe(true);
  expect(await seedSnapshot(deps)).toBe(false);
  const snap = await deps.core.memory.latestSnapshot();
  expect(snap).toMatchObject({ version: 0, model: "seed", prompt_version: "v5" });
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

test("seedCore seeds her goals once, active, from the persona", async () => {
  const deps = coreDepsOf(makeTestDeps());
  await seedCore(deps);
  await seedCore(deps);
  const goals = await deps.core.goals.active();
  expect(goals.map((g) => g.title)).toEqual(
    parseSeedGoals(loadPersona(deps.config).seedSelf).map((g) => g.title),
  );
  expect(goals.every((g) => g.source === "seed" && g.progress === 0)).toBe(true);
});

test("seeding never adds goals when she already has some", async () => {
  const deps = coreDepsOf(makeTestDeps());
  await deps.core.goals.insert({
    title: "Her own",
    why: "reflect made it",
    status: "dropped",
    progress: 0,
    source: "reflect",
    source_ref: null,
    started_at: deps.clock.now(),
    target_at: null,
    embedding: vec(),
  });
  await seedGoals(deps);
  expect(await deps.core.goals.count()).toBe(1);
});
