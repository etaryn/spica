/**
 * Her core state as the rest of the mind sees it: one row of mood, energy, preoccupation and the
 * slots the core loops will fill (emotion, needs). The same for every user.
 */
export type CoreMood = { mood_valence: number; mood_arousal: number; energy: number };

export type CoreGoalStatus = "active" | "done" | "dropped";
export type CoreGoal = {
  id: string;
  title: string;
  why: string;
  status: CoreGoalStatus;
  progress: number;
  source: "seed" | "reflect";
  source_ref: string | null;
  started_at: Date;
  target_at: Date | null;
  updated_at: Date;
};
export type NewCoreGoal = Omit<CoreGoal, "id" | "updated_at"> & { embedding: number[] };

export interface CoreGoals {
  active(): Promise<CoreGoal[]>;
  get(id: string): Promise<CoreGoal | null>;
  count(): Promise<number>;
  insert(goal: NewCoreGoal): Promise<string>;
  setProgress(id: string, progress: number, now: Date): Promise<void>;
  setStatus(id: string, status: CoreGoalStatus, now: Date): Promise<void>;
}

export type CoreStateRow = CoreMood & {
  emotion: unknown;
  needs: unknown;
  preoccupation: string | null;
  preoccupation_since: Date | null;
  baseline: CoreMood;
  last_tick: Date | null;
  last_event_day: string | null;
};

export type CoreStatePatch = Partial<Omit<CoreStateRow, "baseline" | "emotion" | "needs">>;

export interface CoreState {
  get(): Promise<CoreStateRow | null>;
  /** Creates the row at `baseline` if it doesn't exist yet. */
  ensure(baseline: CoreMood): Promise<void>;
  /** The row, locked for update. Only meaningful inside `core.transaction`. */
  lock(): Promise<CoreStateRow>;
  update(patch: CoreStatePatch): Promise<void>;
}
