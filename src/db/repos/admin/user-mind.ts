/** Cross-user: pending user mind runs whose job was lost, for the sweep. */
import { and, asc, eq, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { user_mind_run } from "@/db/schema";

export async function adminStalePendingRuns(
  db: Db,
  olderThan: Date,
  limit: number,
): Promise<{ id: string; user_id: string }[]> {
  return db
    .select({ id: user_mind_run.id, user_id: user_mind_run.user_id })
    .from(user_mind_run)
    .where(and(eq(user_mind_run.status, "pending"), lt(user_mind_run.created_at, olderThan)))
    .orderBy(asc(user_mind_run.created_at))
    .limit(limit);
}
