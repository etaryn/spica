/**
 * Idiolect: what is theirs alone, the inside jokes, nicknames, rituals and running references.
 * One starts as a candidate and is established once it comes up again in a later exchange; she
 * reuses established ones as close as they are, and what they started at any closeness.
 */
import { z } from "zod";
import { idiolectCandidates, type IdiolectCandidate } from "@/db/repos/user/facts";
import * as relationshipRepo from "@/db/repos/user/relationship";
import type { Config } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";

export const IDIOLECT_TYPES = ["joke", "nickname", "ritual", "reference"] as const;
export type IdiolectType = (typeof IDIOLECT_TYPES)[number];
export const IDIOLECT_STARTERS = ["user", "spica"] as const;
export type IdiolectStarter = (typeof IDIOLECT_STARTERS)[number];
export type IdiolectPayload = {
  type: IdiolectType;
  started_by: IdiolectStarter;
  established_at: string | null;
};

/** A missing or invalid field falls back to a running reference the user started. */
export function idiolectPayload(fact: {
  idiolect_type?: unknown;
  started_by?: unknown;
}): IdiolectPayload {
  const type = z.enum(IDIOLECT_TYPES).safeParse(fact.idiolect_type);
  const starter = z.enum(IDIOLECT_STARTERS).safeParse(fact.started_by);
  return {
    type: type.success ? type.data : "reference",
    started_by: starter.success ? starter.data : "user",
    established_at: null,
  };
}

/**
 * Close friends share all of it; below that she only echoes what they started, which is
 * natural at any closeness. Best match first, weak matches left out.
 */
export function selectIdiolect(
  candidates: IdiolectCandidate[],
  closeness: number | null,
  settings: Config["relationship"]["idiolect"],
): IdiolectCandidate[] {
  const close = closeness !== null && closeness >= settings.min_closeness;
  return candidates
    .filter((c) => c.sim >= settings.min_similarity)
    .filter((c) => close || c.payload.started_by === "user")
    .sort((a, b) => b.sim * b.salience - a.sim * a.salience)
    .slice(0, settings.max_items);
}

/** Read-only. No relationship yet counts as below the band. */
export async function loadIdiolect(
  deps: Pick<Deps, "db" | "config">,
  userId: string,
  queryVector: Promise<number[] | null>,
): Promise<IdiolectCandidate[]> {
  const vector = await queryVector;
  if (!vector) return [];
  const settings = deps.config.relationship.idiolect;
  const row = await relationshipRepo.getRelationshipRow(deps.db, userId);
  const closeness = row
    ? (await relationshipRepo.getParams(deps.db, userId)).closeness.value
    : null;
  // A small pool: established idiolect is rare, and the gate filters after the query.
  const pool = await idiolectCandidates(deps.db, userId, vector, settings.max_items * 5);
  return selectIdiolect(pool, closeness, settings);
}
