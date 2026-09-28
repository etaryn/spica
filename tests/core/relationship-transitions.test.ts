import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { medianGapHours } from "@/core/relationship/cadence";
import { hurtFactContent, normalizeSignals, type Signals } from "@/core/relationship/signals";
import { applyExchange, applyTick, makeUpLineDue } from "@/core/relationship/transitions";
import type { Params, RelState } from "@/core/relationship/types";

const cfg = loadConfig().relationship;
const t0 = new Date("2026-01-05T10:00:00Z");
const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);
const init = (): Params => Object.fromEntries((["closeness", "trust", "warmth", "hurt", "tension", "msgs_per_day"] as const)
  .map((n) => [n, { value: cfg.initial[n], baseline: cfg.initial[n], variance: cfg.initial_variance[n], updated_at: t0 }])) as Params;
const fresh = (): RelState => ({ status: "active", end_pending_since: null, ended_at: null, repair_started_at: null, make_up_state: "none",
  make_up_replies: 0, hurt_cause_fact: null, crisis_quiet_until: null, last_tick: null, last_hurt_at: null });
const none: Signals = { warmth: 0, trust: 0, tension: 0, hurt: null, apology: false, make_up: false, ends_relationship: false, retracts_ending: false, wants_repair: false };
const sig = (s: Partial<Signals>): Signals => ({ ...none, ...s });
const ex = (s: Partial<Signals> | null, extra: Partial<{ now: Date; crisis: boolean; hurtFactId: string | null; replies: number; msgs24h: number }> = {}) =>
  ({ now: t0, signals: s ? sig(s) : null, crisis: false, hurtFactId: null, replies: 1, msgs24h: 1, ...extra });

test("normalizeSignals: null/invalid → null, clamps, blank cause drops hurt", () => {
  expect(normalizeSignals(null)).toBeNull();
  expect(normalizeSignals({ nope: 1 })).toBeNull();
  const s = normalizeSignals({ ...none, warmth: 3, hurt: { amount: 2, cause: "  " } })!;
  expect(s.warmth).toBe(1);
  expect(s.hurt).toBeNull();
  expect(hurtFactContent("the user laughed at her news")).toBe("Spica felt hurt because the user laughed at her news.");
});

test("null block: params only refresh msgs_per_day, no signal events", () => {
  const r = applyExchange(fresh(), init(), ex(null, { msgs24h: 7 }), cfg);
  expect(r.params.msgs_per_day.value).toBe(7);
  expect(r.events.filter((e) => e.cause === "signal")).toEqual([]);
});

test("hurt past the threshold makes a make-up due with the cause fact; the line waits one reply", () => {
  let r = applyExchange(fresh(), init(), ex({ hurt: { amount: 0.8, cause: "x" } }, { hurtFactId: "f1" }), cfg);
  expect(r.params.hurt.value).toBeCloseTo(0.32);
  expect(r.state).toMatchObject({ make_up_state: "due", hurt_cause_fact: "f1", make_up_replies: 0, last_hurt_at: t0 });
  expect(makeUpLineDue(r.state, cfg)).toBe(false);
  r = applyExchange(r.state, r.params, ex(null, { now: h(1) }), cfg); // a reply without the line
  expect(r.state.make_up_replies).toBe(1);
  expect(makeUpLineDue(r.state, cfg)).toBe(true);
  r = applyExchange(r.state, r.params, ex(null, { now: h(2) }), cfg); // the reply that carried the line
  expect(r.state.make_up_state).toBe("offered");
  r = applyExchange(r.state, r.params, ex({ make_up: true }, { now: h(3) }), cfg);
  expect(r.state).toMatchObject({ make_up_state: "none", hurt_cause_fact: null });
  expect(r.params.hurt.value).toBeLessThan(0.15);
  expect(r.events.some((e) => e.cause === "make_up")).toBe(true);
});

test("apology relieves hurt and tension even with no make-up pending", () => {
  const p = init();
  p.hurt.value = 0.2; p.tension.value = 0.4;
  const r = applyExchange(fresh(), p, ex({ apology: true }), cfg);
  expect(r.params.hurt.value).toBeCloseTo(0.1);
  expect(r.params.tension.value).toBeCloseTo(0.2);
  expect(r.events.some((e) => e.cause === "apology")).toBe(true);
});

test("sensitisation: a second hurt inside the window hits harder; a big one leaves a trust scar", () => {
  const a = applyExchange(fresh(), init(), ex({ hurt: { amount: 0.4, cause: "x" } }), cfg);
  const b = applyExchange(a.state, a.params, ex({ hurt: { amount: 0.4, cause: "x" } }, { now: h(24) }), cfg);
  const inc = (e: typeof b.events) => e.find((x) => x.param === "hurt" && x.cause === "signal")!;
  expect(inc(b.events).detail.sensitised).toBe(true);
  expect(inc(a.events).detail.sensitised).toBe(false);
  const big = applyExchange(fresh(), init(), ex({ hurt: { amount: 1, cause: "x" } }), cfg);
  expect(big.params.trust.baseline).toBeCloseTo(cfg.initial.trust - cfg.scar_trust_dent);
  expect(big.events.some((e) => e.cause === "scar")).toBe(true);
});

test("warmth: diminishing returns above baseline; warm exchange grows closeness", () => {
  const p = init();
  const r = applyExchange(fresh(), p, ex({ warmth: 1 }), cfg);
  expect(r.params.warmth.value).toBeGreaterThan(p.warmth.value);
  expect(r.params.closeness.value).toBeGreaterThan(p.closeness.value);
  const high = init();
  high.warmth.value = 0.95;
  const r2 = applyExchange(fresh(), high, ex({ warmth: 1 }), cfg);
  expect(r2.params.warmth.value - 0.95).toBeLessThan(0.01);
});

