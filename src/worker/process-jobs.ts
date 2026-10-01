/**
 * Process jobs: turn-taking (the reply timer, backchannels and the sweep that recovers lost
 * timers) and outreach (the hourly tick that decides whether she writes first, and the send).
 */
import type { PgBoss } from "pg-boss";
import type { Deps } from "@/mind/platform/deps";
import {
  type BackchannelJob,
  OUTREACH_TICK_QUEUE,
  REACH_OUT_SEND_QUEUE,
  type ReachOutSendJob,
  TURN_BACKCHANNEL_QUEUE,
  TURN_SWEEP_QUEUE,
  TURN_TIMER_QUEUE,
  type TurnTimerJob,
} from "@/mind/platform/jobs";
import { runReachOutSend } from "@/mind/process/outreach/send";
import { outreachTick } from "@/mind/process/outreach/tick";
import { runBackchannel, runTurnTimer } from "@/mind/process/turn-taking/commit-and-reply";
import { sweepTurns } from "@/mind/process/turn-taking/sweep";
import { scrubErrors } from "./jobs";

export const PROCESS_QUEUES = [
  TURN_TIMER_QUEUE,
  TURN_BACKCHANNEL_QUEUE,
  TURN_SWEEP_QUEUE,
  OUTREACH_TICK_QUEUE,
  REACH_OUT_SEND_QUEUE,
];

/** Jobs that send her messages get the turn-taking worker settings, so they run promptly. */
function messageWorkerOptions(deps: Deps) {
  return {
    localConcurrency: deps.config.turn.worker_concurrency,
    pollingIntervalSeconds: deps.config.turn.worker_polling_interval_seconds,
  };
}

export async function registerProcessJobs(boss: PgBoss, deps: Deps): Promise<void> {
  const messageWorker = messageWorkerOptions(deps);

  await boss.work<TurnTimerJob>(
    TURN_TIMER_QUEUE,
    messageWorker,
    scrubErrors(TURN_TIMER_QUEUE, deps.log, async (jobs) => {
      for (const job of jobs) await runTurnTimer(deps, job.data);
    }),
  );
  await boss.work<BackchannelJob>(
    TURN_BACKCHANNEL_QUEUE,
    messageWorker,
    scrubErrors(TURN_BACKCHANNEL_QUEUE, deps.log, async (jobs) => {
      for (const job of jobs) await runBackchannel(deps, job.data);
    }),
  );
  await boss.work(
    TURN_SWEEP_QUEUE,
    scrubErrors(TURN_SWEEP_QUEUE, deps.log, async () => {
      await sweepTurns(deps, deps.clock.now());
    }),
  );
  await boss.schedule(TURN_SWEEP_QUEUE, deps.config.turn.sweep_cron);

  await boss.work(
    OUTREACH_TICK_QUEUE,
    scrubErrors(OUTREACH_TICK_QUEUE, deps.log, async () => {
      await outreachTick(deps, deps.clock.now());
    }),
  );
  await boss.schedule(OUTREACH_TICK_QUEUE, deps.config.outreach.tick_cron);
  await boss.work<ReachOutSendJob>(
    REACH_OUT_SEND_QUEUE,
    messageWorker,
    scrubErrors(REACH_OUT_SEND_QUEUE, deps.log, async (jobs) => {
      for (const job of jobs) await runReachOutSend(deps, job.data);
    }),
  );
}
