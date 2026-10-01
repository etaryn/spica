import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import {
  applyEvent,
  applyExchange,
  dayLoad,
  driftStep,
  energyTarget,
  exchangeTone,
  preoccupationExpired,
  rhythm,
} from "@/core/ego/ego";

const cfg = loadConfig().ego;
const H = 3_600_000;
const t = (h: number) => new Date(Date.UTC(2026, 0, 5) + h * H);

test("rhythm peaks at energy_peak_hour", () => {
  expect(rhythm(16, cfg)).toBeCloseTo(1 + cfg.energy_amplitude);
  expect(rhythm(4, cfg)).toBeCloseTo(1 - cfg.energy_amplitude);
});

test("dayLoad counts busy hours only, weighted by busy level, up to now", () => {
  const blocks = [
    { start: t(9), end: t(13), busy: 1, block: "busy" as const },
    { start: t(0), end: t(8), busy: 0.9, block: "quiet" as const },
  ];
  expect(dayLoad(blocks, t(0), t(11), cfg)).toBeCloseTo(2 / cfg.full_load_hours);
  expect(dayLoad(blocks, t(0), t(20), cfg)).toBeCloseTo(4 / cfg.full_load_hours);
});

test("a heavy day lowers the energy target", () => {
  const base = cfg.baseline;
  expect(energyTarget(base, 19, 1, cfg)).toBeLessThan(energyTarget(base, 19, 0, cfg) - 0.25);
});

test("driftStep moves toward the target and clamps", () => {
  const s = { mood_valence: -1, mood_arousal: 0, energy: 1 };
  const next = driftStep(s, { mood_valence: 1, mood_arousal: 1, energy: 0 }, [0, 0, 0], cfg);
  expect(next.mood_valence).toBeCloseTo(-1 + 2 * cfg.drift_rate);
  expect(next.energy).toBeCloseTo(1 - cfg.drift_rate);
  expect(
    driftStep(
      { mood_valence: 1, mood_arousal: 1, energy: 1 },
      { mood_valence: 1, mood_arousal: 1, energy: 1 },
      [1, 1, 1],
      cfg,
    ),
  ).toEqual({ mood_valence: 1, mood_arousal: 1, energy: 1 });
});

test("event and exchange nudges", () => {
  const s = { mood_valence: 0, mood_arousal: 0.4, energy: 0.6 };
  expect(applyEvent(s, 0.8, cfg).mood_valence).toBeCloseTo(0.8 * cfg.event_gain);
  expect(applyEvent(s, -0.8, cfg).mood_arousal).toBeCloseTo(0.4 + 0.8 * cfg.event_arousal_gain);
  expect(applyExchange(s, -1, cfg).mood_valence).toBeCloseTo(-cfg.exchange_gain);
});

test("exchangeTone is the salience-weighted mean of non-zero valences", () => {
  expect(exchangeTone([{ valence: 0, salience: 1 }])).toBeNull();
  expect(
    exchangeTone([
      { valence: 1, salience: 0.75 },
      { valence: -1, salience: 0.25 },
      { valence: 0, salience: 1 },
    ]),
  ).toBeCloseTo(0.5);
});

test("preoccupation expires after preoccupation_hours", () => {
  expect(preoccupationExpired(null, t(100), cfg)).toBe(false);
  expect(preoccupationExpired(t(0), t(cfg.preoccupation_hours - 1), cfg)).toBe(false);
  expect(preoccupationExpired(t(0), t(cfg.preoccupation_hours), cfg)).toBe(true);
});