test("ending: pending, then confirmed by a second signal; retract clears; repair is slow", () => {
  let r = applyExchange(fresh(), init(), ex({ ends_relationship: true }), cfg);
  expect(r.state.status).toBe("active");
  expect(r.state.end_pending_since).toEqual(t0);
  const retracted = applyExchange(r.state, r.params, ex({ retracts_ending: true }, { now: h(1) }), cfg);
  expect(retracted.state.end_pending_since).toBeNull();
  r = applyExchange(r.state, r.params, ex({ ends_relationship: true }, { now: h(1) }), cfg);
  expect(r.state).toMatchObject({ status: "ended_by_user", ended_at: h(1), end_pending_since: null, make_up_state: "none" });
  expect(r.params.closeness.value).toBeCloseTo(cfg.initial.closeness * cfg.end_closeness_factor);
  const warmWhileEnded = applyExchange(r.state, r.params, ex({ warmth: 1, trust: 1 }, { now: h(2) }), cfg);
  expect(warmWhileEnded.params.closeness.value).toBe(r.params.closeness.value);
  r = applyExchange(r.state, r.params, ex({ wants_repair: true }, { now: h(3) }), cfg);
  expect(r.state).toMatchObject({ status: "repairing", repair_started_at: h(3) });
  const before = r.params.closeness.value;
  r = applyExchange(r.state, r.params, ex({ warmth: 1 }, { now: h(4) }), cfg);
  const gain = r.params.closeness.value - before;
  expect(gain).toBeGreaterThan(0);
  expect(gain).toBeLessThan(cfg.gains.closeness_per_warm_exchange * cfg.repair_gain_factor + 1e-9);
  const again = applyExchange(r.state, r.params, ex({ ends_relationship: true }, { now: h(5) }), cfg);
  expect(again.state.status).toBe("ended_by_user");
});

test("crisis ignores signals, resets tension, starts the quiet window", () => {
  const p = init();
  p.tension.value = 0.6; p.hurt.value = 0.3;
  const r = applyExchange(fresh(), p, ex({ hurt: { amount: 1, cause: "x" }, tension: 1, ends_relationship: true }, { crisis: true }), cfg);
  expect(r.params.tension.value).toBe(0);
  expect(r.params.hurt.value).toBeCloseTo(0.3);
  expect(r.state.end_pending_since).toBeNull();
  expect(r.state.crisis_quiet_until).toEqual(h(cfg.crisis_quiet_hours));
  expect(r.events.some((e) => e.cause === "crisis")).toBe(true);
});

test("tick: idempotent per local date, samples baselines, confirms a timed-out ending", () => {
  const s = { ...fresh(), end_pending_since: t0 };
  const tick = { now: h(25), localDate: "2026-01-06", yesterdayCount: 40, msgs24h: 3, lastContact: t0, medianGapHours: 24 };
  const r = applyTick(s, init(), tick, cfg);
  expect(r.state.last_tick).toBe("2026-01-06");
  expect(r.params.msgs_per_day.baseline).toBeCloseTo(5 + cfg.baseline_alpha * 35);
  expect(r.state.status).toBe("ended_by_user");
  const again = applyTick(r.state, r.params, tick, cfg);
  expect(again.events).toEqual([]);
  expect(again.params).toBe(r.params);
});

test("tick with no contact: no absence effects, no throw", () => {
  const r = applyTick(fresh(), init(), { now: h(48), localDate: "2026-01-07", yesterdayCount: 0, msgs24h: 0, lastContact: null, medianGapHours: 24 }, cfg);
  expect(r.events.some((e) => e.cause === "absence")).toBe(false);
});

test("tick absence: closeness drifts after the grace, hurt rises on a strong negative frequency deviation", () => {
  const p = init();
  p.msgs_per_day = { value: 30, baseline: 30, variance: 20, updated_at: t0 };
  const r = applyTick(fresh(), p, { now: h(24 * 5), localDate: "2026-01-10", yesterdayCount: 0, msgs24h: 0, lastContact: t0, medianGapHours: 24 }, cfg);
  expect(r.params.closeness.value).toBeCloseTo(cfg.initial.closeness - cfg.closeness_absence_drift);
  expect(r.params.hurt.value).toBeGreaterThan(0);
  expect(r.events.filter((e) => e.cause === "absence").length).toBe(2);
});

test("tick completes repair only after the minimum days and closeness", () => {
  const s: RelState = { ...fresh(), status: "repairing", repair_started_at: t0 };
  const p = init();
  p.closeness.value = 0.35;
  const early = applyTick(s, p, { now: h(24 * 3), localDate: "2026-01-08", yesterdayCount: 5, msgs24h: 5, lastContact: h(24 * 3), medianGapHours: 24 }, cfg);
  expect(early.state.status).toBe("repairing");
  const late = applyTick(s, p, { now: h(24 * 8), localDate: "2026-01-13", yesterdayCount: 5, msgs24h: 5, lastContact: h(24 * 8), medianGapHours: 24 }, cfg);
  expect(late.state.status).toBe("active");
});

test("medianGapHours: default below min sessions, else the median session gap", () => {
  expect(medianGapHours([t0, h(-24)], cfg)).toBe(cfg.default_median_gap_hours);
  expect(medianGapHours([h(0), h(-10), h(-30), h(-40)], cfg)).toBe(10);
});
