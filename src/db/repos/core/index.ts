/**
 * Builds the core data layer on a database handle. Inside `transaction`, every part runs on the
 * same transaction, so a core loop's memory, state and world writes land together or not at all.
 */
import { eq, sql } from "drizzle-orm";
import { drift_log } from "@/db/schema";
import type { Db } from "@/db/client";
import type { CoreLayer, CoreScope } from "@/mind/platform/core";
import { coreMemoryRepo } from "./memory";
import { coreGoalsRepo } from "./goals";
import { postsRepo } from "./posts";
import { coreStateRepo } from "./state";
import { coreTracesRepo } from "./traces";
import { worldRepo } from "./world";

function scope(db: Db, zone: string): CoreScope {
  return {
    memory: coreMemoryRepo(db, zone),
    state: coreStateRepo(db),
    goals: coreGoalsRepo(db),
    world: worldRepo(db),
    posts: postsRepo(db),
    traces: coreTracesRepo(db),
    drift: {
      async insert(row) {
        await db.insert(drift_log).values(row);
      },
      async forVersion(version) {
        return db
          .select()
          .from(drift_log)
          .where(eq(drift_log.version, version))
          .orderBy(drift_log.created_at, drift_log.id);
      },
    },
    async lock(key) {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    },
  };
}

/** `zone` is her life zone: what she writes is anchored on her calendar. */
export function createCoreLayer(db: Db, zone = "UTC"): CoreLayer {
  return {
    ...scope(db, zone),
    transaction: (fn) => db.transaction((tx) => fn(scope(tx, zone))),
  };
}
