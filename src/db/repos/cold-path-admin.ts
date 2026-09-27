import { inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { session_log } from "../schema";

/** System job, unscoped by design: exchanges whose extraction never completed, with every user turn the reply answered. */
export async function adminFindUnextractedExchanges(db: Db, olderThan: Date, maxAttempts: number, limit: number) {
  const res = await db.execute(sql`
    SELECT c.user_id, c.id AS reply_turn_id,
      (SELECT array_agg(x.id ORDER BY x.created_at, x.id) FROM session_log x
        WHERE x.user_id = c.user_id AND x.session_id = c.session_id AND x.role = 'user' AND x.created_at <= u.created_at
          AND x.created_at > COALESCE((SELECT max(pu.created_at) FROM session_log p JOIN session_log pu ON pu.id = p.reply_to
            WHERE p.user_id = c.user_id AND p.session_id = c.session_id AND p.role = 'companion' AND pu.created_at < u.created_at), '-infinity'::timestamptz)
      ) AS user_turn_ids
    FROM session_log c JOIN session_log u ON u.id = c.reply_to AND u.user_id = c.user_id
    WHERE c.role = 'companion' AND (c.extracted = false OR u.extracted = false)
      AND c.extract_attempts < ${maxAttempts} AND c.created_at < ${olderThan}
    ORDER BY c.created_at ASC
    LIMIT ${limit}`);
  return res.rows.map((r) => ({
    userId: String(r.user_id), replyTurnId: String(r.reply_turn_id),
    userTurnIds: (r.user_turn_ids as string[] | null) ?? [],
  }));
}

export async function adminBumpExtractAttempts(db: Db, replyTurnIds: string[]): Promise<void> {
  if (replyTurnIds.length === 0) return;
  await db.update(session_log).set({ extract_attempts: sql`${session_log.extract_attempts} + 1` }).where(inArray(session_log.id, replyTurnIds));
}
