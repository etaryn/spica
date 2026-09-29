import { sql } from "drizzle-orm";
import * as factsRepo from "@/db/repos/facts";
import { adminListLifeUsers, ensureIdentity, getIdentityRow, lockIdentity, updateIdentity, type IdentityRow } from "@/db/repos/identity";
import { getLifeDay } from "@/db/repos/life-day";
import type { Deps } from "../deps";
import { errorName } from "../errors";
import { prepareBlockFacts } from "./blocks";
import { lifeDate, lifeHour } from "./clock";

export type InjectedEvent = { content: string; valence: number };
/** Eval seam (design §9.3): force a scripted candidate as a day's first event attempt. */
export type LifeTickOptions = { inject?: (userId: string, day: string) => InjectedEvent | null };

const due = (row: IdentityRow | null, day: string) => !row?.life_last_date || row.life_last_date < day;

/**
 * `life_tick` for one user (design §6.1): once per her local date, at or after `life.tick_local_hour` in her
 * zone. Generation runs outside the transaction; the apply holds the cold path's per-user advisory lock and the
 * identity row lock, re-checks, and writes `life_last_date` last, so a failure rolls back everything.
 */
export async function lifeTickUser(deps: Deps, userId: string, now: Date, _opts: LifeTickOptions = {}): Promise<"not_due" | "done"> {
  const cfg = deps.config.life;
  if (lifeHour(cfg, now) < cfg.tick_local_hour) return "not_due";
  const day = lifeDate(cfg, now);
  if (!due(await getIdentityRow(deps.db, userId), day)) return "not_due";

  const lifeDay = await getLifeDay(deps.db, day);
  const blockFacts = lifeDay ? await prepareBlockFacts(deps, day, lifeDay.plan, now) : [];

  await deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cold_path:${userId}`}))`);
    await ensureIdentity(tx, userId, deps.config.ego.baseline);
    const row = await lockIdentity(tx, userId);
    if (!due(row, day)) return; // a concurrent run already ticked this date
    for (const f of blockFacts) await factsRepo.insertFact(tx, userId, f);
    await updateIdentity(tx, userId, { life_last_date: day });
  });
  return "done";
}

export async function lifeTick(deps: Deps, now: Date, opts: LifeTickOptions = {}): Promise<{ users: number; failed: number }> {
  const users = await adminListLifeUsers(deps.db);
  let failed = 0;
  for (const userId of users) {
    try {
      await lifeTickUser(deps, userId, now, opts);
    } catch (e) {
      failed += 1;
      deps.log.error("life tick failed", { userId, error: errorName(e) });
    }
  }
  deps.log.info("life tick", { users: users.length, failed });
  return { users: users.length, failed };
}
