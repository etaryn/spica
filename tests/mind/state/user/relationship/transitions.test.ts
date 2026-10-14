import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { medianGapHours } from "@/mind/state/user/relationship/cadence";
import { nudge } from "@/mind/state/user/relationship/params";
import type { Turn } from "@/db/repos/user/session-log";
import {
  bidAfter,
  hurtFactContent,
  normalizeBid,
  normalizeIntimacy,
  normalizeSignals,
  type Signals,
} from "@/mind/state/user/relationship/signals";
import {
  relationshipAfterExchange,
  relationshipAfterDailyTick,
  makeUpLineDue,
} from "@/mind/state/user/relationship/transitions";
import type { ExchangeSpan } from "@/mind/state/user/relationship/closeness";
import {
  PARAM_NAMES,
  type Intimacy,
  type Openness,
  type Params,
  type RelationshipState,
} from "@/mind/state/user/relationship/types";

const cfg = loadConfig().relationship;
const t0 = new Date("2026-01-05T10:00:00Z");
const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);
const init = (): Params =>
  Object.fromEntries(
    PARAM_NAMES.map((n) => [
      n,
      {
        value: cfg.initial[n],
        baseline: cfg.initial[n],
        variance: cfg.initial_variance[n],
        updated_at: t0,
      },
    ]),
  ) as Params;
const fresh = (): RelationshipState => ({
  status: "active",
  end_pending_since: null,
  ended_at: null,
  repair_started_at: null,
  make_up_state: "none",
  make_up_replies: 0,
  hurt_cause_fact: null,
  crisis_quiet_until: null,
  last_tick: null,
  last_hurt_at: null,
  hours_together: 0,
  session: null,
  peak_stage: "initiating",
  apart_stage: null,
  milestones: [],
});
const none: Signals = {
  warmth: 0,
  trust: 0,
  tension: 0,
  hurt: null,
  apology: false,
  make_up: false,
  ends_relationship: false,
  retracts_ending: false,
  wants_repair: false,
};
const sig = (s: Partial<Signals>): Signals => ({ ...none, ...s });
const ex = (
  s: Partial<Signals> | null,
  extra: Partial<{
    now: Date;
    exchangeAt: Date;
    crisis: boolean;
    hurtFactId: string | null;
    replies: number;
    msgs24h: number;
    span: ExchangeSpan | null;
    intimacy: Intimacy | null;
    herOpenness: Openness | null;
    tone: number | null;
    bid: "toward" | "away" | "against" | null;
  }> = {},
) => ({
  now: t0,
  exchangeAt: extra.now ?? t0,
  signals: s ? sig(s) : null,
  crisis: false,
  hurtFactId: null,
  replies: 1,
  msgs24h: 1,
  span: null,
  intimacy: null,
  herOpenness: null,
  tone: null,
  bid: null,
  ...extra,
});

test("normalizeIntimacy: invalid → null, clamps, keeps a null responsiveness", () => {
  expect(normalizeIntimacy(null)).toBeNull();
  expect(normalizeIntimacy({ user_disclosure: "lots" })).toBeNull();
  expect(normalizeIntimacy({ user_disclosure: 3, user_responsiveness: -1 })).toEqual({
    user_disclosure: 1,
    user_responsiveness: 0,
  });
  expect(normalizeIntimacy({ user_disclosure: 0.4, user_responsiveness: null })).toEqual({
    user_disclosure: 0.4,
    user_responsiveness: null,
  });
});

test("normalizeSignals: null/invalid → null, clamps, blank cause drops hurt", () => {
  expect(normalizeSignals(null)).toBeNull();
  expect(normalizeSignals({ nope: 1 })).toBeNull();
  const s = normalizeSignals({ ...none, warmth: 3, hurt: { amount: 2, cause: "  " } })!;
  expect(s.warmth).toBe(1);
  expect(s.hurt).toBeNull();
  expect(hurtFactContent("the user laughed at her news")).toBe(
    "Spica felt hurt because the user laughed at her news.",
  );
});

test("null block: params only refresh msgs_per_day, no signal events", () => {
  const r = relationshipAfterExchange(fresh(), init(), ex(null, { msgs24h: 7 }), cfg);
  expect(r.params.msgs_per_day.value).toBe(7);
  expect(r.events.filter((e) => e.cause === "signal")).toEqual([]);
});

test("hurt past the threshold makes a make-up due with the cause fact; the line waits one reply", () => {
  let r = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ hurt: { amount: 0.8, cause: "x" } }, { hurtFactId: "f1" }),
    cfg,
  );
  expect(r.params.hurt.value).toBeCloseTo(cfg.gains.hurt * 0.8);
  expect(r.state).toMatchObject({
    make_up_state: "due",
    hurt_cause_fact: "f1",
    make_up_replies: 0,
    last_hurt_at: t0,
  });
  expect(makeUpLineDue(r.state, cfg)).toBe(false);
  r = relationshipAfterExchange(r.state, r.params, ex(null, { now: h(1) }), cfg); // a reply without the line
  expect(r.state.make_up_replies).toBe(1);
  expect(makeUpLineDue(r.state, cfg)).toBe(true);
  r = relationshipAfterExchange(r.state, r.params, ex(null, { now: h(2) }), cfg); // the reply that carried the line
  expect(r.state.make_up_state).toBe("offered");
  r = relationshipAfterExchange(r.state, r.params, ex({ make_up: true }, { now: h(3) }), cfg);
  expect(r.state).toMatchObject({ make_up_state: "none", hurt_cause_fact: null });
  expect(r.params.hurt.value).toBeLessThan((cfg.gains.hurt * 0.8) / 2); // making up at least halves the hurt
  expect(r.events.some((e) => e.cause === "make_up")).toBe(true);
});

