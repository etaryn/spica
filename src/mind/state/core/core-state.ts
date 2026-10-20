/**
 * Her core state's maths: an hourly drift toward her baseline with bounded noise, an energy battery
 * her busy blocks drain and free time restores, the offline switch, and the nudge a strong event
 * gives her mood. Pure functions; the tick applies them.
 */
import type { CoreStateConfig } from "@/mind/platform/config";
import { HOUR } from "@/mind/platform/time";
import type { WorldBlock } from "@/mind/world/blocks";
import type { CoreEmotion, CoreMood, CoreNeeds } from "./types";
import { clamp } from "@/mind/platform/math";

const clampMood = (s: CoreMood): CoreMood => ({
  mood_valence: clamp(s.mood_valence, -1, 1),
  mood_arousal: clamp(s.mood_arousal, 0, 1),
  energy: clamp(s.energy, 0, 1),
});

export const baselineNeeds = (cfg: CoreStateConfig): CoreNeeds => ({
  autonomy: cfg.needs_baseline,
  competence: cfg.needs_baseline,
});

/** One hour of a need going unmet. */
export function depleteNeeds(n: CoreNeeds, cfg: CoreStateConfig): CoreNeeds {
  const step = cfg.need_decay_per_day / 24;
  return { autonomy: clamp(n.autonomy - step, 0, 1), competence: clamp(n.competence - step, 0, 1) };
}

export function emotionExpired(e: CoreEmotion | null, now: Date, cfg: CoreStateConfig): boolean {
  return !!e && now.getTime() - Date.parse(e.since) >= cfg.emotion_hours * HOUR;
}

export const moodOf = (r: CoreMood): CoreMood => ({
  mood_valence: r.mood_valence,
  mood_arousal: r.mood_arousal,
  energy: r.energy,
});

/** The busy-weighted and plain fractions of [from, to) she spent in busy blocks. */
export function hourLoad(
  blocks: WorldBlock[],
  from: Date,
  to: Date,
): { load: number; covered: number } {
  const span = to.getTime() - from.getTime();
  let load = 0;
  let covered = 0;
  for (const b of blocks) {
    if (b.block !== "busy") continue;
    const overlap =
      Math.min(b.end.getTime(), to.getTime()) - Math.max(b.start.getTime(), from.getTime());
    if (overlap > 0) {
      load += (b.busy * overlap) / span;
      covered += overlap / span;
    }
  }
  return { load: clamp(load, 0, 1), covered: clamp(covered, 0, 1) };
}

/**
 * One hour of her battery: busy time drains it, free time slowly restores it, and offline restores
 * it fast. Offline, her plan doesn't happen, so its blocks don't count.
 */
export function energyStep(
  energy: number,
  hour: { load: number; covered: number },
  offline: boolean,
  noise: number,
  cfg: CoreStateConfig,
): number {
  const e = cfg.energy;
  const delta = offline
    ? e.offline_recovery_per_hour
    : -e.busy_drain_per_hour * hour.load + e.free_recovery_per_hour * (1 - hour.covered);
  return clamp(energy + delta + noise * cfg.noise, 0, 1);
}

/** Logs off below `enter`, comes back at `exit`; between them she stays as she was. */
export function nextOffline(
  offlineSince: Date | null,
  energy: number,
  now: Date,
  cfg: CoreStateConfig,
): Date | null {
  if (!offlineSince) return energy < cfg.offline.enter ? now : null;
  return energy >= cfg.offline.exit ? null : offlineSince;
}

/** When she should be back: the hour her energy reaches `exit`, never before the next tick. */
export function estimatedBack(
  row: { energy: number; last_tick: Date | null; offline_since: Date | null },
  cfg: CoreStateConfig,
): Date {
  const from = (row.last_tick ?? row.offline_since ?? new Date(0)).getTime();
  const hours = Math.ceil(
    Math.max(0, cfg.offline.exit - row.energy) / cfg.energy.offline_recovery_per_hour,
  );
  return new Date(from + Math.max(1, hours) * HOUR);
}

type Mood = Omit<CoreMood, "energy">;

/**
 * One hourly step of mood toward `target`, plus bounded noise (`noise` entries in [-1, 1], scaled
 * by `core.state.noise`). Energy is the battery's (`energyStep`), not drift's.
 */
export function driftStep(
  s: Mood,
  target: Mood,
  noise: [number, number],
  cfg: CoreStateConfig,
): Mood {
  const step = (x: number, t: number, n: number) => x + cfg.drift_rate * (t - x) + n * cfg.noise;
  return {
    mood_valence: clamp(step(s.mood_valence, target.mood_valence, noise[0]), -1, 1),
    mood_arousal: clamp(step(s.mood_arousal, target.mood_arousal, noise[1]), 0, 1),
  };
}

export function applyEvent(
  s: CoreMood,
  valence: number,
  cfg: CoreStateConfig,
  arousal = Math.abs(valence),
): CoreMood {
  return clampMood({
    ...s,
    mood_valence: s.mood_valence + cfg.event_gain * valence,
    mood_arousal: s.mood_arousal + cfg.event_arousal_gain * arousal,
  });
}

export function preoccupationExpired(since: Date | null, now: Date, cfg: CoreStateConfig): boolean {
  return !!since && now.getTime() - since.getTime() >= cfg.preoccupation_hours * HOUR;
}
