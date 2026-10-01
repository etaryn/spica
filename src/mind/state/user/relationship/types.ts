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
export type Param = { value: number; baseline: number; variance: number; updated_at: Date };
export type Params = Record<ParamName, Param>;
export type RelStatus = "active" | "ended_by_user" | "repairing";
export type MakeUpState = "none" | "due" | "offered";
export type RelState = {
  status: RelStatus;
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
export type RelCause =
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
export type RelEvent = {
  param: ParamName | null;
  before: number | null;
  after: number | null;
  cause: RelCause;
  deviation: number | null;
  detail: Record<string, unknown>;
};
export type RelConfig = Config["relationship"];
