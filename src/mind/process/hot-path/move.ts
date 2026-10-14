/**
 * What she does with this reply: just react, say something of hers, or ask. Picked by weighted
 * chance so her replies stop falling into one shape, seeded by the turn so a retry picks the same
 * move. Her mood and how she feels about this user tilt the odds: worn out means more reacting,
 * hurt or prickly means less sharing and asking.
 */
import * as relationshipRepo from "@/db/repos/user/relationship";
import type { Config, VoiceConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { seededUnit } from "@/mind/platform/seeded-random";
import { moodOf } from "@/mind/state/core/core-state";
import { band } from "@/mind/state/core/line";
import { deviationOf, fadeParams } from "@/mind/state/user/relationship/params";
import type { Params } from "@/mind/state/user/relationship/types";

export type Move = "react" | "share" | "ask";
export const MOVES: readonly Move[] = ["react", "share", "ask"];
export type MoveBias = VoiceConfig["moves"]["bias"][string];

const CORE_DIMS = ["energy", "mood_valence", "mood_arousal"] as const;
const USER_PARAMS = ["hurt", "tension"] as const;

/** "energy low", "hurt above" and so on: the states that can tilt how she texts right now. */
export function moodKeys(
  core: { energy: number; mood_valence: number; mood_arousal: number } | null,
  params: Params | null,
  config: Config,
): string[] {
  const keys: string[] = [];
  if (core)
    for (const dim of CORE_DIMS) {
      const b = band(core[dim], config.core.state.bands[dim]);
      if (b !== "neutral") keys.push(`${dim} ${b}`);
    }
  if (params)
    for (const name of USER_PARAMS) {
      const d = deviationOf(params[name], config.relationship.variance_epsilon);
      if (d >= config.relationship.summary_min_effect) keys.push(`${name} above`);
    }
  return keys;
}

/** Hot path, read-only: fades are applied in memory, never written. */
export async function loadMoodKeys(
  deps: Pick<Deps, "db" | "core" | "config">,
  userId: string,
  now: Date,
): Promise<string[]> {
  const row = await deps.core.state.get();
  const params = fadeParams(
    await relationshipRepo.getParams(deps.db, userId),
    now,
    deps.config.relationship,
  );
  return moodKeys(row ? moodOf(row) : null, params, deps.config);
}

export function biasesFor(keys: string[], cfg: VoiceConfig): MoveBias[] {
  return keys.map((k) => cfg.moves.bias[k]).filter((b): b is MoveBias => !!b);
}

export function bandShiftOf(biases: MoveBias[]): number {
  return biases.reduce((sum, b) => sum + (b.band_shift ?? 0), 0);
}

export function pickMove(seed: string, weights: Record<Move, number>, biases: MoveBias[]): Move {
  const w = MOVES.map((m) => biases.reduce((x, b) => x * (b[m] ?? 1), weights[m]));
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return "react";
  let r = seededUnit(seed) * total;
  for (let i = 0; i < MOVES.length; i++) {
    r -= w[i]!;
    if (r < 0) return MOVES[i]!;
  }
  return MOVES.at(-1)!;
}
