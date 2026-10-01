import { eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { ego_tick, identity, relationship } from "../schema";

export type IdentityRow = typeof identity.$inferSelect;
export type EgoBaseline = { mood_valence: number; mood_arousal: number; energy: number };

/** Creates her per-user ego row on first use, at the configured baseline. */
export async function ensureIdentity(tx: Db, userId: string, baseline: EgoBaseline): Promise<void> {
  await tx
    .insert(identity)
    .values({
      user_id: userId,
      mood_valence: baseline.mood_valence,
      mood_arousal: baseline.mood_arousal,
      energy: baseline.energy,
      baseline,
    })
    .onConflictDoNothing();
}

export async function lockIdentity(tx: Db, userId: string): Promise<IdentityRow> {
  const row = (
    await tx.select().from(identity).where(eq(identity.user_id, userId)).for("update")
  )[0];
  if (!row) throw new Error("identity row missing");
  return row;
}

export async function getIdentityRow(db: Db, userId: string): Promise<IdentityRow | null> {
  return (await db.select().from(identity).where(eq(identity.user_id, userId)))[0] ?? null;
}

export async function updateIdentity(
  tx: Db,
  userId: string,
  patch: Partial<Omit<IdentityRow, "user_id">>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await tx.update(identity).set(patch).where(eq(identity.user_id, userId));
}

export async function insertEgoTick(
  tx: Db,
  userId: string,
  row: {
    mood_valence: number;
    mood_arousal: number;
    energy: number;
    preoccupation: string | null;
    reason: "tick" | "event" | "exchange";
    created_at: Date;
  },
): Promise<void> {
  await tx.insert(ego_tick).values({ user_id: userId, ...row });
}

/** System jobs (life_tick, ego_tick), unscoped by design: users whose friendship hasn't been ended. */
export async function adminListLifeUsers(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: relationship.user_id })
    .from(relationship)
    .where(inArray(relationship.status, ["active", "repairing"]));
  return rows.map((r) => r.id);
}
