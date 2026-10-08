/**
 * Read-only views of the core mind for the inspector. Admin only.
 */
import { count, desc, gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  core_goal,
  core_loop_trace,
  core_memory,
  core_snapshot,
  drift_log,
  life_event_log,
} from "@/db/schema";
import { coreMemoryRepo, toItem } from "@/db/repos/core/memory";
import { coreStateRepo } from "@/db/repos/core/state";

/** Which sections of each snapshot differ from the version before it (v0 compares to nothing). */
function changedSections(rows: { version: number; sections: Record<string, string> }[]) {
  return rows.map((r, i) => {
    const prev = rows[i + 1]; // rows are newest first
    const names = new Set([...Object.keys(r.sections), ...Object.keys(prev?.sections ?? {})]);
    const changed = prev ? [...names].filter((n) => r.sections[n] !== prev.sections[n]) : [];
    return { version: r.version, changed };
  });
}

/**
 * Her state, goals, latest snapshot with what changed lately, memory counts and recent items,
 * today's spend per loop (counted the way the budget counts it), drift findings, loop traces and
 * event attempts.
 */
export async function inspectCore(
  db: Db,
  opts: { limit: number; snapshotVersions: number; dayStart: Date },
) {
  const { limit } = opts;
  const [state, snapshot, snaps, goals, memoryCounts, memories, traces, budget, drift, eventLog] =
    await Promise.all([
      coreStateRepo(db).get(),
      coreMemoryRepo(db).latestSnapshot(),
      db
        .select({
          version: core_snapshot.version,
          sections: core_snapshot.sections,
          rendered_at: core_snapshot.rendered_at,
        })
        .from(core_snapshot)
        .orderBy(desc(core_snapshot.version))
        .limit(opts.snapshotVersions + 1),
      db.select().from(core_goal).orderBy(desc(core_goal.updated_at)),
      db
        .select({ kind: core_memory.kind, status: core_memory.status, n: count() })
        .from(core_memory)
        .groupBy(core_memory.kind, core_memory.status),
      db.select().from(core_memory).orderBy(desc(core_memory.created_at)).limit(limit),
      db.select().from(core_loop_trace).orderBy(desc(core_loop_trace.created_at)).limit(limit),
      db
        .select({
          loop: core_loop_trace.loop,
          status: core_loop_trace.status,
          calls: sql<number>`sum(${core_loop_trace.calls})::int`,
        })
        .from(core_loop_trace)
        .where(gte(core_loop_trace.created_at, opts.dayStart))
        .groupBy(core_loop_trace.loop, core_loop_trace.status),
      db.select().from(drift_log).orderBy(desc(drift_log.created_at)).limit(limit),
      db.select().from(life_event_log).orderBy(desc(life_event_log.created_at)).limit(limit),
    ]);
  const snapshots = changedSections(snaps)
    .slice(0, opts.snapshotVersions)
    .map((s, i) => ({ ...s, rendered_at: snaps[i]!.rendered_at }));
  return {
    state,
    snapshot,
    snapshots,
    goals: goals.map(({ embedding: _e, ...g }) => g),
    memoryCounts,
    memories: memories.map((m) => {
      const payload = (m.payload ?? {}) as { gist_of?: unknown; gisted_into?: unknown };
      const links = {
        superseded_by: m.superseded_by ?? undefined,
        gist_of: payload.gist_of,
        gisted_into: payload.gisted_into,
      };
      const linked = Object.values(links).some((x) => x !== undefined);
      return { ...toItem(m), links: linked ? links : null };
    }),
    traces,
    budget,
    drift,
    eventLog,
  };
}
