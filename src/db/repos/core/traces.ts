/** Core loop traces (one row per core loop run) and the daily call budget's reservations. */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_budget_day, core_loop_trace } from "@/db/schema";
import type { CoreTraces } from "@/mind/platform/core";
import { toDateOrNull } from "../util";

export function coreTracesRepo(db: Db): CoreTraces {
  return {
    async insert(trace) {
      await db.insert(core_loop_trace).values(trace);
    },
    async callsOn(day) {
      const [row] = await db
        .select({ calls: core_budget_day.calls })
        .from(core_budget_day)
        .where(eq(core_budget_day.day, day));
      return row?.calls ?? 0;
    },
    async reserveCall(day, limit) {
      if (limit <= 0) return false;
      // One statement, so concurrent reservations serialise on the day's row.
      const rows = await db
        .insert(core_budget_day)
        .values({ day, calls: 1 })
        .onConflictDoUpdate({
          target: core_budget_day.day,
          set: { calls: sql`${core_budget_day.calls} + 1` },
          setWhere: lt(core_budget_day.calls, limit),
        })
        .returning({ calls: core_budget_day.calls });
      return rows.length > 0;
    },
    async appliedSummary(loop, from, to) {
      const [row] = await db
        .select({
          count: sql<number>`count(*)::int`,
          latest: sql<string | null>`max(${core_loop_trace.created_at})`,
        })
        .from(core_loop_trace)
        .where(
          and(
            eq(core_loop_trace.loop, loop),
            eq(core_loop_trace.status, "done"),
            sql`${core_loop_trace.outputs}->'applied' = 'true'::jsonb`,
            gte(core_loop_trace.created_at, from),
            lt(core_loop_trace.created_at, to),
          ),
        );
      return { count: Number(row?.count ?? 0), latest: toDateOrNull(row?.latest) };
    },
  };
}
