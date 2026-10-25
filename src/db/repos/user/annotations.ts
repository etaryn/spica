/**
 * One user's labels (the `annotation` table): written by the cold path, read back as what a
 * conversation already has labelled, and as the times behind her view of older messages.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { annotation } from "@/db/schema";

export type AnnotationRow = typeof annotation.$inferSelect;
export type NewAnnotation = Omit<typeof annotation.$inferInsert, "user_id">;

export async function insertAnnotations(
  db: Db,
  userId: string,
  rows: NewAnnotation[],
): Promise<void> {
  if (rows.length) await db.insert(annotation).values(rows.map((r) => ({ ...r, user_id: userId })));
}

export async function sessionAnnotations(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<AnnotationRow[]> {
  return db
    .select()
    .from(annotation)
    .where(and(eq(annotation.user_id, userId), eq(annotation.session_id, sessionId)))
    .orderBy(asc(annotation.created_at));
}

// ponytail: scans the user's time labels; index the turn ids if one user's labels get large
export async function timeLabelsOn(
  db: Db,
  userId: string,
  turnIds: string[],
): Promise<AnnotationRow[]> {
  if (!turnIds.length) return [];
  return db
    .select()
    .from(annotation)
    .where(
      and(
        eq(annotation.user_id, userId),
        eq(annotation.layer, "time"),
        sql`${annotation.coords}->0->>'turnId' IN (${sql.join(
          turnIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );
}
