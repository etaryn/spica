/**
 * The hourly `outreach_tick`: for each user, decides whether she writes first. A cheap unlocked
 * pre-check skips users she can't reach out to, writing no row. Otherwise one `reach_out_log` row
 * records the candidates, the winner and the gate, and a winner through an open gate is
 * scheduled as a `reach_out_send` job, jittered up to `jitter_max_minutes` later. A reach-out
 * about to go out on an old picture of them first records a user mind run, and the send waits a
 * few minutes for it.
 */

import { adminListOutreachUsers } from "@/db/repos/admin/relationship";
import { hasPendingScheduled, insertReachOutLog } from "@/db/repos/user/reach-out";
import { getRelationshipRow } from "@/db/repos/user/relationship";
import { liveSummary } from "@/db/repos/user/user-mind";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { REACH_OUT_SEND_QUEUE } from "@/mind/platform/jobs";
import { seededUnit } from "@/mind/platform/seeded-random";
import { withTimeout } from "@/mind/platform/timeout";
import { enqueueUserMindRun, recordBigEvents } from "@/mind/process/user/run";
import { buildCandidates, holdLastSlot, pickWinner } from "./candidates";
import { evaluateGate, sentWithin, WEEK_HOURS } from "./gate";
import * as inputs from "./inputs";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type TickOutcome = "skipped" | "none" | "blocked" | "scheduled";

export async function outreachTickUser(
  deps: Deps,
  userId: string,
  now: Date,
): Promise<TickOutcome> {
  const { db, config } = deps;
  const settings = config.outreach;

  if (!(await canReachOut(deps, userId, now))) return "skipped";

  const gateInputs = await inputs.loadGateInputs(deps, userId, now);
  if (!gateInputs) return "skipped";
  const candidates = holdLastSlot(
    buildCandidates(await inputs.loadCandidateInputs(deps, userId, now), settings, now),
    sentWithin(gateInputs.sentAt, now, WEEK_HOURS),
    settings,
  );
  const winner = pickWinner(candidates);
  const gate = evaluateGate(gateInputs, settings, now);

  const status = !winner ? "none" : gate.pass ? "scheduled" : "blocked";
  const sendAt =
    status === "scheduled"
      ? await afterStaleSummary(
          deps,
          userId,
          now,
          jitteredSendTime(userId, now, settings.jitter_max_minutes),
        )
      : null;

  const logId = await insertReachOutLog(db, userId, {
    candidates,
    winner,
    gate_results: gate.results,
    status,
    topic: winner?.topic ?? null,
    send_at: sendAt,
    created_at: now,
  });

  if (sendAt) {
    // A lost enqueue leaves a `scheduled` row that goes stale after pending_max_age_minutes, and
    // the next tick moves on.
    await withTimeout(
      deps.queue.enqueue(REACH_OUT_SEND_QUEUE, { userId, logId }, { startAfter: sendAt }),
      config.queue.enqueue_timeout_ms,
    ).catch((e) =>
      deps.log.error("reach_out_send enqueue failed", { userId, error: errorName(e) }),
    );
  }
  return status;
}

/** Not ended, under the unanswered limit, outside a crisis window, nothing already pending. */
async function canReachOut(deps: Deps, userId: string, now: Date): Promise<boolean> {
  const settings = deps.config.outreach;
  if (!settings.enabled) return false;

  const relationship = await getRelationshipRow(deps.db, userId);
  if (!relationship || relationship.status === "ended_by_user") return false;
  if (relationship.unanswered_reach_outs >= settings.max_unanswered) return false;

  const quietUntil = await inputs.effectiveCrisisQuietUntil(
    deps,
    userId,
    relationship.crisis_quiet_until,
    now,
  );
  if (quietUntil && quietUntil > now) return false;

  const pendingSince = new Date(now.getTime() - settings.pending_max_age_minutes * MINUTE);
  return !(await hasPendingScheduled(deps.db, userId, pendingSince));
}

/**
 * When her summary of them is missing or old, she takes stock before writing: a user mind run is
 * recorded, and the send moves to at least `lead_minutes` out so the run can finish first. A
 * capped or repeated run (a retried tick) changes nothing, so the send keeps its jittered time; a
 * slow run means the reach-out uses the old summary.
 */
async function afterStaleSummary(
  deps: Deps,
  userId: string,
  now: Date,
  sendAt: Date,
): Promise<Date> {
  const settings = deps.config.user_mind.triggers.stale_summary;
  const summary = await liveSummary(deps.db, userId);
  const ageHours = summary ? (now.getTime() - summary.created_at.getTime()) / HOUR : null;
  if (ageHours !== null && ageHours < settings.max_age_hours) return sendAt;
  const runId = await recordBigEvents(deps, deps.db, userId, `stale_summary:${now.toISOString()}`, [
    { kind: "stale_summary", age_hours: ageHours === null ? null : Math.round(ageHours) },
  ]);
  if (!runId) return sendAt;
  await enqueueUserMindRun(deps, runId);
  const earliest = new Date(now.getTime() + settings.lead_minutes * MINUTE);
  return sendAt > earliest ? sendAt : earliest;
}

/** Deterministic per user and hour, so a retried tick picks the same time. */
function jitteredSendTime(userId: string, now: Date, jitterMaxMinutes: number): Date {
  const hour = new Date(Math.floor(now.getTime() / HOUR) * HOUR).toISOString();
  const jitterMs = Math.floor(seededUnit(`${userId}:${hour}`) * jitterMaxMinutes * MINUTE);
  return new Date(now.getTime() + jitterMs);
}

export async function outreachTick(
  deps: Deps,
  now: Date,
): Promise<{ users: number; failed: number; scheduled: number }> {
  // Active or repairing: an ended friendship never hears from her first.
  const users = await adminListOutreachUsers(deps.db);
  let failed = 0;
  let scheduled = 0;

  for (const userId of users) {
    try {
      if ((await outreachTickUser(deps, userId, now)) === "scheduled") scheduled += 1;
    } catch (e) {
      failed += 1;
      deps.log.error("outreach tick failed", { userId, error: errorName(e) });
    }
  }

  deps.log.info("outreach tick", { users: users.length, failed, scheduled });
  return { users: users.length, failed, scheduled };
}
