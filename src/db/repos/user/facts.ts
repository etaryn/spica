/**
 * One user's memories (the `fact` table): insert, reconcile neighbours, ranked retrieval
 * candidates, recall write-back, the preoccupation, and the queries outreach and the memory view use.
 */
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { RecalledFact } from "@/mind/memory/shared/types";
import type { Db } from "@/db/client";
import { fact, factStatus, identity, retrieval_trace, thread } from "@/db/schema";
import { one, toDate, toDateOrNull } from "@/db/repos/util";

export type FactRow = typeof fact.$inferSelect;
export type NewFact = Omit<typeof fact.$inferInsert, "user_id">;
type Subject = "user" | "self" | "shared";
const INACTIVE = ["superseded", "stale"] as const;

export const vecLiteral = (v: number[]) => `[${v.join(",")}]`;

export type CandidateFact = {
  id: string;
  subject: Subject;
  content: string;
  salience: number;
  created_at: Date;
  last_recalled_at: Date | null;
  occurred_at: Date | null;
  sim: number;
  entity_salience: number;
};

/**
 * A generated (life-sim) fact whose `occurred_at` is still ahead of `now` hasn't happened yet:
 * the nightly tick stores the day's events in advance, so they stay hidden until their time.
 * Other sources with a future `occurred_at` (a user's plan) are real now and stay visible.
 */
const notYetHappened = (now: Date) =>
  sql`(${fact.source} <> 'generated' OR ${fact.occurred_at} IS NULL OR ${fact.occurred_at} <= ${now.toISOString()}::timestamptz)`;

/**
 * Nearest active private facts for this user, with max entity salience. `excludeSensitive`
 * drops `payload.sensitive` facts before the limit (a reach-out never carries them).
 */
export async function candidateFacts(
  db: Db,
  userId: string,
  queryVec: number[],
  limit: number,
  now: Date,
  opts: { excludeSensitive?: boolean } = {},
): Promise<CandidateFact[]> {
  const q = vecLiteral(queryVec);
  return db.transaction(async (tx) => {
    // The HNSW index spans all users; iterative scan keeps filtered result sets full.
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
    const res = await tx.execute(sql`
      SELECT f.id, f.subject, f.content, f.salience, f.created_at, f.last_recalled_at, f.occurred_at,
             (1 - (f.embedding <=> ${q}::vector))::float8 AS sim,
             COALESCE((SELECT max(e.salience) FROM entity e
                       WHERE e.user_id = f.user_id AND e.id = ANY(f.entity_refs)), 1.0)::float8 AS entity_salience
      FROM fact f
      WHERE f.user_id = ${userId} AND f.scope = 'private' AND f.status NOT IN ('superseded', 'stale')
        AND (f.source <> 'generated' OR f.occurred_at IS NULL OR f.occurred_at <= ${now.toISOString()}::timestamptz)
        ${opts.excludeSensitive ? sql`AND COALESCE((f.payload->>'sensitive')::boolean, false) = false` : sql``}
      ORDER BY f.embedding <=> ${q}::vector
      LIMIT ${limit}`);
    return res.rows.map((r) => ({
      id: String(r.id),
      subject: r.subject as Subject,
      content: String(r.content),
      salience: Number(r.salience),
      created_at: toDate(r.created_at),
      last_recalled_at: toDateOrNull(r.last_recalled_at),
      occurred_at: toDateOrNull(r.occurred_at),
      sim: Number(r.sim),
      entity_salience: Number(r.entity_salience),
    }));
  });
}

export type Neighbor = { id: string; content: string; status: string; sim: number };

/** Active facts of the same subject at or above `minSim` (reconcile candidates, approach A). */
export async function nearFacts(
  db: Db,
  userId: string,
  subject: Subject,
  vec: number[],
  k: number,
  minSim: number,
): Promise<Neighbor[]> {
  const q = vecLiteral(vec);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
    const res = await tx.execute(sql`
      SELECT id, content, status, (1 - (embedding <=> ${q}::vector))::float8 AS sim
      FROM fact
      WHERE user_id = ${userId} AND scope = 'private' AND subject = ${subject}
        AND status NOT IN ('superseded', 'stale')
        AND (1 - (embedding <=> ${q}::vector)) >= ${minSim}
      ORDER BY embedding <=> ${q}::vector
      LIMIT ${k}`);
    return res.rows.map((r) => ({
      id: String(r.id),
      content: String(r.content),
      status: String(r.status),
      sim: Number(r.sim),
    }));
  });
}

