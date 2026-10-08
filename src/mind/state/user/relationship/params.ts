/**
 * The maths of a homeostatic param: how far it sits from this user's baseline, how the baseline
 * learns from daily samples, how a nudge moves it, and how hurt, tension and afterglow fade on
 * their own.
 */
import { HOUR } from "@/mind/platform/time";
import type { HomeostaticParam, Params, RelationshipConfig } from "./types";
import { clamp } from "@/mind/platform/math";

/** How far the value sits from this user's baseline, in units of its variance, within (-1, 1). */
export function deviationOf(param: HomeostaticParam, epsilon: number): number {
  return Math.tanh((param.value - param.baseline) / Math.sqrt(param.variance + epsilon));
}

/** One daily sample: an exponential moving average and an exponentially weighted variance. */
export function sampleBaseline(
  param: HomeostaticParam,
  sample: number,
  alpha: number,
): HomeostaticParam {
  const difference = sample - param.baseline;
  return {
    ...param,
    baseline: param.baseline + alpha * difference,
    variance: (1 - alpha) * (param.variance + alpha * difference * difference),
  };
}

/** A saturating move: each step closes that fraction of the gap to 1 (or to 0, going down). */
export function nudge(value: number, delta: number): number {
  const moved = delta >= 0 ? value + delta * (1 - value) : value + delta * value;
  return clamp(moved, 0, 1);
}

export function faded(value: number, from: Date, to: Date, halfLifeHours: number): number {
  const hours = Math.max(0, (to.getTime() - from.getTime()) / HOUR);
  return value * 0.5 ** (hours / halfLifeHours);
}

/** Hurt, tension and afterglow fade on their own; every other param holds its value. */
export function fadeParams(params: Params, now: Date, settings: RelationshipConfig): Params {
  const fade = (name: "hurt" | "tension" | "afterglow", halfLifeHours: number) => {
    const param = params[name];
    return {
      ...param,
      value: faded(param.value, param.updated_at, now, halfLifeHours),
      updated_at: now,
    };
  };

  return {
    ...params,
    hurt: fade("hurt", settings.hurt_half_life_hours),
    tension: fade("tension", settings.tension_half_life_hours),
    afterglow: fade("afterglow", settings.affect.afterglow_half_life_hours),
  };
}

/** Diminishing returns: warmth from someone who is always warm counts for less. */
export function diminishingReturns(param: HomeostaticParam, epsilon: number): number {
  return 1 - Math.max(0, deviationOf(param, epsilon));
}