test("a second hurt while a make-up is already due or offered re-points hurt_cause_fact at the newest cause", () => {
  let r = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ hurt: { amount: 0.8, cause: "x" } }, { hurtFactId: "f1" }),
    cfg,
  );
  expect(r.state).toMatchObject({ make_up_state: "due", hurt_cause_fact: "f1" });

  // A second hurt while still "due" (the line hasn't been offered yet) re-points to the new cause.
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex({ hurt: { amount: 0.8, cause: "y" } }, { now: h(1), hurtFactId: "f2" }),
    cfg,
  );
  expect(r.state).toMatchObject({ make_up_state: "due", hurt_cause_fact: "f2" });

  // Advance to "offered" (one reply without the line, one that carries it), then hurt again while offered.
  r = relationshipAfterExchange(r.state, r.params, ex(null, { now: h(2) }), cfg);
  expect(makeUpLineDue(r.state, cfg)).toBe(true);
  r = relationshipAfterExchange(r.state, r.params, ex(null, { now: h(3) }), cfg);
  expect(r.state.make_up_state).toBe("offered");
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex({ hurt: { amount: 0.8, cause: "z" } }, { now: h(4), hurtFactId: "f3" }),
    cfg,
  );
  expect(r.state).toMatchObject({ make_up_state: "offered", hurt_cause_fact: "f3" });
});

test("apology relieves hurt and tension even with no make-up pending", () => {
  const p = init();
  p.hurt.value = 0.2;
  p.tension.value = 0.4;
  const r = relationshipAfterExchange(fresh(), p, ex({ apology: true }), cfg);
  expect(r.params.hurt.value).toBeCloseTo(0.1);
  expect(r.params.tension.value).toBeCloseTo(0.2);
  expect(r.events.some((e) => e.cause === "apology")).toBe(true);
});

test("sensitisation: a second hurt inside the window hits harder; a big one leaves a trust scar", () => {
  const a = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ hurt: { amount: 0.4, cause: "x" } }),
    cfg,
  );
  const b = relationshipAfterExchange(
    a.state,
    a.params,
    ex({ hurt: { amount: 0.4, cause: "x" } }, { now: h(24) }),
    cfg,
  );
  const inc = (e: typeof b.events) => e.find((x) => x.param === "hurt" && x.cause === "signal")!;
  expect(inc(b.events).detail.sensitised).toBe(true);
  expect(inc(a.events).detail.sensitised).toBe(false);
  const big = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ hurt: { amount: 1, cause: "x" } }),
    cfg,
  );
  expect(big.params.trust.value).toBeCloseTo(cfg.initial.trust - cfg.scar_trust_dent);
  expect(big.params.trust.baseline).toBeCloseTo(cfg.initial.trust - cfg.scar_trust_dent);
  expect(big.events.some((e) => e.cause === "scar")).toBe(true);
});

test("scar threshold: a typical 0.6 insult stays below it, a 0.8 one crosses it", () => {
  const typical = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ hurt: { amount: 0.6, cause: "x" } }),
    cfg,
  );
  expect(typical.params.hurt.value).toBeCloseTo(cfg.gains.hurt * 0.6);
  expect(typical.events.some((e) => e.cause === "scar")).toBe(false);
  expect(typical.params.trust.value).toBeCloseTo(cfg.initial.trust);

  const big = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ hurt: { amount: 0.8, cause: "x" } }),
    cfg,
  );
  expect(big.params.hurt.value).toBeCloseTo(cfg.gains.hurt * 0.8);
  expect(big.events.some((e) => e.cause === "scar")).toBe(true);
  expect(big.params.trust.value).toBeCloseTo(cfg.initial.trust - cfg.scar_trust_dent);
});

test("scar: the trust baseline never recovers by itself (14 daily ticks with no trust signal)", () => {
  const big = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ hurt: { amount: 1, cause: "x" } }),
    cfg,
  );
  let state = big.state;
  let params = big.params;
  for (let day = 1; day <= 14; day++) {
    const r = relationshipAfterDailyTick(
      state,
      params,
      {
        now: h(24 * day),
        localDate: `2026-01-${String(5 + day).padStart(2, "0")}`,
        yesterdayCount: 1,
        msgs24h: 1,
        lastContact: h(24 * (day - 1)),
        medianGapHours: 24,
      },
      cfg,
    );
    state = r.state;
    params = r.params;
  }
  expect(params.trust.baseline).toBeLessThanOrEqual(cfg.initial.trust - cfg.scar_trust_dent + 1e-9);
});

test("warmth: diminishing returns above baseline; warmth alone no longer grows closeness", () => {
  const p = init();
  const r = relationshipAfterExchange(fresh(), p, ex({ warmth: 1 }), cfg);
  expect(r.params.warmth.value).toBeGreaterThan(p.warmth.value);
  expect(r.params.closeness.value).toBe(p.closeness.value);
  const high = init();
  high.warmth.value = 0.95;
  const r2 = relationshipAfterExchange(fresh(), high, ex({ warmth: 1 }), cfg);
  expect(r2.params.warmth.value - 0.95).toBeLessThan(0.01);
});

