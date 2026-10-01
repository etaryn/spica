import type { SimClock } from "@/core/clock";
import { handleColdPath } from "@/core/cold-path";
import type { Deps } from "@/core/deps";
import { runReachOutSend } from "@/core/outreach/send";
import { COLD_PATH_QUEUE, REACH_OUT_SEND_QUEUE, TURN_BACKCHANNEL_QUEUE, TURN_TIMER_QUEUE, type QueuedJob, type RecordingQueue } from "@/core/queue";
import { runBackchannel, runTurnTimer } from "@/core/turn/reply";

/** Jobs run on simulated time: turn timers, backchannels and reach-out sends. */
const isTurnJob = (j: QueuedJob) => j.name === TURN_TIMER_QUEUE || j.name === TURN_BACKCHANNEL_QUEUE || j.name === REACH_OUT_SEND_QUEUE;
const due = (j: QueuedJob, now: number) => (j.startAfter?.getTime() ?? now);

async function drainColdPath(deps: Deps, queue: RecordingQueue): Promise<void> {
  for (const job of queue.drain((j) => j.name === COLD_PATH_QUEUE)) {
    if (job.name !== COLD_PATH_QUEUE) continue;
    // pg-boss retries a failed cold_path job up to cold_path.retry_limit times; do the same here.
    for (let attempt = 0; ; attempt++) {
      try { await handleColdPath(deps, job.data); break; } catch (e) { if (attempt >= deps.config.cold_path.retry_limit) throw e; }
    }
  }
}

/**
 * Runs queued turn jobs due at or before `until`, earliest first, advancing the simulated clock to each job's
 * startAfter (never backwards). Pacing sleeps inside a job advance the clock too, so a message scheduled
 * during a paced reply arrives after it (it then follows up, as in production). Cold-path jobs drain after each.
 */
export async function runDueJobs(deps: Deps, queue: RecordingQueue, clock: SimClock, until: Date): Promise<void> {
  for (let guard = 0; guard < 1000; guard++) {
    await drainColdPath(deps, queue);
    const now = clock.now().getTime();
    const next = queue.jobs.filter(isTurnJob).sort((a, b) => due(a, now) - due(b, now))[0];
    if (!next || due(next, now) > until.getTime()) return;
    queue.drain((j) => j === next);
    if (due(next, now) > now) clock.set(new Date(due(next, now)));
    if (next.name === TURN_TIMER_QUEUE) await runTurnTimer(deps, next.data);
    else if (next.name === TURN_BACKCHANNEL_QUEUE) await runBackchannel(deps, next.data);
    else if (next.name === REACH_OUT_SEND_QUEUE) await runReachOutSend(deps, next.data);
  }
  throw new Error("runDueJobs: too many jobs (a timer keeps rescheduling itself)");
}

/** Runs every pending turn job, however far in the future (end of a session). */
export async function runAllJobs(deps: Deps, queue: RecordingQueue, clock: SimClock): Promise<void> {
  await runDueJobs(deps, queue, clock, new Date(8.64e15));
}
