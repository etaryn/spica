/**
 * Cross-user turn-taking query for the turn_sweep job: conversations whose timer was lost or
 * whose reply got stuck in flight.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

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
