import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  diminishingReturns,
  deviationOf,
  faded,
  fadeParams,
  nudge,
  sampleBaseline,
} from "@/mind/state/user/relationship/params";
import type { HomeostaticParam } from "@/mind/state/user/relationship/types";

const cfg = loadConfig().relationship;
const t0 = new Date("2026-01-05T10:00:00Z");
const p = (value: number, baseline: number, variance: number): HomeostaticParam => ({
  value,
  baseline,
  variance,
  updated_at: t0,
});

test("deviationOf is bounded and signed by the deviation from baseline", () => {
  expect(deviationOf(p(40, 5, 25), cfg.variance_epsilon)).toBeGreaterThan(0.99);
  expect(deviationOf(p(5, 5, 25), cfg.variance_epsilon)).toBe(0);
  expect(deviationOf(p(2, 30, 100), cfg.variance_epsilon)).toBeLessThan(-0.99);
});

test("frequency trace: 40 on day 1, ~36/day for 13 days, then 2", () => {
  let m = p(5, 5, 25);
  m = { ...m, value: 40 };
  expect(deviationOf(m, cfg.variance_epsilon)).toBeGreaterThan(0.99);
  m = sampleBaseline(m, 40, cfg.baseline_alpha);
  for (let d = 0; d < 12; d++) m = sampleBaseline({ ...m, value: 36 }, 36, cfg.baseline_alpha);
  m = { ...m, value: 36 };
  expect(m.baseline).toBeGreaterThan(30);
  expect(Math.abs(deviationOf(m, cfg.variance_epsilon))).toBeLessThan(0.5);
  expect(deviationOf({ ...m, value: 2 }, cfg.variance_epsilon)).toBeLessThan(-0.95);
});

test("nudge saturates toward 1 and 0 and never leaves [0,1]", () => {
  expect(nudge(0.5, 0.5)).toBeCloseTo(0.75);
  expect(nudge(0.5, -0.5)).toBeCloseTo(0.25);
  expect(nudge(0.99, 1)).toBeLessThanOrEqual(1);
  expect(nudge(0, -1)).toBe(0);
});

test("faded halves per half-life; fadeParams touches only hurt and tension", () => {
  const later = new Date(t0.getTime() + 48 * 3_600_000);
  expect(faded(0.8, t0, later, 48)).toBeCloseTo(0.4);
  const params = {
    closeness: p(0.3, 0.3, 0.01),
    trust: p(0.4, 0.4, 0.01),
    warmth: p(0.5, 0.5, 0.02),
    hurt: p(0.8, 0, 0.01),
    tension: p(0.8, 0, 0.01),
    msgs_per_day: p(5, 5, 25),
    affect_valence: p(0.5, 0.5, 0.01),
    afterglow: p(0, 0, 0.01),
    user_disclosure: p(0.2, 0.2, 0.01),
    user_responsiveness: p(0.5, 0.5, 0.01),
    commitment: p(0, 0, 0.01),
  };
  const f = fadeParams(params, later, cfg);
  expect(f.hurt.value).toBeCloseTo(0.4);
  expect(f.tension.value).toBeCloseTo(0.2); // 24 h half-life, 48 h elapsed
  expect(f.hurt.updated_at).toEqual(later);
  expect(f.closeness).toBe(params.closeness);
});

test("diminishingReturns: positive deviation reduces a positive signal, negative doesn't amplify it", () => {
  expect(diminishingReturns(p(0.9, 0.5, 0.01), cfg.variance_epsilon)).toBeLessThan(0.05);
  expect(diminishingReturns(p(0.1, 0.5, 0.01), cfg.variance_epsilon)).toBe(1);
});