export async function insertFact(db: Db, userId: string, row: NewFact): Promise<FactRow> {
  return one(
    await db
      .insert(fact)
      .values({ ...row, user_id: userId })
      .returning(),
  );
}

export async function getFact(db: Db, userId: string, id: string): Promise<FactRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const rows = await db
    .select()
    .from(fact)
    .where(and(eq(fact.user_id, userId), eq(fact.id, id), eq(fact.scope, "private")))
    .limit(1);
  return rows[0] ?? null;
}

export async function bumpDuplicate(
  db: Db,
  userId: string,
  id: string,
  bump: number,
  cap: number,
  confidence: number,
): Promise<void> {
  await db
    .update(fact)
    .set({
      salience: sql`LEAST(${cap}::real, ${fact.salience} + ${bump}::real)`,
      confidence: sql`GREATEST(${fact.confidence}, ${confidence}::real)`,
    })
    .where(and(eq(fact.user_id, userId), eq(fact.id, id)));
}

export async function setFactStatus(
  db: Db,
  userId: string,
  id: string,
  status: (typeof factStatus.enumValues)[number],
  supersededBy: string | null = null,
): Promise<void> {
  await db
    .update(fact)
    .set({ status, ...(supersededBy ? { superseded_by: supersededBy } : {}) })
    .where(and(eq(fact.user_id, userId), eq(fact.id, id)));
}

/**
 * Cold-path recall write-back. Every recalled fact that still exists gets a retrieval_trace row;
 * only unforced recalls with sim >= minSim are reinforced (salience, recall_count, last_recalled_at).
 * Returns the reinforced ids (deleted or foreign facts are skipped).
 */
export async function applyRecall(
  db: Db,
  userId: string,
  recalled: RecalledFact[],
  now: Date,
  opts: { bump: number; cap: number; minSim: number },
  turnId: string | null,
): Promise<string[]> {
  const ids = [...new Set(recalled.map((r) => r.factId))];
  if (ids.length === 0) return [];
  const reinforce = [
    ...new Set(recalled.filter((r) => !r.forced && r.sim >= opts.minSim).map((r) => r.factId)),
  ];
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: fact.id })
      .from(fact)
      .where(and(eq(fact.user_id, userId), inArray(fact.id, ids)));
    const alive = new Set(existing.map((r) => r.id));
    const toBump = reinforce.filter((id) => alive.has(id));
    if (toBump.length > 0) {
      await tx
        .update(fact)
        .set({
          last_recalled_at: now,
          recall_count: sql`${fact.recall_count} + 1`,
          salience: sql`LEAST(${opts.cap}::real, ${fact.salience} + ${opts.bump}::real)`,
        })
        .where(and(eq(fact.user_id, userId), inArray(fact.id, toBump)));
    }
    if (turnId) {
      const rows = recalled
        .filter((r) => alive.has(r.factId))
        .map((r) => ({
          user_id: userId,
          turn_id: turnId,
          fact_id: r.factId,
          sim: r.sim,
          fact_salience: r.fact_salience,
          entity_salience: r.entity_salience,
          recency: r.recency,
          score: r.score,
          forced: r.forced,
          created_at: now,
        }));
      if (rows.length > 0) await tx.insert(retrieval_trace).values(rows);
    }
    return toBump;
  });
}

/** Her current preoccupation, unless it is a generated event that hasn't happened yet at `now`. */
export async function getPreoccupationFact(
  db: Db,
  userId: string,
  now: Date,
): Promise<FactRow | null> {
  const rows = await db
    .select({ f: fact })
    .from(identity)
    .innerJoin(
      fact,
      and(
        eq(fact.id, identity.preoccupation),
        eq(fact.user_id, identity.user_id),
        eq(fact.scope, "private"),
      ),
    )
    .where(
      and(
        eq(identity.user_id, userId),
        notInArray(fact.status, [...INACTIVE]),
        notYetHappened(now),
      ),
    )
    .limit(1);
  return rows[0]?.f ?? null;
}

/** The "what I remember" list. */
export async function listRememberedFacts(db: Db, userId: string) {
  return db
    .select({ id: fact.id, kind: fact.kind, content: fact.content, created_at: fact.created_at })
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.subject, "user"),
        eq(fact.scope, "private"),
        notInArray(fact.status, [...INACTIVE]),
      ),
    )
    .orderBy(desc(fact.created_at));
}