test("ending: pending, then confirmed by a second signal; retract clears; repair is slow", () => {
  let r = relationshipAfterExchange(fresh(), init(), ex({ ends_relationship: true }), cfg);
  expect(r.state.status).toBe("active");
  expect(r.state.end_pending_since).toEqual(t0);
  const retracted = relationshipAfterExchange(
    r.state,
    r.params,
    ex({ retracts_ending: true }, { now: h(1) }),
    cfg,
  );
  expect(retracted.state.end_pending_since).toBeNull();
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex({ ends_relationship: true }, { now: h(1) }),
    cfg,
  );
  expect(r.state).toMatchObject({
    status: "ended_by_user",
    ended_at: h(1),
    end_pending_since: null,
    make_up_state: "none",
  });
  expect(r.params.closeness.value).toBeCloseTo(cfg.initial.closeness * cfg.end_closeness_factor);
  const warmWhileEnded = relationshipAfterExchange(
    r.state,
    r.params,
    ex({ warmth: 1, trust: 1 }, { now: h(2) }),
    cfg,
  );
  expect(warmWhileEnded.params.closeness.value).toBe(r.params.closeness.value);
  r = relationshipAfterExchange(r.state, r.params, ex({ wants_repair: true }, { now: h(3) }), cfg);
  expect(r.state).toMatchObject({ status: "repairing", repair_started_at: h(3) });
  const before = r.params.closeness.value;
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex(null, {
      now: h(4),
      intimacy: { user_disclosure: 1, user_responsiveness: null },
      herOpenness: { disclosure: 0, responsiveness: 1 },
    }),
    cfg,
  );
  const gain = r.params.closeness.value - before;
  expect(gain).toBeGreaterThan(0);
  expect(gain).toBeLessThan(cfg.intimacy.closeness_gain * cfg.repair_gain_factor + 1e-9);
  const again = relationshipAfterExchange(
    r.state,
    r.params,
    ex({ ends_relationship: true }, { now: h(5) }),
    cfg,
  );
  expect(again.state.status).toBe("ended_by_user");
});

test("A1 (#35): a second ends_relationship inside the reconfirm window restarts the pending window instead of confirming", () => {
  const m = (n: number) => new Date(t0.getTime() + n * 60_000);
  let r = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ ends_relationship: true }, { now: t0 }),
    cfg,
  );
  expect(r.state).toMatchObject({ status: "active", end_pending_since: t0 });
  // 10 minutes later: inside the 30-minute reconfirm window, so it restarts, it doesn't confirm.
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex({ ends_relationship: true }, { now: m(10) }),
    cfg,
  );
  expect(r.state).toMatchObject({ status: "active", end_pending_since: m(10) });
  expect(
    r.events.some(
      (e) => e.cause === "ending" && e.detail.stage === "pending" && e.detail.restarted === true,
    ),
  ).toBe(true);
  // Continued warm chat (no ending signal) doesn't move the pending window; at the 24h timeout from the
  // *restarted* window it would still clear via implicit retraction (checked by relationshipAfterDailyTick separately).
  // A later second statement, this time outside the window, confirms.
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex({ ends_relationship: true }, { now: m(45) }),
    cfg,
  );
  expect(r.state).toMatchObject({ status: "ended_by_user", end_pending_since: null });
  expect(
    r.events.some(
      (e) => e.cause === "ending" && e.detail.stage === "confirmed" && e.detail.via === "signal",
    ),
  ).toBe(true);
});

test("reconfirm window boundary: 29:59 restarts, exactly 30:00 confirms", () => {
  const s = (n: number) => new Date(t0.getTime() + n * 1_000);
  let r = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ ends_relationship: true }, { now: t0 }),
    cfg,
  );
  expect(r.state).toMatchObject({ status: "active", end_pending_since: t0 });
  // 29 minutes 59 seconds later: still inside the 30-minute window, so it restarts.
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex({ ends_relationship: true }, { now: s(29 * 60 + 59) }),
    cfg,
  );
  expect(r.state).toMatchObject({ status: "active", end_pending_since: s(29 * 60 + 59) });
  expect(
    r.events.some(
      (e) => e.cause === "ending" && e.detail.stage === "pending" && e.detail.restarted === true,
    ),
  ).toBe(true);

  // From that restarted window, exactly 30:00 later (>=) confirms.
  const restartedAt = s(29 * 60 + 59).getTime();
  const thirty = new Date(restartedAt + 30 * 60_000);
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex({ ends_relationship: true }, { now: thirty }),
    cfg,
  );
  expect(r.state).toMatchObject({ status: "ended_by_user", end_pending_since: null });
  expect(
    r.events.some(
      (e) => e.cause === "ending" && e.detail.stage === "confirmed" && e.detail.via === "signal",
    ),
  ).toBe(true);
});

