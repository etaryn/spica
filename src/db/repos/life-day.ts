import { desc, eq, lt } from "drizzle-orm";
import type { Db } from "../client";
import { life_day } from "../schema";

export type LifeDayRow = typeof life_day.$inferSelect;

/** Her shared plan for one of her local dates. Not user-scoped: it holds no user data. */
export async function getLifeDay(db: Db, date: string): Promise<LifeDayRow | null> {
  return (await db.select().from(life_day).where(eq(life_day.date, date)))[0] ?? null;
}

/** True when this call inserted the row; a concurrent generator's row wins silently. */
export async function insertLifeDay(db: Db, row: LifeDayRow): Promise<boolean> {
  return (
    (await db.insert(life_day).values(row).onConflictDoNothing().returning({ date: life_day.date }))
      .length > 0
  );
}

/** The `limit` plans before `date`, oldest first (the generator's continuity context). */
export async function listLifeDaysBefore(
  db: Db,
  date: string,
  limit: number,
): Promise<LifeDayRow[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select()
    .from(life_day)
    .where(lt(life_day.date, date))
    .orderBy(desc(life_day.date))
    .limit(limit);
  return rows.reverse();
}
