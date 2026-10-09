/**
 * Cross-user: what the user mind's hourly tick scans for (long conversations that went quiet,
 * crisis windows that ended), and pending runs whose job was lost.
 */
import { and, asc, eq, gt, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { relationship, user_mind_run } from "@/db/schema";

export async function adminStalePendingRuns(
  db: Db,
  olderThan: Date,
  limit: number,
): Promise<{ id: string; user_id: string }[]> {
  return db
    .select({ id: user_mind_run.id, user_id: user_mind_run.user_id })
    .from(user_mind_run)
    .where(and(eq(user_mind_run.status, "pending"), lt(user_mind_run.created_at, olderThan)))
    .orderBy(asc(user_mind_run.created_at))
    .limit(limit);
}

/** Sessions with at least `minUserTurns` user turns whose last turn falls in the window. */
export async function adminEndedLongSessions(
  db: Db,
  opts: { endedAfter: Date; endedBefore: Date; minUserTurns: number; limit: number },
): Promise<{ user_id: string; session_id: string; user_turns: number }[]> {
  const after = opts.endedAfter.toISOString();
  const before = opts.endedBefore.toISOString();
  const res = await db.execute(sql`
    SELECT user_id, session_id, count(*) FILTER (WHERE role = 'user')::int AS user_turns
    FROM session_log
    WHERE session_id IN (
      SELECT DISTINCT session_id FROM session_log WHERE created_at > ${after}::timestamptz
    )
    GROUP BY user_id, session_id
    HAVING max(created_at) > ${after}::timestamptz
      AND max(created_at) <= ${before}::timestamptz
      AND count(*) FILTER (WHERE role = 'user') >= ${opts.minUserTurns}
    ORDER BY max(created_at)
    LIMIT ${opts.limit}`);
  return res.rows as { user_id: string; session_id: string; user_turns: number }[];
}

/** Users whose stored crisis window ended in `(after, until]`. */
export async function adminCrisisEndedUsers(
  db: Db,
  opts: { after: Date; until: Date; limit: number },
): Promise<{ user_id: string; crisis_quiet_until: Date }[]> {
  const rows = await db
    .select({ user_id: relationship.user_id, crisis_quiet_until: relationship.crisis_quiet_until })
    .from(relationship)
    .where(
      and(
        gt(relationship.crisis_quiet_until, opts.after),
        lte(relationship.crisis_quiet_until, opts.until),
      ),
    )
    .limit(opts.limit);
  return rows.flatMap((r) =>
    r.crisis_quiet_until ? [{ user_id: r.user_id, crisis_quiet_until: r.crisis_quiet_until }] : [],
  );
}
