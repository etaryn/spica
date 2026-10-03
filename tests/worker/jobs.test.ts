import { PgBoss } from "pg-boss";
import { afterAll, expect, test, vi } from "vitest";
import { LockBusyError } from "@/mind/process/cold-path/cold-path";
import type { Logger } from "@/mind/platform/log";
import {
  DECAY_QUEUE,
  CORE_STATE_TICK_QUEUE,
  CORE_MIND_TICK_QUEUE,
  LIFE_PLAN_QUEUE,
  CORE_WORLD_TICK_QUEUE,
  OUTREACH_TICK_QUEUE,
  TURN_SWEEP_QUEUE,
} from "@/mind/platform/jobs";
import { errorName } from "@/mind/platform/errors";
import { ensureSystemQueues, scrubErrors } from "@/worker/jobs";
import { registerCoreMindJob } from "@/worker/core-jobs";
import { coreDepsOf } from "@/mind/platform/deps";
import { makeTestDeps } from "../helpers/deps";
import { resetDb, testDbUrl } from "../helpers/db";

const boss = new PgBoss(testDbUrl);
let started = false;
afterAll(async () => {
  if (started) await boss.stop();
});

function captureLog() {
  const lines: { msg: string; meta?: Record<string, unknown> }[] = [];
  const log: Logger = {
    info: (msg, meta) => lines.push({ msg, meta }),
    error: (msg, meta) => lines.push({ msg, meta }),
  };
  return { log, lines };
}

class DatabaseError extends Error {
  detail = "Failing row contains (secret fact text)";
}

test("scrubErrors rethrows only the error's class name and logs ids, never text", async () => {
  const { log, lines } = captureLog();
  const handler = scrubErrors("cold_path", log, async () => {
    throw new DatabaseError("insert failed: secret message text");
  });
  const err = await handler([{ id: "job-1" }, { id: "job-2" }]).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toBe("DatabaseError");
  expect(err).not.toHaveProperty("detail");
  expect(JSON.stringify(lines)).not.toContain("secret");
  expect(lines).toEqual([
    {
      msg: "job failed",
      meta: { queue: "cold_path", jobIds: ["job-1", "job-2"], error: "DatabaseError" },
    },
  ]);
});

test("errorName reports the innermost cause's class (drizzle wraps pg errors)", () => {
  class DrizzleQueryError extends Error {}
  expect(
    errorName(
      new DrizzleQueryError("Failed query: params: secret", { cause: new DatabaseError("x") }),
    ),
  ).toBe("DatabaseError");
  expect(errorName("a string")).toBe("UnknownError");
});

test("scrubErrors keeps LockBusyError a thrown failure (so pg-boss retries) and passes success through", async () => {
  const { log } = captureLog();
  const busy = scrubErrors("cold_path", log, async () => {
    throw new LockBusyError("cold_path busy for user");
  });
  await expect(busy([{ id: "j" }])).rejects.toThrow(/^LockBusyError$/);
  let ran = 0;
  await scrubErrors("sweep", log, async () => {
    ran += 1;
  })([{ id: "j" }]);
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
  for (const q of [LIFE_PLAN_QUEUE, CORE_WORLD_TICK_QUEUE, CORE_STATE_TICK_QUEUE])
    expect(await boss.getQueue(q)).toMatchObject({ retryLimit: 0 });
});

test("ensureSystemQueues creates outreach_tick without retries", async () => {
  await boss.start();
  started = true;
  await ensureSystemQueues(boss);
  expect(await boss.getQueue(OUTREACH_TICK_QUEUE)).toMatchObject({ retryLimit: 0 });
});

test("ensureSystemQueues creates core_mind_tick with zero retries before updating it", async () => {
  await boss.start();
  started = true;
  if (await boss.getQueue(CORE_MIND_TICK_QUEUE)) await boss.deleteQueue(CORE_MIND_TICK_QUEUE);
  expect(await boss.getQueue(CORE_MIND_TICK_QUEUE)).toBeNull();

  const updateQueue = boss.updateQueue.bind(boss);
  let retryLimitAtCreation: number | undefined;
  const spy = vi.spyOn(boss, "updateQueue").mockImplementation(async (name, options) => {
    if (name === CORE_MIND_TICK_QUEUE)
      retryLimitAtCreation = (await boss.getQueue(CORE_MIND_TICK_QUEUE))?.retryLimit;
    await updateQueue(name, options);
  });
  try {
    await ensureSystemQueues(boss);
  } finally {
    spy.mockRestore();
  }

  expect(retryLimitAtCreation).toBe(0);
  expect(await boss.getQueue(CORE_MIND_TICK_QUEUE)).toMatchObject({ retryLimit: 0 });
});

test("ensureSystemQueues sets core_mind_tick to zero retries even on an existing queue", async () => {
  await boss.start();
  started = true;
  await boss.createQueue(CORE_MIND_TICK_QUEUE, { retryLimit: 3 });
  await boss.updateQueue(CORE_MIND_TICK_QUEUE, { retryLimit: 3 });
  await ensureSystemQueues(boss);
  expect(await boss.getQueue(CORE_MIND_TICK_QUEUE)).toMatchObject({ retryLimit: 0 });
});

test("registerCoreMindJob schedules the hourly cron and its worker runs the coordinator", async () => {
  await resetDb();
  const work: { queue?: string; handler?: (jobs: { id: string }[]) => Promise<void> } = {};
  const schedules: { queue: string; cron: string }[] = [];
  const fakeBoss = {
    work: async (queue: string, handler: (jobs: { id: string }[]) => Promise<void>) => {
      work.queue = queue;
      work.handler = handler;
    },
    schedule: async (queue: string, cron: string) => {
      schedules.push({ queue, cron });
    },
  } as unknown as PgBoss;
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await registerCoreMindJob(fakeBoss, deps);
  expect(work.queue).toBe(CORE_MIND_TICK_QUEUE);
  expect(schedules).toEqual([{ queue: CORE_MIND_TICK_QUEUE, cron: "50 * * * *" }]);

  const at = all.clock.now();
  await deps.core.world.insertPlan({
    date: "2026-01-05",
    plan: { blocks: [] },
    source: "scripted",
    model: "fake",
    prompt_version: "v1",
    generated_at: at,
  });
  await deps.core.memory.insert({
    kind: "episode",
    content: "Spica remembered an old film.",
    payload: {},
    embedding: Array.from({ length: 1024 }, () => 0.01),
    occurred_at: new Date(at.getTime() - 3_600_000 * 3),
    created_at: new Date(at.getTime() - 3_600_000 * 3),
    status: "resolved",
    salience: 0.9,
    valence: 0.6,
    confidence: 0.8,
    source: "world",
    source_ref: null,
  });
  await work.handler!([{ id: "job-1" }]);
  expect(all.llm.structuredCalls.map((call) => call.purpose)).toEqual([
    "core_ruminate",
    "core_wander",
  ]);
});
