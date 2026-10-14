/**
 * The "How you're feeling" line of her reply: her current feeling and what it's about, then the
 * phrases for the dimensions of her core state and unmet needs furthest from neutral, capped,
 * never raw numbers. The phrase picked is seeded by the hour, so every user gets the same line at
 * the same time.
 */
import type { CoreStateConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { parseSummaryPhrases, type Phrases } from "@/mind/platform/phrases";
import { loadPrompt } from "@/mind/platform/prompts";
import { seededUnit } from "@/mind/platform/seeded-random";
import { HOUR } from "@/mind/platform/time";
import { moodOf } from "./core-state";
import type { CoreMood, CoreStateRow } from "./types";

const DIMS = ["energy", "mood_valence", "mood_arousal"] as const;
const NEEDS = ["autonomy", "competence"] as const;

export type FeelingInput = CoreMood & Pick<CoreStateRow, "emotion" | "needs">;

export function band(x: number, [lo, hi]: [number, number]): "low" | "neutral" | "high" {
  return x < lo ? "low" : x >= hi ? "high" : "neutral";
}

/**
 * Her feeling first, then the dimensions and needs furthest past their band, capped at
 * `maxLines`: a short, quiet line reads as background, a long one as something to talk about.
 * All neutral → null.
 */
export function coreStateLine(
  s: FeelingInput,
  cfg: CoreStateConfig,
  phrases: Phrases,
  seed: string,
  maxLines: number,
): string | null {
  const pick = (key: string, salt: string) => {
    const list = phrases[key] ?? [];
    return list.length ? list[Math.floor(seededUnit(`${seed}:${salt}`) * list.length)]! : null;
  };

  const emotion = s.emotion
    ? (pick(s.emotion.phrase ? "emotion about" : "emotion", "emotion")
        ?.replaceAll("{label}", s.emotion.label)
        .replaceAll("{about}", s.emotion.phrase ?? "") ?? null)
    : null;

  // How far past its band edge each value sits; a need only ever counts when it's low.
  const past = (x: number, [lo, hi]: [number, number]) => (x < lo ? lo - x : x - hi);
  const dims = DIMS.map((dim) => ({
    dim,
    b: band(s[dim], cfg.bands[dim]),
    by: past(s[dim], cfg.bands[dim]),
  })).filter((c) => c.b !== "neutral");
  const needs = NEEDS.map((dim) => ({
    dim,
    b: band(s.needs[dim], cfg.bands.needs),
    by: cfg.bands.needs[0] - s.needs[dim],
  })).filter((c) => c.b === "low");

  const ranked = [...dims, ...needs]
    .sort((a, b) => b.by - a.by)
    .map((c) => pick(`${c.dim} ${c.b}`, c.dim))
    .filter((p): p is string => !!p);

  const parts = [emotion, ...ranked].filter((p): p is string => !!p).slice(0, maxLines);
  return parts.length ? parts.join(" ") : null;
}

/** Hot path, read-only: the caller wraps this in a deadline and treats a failure as no line. */
export async function loadCoreStateLine(
  deps: Pick<Deps, "core" | "config">,
  now: Date,
): Promise<string | null> {
  const row = await deps.core.state.get();
  if (!row) return null;
  const phrases = parseSummaryPhrases(
    loadPrompt("core-state/line", deps.config.prompts.core_state_line),
  );
  const hourIso = new Date(Math.floor(now.getTime() / HOUR) * HOUR).toISOString();
  return coreStateLine(
    { ...moodOf(row), emotion: row.emotion, needs: row.needs },
    deps.config.core.state,
    phrases,
    `core:${hourIso}`,
    deps.config.voice.feeling_max_lines,
  );
}
