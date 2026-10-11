/**
 * The relationship's daily tick, run per user: hurt and tension fade, absence pulls closeness
 * down, baselines learn from yesterday, a pending ending or repair settles, her commitment is
 * reckoned, and the stage settles. The job runs
 * hourly, and each user ticks once per local date, on the first run at or after
 * `tick_local_hour` in their own zone (DST included).
 */
import { adminListRelationshipUsers } from "@/db/repos/admin/relationship";
import * as relationshipRepo from "@/db/repos/user/relationship";
import { getTimezone } from "@/db/repos/user/users";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import {
  isValidTimeZone,
  localDateString,
  localHour,
  previousLocalDate,
} from "@/mind/platform/timezone";
import { detectBigEvents } from "@/mind/process/user/big-events";
import { enqueueUserMindRun, recordBigEvents } from "@/mind/process/user/run";
import { applyCommitment } from "./commitment";
import { newMilestones } from "./milestones";
import { restage } from "./stages";
import { isAbsent, relationshipAfterDailyTick } from "./transitions";
import { DAY } from "@/mind/platform/time";

/** Already ticked on `localDate` or later. */
function alreadyTicked(lastTick: string | null, localDate: string): boolean {
  return lastTick !== null && lastTick >= localDate;
}

/**
 * A cheap unlocked read answers "not due" without taking the row lock; the check is repeated
 * under the lock, because a concurrent run may have just ticked this user.
 */
export async function tickUser(
  deps: Pick<Deps, "db" | "config" | "clock" | "queue" | "log">,
  userId: string,
  now: Date,
): Promise<void> {
  const settings = deps.config.relationship;
  const rawZone = await getTimezone(deps.db, userId);
  const zone = rawZone && isValidTimeZone(rawZone) ? rawZone : "UTC";

  if (localHour(now, zone) < settings.tick_local_hour) return;
  const localDate = localDateString(now, zone);

  const unlocked = await relationshipRepo.getRelationshipRow(deps.db, userId);
  if (!unlocked || alreadyTicked(unlocked.last_tick, localDate)) return;

  const runId = await deps.db.transaction(async (tx) => {
    const row = await relationshipRepo.lockRelationship(tx, userId);
    if (alreadyTicked(row.last_tick, localDate)) return null;

    const params = await relationshipRepo.getParams(tx, userId);
    const cadence = row.cadence as Partial<relationshipRepo.Cadence>;
    const medianGapHours = cadence.median_gap_hours ?? settings.default_median_gap_hours;

    const transition = relationshipAfterDailyTick(
      relationshipRepo.toRelationshipState(row),
      params,
      {
        now,
        localDate,
        yesterdayCount: await relationshipRepo.countUserTurnsOnLocalDate(
          tx,
          userId,
          previousLocalDate(localDate),
          zone,
        ),
        msgs24h: await relationshipRepo.countUserTurnsBetween(
          tx,
          userId,
          new Date(now.getTime() - DAY),
          now,
        ),
        lastContact: row.last_contact,
        medianGapHours,
      },
      settings,
    );

    const history = await relationshipRepo.relationshipHistory(tx, userId);
    const committed = applyCommitment(
      transition.params,
      transition.state.hours_together,
      history,
      settings,
    );
    const staged = restage(
      transition.state,
      {
        params: committed.params,
        hoursTogether: transition.state.hours_together,
        establishedIdiolect: history.idiolect,
        absent: isAbsent(now, row.last_contact, medianGapHours, settings),
      },
      settings.stages,
    );
    const ended = staged.state.status === "ended_by_user";
    const firsts = ended
      ? { all: staged.state.milestones, fired: [] }
      : newMilestones(
          staged.state.milestones,
          {
            peak: staged.state.peak_stage,
            apart: staged.state.apart_stage,
            makeUp: staged.state.make_up_state,
            establishedIdiolect: history.idiolect,
            maxOpenDepth: history.maxOpenDepth,
            disclosureReading: null,
          },
          deps.config.user_mind.triggers.milestone,
        );
    const state = { ...staged.state, milestones: firsts.all };

    await relationshipRepo.saveRelationship(tx, userId, { state, params: committed.params });
    await relationshipRepo.insertRelationshipEvents(
      tx,
      userId,
      [...transition.events, ...committed.events, ...staged.events],
      { turnId: null, now },
    );

    // Params drifting after the user ended it are no event: nothing is happening between them.
    if (ended) return null;
    return recordBigEvents(
      deps,
      tx,
      userId,
      `tick:${localDate}`,
      detectBigEvents({
        before: { params, makeUp: row.make_up_state },
        after: { params: committed.params, makeUp: state.make_up_state },
        newFactSaliences: [],
        settings: deps.config.user_mind.triggers,
        source: "tick",
      }).concat(firsts.fired.map((name) => ({ kind: "milestone" as const, name }))),
    );
  });
  if (runId) await enqueueUserMindRun(deps, runId);
}

/** Every user, each isolated so one failure doesn't stop the rest. Never retried. */
export async function relationshipDailyTick(
  deps: Pick<Deps, "db" | "config" | "clock" | "queue" | "log">,
  now: Date,
): Promise<{ users: number; failed: number }> {
  const users = await adminListRelationshipUsers(deps.db);
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
