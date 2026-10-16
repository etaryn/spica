import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { insertFact } from "@/db/repos/user/facts";
import { USER_MIND_RUN_QUEUE } from "@/mind/platform/jobs";
import { insertRun } from "@/db/repos/user/user-mind";
import { recordBigEvents, runUserMind, sweepPendingUserMindRuns } from "@/mind/process/user/run";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const trig = [{ kind: "salient_fact" as const, salience: 0.9 }];

test("a recorded run runs its batch once; a second job for it is skipped", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await insertFact(deps.db, u, {
    subject: "user",
    kind: "event",
    content: "They passed the exam.",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.9,
    valence: 0.5,
    confidence: 0.9,
    source: "turn",
  });
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", trig))!;
  expect(await runUserMind(deps, { runId })).toBe("done");
  expect(await runUserMind(deps, { runId })).toBe("skipped");
  const traces = await getTestDb().execute(sql`SELECT loop FROM user_loop_trace`);
  expect(traces.rows.map((r) => r.loop).sort()).toEqual([
    "user_consolidate",
    "user_ideate",
    "user_model",
    "user_reflect",
    "user_summarise",
  ]);
  const run = await getTestDb().execute(sql`SELECT status FROM user_mind_run`);
  expect(run.rows[0]).toMatchObject({ status: "done" });
});

test("a capped run returns no id and never runs", async () => {
  const deps = makeTestDeps({ user_mind: { max_triggers_per_day: 1 } });
  const u = await createTestUser();
  expect(await recordBigEvents(deps, deps.db, u, "exchange:a", trig)).not.toBeNull();
  expect(await recordBigEvents(deps, deps.db, u, "exchange:b", trig)).toBeNull();
});

test("a failed loop marks the run failed", async () => {
  const deps = makeTestDeps();
  deps.llm.handlers.user_summarise = () => {
    throw new Error("down");
  };
  const u = await createTestUser();
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", trig))!;
  expect(await runUserMind(deps, { runId })).toBe("failed");
  const run = await getTestDb().execute(sql`SELECT status FROM user_mind_run`);
  expect(run.rows[0]).toMatchObject({ status: "failed" });
});

test("the sweep re-enqueues stale pending runs only", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", trig))!;
  expect(await sweepPendingUserMindRuns(deps, deps.clock.now())).toBe(0);
  const later = new Date(deps.clock.now().getTime() + 11 * 60_000);
  expect(await sweepPendingUserMindRuns(deps, later)).toBe(1);
  expect(deps.queue.drain()).toEqual([{ name: USER_MIND_RUN_QUEUE, data: { runId } }]);
});

test("two runs for one user leave exactly one live summary", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const a = (await recordBigEvents(deps, deps.db, u, "exchange:a", trig))!;
  const b = (await recordBigEvents(deps, deps.db, u, "exchange:b", trig))!;
  await Promise.all([runUserMind(deps, { runId: a }), runUserMind(deps, { runId: b })]);
  const live = await getTestDb().execute(
    sql`SELECT count(*)::int AS n FROM fact WHERE kind = 'summary' AND status = 'open'`,
  );
  expect(live.rows[0]).toMatchObject({ n: 1 });
});

test("a throw after the claim finishes the run failed, never left running", async () => {
  const deps = makeTestDeps();
  deps.core.memory.latestSnapshot = async () => {
    throw new Error("db down");
  };
  const u = await createTestUser();
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", trig))!;
  expect(await runUserMind(deps, { runId })).toBe("failed");
  const run = await getTestDb().execute(sql`SELECT status, finished_at FROM user_mind_run`);
  expect(run.rows[0]).toMatchObject({ status: "failed" });
  expect(run.rows[0]!.finished_at).not.toBeNull();
});

test("the batch runs all five loops in order; a failed reflect still runs the rest", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await insertFact(deps.db, u, {
    subject: "user",
    kind: "event",
    content: "They are planning a trip.",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.9,
    valence: 0.5,
    confidence: 0.9,
    source: "turn",
  });
  deps.llm.handlers.user_reflect = () => {
    throw new Error("boom");
  };
  deps.llm.handlers.user_ideate = () => ({ idea: "Ask about the trip." });
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", trig))!;
  expect(await runUserMind(deps, { runId })).toBe("failed");
  const loops = await getTestDb().execute(
    sql`SELECT loop, status FROM user_loop_trace ORDER BY created_at, id`,
  );
  expect(loops.rows.map((r) => `${r.loop}:${r.status}`).sort()).toEqual([
    "user_consolidate:done",
    "user_ideate:done",
    "user_model:done",
    "user_reflect:failed",
    "user_summarise:done",
  ]);
  const kinds = await getTestDb().execute(
    sql`SELECT kind FROM fact WHERE kind IN ('idea','summary','model','belief')`,
  );
  expect(kinds.rows.map((r) => r.kind).sort()).toEqual(["belief", "idea", "model", "summary"]);
});

test("model reads this run's summary, and ideate reads this run's read on them", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await insertFact(deps.db, u, {
    subject: "user",
    kind: "event",
    content: "They booked a solo trip.",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.9,
    valence: 0.5,
    confidence: 0.9,
    source: "turn",
  });
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", trig))!;
  await runUserMind(deps, { runId });
  const input = (purpose: string) =>
    JSON.parse(deps.llm.structuredCalls.find((c) => c.purpose === purpose)!.input);
  expect(input("user_model").summary.whats_live).toContain("They booked a solo trip.");
  expect(input("user_ideate").your_read_on_them.how_they_are).toContain("They booked a solo trip.");
});

test("a run with nothing unread skips reflect and ideate", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const r = (await insertRun(deps.db, u, {
    sourceRef: "tick:2026-01-05",
    triggers: [{ kind: "param_band", param: "warmth", from: 0.26, to: 0.24 }],
    localDate: "2026-01-05",
    now: deps.clock.now(),
    cap: 9,
  }))!;
  expect(await runUserMind(deps, { runId: r.id })).toBe("done");
  const purposes = deps.llm.structuredCalls.map((c) => c.purpose);
  expect(purposes).toContain("user_summarise");
  expect(purposes).not.toContain("user_reflect");
  expect(purposes).not.toContain("user_ideate");
});
