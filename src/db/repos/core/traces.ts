/** Core loop traces: one row per core loop run, and what today's budget has spent. */
import { gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_loop_trace } from "@/db/schema";
import type { CoreTraces } from "@/mind/platform/core";

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
  };
}
