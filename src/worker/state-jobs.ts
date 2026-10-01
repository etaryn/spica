/**
 * State jobs: the relationship's daily tick and her hourly core state tick.
 */
import type { PgBoss } from "pg-boss";
import { coreDepsOf, type Deps } from "@/mind/platform/deps";
import { CORE_STATE_TICK_QUEUE, RELATIONSHIP_TICK_QUEUE } from "@/mind/platform/jobs";
import { coreStateTick } from "@/mind/state/core/tick";
import { relationshipDailyTick } from "@/mind/state/user/relationship/daily-tick";
import { scrubErrors } from "./jobs";

export const STATE_QUEUES = [RELATIONSHIP_TICK_QUEUE, CORE_STATE_TICK_QUEUE];

export async function registerStateJobs(boss: PgBoss, deps: Deps): Promise<void> {
  await boss.work(
    RELATIONSHIP_TICK_QUEUE,
    scrubErrors(RELATIONSHIP_TICK_QUEUE, deps.log, async () => {
      await relationshipDailyTick(deps, deps.clock.now());
    }),
  );
  await boss.schedule(RELATIONSHIP_TICK_QUEUE, deps.config.relationship.tick_cron);

  await boss.work(
    CORE_STATE_TICK_QUEUE,
    scrubErrors(CORE_STATE_TICK_QUEUE, deps.log, async () => {
      await coreStateTick(coreDepsOf(deps), deps.clock.now());
    }),
  );
  await boss.schedule(CORE_STATE_TICK_QUEUE, deps.config.core.state.tick_cron);
}