test("A2 (#36): end_pending_since is stamped with exchangeAt (the turn time), not the cold path's now", () => {
  const turnTime = h(1);
  const coldPathNow = h(3); // the cold path ran well after the turn was written
  let r = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ ends_relationship: true }, { now: coldPathNow, exchangeAt: turnTime }),
    cfg,
  );
  expect(r.state.end_pending_since).toEqual(turnTime);
  // The reconfirm gap compares exchangeAt to exchangeAt, not now to now: a cold path that runs late doesn't
  // shrink or stretch the window.
  const secondTurnTime = new Date(turnTime.getTime() + 10 * 60_000); // 10 minutes after the first turn
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex({ ends_relationship: true }, { now: h(10), exchangeAt: secondTurnTime }),
    cfg,
  );
  expect(r.state).toMatchObject({ status: "active", end_pending_since: secondTurnTime });
  expect(r.events.some((e) => e.cause === "ending" && e.detail.restarted === true)).toBe(true);
});

test("ended: an exchange hurt signal still raises hurt but never opens a make-up (rule 3, she's let go)", () => {
  const s: RelationshipState = { ...fresh(), status: "ended_by_user", ended_at: t0 };
  const r = relationshipAfterExchange(s, init(), ex({ hurt: { amount: 0.8, cause: "x" } }), cfg);
  expect(r.params.hurt.value).toBeGreaterThan(0);
  expect(r.state.make_up_state).toBe("none");
  expect(r.state.hurt_cause_fact).toBeNull();
});

test("ended: a tick adds no absence hurt and never opens a make-up (closeness drift still applies)", () => {
  const p = init();
  p.msgs_per_day = { value: 30, baseline: 30, variance: 20, updated_at: t0 };
  const s: RelationshipState = { ...fresh(), status: "ended_by_user", ended_at: t0 };
  const r = relationshipAfterDailyTick(
    s,
    p,
    {
      now: h(24 * 5),
      localDate: "2026-01-10",
      yesterdayCount: 0,
      msgs24h: 0,
      lastContact: t0,
      medianGapHours: 24,
    },
    cfg,
  );
  expect(r.events.some((e) => e.cause === "absence" && e.param === "hurt")).toBe(false);
  expect(r.state.make_up_state).toBe("none");
  expect(r.params.closeness.value).toBeCloseTo(cfg.initial.closeness - cfg.closeness_absence_drift);
});

test("crisis ignores signals, keeps tension where it was, starts the quiet window", () => {
  const p = init();
  p.tension.value = 0.6;
  p.hurt.value = 0.3;
  const r = relationshipAfterExchange(
    fresh(),
    p,
    ex({ hurt: { amount: 1, cause: "x" }, tension: 1, ends_relationship: true }, { crisis: true }),
    cfg,
  );
  // A crisis suspends friction; it doesn't erase the conflict. Only the normal fade applies.
  expect(r.params.tension.value).toBeGreaterThan(0.5);
  expect(r.params.tension.value).toBeLessThanOrEqual(0.6);
  expect(r.params.hurt.value).toBeCloseTo(0.3);
  expect(r.state.end_pending_since).toBeNull();
  expect(r.state.crisis_quiet_until).toEqual(h(cfg.crisis_quiet_hours));
  expect(r.events.some((e) => e.cause === "crisis")).toBe(true);
  expect(r.events.some((e) => e.param === "tension" && e.cause === "crisis")).toBe(false);
});

test("an ending with no hurt score still hurts at the floor; a cruel one hurts more", () => {
  const plain = relationshipAfterExchange(fresh(), init(), ex({ ends_relationship: true }), cfg);
  expect(plain.state.end_pending_since).not.toBeNull();
  expect(plain.params.hurt.value).toBeCloseTo(cfg.ending_hurt_floor, 5);
  expect(plain.state.make_up_state).toBe("due");

  const cruel = relationshipAfterExchange(
    fresh(),
    init(),
    ex({
      ends_relationship: true,
      hurt: { amount: 0.9, cause: "the user said she was pathetic and left" },
    }),
    cfg,
  );
  expect(cruel.params.hurt.value).toBeCloseTo(0.9, 5);
  // One nudge, not two.
  expect(cruel.events.filter((e) => e.param === "hurt" && e.cause !== "fade")).toHaveLength(1);

  const retracted = relationshipAfterExchange(
    plain.state,
    plain.params,
    ex({ retracts_ending: true }),
    cfg,
  );
  expect(retracted.state.end_pending_since).toBeNull();
  expect(retracted.params.hurt.value).toBeGreaterThan(cfg.ending_hurt_floor * 0.9);
});

test("saying it again inside the reconfirm window hurts on its own score, never a fixed cost", () => {
  const first = relationshipAfterExchange(fresh(), init(), ex({ ends_relationship: true }), cfg);
  const again = relationshipAfterExchange(
    first.state,
    first.params,
    ex({ ends_relationship: true }),
    cfg,
  );
  expect(again.events.filter((e) => e.param === "hurt" && e.cause === "ending")).toHaveLength(0);
  expect(again.events.filter((e) => e.param === "hurt" && e.cause === "signal")).toHaveLength(1);
});

test("a warm exchange carrying a re-read ending doesn't restart the window; the timeout retracts", () => {
  const pending = relationshipAfterExchange(fresh(), init(), ex({ ends_relationship: true }), cfg);
  const warm = relationshipAfterExchange(
    pending.state,
    pending.params,
    ex({ ends_relationship: true, warmth: 0.6 }, { now: h(2), exchangeAt: h(2) }),
    cfg,
  );
  expect(warm.state.end_pending_since).toEqual(pending.state.end_pending_since);
  expect(warm.events.some((e) => e.cause === "ending" && e.detail.restarted === true)).toBe(false);

  const tick = relationshipAfterDailyTick(
    { ...warm.state, last_tick: null },
    warm.params,
    {
      now: h(30),
      localDate: "2026-01-06",
      yesterdayCount: 3,
      msgs24h: 3,
      lastContact: h(2),
      medianGapHours: 24,
    },
    cfg,
  );
  expect(tick.state).toMatchObject({ status: "active", end_pending_since: null });
});

