/**
 * One user's profile card answers: whether they've met her yet, and what they put on the card.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { onboarding } from "@/db/schema";

export type OnboardingRow = typeof onboarding.$inferSelect;

export async function getOnboarding(db: Db, userId: string): Promise<OnboardingRow | null> {
  const rows = await db.select().from(onboarding).where(eq(onboarding.user_id, userId)).limit(1);
  return rows[0] ?? null;
}

/** False when they already have a card: the quiz is taken once, even from two tabs at once. */
export async function insertOnboarding(
  db: Db,
  userId: string,
  row: Omit<typeof onboarding.$inferInsert, "user_id">,
): Promise<boolean> {
  const inserted = await db
    .insert(onboarding)
    .values({ ...row, user_id: userId })
    .onConflictDoNothing()
    .returning({ user_id: onboarding.user_id });
  return inserted.length === 1;
}
