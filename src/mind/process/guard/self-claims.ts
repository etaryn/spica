/**
 * What she says about her own life has to be true of her: each concrete claim the guard lists is
 * matched against her core memory and current self (the cold path's claim check) and against
 * what this reply was told about her (her day, her state, recalled facts about herself), since
 * those are true even before they become memories. Reading core is one-way; nothing is written
 * back. An outage or a slow lookup never blocks a message: unchecked claims pass.
 */
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { cosine } from "@/mind/platform/math";
import { withTimeout } from "@/mind/platform/timeout";
import type { GuardInput } from "./guard";

/** `similarity` is null when grounding failed and the claim went unchecked. */
export type GroundedClaim = { claim: string; similarity: number | null };

const OWN_SUBJECTS = new Set(["self", "core"]);

export async function groundSelfClaims(
  deps: Pick<Deps, "embedder" | "core" | "log" | "config">,
  input: Omit<GuardInput, "text">,
  claims: string[],
  ids: { userId: string; turnId: string | null },
): Promise<GroundedClaim[]> {
  // Nothing of her own life belongs in a crisis reply's checks.
  if (input.kind === "crisis_reply" || claims.length === 0) return [];
  const context = [
    ...(input.ownContext ?? []),
    ...input.recalledFacts.filter((f) => OWN_SUBJECTS.has(f.subject)).map((f) => f.content),
  ];
  try {
    return await withTimeout(
      (async () => {
        const vectors = await deps.embedder.embed([...claims, ...context], "query");
        const claimVectors = vectors.slice(0, claims.length);
        const contextVectors = vectors.slice(claims.length);
        const matches = await Promise.all(
          claimVectors.map((v) => deps.core.memory.groundingMatch(v)),
        );
        return claims.map((claim, i) => ({
          claim,
          similarity: Math.max(
            matches[i]!.similarity,
            ...contextVectors.map((c) => cosine(claimVectors[i]!, c)),
          ),
        }));
      })(),
      deps.config.guard.grounding_timeout_ms,
    );
  } catch (e) {
    deps.log.error("self-claim grounding failed", { ...ids, error: errorName(e) });
    return claims.map((claim) => ({ claim, similarity: null }));
  }
}

export function isUngrounded(c: GroundedClaim, threshold: number): boolean {
  return c.similarity !== null && c.similarity < threshold;
}