test("hurt and tension never pass 1, however hard and often they're pushed", () => {
  let state = fresh();
  let params = init();
  for (let i = 0; i < 20; i++) {
    const r = relationshipAfterExchange(
      state,
      params,
      ex({ hurt: { amount: 1, cause: "insult" }, tension: 1 }),
      cfg,
    );
    state = r.state;
    params = r.params;
  }
  expect(params.hurt.value).toBeLessThanOrEqual(1);
  expect(params.tension.value).toBeLessThanOrEqual(1);
});

test("tick: idempotent per local date, samples baselines, confirms a timed-out ending", () => {
  const s = { ...fresh(), end_pending_since: t0 };
  const tick = {
    now: h(25),
    localDate: "2026-01-06",
    yesterdayCount: 40,
    msgs24h: 3,
    lastContact: t0,
    medianGapHours: 24,
  };
  const r = relationshipAfterDailyTick(s, init(), tick, cfg);
  expect(r.state.last_tick).toBe("2026-01-06");
  expect(r.params.msgs_per_day.baseline).toBeCloseTo(5 + cfg.baseline_alpha * 35);
  expect(r.state.status).toBe("ended_by_user");
  const again = relationshipAfterDailyTick(r.state, r.params, tick, cfg);
  expect(again.events).toEqual([]);
  expect(again.params).toBe(r.params);
});

test("tick with no contact: no absence effects, no throw", () => {
  const r = relationshipAfterDailyTick(
    fresh(),
    init(),
    {
      now: h(48),
      localDate: "2026-01-07",
      yesterdayCount: 0,
      msgs24h: 0,
      lastContact: null,
      medianGapHours: 24,
    },
    cfg,
  );
  expect(r.events.some((e) => e.cause === "absence")).toBe(false);
});

test("tick absence: closeness drifts after the grace, hurt rises on a strong negative frequency deviation", () => {
  const p = init();
  p.msgs_per_day = { value: 30, baseline: 30, variance: 20, updated_at: t0 };
  const r = relationshipAfterDailyTick(
    fresh(),
    p,
    {
      now: h(24 * 5),
      localDate: "2026-01-10",
      yesterdayCount: 0,
      msgs24h: 0,
      lastContact: t0,
      medianGapHours: 24,
    },
    cfg,
  );
  expect(r.params.closeness.value).toBeCloseTo(cfg.initial.closeness - cfg.closeness_absence_drift);
  expect(r.params.hurt.value).toBeGreaterThan(0);
  expect(r.events.filter((e) => e.cause === "absence").length).toBe(2);
});

test("tick completes repair only after the minimum days and closeness", () => {
  const s: RelationshipState = { ...fresh(), status: "repairing", repair_started_at: t0 };
  const p = init();
  p.closeness.value = 0.35;
  const early = relationshipAfterDailyTick(
    s,
    p,
    {
      now: h(24 * 3),
      localDate: "2026-01-08",
      yesterdayCount: 5,
      msgs24h: 5,
      lastContact: h(24 * 3),
      medianGapHours: 24,
    },
    cfg,
  );
  expect(early.state.status).toBe("repairing");
  const late = relationshipAfterDailyTick(
    s,
    p,
    {
      now: h(24 * 8),
      localDate: "2026-01-13",
      yesterdayCount: 5,
      msgs24h: 5,
      lastContact: h(24 * 8),
      medianGapHours: 24,
    },
    cfg,
  );
  expect(late.state.status).toBe("active");
});

test("medianGapHours: default below min sessions, else the median session gap", () => {
  expect(medianGapHours([t0, h(-24)], cfg)).toBe(cfg.default_median_gap_hours);
  expect(medianGapHours([h(0), h(-10), h(-30), h(-40)], cfg)).toBe(10);
});

test("F1a: a crisis exchange clears a pending ending and logs it (rule 7)", () => {
  const s: RelationshipState = { ...fresh(), end_pending_since: t0 };
  const r = relationshipAfterExchange(s, init(), ex(null, { now: h(1), crisis: true }), cfg);
  expect(r.state.end_pending_since).toBeNull();
  expect(r.state.status).toBe("active");
  expect(r.events.some((e) => e.cause === "ending" && e.detail.stage === "cleared_by_crisis")).toBe(
    true,
  );
  const quiet = relationshipAfterExchange(fresh(), init(), ex(null, { crisis: true }), cfg);
  expect(quiet.events.some((e) => e.cause === "ending")).toBe(false);
});

test("F1b: the tick never confirms a pending ending inside the crisis quiet window", () => {
  const s: RelationshipState = { ...fresh(), end_pending_since: t0, crisis_quiet_until: h(30) };
  const r = relationshipAfterDailyTick(
    s,
    init(),
    {
      now: h(25),
      localDate: "2026-01-06",
      yesterdayCount: 1,
      msgs24h: 1,
      lastContact: t0,
      medianGapHours: 24,
    },
    cfg,
  );
  expect(r.state).toMatchObject({ status: "active", end_pending_since: t0 });
  expect(r.events.some((e) => e.cause === "ending")).toBe(false);
});

