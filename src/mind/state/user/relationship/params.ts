import { HOUR } from "@/mind/platform/time";
import type { Param, Params, RelConfig } from "./types";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** bounded deviation from this user's own baseline. */
export function effect(p: Param, eps: number): number {
  return Math.tanh((p.value - p.baseline) / Math.sqrt(p.variance + eps));
}

/** One daily sample: exponential moving average and exponentially weighted variance. */
export function sampleBaseline(p: Param, x: number, alpha: number): Param {
  const d = x - p.baseline;
  return {
    ...p,
    baseline: p.baseline + alpha * d,
    variance: (1 - alpha) * (p.variance + alpha * d * d),
  };
}

/** Saturating move: a step closes that fraction of the gap to 1 (or to 0). */
export function nudge(v: number, delta: number): number {
  return clamp01(delta >= 0 ? v + delta * (1 - v) : v + delta * v);
}

export function faded(value: number, from: Date, to: Date, halfLifeHours: number): number {
  const hours = Math.max(0, (to.getTime() - from.getTime()) / HOUR);
  return value * 0.5 ** (hours / halfLifeHours);
}

/** Hurt and tension fade on their own; other params hold their value. */
export function fadeParams(params: Params, now: Date, cfg: RelConfig): Params {
  const fade = (name: "hurt" | "tension", hl: number) => {
    const q = params[name];
    return { ...q, value: faded(q.value, q.updated_at, now, hl), updated_at: now };
  };
  return {
    ...params,
    hurt: fade("hurt", cfg.hurt_half_life_hours),
    tension: fade("tension", cfg.tension_half_life_hours),
  };
}

/** Diminishing returns: warmth from someone always warm counts for less. */
export function dim(p: Param, eps: number): number {
  return 1 - Math.max(0, effect(p, eps));
}
