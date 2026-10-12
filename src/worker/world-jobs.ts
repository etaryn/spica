/**
 * World jobs: her day plan (`life_plan`) and what happens in her day (`core_world_tick`), and the
 * posts she makes of it (`post_tick`).
 */
import type { PgBoss } from "pg-boss";
import { coreDepsOf, type Deps } from "@/mind/platform/deps";
import { CORE_WORLD_TICK_QUEUE, LIFE_PLAN_QUEUE, POST_TICK_QUEUE } from "@/mind/platform/jobs";
import { postTick } from "@/mind/process/core/post";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { ensurePlans } from "@/mind/world/day-plan";
import { scrubErrors } from "./jobs";

export const WORLD_QUEUES = [LIFE_PLAN_QUEUE, CORE_WORLD_TICK_QUEUE, POST_TICK_QUEUE];

export async function registerWorldJobs(boss: PgBoss, deps: Deps): Promise<void> {
  await boss.work(
    LIFE_PLAN_QUEUE,
    scrubErrors(LIFE_PLAN_QUEUE, deps.log, async () => {
      await ensurePlans(coreDepsOf(deps), deps.clock.now());
    }),
  );
  await boss.schedule(LIFE_PLAN_QUEUE, deps.config.life.plan_cron);

  await boss.work(
    CORE_WORLD_TICK_QUEUE,
    scrubErrors(CORE_WORLD_TICK_QUEUE, deps.log, async () => {
      await coreWorldTick(coreDepsOf(deps), deps.clock.now());
    }),
  );
  await boss.schedule(CORE_WORLD_TICK_QUEUE, deps.config.core.world.tick_cron);

  await boss.work(
    POST_TICK_QUEUE,
    scrubErrors(POST_TICK_QUEUE, deps.log, async () => {
      await postTick(coreDepsOf(deps), deps.clock.now());
    }),
  );
  await boss.schedule(POST_TICK_QUEUE, deps.config.posts.tick_cron);
}
