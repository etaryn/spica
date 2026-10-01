import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import {
  dim,
  effect,
  faded,
  fadeParams,
  nudge,
  sampleBaseline,
} from "@/core/relationship/homeostasis";
import type { Param } from "@/core/relationship/types";

const cfg = loadConfig().relationship;
const t0 = new Date("2026-01-05T10:00:00Z");
const p = (value: number, baseline: number, variance: number): Param => ({
  value,
  baseline,
  variance,
  updated_at: t0,
});

test("effect is bounded and signed by the deviation from baseline", () => {
  expect(effect(p(40, 5, 25), cfg.variance_epsilon)).toBeGreaterThan(0.99);
  expect(effect(p(5, 5, 25), cfg.variance_epsilon)).toBe(0);
  expect(effect(p(2, 30, 100), cfg.variance_epsilon)).toBeLessThan(-0.99);
});

test("frequency trace: 40 on day 1, ~36/day for 13 days, then 2", () => {
  let m = p(5, 5, 25);
  m = { ...m, value: 40 };
  expect(effect(m, cfg.variance_epsilon)).toBeGreaterThan(0.99);
  m = sampleBaseline(m, 40, cfg.baseline_alpha);
  for (let d = 0; d < 12; d++) m = sampleBaseline({ ...m, value: 36 }, 36, cfg.baseline_alpha);
  m = { ...m, value: 36 };
  expect(m.baseline).toBeGreaterThan(30);
  expect(Math.abs(effect(m, cfg.variance_epsilon))).toBeLessThan(0.5);
  expect(effect({ ...m, value: 2 }, cfg.variance_epsilon)).toBeLessThan(-0.95);
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
  };
  const f = fadeParams(params, later, cfg);
  expect(f.hurt.value).toBeCloseTo(0.4);
  expect(f.tension.value).toBeCloseTo(0.2); // 24 h half-life, 48 h elapsed
  expect(f.hurt.updated_at).toEqual(later);
  expect(f.closeness).toBe(params.closeness);
});

test("dim: positive deviation reduces a positive signal, negative doesn't amplify it", () => {
  expect(dim(p(0.9, 0.5, 0.01), cfg.variance_epsilon)).toBeLessThan(0.05);
  expect(dim(p(0.1, 0.5, 0.01), cfg.variance_epsilon)).toBe(1);
});
