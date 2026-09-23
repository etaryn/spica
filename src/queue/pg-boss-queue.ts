import type { PgBoss } from "pg-boss";
import { COLD_PATH_QUEUE, type ColdPathJob, type JobQueue } from "@/core/queue";

/** pg-boss lives in the same Postgres database: the spec's one-database rule holds. */
export class PgBossQueue implements JobQueue {
  private ready: Promise<void> | null = null;

  constructor(private readonly boss: PgBoss) {}

  start(): Promise<void> {
    this.ready ??= (async () => {
      await this.boss.start();
      await this.boss.createQueue(COLD_PATH_QUEUE);
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
