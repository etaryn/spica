import type { EgoConfig } from "../config";
import { HOUR } from "../time";

export type EgoState = { mood_valence: number; mood_arousal: number; energy: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const clampState = (s: EgoState): EgoState => ({
  mood_valence: clamp(s.mood_valence, -1, 1),
  mood_arousal: clamp(s.mood_arousal, 0, 1),
  energy: clamp(s.energy, 0, 1),
});

export const stateOf = (r: EgoState): EgoState => ({
  mood_valence: r.mood_valence,
  mood_arousal: r.mood_arousal,
  energy: r.energy,
});

/** Daily energy curve in her zone, peaking at `energy_peak_hour`. */
export function rhythm(hour: number, cfg: EgoConfig): number {
  return 1 + cfg.energy_amplitude * Math.cos((2 * Math.PI * (hour - cfg.energy_peak_hour)) / 24);
}

/** Busy-weighted hours of today's busy blocks between `from` and `to`, as a fraction of a full day (quiet is rest). */
export function dayLoad(
  blocks: { start: Date; end: Date; busy: number; block: "busy" | "quiet" }[],
  from: Date,
  to: Date,
  cfg: EgoConfig,
): number {
  let sum = 0;
  for (const b of blocks) {
    if (b.block !== "busy") continue;
    const overlap =
      Math.min(b.end.getTime(), to.getTime()) - Math.max(b.start.getTime(), from.getTime());
    if (overlap > 0) sum += b.busy * (overlap / HOUR);
  }
  return clamp(sum / cfg.full_load_hours, 0, 1);
}

export function energyTarget(base: EgoState, hour: number, load: number, cfg: EgoConfig): number {
  return clamp(base.energy * rhythm(hour, cfg) - cfg.busy_drain * load, 0, 1);
}

/** One hourly step toward `target`, plus bounded noise (`noise` entries in [-1, 1], scaled by `ego.noise`). */
export function driftStep(
  s: EgoState,
  target: EgoState,
  noise: [number, number, number],
  cfg: EgoConfig,
): EgoState {
  const step = (x: number, t: number, n: number) => x + cfg.drift_rate * (t - x) + n * cfg.noise;
  return clampState({
    mood_valence: step(s.mood_valence, target.mood_valence, noise[0]),
    mood_arousal: step(s.mood_arousal, target.mood_arousal, noise[1]),
    energy: step(s.energy, target.energy, noise[2]),
  });
}

export function applyEvent(s: EgoState, valence: number, cfg: EgoConfig): EgoState {
  return clampState({
    ...s,
    mood_valence: s.mood_valence + cfg.event_gain * valence,
    mood_arousal: s.mood_arousal + cfg.event_arousal_gain * Math.abs(valence),
  });
}

/** The exchange's tone: salience-weighted mean valence of its facts with non-zero valence. */
export function exchangeTone(facts: { valence: number; salience: number }[]): number | null {
  const xs = facts.filter((f) => f.valence !== 0);
  if (xs.length === 0) return null;
  const w = xs.reduce((n, f) => n + f.salience, 0);
  if (w <= 0) return xs.reduce((n, f) => n + f.valence, 0) / xs.length;
  return xs.reduce((n, f) => n + f.valence * f.salience, 0) / w;
}

export function applyExchange(s: EgoState, tone: number, cfg: EgoConfig): EgoState {
  return clampState({
    ...s,
    mood_valence: s.mood_valence + cfg.exchange_gain * (tone - s.mood_valence),
  });
}

export function preoccupationExpired(since: Date | null, now: Date, cfg: EgoConfig): boolean {
  return !!since && now.getTime() - since.getTime() >= cfg.preoccupation_hours * HOUR;
}
