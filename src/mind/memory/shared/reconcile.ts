/**
 * Reconcile: decides how a new memory, from either mind, relates to the closest ones already
 * stored. It can be a duplicate, resolve an open one, contradict one (which supersedes it), or be
 * new. The model is only asked when a match exists; a loosely related (distant) one can only be
 * contradicted.
 */
import { z } from "zod";
import type { Deps } from "@/mind/platform/deps";
import { loadPrompt } from "@/mind/platform/prompts";
import type { Neighbor } from "./types";

const ReconcileSchema = z.object({
  relation: z.enum(["duplicate", "resolves", "contradicts", "new"]),
  target_fact_id: z.string().nullable(),
});

export type Decision = {
  relation: "duplicate" | "resolves" | "contradicts" | "new";
  targetId: string | null;
};

/**
 * The new memory, described the same way for either mind: "user, event", "self, opinion",
 * "episode".
 */
export type ReconcileCandidate = { label: string; content: string };

const IS_NEW: Decision = { relation: "new", targetId: null };

export function buildReconcileInput(
  candidate: ReconcileCandidate,
  neighbors: Neighbor[],
  near: number,
): string {
  return [
    `New fact (${candidate.label}): ${candidate.content}`,
    "Existing facts:",
    ...neighbors.map(
      (n) => `- id=${n.id} [${n.status}]${n.sim < near ? " [distant]" : ""} ${n.content}`,
    ),
  ].join("\n");
}

/** A target the model names that isn't one of `neighbors` is ignored: the memory counts as new. */
export async function reconcileAgainstNeighbours(
  deps: Pick<Deps, "llm" | "config">,
  candidate: ReconcileCandidate,
  neighbors: Neighbor[],
): Promise<Decision> {
  if (neighbors.length === 0) return IS_NEW;

  const verdict = await deps.llm.classifyJson({
    purpose: "reconcile",
    model: "cheap",
    system: loadPrompt("reconcile", deps.config.prompts.reconcile),
    input: buildReconcileInput(candidate, neighbors, deps.config.reconcile.near_match_similarity),
    schema: ReconcileSchema,
    timeoutMs: deps.config.models.structured_timeout_ms,
    maxTokens: deps.config.reconcile.max_tokens,
  });
  if (verdict.relation === "new") return IS_NEW;

  const target = neighbors.find((n) => n.id === verdict.target_fact_id);
  if (!target) return IS_NEW;
  // A loosely related memory is only close enough to be made untrue, never merged or resolved.
  const distant = target.sim < deps.config.reconcile.near_match_similarity;
  if (distant && verdict.relation !== "contradicts") return IS_NEW;
  return { relation: verdict.relation, targetId: target.id };
}
