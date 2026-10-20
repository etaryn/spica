import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  applyEvent,
  baselineNeeds,
  depleteNeeds,
  driftStep,
  energyStep,
  estimatedBack,
  hourLoad,
  nextOffline,
  preoccupationExpired,
  emotionExpired,
} from "@/mind/state/core/core-state";

const cfg = loadConfig().core.state;
const H = 3_600_000;
const t = (h: number) => new Date(Date.UTC(2026, 0, 5) + h * H);

test("hourLoad weighs the busy part of the hour", () => {
  const blocks = [
    { key: "k1", label: "x", start: t(9), end: t(9.5), busy: 0.8, block: "busy" as const },
  ];
  expect(hourLoad(blocks, t(9), t(10))).toEqual({ load: 0.4, covered: 0.5 });
  expect(hourLoad(blocks, t(11), t(12))).toEqual({ load: 0, covered: 0 });
});

test("energy drains with busy hours, recovers slowly when free and fast when offline", () => {
  const e = cfg.energy;
  expect(energyStep(0.5, { load: 1, covered: 1 }, false, 0, cfg)).toBeCloseTo(
    0.5 - e.busy_drain_per_hour,
  );
  expect(energyStep(0.5, { load: 0, covered: 0 }, false, 0, cfg)).toBeCloseTo(
    0.5 + e.free_recovery_per_hour,
  );
  // Offline: her plan doesn't happen, so a busy hour neither drains nor counts.
  expect(energyStep(0.5, { load: 1, covered: 1 }, true, 0, cfg)).toBeCloseTo(
    0.5 + e.offline_recovery_per_hour,
  );
  expect(energyStep(0.99, { load: 0, covered: 0 }, true, 1, cfg)).toBe(1);
});

test("she logs off below enter and comes back at exit, with no flicker between", () => {
  const now = t(14);
  expect(nextOffline(null, cfg.offline.enter - 0.01, now, cfg)).toEqual(now);
  expect(nextOffline(null, cfg.offline.enter + 0.01, now, cfg)).toBeNull();
  const since = t(10);
  expect(nextOffline(since, (cfg.offline.enter + cfg.offline.exit) / 2, now, cfg)).toEqual(since);
  expect(nextOffline(since, cfg.offline.exit, now, cfg)).toBeNull();
});

test("estimatedBack is the hour energy reaches exit, never before the next tick", () => {
  const rate = cfg.energy.offline_recovery_per_hour;
  const hours = Math.ceil((cfg.offline.exit - 0.2) / rate);
  expect(estimatedBack({ energy: 0.2, last_tick: t(14), offline_since: t(14) }, cfg)).toEqual(
    t(14 + hours),
  );
  expect(
    estimatedBack({ energy: cfg.offline.exit, last_tick: t(14), offline_since: t(10) }, cfg),
  ).toEqual(t(15));
});

test("driftStep moves mood toward the target and clamps; energy is the battery's, not drift's", () => {
  const s = { mood_valence: -1, mood_arousal: 0 };
  const next = driftStep(s, { mood_valence: 1, mood_arousal: 1 }, [0, 0], cfg);
  expect(next.mood_valence).toBeCloseTo(-1 + 2 * cfg.drift_rate);
  expect(next).not.toHaveProperty("energy");
  expect(
    driftStep(
      { mood_valence: 1, mood_arousal: 1 },
      { mood_valence: 1, mood_arousal: 1 },
      [1, 1],
      cfg,
    ),
  ).toEqual({ mood_valence: 1, mood_arousal: 1 });
});

test("event nudges", () => {
  const s = { mood_valence: 0, mood_arousal: 0.4, energy: 0.6 };
  expect(applyEvent(s, 0.8, cfg).mood_valence).toBeCloseTo(0.8 * cfg.event_gain);
  expect(applyEvent(s, -0.8, cfg).mood_arousal).toBeCloseTo(0.4 + 0.8 * cfg.event_arousal_gain);
});

test("preoccupation expires after preoccupation_hours", () => {
  expect(preoccupationExpired(null, t(100), cfg)).toBe(false);
  expect(preoccupationExpired(t(0), t(cfg.preoccupation_hours - 1), cfg)).toBe(false);
  expect(preoccupationExpired(t(0), t(cfg.preoccupation_hours), cfg)).toBe(true);
});

test("needs deplete by a day's rate over 24 hours and never go below 0", () => {
  const after = depleteNeeds({ autonomy: 0.5, competence: 0.001 }, cfg);
  expect(after.autonomy).toBeCloseTo(0.5 - cfg.need_decay_per_day / 24);
  expect(after.competence).toBe(0);
  expect(baselineNeeds(cfg)).toEqual({
    autonomy: cfg.needs_baseline,
    competence: cfg.needs_baseline,
  });
});

test("an emotion expires after emotion_hours", () => {
  const since = new Date("2026-01-05T00:00:00Z");
  const e = {
    label: "giddy",
    valence: 0.6,
    arousal: 0.7,
    phrase: null,
    about: null,
    since: since.toISOString(),
  };
  const at = (h: number) => new Date(since.getTime() + h * H);
  expect(emotionExpired(e, at(cfg.emotion_hours - 1), cfg)).toBe(false);
  expect(emotionExpired(e, at(cfg.emotion_hours), cfg)).toBe(true);
  expect(emotionExpired(null, at(100), cfg)).toBe(false);
});
