/**
 * Eval checks on her world and her core mind: life counts and event decisions, and her core state
 * history (energy, preoccupation, episodes, world events).
 */
import { afterAll, expect, test } from "vitest";
import {
  checkCore,
  checkLife,
  coreHistory,
  energyAt,
  type CoreHistory,
} from "../../evals/lib/core-check";
import { CoreAssertion, LifeAssertion } from "../../evals/lib/script";
import { core_loop_trace, drift_log } from "@/db/schema";
import { closeTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

afterAll(closeTestDb);

const snap = {
  plans: 15,
  events: 2,
  logs: [{ content: "Spica hasn't started reading Middlemarch yet.", decision: "contradicts" }],
  memories: ["Spica finished reading Middlemarch last week."],
};

test("checkLife: counts, decisions and not_stored", () => {
  expect(
    checkLife(snap, LifeAssertion.parse({ type: "life", plans: { min: 14 }, events: { min: 1 } }))
      .ok,
  ).toBe(true);
  expect(
    checkLife(
      snap,
      LifeAssertion.parse({
        type: "life",
        decision: { content_includes: "hasn't started", in: ["contradicts", "duplicate"] },
      }),
    ).ok,
  ).toBe(true);
  expect(
    checkLife(
      snap,
      LifeAssertion.parse({
        type: "life",
        decision: { content_includes: "hasn't started", in: ["duplicate"] },
      }),
    ).detail,
  ).toMatch(/expected one of duplicate/);
  expect(
    checkLife(snap, LifeAssertion.parse({ type: "life", not_stored: "hasn't started" })).ok,
  ).toBe(true);
  expect(
    checkLife(snap, LifeAssertion.parse({ type: "life", not_stored: "finished reading" })).ok,
  ).toBe(false);
});

const structural = {
  snapshotVersions: 14,
  drift: { values: 14, diff: 14, trend: 14 },
  activeGoals: 2,
  fellThrough: true,
  doneLoops: ["core_reflect", "core_wander"],
};

const d = (h: number) => new Date(Date.UTC(2026, 0, 5, h));
const at = (s: string) => (s === "a" ? d(26) : d(2));

test("checkCore: energyAt uses the latest tick at or before the time", () => {
  const h: CoreHistory = {
    ticks: [
      { at: d(1), energy: 0.6 },
      { at: d(25), energy: 0.3 },
    ],
    preoccupationEverSet: false,
    episodes: 0,
    worldEvents: 0,
    ...structural,
  };
  expect(energyAt(h.ticks, d(2))).toBe(0.6);
  expect(
    checkCore(
      h,
      CoreAssertion.parse({ type: "core", lower_energy: { at: "a", than: "b", by: 0.2 } }),
      at,
    ).ok,
  ).toBe(true);
  expect(
    checkCore(
      h,
      CoreAssertion.parse({ type: "core", lower_energy: { at: "a", than: "b", by: 0.4 } }),
      at,
    ).ok,
  ).toBe(false);
});

test("preoccupation_set reads the core state's preoccupation history", () => {
  const h: CoreHistory = {
    ticks: [],
    preoccupationEverSet: true,
    episodes: 2,
    worldEvents: 2,
    ...structural,
  };
  expect(checkCore(h, CoreAssertion.parse({ type: "core", preoccupation_set: true }), at).ok).toBe(
    true,
  );
  expect(checkCore(h, CoreAssertion.parse({ type: "core", episodes: { min: 3 } }), at).ok).toBe(
    false,
  );
  expect(
    checkCore(h, CoreAssertion.parse({ type: "core", world_events: { min: 1, max: 2 } }), at).ok,
  ).toBe(true);
});

test("coreHistory: a strong planned event's intention counts as taking over her mind", async () => {
  await resetDb();
  const deps = makeTestDeps();
  const t = new Date("2026-01-05T09:00:00Z");
  await deps.core.memory.insert({
    kind: "intention",
    content: "Spica is dreading the call with Alcor.",
    embedding: vec(0.01),
    occurred_at: t,
    created_at: t,
    status: "open",
    salience: 0.4,
    valence: -0.8,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
  const h = await coreHistory(deps.db, deps.config);
  expect(h).toMatchObject({ preoccupationEverSet: true, episodes: 0 });
});

test("structural core checks pass on a matching history", () => {
  const h: CoreHistory = {
    ticks: [],
    preoccupationEverSet: false,
    episodes: 0,
    worldEvents: 0,
    ...structural,
  };
  const a = CoreAssertion.parse({
    type: "core",
    snapshot_versions: { min: 14 },
    drift_rows: { values: 1, diff: 1, trend: 1 },
    goals: { min: 1 },
    fell_through: true,
    loops_done: ["core_reflect", "core_wander"],
  });
  expect(checkCore(h, a, at)).toEqual({ ok: true });
});

test("each structural check reports what is missing", () => {
  const h: CoreHistory = {
    ticks: [],
    preoccupationEverSet: false,
    episodes: 0,
    worldEvents: 0,
    ...structural,
  };
  const a = CoreAssertion.parse({
    type: "core",
    snapshot_versions: { min: 15 },
    drift_rows: { values: 20 },
    goals: { max: 1 },
    fell_through: false,
    loops_done: ["core_anticipate"],
  });
  const r = checkCore(h, a, at);
  expect(r.ok).toBe(false);
  for (const s of [
    "snapshot versions 14 < 15",
    "values drift rows 14 < 20",
    "active goals 2 > 1",
    "fell through",
    "core_anticipate",
  ])
    expect(r.detail).toContain(s);
});

test("coreHistory: snapshots above v0, drift by check, active goals and done loops", async () => {
  await resetDb();
  const deps = makeTestDeps();
  const t = new Date("2026-01-05T09:00:00Z");
  for (const version of [0, 1])
    await deps.core.memory.insertSnapshot({
      version,
      content: "x",
      sections: {},
      source_ids: [],
      rendered_at: t,
      model: "m",
      prompt_version: "v1",
      embedding: vec(),
    });
  await deps.db.insert(drift_log).values({ version: 1, check: "trend", score: 0, created_at: t });
  await deps.db.insert(core_loop_trace).values([
    { loop: "core_wander", inputs: {}, outputs: {}, status: "done", created_at: t },
    { loop: "core_ruminate", inputs: {}, outputs: {}, status: "skipped_budget", created_at: t },
  ]);
  const h = await coreHistory(deps.db, deps.config);
  expect(h).toMatchObject({
    snapshotVersions: 1,
    drift: { values: 0, diff: 0, trend: 1 },
    activeGoals: 0,
    fellThrough: false,
    doneLoops: ["core_wander"],
  });
});
