/**
 * The "How you're feeling" line of her reply: her current feeling and what it's about, then one
 * phrase per non-neutral dimension of her core state and per unmet need, never raw numbers. The phrase picked is seeded by the hour, so every user gets the same
 * line at the same time.
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

/** Her feeling, then one phrase per non-neutral dimension and low need; all neutral → null. */
export function coreStateLine(
  s: FeelingInput,
  cfg: CoreStateConfig,
  phrases: Phrases,
  seed: string,
): string | null {
  const parts: string[] = [];
  if (s.emotion) {
    const key = s.emotion.phrase ? "emotion about" : "emotion";
    const list = phrases[key] ?? [];
    if (list.length)
      parts.push(
        list[Math.floor(seededUnit(`${seed}:emotion`) * list.length)]!.replaceAll(
          "{label}",
          s.emotion.label,
        ).replaceAll("{about}", s.emotion.phrase ?? ""),
      );
  }
  for (const dim of DIMS) {
    const b = band(s[dim], cfg.bands[dim]);
    if (b === "neutral") continue;
    const list = phrases[`${dim} ${b}`] ?? [];
    if (list.length) parts.push(list[Math.floor(seededUnit(`${seed}:${dim}`) * list.length)]!);
  }
  for (const dim of NEEDS) {
    const b = band(s.needs[dim], cfg.bands.needs);
    if (b === "low") {
      const list = phrases[`${dim} ${b}`] ?? [];
      if (list.length) parts.push(list[Math.floor(seededUnit(`${seed}:${dim}`) * list.length)]!);
    }
  }
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
  );
}
