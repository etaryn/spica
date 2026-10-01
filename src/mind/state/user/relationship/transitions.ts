/**
 * How one user's relationship changes, as pure functions: once after every exchange (the cold
 * path) and once a day (the daily tick). Every param change is logged as an event with its cause.
 * Only the user can end the relationship; repair is slow; a crisis suspends all friction.
 */
import { HOUR } from "@/mind/platform/time";
import { deviationOf, diminishingReturns, fadeParams, nudge, sampleBaseline } from "./params";
import type { Signals } from "./signals";
import {
  PARAM_NAMES,
  type ParamName,
  type Params,
  type RelationshipCause,
  type RelationshipConfig,
  type RelationshipEvent,
  type RelationshipState,
} from "./types";

export type Transition = {
  state: RelationshipState;
  params: Params;
  events: RelationshipEvent[];
};

export type ExchangeInput = {
  /** The cold path's clock: fades and everything else. */
  now: Date;
  /** The exchange's newest user turn, so `end_pending_since` shares a clock with `last_contact`. */
  exchangeAt: Date;
  signals: Signals | null;
  crisis: boolean;
  hurtFactId: string | null;
  replies: number;
  msgs24h: number;
};

export type TickInput = {
  now: Date;
  localDate: string;
  yesterdayCount: number;
  msgs24h: number;
  lastContact: Date | null;
  medianGapHours: number;
};

type Detail = Record<string, unknown>;

const DAY = 24 * HOUR;
const MINUTE = 60_000;

/** A working copy of the state and params; every param change goes through `setParam`. */
class Draft {
  state: RelationshipState;
  params: Params;
  readonly events: RelationshipEvent[] = [];

  constructor(
    state: RelationshipState,
    params: Params,
    private readonly settings: RelationshipConfig,
  ) {
    this.state = { ...state };
    this.params = { ...params };
  }

  setParam(name: ParamName, value: number, cause: RelationshipCause, detail: Detail = {}): void {
    const before = this.params[name].value;
    if (value === before) return;

    this.params[name] = { ...this.params[name], value };
    this.events.push({
      param: name,
      before,
      after: value,
      cause,
      deviation: deviationOf(this.params[name], this.settings.variance_epsilon),
      detail,
    });
  }

  touchParam(name: ParamName, at: Date): void {
    this.params[name] = { ...this.params[name], updated_at: at };
  }

  updateState(patch: Partial<RelationshipState>): void {
    this.state = { ...this.state, ...patch };
  }

  logStatus(cause: RelationshipCause, detail: Detail): void {
    this.events.push({ param: null, before: null, after: null, cause, deviation: null, detail });
  }

  result(): Transition {
    return { state: this.state, params: this.params, events: this.events };
  }
}

/** The make-up line goes into her next reply once enough replies have passed since the hurt. */
export function makeUpLineDue(state: RelationshipState, settings: RelationshipConfig): boolean {
  if (state.make_up_state === "offered") return true;
  return state.make_up_state === "due" && state.make_up_replies >= settings.make_up_delay_replies;
}

// ---------- After an exchange ----------

/** Order: fade → frequency → crisis → make-up progress → signals → clear the make-up. */
export function relationshipAfterExchange(
  state: RelationshipState,
  params: Params,
  input: ExchangeInput,
  settings: RelationshipConfig,
): Transition {
  const draft = new Draft(state, params, settings);

  fadeHurtAndTension(draft, input.now, settings);
  recordFrequency(draft, input.msgs24h, input.now);

  if (input.crisis) {
    suspendForCrisis(draft, input.now, settings);
    return draft.result();
  }

  advanceMakeUp(draft, input.replies, settings);

  if (input.signals) applySignals(draft, input, input.signals, settings);

  clearMakeUpOnceHealed(draft, settings);
  return draft.result();
}

function fadeHurtAndTension(draft: Draft, now: Date, settings: RelationshipConfig): void {
  const fadedParams = fadeParams(draft.params, now, settings);
  for (const name of ["hurt", "tension"] as const) {
    draft.setParam(name, fadedParams[name].value, "fade");
    draft.touchParam(name, now);
  }
}

function recordFrequency(draft: Draft, msgs24h: number, now: Date): void {
  draft.setParam("msgs_per_day", msgs24h, "frequency");
  draft.touchParam("msgs_per_day", now);
}

