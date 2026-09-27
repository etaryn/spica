import type { RecalledFact } from "./memory/types";

export const COLD_PATH_QUEUE = "cold_path";
export const SWEEP_QUEUE = "cold_path_sweep";
export const DECAY_QUEUE = "decay_pass";
export const TURN_TIMER_QUEUE = "turn_timer";
export const TURN_BACKCHANNEL_QUEUE = "turn_backchannel";
export const TURN_SWEEP_QUEUE = "turn_sweep";

/** `recalled` carries the hot path's retrieval for the cold path's write-back (the hot path is read-only). */
export type ColdPathJob = { userId: string; turnIds: string[]; replyTurnId?: string; recalled?: RecalledFact[] };
/** `version` must still equal `conversation_state.buffer_version` when the job runs, or it is stale (design §5.2). */
export type TurnTimerJob = { userId: string; version: number; attempt?: number };
/** `turnId`: the user turn whose judge verdict proposed the backchannel (judge_log / guard seed). */
export type BackchannelJob = { userId: string; version: number; text: string; turnId: string };

export type JobMap = {
  [COLD_PATH_QUEUE]: ColdPathJob;
  [TURN_TIMER_QUEUE]: TurnTimerJob;
  [TURN_BACKCHANNEL_QUEUE]: BackchannelJob;
};
export type JobName = keyof JobMap;
export type EnqueueOptions = { startAfter?: Date };
export type QueuedJob = { [N in JobName]: { name: N; data: JobMap[N]; startAfter?: Date } }[JobName];

export interface JobQueue {
  enqueue<N extends JobName>(name: N, data: JobMap[N], opts?: EnqueueOptions): Promise<void>;
}

/** In-process queue for tests and the eval harness (drained by the caller). */
export class RecordingQueue implements JobQueue {
  jobs: QueuedJob[] = [];
  failNext = false;

  async enqueue<N extends JobName>(name: N, data: JobMap[N], opts: EnqueueOptions = {}): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("queue unavailable");
    }
    this.jobs.push({ name, data, ...(opts.startAfter ? { startAfter: opts.startAfter } : {}) } as QueuedJob);
  }

  /** Removes and returns the jobs matching `filter` (all jobs when omitted), in enqueue order. */
  drain(filter: (j: QueuedJob) => boolean = () => true): QueuedJob[] {
    const out = this.jobs.filter(filter);
    this.jobs = this.jobs.filter((j) => !filter(j));
    return out;
  }
}
