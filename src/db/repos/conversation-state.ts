import { eq, sql } from "drizzle-orm";
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

/** System job, unscoped by design: users whose buffer is overdue or whose in-flight or sending reply looks stuck. */
export async function adminFindStuckConversations(
  db: Db,
  overdueBefore: Date,
  inflightBefore: Date,
  limit: number,
): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT user_id FROM conversation_state
    WHERE (cardinality(buffer_turn_ids) > 0 AND (wait_until IS NULL OR wait_until < ${overdueBefore.toISOString()}::timestamptz))
       OR (cardinality(inflight_turn_ids) > 0 AND inflight_since < ${inflightBefore.toISOString()}::timestamptz)
       OR sending_since < ${inflightBefore.toISOString()}::timestamptz
    LIMIT ${limit}`);
  return res.rows.map((r) => String(r.user_id));
}
