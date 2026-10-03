/** The hourly core mind job, scheduled after the world and state ticks. */
import type { PgBoss } from "pg-boss";
import type { CoreDeps } from "@/mind/platform/deps";
import { CORE_MIND_TICK_QUEUE, CORE_NIGHTLY_QUEUE } from "@/mind/platform/jobs";
import { coreMindTick } from "@/mind/process/core/mind-tick";
import { coreNightly } from "@/mind/process/core/nightly";
import { scrubErrors } from "./jobs";

export const CORE_QUEUES = [CORE_MIND_TICK_QUEUE, CORE_NIGHTLY_QUEUE];

export async function registerCoreMindJob(boss: PgBoss, deps: CoreDeps): Promise<void> {
  await boss.work(
    CORE_MIND_TICK_QUEUE,
    scrubErrors(CORE_MIND_TICK_QUEUE, deps.log, async () => {
      await coreMindTick(deps, deps.clock.now());
    }),
  );
  await boss.schedule(CORE_MIND_TICK_QUEUE, deps.config.core.mind.tick_cron);
}

export async function registerCoreNightlyJob(boss: PgBoss, deps: CoreDeps): Promise<void> {
  await boss.work(
    CORE_NIGHTLY_QUEUE,
    scrubErrors(CORE_NIGHTLY_QUEUE, deps.log, async () => {
      await coreNightly(deps, deps.clock.now());
    }),
  );
  await boss.schedule(CORE_NIGHTLY_QUEUE, deps.config.core.nightly.tick_cron);
}
