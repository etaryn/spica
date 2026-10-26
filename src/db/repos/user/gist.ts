/**
 * Which of one user's older memories can fold into a gist, and the fold itself. A memory is
 * history once its week is old enough and its storyline, if any, has closed; anything a crisis
 * touched never folds.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { fact } from "@/db/schema";

/** `before`: the local date memories must predate; `tz`: the user's zone. */
export type GistWindow = { before: string; tz: string };
export type GistSource = {
  id: string;
  subject: "user" | "self" | "shared";
  kind: string;
  content: string;
  occurred_at: Date;
  salience: number;
};

const dated = sql`COALESCE(${fact.occurred_at}, ${fact.created_at})`;
const week = (tz: string) =>
  sql<string>`date_trunc('week', ${dated} AT TIME ZONE ${tz})::date::text`;

function eligible(userId: string, w: GistWindow) {
  return and(
    eq(fact.user_id, userId),
    eq(fact.scope, "private"),
    inArray(fact.kind, ["event", "feeling"]),
    inArray(fact.subject, ["user", "shared"]),
    inArray(fact.status, ["open", "resolved"]),
    sql`COALESCE((${fact.payload}->>'sensitive')::boolean, false) = false`,
    sql`NOT (COALESCE(${fact.payload}, '{}'::jsonb) ? 'gisted_into')`,
    sql`(${fact.thread_id} IS NULL OR NOT EXISTS (
      SELECT 1 FROM thread t WHERE t.id = ${fact.thread_id} AND t.status = 'open'))`,
    sql`(${dated} AT TIME ZONE ${w.tz})::date < ${w.before}::date`,
  );
}

/** The oldest Monday-start local week with at least `minGroup` memories, its most salient first. */
export async function oldestGistGroup(
  db: Db,
  userId: string,
  w: GistWindow & { minGroup: number; maxSources: number },
): Promise<{ week: string; sources: GistSource[] } | null> {
  const [first] = await db
    .select({ week: week(w.tz) })
    .from(fact)
    .where(eligible(userId, w))
    .groupBy(sql`1`)
    .having(sql`count(*) >= ${w.minGroup}`)
    .orderBy(sql`1`)
    .limit(1);
  if (!first) return null;
  // ponytail: the less salient rest of a week past max_sources can gist again later; group them
  // with the first gist if a doubled week reads badly
  const rows = await db
    .select({
      id: fact.id,
      subject: fact.subject,
      kind: fact.kind,
      content: fact.content,
      occurred_at: fact.occurred_at,
      created_at: fact.created_at,
      salience: fact.salience,
    })
    .from(fact)
    .where(and(eligible(userId, w), sql`${week(w.tz)} = ${first.week}`))
    .orderBy(desc(fact.salience), fact.id)
    .limit(w.maxSources);
  const sources = rows
    .map((r) => ({
      id: r.id,
      subject: r.subject,
      kind: r.kind,
      content: r.content,
      occurred_at: r.occurred_at ?? r.created_at,
      salience: r.salience,
    }))
    // In time order, as she remembers the week.
    .sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime() || a.id.localeCompare(b.id));
  return { week: first.week, sources };
}

/**
 * Marks the sources as folded into `gistId` and weighs them down once. False, changing nothing,
 * when any source is no longer eligible or they no longer share one week.
 */
export async function gistFacts(
  db: Db,
  userId: string,
  ids: string[],
  gistId: string,
  factor: number,
  w: GistWindow,
): Promise<boolean> {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return false;
  const rows = await db
    .select({ id: fact.id, week: week(w.tz) })
    .from(fact)
    .where(and(eligible(userId, w), inArray(fact.id, ids)))
    .for("update");
  if (rows.length !== ids.length || new Set(rows.map((r) => r.week)).size !== 1) return false;
  await db
    .update(fact)
    .set({
      payload: sql`COALESCE(${fact.payload}, '{}'::jsonb) || ${JSON.stringify({ gisted_into: gistId })}::jsonb`,
      salience: sql`${fact.salience} * ${factor}::real`,
    })
    .where(and(eq(fact.user_id, userId), inArray(fact.id, ids)));
  return true;
}
