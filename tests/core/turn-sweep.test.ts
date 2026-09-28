import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { TURN_TIMER_QUEUE, type TurnTimerJob } from "@/core/queue";
import { receiveMessage } from "@/core/turn/receive-message";
import { runTurnTimer } from "@/core/turn/reply";
import { sweepTurns } from "@/core/turn/sweep";
import { listTurns } from "@/db/repos/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("sweep recovers a lost timer and a stuck in-flight reply without double-sending", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  deps.queue.failNext = true; // the timer enqueue is lost
  await receiveMessage(deps, u, { clientMessageId: randomUUID(), text: "hello there friend" });
  expect(deps.queue.jobs.filter((j) => j.name === TURN_TIMER_QUEUE)).toEqual([]);

  deps.clock.advance(30_000);
  expect(await sweepTurns(deps, deps.clock.now())).toBe(0); // within the grace period
  deps.clock.advance(60_000);
  expect(await sweepTurns(deps, deps.clock.now())).toBe(1);
  const job = deps.queue.jobs.filter((j) => j.name === TURN_TIMER_QUEUE).at(-1)!.data as TurnTimerJob;
  expect(await runTurnTimer(deps, job)).toBe("sent");
  expect(await sweepTurns(deps, deps.clock.now())).toBe(0);

  // A crashed job leaves turns in flight; after job_expire_seconds they are requeued once.
  await receiveMessage(deps, u, { clientMessageId: randomUUID(), text: "second message here" });
  const crashed = deps.queue.jobs.filter((j) => j.name === TURN_TIMER_QUEUE).at(-1)!.data as TurnTimerJob;
  const db = getTestDb();
  await db.execute(sql.raw(`UPDATE conversation_state SET inflight_turn_ids = buffer_turn_ids, buffer_turn_ids = '{}', inflight_since = '${deps.clock.now().toISOString()}' WHERE user_id = '${u}'`));
  deps.clock.advance(200_000);
  expect(await sweepTurns(deps, deps.clock.now())).toBe(1);
  expect(await runTurnTimer(deps, crashed)).toBe("stale"); // the crashed job's retry is a no-op
  const recovered = deps.queue.jobs.filter((j) => j.name === TURN_TIMER_QUEUE).at(-1)!.data as TurnTimerJob;
  expect(await runTurnTimer(deps, recovered)).toBe("sent");
  expect((await listTurns(db, u)).filter((t) => t.role === "companion")).toHaveLength(2);
});

test("sweep clears a sender that crashed mid-bubbles, and the buffer behind it gets its reply", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await receiveMessage(deps, u, { clientMessageId: randomUUID(), text: "you there?" });
  // A crashed sender left its marker behind; the waiting timer keeps finding the reply busy.
  await getTestDb().execute(sql.raw(`UPDATE conversation_state SET sending_since = '2026-01-05T08:00:00Z' WHERE user_id = '${u}'`));
  const timer = deps.queue.jobs.filter((j) => j.name === TURN_TIMER_QUEUE).at(-1)!.data as TurnTimerJob;
  expect(await runTurnTimer(deps, timer)).toBe("busy");

  expect(await sweepTurns(deps, deps.clock.now())).toBe(1);
  const requeued = deps.queue.jobs.filter((j) => j.name === TURN_TIMER_QUEUE).at(-1)!.data as TurnTimerJob;
  expect(await runTurnTimer(deps, requeued)).toBe("sent");
  expect((await listTurns(getTestDb(), u)).filter((t) => t.role === "companion")).toHaveLength(1);
});
