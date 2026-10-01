/**
 * Every personal-event attempt from the per-user life tick, accepted or rejected. Diagnostic only.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { life_event_log } from "@/db/schema";

export type LifeEventLogRow = typeof life_event_log.$inferSelect;
export type NewLifeEventLog = Omit<typeof life_event_log.$inferInsert, "user_id" | "id">;

export async function insertLifeEventLogs(
  tx: Db,
  userId: string,
  rows: NewLifeEventLog[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(life_event_log).values(rows.map((r) => ({ ...r, user_id: userId })));
}

export async function listLifeEventLogs(
  db: Db,
  userId: string,
  limit: number,
): Promise<LifeEventLogRow[]> {
  return db
    .select()
    .from(life_event_log)
    .where(eq(life_event_log.user_id, userId))
    .orderBy(desc(life_event_log.created_at), desc(life_event_log.attempt))
    .limit(limit);
}

/** When the last high-stakes event was accepted for this user (the high-stakes rule). */
export async function lastAcceptedHighStakes(db: Db, userId: string): Promise<Date | null> {
  const rows = await db
    .select({ at: sql<Date | string | null>`max(${life_event_log.created_at})` })
    .from(life_event_log)
    .where(
      and(
        eq(life_event_log.user_id, userId),
        inArray(life_event_log.decision, ["accepted", "resolves"]),
        sql`${life_event_log.candidate}->>'stakes' = 'high'`,
      ),
    );
  const at = rows[0]?.at;
  return at ? new Date(at) : null;
}
