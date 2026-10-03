/** Core loop traces: one row per core loop run, and what today's budget has spent. */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_loop_trace } from "@/db/schema";
import type { CoreTraces } from "@/mind/platform/core";
import { toDateOrNull } from "../util";

export function coreTracesRepo(db: Db): CoreTraces {
  return {
    async insert(trace) {
      await db.insert(core_loop_trace).values(trace);
    },
    async callsSince(from) {
      const [row] = await db
        .select({ n: sql<number>`COALESCE(sum(${core_loop_trace.calls}), 0)::int` })
        .from(core_loop_trace)
        .where(gte(core_loop_trace.created_at, from));
      return Number(row?.n ?? 0);
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
