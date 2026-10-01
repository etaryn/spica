/**
 * Background jobs: the queue names, what each job carries, and the queue interface. The names are
 * stored in the database by pg-boss, so they never change.
 */
import type { RecalledFact } from "@/mind/memory/shared/types";

export const COLD_PATH_QUEUE = "cold_path";
export const SWEEP_QUEUE = "cold_path_sweep";
export const DECAY_QUEUE = "decay_pass";
export const TURN_TIMER_QUEUE = "turn_timer";
export const TURN_BACKCHANNEL_QUEUE = "turn_backchannel";
export const TURN_SWEEP_QUEUE = "turn_sweep";
export const RELATIONSHIP_TICK_QUEUE = "relationship_tick";
export const LIFE_PLAN_QUEUE = "life_plan";
export const CORE_WORLD_TICK_QUEUE = "core_world_tick";
export const CORE_STATE_TICK_QUEUE = "core_state_tick";
export const OUTREACH_TICK_QUEUE = "outreach_tick";
export const REACH_OUT_SEND_QUEUE = "reach_out_send";

/** Sends the reach-out scheduled in `reach_out_log` row `logId`. */
export type ReachOutSendJob = { userId: string; logId: string };

/**
 * One exchange for the cold path. `recalled` carries the hot path's retrieval so the cold path can
 * write back recall reinforcement; the hot path itself is read-only.
 */
export type ColdPathJob = {
  userId: string;
  turnIds: string[];
  replyTurnId?: string;
  recalled?: RecalledFact[];
};

/** Stale unless `version` still equals `conversation_state.buffer_version` when it runs. */
export type TurnTimerJob = { userId: string; version: number; attempt?: number };

/**
 * A backchannel, or the availability note (`trigger: "availability"`, whose text is picked when it
 * runs). `turnId` is the user turn whose judge verdict proposed it.
 */
export type BackchannelJob = {
  userId: string;
  version: number;
  text: string;
  turnId: string;
  trigger?: "backchannel" | "availability";
  blockKind?: "busy" | "quiet";
  blockStart?: string;
};

export type JobMap = {
  [COLD_PATH_QUEUE]: ColdPathJob;
  [TURN_TIMER_QUEUE]: TurnTimerJob;
  [TURN_BACKCHANNEL_QUEUE]: BackchannelJob;
  [REACH_OUT_SEND_QUEUE]: ReachOutSendJob;
};
export type JobName = keyof JobMap;
export type EnqueueOptions = { startAfter?: Date };
export type QueuedJob = {
  [N in JobName]: { name: N; data: JobMap[N]; startAfter?: Date };
}[JobName];

export interface JobQueue {
  enqueue<N extends JobName>(name: N, data: JobMap[N], options?: EnqueueOptions): Promise<void>;
}

/** An in-process queue for tests and the eval harness; the caller drains it. */
export class RecordingQueue implements JobQueue {
  jobs: QueuedJob[] = [];
  failNext = false;

  async enqueue<N extends JobName>(
    name: N,
    data: JobMap[N],
    options: EnqueueOptions = {},
  ): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("queue unavailable");
    }

    const job = { name, data, ...(options.startAfter ? { startAfter: options.startAfter } : {}) };
    this.jobs.push(job as QueuedJob);
  }

  /** Removes and returns the jobs matching `filter` (all jobs when omitted), in enqueue order. */
  drain(filter: (job: QueuedJob) => boolean = () => true): QueuedJob[] {
    const drained = this.jobs.filter(filter);
    this.jobs = this.jobs.filter((job) => !filter(job));
    return drained;
  }
}
