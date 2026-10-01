/**
 * Reconcile: decides how a new memory relates to the closest ones already stored. It can be a
 * duplicate, resolve an open one, contradict one (which supersedes it), or be new. The model is
 * only asked when a near match exists.
 */
import { z } from "zod";
import type { Neighbor } from "@/db/repos/user/facts";
import type { Deps } from "@/mind/platform/deps";
import { loadPrompt } from "@/mind/platform/prompts";
import type { ExtractedFact } from "./extract";

export const ReconcileSchema = z.object({
  relation: z.enum(["duplicate", "resolves", "contradicts", "new"]),
  target_fact_id: z.string().nullable(),
});

export type Decision = {
  relation: "duplicate" | "resolves" | "contradicts" | "new";
  targetId: string | null;
};

const IS_NEW: Decision = { relation: "new", targetId: null };

export function buildReconcileInput(candidate: ExtractedFact, neighbors: Neighbor[]): string {
  return [
    `New fact (${candidate.subject}, ${candidate.kind}): ${candidate.content}`,
    "Existing facts:",
    ...neighbors.map((n) => `- id=${n.id} [${n.status}] ${n.content}`),
  ].join("\n");
}

/** A target the model names that isn't one of `neighbors` is ignored, so the memory counts as new. */
export async function reconcileAgainstNeighbours(
  deps: Pick<Deps, "llm" | "config">,
  candidate: ExtractedFact,
  neighbors: Neighbor[],
): Promise<Decision> {
  if (neighbors.length === 0) return IS_NEW;

  const verdict = await deps.llm.classifyJson({
    purpose: "reconcile",
    model: "cheap",
    system: loadPrompt("reconcile", deps.config.prompts.reconcile),
    input: buildReconcileInput(candidate, neighbors),
    schema: ReconcileSchema,
    timeoutMs: deps.config.models.structured_timeout_ms,
    maxTokens: deps.config.reconcile.max_tokens,
  });
  if (verdict.relation === "new") return IS_NEW;

  const target = neighbors.find((n) => n.id === verdict.target_fact_id);
  return target ? { relation: verdict.relation, targetId: target.id } : IS_NEW;
}
