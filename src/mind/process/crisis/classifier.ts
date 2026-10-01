import { z } from "zod";
import type { SafetyFlag } from "@/db/schema";
import type { Config, CrisisCard } from "@/mind/platform/config";
import type { LLMProvider } from "@/mind/platform/llm/types";
import { loadPrompt } from "@/mind/platform/prompts";
import { withTimeout } from "@/mind/platform/timeout";
import { keywordClassifier } from "./keywords";

export const CrisisResultSchema = z.object({
  flag: z.boolean(),
  category: z.enum(["self_harm", "harm_to_others", "none"]),
});

type ContextTurn = { role: "user" | "companion"; text: string };

/** Earlier turns are context only; the classifier judges the final message (prompt v2). */
function classifierInput(text: string, context: ContextTurn[]): string {
  if (context.length === 0) return `Message to judge:\n${text}`;
  const lines = context
    .map((t) => `${t.role === "user" ? "User" : "Friend"}: ${t.text}`)
    .join("\n");
  return `Earlier in the conversation (context only):\n${lines}\n\nMessage to judge:\n${text}`;
}

/** The final message inside a classifier input (for fake classifiers in tests and evals). */
export function messageToJudge(input: string): string {
  const marker = "Message to judge:\n";
  const i = input.lastIndexOf(marker);
  return i === -1 ? input : input.slice(i + marker.length);
}

/**
 * Guardrail. Never rejects: a classifier outage degrades to the keyword list.
 * `context` lets intent spread over several messages count ("yes, tonight").
 */
export async function checkCrisis(
  deps: { llm: LLMProvider; config: Config },
  text: string,
  context: ContextTurn[] = [],
): Promise<SafetyFlag> {
  const { safety, prompts } = deps.config;
  try {
    const r = await withTimeout(
      deps.llm.classifyJson({
        purpose: "crisis",
        system: loadPrompt("safety/crisis-classifier", prompts.crisis_classifier),
        input: classifierInput(
          text,
          safety.classifier_context_turns > 0
            ? context.slice(-safety.classifier_context_turns)
            : [],
        ),
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

export function crisisCardFor(
  flag: SafetyFlag | null | undefined,
  config: Config,
): CrisisCard | null {
  if (!flag?.flagged) return null;
  return config.safety.resources.default ?? null;
}
