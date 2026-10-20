/**
 * One user's memories (the `fact` table): insert, reconcile neighbours, ranked retrieval
 * candidates, recall write-back, the preoccupation, and the queries outreach and the memory view use.
 */
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Neighbor, RecalledFact } from "@/mind/memory/shared/types";
import type { IdiolectPayload } from "@/mind/memory/user/idiolect";
import type { Db } from "@/db/client";
import { fact, factStatus, retrieval_trace } from "@/db/schema";
import { one, toDate, toDateOrNull, vecLiteral } from "@/db/repos/util";

export type FactRow = typeof fact.$inferSelect;
export type NewFact = Omit<typeof fact.$inferInsert, "user_id">;
type Subject = "user" | "self" | "shared";
const INACTIVE = ["superseded", "stale"] as const;

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
  source: string;
  kind: string;
};

/**
 * Nearest active private facts for this user, with max entity salience. `excludeSensitive`
 * drops `payload.sensitive` facts before the limit (a reach-out never carries them).
 */
export async function candidateFacts(
  db: Db,
  userId: string,
  queryVec: number[],
  limit: number,
  opts: { excludeSensitive?: boolean } = {},
): Promise<CandidateFact[]> {
  const q = vecLiteral(queryVec);
  return db.transaction(async (tx) => {
    // The HNSW index spans all users; iterative scan keeps filtered result sets full.
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
    const res = await tx.execute(sql`
      SELECT f.id, f.subject, f.kind, f.source, f.content, f.salience, f.created_at,
             f.last_recalled_at, f.occurred_at,
             (1 - (f.embedding <=> ${q}::vector))::float8 AS sim,
             COALESCE((SELECT max(e.salience) FROM entity e
                       WHERE e.user_id = f.user_id AND e.id = ANY(f.entity_refs)), 1.0)::float8 AS entity_salience
      FROM fact f
      WHERE f.user_id = ${userId} AND f.scope = 'private' AND f.status NOT IN ('superseded', 'stale')
        -- The summary, her ideas, her read on them and your things together have their own slots.
        AND f.kind NOT IN ('summary', 'idea', 'model', 'idiolect')
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
      source: String(r.source),
      kind: String(r.kind),
    }));
  });
}

export type { Neighbor };

export type IdiolectCandidate = {
  id: string;
  content: string;
  salience: number;
  sim: number;
  payload: IdiolectPayload;
};

/** Their established things together nearest the conversation; never a sensitive one. */
export async function idiolectCandidates(
  db: Db,
  userId: string,
  queryVec: number[],
  limit: number,
): Promise<IdiolectCandidate[]> {
  const q = vecLiteral(queryVec);
  const res = await db.execute(sql`
    SELECT id, content, salience, payload, (1 - (embedding <=> ${q}::vector))::float8 AS sim
    FROM fact
    WHERE user_id = ${userId} AND scope = 'private' AND kind = 'idiolect'
      AND status NOT IN ('superseded', 'stale')
      AND (payload->'idiolect'->>'established_at') IS NOT NULL
      AND COALESCE((payload->>'sensitive')::boolean, false) = false
    ORDER BY embedding <=> ${q}::vector
    LIMIT ${limit}`);
  return res.rows.map((r) => ({
    id: String(r.id),
    content: String(r.content),
    salience: Number(r.salience),
    sim: Number(r.sim),
    payload: (r.payload as { idiolect: IdiolectPayload }).idiolect,
  }));
}

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
        -- What she wrote herself after a big event is never a reconcile neighbour.
        AND kind NOT IN ('summary', 'reflection', 'idea', 'episode', 'model', 'belief')
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

/**
 * Marks an idiolect fact established, once. Builds the idiolect object if it is missing, and
 * keeps the rest of the payload (a sensitive flag survives).
 */
export async function establishIdiolect(
  db: Db,
  userId: string,
  id: string,
  at: Date,
): Promise<void> {
  await db.execute(sql`
    UPDATE fact
    SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
      'idiolect',
      COALESCE(payload->'idiolect', '{"type":"reference","started_by":"user"}'::jsonb)
        || jsonb_build_object('established_at', ${at.toISOString()}::text))
    WHERE user_id = ${userId} AND id = ${id} AND kind = 'idiolect'
      AND (payload->'idiolect'->>'established_at') IS NULL`);
}

/** Her open hurt memories about this user: the feelings the cold path inferred from a slight. */
export async function openHurtFacts(db: Db, userId: string): Promise<FactRow[]> {
  return db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.subject, "self"),
        eq(fact.kind, "feeling"),
        eq(fact.source, "inferred"),
        eq(fact.status, "open"),
      ),
    );
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
 * Memories her notes haven't read yet: from the last `since` window, minus any a summary of the
 * same chain read (clean runs count only clean summaries), the weightiest first. A fact a busy
 * run left out stays unread for the next one. Her own generated kinds are never read back.
 */
export async function listUnreadFacts(
  db: Db,
  userId: string,
  a: { since: Date; clean: boolean; limit: number },
) {
  const since = a.since.toISOString();
  const cleanOnly = a.clean
    ? sql`AND COALESCE((s.payload->>'sensitive')::boolean, false) = false`
    : sql``;
  const read = sql`(
    SELECT jsonb_array_elements_text(t.inputs->'fact_ids')::uuid
    FROM user_loop_trace t
    JOIN fact s ON s.id::text = t.outputs->>'summary_id'
    WHERE t.user_id = ${userId} AND t.loop = 'user_summarise'
      AND t.created_at > ${since}::timestamptz ${cleanOnly}
  )`;
  return db
    .select({
      id: fact.id,
      subject: fact.subject,
      kind: fact.kind,
      content: fact.content,
      salience: fact.salience,
      occurred_at: fact.occurred_at,
      sensitive: sql<boolean>`COALESCE((${fact.payload}->>'sensitive')::boolean, false)`,
    })
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        notInArray(fact.status, [...INACTIVE]),
        notInArray(fact.kind, ["summary", "reflection", "idea", "episode", "model", "belief"]),
        sql`${fact.created_at} > ${since}::timestamptz`,
        a.clean
          ? sql`COALESCE((${fact.payload}->>'sensitive')::boolean, false) = false`
          : undefined,
        sql`${fact.id} NOT IN ${read}`,
      ),
    )
    .orderBy(desc(fact.salience))
    .limit(a.limit);
}
export type UnreadFact = Awaited<ReturnType<typeof listUnreadFacts>>[number];

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

export type OutreachFact = {
  id: string;
  content: string;
  salience: number;
  sensitive: boolean;
  occurred_at: Date | null;
};
const sensitiveCol = sql<boolean>`COALESCE((${fact.payload}->>'sensitive')::boolean, false)`;
const outreachCols = {
  id: fact.id,
  content: fact.content,
  salience: fact.salience,
  sensitive: sensitiveCol,
  occurred_at: fact.occurred_at,
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

/** The live, non-sensitive dated facts among `ids` (unknown or malformed ids are skipped), in that order. */
export async function datedFactsByIds(
  db: Db,
  userId: string,
  ids: string[],
): Promise<{ id: string; content: string; occurred_at: Date }[]> {
  const valid = ids.filter((id) => z.uuid().safeParse(id).success);
  if (!valid.length) return [];
  const rows = await db
    .select({ id: fact.id, content: fact.content, occurred_at: fact.occurred_at })
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        inArray(fact.id, valid),
        notInArray(fact.status, [...INACTIVE]),
        sql`COALESCE((${fact.payload}->>'sensitive')::boolean, false) = false`,
        sql`${fact.occurred_at} IS NOT NULL`,
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, { ...r, occurred_at: r.occurred_at! }]));
  return valid.flatMap((id) => byId.get(id) ?? []);
}

/** Of `ids`, the dated facts at least `minSim` similar to `vec`, closest first. */
export async function nearestDated(
  db: Db,
  userId: string,
  ids: string[],
  vec: number[],
  minSim: number,
  limit: number,
): Promise<string[]> {
  if (!ids.length || limit < 1) return [];
  const q = vecLiteral(vec);
  const rows = await db
    .select({ id: fact.id })
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        inArray(fact.id, ids),
        sql`${fact.occurred_at} IS NOT NULL`,
        sql`(1 - (${fact.embedding} <=> ${q}::vector)) >= ${minSim}`,
      ),
    )
    .orderBy(sql`${fact.embedding} <=> ${q}::vector`)
    .limit(limit);
  return rows.map((r) => r.id);
}
