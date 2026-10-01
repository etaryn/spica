/**
 * The per-user mood maths the legacy life tick still uses: the nudge a generated event gives her
 * mood. Goes away with that tick.
 */
import type { EgoConfig } from "@/mind/platform/config";

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

export function applyEvent(s: EgoState, valence: number, cfg: EgoConfig): EgoState {
  return clampState({
    ...s,
    mood_valence: s.mood_valence + cfg.event_gain * valence,
    mood_arousal: s.mood_arousal + cfg.event_arousal_gain * Math.abs(valence),
  });
}
