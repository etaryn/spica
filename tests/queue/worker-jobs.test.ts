import { PgBoss } from "pg-boss";
import { afterAll, expect, test } from "vitest";
import { LockBusyError } from "@/core/cold-path";
import type { Logger } from "@/core/log";
import { DECAY_QUEUE, EGO_TICK_QUEUE, LIFE_PLAN_QUEUE, LIFE_TICK_QUEUE, TURN_SWEEP_QUEUE } from "@/core/queue";
import { ensureSystemQueues, errorName, scrubErrors } from "@/worker/jobs";
import { testDbUrl } from "../helpers/db";

const boss = new PgBoss(testDbUrl);
let started = false;
afterAll(async () => { if (started) await boss.stop(); });

function captureLog() {
  const lines: { msg: string; meta?: Record<string, unknown> }[] = [];
  const log: Logger = { info: (msg, meta) => lines.push({ msg, meta }), error: (msg, meta) => lines.push({ msg, meta }) };
  return { log, lines };
}

class DatabaseError extends Error {
  detail = "Failing row contains (secret fact text)";
}

test("scrubErrors rethrows only the error's class name and logs ids, never text", async () => {
  const { log, lines } = captureLog();
  const handler = scrubErrors("cold_path", log, async () => { throw new DatabaseError("insert failed: secret message text"); });
  const err = await handler([{ id: "job-1" }, { id: "job-2" }]).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toBe("DatabaseError");
  expect(err).not.toHaveProperty("detail");
  expect(JSON.stringify(lines)).not.toContain("secret");
  expect(lines).toEqual([{ msg: "job failed", meta: { queue: "cold_path", jobIds: ["job-1", "job-2"], error: "DatabaseError" } }]);
});

test("errorName reports the innermost cause's class (drizzle wraps pg errors)", () => {
  class DrizzleQueryError extends Error {}
  expect(errorName(new DrizzleQueryError("Failed query: params: secret", { cause: new DatabaseError("x") }))).toBe("DatabaseError");
  expect(errorName("a string")).toBe("UnknownError");
});

test("scrubErrors keeps LockBusyError a thrown failure (so pg-boss retries) and passes success through", async () => {
  const { log } = captureLog();
  const busy = scrubErrors("cold_path", log, async () => { throw new LockBusyError("cold_path busy for user"); });
  await expect(busy([{ id: "j" }])).rejects.toThrow(/^LockBusyError$/);
  let ran = 0;
  await scrubErrors("sweep", log, async () => { ran += 1; })([{ id: "j" }]);
  expect(ran).toBe(1);
});

test("errorName terminates on a cyclic cause chain", () => {
  class AErr extends Error {}
  class BErr extends Error {}
  const a = new AErr("a");
  const b = new BErr("b");
  a.cause = b;
  b.cause = a;
  expect(errorName(a)).toBe("BErr");
});

test("ensureSystemQueues gives the decay queue no retries, even if it already existed with some", async () => {
  await boss.start();
  started = true;
  await boss.createQueue(DECAY_QUEUE, { retryLimit: 3 });
  await boss.updateQueue(DECAY_QUEUE, { retryLimit: 3 });
  await ensureSystemQueues(boss);
  expect(await boss.getQueue(DECAY_QUEUE)).toMatchObject({ retryLimit: 0 });
});

test("ensureSystemQueues creates the turn_sweep queue", async () => {
  await boss.start();
  started = true;
  await ensureSystemQueues(boss);
  expect(await boss.getQueue(TURN_SWEEP_QUEUE)).toBeTruthy();
});

test("ensureSystemQueues creates the phase 5 queues without retries", async () => {
  await boss.start();
  started = true;
  await ensureSystemQueues(boss);
  for (const q of [LIFE_PLAN_QUEUE, LIFE_TICK_QUEUE, EGO_TICK_QUEUE]) expect(await boss.getQueue(q)).toMatchObject({ retryLimit: 0 });
});
