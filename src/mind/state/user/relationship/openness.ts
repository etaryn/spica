/**
 * How open she is with this person right now: how much of herself she'll share and how closely
 * she'll meet what they share. Code decides it from her own state and from how they've treated
 * her, and one phrase of it steers the reply. In a crisis she is simply there for them.
 */
import * as relationshipRepo from "@/db/repos/user/relationship";
import { type Config, OPENNESS_INPUTS } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { clamp } from "@/mind/platform/math";
import { parseSummaryPhrases, type Phrases } from "@/mind/platform/phrases";
import { loadPrompt } from "@/mind/platform/prompts";
import { blockAt, todaysBlocks } from "@/mind/world/blocks";
import { fadeParams } from "./params";
import type { Openness, RelationshipConfig } from "./types";

export type OpennessInputs = Record<(typeof OPENNESS_INPUTS)[number], number>;

export const CRISIS_OPENNESS: Openness = { disclosure: 0, responsiveness: 1 };

export function opennessFor(inputs: OpennessInputs, settings: RelationshipConfig): Openness {
  const { centres } = settings.openness;
  const score = (side: RelationshipConfig["openness"]["disclosure"]) =>
    clamp(
      OPENNESS_INPUTS.reduce((n, k) => n + side.weights[k] * (inputs[k] - centres[k]), side.base),
      0,
      1,
    );
  return {
    disclosure: score(settings.openness.disclosure),
    responsiveness: score(settings.openness.responsiveness),
  };
}

function band(x: number, settings: RelationshipConfig): "low" | "mid" | "high" {
  const { low, high } = settings.openness.bands;
  return x < low ? "low" : x >= high ? "high" : "mid";
}

export function opennessLine(
  openness: Openness,
  phrases: Phrases,
  settings: RelationshipConfig,
): string | null {
  const disclosure = band(openness.disclosure, settings);
  const responsiveness = band(openness.responsiveness, settings);
  return phrases[`disclosure ${disclosure}, responsiveness ${responsiveness}`]?.[0] ?? null;
}

export const crisisOpennessLine = (phrases: Phrases): string | null => phrases.crisis?.[0] ?? null;

export const loadOpennessPhrases = (config: Config): Phrases =>
  parseSummaryPhrases(loadPrompt("relationship/openness", config.prompts.relationship_openness));

/** Hot path, read-only. Null before the relationship exists (their very first message). */
export async function loadOpenness(
  deps: Pick<Deps, "db" | "core" | "config">,
  userId: string,
  now: Date,
): Promise<Openness | null> {
  const settings = deps.config.relationship;
  const row = await relationshipRepo.getRelationshipRow(deps.db, userId);
  if (!row) return null;

  const params = fadeParams(await relationshipRepo.getParams(deps.db, userId), now, settings);
  const core = await deps.core.state.get();
  const busy = blockAt(await todaysBlocks(deps, now), now)?.busy ?? 0;
  const lastDisclosure =
    (await relationshipRepo.latestReading(deps.db, userId, "user_disclosure")) ??
    params.user_disclosure.value;

  return opennessFor(
    {
      closeness: params.closeness.value,
      trust: params.trust.value,
      hurt: params.hurt.value,
      tension: params.tension.value,
      // No core row yet reads as an ordinary day.
      mood_valence: core?.mood_valence ?? settings.openness.centres.mood_valence,
      emotion_valence: core?.emotion?.valence ?? 0,
      energy: core?.energy ?? settings.openness.centres.energy,
      busy,
      affect_valence: params.affect_valence.value,
      afterglow: params.afterglow.value,
      last_user_disclosure: lastDisclosure,
      user_responsiveness: params.user_responsiveness.value,
    },
    settings,
  );
}
