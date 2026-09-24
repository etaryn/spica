import { handleColdPath } from "@/core/cold-path";
import { decayPass } from "@/core/memory/decay";
import { sweepUnextracted } from "@/core/memory/sweep";
import { COLD_PATH_QUEUE, type ColdPathJob, DECAY_QUEUE, SWEEP_QUEUE } from "@/core/queue";
import { PgBossQueue } from "@/queue/pg-boss-queue";
import { buildRuntime } from "@/runtime/deps";
import { readEnv } from "@/runtime/env";
import { ensureSystemQueues, scrubErrors } from "./jobs";

const { deps, boss } = buildRuntime(readEnv());
const queue = deps.queue as PgBossQueue;
await queue.start();
await ensureSystemQueues(boss);

await boss.work<ColdPathJob>(COLD_PATH_QUEUE, scrubErrors(COLD_PATH_QUEUE, deps.log, async (jobs) => {
  for (const job of jobs) await handleColdPath(deps, job.data);
}));
await boss.work(SWEEP_QUEUE, scrubErrors(SWEEP_QUEUE, deps.log, async () => { await sweepUnextracted(deps, deps.clock.now()); }));
await boss.work(DECAY_QUEUE, scrubErrors(DECAY_QUEUE, deps.log, async () => { await decayPass(deps, deps.clock.now()); }));
await boss.schedule(SWEEP_QUEUE, deps.config.cold_path.sweep_cron);
await boss.schedule(DECAY_QUEUE, deps.config.decay.cron);

await sweepUnextracted(deps, deps.clock.now()); // pick up anything left from before this start
deps.log.info("worker started", { queues: [COLD_PATH_QUEUE, SWEEP_QUEUE, DECAY_QUEUE] });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await queue.stop();
    process.exit(0);
  });
}
