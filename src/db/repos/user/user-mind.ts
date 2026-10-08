/**
 * One user's mind runs: the durable row behind each batch of her thinking about them, the trace
 * of every loop in it, and the live summary she keeps of where things stand.
 */
import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { fact, user_loop_trace, user_mind_run } from "@/db/schema";
import { getTimezone } from "@/db/repos/user/users";
import { isValidTimeZone, localDateString } from "@/mind/platform/timezone";
import type { FactRow } from "./facts";

export type UserMindRunRow = typeof user_mind_run.$inferSelect;
export type NewUserLoopTrace = typeof user_loop_trace.$inferInsert;
export type Trigger =
  | { kind: "param_jump" | "param_band"; param: string; from: number; to: number }
  | { kind: "salient_fact"; salience: number }
  | { kind: "make_up_done" };

/**
 * Null when this source already recorded a run (a retried exchange). Runs past `cap` on the
 * user's local date are recorded `capped`; capped rows don't count toward the cap.
 */
export async function insertRun(
  db: Db,
  userId: string,
  input: { sourceRef: string; triggers: Trigger[]; localDate: string; now: Date; cap: number },
): Promise<UserMindRunRow | null> {
  const counted = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(user_mind_run)
    .where(
      and(
        eq(user_mind_run.user_id, userId),
        eq(user_mind_run.local_date, input.localDate),
        ne(user_mind_run.status, "capped"),
      ),
    );
  const rows = await db
    .insert(user_mind_run)
    .values({
      user_id: userId,
      source_ref: input.sourceRef,
      triggers: input.triggers,
      status: (counted[0]?.n ?? 0) >= input.cap ? "capped" : "pending",
      local_date: input.localDate,
      created_at: input.now,
    })
    .onConflictDoNothing({ target: [user_mind_run.user_id, user_mind_run.source_ref] })
    .returning();
  return rows[0] ?? null;
}

/** Atomically takes a pending run; null when it's already taken, finished or capped. */
export async function claimRun(db: Db, runId: string): Promise<UserMindRunRow | null> {
  const rows = await db
    .update(user_mind_run)
    .set({ status: "running" })
    .where(and(eq(user_mind_run.id, runId), eq(user_mind_run.status, "pending")))
    .returning();
  return rows[0] ?? null;
}

export async function finishRun(
  db: Db,
  runId: string,
  status: "done" | "failed",
  now: Date,
): Promise<void> {
  await db
    .update(user_mind_run)
    .set({ status, finished_at: now })
    .where(eq(user_mind_run.id, runId));
}

export async function insertLoopTrace(db: Db, row: NewUserLoopTrace): Promise<void> {
  await db.insert(user_loop_trace).values(row);
}

export async function liveSummary(db: Db, userId: string): Promise<FactRow | null> {
  const rows = await db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.kind, "summary"),
        notInArray(fact.status, ["superseded", "stale"]),
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(1);
  return rows[0] ?? null;
}

/** The user's local date; UTC when their zone is unset or invalid. */
export async function userLocalDate(db: Db, userId: string, now: Date): Promise<string> {
  const raw = await getTimezone(db, userId);
  return localDateString(now, raw && isValidTimeZone(raw) ? raw : "UTC");
}
