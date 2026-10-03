/** Core loop traces: one row per core loop run, and what today's budget has spent. */
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_loop_trace } from "@/db/schema";
import type { CoreTraces } from "@/mind/platform/core";
import { toDateOrNull } from "../util";

export function coreTracesRepo(db: Db): CoreTraces {
  return {
    async latestDone(loop, before) {
      const [row] = await db
        .select({ at: core_loop_trace.created_at, outputs: core_loop_trace.outputs })
        .from(core_loop_trace)
        .where(
          and(
            eq(core_loop_trace.loop, loop),
            eq(core_loop_trace.status, "done"),
            lt(core_loop_trace.created_at, before),
          ),
        )
        .orderBy(desc(core_loop_trace.created_at), desc(core_loop_trace.id))
        .limit(1);
      if (!row) return null;
      const output = row.outputs;
      const cursor =
        output && typeof output === "object" && !Array.isArray(output)
          ? (output as Record<string, unknown>).cursor
          : null;
      if (cursor && typeof cursor === "object" && !Array.isArray(cursor)) {
        const { at, id } = cursor as Record<string, unknown>;
        if (typeof at === "string" && (id === null || typeof id === "string")) {
          const parsed = new Date(at);
          if (Number.isFinite(parsed.getTime())) return { at: parsed, id };
        }
      }
      return { at: row.at, id: null };
    },
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
