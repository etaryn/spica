/**
 * One user's mind runs: the durable row behind each batch of her thinking about them, the trace
 * of every loop in it, the live summary and read she keeps of them, and her beliefs about them.
 */
import { and, desc, eq, gt, inArray, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { fact, user_loop_trace, user_mind_run } from "@/db/schema";
import { getTimezone } from "@/db/repos/user/users";
import { vecLiteral } from "@/db/repos/util";
import { isValidTimeZone, localDateString } from "@/mind/platform/timezone";
import type { FactRow } from "./facts";

export type UserMindRunRow = typeof user_mind_run.$inferSelect;
export type NewUserLoopTrace = typeof user_loop_trace.$inferInsert;
export type Trigger =
  | { kind: "param_jump" | "param_band"; param: string; from: number; to: number }
  | { kind: "salient_fact"; salience: number; content?: string }
  | { kind: "repaired"; via: "apology" | "fade" }
  | { kind: "make_up_done" }
  | { kind: "long_conversation"; session_id: string; user_turns: number }
  | { kind: "crisis_passed" }
  | { kind: "stale_summary"; age_hours: number | null }
  | { kind: "milestone"; name: string };

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

type LiveKind = "summary" | "model";

async function latestLive(db: Db, userId: string, kind: LiveKind): Promise<FactRow | null> {
  const rows = await db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, kind),
        notInArray(fact.status, ["superseded", "stale"]),
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(1);
  return rows[0] ?? null;
}

/** The newest one that read nothing sensitive, live or superseded: what a reach-out may use. */
async function latestNonSensitive(db: Db, userId: string, kind: LiveKind): Promise<FactRow | null> {
  const rows = await db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, kind),
        sql`COALESCE((${fact.payload}->>'sensitive')::boolean, false) = false`,
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(1);
  return rows[0] ?? null;
}

export const liveSummary = (db: Db, userId: string) => latestLive(db, userId, "summary");
export const latestNonSensitiveSummary = (db: Db, userId: string) =>
  latestNonSensitive(db, userId, "summary");
/** Her live read on them: how they are, what they want, what lands. */
export const liveModel = (db: Db, userId: string) => latestLive(db, userId, "model");
export const latestNonSensitiveModel = (db: Db, userId: string) =>
  latestNonSensitive(db, userId, "model");

/** Her standing beliefs about them, the weightiest first. */
export async function liveBeliefs(db: Db, userId: string, limit: number): Promise<FactRow[]> {
  return db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, "belief"),
        notInArray(fact.status, ["superseded", "stale"]),
      ),
    )
    .orderBy(desc(fact.salience), desc(fact.created_at))
    .limit(limit);
}

/** Similarity to her closest live belief about them other than `except`; null when there is none. */
export async function nearestBeliefSimilarity(
  db: Db,
  userId: string,
  embedding: number[],
  except: string | null = null,
): Promise<number | null> {
  const res = await db.execute(sql`
    SELECT max(1 - (embedding <=> ${vecLiteral(embedding)}::vector))::float8 AS sim
    FROM fact
    WHERE user_id = ${userId} AND scope = 'private' AND kind = 'belief'
      AND status NOT IN ('superseded', 'stale')
      ${except ? sql`AND id <> ${except}` : sql``}`);
  const sim = res.rows[0]?.sim;
  return sim === null || sim === undefined ? null : Number(sim);
}

/** Replaces one of this user's live beliefs with `by`; false when it isn't one. */
export async function supersedeBelief(
  db: Db,
  userId: string,
  id: string,
  by: string,
): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const rows = await db
    .update(fact)
    .set({ status: "superseded", superseded_by: by })
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.id, id),
        eq(fact.kind, "belief"),
        notInArray(fact.status, ["superseded", "stale"]),
      ),
    )
    .returning({ id: fact.id });
  return rows.length > 0;
}

/** The user's local date; UTC when their zone is unset or invalid. */
export async function userLocalDate(db: Db, userId: string, now: Date): Promise<string> {
  const raw = await getTimezone(db, userId);
  return localDateString(now, raw && isValidTimeZone(raw) ? raw : "UTC");
}

export async function recentReflections(db: Db, userId: string, limit: number): Promise<FactRow[]> {
  return db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, "reflection"),
        notInArray(fact.status, ["superseded", "stale"]),
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(limit);
}

/** Ideas she hasn't had her chance with yet: open, and not older than `since`. */
export async function liveIdeas(
  db: Db,
  userId: string,
  since: Date,
  limit: number,
): Promise<FactRow[]> {
  return db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, "idea"),
        eq(fact.status, "open"),
        gt(fact.created_at, since),
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(limit);
}

/** An idea gets one chance: once offered, it is resolved. Only open ideas move. */
/** Ideas she already brought up (used, so resolved) since `since`: not worth proposing again. */
export async function recentlyRaisedIdeas(
  db: Db,
  userId: string,
  since: Date,
  limit: number,
): Promise<FactRow[]> {
  return db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, "idea"),
        eq(fact.status, "resolved"),
        gt(fact.created_at, since),
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(limit);
}

export async function retireIdeas(db: Db, userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(fact)
    .set({ status: "resolved" })
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.kind, "idea"),
        eq(fact.status, "open"),
        inArray(fact.id, ids),
      ),
    )
    .returning({ id: fact.id });
  return rows.length;
}
