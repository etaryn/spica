/**
 * Memory jobs: the cold path that turns each exchange into memory, its sweep for exchanges that
 * never finished, and the daily decay pass.
 */
import type { PgBoss } from "pg-boss";
import { decayPass } from "@/mind/memory/user/decay";
import type { Deps } from "@/mind/platform/deps";
import { COLD_PATH_QUEUE, type ColdPathJob, DECAY_QUEUE, SWEEP_QUEUE } from "@/mind/platform/jobs";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { sweepUnfinishedColdPaths } from "@/mind/process/cold-path/sweep";
import { scrubErrors } from "./jobs";

export const MEMORY_QUEUES = [COLD_PATH_QUEUE, SWEEP_QUEUE, DECAY_QUEUE];

export async function registerMemoryJobs(boss: PgBoss, deps: Deps): Promise<void> {
  await boss.work<ColdPathJob>(
    COLD_PATH_QUEUE,
    scrubErrors(COLD_PATH_QUEUE, deps.log, async (jobs) => {
      for (const job of jobs) await runColdPath(deps, job.data);
    }),
  );
  await boss.work(
    SWEEP_QUEUE,
    scrubErrors(SWEEP_QUEUE, deps.log, async () => {
      await sweepUnfinishedColdPaths(deps, deps.clock.now());
    }),
  );
  await boss.work(
    DECAY_QUEUE,
    scrubErrors(DECAY_QUEUE, deps.log, async () => {
      await decayPass(deps, deps.clock.now());
    }),
  );

  await boss.schedule(SWEEP_QUEUE, deps.config.cold_path.sweep_cron);
  await boss.schedule(DECAY_QUEUE, deps.config.decay.cron);
}