/** Onboarding facts the guard may treat as known. Superseded and stale ones are excluded. */
export async function listOnboardingFacts(
  db: Db,
  userId: string,
): Promise<{ id: string; content: string }[]> {
  return db
    .select({ id: fact.id, content: fact.content })
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.source, "onboarding"),
        eq(fact.scope, "private"),
        notInArray(fact.status, [...INACTIVE]),
      ),
    )
    .orderBy(asc(fact.created_at));
}

/**
 * User-initiated hard delete. False for malformed or foreign ids. A thread left with no
 * facts (any status) is deleted too, so a forgotten storyline isn't asked about again.
 */
export async function forgetFact(db: Db, userId: string, factId: string): Promise<boolean> {
  if (!z.uuid().safeParse(factId).success) return false;
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(fact)
      .where(and(eq(fact.user_id, userId), eq(fact.id, factId)))
      .returning({ id: fact.id, thread_id: fact.thread_id });
    const threadId = rows[0]?.thread_id;
    if (threadId) {
      await tx
        .delete(thread)
        .where(
          and(
            eq(thread.user_id, userId),
            eq(thread.id, threadId),
            sql`NOT EXISTS (SELECT 1 FROM fact f WHERE f.user_id = ${userId} AND f.thread_id = ${threadId})`,
          ),
        );
    }
    return rows.length > 0;
  });
}

/** Her copied schedule blocks for one of her local dates. Stale blocks still count; superseded don't. */
export async function listGeneratedBlockRows(
  db: Db,
  userId: string,
  lifeDay: string,
): Promise<{ id: string; payload: unknown }[]> {
  return db
    .select({ id: fact.id, payload: fact.payload })
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.source, "generated"),
        sql`${fact.status} <> 'superseded'`,
        sql`${fact.payload}->>'life_day' = ${lifeDay}`,
        sql`${fact.payload}->>'block' IS NOT NULL`,
      ),
    );
}

/** Her recent self facts for the event generator, excluding copied schedule blocks. */
export async function listRecentSelfFacts(
  db: Db,
  userId: string,
  limit: number,
): Promise<{ content: string; when: Date }[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ content: fact.content, occurred_at: fact.occurred_at, created_at: fact.created_at })
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.subject, "self"),
        notInArray(fact.status, [...INACTIVE]),
        sql`(${fact.payload} IS NULL OR ${fact.payload}->>'block' IS NULL)`,
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(limit);
  return rows.map((r) => ({ content: r.content, when: r.occurred_at ?? r.created_at }));
}

export type OutreachFact = { id: string; content: string; salience: number; sensitive: boolean };
const sensitiveCol = sql<boolean>`COALESCE((${fact.payload}->>'sensitive')::boolean, false)`;
const outreachCols = {
  id: fact.id,
  content: fact.content,
  salience: fact.salience,
  sensitive: sensitiveCol,
};

/**
 * Outreach `user_event` candidates: the user's events/promises whose time passed in (from, to], not talked about since.
 * R10: a fact attached to a thread is followed up only through that thread (its checkpoint), never as its own event.
 */
export async function listOutreachUserEvents(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
): Promise<OutreachFact[]> {
  return db
    .select(outreachCols)
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.subject, "user"),
        eq(fact.scope, "private"),
        eq(fact.status, "open"),
        inArray(fact.kind, ["event", "promise"]),
        isNull(fact.thread_id),
        sql`${fact.occurred_at} > ${from.toISOString()}::timestamptz AND ${fact.occurred_at} <= ${to.toISOString()}::timestamptz`,
        sql`(${fact.last_recalled_at} IS NULL OR ${fact.last_recalled_at} < ${fact.occurred_at})`,
      ),
    );
}

/** Outreach `her_day` candidates: her generated personal events (not day blocks) whose time passed in (from, to]. */
export async function listOutreachHerDay(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
): Promise<OutreachFact[]> {
  return db
    .select(outreachCols)
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.subject, "self"),
        eq(fact.source, "generated"),
        eq(fact.scope, "private"),
        notInArray(fact.status, [...INACTIVE]),
        sql`(${fact.payload} IS NULL OR ${fact.payload}->>'block' IS NULL)`,
        sql`${fact.occurred_at} > ${from.toISOString()}::timestamptz AND ${fact.occurred_at} <= ${to.toISOString()}::timestamptz`,
      ),
    );
}
