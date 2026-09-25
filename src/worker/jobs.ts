import type { PgBoss } from "pg-boss";
import type { Logger } from "@/core/log";
import { DECAY_QUEUE, SWEEP_QUEUE } from "@/core/queue";

/**
 * The class name of the innermost cause (drizzle wraps pg's DatabaseError in DrizzleQueryError).
 * Only the name: pg `detail` and drizzle's query params hold row contents, which must not reach logs or job output.
 */
export function errorName(e: unknown): string {
  let err = e;
  const seen = new Set<unknown>([err]);
  while (err instanceof Error && err.cause instanceof Error && !seen.has(err.cause)) {
    err = err.cause;
    seen.add(err);
  }
  return err instanceof Error ? err.constructor.name : "UnknownError";
}

/**
 * Wraps a pg-boss work handler so a failure is logged with ids and the error name only, then
 * rethrown as a bare `Error(name)`: pg-boss persists the thrown error in the job's output.
 * Still a throw, so retryable failures (e.g. LockBusyError) are retried.
 */
export function scrubErrors<J extends { id: string }>(queue: string, log: Logger, fn: (jobs: J[]) => Promise<void>) {
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
}
