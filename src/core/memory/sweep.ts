import { adminBumpExtractAttempts, adminFindUnextractedExchanges } from "@/db/repos/cold-path-admin";
import type { Deps } from "../deps";
import { COLD_PATH_QUEUE } from "../queue";

/** Re-enqueue exchanges whose cold path never completed (v2 §6.3 failures), with a per-exchange attempt cap. */
export async function sweepUnextracted(deps: Pick<Deps, "db" | "queue" | "config" | "log">, now: Date): Promise<number> {
  const { db, queue, config, log } = deps;
  const olderThan = new Date(now.getTime() - config.cold_path.sweep_min_age_minutes * 60_000);
  const rows = await adminFindUnextractedExchanges(db, olderThan, config.cold_path.max_sweep_attempts, config.cold_path.sweep_batch);
  await adminBumpExtractAttempts(db, rows.map((r) => r.replyTurnId));
  for (const r of rows) {
    await queue.enqueue(COLD_PATH_QUEUE, { userId: r.userId, turnIds: [...r.userTurnIds, r.replyTurnId], replyTurnId: r.replyTurnId, recalled: [] });
  }
  if (rows.length > 0) log.info("cold_path sweep enqueued", { count: rows.length });
  return rows.length;
}
