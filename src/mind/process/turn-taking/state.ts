/**
 * Applies one turn-taking transition to a user's conversation state, in a short transaction that
 * holds their conversation_state row lock, so concurrent messages and timers never race.
 */
import type { Db } from "@/db/client";
import { lockState, updateState, type ConvState } from "@/db/repos/conversation-state";
import type { Step } from "./transitions";

export async function mutateState<R>(
  db: Db,
  userId: string,
  now: Date,
  transition: (state: ConvState, tx: Db) => Step<R> | Promise<Step<R>>,
): Promise<R> {
  return db.transaction(async (tx) => {
    const state = await lockState(tx, userId, now);
    const step = await transition(state, tx);
    if (step.patch) await updateState(tx, userId, step.patch);
    return step.result;
  });
}
