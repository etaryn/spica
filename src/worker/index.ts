/**
 * The background worker: starts pg-boss, registers every job by engine, picks up any exchange
 * left unfinished before this start, and shuts down cleanly on a signal.
 */
import { seedCore } from "@/mind/memory/core/seed";
import { coreDepsOf } from "@/mind/platform/deps";
import { sweepUnfinishedColdPaths } from "@/mind/process/cold-path/sweep";
import { buildRuntime } from "@/runtime/deps";
import { readEnv } from "@/runtime/env";
import { PgBossQueue } from "@/runtime/pg-boss-jobs";
import { ensureSystemQueues } from "./jobs";
import { CORE_QUEUES, registerCoreMindJob, registerCoreNightlyJob } from "./core-jobs";
import { MEMORY_QUEUES, registerMemoryJobs } from "./memory-jobs";
import { PROCESS_QUEUES, registerProcessJobs } from "./process-jobs";
import { registerStateJobs, STATE_QUEUES } from "./state-jobs";
import { registerUserMindJobs, USER_MIND_QUEUES } from "./user-mind-jobs";
import { registerWorldJobs, WORLD_QUEUES } from "./world-jobs";

const { deps, boss } = buildRuntime(readEnv());
const queue = deps.queue as PgBossQueue;
await queue.start();
await ensureSystemQueues(boss);
await seedCore(coreDepsOf(deps));

await registerMemoryJobs(boss, deps);
await registerProcessJobs(boss, deps);
await registerStateJobs(boss, deps);
await registerWorldJobs(boss, deps);
await registerUserMindJobs(boss, deps);
await registerCoreMindJob(boss, coreDepsOf(deps));
await registerCoreNightlyJob(boss, coreDepsOf(deps));

// Pick up anything left unfinished from before this start.
await sweepUnfinishedColdPaths(deps, deps.clock.now());

deps.log.info("worker started", {
  queues: [
    ...MEMORY_QUEUES,
    ...PROCESS_QUEUES,
    ...STATE_QUEUES,
    ...WORLD_QUEUES,
    ...CORE_QUEUES,
    ...USER_MIND_QUEUES,
  ],
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await queue.stop();
    process.exit(0);
  });
}
