/**
 * The relationship summary: the "You and them" section of her reply prompt. It turns the params'
 * deviations from this user's baseline into a few phrases (never numbers): status first, then
 * the strongest deviations, then the make-up line. The phrases live in a prompt file.
 */
import { getFact } from "@/db/repos/facts";
import * as relationshipRepo from "@/db/repos/relationship";
import type { Deps } from "@/mind/platform/deps";
import { loadPrompt } from "@/mind/platform/prompts";
import { deviationOf, fadeParams } from "./params";
import { makeUpLineDue } from "./transitions";
import {
  PARAM_NAMES,
  type ParamName,
  type Params,
  type RelationshipConfig,
  type RelationshipState,
} from "./types";

/** Phrase lists by heading, parsed from a prompt file of `## heading` and `- phrase` lines. */
export type Phrases = Record<string, string[]>;

export function parseSummaryPhrases(markdown: string): Phrases {
  const phrases: Phrases = {};
  let heading: string | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();

    const headingMatch = /^##\s+(.+)$/.exec(line);
    if (headingMatch) {
      heading = headingMatch[1]!.trim();
      phrases[heading] = [];
      continue;
    }

    const itemMatch = /^-\s+(.+)$/.exec(line);
    if (heading && itemMatch) phrases[heading]!.push(itemMatch[1]!.trim());
  }
  return phrases;
}

function firstPhrase(phrases: Phrases, key: string): string | null {
  return phrases[key]?.[0] ?? null;
}

/**
 * Until `crisis_quiet_until` passes, every hurt, tension, make-up and ending line is left out.
 */
export function summaryLines(
  view: { state: RelationshipState; params: Params; cause: string | null },
  now: Date,
  settings: RelationshipConfig,
  phrases: Phrases,
): string[] {
  const { state } = view;
  const inCrisisQuiet = !!state.crisis_quiet_until && now < state.crisis_quiet_until;

  if (state.status === "ended_by_user") {
    if (inCrisisQuiet) return [];
    const line = firstPhrase(phrases, "ended");
    return line ? [line] : [];
  }

  const lines: string[] = [];
  const add = (line: string | null) => {
    if (line) lines.push(line);
  };

  if (state.status === "repairing") add(firstPhrase(phrases, "repairing"));
  if (!inCrisisQuiet && state.end_pending_since) add(firstPhrase(phrases, "end_pending"));

  for (const { name, deviation } of notableDeviations(view.params, inCrisisQuiet, settings)) {
    if (name === "hurt" && deviation > 0 && view.cause) {
      add(firstPhrase(phrases, "hurt_cause")?.replace("{cause}", view.cause) ?? null);
      continue;
    }
    const direction = deviation > 0 ? "above" : "below";
    const strength = Math.abs(deviation) >= settings.summary_strong_effect ? "strong" : "mild";
    add(firstPhrase(phrases, `${name} ${direction} ${strength}`));
  }

  if (!inCrisisQuiet && makeUpLineDue(state, settings)) add(firstPhrase(phrases, "make_up"));
  return lines;
}

/** The params furthest from baseline, strongest first, capped at `summary_max_lines`. */
function notableDeviations(
  params: Params,
  inCrisisQuiet: boolean,
  settings: RelationshipConfig,
): { name: ParamName; deviation: number }[] {
  const hiddenInCrisis = (name: ParamName) => name === "hurt" || name === "tension";

  return PARAM_NAMES.filter((name) => !(inCrisisQuiet && hiddenInCrisis(name)))
    .map((name) => ({ name, deviation: deviationOf(params[name], settings.variance_epsilon) }))
    .filter((p) => Math.abs(p.deviation) >= settings.summary_min_effect)
    .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
    .slice(0, settings.summary_max_lines);
}

/** Read-only for the hot path: fades are applied in memory, never written. Null when nothing is notable. */
export async function loadRelationshipSummary(
  deps: Pick<Deps, "db" | "config">,
  userId: string,
  now: Date,
): Promise<string | null> {
  const settings = deps.config.relationship;
  const row = await relationshipRepo.getRelationshipRow(deps.db, userId);
  if (!row) return null;

  const params = fadeParams(await relationshipRepo.getParams(deps.db, userId), now, settings);
  const cause = row.hurt_cause_fact
    ? ((await getFact(deps.db, userId, row.hurt_cause_fact))?.content ?? null)
    : null;
  const phrases = parseSummaryPhrases(
    loadPrompt("relationship/summary", deps.config.prompts.relationship_summary),
  );

  const state = relationshipRepo.toRelationshipState(row);
  const lines = summaryLines({ state, params, cause }, now, settings, phrases);
  return lines.length ? lines.join("\n") : null;
}
