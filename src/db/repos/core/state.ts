/**
 * Her core state in Postgres: the single `core_state` row.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_state } from "@/db/schema";
import type { CoreEmotion, CoreNeeds, CoreState, CoreStateRow } from "@/mind/state/core/types";

const ROW = 1;
function toRow(r: typeof core_state.$inferSelect): CoreStateRow {
  const { id: _id, emotion, needs, ...rest } = r;
  return { ...rest, emotion: (emotion as CoreEmotion | null) ?? null, needs: needs as CoreNeeds };
}

export function coreStateRepo(db: Db): CoreState {
  return {
    async get() {
      const row = (await db.select().from(core_state).where(eq(core_state.id, ROW)))[0];
      return row ? toRow(row) : null;
    },

    async ensure(baseline, needs) {
      await db
        .insert(core_state)
        .values({
          id: ROW,
          ...baseline,
          baseline,
          emotion: null,
          needs,
        })
        .onConflictDoNothing();
    },

    async lock() {
      const row = (
        await db.select().from(core_state).where(eq(core_state.id, ROW)).for("update")
      )[0];
      if (!row) throw new Error("core_state row missing");
      return toRow(row);
    },

    async update(patch) {
      await db.update(core_state).set(patch).where(eq(core_state.id, ROW));
    },
  };
}
