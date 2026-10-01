/**
 * Cross-user query for the per-user ticks (life, ego, outreach): every user whose relationship is
 * active or repairing.
 */
import { inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { relationship } from "@/db/schema";

/** System jobs (life_tick, ego_tick), unscoped by design: users whose friendship hasn't been ended. */
export async function adminListLifeUsers(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: relationship.user_id })
    .from(relationship)
    .where(inArray(relationship.status, ["active", "repairing"]));
  return rows.map((r) => r.id);
}
