import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { reach_out_log } from "../schema";
import { one } from "./util";

export type ReachOutRow = typeof reach_out_log.$inferSelect;
export type ReachOutStatus = ReachOutRow["status"];
export type NewReachOut = {
  candidates: unknown; winner: unknown; gate_results: unknown; status: ReachOutStatus;
  topic: string | null; send_at: Date | null; created_at: Date;
};

export async function insertReachOutLog(db: Db, userId: string, row: NewReachOut): Promise<string> {
  const r = one(await db.insert(reach_out_log).values({ ...row, user_id: userId, sent: row.status === "sent" }).returning({ id: reach_out_log.id }));
  return r.id;
}

export async function getReachOutLog(db: Db, userId: string, id: string): Promise<ReachOutRow | null> {
  return (await db.select().from(reach_out_log).where(and(eq(reach_out_log.user_id, userId), eq(reach_out_log.id, id))).limit(1))[0] ?? null;
}

export async function updateReachOutLog(
  db: Db, userId: string, id: string,
  patch: Partial<Pick<ReachOutRow, "status" | "gate_results" | "turn_id" | "send_at" | "answered_at">>,
): Promise<void> {
  await db.update(reach_out_log)
    .set({ ...patch, ...(patch.status ? { sent: patch.status === "sent" } : {}) })
    .where(and(eq(reach_out_log.user_id, userId), eq(reach_out_log.id, id)));
}

/**
 * Drop a row only while it is still `scheduled`, so a duplicate send-job delivery never turns `sent` into `dropped`.
 * Returns whether this call dropped it.
 */
export async function dropScheduled(db: Db, userId: string, id: string, gate_results: unknown): Promise<boolean> {
  const rows = await db.update(reach_out_log).set({ status: "dropped", sent: false, gate_results })
    .where(and(eq(reach_out_log.user_id, userId), eq(reach_out_log.id, id), eq(reach_out_log.status, "scheduled")))
    .returning({ id: reach_out_log.id });
  return rows.length > 0;
}

/** Send times of sent reach-outs at or after `since`, oldest first (caps, spec §5 G2). */
export async function sentReachOutTimes(db: Db, userId: string, since: Date): Promise<Date[]> {
  const rows = await db.select({ at: reach_out_log.send_at }).from(reach_out_log)
    .where(and(eq(reach_out_log.user_id, userId), eq(reach_out_log.status, "sent"), gte(reach_out_log.send_at, since)))
    .orderBy(reach_out_log.send_at);
  return rows.map((r) => r.at!).filter(Boolean);
}

/** Topic keys already sent: each is used at most once (spec §4.2). */
export async function usedTopics(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ topic: reach_out_log.topic }).from(reach_out_log)
    .where(and(eq(reach_out_log.user_id, userId), eq(reach_out_log.status, "sent")));
  return rows.map((r) => r.topic).filter((t): t is string => !!t);
}

/** A `scheduled` row created at or after `since`; older ones are stale (a lost send job) and ignored. */
export async function hasPendingScheduled(db: Db, userId: string, since: Date): Promise<boolean> {
  const rows = await db.select({ id: reach_out_log.id }).from(reach_out_log)
    .where(and(eq(reach_out_log.user_id, userId), eq(reach_out_log.status, "scheduled"), gte(reach_out_log.created_at, since))).limit(1);
  return rows.length > 0;
}

/** D5: the user's message answers only their most recent sent reach-out, if it is still unanswered. */
export async function markLatestAnswered(db: Db, userId: string, at: Date): Promise<string | null> {
  const latest = (await db.select({ id: reach_out_log.id, answered_at: reach_out_log.answered_at }).from(reach_out_log)
    .where(and(eq(reach_out_log.user_id, userId), eq(reach_out_log.status, "sent")))
    .orderBy(desc(reach_out_log.send_at)).limit(1))[0];
  if (!latest || latest.answered_at) return null;
  await db.update(reach_out_log).set({ answered_at: at })
    .where(and(eq(reach_out_log.user_id, userId), eq(reach_out_log.id, latest.id), isNull(reach_out_log.answered_at)));
  return latest.id;
}
