/**
 * The hourly `outreach_tick`: for each user, decides whether she writes first. A cheap unlocked
 * pre-check skips users she can't reach out to, writing no row. Otherwise one `reach_out_log` row
 * records the candidates, the winner and the gate, and a winner through an open gate is
 * scheduled as a `reach_out_send` job, jittered up to `jitter_max_minutes` later.
 */

import { adminListOutreachUsers } from "@/db/repos/admin/relationship";
import { hasPendingScheduled, insertReachOutLog } from "@/db/repos/user/reach-out";
import { getRelationshipRow } from "@/db/repos/user/relationship";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { REACH_OUT_SEND_QUEUE } from "@/mind/platform/jobs";
import { seededUnit } from "@/mind/platform/seeded-random";
import { withTimeout } from "@/mind/platform/timeout";
import { buildCandidates, pickWinner } from "./candidates";
import { evaluateGate } from "./gate";
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

  const candidates = buildCandidates(
    await inputs.loadCandidateInputs(deps, userId, now),
    settings,
    now,
  );
  const winner = pickWinner(candidates);

  const gateInputs = await inputs.loadGateInputs(deps, userId, now);
  if (!gateInputs) return "skipped";
  const gate = evaluateGate(gateInputs, settings, now);

  const status = !winner ? "none" : gate.pass ? "scheduled" : "blocked";
  const sendAt =
    status === "scheduled" ? jitteredSendTime(userId, now, settings.jitter_max_minutes) : null;

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
