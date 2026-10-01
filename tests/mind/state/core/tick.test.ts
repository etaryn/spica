import { afterAll, beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { core_loop_trace } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreStateTick } from "@/mind/state/core/tick";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const H = 3_600_000;
const at = new Date("2026-01-05T11:00:00Z");

test("one step per hour, writing a trace", async () => {
  const full = makeTestDeps();
  const deps = coreDepsOf(full);
  expect(await coreStateTick(deps, at)).toBe("done");
  expect(await coreStateTick(deps, new Date(at.getTime() + 20 * 60_000))).toBe("not_due");
  expect(await coreStateTick(deps, new Date(at.getTime() + H))).toBe("done");
  const traces = await full.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "core_state_tick"));
  expect(traces).toHaveLength(2);
  expect(traces[0]!.model).toBeNull();
});

test("a busy day pulls energy lower than a free one", async () => {
  const run = async (busy: boolean) => {
    await resetDb();
    const full = makeTestDeps({ core: { state: { noise: 0 } }, life: { timezone: "UTC" } });
    if (busy)
      await insertLifeDay(full.db, {
        date: "2026-01-05",
        plan: {
          blocks: [{ start: "01:00", end: "10:00", kind: "busy", busy: 1, label: "reading" }],
        },
        source: "scripted",
        model: "none",
        prompt_version: "scripted",
        generated_at: at,
      });
    await coreStateTick(coreDepsOf(full), at);
    return (await full.core.state.get())!.energy;
  };
  expect(await run(true)).toBeLessThan(await run(false));
});

test("the same hour gives the same state: noise is seeded by the hour alone", async () => {
  const once = async () => {
    await resetDb();
    const full = makeTestDeps();
    await coreStateTick(coreDepsOf(full), at);
    return full.core.state.get();
  };
  expect(await once()).toEqual(await once());
});

test("an old preoccupation expires", async () => {
  const full = makeTestDeps();
  const deps = coreDepsOf(full);
  await full.core.state.ensure(full.config.core.state.baseline);
  const id = await full.core.memory.insert({
    kind: "episode",
    content: "x",
    embedding: Array(1024).fill(0.01),
    occurred_at: at,
    created_at: at,
    status: "open",
    salience: 0.4,
    valence: 0.9,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
  const since = new Date(at.getTime() - (full.config.core.state.preoccupation_hours + 1) * H);
  await full.core.state.update({ preoccupation: id, preoccupation_since: since });
  await coreStateTick(deps, at);
  expect((await full.core.state.get())!.preoccupation).toBeNull();
});
