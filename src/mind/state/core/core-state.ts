/**
 * Her core state's maths: an hourly drift toward her baseline with bounded noise, an energy rhythm
 * in her own hours, drain from busy blocks, and the nudge a strong event gives her mood. Pure
 * functions; the tick applies them.
 */
import type { CoreStateConfig } from "@/mind/platform/config";
import { HOUR } from "@/mind/platform/time";
import type { WorldBlock } from "@/mind/world/blocks";
import type { CoreEmotion, CoreMood, CoreNeeds } from "./types";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
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

/** Daily energy curve in her zone, peaking at `energy_peak_hour`. */
export function rhythm(hour: number, cfg: CoreStateConfig): number {
  return 1 + cfg.energy_amplitude * Math.cos((2 * Math.PI * (hour - cfg.energy_peak_hour)) / 24);
}

/** Busy-weighted hours of today's busy blocks between `from` and `to`, as a fraction of a full day (quiet is rest). */
export function dayLoad(blocks: WorldBlock[], from: Date, to: Date, cfg: CoreStateConfig): number {
  let sum = 0;
  for (const b of blocks) {
    if (b.block !== "busy") continue;
    const overlap =
      Math.min(b.end.getTime(), to.getTime()) - Math.max(b.start.getTime(), from.getTime());
    if (overlap > 0) sum += b.busy * (overlap / HOUR);
  }
  return clamp(sum / cfg.full_load_hours, 0, 1);
}

export function energyTarget(
  base: CoreMood,
  hour: number,
  load: number,
  cfg: CoreStateConfig,
): number {
  return clamp(base.energy * rhythm(hour, cfg) - cfg.busy_drain * load, 0, 1);
}

/** One hourly step toward `target`, plus bounded noise (`noise` entries in [-1, 1], scaled by `core.state.noise`). */
export function driftStep(
  s: CoreMood,
  target: CoreMood,
  noise: [number, number, number],
  cfg: CoreStateConfig,
): CoreMood {
  const step = (x: number, t: number, n: number) => x + cfg.drift_rate * (t - x) + n * cfg.noise;
  return clampMood({
    mood_valence: step(s.mood_valence, target.mood_valence, noise[0]),
    mood_arousal: step(s.mood_arousal, target.mood_arousal, noise[1]),
    energy: step(s.energy, target.energy, noise[2]),
  });
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