/** No friction carries through a crisis, including a pending ending. */
function suspendForCrisis(draft: Draft, now: Date, settings: RelationshipConfig): void {
  draft.setParam("tension", 0, "crisis");
  draft.updateState({
    crisis_quiet_until: new Date(now.getTime() + settings.crisis_quiet_hours * HOUR),
  });

  if (draft.state.end_pending_since) {
    draft.updateState({ end_pending_since: null });
    draft.logStatus("ending", { stage: "cleared_by_crisis" });
  }
  draft.logStatus("crisis", { suppressed: true });
}

/** This exchange's reply was composed from the state before it, so a due make-up line was offered. */
function advanceMakeUp(draft: Draft, replies: number, settings: RelationshipConfig): void {
  if (draft.state.make_up_state !== "due") return;

  const offered = makeUpLineDue(draft.state, settings);
  draft.updateState({
    make_up_state: offered ? "offered" : "due",
    make_up_replies: draft.state.make_up_replies + replies,
  });
}

function applySignals(
  draft: Draft,
  input: ExchangeInput,
  signals: Signals,
  settings: RelationshipConfig,
): void {
  if (draft.state.status !== "ended_by_user") applyWarmthAndTrust(draft, signals, settings);
  applyTension(draft, signals, settings);
  applyHurt(draft, input, signals, settings);
  applyMakeUpOrApology(draft, signals, settings);
  applyEndingSignals(draft, input, signals, settings);
}

function applyWarmthAndTrust(draft: Draft, signals: Signals, settings: RelationshipConfig): void {
  const deadzone = settings.signal_deadzone;
  const epsilon = settings.variance_epsilon;

  for (const name of ["warmth", "trust"] as const) {
    const signal = signals[name];
    if (Math.abs(signal) < deadzone) continue;

    const returns = signal > 0 ? diminishingReturns(draft.params[name], epsilon) : 1;
    const gain = settings.gains[name] * returns;
    draft.setParam(name, nudge(draft.params[name].value, gain * signal), "signal", { signal });
  }

  if (signals.warmth >= deadzone) {
    const repairing = draft.state.status === "repairing";
    const gain =
      settings.gains.closeness_per_warm_exchange *
      diminishingReturns(draft.params.closeness, epsilon) *
      (repairing ? settings.repair_gain_factor : 1);
    draft.setParam("closeness", nudge(draft.params.closeness.value, gain), "signal", {
      warm_exchange: true,
    });
  }
}

function applyTension(draft: Draft, signals: Signals, settings: RelationshipConfig): void {
  if (Math.abs(signals.tension) < settings.signal_deadzone) return;

  const value = nudge(draft.params.tension.value, settings.gains.tension * signals.tension);
  draft.setParam("tension", value, "signal", { signal: signals.tension });
}

function applyHurt(
  draft: Draft,
  input: ExchangeInput,
  signals: Signals,
  settings: RelationshipConfig,
): void {
  const hurt = signals.hurt;
  if (!hurt || hurt.amount < settings.signal_deadzone) return;

  // A second hurt soon after the last one lands harder.
  const lastHurt = draft.state.last_hurt_at;
  const sensitised =
    !!lastHurt && input.now.getTime() - lastHurt.getTime() <= settings.sensitise_window_days * DAY;
  const amount = Math.min(
    1,
    settings.gains.hurt * hurt.amount * (sensitised ? settings.sensitise_factor : 1),
  );

  const before = draft.params.hurt.value;
  draft.setParam("hurt", nudge(before, amount), "signal", { signal: hurt.amount, sensitised });
  draft.updateState({ last_hurt_at: input.now });

  if (draft.params.hurt.value - before >= settings.scar_threshold) leaveScar(draft, settings);

  if (
    draft.state.status !== "ended_by_user" &&
    draft.params.hurt.value >= settings.make_up_threshold
  ) {
    startOrRepointMakeUp(draft, input.hurtFactId);
  }
}

/**
 * A scar never heals by itself. Dent the baseline so the daily average doesn't erase it, and dent
 * the value too, so current trust reads as scarred rather than merely "at baseline".
 */
function leaveScar(draft: Draft, settings: RelationshipConfig): void {
  const trust = draft.params.trust;
  draft.params.trust = {
    ...trust,
    baseline: Math.max(0, trust.baseline - settings.scar_trust_dent),
  };
  draft.setParam("trust", Math.max(0, trust.value - settings.scar_trust_dent), "scar", {
    baseline_dented: true,
  });
}

