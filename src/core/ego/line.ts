import { getIdentityRow } from "@/db/repos/identity";
import type { EgoConfig } from "../config";
import type { Deps } from "../deps";
import { loadPrompt } from "../prompts";
import { parseSummaryPhrases, type Phrases } from "../relationship/summary";
import { HOUR } from "../time";
import { seededUnit } from "../turn/pacing";
import { stateOf, type EgoState } from "./ego";

const DIMS = ["energy", "mood_valence", "mood_arousal"] as const;

export function band(x: number, [lo, hi]: [number, number]): "low" | "neutral" | "high" {
  return x < lo ? "low" : x >= hi ? "high" : "neutral";
}

/** Slot 2: one phrase per non-neutral dimension, never raw numbers; all neutral → null. */
export function egoLine(s: EgoState, cfg: EgoConfig, phrases: Phrases, seed: string): string | null {
  const parts: string[] = [];
  for (const dim of DIMS) {
    const b = band(s[dim], cfg.bands[dim]);
    if (b === "neutral") continue;
    const list = phrases[`${dim} ${b}`] ?? [];
    if (list.length) parts.push(list[Math.floor(seededUnit(`${seed}:${dim}`) * list.length)]!);
  }
  return parts.length ? parts.join(" ") : null;
}

/** Hot path, read-only: the caller wraps this in `withTimeout` and treats a failure as no line. */
export async function loadEgoLine(deps: Pick<Deps, "db" | "config">, userId: string, now: Date): Promise<string | null> {
  const row = await getIdentityRow(deps.db, userId);
  if (!row) return null;
  const phrases = parseSummaryPhrases(loadPrompt("ego/line", deps.config.prompts.ego_line));
  const hourIso = new Date(Math.floor(now.getTime() / HOUR) * HOUR).toISOString();
  return egoLine(stateOf(row), deps.config.ego, phrases, `${userId}:${hourIso}`);
}
