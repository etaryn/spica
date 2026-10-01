import { adminListLifeUsers } from "@/db/repos/identity";
import { hasPendingScheduled, insertReachOutLog } from "@/db/repos/reach-out";
import { getRelationshipRow } from "@/db/repos/relationship";
import type { Deps } from "../deps";
import { errorName } from "../errors";
import { REACH_OUT_SEND_QUEUE } from "../queue";
import { withTimeout } from "../timeout";
import { seededUnit } from "../turn/pacing";
import { buildCandidates, pickWinner } from "./candidates";
import { evaluateGate } from "./gate";
import * as inputs from "./inputs";

const MIN = 60_000;

/**
 * `outreach_tick` for one user. A cheap unlocked pre-check skips users who can't be reached out to
 * (no row written); otherwise one `reach_out_log` row records candidates, winner and gate, and a winner through
 * an open gate is scheduled `seededUnit × jitter_max_minutes` later as a `reach_out_send` job.
 */
export async function outreachTickUser(
  deps: Deps,
  userId: string,
  now: Date,
): Promise<"skipped" | "none" | "blocked" | "scheduled"> {
  const { db, config } = deps;
  const cfg = config.outreach;
  if (!cfg.enabled) return "skipped";
  const row = await getRelationshipRow(db, userId);
  if (!row || row.status === "ended_by_user" || row.unanswered_reach_outs >= cfg.max_unanswered)
    return "skipped";
  const quiet = await inputs.effectiveCrisisQuietUntil(deps, userId, row.crisis_quiet_until, now); // rule 7, as the gate
  if (quiet && quiet > now) return "skipped";
  if (
    await hasPendingScheduled(
      db,
      userId,
      new Date(now.getTime() - cfg.pending_max_age_minutes * MIN),
    )
  )
    return "skipped";

  const cands = buildCandidates(await inputs.loadCandidateInputs(deps, userId, now), cfg, now);
  const winner = pickWinner(cands);
  const gateIn = await inputs.loadGateInputs(deps, userId, now);
  if (!gateIn) return "skipped";
  const gate = evaluateGate(gateIn, cfg, now);
  const status = !winner ? "none" : gate.pass ? "scheduled" : "blocked";
  const hour = new Date(Math.floor(now.getTime() / (60 * MIN)) * 60 * MIN).toISOString();
  const sendAt =
    status === "scheduled"
      ? new Date(
          now.getTime() +
            Math.floor(seededUnit(`${userId}:${hour}`) * cfg.jitter_max_minutes * MIN),
        )
      : null;
  const logId = await insertReachOutLog(db, userId, {
    candidates: cands,
    winner,
    gate_results: gate.results,
    status,
    topic: winner?.topic ?? null,
    send_at: sendAt,
    created_at: now,
  });
  if (status === "scheduled") {
    // A lost enqueue leaves a `scheduled` row that goes stale after pending_max_age_minutes; the next tick moves on.
    await withTimeout(
      deps.queue.enqueue(REACH_OUT_SEND_QUEUE, { userId, logId }, { startAfter: sendAt! }),
      config.queue.enqueue_timeout_ms,
    ).catch((e) =>
      deps.log.error("reach_out_send enqueue failed", { userId, error: errorName(e) }),
    );
  }
  return status;
}

export async function outreachTick(
  deps: Deps,
  now: Date,
): Promise<{ users: number; failed: number; scheduled: number }> {
  const users = await adminListLifeUsers(deps.db); // active or repairing, same population as the life tick
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
