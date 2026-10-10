/**
 * The disclosure ledger: what she has actually told this user about herself, how deep it went and
 * whether she only hinted at it. User-scoped; it points at core items but core never reads it.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { disclosure, session_log } from "@/db/schema";

export type NewDisclosure = Omit<typeof disclosure.$inferInsert, "id" | "user_id">;
export type DisclosureLevel = "open" | "peek";

export async function insertDisclosures(
  db: Db,
  userId: string,
  rows: NewDisclosure[],
): Promise<void> {
  if (rows.length) {
    await db.insert(disclosure).values(rows.map((r) => ({ ...r, user_id: userId })));
  }
}

/** The depths of what she told them most recently, newest first. */
export async function recentDisclosureDepths(
  db: Db,
  userId: string,
  limit: number,
): Promise<number[]> {
  const rows = await db
    .select({ depth: disclosure.depth })
    .from(disclosure)
    .where(eq(disclosure.user_id, userId))
    .orderBy(desc(disclosure.created_at))
    .limit(limit);
  return rows.map((r) => r.depth);
}

/** How fully they know each item: told openly at any point wins over a hint. */
export async function disclosureLevels(
  db: Db,
  userId: string,
  refIds: string[],
): Promise<Map<string, DisclosureLevel>> {
  const levels = new Map<string, DisclosureLevel>();
  if (!refIds.length) return levels;
  const rows = await db
    .select({ ref: disclosure.ref_id, level: disclosure.level })
    .from(disclosure)
    .where(and(eq(disclosure.user_id, userId), inArray(disclosure.ref_id, refIds)));
  for (const r of rows) if (levels.get(r.ref) !== "open") levels.set(r.ref, r.level);
  return levels;
}

/** Whether a reply earlier in this conversation already held this item back. */
export async function heldBackInSession(
  db: Db,
  userId: string,
  sessionId: string,
  refId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: session_log.id })
    .from(session_log)
    .where(
      and(
        eq(session_log.user_id, userId),
        eq(session_log.session_id, sessionId),
        sql`${session_log.depth}->>'held_back' = ${refId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
