import {
  adminListLifeUsers,
  ensureIdentity,
  getIdentityRow,
  insertEgoTick,
  lockIdentity,
  updateIdentity,
} from "@/db/repos/identity";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { listLifeBlocks } from "@/mind/world/legacy-life-tick/blocks";
import { lifeDate, lifeHour, lifeTimezone } from "@/mind/world/her-clock";
import { HOUR } from "@/mind/platform/time";
import { localMidnight } from "@/mind/platform/timezone";
import { seededUnit } from "@/mind/platform/seeded-random";
import {
  dayLoad,
  driftStep,
  energyTarget,
  preoccupationExpired,
  stateOf,
  type EgoState,
} from "./ego";

const sameHour = (a: Date | null, b: Date) =>
  !!a && Math.floor(a.getTime() / HOUR) === Math.floor(b.getTime() / HOUR);

/** `ego_tick` for one user: one drift step per UTC hour; missed hours aren't caught up. */
export async function egoTickUser(
  deps: Pick<Deps, "db" | "config">,
  userId: string,
  now: Date,
): Promise<"not_due" | "done"> {
  const { db, config } = deps;
  const cfg = config.ego;
  if (sameHour((await getIdentityRow(db, userId))?.last_tick ?? null, now)) return "not_due";
  const day = lifeDate(config.life, now);
  const blocks = await listLifeBlocks(db, userId, day);
  const load = dayLoad(blocks, localMidnight(day, lifeTimezone(config.life, now)), now, cfg);
  const hourIso = new Date(Math.floor(now.getTime() / HOUR) * HOUR).toISOString();
  const noise = (["v", "a", "e"] as const).map(
    (d) => seededUnit(`${userId}:${hourIso}:${d}`) * 2 - 1,
  ) as [number, number, number];
  let result: "not_due" | "done" = "done";
  await db.transaction(async (tx) => {
    await ensureIdentity(tx, userId, cfg.baseline);
    const row = await lockIdentity(tx, userId);
    if (sameHour(row.last_tick, now)) {
      result = "not_due";
      return;
    }
    const base = row.baseline as EgoState;
    const target = {
      mood_valence: base.mood_valence,
      mood_arousal: base.mood_arousal,
      energy: energyTarget(base, lifeHour(config.life, now), load, cfg),
    };
    const next = driftStep(stateOf(row), target, noise, cfg);
    const clear = preoccupationExpired(row.preoccupation_since, now, cfg);
    await updateIdentity(tx, userId, {
      ...next,
      last_tick: now,
      ...(clear ? { preoccupation: null, preoccupation_since: null } : {}),
    });
    await insertEgoTick(tx, userId, {
      ...next,
      preoccupation: clear ? null : row.preoccupation,
      reason: "tick",
      created_at: now,
    });
  });
  return result;
}

export async function egoTick(
  deps: Pick<Deps, "db" | "config" | "log">,
  now: Date,
): Promise<{ users: number; failed: number }> {
  const users = await adminListLifeUsers(deps.db);
  let failed = 0;
  for (const userId of users) {
    try {
      await egoTickUser(deps, userId, now);
    } catch (e) {
      failed += 1;
      deps.log.error("ego tick failed", { userId, error: errorName(e) });
    }
  }
  return { users: users.length, failed };
}
