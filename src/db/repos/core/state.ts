/**
 * Her core state in Postgres: the single `core_state` row.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_state } from "@/db/schema";
import type { CoreState, CoreStateRow } from "@/mind/state/core/types";

const ROW = 1;
const NEUTRAL_EMOTION = { label: "neutral", valence: 0, arousal: 0, about: null, since: null };
const NEUTRAL_NEEDS = { autonomy: 0.5, competence: 0.5 };

function toRow(r: typeof core_state.$inferSelect): CoreStateRow {
  const { id: _id, ...rest } = r;
  return rest;
}

export function coreStateRepo(db: Db): CoreState {
  return {
    async get() {
      const row = (await db.select().from(core_state).where(eq(core_state.id, ROW)))[0];
      return row ? toRow(row) : null;
    },

    async ensure(baseline) {
      await db
        .insert(core_state)
        .values({
          id: ROW,
          ...baseline,
          baseline,
          emotion: NEUTRAL_EMOTION,
          needs: NEUTRAL_NEEDS,
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
