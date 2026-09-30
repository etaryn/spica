import { handleColdPath } from "@/core/cold-path";
import { egoTick } from "@/core/ego/tick";
import { ensurePlans } from "@/core/life/plan";
import { lifeTick } from "@/core/life/tick";
import { outreachTick } from "@/core/outreach/tick";
import { runReachOutSend } from "@/core/outreach/send";
import { decayPass } from "@/core/memory/decay";
import { sweepUnextracted } from "@/core/memory/sweep";
import {
  type BackchannelJob, COLD_PATH_QUEUE, type ColdPathJob, DECAY_QUEUE, EGO_TICK_QUEUE, LIFE_PLAN_QUEUE, LIFE_TICK_QUEUE, OUTREACH_TICK_QUEUE, REACH_OUT_SEND_QUEUE, type ReachOutSendJob, RELATIONSHIP_TICK_QUEUE, SWEEP_QUEUE,
  TURN_BACKCHANNEL_QUEUE, TURN_SWEEP_QUEUE, TURN_TIMER_QUEUE, type TurnTimerJob,
} from "@/core/queue";
import { relationshipTick } from "@/core/relationship/tick";
import { runBackchannel, runTurnTimer } from "@/core/turn/reply";
import { sweepTurns } from "@/core/turn/sweep";
import { PgBossQueue } from "@/queue/pg-boss-queue";
import { buildRuntime } from "@/runtime/deps";
import { readEnv } from "@/runtime/env";
import { ensureSystemQueues, scrubErrors } from "./jobs";

const { deps, boss } = buildRuntime(readEnv());
const queue = deps.queue as PgBossQueue;
await queue.start();
await ensureSystemQueues(boss);

await boss.work<ColdPathJob>(COLD_PATH_QUEUE, scrubErrors(COLD_PATH_QUEUE, deps.log, async (jobs) => {
  for (const job of jobs) await handleColdPath(deps, job.data);
}));
await boss.work(SWEEP_QUEUE, scrubErrors(SWEEP_QUEUE, deps.log, async () => { await sweepUnextracted(deps, deps.clock.now()); }));
await boss.work(DECAY_QUEUE, scrubErrors(DECAY_QUEUE, deps.log, async () => { await decayPass(deps, deps.clock.now()); }));
await boss.schedule(SWEEP_QUEUE, deps.config.cold_path.sweep_cron);
await boss.schedule(DECAY_QUEUE, deps.config.decay.cron);

const turnWork = { localConcurrency: deps.config.turn.worker_concurrency, pollingIntervalSeconds: deps.config.turn.worker_polling_interval_seconds };
await boss.work<TurnTimerJob>(TURN_TIMER_QUEUE, turnWork, scrubErrors(TURN_TIMER_QUEUE, deps.log, async (jobs) => {
  for (const job of jobs) await runTurnTimer(deps, job.data);
}));
await boss.work<BackchannelJob>(TURN_BACKCHANNEL_QUEUE, turnWork, scrubErrors(TURN_BACKCHANNEL_QUEUE, deps.log, async (jobs) => {
  for (const job of jobs) await runBackchannel(deps, job.data);
}));
await boss.work(TURN_SWEEP_QUEUE, scrubErrors(TURN_SWEEP_QUEUE, deps.log, async () => { await sweepTurns(deps, deps.clock.now()); }));
await boss.schedule(TURN_SWEEP_QUEUE, deps.config.turn.sweep_cron);

await boss.work(RELATIONSHIP_TICK_QUEUE, scrubErrors(RELATIONSHIP_TICK_QUEUE, deps.log, async () => { await relationshipTick(deps, deps.clock.now()); }));
await boss.schedule(RELATIONSHIP_TICK_QUEUE, deps.config.relationship.tick_cron);
await boss.work(LIFE_PLAN_QUEUE, scrubErrors(LIFE_PLAN_QUEUE, deps.log, async () => { await ensurePlans(deps, deps.clock.now()); }));
await boss.schedule(LIFE_PLAN_QUEUE, deps.config.life.plan_cron);
await boss.work(LIFE_TICK_QUEUE, scrubErrors(LIFE_TICK_QUEUE, deps.log, async () => { await lifeTick(deps, deps.clock.now()); }));
await boss.schedule(LIFE_TICK_QUEUE, deps.config.life.tick_cron);
await boss.work(EGO_TICK_QUEUE, scrubErrors(EGO_TICK_QUEUE, deps.log, async () => { await egoTick(deps, deps.clock.now()); }));
await boss.schedule(EGO_TICK_QUEUE, deps.config.ego.tick_cron);
await boss.work(OUTREACH_TICK_QUEUE, scrubErrors(OUTREACH_TICK_QUEUE, deps.log, async () => { await outreachTick(deps, deps.clock.now()); }));
await boss.schedule(OUTREACH_TICK_QUEUE, deps.config.outreach.tick_cron);
await boss.work<ReachOutSendJob>(REACH_OUT_SEND_QUEUE, turnWork, scrubErrors(REACH_OUT_SEND_QUEUE, deps.log, async (jobs) => {
  for (const job of jobs) await runReachOutSend(deps, job.data);
}));

await sweepUnextracted(deps, deps.clock.now()); // pick up anything left from before this start
deps.log.info("worker started", { queues: [COLD_PATH_QUEUE, SWEEP_QUEUE, DECAY_QUEUE, TURN_TIMER_QUEUE, TURN_BACKCHANNEL_QUEUE, TURN_SWEEP_QUEUE, RELATIONSHIP_TICK_QUEUE, LIFE_PLAN_QUEUE, LIFE_TICK_QUEUE, EGO_TICK_QUEUE, OUTREACH_TICK_QUEUE, REACH_OUT_SEND_QUEUE] });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await queue.stop();
    process.exit(0);
  });
}
