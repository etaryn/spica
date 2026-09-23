import { handleColdPath } from "@/core/cold-path";
import { COLD_PATH_QUEUE, type ColdPathJob } from "@/core/queue";
import { PgBossQueue } from "@/queue/pg-boss-queue";
import { buildRuntime } from "@/runtime/deps";
import { readEnv } from "@/runtime/env";

const { deps, boss } = buildRuntime(readEnv());
await (deps.queue as PgBossQueue).start();

await boss.work<ColdPathJob>(COLD_PATH_QUEUE, async (jobs) => {
  for (const job of jobs) await handleColdPath(deps, job.data);
});
deps.log.info("worker started", { queues: [COLD_PATH_QUEUE] });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await (deps.queue as PgBossQueue).stop();
    process.exit(0);
  });
}
