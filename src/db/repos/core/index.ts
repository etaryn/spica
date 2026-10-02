/**
 * Builds the core data layer on a database handle. Inside `transaction`, every part runs on the
 * same transaction, so a core loop's memory, state and world writes land together or not at all.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { CoreLayer, CoreScope } from "@/mind/platform/core";
import { coreMemoryRepo } from "./memory";
import { coreGoalsRepo } from "./goals";
import { coreStateRepo } from "./state";
import { coreTracesRepo } from "./traces";
import { worldRepo } from "./world";

function scope(db: Db): CoreScope {
  return {
    memory: coreMemoryRepo(db),
    state: coreStateRepo(db),
    goals: coreGoalsRepo(db),
    world: worldRepo(db),
    traces: coreTracesRepo(db),
    async lock(key) {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    },
  };
}

export function createCoreLayer(db: Db): CoreLayer {
  return {
    ...scope(db),
    transaction: (fn) => db.transaction((tx) => fn(scope(tx))),
  };
}