/**
 * Hurt enough to need making up. A second hurt while a make-up is already pending points it at
 * the newest cause, so she brings up the latest hurt rather than a stale one.
 */
function startOrRepointMakeUp(draft: Draft, hurtFactId: string | null): void {
  if (draft.state.make_up_state === "none") {
    draft.updateState({ make_up_state: "due", make_up_replies: 0, hurt_cause_fact: hurtFactId });
  } else if (hurtFactId) {
    draft.updateState({ hurt_cause_fact: hurtFactId });
  }
}

function applyMakeUpOrApology(draft: Draft, signals: Signals, settings: RelationshipConfig): void {
  if (!signals.make_up && !signals.apology) return;

  const relief = Math.min(
    signals.make_up ? settings.make_up_relief : 1,
    signals.apology ? settings.apology_relief : 1,
  );
  const cause = signals.make_up ? "make_up" : "apology";

  relieve(draft, relief, cause, settings);
  draft.logStatus(cause, { make_up: signals.make_up, apology: signals.apology });
}

function relieve(
  draft: Draft,
  factor: number,
  cause: "make_up" | "apology",
  settings: RelationshipConfig,
): void {
  draft.setParam("hurt", draft.params.hurt.value * factor, cause);
  draft.setParam("tension", draft.params.tension.value * settings.relief_tension_factor, cause);

  if (draft.state.make_up_state !== "none") {
    draft.updateState({ make_up_state: "none", make_up_replies: 0, hurt_cause_fact: null });
  }
}

/** Only these user signals can move the status. */
function applyEndingSignals(
  draft: Draft,
  input: ExchangeInput,
  signals: Signals,
  settings: RelationshipConfig,
): void {
  const status = draft.state.status;

  if (status === "active") {
    if (signals.retracts_ending && draft.state.end_pending_since) {
      draft.updateState({ end_pending_since: null });
      draft.logStatus("ending", { stage: "retracted" });
    } else if (signals.ends_relationship) {
      handleEndingStatement(draft, input, settings);
    }
    return;
  }

  if (status === "repairing" && signals.ends_relationship) {
    confirmEnding(draft, input.now, settings, "signal");
    return;
  }

  // Taking the ending back after it's confirmed is a wish to repair, on the same slow path.
  if (status === "ended_by_user" && (signals.wants_repair || signals.retracts_ending)) {
    draft.updateState({ status: "repairing", repair_started_at: input.now });
    draft.logStatus("repair", { stage: "started" });
  }
}

/**
 * "We're done" starts a pending ending. Said again after the reconfirm window, it confirms.
 * Said again inside the window, it only restarts the window, so continued warm chat still
 * clears it at the timeout, while a genuine "I mean it" followed by silence confirms there.
 */
function handleEndingStatement(
  draft: Draft,
  input: ExchangeInput,
  settings: RelationshipConfig,
): void {
  const pending = draft.state.end_pending_since;

  if (!pending) {
    draft.updateState({ end_pending_since: input.exchangeAt });
    draft.logStatus("ending", { stage: "pending" });
    return;
  }

  const sincePending = input.exchangeAt.getTime() - pending.getTime();
  if (sincePending >= settings.end_reconfirm_min_minutes * MINUTE) {
    confirmEnding(draft, input.now, settings, "signal");
    return;
  }

  draft.updateState({ end_pending_since: input.exchangeAt });
  draft.logStatus("ending", { stage: "pending", restarted: true });
}

/** The user's ending is confirmed and she lets go. */
function confirmEnding(
  draft: Draft,
  now: Date,
  settings: RelationshipConfig,
  via: "signal" | "timeout",
): void {
  draft.setParam(
    "closeness",
    draft.params.closeness.value * settings.end_closeness_factor,
    "ending",
    { stage: "confirmed" },
  );
  draft.updateState({
    status: "ended_by_user",
    ended_at: now,
    end_pending_since: null,
    make_up_state: "none",
    make_up_replies: 0,
    hurt_cause_fact: null,
  });
  draft.logStatus("ending", { stage: "confirmed", via });
}

function clearMakeUpOnceHealed(draft: Draft, settings: RelationshipConfig): void {
  if (draft.state.make_up_state === "none") return;
  if (draft.params.hurt.value >= settings.make_up_clear_threshold) return;

  draft.updateState({ make_up_state: "none", make_up_replies: 0, hurt_cause_fact: null });
}

// ---------- Once a day ----------

