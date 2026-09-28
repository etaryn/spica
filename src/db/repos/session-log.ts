import { and, asc, desc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import type { Db } from "../client";
import { session_log } from "../schema";
import { one, toDateOrNull } from "./util";

export type Turn = typeof session_log.$inferSelect;
export type NewTurn = Omit<typeof session_log.$inferInsert, "user_id">;

export async function insertTurn(db: Db, userId: string, row: NewTurn): Promise<Turn> {
  return one(await db.insert(session_log).values({ ...row, user_id: userId }).returning());
}

/**
 * Like `insertTurn`, but a `reply_to` collision (`session_log_reply_to_uq`) is reported as `null` instead of
 * thrown. A plain unique-violation throw would abort the enclosing transaction (turning the caller's next
 * statement, e.g. the `conversation_state` patch, into "current transaction is aborted"), so a concurrent
 * duplicate reply must be handled with `ON CONFLICT ... DO NOTHING` rather than try/catch.
 */
export async function insertReplyIfAbsent(db: Db, userId: string, row: NewTurn): Promise<Turn | null> {
  const rows = await db.insert(session_log).values({ ...row, user_id: userId })
    .onConflictDoNothing({ target: session_log.reply_to })
    .returning();
  return rows[0] ?? null;
}

export async function getTurn(db: Db, userId: string, id: string): Promise<Turn | null> {
  const rows = await db.select().from(session_log)
    .where(and(eq(session_log.user_id, userId), eq(session_log.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function getReplyTo(db: Db, userId: string, userTurnId: string): Promise<Turn | null> {
  const rows = await db.select().from(session_log)
    .where(and(eq(session_log.user_id, userId), eq(session_log.reply_to, userTurnId))).limit(1);
  return rows[0] ?? null;
}

export async function lastUserTurn(db: Db, userId: string): Promise<Turn | null> {
  const rows = await db.select().from(session_log)
    .where(and(eq(session_log.user_id, userId), eq(session_log.role, "user")))
    .orderBy(desc(session_log.created_at)).limit(1);
  return rows[0] ?? null;
}

/** Last `limit` turns, oldest first. Ties on created_at: user before companion (enum order). */
export async function recentTurns(db: Db, userId: string, limit: number): Promise<Turn[]> {
  const rows = await db.select().from(session_log)
    .where(eq(session_log.user_id, userId))
    .orderBy(desc(session_log.created_at), desc(session_log.role))
    .limit(limit);
  return rows.reverse();
}

/**
 * Up to `limit` turns ending at `anchor`, oldest first. The prompt window for a
 * reply to `anchor`, so a retried older message never sees later turns.
 */
export async function turnsUpTo(db: Db, userId: string, anchor: Turn, limit: number): Promise<Turn[]> {
  const rows = await db.select().from(session_log)
    .where(and(eq(session_log.user_id, userId), lte(session_log.created_at, anchor.created_at)))
    .orderBy(desc(session_log.created_at), desc(session_log.role))
    .limit(limit * 2);
  const ordered = rows.reverse();
  const i = ordered.findIndex((t) => t.id === anchor.id);
  return i === -1 ? [anchor] : ordered.slice(0, i + 1).slice(-limit);
}

/**
 * Turns strictly after `afterId` in (created_at, role, id) order, oldest first, for SSE catch-up.
 * Unknown id → the latest `limit` turns. The `id` tiebreaker makes the order deterministic even
 * when two turns share a `created_at`, so the exact "after the anchor" cut is a direct WHERE
 * (no headroom fetch-and-slice needed).
 */
export async function turnsAfter(db: Db, userId: string, afterId: string, limit: number): Promise<Turn[]> {
  const anchor = await getTurn(db, userId, afterId);
  if (!anchor) return recentTurns(db, userId, limit);
  return db.select().from(session_log)
    .where(and(
      eq(session_log.user_id, userId),
      or(
        gt(session_log.created_at, anchor.created_at),
        and(eq(session_log.created_at, anchor.created_at), gt(session_log.role, anchor.role)),
        and(eq(session_log.created_at, anchor.created_at), eq(session_log.role, anchor.role), gt(session_log.id, anchor.id)),
      ),
    ))
    .orderBy(asc(session_log.created_at), asc(session_log.role), asc(session_log.id))
    .limit(limit);
}

export async function listTurns(db: Db, userId: string): Promise<Turn[]> {
  return db.select().from(session_log)
    .where(eq(session_log.user_id, userId))
    .orderBy(asc(session_log.created_at), asc(session_log.role));
}

export async function getTurnsByIds(db: Db, userId: string, ids: string[]): Promise<Turn[]> {
  if (ids.length === 0) return [];
  return db.select().from(session_log)
    .where(and(eq(session_log.user_id, userId), inArray(session_log.id, ids)))
    .orderBy(asc(session_log.created_at), asc(session_log.role));
}

export async function markExtracted(db: Db, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(session_log).set({ extracted: true }).where(and(eq(session_log.user_id, userId), inArray(session_log.id, ids)));
}

/** The reply that answers `turn`, if any: a companion turn whose `reply_to` turn is at or after `turn` (a buffered reply answers every earlier turn, v2 §5.6). */
export async function answeringReply(db: Db, userId: string, turn: Turn): Promise<Turn | null> {
  const res = await db.execute(sql`
    SELECT c.id FROM session_log c JOIN session_log u ON u.id = c.reply_to AND u.user_id = c.user_id
    WHERE c.user_id = ${userId} AND c.role = 'companion' AND u.created_at >= ${turn.created_at.toISOString()}::timestamptz
    ORDER BY u.created_at, c.created_at, c.id
    LIMIT 1`);
  const id = res.rows[0]?.id as string | undefined;
  return id ? getTurn(db, userId, id) : null;
}

export async function isAnswered(db: Db, userId: string, turn: Turn): Promise<boolean> {
  return (await answeringReply(db, userId, turn)) !== null;
}

/** How long and how often they've talked, for the relationship line (spec §6). `tz` must be a valid IANA zone. */
export async function userTurnStats(db: Db, userId: string, upTo: Date, tz: string): Promise<{ sessions: number; days: number; first: Date | null }> {
  const res = await db.execute(sql`
    SELECT count(DISTINCT session_id)::int AS sessions,
           count(DISTINCT (created_at AT TIME ZONE ${tz})::date)::int AS days,
           min(created_at) AS first
    FROM session_log
    WHERE user_id = ${userId} AND role = 'user' AND created_at <= ${upTo.toISOString()}::timestamptz`);
  const r = res.rows[0] as { sessions: number; days: number; first: unknown };
  return { sessions: Number(r.sessions), days: Number(r.days), first: toDateOrNull(r.first) };
}
