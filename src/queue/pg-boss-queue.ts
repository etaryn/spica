import type { PgBoss } from "pg-boss";
import { COLD_PATH_QUEUE, type ColdPathJob, type JobQueue } from "@/core/queue";

/** pg-boss lives in the same Postgres database: the spec's one-database rule holds. */
export class PgBossQueue implements JobQueue {
  private ready: Promise<void> | null = null;

  constructor(
    private readonly boss: PgBoss,
    private readonly opts: { retryLimit: number; retryDelaySeconds: number } = { retryLimit: 3, retryDelaySeconds: 30 },
  ) {}

  start(): Promise<void> {
    this.ready ??= (async () => {
      await this.boss.start();
      // Failed cold-path jobs retry with backoff; turns stay extracted=false until one succeeds (v2 §6.3).
      // createQueue is create-only (ON CONFLICT DO NOTHING), so a queue created by an earlier
      // deploy keeps its old policy unless we also updateQueue it here; updateQueue is a safe
      // no-op WHERE-matched UPDATE when the queue doesn't exist yet.
      const policy = { retryLimit: this.opts.retryLimit, retryDelay: this.opts.retryDelaySeconds, retryBackoff: true };
      await this.boss.createQueue(COLD_PATH_QUEUE, policy);
      await this.boss.updateQueue(COLD_PATH_QUEUE, policy);
    })().catch((e) => {
      this.ready = null; // allow a later retry
      throw e;
    });
    return this.ready;
  }

  async enqueue(name: typeof COLD_PATH_QUEUE, data: ColdPathJob): Promise<void> {
    await this.start();
    await this.boss.send(name, data);
  }

  async stop(): Promise<void> {
    if (this.ready) await this.boss.stop();
    this.ready = null;
  }
}
