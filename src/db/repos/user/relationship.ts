/**
 * One user's relationship: the status row, the homeostatic params, the event trace, and the
 * message counts the params and cadence are built from.
 */
import { and, desc, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
import {
  PARAM_NAMES,
  type Params,
  type ParamName,
  type RelationshipConfig,
  type RelationshipEvent,
  type RelationshipState,
} from "@/mind/state/user/relationship/types";
import { localMidnight, nextLocalDate } from "@/mind/platform/timezone";
import type { Db } from "@/db/client";
import { relationship, relationship_event, relationship_param, session_log } from "@/db/schema";

export type RelationshipRow = typeof relationship.$inferSelect;
export type RelationshipEventRow = typeof relationship_event.$inferSelect;
export type Cadence = {
  msgs_24h: number;
  msgs_7d: number;
  median_gap_hours: number;
  active_hours: number[];
};

export async function ensureRelationship(
  tx: Db,
  userId: string,
  now: Date,
  cfg: RelationshipConfig,
): Promise<void> {
  await tx
    .insert(relationship)
    .values({ user_id: userId, cadence: {}, milestones: [] })
    .onConflictDoNothing();
  await tx
    .insert(relationship_param)
    .values(
      PARAM_NAMES.map((name) => ({
        user_id: userId,
        name,
        value: cfg.initial[name],
        baseline: cfg.initial[name],
        variance: cfg.initial_variance[name],
        updated_at: now,
      })),
    )
    .onConflictDoNothing();
}

export async function lockRelationship(tx: Db, userId: string): Promise<RelationshipRow> {
  const row = (
    await tx.select().from(relationship).where(eq(relationship.user_id, userId)).for("update")
  )[0];
  if (!row) throw new Error("relationship row missing");
  return row;
}

export async function getRelationshipRow(db: Db, userId: string): Promise<RelationshipRow | null> {
  return (await db.select().from(relationship).where(eq(relationship.user_id, userId)))[0] ?? null;
}

export async function getParams(db: Db, userId: string): Promise<Params> {
  const rows = await db
    .select()
    .from(relationship_param)
    .where(eq(relationship_param.user_id, userId));
  const out: Partial<Params> = {};
  for (const r of rows) {
    if ((PARAM_NAMES as readonly string[]).includes(r.name)) {
      out[r.name as ParamName] = {
        value: r.value,
        baseline: r.baseline,
        variance: r.variance,
        updated_at: r.updated_at,
      };
    }
  }
  for (const n of PARAM_NAMES) if (!out[n]) throw new Error(`relationship_param ${n} missing`);
  return out as Params;
}

export function toRelationshipState(r: RelationshipRow): RelationshipState {
  return {
    status: r.status,
    end_pending_since: r.end_pending_since,
    ended_at: r.ended_at,
    repair_started_at: r.repair_started_at,
    make_up_state: r.make_up_state,
    make_up_replies: r.make_up_replies,
    hurt_cause_fact: r.hurt_cause_fact,
    crisis_quiet_until: r.crisis_quiet_until,
    last_tick: r.last_tick,
    last_hurt_at: r.last_hurt_at,
    hours_together: r.hours_together,
    session: r.session,
    peak_stage: r.peak_stage,
    apart_stage: r.apart_stage,
    milestones: r.milestones,
  };
}

export async function saveRelationship(
  tx: Db,
  userId: string,
  a: { state: RelationshipState; params: Params; cadence?: Cadence; last_contact?: Date | null },
): Promise<void> {
  await tx
    .update(relationship)
    .set({
      ...a.state,
      ...(a.cadence ? { cadence: a.cadence } : {}),
      ...(a.last_contact !== undefined ? { last_contact: a.last_contact } : {}),
    })
    .where(eq(relationship.user_id, userId));
  for (const name of PARAM_NAMES) {
    const p = a.params[name];
    await tx
      .update(relationship_param)
      .set({ value: p.value, baseline: p.baseline, variance: p.variance, updated_at: p.updated_at })
      .where(and(eq(relationship_param.user_id, userId), eq(relationship_param.name, name)));
  }
}

export async function insertRelationshipEvents(
  tx: Db,
  userId: string,
  events: RelationshipEvent[],
  a: { turnId: string | null; now: Date },
): Promise<void> {
  if (events.length === 0) return;
  await tx.insert(relationship_event).values(
    events.map((e) => ({
      user_id: userId,
      param: e.param,
      before: e.before,
      after: e.after,
      cause: e.cause,
      deviation: e.deviation,
      detail: e.detail,
      turn_id: a.turnId,
      created_at: a.now,
    })),
  );
}

export async function countUserTurnsBetween(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const r = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(session_log)
    .where(
      and(
        eq(session_log.user_id, userId),
        eq(session_log.role, "user"),
        gt(session_log.created_at, from),
        lte(session_log.created_at, to),
      ),
    );
  return r[0]?.n ?? 0;
}

/**
 * `date`'s half-open UTC range `[localMidnight(date), localMidnight(date+1))`, computed in
 * TypeScript and DST-correct, so the comparison is a plain range against `created_at` and
 * `session_log_user_created_idx` applies (a function on the column, as the old `AT TIME ZONE … ::date`
 * form used, can't use it).
 */
export async function countUserTurnsOnLocalDate(
  db: Db,
  userId: string,
  date: string,
  tz: string,
): Promise<number> {
  const from = localMidnight(date, tz);
  const to = localMidnight(nextLocalDate(date), tz);
  const r = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(session_log)
    .where(
      and(
        eq(session_log.user_id, userId),
        eq(session_log.role, "user"),
        gte(session_log.created_at, from),
        lt(session_log.created_at, to),
      ),
    );
  return r[0]?.n ?? 0;
}

/** Bounded to `created_at >= since`: the cadence window never needs the user's full history. */
export async function userSessionStarts(
  db: Db,
  userId: string,
  limit: number,
  since: Date,
): Promise<Date[]> {
  const r = await db.execute(sql`
    SELECT min(created_at) AS started FROM session_log
    WHERE user_id = ${userId} AND role = 'user' AND created_at >= ${since}
    GROUP BY session_id ORDER BY started DESC LIMIT ${limit}`);
  return r.rows.map((x) => new Date(String(x.started)));
}

/** Bounded to `created_at >= since`. */
export async function userActiveHours(
  db: Db,
  userId: string,
  tz: string,
  since: Date,
): Promise<number[]> {
  const r = await db.execute(sql`
    SELECT extract(hour FROM created_at AT TIME ZONE ${tz})::int AS h, count(*)::int AS n FROM session_log
    WHERE user_id = ${userId} AND role = 'user' AND created_at >= ${since} GROUP BY h`);
  const out = Array.from({ length: 24 }, () => 0);
  for (const row of r.rows) out[Number(row.h)] = Number(row.n);
  return out;
}

export async function listRelationshipEvents(
  db: Db,
  userId: string,
  limit: number,
): Promise<RelationshipEventRow[]> {
  return db
    .select()
    .from(relationship_event)
    .where(eq(relationship_event.user_id, userId))
    .orderBy(desc(relationship_event.created_at))
    .limit(limit);
}

/** One more reach-out the user hasn't answered yet. Returns the new count. */
export async function incrementUnanswered(db: Db, userId: string): Promise<number> {
  const rows = await db
    .update(relationship)
    .set({ unanswered_reach_outs: sql`${relationship.unanswered_reach_outs} + 1` })
    .where(eq(relationship.user_id, userId))
    .returning({ n: relationship.unanswered_reach_outs });
  return rows[0]?.n ?? 0;
}

/** Any user message answers her latest reach-out. */
export async function resetUnanswered(db: Db, userId: string): Promise<void> {
  await db
    .update(relationship)
    .set({ unanswered_reach_outs: 0 })
    .where(eq(relationship.user_id, userId));
}

/**
 * She reached out to make up: the make-up has been offered, so a reply won't offer it again.
 * False when it wasn't due any more.
 */
export async function markMakeUpOffered(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .update(relationship)
    .set({ make_up_state: "offered" })
    .where(and(eq(relationship.user_id, userId), eq(relationship.make_up_state, "due")))
    .returning({ id: relationship.user_id });
  return rows.length > 0;
}

/** The raw reading behind a param's newest change: extraction's last word, not the average. */
export async function latestReading(
  db: Db,
  userId: string,
  param: ParamName,
): Promise<number | null> {
  const rows = await db
    .select({ detail: relationship_event.detail })
    .from(relationship_event)
    .where(
      and(
        eq(relationship_event.user_id, userId),
        eq(relationship_event.param, param),
        // Baseline samples and decay carry no reading.
        eq(relationship_event.cause, "signal"),
      ),
    )
    .orderBy(desc(relationship_event.created_at))
    .limit(1);
  const reading = (rows[0]?.detail as { reading?: unknown } | undefined)?.reading;
  return typeof reading === "number" ? reading : null;
}
