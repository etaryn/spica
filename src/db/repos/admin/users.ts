/**
 * Cross-user account queries for the inspector, a dev-only tool.
 */
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { user } from "@/db/schema";

/** Inspector only (unscoped by design). */
export async function adminListUsers(db: Db) {
  return db
    .select({ id: user.id, email: user.email, name: user.name, createdAt: user.createdAt })
    .from(user)
    .orderBy(desc(user.createdAt))
    .limit(200);
}

/** Inspector only (unscoped by design). */
export async function adminGetUser(db: Db, id: string) {
  const rows = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, id))
    .limit(1);
  return rows[0] ?? null;
}
