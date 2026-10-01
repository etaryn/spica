import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../client";
import { thread, threadStakes } from "../schema";
import { normalizeName } from "./entities";
import { one, toDate } from "./util";

export type ThreadRow = typeof thread.$inferSelect;
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

export async function listOpenThreads(db: Db, userId: string, limit: number) {
  return db
    .select({ id: thread.id, title: thread.title })
    .from(thread)
    .where(and(eq(thread.user_id, userId), eq(thread.status, "open")))
    .orderBy(desc(thread.last_touched))
    .limit(limit);
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
    LEFT JOIN LATERAL (
      SELECT f.id, f.content, f.salience, COALESCE((f.payload->>'sensitive')::boolean, false) AS sensitive FROM fact f
      WHERE f.user_id = t.user_id AND f.thread_id = t.id AND f.scope = 'private'
        AND f.status NOT IN ('superseded', 'stale')
      ORDER BY f.created_at DESC LIMIT 1
    ) lf ON true
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
