import { lockState, updateState, type ConvState } from "@/db/repos/conversation-state";
import type { Db } from "@/db/client";
import type { Step } from "./transitions";

/** Applies one transition in a short transaction holding the user's conversation_state row lock. */
export async function mutateState<R>(
  db: Db,
  userId: string,
  now: Date,
  fn: (s: ConvState, tx: Db) => Step<R> | Promise<Step<R>>,
): Promise<R> {
  return db.transaction(async (tx) => {
    const s = await lockState(tx, userId, now);
    const step = await fn(s, tx);
    if (step.patch) await updateState(tx, userId, step.patch);
    return step.result;
  });
}
