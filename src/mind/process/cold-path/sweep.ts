/**
 * The `cold_path_sweep` job: re-queues exchanges whose cold path never finished, up to a cap on
 * attempts per exchange, so no exchange is silently left out of memory. It also re-queues user
 * mind runs whose job was lost.
 */
import {
  adminBumpExtractAttempts,
  adminFindUnextractedExchanges,
} from "@/db/repos/admin/cold-path";
import type { Deps } from "@/mind/platform/deps";
import { COLD_PATH_QUEUE } from "@/mind/platform/jobs";
import { sweepPendingUserMindRuns } from "@/mind/process/user/run";
import { MINUTE } from "@/mind/platform/time";

export async function sweepUnfinishedColdPaths(
  deps: Pick<Deps, "db" | "queue" | "config" | "log">,
  now: Date,
): Promise<number> {
  const { db, queue, config, log } = deps;
  const settings = config.cold_path;

  const olderThan = new Date(now.getTime() - settings.sweep_min_age_minutes * MINUTE);
  const exchanges = await adminFindUnextractedExchanges(
    db,
    olderThan,
    settings.max_sweep_attempts,
    settings.sweep_batch,
  );
  await adminBumpExtractAttempts(
    db,
    exchanges.map((e) => e.replyTurnId),
  );

  for (const exchange of exchanges) {
    await queue.enqueue(COLD_PATH_QUEUE, {
      userId: exchange.userId,
      turnIds: [...exchange.userTurnIds, exchange.replyTurnId],
      replyTurnId: exchange.replyTurnId,
      recalled: [],
    });
  }

  if (exchanges.length > 0) log.info("cold_path sweep enqueued", { count: exchanges.length });
  await sweepPendingUserMindRuns(deps, now);
  return exchanges.length;
}
