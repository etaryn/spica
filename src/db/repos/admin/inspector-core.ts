/**
 * Read-only views of the core mind for the inspector. Admin only.
 */
import { desc } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_loop_trace, core_memory, life_event_log } from "@/db/schema";
import { coreMemoryRepo, toItem } from "@/db/repos/core/memory";
import { coreStateRepo } from "@/db/repos/core/state";

/** Her state, latest snapshot and the most recent memories, loop traces and event attempts. */
export async function inspectCore(db: Db, limit: number) {
  const [state, snapshot, memories, traces, eventLog] = await Promise.all([
    coreStateRepo(db).get(),
    coreMemoryRepo(db).latestSnapshot(),
    db.select().from(core_memory).orderBy(desc(core_memory.created_at)).limit(limit),
    db.select().from(core_loop_trace).orderBy(desc(core_loop_trace.created_at)).limit(limit),
    db.select().from(life_event_log).orderBy(desc(life_event_log.created_at)).limit(limit),
  ]);
  return { state, snapshot, memories: memories.map(toItem), traces, eventLog };
}
