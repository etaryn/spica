import * as rel from "@/db/repos/relationship";
import { getTimezone } from "@/db/repos/users";
import type { Deps } from "../deps";
import { errorName } from "../errors";
import { isValidTimeZone, localDateString, localHour, previousLocalDate } from "../timezone";
import { applyTick } from "./transitions";

const DAY = 86_400_000;

/** Not yet due for `localDate`'s tick: before `tick_local_hour` local, or already ticked today or later. */
const notDue = (lastTick: string | null, localDate: string) => lastTick !== null && lastTick >= localDate;

/**
 * The hourly cron (`relationship.tick_cron`) calls this once per user per run; it ticks a user only on the
 * first run at or after `tick_local_hour` local on a local date they haven't ticked yet, so
 * every local date gets exactly one tick, DST included. A cheap unlocked pre-check (read, not `for update`)
 * answers "not due" without ever taking the row lock; the semantics of the tick itself (what a tick on
 * local date D samples and processes) are unchanged from the daily-cron version.
 */
export async function tickUser(deps: Pick<Deps, "db" | "config">, userId: string, now: Date): Promise<void> {
  const cfg = deps.config.relationship;
  const tzRaw = await getTimezone(deps.db, userId);
  const tz = tzRaw && isValidTimeZone(tzRaw) ? tzRaw : "UTC";
  if (localHour(now, tz) < cfg.tick_local_hour) return;
  const localDate = localDateString(now, tz);
  const pre = await rel.getRelationshipRow(deps.db, userId);
  if (!pre || notDue(pre.last_tick, localDate)) return;
  await deps.db.transaction(async (tx) => {
    const row = await rel.lockRelationship(tx, userId);
    if (notDue(row.last_tick, localDate)) return; // re-checked under the lock: a concurrent run may have just ticked it
    const params = await rel.getParams(tx, userId);
    const cadence = row.cadence as Partial<rel.Cadence>;
    const t = applyTick(rel.toRelState(row), params, {
      now, localDate,
      yesterdayCount: await rel.countUserTurnsOnLocalDate(tx, userId, previousLocalDate(localDate), tz),
      msgs24h: await rel.countUserTurnsBetween(tx, userId, new Date(now.getTime() - DAY), now),
      lastContact: row.last_contact,
      medianGapHours: cadence.median_gap_hours ?? cfg.default_median_gap_hours,
    }, cfg);
    await rel.saveRelationship(tx, userId, { state: t.state, params: t.params });
    await rel.insertRelationshipEvents(tx, userId, t.events, { turnId: null, now });
  });
}

/** Daily tick over every user; per-user isolation, never retried. */
export async function relationshipTick(deps: Pick<Deps, "db" | "config" | "log">, now: Date): Promise<{ users: number; failed: number }> {
  const users = await rel.adminListRelationshipUsers(deps.db);
  let failed = 0;
  for (const userId of users) {
    try {
      await tickUser(deps, userId, now);
    } catch (e) {
      failed += 1;
      deps.log.error("relationship tick failed", { userId, error: errorName(e) });
    }
  }
  deps.log.info("relationship tick", { users: users.length, failed });
  return { users: users.length, failed };
}
