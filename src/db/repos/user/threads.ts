/**
 * One user's threads: ongoing storylines with checkpoints and stakes, and which ones are due.
 */
import { and, desc, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { fact, thread, threadStakes } from "@/db/schema";
import { normalizeName } from "./entities";
import { one, toDate } from "@/db/repos/util";

export type ThreadRow = typeof thread.$inferSelect;
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * A thread's latest active fact, for a LATERAL join on `t`. A thread is as sensitive as its
 * latest fact.
 */
const latestFact = sql`
  SELECT f.id, f.content, f.salience, f.occurred_at,
    COALESCE((f.payload->>'sensitive')::boolean, false) AS sensitive
  FROM fact f
  WHERE f.user_id = t.user_id AND f.thread_id = t.id AND f.scope = 'private'
    AND f.status NOT IN ('superseded', 'stale')
  ORDER BY f.created_at DESC LIMIT 1`;

/**
 * `excludeSensitive` drops threads whose latest fact is sensitive. `event_at` is the latest
 * fact's date: when the thing happens, apart from `next_checkpoint`, when to ask about it.
 */
export async function listOpenThreads(
  db: Db,
  userId: string,
  limit: number,
  opts: { excludeSensitive?: boolean } = {},
): Promise<{ id: string; title: string; next_checkpoint: Date | null; event_at: Date | null }[]> {
  const res = await db.execute(sql`
    SELECT t.id, t.title, t.next_checkpoint, lf.occurred_at AS event_at FROM thread t
    LEFT JOIN LATERAL (${latestFact}) lf ON true
    WHERE t.user_id = ${userId} AND t.status = 'open'
      ${opts.excludeSensitive ? sql`AND COALESCE(lf.sensitive, false) = false` : sql``}
    ORDER BY t.last_touched DESC
    LIMIT ${limit}`);
  return res.rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    next_checkpoint: r.next_checkpoint ? new Date(r.next_checkpoint as string | Date) : null,
    event_at: r.event_at ? new Date(r.event_at as string | Date) : null,
  }));
}

export async function findOpenThreadByTitle(
  db: Db,
  userId: string,
  title: string,
): Promise<ThreadRow | null> {
  const rows = await db
    .select()
    .from(thread)
    .where(
      and(
        eq(thread.user_id, userId),
        eq(thread.status, "open"),
        sql`lower(regexp_replace(trim(${thread.title}), '\\s+', ' ', 'g')) = ${normalizeName(title)}`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getOwnedThread(
  db: Db,
  userId: string,
  id: string,
): Promise<ThreadRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const rows = await db
    .select()
    .from(thread)
    .where(and(eq(thread.user_id, userId), eq(thread.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** `at` is the exchange time, so a late job still opens the thread before its checkpoint. */
export async function insertThread(
  db: Db,
  userId: string,
  t: {
    title: string;
    subject: "user" | "self" | "shared";
    stakes: (typeof threadStakes.enumValues)[number];
    next_checkpoint: Date | null;
  },
  at: Date,
): Promise<ThreadRow> {
  return one(
    await db
      .insert(thread)
      .values({
        user_id: userId,
        title: tidy(t.title),
        subject: t.subject,
        status: "open",
        stakes: t.stakes,
        next_checkpoint: t.next_checkpoint,
        opened_at: at,
        last_touched: at,
      })
      .returning(),
  );
}

/** `at` is the exchange time; an older exchange never moves last_touched backwards. */
export async function touchThread(
  db: Db,
  userId: string,
  id: string,
  at: Date,
  nextCheckpoint: Date | null,
): Promise<void> {
  await db
    .update(thread)
    .set({
      last_touched: sql`GREATEST(${thread.last_touched}, ${at.toISOString()}::timestamptz)`,
      ...(nextCheckpoint ? { next_checkpoint: nextCheckpoint } : {}),
    })
    .where(and(eq(thread.user_id, userId), eq(thread.id, id)));
}

export async function resolveThread(db: Db, userId: string, id: string, now: Date): Promise<void> {
  await db
    .update(thread)
    .set({ status: "resolved", last_touched: now })
    .where(and(eq(thread.user_id, userId), eq(thread.id, id)));
}

export type DueThread = {
  id: string;
  title: string;
  next_checkpoint: Date;
  fact_id: string | null;
  content: string | null;
  salience: number | null;
  stakes: "low" | "med" | "high";
  sensitive: boolean;
};

/** Open threads whose checkpoint has passed, each with its latest active fact (force-included by retrieval). */
export async function dueThreads(
  db: Db,
  userId: string,
  now: Date,
  limit: number,
): Promise<DueThread[]> {
  const res = await db.execute(sql`
    SELECT t.id, t.title, t.next_checkpoint, t.stakes, lf.id AS fact_id, lf.content, lf.salience, lf.sensitive
    FROM thread t
    LEFT JOIN LATERAL (${latestFact}) lf ON true
    WHERE t.user_id = ${userId} AND t.status = 'open' AND t.next_checkpoint IS NOT NULL AND t.next_checkpoint <= ${now}
      AND t.last_touched < t.next_checkpoint
    ORDER BY t.next_checkpoint ASC
    LIMIT ${limit}`);
  return res.rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    next_checkpoint: toDate(r.next_checkpoint),
    fact_id: r.fact_id ? String(r.fact_id) : null,
    content: r.content ? String(r.content) : null,
    salience: r.salience == null ? null : Number(r.salience),
    stakes: r.stakes as DueThread["stakes"],
    sensitive: r.sensitive === true,
  }));
}

/**
 * The live facts about them on a thread, newest first: what she knows behind a follow-up. The
 * newest dated one is always included (last, when it isn't among the newest), since its date is
 * what keeps a past event from reading as upcoming.
 */
export async function threadUserFacts(db: Db, userId: string, threadId: string, limit: number) {
  const query = (dated: boolean, n: number) =>
    db
      .select({
        id: fact.id,
        content: fact.content,
        occurred_at: fact.occurred_at,
        created_at: fact.created_at,
      })
      .from(fact)
      .where(
        and(
          eq(fact.user_id, userId),
          eq(fact.thread_id, threadId),
          eq(fact.subject, "user"),
          eq(fact.scope, "private"),
          notInArray(fact.status, ["superseded", "stale"]),
          // The thread's flag only reads its latest fact; an older sensitive one never goes out.
          sql`COALESCE((${fact.payload}->>'sensitive')::boolean, false) = false`,
          dated ? isNotNull(fact.occurred_at) : undefined,
        ),
      )
      .orderBy(desc(fact.created_at))
      .limit(n);
  const newest = await query(false, limit);
  if (newest.some((f) => f.occurred_at !== null)) return newest;
  return [...newest, ...(await query(true, 1))];
}
