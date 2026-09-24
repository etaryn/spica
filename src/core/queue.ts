import type { RecalledFact } from "./memory/types";

export const COLD_PATH_QUEUE = "cold_path";
export const SWEEP_QUEUE = "cold_path_sweep";
export const DECAY_QUEUE = "decay_pass";
/** `recalled` carries the hot path's retrieval for the cold path's write-back (the hot path is read-only). */
export type ColdPathJob = { userId: string; turnIds: string[]; replyTurnId?: string; recalled?: RecalledFact[] };

export interface JobQueue {
  enqueue(name: typeof COLD_PATH_QUEUE, data: ColdPathJob): Promise<void>;
}

/** In-process queue for tests and the eval harness (drained synchronously). */
export class RecordingQueue implements JobQueue {
  jobs: { name: string; data: ColdPathJob }[] = [];
  failNext = false;

  async enqueue(name: typeof COLD_PATH_QUEUE, data: ColdPathJob): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("queue unavailable");
    }
    this.jobs.push({ name, data });
  }

  drain(): { name: string; data: ColdPathJob }[] {
    const out = this.jobs;
    this.jobs = [];
    return out;
  }
}
