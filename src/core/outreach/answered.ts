import { markLatestAnswered } from "@/db/repos/reach-out";
import { resetUnanswered } from "@/db/repos/relationship";
import type { Deps } from "../deps";
import { errorName } from "../errors";

/**
 * any user message answers. Best-effort: a failure leaves the counter up, so she stays quieter,
 * which is the safe side; it never fails the POST.
 */
export async function markReachOutAnswered(deps: Pick<Deps, "db" | "log">, userId: string, at: Date): Promise<void> {
  try {
    await deps.db.transaction(async (tx) => {
      await resetUnanswered(tx, userId);
      await markLatestAnswered(tx, userId, at);
    });
  } catch (e) {
    deps.log.error("reach-out answered update failed", { userId, error: errorName(e) });
  }
}
