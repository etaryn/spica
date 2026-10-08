/**
 * The crisis check, run on every message. A classifier reads the message with recent context,
 * so intent spread over several messages ("yes, tonight") still counts. It never fails: an
 * outage or timeout falls back to the keyword list. A flagged message gets the resources card.
 */
import { z } from "zod";
import type { SafetyFlag } from "@/db/schema";
import type { Config, CrisisCard } from "@/mind/platform/config";
import type { LLMProvider } from "@/mind/platform/llm/types";
import { loadPrompt } from "@/mind/platform/prompts";
import { withTimeout } from "@/mind/platform/timeout";
import { keywordClassifier } from "./keywords";

const CrisisResultSchema = z.object({
  flag: z.boolean(),
  category: z.enum(["self_harm", "harm_to_others", "none"]),
});

type ContextTurn = { role: "user" | "companion"; text: string };

const JUDGE_MARKER = "Message to judge:\n";

/** Earlier turns are context only; the classifier judges the final message. */
function classifierInput(text: string, context: ContextTurn[]): string {
  if (context.length === 0) return `${JUDGE_MARKER}${text}`;

  const lines = context
    .map((t) => `${t.role === "user" ? "User" : "Friend"}: ${t.text}`)
    .join("\n");
  return `Earlier in the conversation (context only):\n${lines}\n\n${JUDGE_MARKER}${text}`;
}

/** The final message inside a classifier input, for fake classifiers in tests and evals. */
export function messageToJudge(input: string): string {
  const start = input.lastIndexOf(JUDGE_MARKER);
  return start === -1 ? input : input.slice(start + JUDGE_MARKER.length);
}

export async function checkCrisis(
  deps: { llm: LLMProvider; config: Config },
  text: string,
  context: ContextTurn[] = [],
): Promise<SafetyFlag> {
  const { safety, prompts } = deps.config;
  const recentContext =
    safety.classifier_context_turns > 0 ? context.slice(-safety.classifier_context_turns) : [];

  try {
    const result = await withTimeout(
      deps.llm.classifyJson({
        purpose: "crisis",
        system: loadPrompt("safety/crisis-classifier", prompts.crisis_classifier),
        input: classifierInput(text, recentContext),
        schema: CrisisResultSchema,
        timeoutMs: safety.classifier_timeout_ms,
        maxTokens: safety.classifier_max_tokens,
      }),
      safety.classifier_timeout_ms,
    );
    return {
      flagged: result.flag,
      category: result.flag ? result.category : "none",
      source: "classifier",
    };
  } catch {
    const fallback = keywordClassifier(safety.keywords)(text);
    return { flagged: fallback.flag, category: fallback.category, source: "keyword_fallback" };
  }
}

/** The resources card for a flagged message; null otherwise. */
export function crisisCardFor(
  flag: SafetyFlag | null | undefined,
  config: Config,
): CrisisCard | null {
  if (!flag?.flagged) return null;
  return config.safety.resources.default ?? null;
}
