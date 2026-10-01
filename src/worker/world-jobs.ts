/**
 * World jobs: her day plan (`life_plan`) and the per-user life tick.
 */
import type { PgBoss } from "pg-boss";
import type { Deps } from "@/mind/platform/deps";
import { LIFE_PLAN_QUEUE, LIFE_TICK_QUEUE } from "@/mind/platform/jobs";
import { ensurePlans } from "@/mind/world/day-plan";
import { lifeTick } from "@/mind/world/legacy-life-tick/tick";
import { scrubErrors } from "./jobs";

export const WORLD_QUEUES = [LIFE_PLAN_QUEUE, LIFE_TICK_QUEUE];

export async function registerWorldJobs(boss: PgBoss, deps: Deps): Promise<void> {
  await boss.work(
    LIFE_PLAN_QUEUE,
    scrubErrors(LIFE_PLAN_QUEUE, deps.log, async () => {
      await ensurePlans(deps, deps.clock.now());
    }),
  );
  await boss.schedule(LIFE_PLAN_QUEUE, deps.config.life.plan_cron);

  await boss.work(
    LIFE_TICK_QUEUE,
    scrubErrors(LIFE_TICK_QUEUE, deps.log, async () => {
      await lifeTick(deps, deps.clock.now());
    }),
  );
  await boss.schedule(LIFE_TICK_QUEUE, deps.config.life.tick_cron);
}
