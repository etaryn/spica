import { HOUR } from "../time";
import { effect, dim, fadeParams, nudge, sampleBaseline } from "./homeostasis";
import type { Signals } from "./signals";
import {
  PARAM_NAMES,
  type ParamName,
  type Params,
  type RelCause,
  type RelConfig,
  type RelEvent,
  type RelState,
} from "./types";

export type Transition = { state: RelState; params: Params; events: RelEvent[] };
/** `exchangeAt` is the exchange's newest user-turn `created_at`: stamps `end_pending_since`
 * on the same clock as `last_contact`, not the cold path's processing time. `now` stays the cold path clock
 * for fades and everything else. */
export type ExchangeInput = {
  now: Date;
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

const DAY = 24 * HOUR;

/** A mutable working copy plus an event log; every param change goes through `set`. */
function builder(state: RelState, params: Params, cfg: RelConfig) {
  const t: Transition = { state: { ...state }, params: { ...params }, events: [] };
  const set = (
    name: ParamName,
    value: number,
    cause: RelCause,
    detail: Record<string, unknown> = {},
  ) => {
    const before = t.params[name].value;
    if (value === before) return;
    t.params[name] = { ...t.params[name], value };
    t.events.push({
      param: name,
      before,
      after: value,
      cause,
      deviation: effect(t.params[name], cfg.variance_epsilon),
      detail,
    });
  };
  const status = (cause: RelCause, detail: Record<string, unknown>) =>
    t.events.push({ param: null, before: null, after: null, cause, deviation: null, detail });
  return { t, set, status };
}

function fadeWithEvents(b: Builder, now: Date, cfg: RelConfig) {
  const f = fadeParams(b.t.params, now, cfg);
  for (const n of ["hurt", "tension"] as const) {
    b.set(n, f[n].value, "fade");
    b.t.params[n] = { ...b.t.params[n], updated_at: now };
  }
}

export function makeUpLineDue(state: RelState, cfg: RelConfig): boolean {
  return (
    state.make_up_state === "offered" ||
    (state.make_up_state === "due" && state.make_up_replies >= cfg.make_up_delay_replies)
  );
}

type Builder = ReturnType<typeof builder>;

/** Rule 3: the user's ending is confirmed; she lets go. Mutates the builder in place (its closures own `b.t`). */
function confirmEnding(b: Builder, now: Date, cfg: RelConfig, via: "signal" | "timeout") {
  b.set("closeness", b.t.params.closeness.value * cfg.end_closeness_factor, "ending", {
    stage: "confirmed",
  });
  b.t.state = {
    ...b.t.state,
    status: "ended_by_user",
    ended_at: now,
    end_pending_since: null,
    make_up_state: "none",
    make_up_replies: 0,
    hurt_cause_fact: null,
  };
  b.status("ending", { stage: "confirmed", via });
}

function relieve(b: Builder, factor: number, cause: "make_up" | "apology", cfg: RelConfig) {
  b.set("hurt", b.t.params.hurt.value * factor, cause);
  b.set("tension", b.t.params.tension.value * cfg.relief_tension_factor, cause);
  if (b.t.state.make_up_state !== "none")
    b.t.state = { ...b.t.state, make_up_state: "none", make_up_replies: 0, hurt_cause_fact: null };
}

/** Cold path, once per exchange. Order: fade → frequency → crisis → make-up progress → signals → clear. */
export function applyExchange(
  state: RelState,
  params: Params,
  a: ExchangeInput,
  cfg: RelConfig,
): Transition {
  const b = builder(state, params, cfg);
  const eps = cfg.variance_epsilon;
  fadeWithEvents(b, a.now, cfg);
  b.set("msgs_per_day", a.msgs24h, "frequency");
  b.t.params.msgs_per_day = { ...b.t.params.msgs_per_day, updated_at: a.now };

  if (a.crisis) {
    b.set("tension", 0, "crisis");
    b.t.state = {
      ...b.t.state,
      crisis_quiet_until: new Date(a.now.getTime() + cfg.crisis_quiet_hours * HOUR),
    };
    // Rule 7: no relationship friction carries through a crisis, including a pending ending.
    if (b.t.state.end_pending_since) {
      b.t.state = { ...b.t.state, end_pending_since: null };
      b.status("ending", { stage: "cleared_by_crisis" });
    }
    b.status("crisis", { suppressed: true });
    return b.t;
  }

  // The reply in this exchange was composed from the state before it: if the make-up line was due, it was offered.
  if (b.t.state.make_up_state === "due") {
    const offered = makeUpLineDue(b.t.state, cfg);
    b.t.state = {
      ...b.t.state,
      make_up_state: offered ? "offered" : "due",
      make_up_replies: b.t.state.make_up_replies + a.replies,
    };
  }

  const s = a.signals;
  if (s) {
    const dz = cfg.signal_deadzone;
    const ended = b.t.state.status === "ended_by_user";
    const repairing = b.t.state.status === "repairing";
    if (!ended) {
      for (const name of ["warmth", "trust"] as const) {
        const v = s[name];
        if (Math.abs(v) < dz) continue;
        const g = cfg.gains[name] * (v > 0 ? dim(b.t.params[name], eps) : 1);
        b.set(name, nudge(b.t.params[name].value, g * v), "signal", { signal: v });
      }
      if (s.warmth >= dz) {
        const g =
          cfg.gains.closeness_per_warm_exchange *
          dim(b.t.params.closeness, eps) *
          (repairing ? cfg.repair_gain_factor : 1);
        b.set("closeness", nudge(b.t.params.closeness.value, g), "signal", { warm_exchange: true });
      }
    }
    if (Math.abs(s.tension) >= dz)
      b.set("tension", nudge(b.t.params.tension.value, cfg.gains.tension * s.tension), "signal", {
        signal: s.tension,
      });
    if (s.hurt && s.hurt.amount >= dz) {
      const last = b.t.state.last_hurt_at;
      const sensitised =
        !!last && a.now.getTime() - last.getTime() <= cfg.sensitise_window_days * DAY;
      const amount = Math.min(
        1,
        cfg.gains.hurt * s.hurt.amount * (sensitised ? cfg.sensitise_factor : 1),
      );
      const before = b.t.params.hurt.value;
      b.set("hurt", nudge(before, amount), "signal", { signal: s.hurt.amount, sensitised });
      b.t.state = { ...b.t.state, last_hurt_at: a.now };
      if (b.t.params.hurt.value - before >= cfg.scar_threshold) {
        // a scar never recovers by itself — dent the baseline so the daily EMA doesn't erase it,
        // and dent the value too (via `set`) so current trust reads as scarred, not merely "at baseline".
        const trust = b.t.params.trust;
        b.t.params.trust = {
          ...trust,
          baseline: Math.max(0, trust.baseline - cfg.scar_trust_dent),
        };
        b.set("trust", Math.max(0, trust.value - cfg.scar_trust_dent), "scar", {
          baseline_dented: true,
        });
      }
      if (b.t.state.status !== "ended_by_user" && b.t.params.hurt.value >= cfg.make_up_threshold) {
        if (b.t.state.make_up_state === "none") {
          b.t.state = {
            ...b.t.state,
            make_up_state: "due",
            make_up_replies: 0,
            hurt_cause_fact: a.hurtFactId,
          };
        } else if (a.hurtFactId) {
          // A second hurt while a make-up is already due or offered
          // re-points hurt_cause_fact at the newest cause, so she brings up the latest hurt, not a stale
          // one from before the make-up was first offered.
          b.t.state = { ...b.t.state, hurt_cause_fact: a.hurtFactId };
        }
      }
    }
    if (s.make_up || s.apology) {
      const factor = Math.min(
        s.make_up ? cfg.make_up_relief : 1,
        s.apology ? cfg.apology_relief : 1,
      );
      relieve(b, factor, s.make_up ? "make_up" : "apology", cfg);
      b.status(s.make_up ? "make_up" : "apology", { make_up: s.make_up, apology: s.apology });
    }
    // Ending (rule 3): only these user-turn signals can move status.
    if (b.t.state.status === "active") {
      if (s.retracts_ending && b.t.state.end_pending_since) {
        b.t.state = { ...b.t.state, end_pending_since: null };
        b.status("ending", { stage: "retracted" });
      } else if (s.ends_relationship) {
        const pending = b.t.state.end_pending_since;
        if (
          pending &&
          a.exchangeAt.getTime() - pending.getTime() >= cfg.end_reconfirm_min_minutes * 60_000
        ) {
          confirmEnding(b, a.now, cfg, "signal");
        } else if (pending) {
          // a re-scored "we're done" inside the reconfirm window only restarts the pending
          // window, so continued warm chat still clears it at the timeout (the implicit retraction); a
          // genuine "I mean it" followed by silence still confirms there, and a later second statement
          // outside the window confirms by signal.
          b.t.state = { ...b.t.state, end_pending_since: a.exchangeAt };
          b.status("ending", { stage: "pending", restarted: true });
        } else {
          b.t.state = { ...b.t.state, end_pending_since: a.exchangeAt };
          b.status("ending", { stage: "pending" });
        }
      }
    } else if (b.t.state.status === "repairing" && s.ends_relationship) {
      confirmEnding(b, a.now, cfg, "signal");
    } else if (b.t.state.status === "ended_by_user" && (s.wants_repair || s.retracts_ending)) {
      // Taking the ending back after it's confirmed is a wish to repair (same slow path).
      b.t.state = { ...b.t.state, status: "repairing", repair_started_at: a.now };
      b.status("repair", { stage: "started" });
    }
  }

  if (b.t.state.make_up_state !== "none" && b.t.params.hurt.value < cfg.make_up_clear_threshold) {
    b.t.state = { ...b.t.state, make_up_state: "none", make_up_replies: 0, hurt_cause_fact: null };
  }
  return b.t;
}

/** Daily tick. Order: fade → frequency refresh → absence → baselines → ending timeout → repair → clear. */
export function applyTick(
  state: RelState,
  params: Params,
  a: TickInput,
  cfg: RelConfig,
): Transition {
  if (state.last_tick === a.localDate) return { state, params, events: [] };
  const b = builder(state, params, cfg);
  const eps = cfg.variance_epsilon;
  fadeWithEvents(b, a.now, cfg);
  b.set("msgs_per_day", a.msgs24h, "frequency");
  b.t.params.msgs_per_day = { ...b.t.params.msgs_per_day, updated_at: a.now };

  if (a.lastContact) {
    const graceMs = cfg.absence_grace_factor * a.medianGapHours * HOUR;
    if (a.now.getTime() - a.lastContact.getTime() > graceMs) {
      b.set(
        "closeness",
        Math.max(0, b.t.params.closeness.value - cfg.closeness_absence_drift),
        "absence",
      );
    }
    // Rule 3 / once she's let go, absence no longer hurts her and can't start a make-up. Closeness
    // still drifts down above (that's just distance, not a grievance).
    if (b.t.state.status !== "ended_by_user") {
      // The frequency deviation is read before today's sample dilutes the baseline.
      const e = effect({ ...b.t.params.msgs_per_day, value: a.yesterdayCount }, eps);
      if (e < cfg.absence_hurt_effect) {
        b.set(
          "hurt",
          nudge(b.t.params.hurt.value, cfg.absence_hurt_gain * Math.abs(e)),
          "absence",
          { frequency_effect: e },
        );
        if (b.t.state.make_up_state === "none" && b.t.params.hurt.value >= cfg.make_up_threshold) {
          b.t.state = {
            ...b.t.state,
            make_up_state: "due",
            make_up_replies: 0,
            hurt_cause_fact: null,
          };
        }
      }
    }
  }

  for (const n of PARAM_NAMES) {
    const x = n === "msgs_per_day" ? a.yesterdayCount : b.t.params[n].value;
    const before = b.t.params[n].baseline;
    b.t.params[n] = sampleBaseline(b.t.params[n], x, cfg.baseline_alpha);
    b.t.events.push({
      param: n,
      before,
      after: b.t.params[n].baseline,
      cause: "baseline",
      deviation: effect(b.t.params[n], eps),
      detail: { sample: x },
    });
  }

  const pending = b.t.state.end_pending_since;
  const quiet = b.t.state.crisis_quiet_until;
  const inQuiet = !!quiet && a.now.getTime() < quiet.getTime();
  // Never settle an ending inside a crisis quiet window (rule 7). At the timeout, contact after the
  // pending exchange is an implicit retraction; only silence confirms (rule 3: she lets go only if they meant it).
  if (
    b.t.state.status === "active" &&
    pending &&
    !inQuiet &&
    a.now.getTime() - pending.getTime() >= cfg.end_confirm_hours * HOUR
  ) {
    if (a.lastContact && a.lastContact.getTime() > pending.getTime()) {
      b.t.state = { ...b.t.state, end_pending_since: null };
      b.status("ending", { stage: "retracted", via: "continued_contact" });
    } else {
      confirmEnding(b, a.now, cfg, "timeout");
    }
  }
  const started = b.t.state.repair_started_at;
  if (
    b.t.state.status === "repairing" &&
    started &&
    b.t.params.closeness.value >= cfg.repair_complete_closeness &&
    a.now.getTime() - started.getTime() >= cfg.repair_min_days * DAY
  ) {
    b.t.state = { ...b.t.state, status: "active" };
    b.status("repair", { stage: "complete" });
  }
  if (b.t.state.make_up_state !== "none" && b.t.params.hurt.value < cfg.make_up_clear_threshold) {
    b.t.state = { ...b.t.state, make_up_state: "none", make_up_replies: 0, hurt_cause_fact: null };
  }
  b.t.state = { ...b.t.state, last_tick: a.localDate };
  return b.t;
}
