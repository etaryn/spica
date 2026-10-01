/**
 * Cross-user queries for the per-user system jobs: the relationship daily tick (every user with a
 * relationship row) and the outreach tick (users whose friendship hasn't been ended).
 */
import { inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { relationship } from "@/db/schema";

/** System job, unscoped by design: every user with a relationship row (the daily tick). */
export async function adminListRelationshipUsers(db: Db): Promise<string[]> {
  return (await db.select({ id: relationship.user_id }).from(relationship)).map((r) => r.id);
}

/** System job, unscoped by design: users whose relationship is active or repairing (outreach). */
export async function adminListOutreachUsers(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: relationship.user_id })
    .from(relationship)
    .where(inArray(relationship.status, ["active", "repairing"]));
  return rows.map((r) => r.id);
}
