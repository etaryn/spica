/**
 * Core loop traces: one row per core loop run.
 */
import type { Db } from "@/db/client";
import { core_loop_trace } from "@/db/schema";
import type { CoreTraces } from "@/mind/platform/core";

export function coreTracesRepo(db: Db): CoreTraces {
  return {
    async insert(trace) {
      await db.insert(core_loop_trace).values(trace);
    },
  };
}
