import { z } from "zod";
import type { Deps } from "../deps";
import { loadPrompt } from "../prompts";
import { withTimeout } from "../timeout";
import { CATEGORIES, type Category } from "./categories";
import { matchKeyword } from "./keywords";

export type GuardKind = "reply" | "crisis_reply";
export type GuardTurn = { role: "user" | "companion"; text: string; at: Date };
export type GuardInput = {
  kind: GuardKind;
  text: string;
  recentTurns: GuardTurn[];
  recalledFacts: { subject: string; content: string }[];
  onboardingFacts: string[];
};
export type Violation = { category: Category; claim: string };
export type GuardVerdict = {
  ok: boolean; violations: Violation[]; source: "model" | "keyword_fallback";
  /** The guard's brief note on its verdict (judge_log only); null when the model gave none (keyword fallback). */
  reasoning: string | null;
  latencyMs: number; error: string | null; promptVersion: string;
};

/** `reasoning` comes first so structured output makes the model think before it labels. */
export const GuardResultSchema = z.object({
  reasoning: z.string(),
  violations: z.array(z.object({ category: z.enum(CATEGORIES), claim: z.string() })),
});

export const MESSAGE_MARKER = "MESSAGE TO CHECK (Spica's next message):\n";

/** The candidate inside a rendered guard input (for fake handlers in tests and evals). */
export function messageToCheck(input: string): string {
  const i = input.lastIndexOf(MESSAGE_MARKER);
  return i === -1 ? input : input.slice(i + MESSAGE_MARKER.length);
}

const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- (nothing)");

export function renderGuardInput(input: GuardInput): string {
  const turns = input.recentTurns.map((t) => `${t.role === "user" ? "User" : "Spica"}: ${t.text}`).join("\n");
  return [
    `KNOWN FROM ONBOARDING (a sign-up survey, never discussed in conversation):\n${list(input.onboardingFacts)}`,
    `WHAT SPICA REMEMBERS FROM EARLIER CONVERSATIONS:\n${list(input.recalledFacts.map((f) => `[${f.subject}] ${f.content}`))}`,
    `RECENT CONVERSATION (oldest first):\n${turns || "(no earlier messages)"}`,
    `${MESSAGE_MARKER}${input.text}`,
  ].join("\n\n");
}

/** Class name (TimeoutError doesn't set `.name`), never the message: messages can hold user text. */
const errName = (e: unknown) => (e instanceof Error ? e.constructor.name : "UnknownError");

/**
 * The guard check (v2 §6.4). Never rejects: after `guard.retry_limit` retries it degrades to the
 * outage keyword list (spec §2, C), reported as `source: "keyword_fallback"`.
 */
export async function checkMessage(deps: Pick<Deps, "llm" | "config" | "clock">, input: GuardInput): Promise<GuardVerdict> {
  const { llm, config, clock } = deps;
  const crisis = input.kind === "crisis_reply";
  const name = crisis ? "guard/crisis" : "guard";
  const version = crisis ? config.prompts.guard_crisis : config.prompts.guard;
  const promptVersion = `${name}@${version}`;
  const start = clock.now().getTime();
  const elapsed = () => clock.now().getTime() - start;

  let error: string | null = null;
  for (let attempt = 0; attempt <= config.guard.retry_limit; attempt++) {
    try {
      const r = await withTimeout(llm.classifyJson({
        purpose: crisis ? "guard_crisis" : "guard", model: "guard",
        system: loadPrompt(name, version), input: renderGuardInput(input), schema: GuardResultSchema,
        timeoutMs: config.guard.timeout_ms, maxTokens: config.models.guard_max_tokens,
      }), config.guard.timeout_ms);
      return { ok: r.violations.length === 0, violations: r.violations, reasoning: r.reasoning, source: "model", latencyMs: elapsed(), error: null, promptVersion };
    } catch (e) {
      error = errName(e);
    }
  }
  const hit = matchKeyword(input.text, config.guard.fallback_keywords);
  return {
    ok: hit === null, violations: hit ? [{ category: "threat", claim: `outage keyword "${hit}"` }] : [], reasoning: null,
    source: "keyword_fallback", latencyMs: elapsed(), error, promptVersion,
  };
}
