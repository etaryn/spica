/**
 * What she says about her own life has to be true of her: each concrete claim the guard lists is
 * matched against her core memory and current self, the same check the cold path uses to grade
 * claims. Reading core here is one-way; nothing is written back. An outage never blocks a
 * message: unchecked claims pass.
 */
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import type { GuardKind } from "./guard";

/** `similarity` is null when grounding failed and the claim went unchecked. */
export type GroundedClaim = { claim: string; similarity: number | null };

export async function groundSelfClaims(
  deps: Pick<Deps, "embedder" | "core" | "log">,
  kind: GuardKind,
  claims: string[],
): Promise<GroundedClaim[]> {
  // Nothing of her own life belongs in a crisis reply's checks.
  if (kind === "crisis_reply" || claims.length === 0) return [];
  try {
    const vectors = await deps.embedder.embed(claims, "query");
    const matches = await Promise.all(vectors.map((v) => deps.core.memory.groundingMatch(v)));
    return claims.map((claim, i) => ({ claim, similarity: matches[i]!.similarity }));
  } catch (e) {
    deps.log.error("self-claim grounding failed", { error: errorName(e) });
    return claims.map((claim) => ({ claim, similarity: null }));
  }
}

export function isUngrounded(c: GroundedClaim, threshold: number): boolean {
  return c.similarity !== null && c.similarity < threshold;
}
