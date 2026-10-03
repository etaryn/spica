/** The nightly coordinator claims one local date and isolates its ordered core loops. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { core_loop_trace } from "@/db/schema";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreNightly } from "@/mind/process/core/nightly";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const early = new Date("2026-01-04T18:59:00Z"); // 02:59 in Singapore
const first = new Date("2026-01-04T19:00:00Z"); // 03:00 in Singapore
const next = new Date("2026-01-05T19:00:00Z");

function setup(overrides: unknown = {}) {
  const all = makeTestDeps(overrides);
  const deps = coreDepsOf(all);
  const errors: unknown[] = [];
  deps.log = { info: () => {}, error: (_message, meta) => errors.push(meta) };
  return { all, deps, errors };
}

test("claims only from local hour three and runs once per local date", async () => {
  const { deps, all } = setup({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  expect(await coreNightly(deps, early)).toBe(false);
  expect(await deps.core.state.get()).toBeNull();
  expect(await coreNightly(deps, first)).toBe(true);
  expect((await deps.core.state.get())?.last_nightly_day).toBe("2026-01-05");
  expect(await coreNightly(deps, new Date("2026-01-05T18:59:00Z"))).toBe(false);
  expect(await coreNightly(deps, next)).toBe(true);
  expect((await deps.core.state.get())?.last_nightly_day).toBe("2026-01-06");
  expect(await all.db.select().from(core_loop_trace)).toHaveLength(6);
});

test("concurrent jobs claim one date before either starts a loop", async () => {
  const { deps, all } = setup({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  expect((await Promise.all([coreNightly(deps, first), coreNightly(deps, first)])).sort()).toEqual([
    false,
    true,
  ]);
  expect(await all.db.select().from(core_loop_trace)).toHaveLength(3);
});

test("uses the captured time even if the clock changes during the run", async () => {
  const { deps, all } = setup({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  all.clock.set(next);
  await coreNightly(deps, first);
  expect((await deps.core.state.get())?.last_nightly_day).toBe("2026-01-05");
  expect((await all.db.select().from(core_loop_trace)).map((row) => row.created_at)).toEqual([
    first,
    first,
    first,
  ]);
});

test("reflect, consolidate, render, then drift run in order", async () => {
  const { deps, all } = setup();
  await seedSnapshot(deps);
  expect(await coreNightly(deps, first)).toBe(true);
  expect((await all.db.select().from(core_loop_trace)).map((row) => row.loop)).toEqual([
    "core_reflect",
    "core_consolidate",
    "core_render_snapshot",
    "core_drift_watch",
  ]);
  expect((await deps.core.memory.latestSnapshot())?.version).toBe(1);
});

test("a failed render does not stop earlier steps or trigger drift and cannot retry tonight", async () => {
  const { deps, all, errors } = setup();
  await seedSnapshot(deps);
  class RenderFailure extends Error {}
  all.llm.handlers.core_render_snapshot = () => {
    throw new RenderFailure("private content");
  };
  expect(await coreNightly(deps, first)).toBe(true);
  expect((await all.db.select().from(core_loop_trace)).map((row) => row.loop)).toEqual([
    "core_reflect",
    "core_consolidate",
    "core_render_snapshot",
  ]);
  expect((await deps.core.memory.latestSnapshot())?.version).toBe(0);
  expect(JSON.stringify(errors)).toContain("RenderFailure");
  expect(JSON.stringify(errors)).not.toContain("private content");
  expect(await coreNightly(deps, first)).toBe(false);
});

test("a failed reflect leaves later steps eligible", async () => {
  const { deps, all } = setup();
  await seedSnapshot(deps);
  const original = deps.core.traces.latestDone;
  deps.core.traces.latestDone = async () => {
    throw new Error("reflect read failed");
  };
  expect(await coreNightly(deps, first)).toBe(true);
  deps.core.traces.latestDone = original;
  expect((await all.db.select().from(core_loop_trace)).map((row) => row.loop)).toEqual([
    "core_reflect",
    "core_consolidate",
    "core_render_snapshot",
    "core_drift_watch",
  ]);
});

test("a pre-render snapshot read failure is logged and cannot retry until the next night", async () => {
  const { deps, all, errors } = setup({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  const original = deps.core.memory.latestSnapshot;
  class SnapshotReadFailure extends Error {}
  deps.core.memory.latestSnapshot = async () => {
    throw new SnapshotReadFailure("private snapshot content");
  };
  expect(await coreNightly(deps, first)).toBe(true);
  deps.core.memory.latestSnapshot = original;
  expect((await all.db.select().from(core_loop_trace)).map((row) => row.loop)).toEqual([
    "core_reflect",
    "core_consolidate",
  ]);
  expect(JSON.stringify(errors)).toContain("SnapshotReadFailure");
  expect(JSON.stringify(errors)).not.toContain("private snapshot content");
  expect(await coreNightly(deps, first)).toBe(false);
  expect(await coreNightly(deps, next)).toBe(true);
});

test("a post-render snapshot read failure preserves the new snapshot and skips drift", async () => {
  const { deps, all, errors } = setup();
  await seedSnapshot(deps);
  const original = deps.core.memory.latestSnapshot;
  class SnapshotReadFailure extends Error {}
  deps.core.memory.latestSnapshot = async () => {
    const snapshot = await original();
    if (snapshot?.version === 1) throw new SnapshotReadFailure("private snapshot content");
    return snapshot;
  };
  expect(await coreNightly(deps, first)).toBe(true);
  deps.core.memory.latestSnapshot = original;
  expect((await deps.core.memory.latestSnapshot())?.version).toBe(1);
  expect((await all.db.select().from(core_loop_trace)).map((row) => row.loop)).toEqual([
    "core_reflect",
    "core_consolidate",
    "core_render_snapshot",
  ]);
  expect(JSON.stringify(errors)).toContain("SnapshotReadFailure");
  expect(JSON.stringify(errors)).not.toContain("private snapshot content");
});
