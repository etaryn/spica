/**
 * How one user's relationship changes, as pure functions: once after every exchange (the cold
 * path) and once a day (the daily tick). Every param change is logged as an event with its cause.
 * Only the user can end the relationship; repair is slow; a crisis suspends all friction.
 * Commitment softens what they do to her and shortens the way back.
 */
import { HOUR } from "@/mind/platform/time";
import {
  advanceSession,
  closenessCeiling,
  type ExchangeSpan,
  intimacyMoment,
  sessionHours,
  skipSessionTime,
} from "./closeness";
import { deviationOf, diminishingReturns, fadeParams, nudge, sampleBaseline } from "./params";
import { peakCloseness } from "./stages";
import type { BidResponse, Signals } from "./signals";
import {
  type Intimacy,
  type Openness,
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
  /** The exchange's session and its first and last turn times: the time spent together. */
  span: ExchangeSpan | null;
  /** The extracted reading of the user's side of this exchange. */
  intimacy: Intimacy | null;
  /** The most open of the exchange's replies: what she brought to it. */
  herOpenness: Openness | null;
  /** The exchange's tone, kept in the session for its afterglow. */
  tone: number | null;
  /** How the user met her last bid in this conversation, if she made one. */
  bid: BidResponse | null;
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

/** What they do to her lands softer the more she is committed to them. */
function softened(draft: Draft, settings: RelationshipConfig): number {
  return 1 - settings.commitment.soften * draft.params.commitment.value;
}

/** Away past a grace multiple of their usual gap. */
export function isAbsent(
  now: Date,
  lastContact: Date | null,
  medianGapHours: number,
  settings: RelationshipConfig,
): boolean {
  if (!lastContact) return false;
  const graceMs = settings.absence_grace_factor * medianGapHours * HOUR;
  return now.getTime() - lastContact.getTime() > graceMs;
}

// ---------- After an exchange ----------

/**
 * Order: fade → frequency → crisis → make-up progress → time together → signals → intimacy →
 * session tone → clear the make-up.
 */
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
    if (input.span)
      draft.updateState({ session: skipSessionTime(draft.state.session, input.span) });
    suspendForCrisis(draft, input.now, settings);
    return draft.result();
  }

  advanceMakeUp(draft, input.replies, settings);
  if (input.span) accountTime(draft, input.span, settings);
  if (input.signals) applySignals(draft, input, input.signals, settings);
  applyIntimacy(draft, input, settings);
  applyBid(draft, input.bid, settings);
  recordSessionTone(draft, input.tone);
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

    const returns =
      signal > 0 ? diminishingReturns(draft.params[name], epsilon) : softened(draft, settings);
    const gain = settings.gains[name] * returns;
    draft.setParam(name, nudge(draft.params[name].value, gain * signal), "signal", { signal });
  }
}

/** Turning toward her small reaches warms her a little; turning away or against cools her. */
function applyBid(draft: Draft, bid: BidResponse | null, settings: RelationshipConfig): void {
  if (!bid || draft.state.status === "ended_by_user") return;
  const effects: { warmth?: number; trust?: number } = settings.bids.effects[bid];
  for (const name of ["warmth", "trust"] as const) {
    const delta = effects[name];
    if (!delta) continue;
    const returns =
      delta > 0
        ? diminishingReturns(draft.params[name], settings.variance_epsilon)
        : softened(draft, settings);
    draft.setParam(name, nudge(draft.params[name].value, delta * returns), "bid", {
      response: bid,
    });
  }
}

// ---------- Closeness: time together and intimacy ----------

function accountTime(draft: Draft, span: ExchangeSpan, settings: RelationshipConfig): void {
  const next = advanceSession(draft.state.session, draft.state.hours_together, span, settings);
  draft.updateState({ session: next.session, hours_together: next.hours });
}

