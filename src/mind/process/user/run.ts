/**
 * Her user mind, run on a big event: recording the run with the exchange that caused it, running
 * its batch of loops once, and re-queueing runs whose job was lost. The batch reads this user's
 * memory and state and her latest snapshot, and writes this user's memory only.
 */
import type { Db } from "@/db/client";
import { adminStalePendingRuns } from "@/db/repos/admin/user-mind";
import {
  claimRun,
  finishRun,
  insertRun,
  userLocalDate,
  type Trigger,
} from "@/db/repos/user/user-mind";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { USER_MIND_RUN_QUEUE, type UserMindRunJob } from "@/mind/platform/jobs";
import { MINUTE } from "@/mind/platform/time";
import { loadRunInputs } from "./inputs";
import { userSummarise } from "./summarise";

export async function recordBigEvents(
  deps: Pick<Deps, "config" | "clock">,
  db: Db,
  userId: string,
  sourceRef: string,
  triggers: Trigger[],
): Promise<string | null> {
  if (triggers.length === 0) return null;
  const now = deps.clock.now();
  const row = await insertRun(db, userId, {
    sourceRef,
    triggers,
    localDate: await userLocalDate(db, userId, now),
    now,
    cap: deps.config.user_mind.max_triggers_per_day,
  });
  return row?.status === "pending" ? row.id : null;
}

/** After the run's row has committed. A lost enqueue is picked up by the sweep. */
export async function enqueueUserMindRun(
  deps: Pick<Deps, "queue" | "log">,
  runId: string,
): Promise<void> {
  try {
    await deps.queue.enqueue(USER_MIND_RUN_QUEUE, { runId });
  } catch (e) {
    deps.log.error("user_mind_run enqueue failed", { runId, error: errorName(e) });
  }
}

export async function runUserMind(
  deps: Deps,
  job: UserMindRunJob,
): Promise<"done" | "failed" | "skipped"> {
  // ponytail: only a process death leaves a run 'running', and it is never retried; reclaim stale
  // running rows if crashes matter
  const run = await claimRun(deps.db, job.runId);
  if (!run) return "skipped";
  const { db, embedder, config, clock, log, llm } = deps;
  let status: "done" | "failed";
  try {
    const snapshot = (await deps.core.memory.latestSnapshot())?.content ?? null;
    const loopDeps = { db, embedder, config, clock, log, llm, snapshot };
    status = await userSummarise(loopDeps, run, await loadRunInputs(deps, run.user_id));
  } catch (e) {
    // Failed, not thrown: a retry would spend the run again, and the job never retries.
    log.error("user_mind_run failed", { runId: run.id, error: errorName(e) });
    status = "failed";
  }
  await finishRun(deps.db, run.id, status, clock.now());
  return status;
}

export async function sweepPendingUserMindRuns(
  deps: Pick<Deps, "db" | "queue" | "config" | "log">,
  now: Date,
): Promise<number> {
  const olderThan = new Date(now.getTime() - deps.config.user_mind.sweep_after_minutes * MINUTE);
  const runs = await adminStalePendingRuns(deps.db, olderThan, deps.config.cold_path.sweep_batch);
  for (const run of runs) await enqueueUserMindRun(deps, run.id);
  if (runs.length > 0) deps.log.info("user_mind_run sweep enqueued", { count: runs.length });
  return runs.length;
}
