/**
 * One user's account: their time zone, and deleting the account with everything it owns.
 */
import { and, eq, isNull, ne, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { user } from "@/db/schema";

/** Full account deletion: every domain table cascades from the user row. */
export async function deleteUser(db: Db, userId: string): Promise<void> {
  await db.delete(user).where(eq(user.id, userId));
}

/** Stores the browser's IANA time zone when it is new or has changed (one statement, no read). */
export async function setTimezone(db: Db, userId: string, tz: string): Promise<void> {
  await db
    .update(user)
    .set({ timezone: tz })
    .where(and(eq(user.id, userId), or(isNull(user.timezone), ne(user.timezone, tz))));
}

export async function getTimezone(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select({ tz: user.timezone })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return rows[0]?.tz ?? null;
}
