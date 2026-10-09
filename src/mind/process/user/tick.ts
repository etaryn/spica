/**
 * The hourly `user_mind_tick`: the big events no single exchange shows. A long conversation that
 * has gone quiet, and a crisis whose quiet window has ended. Each is recorded once (its source
 * names the session or the window's end), and runs whose job was lost are re-queued.
 */
import { adminCrisisEndedUsers, adminEndedLongSessions } from "@/db/repos/admin/user-mind";
import { getRelationshipRow } from "@/db/repos/user/relationship";
import type { Trigger } from "@/db/repos/user/user-mind";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { HOUR, MINUTE } from "@/mind/platform/time";
import { effectiveCrisisQuietUntil } from "@/mind/process/outreach/inputs";
import { enqueueUserMindRun, recordBigEvents, sweepPendingUserMindRuns } from "./run";

export async function userMindTick(
  deps: Deps,
  now: Date,
): Promise<{ recorded: number; failed: number }> {
  const { db, config, log } = deps;
  const settings = config.user_mind;
  const since = new Date(now.getTime() - settings.tick.lookback_hours * HOUR);
  let recorded = 0;
  let failed = 0;
  const each = async (userId: string, step: () => Promise<boolean>) => {
    try {
      if (await step()) recorded++;
    } catch (e) {
      failed++;
      log.error("user_mind_tick user failed", { userId, error: errorName(e) });
    }
  };

  const long = settings.triggers.long_conversation;
  const sessions = await adminEndedLongSessions(db, {
    endedAfter: since,
    endedBefore: new Date(now.getTime() - long.quiet_minutes * MINUTE),
    minUserTurns: long.min_user_turns,
    limit: config.cold_path.sweep_batch,
  });
  for (const s of sessions)
    await each(s.user_id, async () => {
      const rel = await getRelationshipRow(db, s.user_id);
      if (!rel || rel.status === "ended_by_user") return false;
      // A talk the crisis window covers waits for `crisis_passed`, which runs once for both:
      // inside a crisis every mechanism waits, and two runs would spend the day's cap twice.
      const quietUntil = await effectiveCrisisQuietUntil(
        deps,
        s.user_id,
        rel.crisis_quiet_until,
        now,
      );
      if (quietUntil && quietUntil >= s.ended_at) return false;
      return record(deps, s.user_id, `long_conversation:${s.session_id}`, [
        { kind: "long_conversation", session_id: s.session_id, user_turns: s.user_turns },
      ]);
    });

  const crises = await adminCrisisEndedUsers(db, {
    after: since,
    until: now,
    limit: config.cold_path.sweep_batch,
  });
  for (const c of crises)
    await each(c.user_id, async () => {
      const rel = await getRelationshipRow(db, c.user_id);
      if (!rel || rel.status === "ended_by_user") return false;
      // A later crisis turn whose cold path hasn't committed still holds the window; its own
      // stored end fires once that commits.
      const quietUntil = await effectiveCrisisQuietUntil(
        deps,
        c.user_id,
        rel.crisis_quiet_until,
        now,
      );
      if (quietUntil && quietUntil > now) return false;
      return record(deps, c.user_id, `crisis_passed:${c.crisis_quiet_until.toISOString()}`, [
        { kind: "crisis_passed" },
      ]);
    });

  await sweepPendingUserMindRuns(deps, now);
  return { recorded, failed };
}

/** True when a new pending run was recorded (not a repeat, not capped). */
async function record(deps: Deps, userId: string, sourceRef: string, triggers: Trigger[]) {
  const runId = await recordBigEvents(deps, deps.db, userId, sourceRef, triggers);
  if (runId) await enqueueUserMindRun(deps, runId);
  return runId !== null;
}
