import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { entity, fact, identity, thread } from "./schema";

/** The persona switch wipe (Phase 5 design §3) only ever runs against a local dev database. */
export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error(`refusing to reset self facts on non-local database host "${host}"`);
}

/** Dev only, every user: hard-deletes her self facts, entities and threads (persona v1 scrapped, design D3). */
export async function adminResetSelf(db: Db): Promise<{ facts: number; entities: number; threads: number }> {
  return db.transaction(async (tx) => {
    await tx.update(identity).set({ preoccupation: null, preoccupation_since: null });
    const facts = await tx.delete(fact).where(eq(fact.subject, "self")).returning({ id: fact.id });
    const entities = await tx.delete(entity).where(eq(entity.subject, "self")).returning({ id: entity.id });
    const threads = await tx.delete(thread).where(eq(thread.subject, "self")).returning({ id: thread.id });
    return { facts: facts.length, entities: entities.length, threads: threads.length };
  });
}