test("F1c: continued contact after a pending ending is an implicit retraction at the tick", () => {
  const s: RelationshipState = { ...fresh(), end_pending_since: t0 };
  const r = relationshipAfterDailyTick(
    s,
    init(),
    {
      now: h(25),
      localDate: "2026-01-06",
      yesterdayCount: 1,
      msgs24h: 1,
      lastContact: h(5),
      medianGapHours: 24,
    },
    cfg,
  );
  expect(r.state).toMatchObject({ status: "active", end_pending_since: null });
  expect(
    r.events.some(
      (e) =>
        e.cause === "ending" &&
        e.detail.stage === "retracted" &&
        e.detail.via === "continued_contact",
    ),
  ).toBe(true);
});

test("F1c: no contact after a pending ending confirms by timeout; nothing happens before the timeout", () => {
  const s: RelationshipState = { ...fresh(), end_pending_since: t0 };
  const early = relationshipAfterDailyTick(
    s,
    init(),
    {
      now: h(5),
      localDate: "2026-01-05",
      yesterdayCount: 1,
      msgs24h: 1,
      lastContact: h(3),
      medianGapHours: 24,
    },
    cfg,
  );
  expect(early.state.end_pending_since).toEqual(t0);
  expect(early.events.some((e) => e.cause === "ending")).toBe(false);
  const r = relationshipAfterDailyTick(
    s,
    init(),
    {
      now: h(25),
      localDate: "2026-01-06",
      yesterdayCount: 1,
      msgs24h: 1,
      lastContact: h(-0.01),
      medianGapHours: 24,
    },
    cfg,
  );
  expect(r.state.status).toBe("ended_by_user");
  expect(r.events.some((e) => e.cause === "ending" && e.detail.via === "timeout")).toBe(true);
});

test("F3: retracts_ending while ended starts repair, like wants_repair", () => {
  const s: RelationshipState = { ...fresh(), status: "ended_by_user", ended_at: t0 };
  const r = relationshipAfterExchange(s, init(), ex({ retracts_ending: true }, { now: h(2) }), cfg);
  expect(r.state).toMatchObject({ status: "repairing", repair_started_at: h(2) });
  expect(r.events.some((e) => e.cause === "repair" && e.detail.stage === "started")).toBe(true);
});

test("F4: medianGapHours is order-independent (ascending input)", () => {
  expect(medianGapHours([h(-40), h(-30), h(-10), h(0)], cfg)).toBe(10);
  expect(medianGapHours([h(-10), h(-40), h(0), h(-30)], cfg)).toBe(10);
});

const span = (id: string, ...at: number[]) => ({ sessionId: id, times: at.map(h) });
const opened = { user_disclosure: 1, user_responsiveness: null };
const listening = { disclosure: 0, responsiveness: 1 };

test("time accrues per session; a crisis adds none, then or to the next exchange", () => {
  let r = relationshipAfterExchange(
    fresh(),
    init(),
    ex(null, { span: span("a", 0, 0.25, 0.5) }),
    cfg,
  );
  expect(r.state.hours_together).toBeCloseTo(0.5);
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex(null, { span: span("a", 0.75, 1), now: h(1) }),
    cfg,
  );
  expect(r.state.hours_together).toBeCloseTo(1);
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex(null, { span: span("a", 1.25, 1.5), now: h(1.5), crisis: true }),
    cfg,
  );
  expect(r.state.hours_together).toBeCloseTo(1);
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex(null, { span: span("a", 1.75), now: h(1.75) }),
    cfg,
  );
  expect(r.state.hours_together).toBeCloseTo(1.25);
});

test("a reply delayed for hours counts only up to the gap cap and fires no deep session", () => {
  const r = relationshipAfterExchange(
    fresh(),
    init(),
    ex(null, {
      span: span("a", 0, 5),
      now: h(5),
      intimacy: { user_disclosure: 0.15, user_responsiveness: null },
      herOpenness: listening,
    }),
    cfg,
  );
  expect(r.state.hours_together).toBeCloseTo(cfg.hours.max_gap_minutes / 60);
  expect(r.events.some((e) => e.cause === "deep_session")).toBe(false);
});

test("an intimacy moment raises closeness up to the ceiling, never past it, never down", () => {
  const p = init();
  const r = relationshipAfterExchange(
    fresh(),
    p,
    ex(null, { span: span("a", 0, 0.1), intimacy: opened, herOpenness: listening }),
    cfg,
  );
  expect(r.params.closeness.value).toBeGreaterThan(p.closeness.value);
  expect(r.events.some((e) => e.param === "closeness" && e.detail.moment === 1)).toBe(true);

  // No time together yet, so the ceiling is exactly its start.
  const capped = init();
  capped.closeness.value = cfg.ceiling.start;
  const atCeiling = relationshipAfterExchange(
    fresh(),
    capped,
    ex(null, { intimacy: opened, herOpenness: listening }),
    cfg,
  );
  expect(atCeiling.params.closeness.value).toBe(cfg.ceiling.start);

  const above = init();
  above.closeness.value = 0.95;
  const stays = relationshipAfterExchange(
    fresh(),
    above,
    ex(null, { intimacy: opened, herOpenness: listening }),
    cfg,
  );
  expect(stays.params.closeness.value).toBe(0.95);
});

