import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { guardOutcome, judge_log } from "@/db/schema";

export type JudgeLogRow = typeof judge_log.$inferSelect;
export type NewJudgeLog = Omit<typeof judge_log.$inferInsert, "user_id" | "id">;
export type GuardOutcome = (typeof guardOutcome.enumValues)[number];

export async function insertJudgeLogs(db: Db, userId: string, rows: NewJudgeLog[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(judge_log).values(rows.map((r) => ({ ...r, user_id: userId })));
}

export const listJudgeLogs = (db: Db, userId: string, limit = 200) =>
  db
    .select()
    .from(judge_log)
    .where(eq(judge_log.user_id, userId))
    .orderBy(desc(judge_log.created_at), desc(judge_log.attempt))
    .limit(limit);

/** Final guard outcomes (one per outgoing message), oldest first. */
export async function guardOutcomes(db: Db, userId: string): Promise<GuardOutcome[]> {
  const rows = await db
    .select({ outcome: judge_log.outcome })
    .from(judge_log)
    .where(
      and(eq(judge_log.user_id, userId), eq(judge_log.kind, "guard"), isNotNull(judge_log.outcome)),
    )
    .orderBy(asc(judge_log.created_at), asc(judge_log.attempt));
  return rows.map((r) => r.outcome!);
}
