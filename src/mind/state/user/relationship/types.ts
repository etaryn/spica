/**
 * The shapes of one user's relationship state: the homeostatic params (closeness, trust, warmth,
 * hurt, tension, messages per day), the status row, and the events that record every change.
 */
import type { Config } from "@/mind/platform/config";

export const PARAM_NAMES = [
  "closeness",
  "trust",
  "warmth",
  "hurt",
  "tension",
  "msgs_per_day",
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
  | "baseline";

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
