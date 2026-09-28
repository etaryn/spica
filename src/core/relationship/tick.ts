import * as rel from "@/db/repos/relationship";
import { getTimezone } from "@/db/repos/users";
import type { Deps } from "../deps";
import { isValidTimeZone, localDateString, previousLocalDate } from "../timezone";
import { applyTick } from "./transitions";

const DAY = 86_400_000;
const errName = (e: unknown) => (e instanceof Error ? e.constructor.name : "UnknownError");

export async function tickUser(deps: Pick<Deps, "db" | "config">, userId: string, now: Date): Promise<void> {
  const cfg = deps.config.relationship;
  await deps.db.transaction(async (tx) => {
    const row = await rel.lockRelationship(tx, userId);
    const params = await rel.getParams(tx, userId);
    const tzRaw = await getTimezone(tx, userId);
    const tz = tzRaw && isValidTimeZone(tzRaw) ? tzRaw : "UTC";
    const localDate = localDateString(now, tz);
    if (row.last_tick === localDate) return;
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

/** Daily tick over every user (design §8.1); per-user isolation, never retried. */
export async function relationshipTick(deps: Pick<Deps, "db" | "config" | "log">, now: Date): Promise<{ users: number; failed: number }> {
  const users = await rel.adminListRelationshipUsers(deps.db);
  let failed = 0;
  for (const userId of users) {
    try {
      await tickUser(deps, userId, now);
    } catch (e) {
      failed += 1;
      deps.log.error("relationship tick failed", { userId, error: errName(e) });
    }
  }
  deps.log.info("relationship tick", { users: users.length, failed });
  return { users: users.length, failed };
}