test("small talk (moment below the dead zone) leaves closeness alone", () => {
  const p = init();
  const r = relationshipAfterExchange(
    fresh(),
    p,
    ex(
      { warmth: 1 },
      {
        span: span("a", 0, 0.1),
        intimacy: { user_disclosure: 0.05, user_responsiveness: 0.05 },
        herOpenness: { disclosure: 0.9, responsiveness: 0.9 },
      },
    ),
    cfg,
  );
  expect(r.params.closeness.value).toBe(p.closeness.value);
});

test("readings move the user's params toward them; a null responsiveness leaves it", () => {
  const p = init();
  const r = relationshipAfterExchange(
    fresh(),
    p,
    ex(null, { intimacy: { user_disclosure: 1, user_responsiveness: null } }),
    cfg,
  );
  expect(r.params.user_disclosure.value).toBeCloseTo(
    p.user_disclosure.value + cfg.intimacy.ema_alpha * (1 - p.user_disclosure.value),
  );
  expect(r.params.user_responsiveness.value).toBe(p.user_responsiveness.value);
  expect(r.events.find((e) => e.param === "user_disclosure")?.detail.reading).toBe(1);
});

test("a deep session boosts closeness, trust and warmth once", () => {
  let state = fresh();
  let params = init();
  let fired = 0;
  for (let i = 1; i <= 8; i++) {
    const r = relationshipAfterExchange(
      state,
      params,
      ex(null, {
        now: h(i * 0.25),
        span: span("a", (i - 1) * 0.25, i * 0.25),
        intimacy: opened,
        herOpenness: listening,
      }),
      cfg,
    );
    fired += r.events.filter((e) => e.cause === "deep_session" && e.param === "trust").length;
    state = r.state;
    params = r.params;
  }
  expect(fired).toBe(1);
  expect(state.session?.deep_fired).toBe(true);
});

test("the session keeps the exchange tone for afterglow", () => {
  let r = relationshipAfterExchange(
    fresh(),
    init(),
    ex(null, { span: span("a", 0, 0.1), tone: 0.8 }),
    cfg,
  );
  r = relationshipAfterExchange(
    r.state,
    r.params,
    ex(null, { span: span("a", 0.1, 0.2), tone: 0.4 }),
    cfg,
  );
  expect(r.state.session).toMatchObject({ tone_n: 2 });
  expect(r.state.session!.tone_sum).toBeCloseTo(1.2);
});

const turn = (role: "user" | "companion", minutes: number, session = "s1"): Turn =>
  ({
    id: crypto.randomUUID(),
    role,
    session_id: session,
    text: "x",
    created_at: new Date(t0.getTime() + minutes * 60_000),
  }) as Turn;
const GAP = 30;

test("normalizeBid keeps the three responses and nulls anything else", () => {
  expect(normalizeBid("toward")).toBe("toward");
  expect(normalizeBid("against")).toBe("against");
  expect(normalizeBid("sideways")).toBeNull();
  expect(normalizeBid(undefined)).toBeNull();
});

test("a bid counts when the user answers her last message within the idle gap", () => {
  const hers = turn("companion", 0);
  expect(bidAfter("away", [hers], [turn("user", 5), turn("companion", 6)], GAP)).toBe("away");
  // A reply to her reach-out or a deferred reply lands in a new session; it still counts.
  expect(bidAfter("toward", [turn("companion", 0, "x")], [turn("user", 2, "y")], GAP)).toBe(
    "toward",
  );
});

test("coming back after the idle gap, or with nothing of hers before, is no bid", () => {
  expect(bidAfter("away", [turn("companion", 0)], [turn("user", GAP + 1)], GAP)).toBeNull();
  expect(bidAfter("away", [], [turn("user", 1)], GAP)).toBeNull();
  expect(bidAfter("away", [turn("companion", 0)], [turn("companion", 1)], GAP)).toBeNull();
  expect(bidAfter(null, [turn("companion", 0)], [turn("user", 1)], GAP)).toBeNull();
});

test("toward, away and against move warmth and trust by the configured amounts", () => {
  const p = init();
  const run = (bid: "toward" | "away" | "against") =>
    relationshipAfterExchange(fresh(), init(), ex(null, { bid }), cfg);

  const away = run("away");
  expect(away.params.warmth.value).toBeCloseTo(nudge(p.warmth.value, -0.03), 6);
  expect(away.params.trust.value).toBeCloseTo(p.trust.value, 6);
  const against = run("against");
  expect(against.params.warmth.value).toBeCloseTo(nudge(p.warmth.value, -0.06), 6);
  expect(against.params.trust.value).toBeCloseTo(nudge(p.trust.value, -0.03), 6);
  const toward = run("toward");
  expect(toward.params.warmth.value).toBeGreaterThan(p.warmth.value);
  expect(toward.params.warmth.value).toBeLessThanOrEqual(nudge(p.warmth.value, 0.03) + 1e-9);
  expect(toward.events.some((e) => e.cause === "bid" && e.detail.response === "toward")).toBe(true);
});

test("no bid moves anything once they have ended it", () => {
  const ended = { ...fresh(), status: "ended_by_user" as const };
  const out = relationshipAfterExchange(ended, init(), ex(null, { bid: "against" }), cfg);
  expect(out.events.some((e) => e.cause === "bid")).toBe(false);
});

