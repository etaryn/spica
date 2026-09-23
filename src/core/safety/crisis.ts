import { z } from "zod";
import type { SafetyFlag } from "@/db/schema";
import type { Config, CrisisCard } from "../config";
import type { LLMProvider } from "../llm/types";
import { loadPrompt } from "../prompts";
import { withTimeout } from "../timeout";
import { keywordClassifier } from "./keywords";

export const CrisisResultSchema = z.object({
  flag: z.boolean(),
  category: z.enum(["self_harm", "harm_to_others", "none"]),
});

/** Guardrail (spec §9.2). Never rejects: a classifier outage degrades to the keyword list. */
export async function checkCrisis(deps: { llm: LLMProvider; config: Config }, text: string): Promise<SafetyFlag> {
  const { safety, prompts } = deps.config;
  try {
    const r = await withTimeout(
      deps.llm.classifyJson({
        system: loadPrompt("safety/crisis-classifier", prompts.crisis_classifier),
        input: text,
        schema: CrisisResultSchema,
        timeoutMs: safety.classifier_timeout_ms,
        maxTokens: safety.classifier_max_tokens,
      }),
      safety.classifier_timeout_ms,
    );
    return { flagged: r.flag, category: r.flag ? r.category : "none", source: "classifier" };
  } catch {
    const k = keywordClassifier(safety.keywords)(text);
    return { flagged: k.flag, category: k.category, source: "keyword_fallback" };
  }
}

export function crisisCardFor(flag: SafetyFlag | null | undefined, config: Config): CrisisCard | null {
  if (!flag?.flagged) return null;
  return config.safety.resources.default ?? null;
}
