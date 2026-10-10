import { randomUUID } from "node:crypto";
import { insertTurn } from "@/db/repos/user/session-log";
import { afterAll, beforeEach, expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { coreStateTick } from "@/mind/state/core/tick";
import { inspectCore } from "@/db/repos/admin/inspector-core";
import { loadConfig } from "@/mind/platform/config";
import { insertFact } from "@/db/repos/user/facts";
import { fact as factTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getLifeView,
  getRelationshipView,
  listFacts,
  listReachOuts,
  listUserMindRuns,
  parseFactFilters,
  resolveFactContents,
} from "@/db/repos/admin/inspector";
import { listJudgeLogs } from "@/db/repos/user/judge-log";
import { insertJudgeLogs } from "@/db/repos/user/judge-log";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { insertReachOutLog } from "@/db/repos/user/reach-out";
import { ensureRelationship, insertRelationshipEvents } from "@/db/repos/user/relationship";
import * as s from "@/db/schema";
import { makeTestDeps } from "../helpers/deps";
import { recordBigEvents, runUserMind } from "@/mind/process/user/run";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

async function addFact(
  userId: string,
  content: string,
  subject: "user" | "self",
  salience: number,
  day: number,
) {
  await getTestDb()
    .insert(s.fact)
    .values({
      user_id: userId,
      subject,
      kind: "event",
      content,
      embedding: vec(),
      created_at: new Date(Date.UTC(2026, 0, day)),
      status: "open",
      salience,
      valence: 0,
      confidence: 0.9,
      source: "turn",
    });
}

test("listFacts filters by subject, sorts, and is user-scoped", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  await addFact(a, "low old", "user", 0.2, 1);
  await addFact(a, "high new", "user", 0.9, 5);
  await addFact(a, "self fact", "self", 0.5, 3);
  await addFact(b, "b's fact", "user", 1, 9);

  const bySalience = await listFacts(
    getTestDb(),
    a,
    parseFactFilters({ subject: "user", sort: "salience" }),
  );
  expect(bySalience.map((f) => f.content)).toEqual(["high new", "low old"]);
  const byRecency = await listFacts(getTestDb(), a, parseFactFilters({}));
  expect(byRecency.map((f) => f.content)).toEqual(["high new", "self fact", "low old"]);
  expect("embedding" in byRecency[0]!).toBe(false);
});

test("parseFactFilters ignores invalid values", () => {
  expect(
    parseFactFilters({ subject: "bogus", status: "open", entityId: "x", sort: "weird" }),
  ).toEqual({
    subject: undefined,
    status: "open",
    entityId: undefined,
    threadId: undefined,
    sort: "recency",
  });
});

test("resolveFactContents: user-scoped and view-time; a forgotten fact's judge_log row survives but resolves to nothing", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const f = await insertFact(getTestDb(), a, {
    subject: "user",
    kind: "trait",
    content: "The user's dog is called Biscuit.",
    embedding: vec(),
    created_at: new Date("2026-01-01T00:00:00Z"),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.9,
    source: "turn",
  });
  await insertJudgeLogs(getTestDb(), a, [
    {
      kind: "guard",
      turn_id: null,
      attempt: 1,
      input: { recalledFacts: [{ id: f.id, subject: "user" }], onboardingFacts: [], text: "hi" },
      output: { violations: [] },
      outcome: "passed",
      source: "model",
      latency_ms: 5,
      model: "claude-haiku-4-5",
      prompt_version: "guard@v1",
      created_at: new Date("2026-01-05T00:00:00Z"),
    },
  ]);

  expect(await resolveFactContents(getTestDb(), a, [f.id])).toEqual(
    new Map([[f.id, "The user's dog is called Biscuit."]]),
  );
  // Another user's query never resolves this user's fact, even with the right id.
  expect(await resolveFactContents(getTestDb(), b, [f.id])).toEqual(new Map());

  await getTestDb().delete(factTable).where(eq(factTable.id, f.id));

  // The judge_log row is untouched by the delete (no FK to fact); the resolver just can't find the id any more.
  const rows = await listJudgeLogs(getTestDb(), a);
  expect(rows).toHaveLength(1);
  expect(await resolveFactContents(getTestDb(), a, [f.id])).toEqual(new Map());
});

test("getRelationshipView: faded params with effect, events newest first, user-scoped", async () => {
  const db = getTestDb();
  const cfg = loadConfig().relationship;
  const [a, b] = [await createTestUser(), await createTestUser()];
  const now = new Date("2026-01-05T10:00:00Z");
  await ensureRelationship(db, a, now, cfg);
  await insertRelationshipEvents(
    db,
    a,
    [{ param: "hurt", before: 0, after: 0.3, cause: "signal", deviation: 1, detail: {} }],
    { turnId: null, now },
  );
  const v = await getRelationshipView(db, a, now, cfg);
  expect(v?.params.map((p) => p.name)).toEqual([
    "closeness",
    "trust",
    "warmth",
    "hurt",
    "tension",
    "msgs_per_day",
    "affect_valence",
    "afterglow",
    "user_disclosure",
    "user_responsiveness",
  ]);
  expect(v?.events).toHaveLength(1);
  expect(await getRelationshipView(db, b, now, cfg)).toBeNull();
});

test("getLifeView shows her shared plan for the day", async () => {
  const db = getTestDb();
  const t0 = new Date("2026-01-05T10:00:00Z");
  await insertLifeDay(db, {
    date: "2026-01-05",
    plan: { blocks: [] },
    source: "scripted",
    model: "none",
    prompt_version: "scripted",
    generated_at: t0,
  });
  expect((await getLifeView(db, "2026-01-05")).plan?.date).toBe("2026-01-05");
  expect((await getLifeView(db, "2026-01-06")).plan).toBeNull();
});