/** Order: fade → frequency → absence → baselines → ending timeout → repair → clear the make-up. */
export function relationshipAfterDailyTick(
  state: RelationshipState,
  params: Params,
  input: TickInput,
  settings: RelationshipConfig,
): Transition {
  if (state.last_tick === input.localDate) return { state, params, events: [] };

  const draft = new Draft(state, params, settings);

  fadeHurtAndTension(draft, input.now, settings);
  recordFrequency(draft, input.msgs24h, input.now);
  if (input.lastContact) applyAbsence(draft, input, input.lastContact, settings);
  sampleAllBaselines(draft, input.yesterdayCount, settings);
  settlePendingEnding(draft, input, settings);
  completeRepair(draft, input.now, settings);
  clearMakeUpOnceHealed(draft, settings);

  draft.updateState({ last_tick: input.localDate });
  return draft.result();
}

function applyAbsence(
  draft: Draft,
  input: TickInput,
  lastContact: Date,
  settings: RelationshipConfig,
): void {
  const graceMs = settings.absence_grace_factor * input.medianGapHours * HOUR;
  if (input.now.getTime() - lastContact.getTime() > graceMs) {
    const drifted = Math.max(0, draft.params.closeness.value - settings.closeness_absence_drift);
    draft.setParam("closeness", drifted, "absence");
  }

  // Once she's let go, absence no longer hurts her or starts a make-up. Closeness still drifts
  // down above: that's distance, not a grievance.
  if (draft.state.status === "ended_by_user") return;

  // Read the frequency deviation before today's sample dilutes the baseline.
  const yesterday = { ...draft.params.msgs_per_day, value: input.yesterdayCount };
  const frequencyDeviation = deviationOf(yesterday, settings.variance_epsilon);
  if (frequencyDeviation >= settings.absence_hurt_effect) return;

  const hurt = nudge(
    draft.params.hurt.value,
    settings.absence_hurt_gain * Math.abs(frequencyDeviation),
  );
  draft.setParam("hurt", hurt, "absence", { frequency_effect: frequencyDeviation });

  if (
    draft.state.make_up_state === "none" &&
    draft.params.hurt.value >= settings.make_up_threshold
  ) {
    draft.updateState({ make_up_state: "due", make_up_replies: 0, hurt_cause_fact: null });
  }
}

function sampleAllBaselines(
  draft: Draft,
  yesterdayCount: number,
  settings: RelationshipConfig,
): void {
  for (const name of PARAM_NAMES) {
    const sample = name === "msgs_per_day" ? yesterdayCount : draft.params[name].value;
    const before = draft.params[name].baseline;

    draft.params[name] = sampleBaseline(draft.params[name], sample, settings.baseline_alpha);
    draft.events.push({
      param: name,
      before,
      after: draft.params[name].baseline,
      cause: "baseline",
      deviation: deviationOf(draft.params[name], settings.variance_epsilon),
      detail: { sample },
    });
  }
}

/**
 * At the timeout, contact after the "we're done" counts as taking it back; only silence confirms,
 * because she lets go only if they meant it. Never settled inside a crisis quiet window.
 */
function settlePendingEnding(draft: Draft, input: TickInput, settings: RelationshipConfig): void {
  const pending = draft.state.end_pending_since;
  if (draft.state.status !== "active" || !pending) return;

  const quietUntil = draft.state.crisis_quiet_until;
  const inCrisisQuiet = !!quietUntil && input.now.getTime() < quietUntil.getTime();
  if (inCrisisQuiet) return;

  const timedOut = input.now.getTime() - pending.getTime() >= settings.end_confirm_hours * HOUR;
  if (!timedOut) return;

  if (input.lastContact && input.lastContact.getTime() > pending.getTime()) {
    draft.updateState({ end_pending_since: null });
    draft.logStatus("ending", { stage: "retracted", via: "continued_contact" });
  } else {
    confirmEnding(draft, input.now, settings, "timeout");
  }
}

function completeRepair(draft: Draft, now: Date, settings: RelationshipConfig): void {
  const started = draft.state.repair_started_at;
  if (draft.state.status !== "repairing" || !started) return;

  const closeEnough = draft.params.closeness.value >= settings.repair_complete_closeness;
  const longEnough = now.getTime() - started.getTime() >= settings.repair_min_days * DAY;
  if (!closeEnough || !longEnough) return;

  draft.updateState({ status: "active" });
  draft.logStatus("repair", { stage: "complete" });
}
