/**
 * Her goals in Postgres: the core_goal table. No query here takes or returns a user id.
 */
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_goal } from "@/db/schema";
import type { CoreGoal, CoreGoals } from "@/mind/state/core/types";
import { one } from "../util";

function toGoal(r: typeof core_goal.$inferSelect): CoreGoal {
  const { embedding: _embedding, ...goal } = r;
  return goal;
}

export function coreGoalsRepo(db: Db): CoreGoals {
  return {
    async byTitle(title) {
      const row = (
        await db
          .select()
          .from(core_goal)
          .where(eq(core_goal.title, title))
          // The live one when a dropped goal came back under the same title.
          .orderBy(desc(sql`${core_goal.status} = 'active'`), desc(core_goal.started_at))
          .limit(1)
      )[0];
      return row ? toGoal(row) : null;
    },
    async active() {
      const rows = await db
        .select()
        .from(core_goal)
        .where(eq(core_goal.status, "active"))
        .orderBy(asc(core_goal.started_at));
      return rows.map(toGoal);
    },
    async get(id) {
      const row = (await db.select().from(core_goal).where(eq(core_goal.id, id)))[0];
      return row ? toGoal(row) : null;
    },
    async count() {
      return one(await db.select({ n: count() }).from(core_goal)).n;
    },
    async insert(goal) {
      return one(
        await db
          .insert(core_goal)
          .values({ ...goal, updated_at: goal.started_at })
          .returning({ id: core_goal.id }),
      ).id;
    },
    async setProgress(id, progress, now) {
      await db
        .update(core_goal)
        .set({ progress, updated_at: now })
        .where(and(eq(core_goal.id, id), eq(core_goal.status, "active")));
    },
    async setStatus(id, status, now) {
      const rows = await db
        .update(core_goal)
        .set({ status, updated_at: now })
        .where(and(eq(core_goal.id, id), eq(core_goal.status, "active")))
        .returning({ id: core_goal.id });
      return rows.length > 0;
    },
  };
}
