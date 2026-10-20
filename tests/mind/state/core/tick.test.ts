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
          blocks: [{ start: "08:00", end: "11:00", kind: "busy", busy: 1, label: "reading" }],
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
  await full.core.state.ensure(full.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
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

test("the tick depletes needs and lets an old emotion go", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  const cfg = deps.config.core.state;
  await deps.core.state.ensure(cfg.baseline, {
    autonomy: cfg.needs_baseline,
    competence: cfg.needs_baseline,
  });
  const now = new Date("2026-01-05T09:00:00Z");
  const old = new Date(now.getTime() - (cfg.emotion_hours + 1) * H);
  await deps.core.state.update({
    emotion: {
      label: "giddy",
      valence: 0.6,
      arousal: 0.7,
      phrase: null,
      about: null,
      since: old.toISOString(),
    },
  });
  await coreStateTick(deps, now);
  const row = (await deps.core.state.get())!;
  expect(row.emotion).toBeNull();
  expect(row.needs.autonomy).toBeCloseTo(cfg.needs_baseline - cfg.need_decay_per_day / 24);
});

test("a long busy run takes her offline at the tick she drops below enter, and back later", async () => {
  const deps = makeTestDeps({ core: { state: { noise: 0 } }, life: { timezone: "UTC" } });
  await insertLifeDay(deps.db, {
    date: "2026-01-05",
    plan: { blocks: [{ start: "00:00", end: "24:00", kind: "busy", busy: 1, label: "reading" }] },
    source: "scripted",
    model: "none",
    prompt_version: "scripted",
    generated_at: new Date("2026-01-05T00:00:00Z"),
  });
  const core = coreDepsOf(deps);
  let wentOffline: Date | null = null;
  for (let h = 1; h <= 23 && !wentOffline; h++) {
    await coreStateTick(core, new Date(Date.UTC(2026, 0, 5, h)));
    wentOffline = (await deps.core.state.get())!.offline_since;
  }
  expect(wentOffline).not.toBeNull();
  expect((await deps.core.state.get())!.energy).toBeLessThan(deps.config.core.state.offline.enter);
  // Offline ignores her plan, so the busy day doesn't drain her and she recovers.
  let back = false;
  for (let h = 1; h <= 12 && !back; h++) {
    await coreStateTick(core, new Date(wentOffline!.getTime() + h * H));
    back = (await deps.core.state.get())!.offline_since === null;
  }
  expect(back).toBe(true);
  expect((await deps.core.state.get())!.energy).toBeGreaterThanOrEqual(
    deps.config.core.state.offline.exit,
  );
});

test("a busy block running to midnight drains her in the first tick after it", async () => {
  const run = async (busy: boolean) => {
    await resetDb();
    const full = makeTestDeps({ core: { state: { noise: 0 } }, life: { timezone: "UTC" } });
    if (busy)
      await insertLifeDay(full.db, {
        date: "2026-01-04",
        plan: {
          blocks: [{ start: "22:00", end: "24:00", kind: "busy", busy: 1, label: "reading" }],
        },
        source: "scripted",
        model: "none",
        prompt_version: "scripted",
        generated_at: at,
      });
    await coreStateTick(coreDepsOf(full), new Date("2026-01-05T00:45:00Z"));
    return (await full.core.state.get())!.energy;
  };
  expect(await run(true)).toBeLessThan(await run(false));
});
