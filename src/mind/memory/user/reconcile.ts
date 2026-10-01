import { z } from "zod";
import type { Neighbor } from "@/db/repos/facts";
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
const NEW: Decision = { relation: "new", targetId: null };

export function buildReconcileInput(c: ExtractedFact, neighbors: Neighbor[]): string {
  return [
    `New fact (${c.subject}, ${c.kind}): ${c.content}`,
    "Existing facts:",
    ...neighbors.map((n) => `- id=${n.id} [${n.status}] ${n.content}`),
  ].join("\n");
}

/** Approach A: only near-matches reach the classifier; any target outside `neighbors` is ignored. */
export async function decide(
  deps: Pick<Deps, "llm" | "config">,
  c: ExtractedFact,
  neighbors: Neighbor[],
): Promise<Decision> {
  if (neighbors.length === 0) return NEW;
  const raw = await deps.llm.classifyJson({
    purpose: "reconcile",
    model: "cheap",
    system: loadPrompt("reconcile", deps.config.prompts.reconcile),
    input: buildReconcileInput(c, neighbors),
    schema: ReconcileSchema,
    timeoutMs: deps.config.models.structured_timeout_ms,
    maxTokens: deps.config.reconcile.max_tokens,
  });
  if (raw.relation === "new") return NEW;
  const target = neighbors.find((n) => n.id === raw.target_fact_id);
  return target ? { relation: raw.relation, targetId: target.id } : NEW;
}
