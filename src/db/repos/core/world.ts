/**
 * Her world in Postgres: the shared day plan, the events that happened and the generator's attempts.
 */
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { life_event_log, world_event } from "@/db/schema";
import type { World } from "@/mind/world/types";
import { one } from "../util";
import { getLifeDay } from "../world/life-day";

export function worldRepo(db: Db): World {
  return {
    async plan(day) {
      return (await getLifeDay(db, day))?.plan ?? null;
    },

    async events(day) {
      const rows = await db
        .select()
        .from(world_event)
        .where(eq(world_event.life_day, day))
        .orderBy(world_event.at);
      return rows.map((r) => ({
        id: r.id,
        at: r.at,
        kind: r.kind,
        content: r.content,
        valence: r.valence,
        stakes: r.stakes,
        agents: r.agents,
        life_day: r.life_day,
        created_at: r.created_at,
      }));
    },

    async recordEvent(event) {
      return one(await db.insert(world_event).values(event).returning({ id: world_event.id })).id;
    },

    async lastHighStakesAt() {
      const row = (
        await db
          .select({ at: world_event.created_at })
          .from(world_event)
          .where(eq(world_event.stakes, "high"))
          .orderBy(desc(world_event.created_at))
          .limit(1)
      )[0];
      return row?.at ?? null;
    },

    async logEventAttempts(attempts) {
      if (attempts.length) await db.insert(life_event_log).values(attempts);
    },
  };
}
