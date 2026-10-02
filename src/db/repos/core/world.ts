/**
 * Her world in Postgres: the shared day plan, the events that happened and the generator's attempts.
 */
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { life_event_log, world_event } from "@/db/schema";
import type { NewLifeDay, World, WorldEventRow } from "@/mind/world/types";
import { one } from "../util";
import { getLifeDay, insertLifeDay, listLifeDaysBefore } from "../world/life-day";

function toRow(r: typeof world_event.$inferSelect): WorldEventRow {
  return {
    id: r.id,
    at: r.at,
    kind: r.kind,
    content: r.content,
    valence: r.valence,
    stakes: r.stakes,
    agents: r.agents,
    agent_names: r.agent_names,
    life_day: r.life_day,
    created_at: r.created_at,
    appraised_at: r.appraised_at,
    goal_ref: r.goal_ref,
    plan_ref: r.plan_ref,
    outcome: r.outcome,
    fallthrough: r.fallthrough,
    resolves_memory_id: r.resolves_memory_id,
  };
}

export function worldRepo(db: Db): World {
  return {
    async plan(day) {
      return (await getLifeDay(db, day))?.plan ?? null;
    },

    async plansBefore(day, limit) {
      return (await listLifeDaysBefore(db, day, limit)).map((r) => ({
        date: r.date,
        plan: r.plan,
      }));
    },

    async insertPlan(row: NewLifeDay) {
      return insertLifeDay(db, row);
    },

    async events(day) {
      const rows = await db
        .select()
        .from(world_event)
        .where(eq(world_event.life_day, day))
        .orderBy(world_event.at);
      return rows.map(toRow);
    },

    async recordEvent(event) {
      return one(await db.insert(world_event).values(event).returning({ id: world_event.id })).id;
    },

    async getEvent(id) {
      const [row] = await db.select().from(world_event).where(eq(world_event.id, id));
      return row ? toRow(row) : null;
    },

    async setOutcome(id, outcome) {
      await db.update(world_event).set({ outcome }).where(eq(world_event.id, id));
    },

    async dueUnappraised(now) {
      const rows = await db
        .select()
        .from(world_event)
        .where(and(isNull(world_event.appraised_at), lte(world_event.at, now)))
        .orderBy(asc(world_event.at));
      return rows.map(toRow);
    },

    async markAppraised(id, at) {
      await db.update(world_event).set({ appraised_at: at }).where(eq(world_event.id, id));
    },

    async setAgents(id, agents) {
      await db.update(world_event).set({ agents }).where(eq(world_event.id, id));
    },

    async setGoalRef(id, goalId) {
      await db.update(world_event).set({ goal_ref: goalId }).where(eq(world_event.id, id));
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
