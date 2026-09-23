export const COLD_PATH_QUEUE = "cold_path";
export type ColdPathJob = { userId: string; turnIds: string[] };

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