test("listReachOuts returns status, topic, answered_at and turn, newest first, user-scoped", async () => {
  const db = getTestDb();
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const t = new Date("2026-01-05T09:00:00Z");
  await insertReachOutLog(db, a, {
    candidates: [],
    winner: null,
    gate_results: [],
    status: "none",
    topic: null,
    send_at: null,
    created_at: t,
  });
  await insertReachOutLog(db, a, {
    candidates: [],
    winner: { kind: "thread" },
    gate_results: [],
    status: "sent",
    topic: "thread:x",
    send_at: t,
    created_at: new Date(t.getTime() + 1),
  });
  await insertReachOutLog(db, b, {
    candidates: [],
    winner: null,
    gate_results: [],
    status: "none",
    topic: null,
    send_at: null,
    created_at: t,
  });
  const rows = await listReachOuts(db, a, 200);
  expect(rows.map((r) => [r.status, r.topic])).toEqual([
    ["sent", "thread:x"],
    ["none", null],
  ]);
  expect(await listReachOuts(db, a, 1)).toHaveLength(1);
});

test("the core page shows state, snapshot, recent memories, traces and event attempts", async () => {
  const deps = makeTestDeps();
  await seedSnapshot(coreDepsOf(deps));
  await coreStateTick(coreDepsOf(deps), deps.clock.now());
  const view = await inspectCore(deps.db, {
    limit: 20,
    snapshotVersions: 5,
    dayStart: new Date(0),
  });
  expect(view.state).not.toBeNull();
  expect(view.snapshot?.version).toBe(0);
  expect(view.traces.map((t) => t.loop)).toContain("core_state_tick");
});

test("the core page shows budget by loop, goals, memory counts, snapshot changes and drift", async () => {
  const deps = makeTestDeps();
  const at = new Date("2026-01-05T09:00:00Z");
  // Two snapshots differing only in "Lately".
  for (const [version, lately] of [
    [0, "a"],
    [1, "b"],
  ] as const)
    await deps.core.memory.insertSnapshot({
      version,
      content: lately,
      sections: { Lately: lately, People: "Alcor" },
      source_ids: [],
      rendered_at: at,
      model: "m",
      prompt_version: "v1",
      embedding: vec(),
    });
  await deps.db.insert(s.core_loop_trace).values([
    { loop: "core_wander", inputs: {}, outputs: {}, calls: 1, status: "done", created_at: at },
    {
      loop: "core_wander",
      inputs: {},
      outputs: {},
      calls: 0,
      status: "skipped_budget",
      created_at: at,
    },
    // Yesterday's spend doesn't count toward today's budget.
    {
      loop: "core_reflect",
      inputs: {},
      outputs: {},
      calls: 3,
      status: "done",
      created_at: new Date(0),
    },
  ]);
  await deps.db
    .insert(s.drift_log)
    .values({ version: 1, check: "diff", score: 0.1, created_at: at });
  const v = await inspectCore(deps.db, {
    limit: 20,
    snapshotVersions: 5,
    dayStart: new Date(at.getTime() - 3600_000),
  });
  expect(v.budget).toHaveLength(2);
  expect(v.budget).toEqual(
    expect.arrayContaining([
      { loop: "core_wander", status: "done", calls: 1 },
      { loop: "core_wander", status: "skipped_budget", calls: 0 },
    ]),
  );
  expect(v.snapshots.map((x) => [x.version, x.changed])).toEqual([
    [1, ["Lately"]],
    [0, []],
  ]);
  expect(v.drift).toHaveLength(1);
  expect(v.goals).toEqual([]);
  expect(v.memoryCounts).toEqual([]);
});

test("listUserMindRuns: newest run first, each with its traces in order, one user only", async () => {
  const deps = makeTestDeps();
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const r1 = (await recordBigEvents(deps, deps.db, a, "exchange:1", [{ kind: "make_up_done" }]))!;
  deps.clock.set(new Date(deps.clock.now().getTime() + 60_000));
  const r2 = (await recordBigEvents(deps, deps.db, a, "exchange:2", [{ kind: "crisis_passed" }]))!;
  await recordBigEvents(deps, deps.db, b, "exchange:3", [{ kind: "make_up_done" }]);
  await runUserMind(deps, { runId: r1 });
  const runs = await listUserMindRuns(getTestDb(), a, 10);
  expect(runs.map((r) => r.id)).toEqual([r2, r1]);
  expect(runs[1]!.traces.map((t) => t.loop)).toEqual([
    "user_summarise",
    "user_reflect",
    "user_model",
    "user_ideate",
    "user_consolidate",
  ]);
  expect(runs[0]!.traces).toEqual([]);
  expect(await listUserMindRuns(getTestDb(), b, 1)).toHaveLength(1);
});

test("getRelationshipView shows the ceiling and the last reply's openness", async () => {
  const db = getTestDb();
  const cfg = loadConfig().relationship;
  const u = await createTestUser();
  const now = new Date("2026-01-05T10:00:00Z");
  await ensureRelationship(db, u, now, cfg);
  await insertTurn(db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "companion",
    text: "hi",
    created_at: now,
    openness: { disclosure: 0.4, responsiveness: 0.8 },
  });
  const v = await getRelationshipView(db, u, now, cfg);
  expect(v?.ceiling).toBeCloseTo(cfg.ceiling.start);
  expect(v?.lastOpenness).toEqual({ disclosure: 0.4, responsiveness: 0.8 });
});
