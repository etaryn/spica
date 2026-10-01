import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { push_subscription } from "@/db/schema";

export type PushSubscriptionRow = typeof push_subscription.$inferSelect;
export type PushKeys = { endpoint: string; p256dh: string; auth: string };

/** Upsert by endpoint; a browser re-subscribing under another account moves to that account. */
export async function upsertPushSubscription(
  db: Db,
  userId: string,
  s: PushKeys,
  now: Date,
): Promise<void> {
  await db
    .insert(push_subscription)
    .values({ user_id: userId, ...s, created_at: now })
    .onConflictDoUpdate({
      target: push_subscription.endpoint,
      set: { user_id: userId, p256dh: s.p256dh, auth: s.auth, created_at: now },
    });
}

export async function deletePushSubscription(
  db: Db,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const rows = await db
    .delete(push_subscription)
    .where(and(eq(push_subscription.user_id, userId), eq(push_subscription.endpoint, endpoint)))
    .returning({ id: push_subscription.id });
  return rows.length > 0;
}

export async function listPushSubscriptions(
  db: Db,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  return db.select().from(push_subscription).where(eq(push_subscription.user_id, userId));
}
