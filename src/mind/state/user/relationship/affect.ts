/**
 * Her feelings toward one user. The tone of an exchange moves how she feels about them
 * (affect) and leaves a short-lived warmth after a good one (afterglow). These live with the
 * user, never in her core mood, so one person's conversation can't change how she is with
 * everyone else.
 */
import { deviationOf, nudge } from "./params";
import type { Params, RelationshipConfig, RelationshipEvent } from "./types";

/** The exchange's tone: salience-weighted mean valence of its facts with non-zero valence. */
export function exchangeTone(facts: { valence: number; salience: number }[]): number | null {
  const xs = facts.filter((f) => f.valence !== 0);
  if (xs.length === 0) return null;
  const weight = xs.reduce((n, f) => n + f.salience, 0);
  if (weight <= 0) return xs.reduce((n, f) => n + f.valence, 0) / xs.length;
  return xs.reduce((n, f) => n + f.valence * f.salience, 0) / weight;
}

export function applyAffect(
  params: Params,
  tone: number,
  now: Date,
  settings: RelationshipConfig,
): { params: Params; events: RelationshipEvent[] } {
  const { exchange_gain, afterglow_gain } = settings.affect;
  const next = { ...params };
  const events: RelationshipEvent[] = [];
  const set = (name: "affect_valence" | "afterglow", value: number) => {
    const before = next[name].value;
    next[name] = { ...next[name], value, updated_at: now };
    events.push({
      param: name,
      before,
      after: value,
      cause: "signal",
      deviation: deviationOf(next[name], settings.variance_epsilon),
      detail: { tone },
    });
  };

  const affect = next.affect_valence.value;
  set("affect_valence", affect + exchange_gain * ((tone + 1) / 2 - affect));
  if (tone > 0) set("afterglow", nudge(next.afterglow.value, afterglow_gain * tone));
  return { params: next, events };
}
