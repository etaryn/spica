import type { PgBoss } from "pg-boss";
import type { Logger } from "@/mind/platform/log";
import {
  DECAY_QUEUE,
  EGO_TICK_QUEUE,
  LIFE_PLAN_QUEUE,
  LIFE_TICK_QUEUE,
  OUTREACH_TICK_QUEUE,
  RELATIONSHIP_TICK_QUEUE,
  SWEEP_QUEUE,
  TURN_SWEEP_QUEUE,
} from "@/mind/platform/jobs";

import { errorName } from "@/mind/platform/errors";

/**
 * Wraps a pg-boss work handler so a failure is logged with ids and the error name only, then
 * rethrown as a bare `Error(name)`: pg-boss persists the thrown error in the job's output.
 * Still a throw, so retryable failures (e.g. LockBusyError) are retried.
 */
export function scrubErrors<J extends { id: string }>(
  queue: string,
  log: Logger,
  fn: (jobs: J[]) => Promise<void>,
) {
  return async (jobs: J[]): Promise<void> => {
    try {
      await fn(jobs);
    } catch (e) {
      const name = errorName(e);
      log.error("job failed", { queue, jobIds: jobs.map((j) => j.id), error: name });
      throw new Error(name);
    }
  };
}

/**
 * Sweep and decay queues. Decay never retries: a retry would apply a second day of decay.
 * createQueue is create-only, so updateQueue applies the policy to a queue an earlier deploy made.
 */
export async function ensureSystemQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(SWEEP_QUEUE);
  await boss.createQueue(DECAY_QUEUE, { retryLimit: 0 });
  await boss.updateQueue(DECAY_QUEUE, { retryLimit: 0 });
  await boss.createQueue(TURN_SWEEP_QUEUE);
  await boss.createQueue(RELATIONSHIP_TICK_QUEUE, { retryLimit: 0 });
  await boss.updateQueue(RELATIONSHIP_TICK_QUEUE, { retryLimit: 0 }); // a retry would sample the baseline twice
  // Hourly, idempotent jobs; the next hour is the retry.
  for (const q of [LIFE_PLAN_QUEUE, LIFE_TICK_QUEUE, EGO_TICK_QUEUE, OUTREACH_TICK_QUEUE]) {
    await boss.createQueue(q, { retryLimit: 0 });
    await boss.updateQueue(q, { retryLimit: 0 });
  }
}
