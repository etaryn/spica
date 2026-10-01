import type { PgBoss } from "pg-boss";
import {
  COLD_PATH_QUEUE,
  type EnqueueOptions,
  type JobMap,
  type JobName,
  type JobQueue,
  REACH_OUT_SEND_QUEUE,
  TURN_BACKCHANNEL_QUEUE,
  TURN_TIMER_QUEUE,
} from "@/core/queue";

/** pg-boss lives in the same Postgres database: one database for everything. */
export class PgBossQueue implements JobQueue {
  private ready: Promise<void> | null = null;

  constructor(
    private readonly boss: PgBoss,
    private readonly opts: {
      retryLimit: number; retryDelaySeconds: number; turnExpireSeconds: number;
      timerRetryLimit: number; timerRetryDelaySeconds: number;
    },
  ) {}

  start(): Promise<void> {
    this.ready ??= (async () => {
      await this.boss.start();
      // Failed cold-path jobs retry with backoff; turns stay extracted=false until one succeeds.
      // createQueue is create-only (ON CONFLICT DO NOTHING), so a queue created by an earlier
      // deploy keeps its old policy unless we also updateQueue it here; updateQueue is a safe
      // no-op WHERE-matched UPDATE when the queue doesn't exist yet.
      const policy = { retryLimit: this.opts.retryLimit, retryDelay: this.opts.retryDelaySeconds, retryBackoff: true };
      await this.boss.createQueue(COLD_PATH_QUEUE, policy);
      await this.boss.updateQueue(COLD_PATH_QUEUE, policy);

      // Turn jobs: a timer may be retried (a stale or duplicate one is a no-op thanks to the version check);
      // a backchannel never is (a late "huh" is worse than none).
      const turn = { retryLimit: this.opts.timerRetryLimit, retryDelay: this.opts.timerRetryDelaySeconds, expireInSeconds: this.opts.turnExpireSeconds };
      await this.boss.createQueue(TURN_TIMER_QUEUE, turn);
      await this.boss.updateQueue(TURN_TIMER_QUEUE, turn);
      const bc = { retryLimit: 0, expireInSeconds: this.opts.turnExpireSeconds };
      await this.boss.createQueue(TURN_BACKCHANNEL_QUEUE, bc);
      await this.boss.updateQueue(TURN_BACKCHANNEL_QUEUE, bc);
      // A retried reach-out send could double-send; a lost one is just a skipped hour.
      await this.boss.createQueue(REACH_OUT_SEND_QUEUE, bc);
      await this.boss.updateQueue(REACH_OUT_SEND_QUEUE, bc);
    })().catch((e) => {
      this.ready = null; // allow a later retry
      throw e;
    });
    return this.ready;
  }

  async enqueue<N extends JobName>(name: N, data: JobMap[N], opts: EnqueueOptions = {}): Promise<void> {
    await this.start();
    await this.boss.send(name, data, opts.startAfter ? { startAfter: opts.startAfter } : {});
  }

  async stop(): Promise<void> {
    if (this.ready) await this.boss.stop();
    this.ready = null;
  }
}