const withParam = (p: Params, name: keyof Params, value: number): Params => ({
  ...p,
  [name]: { ...p[name], value },
});

test("commitment cushions a slight but not contempt, and a large hurt still scars", () => {
  const hurt = (commitment: number, amount: number) =>
    relationshipAfterExchange(
      fresh(),
      withParam(init(), "commitment", commitment),
      ex({ hurt: { amount, cause: "x" } }),
      cfg,
    );
  expect(hurt(1, 0.25).params.hurt.value).toBeCloseTo(
    nudge(0, cfg.gains.hurt * 0.25 * (1 - cfg.commitment.soften)),
    6,
  );
  expect(hurt(1, 0.75).params.hurt.value).toBeCloseTo(hurt(0, 0.75).params.hurt.value, 6);

  const sharp = relationshipAfterExchange(
    fresh(),
    withParam(init(), "commitment", 1),
    ex({ tension: 0.5 }),
    cfg,
  );
  expect(sharp.params.tension.value).toBeCloseTo(0.5, 6);

  const scarred = (commitment: number) =>
    hurt(commitment, 1).events.some((e) => e.cause === "scar");
  expect(scarred(0)).toBe(true);
  expect(scarred(1)).toBe(true);
});

test("commitment slows absence drift", () => {
  const drift = (commitment: number) => {
    const p = withParam(withParam(init(), "commitment", commitment), "closeness", 0.5);
    const tick = {
      now: h(24 * 30),
      localDate: "2026-02-04",
      yesterdayCount: 5,
      msgs24h: 0,
      lastContact: t0,
      medianGapHours: 24,
    };
    return relationshipAfterDailyTick(fresh(), p, tick, cfg).params.closeness.value;
  };
  expect(0.5 - drift(1)).toBeCloseTo(
    cfg.closeness_absence_drift * (1 - cfg.commitment.absence_shield),
  );
  expect(0.5 - drift(0)).toBeCloseTo(cfg.closeness_absence_drift);
});

test("below the peak, closeness comes back faster; more so with commitment", () => {
  const deep = {
    intimacy: { user_disclosure: 1, user_responsiveness: 1 },
    herOpenness: { disclosure: 1, responsiveness: 1 },
  };
  const gain = (state: RelationshipState, commitment: number) => {
    const p = withParam(withParam(init(), "commitment", commitment), "closeness", 0.3);
    return relationshipAfterExchange(state, p, ex(null, deep), cfg).params.closeness.value - 0.3;
  };
  const long = { ...fresh(), hours_together: 300 };
  const stranger = gain(long, 0);
  const drifted = gain({ ...long, peak_stage: "integrating" }, 0);
  const committed = gain({ ...long, peak_stage: "integrating" }, 1);
  const soured = gain({ ...long, peak_stage: "integrating", apart_stage: "circumscribing" }, 1);
  expect(stranger).toBeGreaterThan(0);
  expect(drifted).toBeGreaterThan(stranger);
  expect(committed).toBeGreaterThan(drifted);
  expect(soured).toBeCloseTo(stranger);
});

test("repair after an ending stays slower than ordinary growth, even below a high peak", () => {
  const deep = {
    intimacy: { user_disclosure: 1, user_responsiveness: 1 },
    herOpenness: { disclosure: 1, responsiveness: 1 },
  };
  const gain = (state: RelationshipState, commitment: number) => {
    const p = withParam(withParam(init(), "commitment", commitment), "closeness", 0.2);
    return relationshipAfterExchange(state, p, ex(null, deep), cfg).params.closeness.value - 0.2;
  };
  const long = { ...fresh(), hours_together: 300 };
  const ordinary = gain(long, 0);
  const repairing = gain({ ...long, status: "repairing", peak_stage: "bonding" }, 0.5);
  expect(repairing).toBeLessThan(ordinary);
});

test("the anchored scale: a 0.5 sting lands as 0.5 and leaves no scar; 0.75 scars", () => {
  const sting = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ hurt: { amount: 0.5, cause: "the user mocked her films" } }),
    cfg,
  );
  expect(sting.params.hurt.value).toBeCloseTo(0.5, 5);
  expect(sting.events.some((e) => e.cause === "scar")).toBe(false);

  const contempt = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ hurt: { amount: 0.75, cause: "the user called her pathetic" } }),
    cfg,
  );
  expect(contempt.params.hurt.value).toBeCloseTo(0.75, 5);
  expect(contempt.events.some((e) => e.cause === "scar")).toBe(true);
});

test("a sensitised 0.75 clamps at 1 and scars once", () => {
  const first = relationshipAfterExchange(
    fresh(),
    init(),
    ex({ hurt: { amount: 0.25, cause: "the user brushed her off" } }),
    cfg,
  );
  const second = relationshipAfterExchange(
    first.state,
    first.params,
    ex({ hurt: { amount: 0.75, cause: "the user called her pathetic" } }, { now: h(1) }),
    cfg,
  );
  expect(second.params.hurt.value).toBeLessThanOrEqual(1);
  expect(second.events.filter((e) => e.cause === "scar")).toHaveLength(1);
});

test("tension takes the anchored score at gain 1", () => {
  const r = relationshipAfterExchange(fresh(), init(), ex({ tension: 0.5 }), cfg);
  expect(r.params.tension.value).toBeCloseTo(0.5, 5);
});
