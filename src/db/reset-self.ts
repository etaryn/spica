import { eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { entity, fact, thread } from "./schema";

/** The persona switch wipe only ever runs against a local dev database. */
export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1")
    throw new Error(`refusing to reset self facts on non-local database host "${host}"`);
}

/**
 * Dev only, for a persona change: hard-deletes every user's self facts, entities and threads, and
 * clears her whole core mind (memory, people, snapshots, world events, state, traces), so she can
 * be reseeded from the new persona.
 */
export async function adminResetSelf(
  db: Db,
): Promise<{ facts: number; entities: number; threads: number }> {
  return db.transaction(async (tx) => {
    const facts = await tx.delete(fact).where(eq(fact.subject, "self")).returning({ id: fact.id });
    const entities = await tx
      .delete(entity)
      .where(eq(entity.subject, "self"))
      .returning({ id: entity.id });
    const threads = await tx
      .delete(thread)
      .where(eq(thread.subject, "self"))
      .returning({ id: thread.id });
    await tx.execute(
      sql`TRUNCATE life_event_log, world_event, core_memory, core_entity, core_snapshot, core_loop_trace, core_state`,
    );
    return { facts: facts.length, entities: entities.length, threads: threads.length };
  });
}
