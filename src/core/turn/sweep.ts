import { adminFindStuckConversations } from "@/db/repos/conversation-state";
import type { Deps } from "../deps";
import { errorName } from "../errors";
import { TURN_TIMER_QUEUE } from "../queue";
import { mutateState } from "./state";
import * as T from "./transitions";

/**
 * turn_sweep: requeue buffers whose timer was lost and replies stuck in flight after a crash.
 * Never double-sends: every timer is version-checked, and recover bumps the version. One user's failure (a
 * transient DB error on their row) must not abort the rest of the batch.
 */
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
  const mutate = (deps as { mutateState?: typeof mutateState }).mutateState ?? mutateState;
  let n = 0;
  for (const userId of users) {
    try {
      const r = await mutate(db, userId, now, (s) =>
        T.recover(s, { now, graceMs, inflightMaxAgeMs }),
      );
      if (r.version === null) continue;
      await queue.enqueue(TURN_TIMER_QUEUE, { userId, version: r.version }, { startAfter: now });
      n += 1;
    } catch (e) {
      log.error("turn sweep failed for user", { userId, error: errorName(e) });
    }
  }
  if (n > 0) log.info("turn sweep requeued", { count: n });
  return n;
}
