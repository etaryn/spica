/**
 * The `turn_sweep` job: re-queues buffers whose timer was lost, and replies stuck in flight after
 * a crash. It never double-sends, because every timer is version-checked and recovering bumps the
 * version. One user's failure never stops the rest of the batch.
 */
import { adminFindStuckConversations } from "@/db/repos/conversation-state";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { TURN_TIMER_QUEUE } from "@/mind/platform/jobs";
import { mutateState } from "./state";
import * as T from "./transitions";

export async function sweepTurns(
  deps: Pick<Deps, "db" | "queue" | "config" | "log">,
  now: Date,
): Promise<number> {
  const { db, queue, config, log } = deps;
  const graceMs = config.turn.sweep_grace_ms;
  const inflightMaxAgeMs = config.turn.job_expire_seconds * 1000;

  const users = await adminFindStuckConversations(
    db,
    new Date(now.getTime() - graceMs),
    new Date(now.getTime() - inflightMaxAgeMs),
    config.turn.sweep_batch,
  );
  // Test seam: lets a test make one user's recovery fail.
  const mutate = (deps as { mutateState?: typeof mutateState }).mutateState ?? mutateState;

  let requeued = 0;
  for (const userId of users) {
    try {
      const recovered = await mutate(db, userId, now, (state) =>
        T.recover(state, { now, graceMs, inflightMaxAgeMs }),
      );
      if (recovered.version === null) continue;

      await queue.enqueue(
        TURN_TIMER_QUEUE,
        { userId, version: recovered.version },
        { startAfter: now },
      );
      requeued += 1;
    } catch (e) {
      log.error("turn sweep failed for user", { userId, error: errorName(e) });
    }
  }

  if (requeued > 0) log.info("turn sweep requeued", { count: requeued });
  return requeued;
}
