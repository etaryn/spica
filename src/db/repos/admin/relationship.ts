/**
 * Cross-user query for the relationship daily tick: every user with a relationship row.
 */
import type { Db } from "@/db/client";
import { relationship } from "@/db/schema";

/** System job, unscoped by design: every user with a relationship row (the daily tick). */
export async function adminListRelationshipUsers(db: Db): Promise<string[]> {
  return (await db.select({ id: relationship.user_id }).from(relationship)).map((r) => r.id);
}
