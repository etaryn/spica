import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { session_log } from "../schema";
import { one, toDateOrNull } from "./util";

export type Turn = typeof session_log.$inferSelect;
export type NewTurn = Omit<typeof session_log.$inferInsert, "user_id">;

export async function insertTurn(db: Db, userId: string, row: NewTurn): Promise<Turn> {
  return one(await db.insert(session_log).values({ ...row, user_id: userId }).returning());
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

/** Turns after `afterId` (exclusive), oldest first, for SSE catch-up. Unknown id → the latest `limit` turns. */
export async function turnsAfter(db: Db, userId: string, afterId: string, limit: number): Promise<Turn[]> {
  const anchor = await getTurn(db, userId, afterId);
  if (!anchor) return recentTurns(db, userId, limit);
  const rows = await db.select().from(session_log)
    .where(and(eq(session_log.user_id, userId), gte(session_log.created_at, anchor.created_at)))
    .orderBy(asc(session_log.created_at), asc(session_log.role))
    .limit(limit + 20);
  const i = rows.findIndex((t) => t.id === anchor.id);
  return rows.slice(i + 1).slice(0, limit);
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
