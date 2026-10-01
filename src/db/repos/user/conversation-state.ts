/**
 * One user's turn-taking state (conversation_state): the buffer, open questions, timers, in-flight
 * turns and the reply epoch. Locked per user for every transition.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { conversation_state } from "@/db/schema";

export type ConvState = typeof conversation_state.$inferSelect;
export type StatePatch = Partial<Omit<ConvState, "user_id">>;

export async function getState(db: Db, userId: string): Promise<ConvState | null> {
  const rows = await db
    .select()
    .from(conversation_state)
    .where(eq(conversation_state.user_id, userId))
    .limit(1);
  return rows[0] ?? null;
}

/** Inside a transaction: creates the user's row if missing, then locks it (`FOR UPDATE`) and returns it. */
export async function lockState(tx: Db, userId: string, now: Date): Promise<ConvState> {
  await tx
    .insert(conversation_state)
    .values({ user_id: userId, updated_at: now })
    .onConflictDoNothing();
  const rows = await tx
    .select()
    .from(conversation_state)
    .where(eq(conversation_state.user_id, userId))
    .for("update");
  const row = rows[0];
  if (!row) throw new Error("conversation_state row missing after insert");
  return row;
}

export async function updateState(tx: Db, userId: string, patch: StatePatch): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await tx.update(conversation_state).set(patch).where(eq(conversation_state.user_id, userId));
}
