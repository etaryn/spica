/**
 * State jobs: the relationship's daily tick and the per-user ego tick.
 */
import type { PgBoss } from "pg-boss";
import type { Deps } from "@/mind/platform/deps";
import { EGO_TICK_QUEUE, RELATIONSHIP_TICK_QUEUE } from "@/mind/platform/jobs";
import { egoTick } from "@/mind/state/legacy-ego/tick";
import { relationshipDailyTick } from "@/mind/state/user/relationship/daily-tick";
import { scrubErrors } from "./jobs";

export const STATE_QUEUES = [RELATIONSHIP_TICK_QUEUE, EGO_TICK_QUEUE];

export async function registerStateJobs(boss: PgBoss, deps: Deps): Promise<void> {
  await boss.work(
    RELATIONSHIP_TICK_QUEUE,
    scrubErrors(RELATIONSHIP_TICK_QUEUE, deps.log, async () => {
      await relationshipDailyTick(deps, deps.clock.now());
    }),
  );
  await boss.schedule(RELATIONSHIP_TICK_QUEUE, deps.config.relationship.tick_cron);

  await boss.work(
    EGO_TICK_QUEUE,
    scrubErrors(EGO_TICK_QUEUE, deps.log, async () => {
      await egoTick(deps, deps.clock.now());
    }),
  );
  await boss.schedule(EGO_TICK_QUEUE, deps.config.ego.tick_cron);
}
