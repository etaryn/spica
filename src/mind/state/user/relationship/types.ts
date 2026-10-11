/**
 * The shapes of one user's relationship state: the homeostatic params (closeness, trust, warmth,
 * hurt, tension, messages per day, her own feelings toward them: affect and afterglow, and how
 * open and attentive the user is with her, and her commitment to them), the status row with where
 * the relationship stands (Knapp's stages), and the events that record every change.
 */
import type { Config } from "@/mind/platform/config";

export const PARAM_NAMES = [
  "closeness",
  "trust",
  "warmth",
  "hurt",
  "tension",
  "msgs_per_day",
  "affect_valence",
  "afterglow",
  "user_disclosure",
  "user_responsiveness",
  "commitment",
] as const;
export type ParamName = (typeof PARAM_NAMES)[number];

/** A value judged against this user's own baseline and variance, not a global scale. */
export type HomeostaticParam = {
  value: number;
  baseline: number;
  variance: number;
  updated_at: Date;
};
export type Params = Record<ParamName, HomeostaticParam>;

/** One exchange's reading of the user: how much they opened up, how well they met her. */
export type Intimacy = { user_disclosure: number; user_responsiveness: number | null };

/** How much she chose to open up, and how attentive she chose to be, in one reply. */
export type Openness = { disclosure: number; responsiveness: number };

/** This conversation's running state; ISO strings because it is stored as JSON. */
export type SessionState = {
  id: string;
  started_at: string;
  last_at: string;
  /** Time together in this session, gaps capped; how deep it went is measured against it. */
  hours: number;
  tone_sum: number;
  tone_n: number;
  moment_sum: number;
  moment_n: number;
  deep_fired: boolean;
};

/** How deep she may go: `open` plainly, up to `peek` only as a hint. */
export type DepthLimits = { open: number; peek: number };
/** What a reply was allowed, and the item it held back, if any. */
export type DepthRecord = DepthLimits & { held_back: string | null };

/** How far they have come together; the peak only ever rises. */
export const TOGETHER = [
  "initiating",
  "experimenting",
  "intensifying",
  "integrating",
  "bonding",
] as const;
export type TogetherStage = (typeof TOGETHER)[number];
/** Coming apart, laid over the peak while it holds; mildest first. */
export const APART = ["differentiating", "circumscribing", "stagnating", "avoiding"] as const;
export type ApartStage = (typeof APART)[number];

export type RelationshipStatus = "active" | "ended_by_user" | "repairing";
export type MakeUpState = "none" | "due" | "offered";

export type RelationshipState = {
  status: RelationshipStatus;
  end_pending_since: Date | null;
  ended_at: Date | null;
  repair_started_at: Date | null;
  make_up_state: MakeUpState;
  make_up_replies: number;
  hurt_cause_fact: string | null;
  crisis_quiet_until: Date | null;
  last_tick: string | null;
  last_hurt_at: Date | null;
  hours_together: number;
  session: SessionState | null;
  peak_stage: TogetherStage;
  apart_stage: ApartStage | null;
  /** Milestones already reached; null until the relationship is first staged. */
  milestones: string[] | null;
};

export type RelationshipCause =
  | "signal"
  | "frequency"
  | "absence"
  | "fade"
  | "make_up"
  | "apology"
  | "ending"
  | "repair"
  | "crisis"
  | "scar"
  | "baseline"
  | "deep_session"
  | "bid"
  | "stage"
  | "commitment";

/** One change, for the trace. `param` is null for a status change. */
export type RelationshipEvent = {
  param: ParamName | null;
  before: number | null;
  after: number | null;
  cause: RelationshipCause;
  deviation: number | null;
  detail: Record<string, unknown>;
};

export type RelationshipConfig = Config["relationship"];