/** The user's side moves their recent levels; a moment between them may raise closeness. */
function applyIntimacy(draft: Draft, input: ExchangeInput, settings: RelationshipConfig): void {
  const reading = input.intimacy;
  if (reading) {
    followReading(draft, "user_disclosure", reading.user_disclosure, settings);
    if (reading.user_responsiveness !== null) {
      followReading(draft, "user_responsiveness", reading.user_responsiveness, settings);
    }
  }

  const moment = intimacyMoment(reading, input.herOpenness);
  const session = draft.state.session;
  if (session) {
    draft.updateState({
      session: {
        ...session,
        moment_sum: session.moment_sum + moment,
        moment_n: session.moment_n + 1,
      },
    });
  }

  const ended = draft.state.status === "ended_by_user";
  const ceiling = closenessCeiling(draft.state.hours_together, settings);
  if (!ended && moment >= settings.signal_deadzone) {
    const gain =
      settings.intimacy.closeness_gain *
      moment *
      diminishingReturns(draft.params.closeness, settings.variance_epsilon);
    raiseCloseness(draft, gain, ceiling, "signal", { moment, ceiling }, settings);
  }
  deepSession(draft, ceiling, ended, settings);
}

function followReading(
  draft: Draft,
  name: "user_disclosure" | "user_responsiveness",
  reading: number,
  settings: RelationshipConfig,
): void {
  const value = draft.params[name].value;
  draft.setParam(name, value + settings.intimacy.ema_alpha * (reading - value), "signal", {
    reading,
  });
}

/** Up to the ceiling only; closeness already above it (earned before) is never pulled down. */
function raiseCloseness(
  draft: Draft,
  gain: number,
  ceiling: number,
  cause: RelationshipCause,
  detail: Detail,
  settings: RelationshipConfig,
): void {
  const current = draft.params.closeness.value;
  if (current >= ceiling) return;
  const c = draft.params.commitment.value;
  const repair =
    draft.state.status === "repairing"
      ? settings.repair_gain_factor +
        (1 - settings.repair_gain_factor) * settings.commitment.repair_speed * c
      : 1;
  // Once close, the way back is shorter, unless something between them is still wrong.
  const peak = peakCloseness(draft.state.peak_stage, settings.stages);
  const rekindle =
    draft.state.apart_stage === null && peak !== null && current < peak
      ? 1 + settings.stages.rekindle.base + settings.stages.rekindle.commitment * c
      : 1;
  draft.setParam(
    "closeness",
    Math.min(ceiling, nudge(current, gain * repair * rekindle)),
    cause,
    detail,
  );
}

/** A long conversation that kept going deep counts once, while it's still going. */
function deepSession(
  draft: Draft,
  ceiling: number,
  ended: boolean,
  settings: RelationshipConfig,
): void {
  const session = draft.state.session;
  if (!session || session.deep_fired || session.moment_n === 0) return;

  const depth = sessionHours(session, settings) * (session.moment_sum / session.moment_n);
  if (depth < settings.deep_session.threshold) return;

  draft.updateState({ session: { ...session, deep_fired: true } });
  if (ended) return;

  const gains = settings.deep_session.gains;
  raiseCloseness(draft, gains.closeness, ceiling, "deep_session", { depth }, settings);
  for (const name of ["trust", "warmth"] as const) {
    draft.setParam(name, nudge(draft.params[name].value, gains[name]), "deep_session", { depth });
  }
}

function recordSessionTone(draft: Draft, tone: number | null): void {
  const session = draft.state.session;
  if (tone === null || !session) return;
  draft.updateState({
    session: { ...session, tone_sum: session.tone_sum + tone, tone_n: session.tone_n + 1 },
  });
}

function applyTension(draft: Draft, signals: Signals, settings: RelationshipConfig): void {
  if (Math.abs(signals.tension) < settings.signal_deadzone) return;

  const factor = signals.tension > 0 ? softened(draft, settings) : 1;
  const value = nudge(
    draft.params.tension.value,
    settings.gains.tension * signals.tension * factor,
  );
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
  draft.setParam("hurt", nudge(before, amount * softened(draft, settings)), "signal", {
    signal: hurt.amount,
    sensitised,
  });
  draft.updateState({ last_hurt_at: input.now });

  // A scar is judged on the hurt itself: commitment softens the sting, not the wound.
  if (nudge(before, amount) - before >= settings.scar_threshold) leaveScar(draft, settings);

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
  if (isAbsent(input.now, lastContact, input.medianGapHours, settings)) {
    // A friend of long standing is still a friend after a quiet fortnight.
    const shield = 1 - settings.commitment.absence_shield * draft.params.commitment.value;
    const drifted = Math.max(
      0,
      draft.params.closeness.value - settings.closeness_absence_drift * shield,
    );
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
    settings.absence_hurt_gain * Math.abs(frequencyDeviation) * softened(draft, settings),
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
