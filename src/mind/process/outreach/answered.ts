/**
 * Any message from the user answers her latest reach-out and resets the unanswered count. Best
 * effort: a failure leaves the count up, so she stays quieter (the safe side), and it never fails
 * the user's message.
 */
import { markLatestAnswered } from "@/db/repos/reach-out";
import { resetUnanswered } from "@/db/repos/relationship";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";

export async function markReachOutAnswered(
  deps: Pick<Deps, "db" | "log">,
  userId: string,
  at: Date,
): Promise<void> {
  try {
    await deps.db.transaction(async (tx) => {
      await resetUnanswered(tx, userId);
      await markLatestAnswered(tx, userId, at);
    });
  } catch (e) {
    deps.log.error("reach-out answered update failed", { userId, error: errorName(e) });
  }
}
