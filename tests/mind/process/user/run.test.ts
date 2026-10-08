import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { insertFact } from "@/db/repos/user/facts";
import { USER_MIND_RUN_QUEUE } from "@/mind/platform/jobs";
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
  expect(traces.rows).toEqual([{ loop: "user_summarise" }]);
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
