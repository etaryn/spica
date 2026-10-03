/**
 * Her core state as the rest of the mind sees it: one row of mood, energy, needs, her current
 * emotion and preoccupation. The same for every user.
 */
export type CoreMood = { mood_valence: number; mood_arousal: number; energy: number };
export type CoreNeeds = { autonomy: number; competence: number };
export type CoreEmotion = {
  label: string;
  valence: number;
  arousal: number;
  /** A short phrase for what it's about, or null. */
  phrase: string | null;
  /** The core memory it's about, or null. */
  about: string | null;
  /** ISO time it was felt. */
  since: string;
};

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
  /** Terminal transitions only apply while active; true means the transition won. */
  setStatus(id: string, status: Exclude<CoreGoalStatus, "active">, now: Date): Promise<boolean>;
}

export type CoreStateRow = CoreMood & {
  emotion: CoreEmotion | null;
  needs: CoreNeeds;
  preoccupation: string | null;
  preoccupation_since: Date | null;
  baseline: CoreMood;
  last_tick: Date | null;
  last_event_day: string | null;
  last_nightly_day: string | null;
};

export type CoreStatePatch = Partial<Omit<CoreStateRow, "baseline">>;

export interface CoreState {
  get(): Promise<CoreStateRow | null>;
  /** Creates the row at `baseline` with `needs` if it doesn't exist yet. */
  ensure(baseline: CoreMood, needs: CoreNeeds): Promise<void>;
  /** The row, locked for update. Only meaningful inside `core.transaction`. */
  lock(): Promise<CoreStateRow>;
  update(patch: CoreStatePatch): Promise<void>;
}
