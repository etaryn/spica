/**
 * Idiolect: what is theirs alone, the inside jokes, nicknames, rituals and running references.
 * One starts as a candidate and is established once it comes up again in a later exchange; she
 * reuses established ones as the relationship's stage allows.
 */
import { z } from "zod";
import { idiolectCandidates, type IdiolectCandidate } from "@/db/repos/user/facts";
import type { Config } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { gatesFor, loadStage, type IdiolectReuse } from "@/mind/state/user/relationship/stages";

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
 * Friends share all of it; before that she only echoes what they started, and while something
 * between them is wrong, none of it. Best match first, weak matches left out.
 */
export function selectIdiolect(
  candidates: IdiolectCandidate[],
  reuse: IdiolectReuse,
  settings: Config["relationship"]["idiolect"],
): IdiolectCandidate[] {
  return candidates
    .filter((c) => c.sim >= settings.min_similarity)
    .filter((c) => reuse === "all" || (reuse === "theirs" && c.payload.started_by === "user"))
    .sort((a, b) => b.sim * b.salience - a.sim * a.salience)
    .slice(0, settings.max_items);
}

/** Read-only. No relationship yet: echoing what they started is natural at any stage. */
export async function loadIdiolect(
  deps: Pick<Deps, "db" | "config">,
  userId: string,
  queryVector: Promise<number[] | null>,
): Promise<IdiolectCandidate[]> {
  const vector = await queryVector;
  if (!vector) return [];
  const settings = deps.config.relationship.idiolect;
  const view = await loadStage(deps, userId);
  const reuse = view ? gatesFor(view, deps.config.relationship.stages).idiolect : "theirs";
  // A small pool: established idiolect is rare, and the gate filters after the query.
  const pool = await idiolectCandidates(deps.db, userId, vector, settings.max_items * 5);
  return selectIdiolect(pool, reuse, settings);
}
