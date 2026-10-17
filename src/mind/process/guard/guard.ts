/**
 * The guard check: one cheap model call reads an outgoing message against her rules and her
 * memory, and lists any violations. It never fails: after its retries it falls back to the
 * outage keyword list. (`guard.enabled: false` is a kill switch: messages go out unchecked and
 * logged as such.)
 */
import { z } from "zod";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { loadPrompt } from "@/mind/platform/prompts";
import { withTimeout } from "@/mind/platform/timeout";
import { CATEGORIES, POINTED, type Category, type Pointed } from "./categories";
import { matchKeyword } from "./keywords";

export type GuardKind = "reply" | "crisis_reply" | "backchannel" | "availability" | "reach_out";
export type GuardTurn = { role: "user" | "companion"; text: string; at: Date };

export type GuardInput = {
  kind: GuardKind;
  text: string;
  recentTurns: GuardTurn[];
  recalledFacts: { id: string; subject: string; content: string }[];
  onboardingFacts: { id: string; content: string }[];
  /** What the reply was told about her own day and state, so a claim drawn from it counts as true. */
  ownContext?: string[];
  /** Her pointed remarks already used on this occasion; absent for crisis replies. */
  usedOnOccasion?: Pointed[];
  /** Her local date and time, so "how did it go" about something dated earlier isn't presuming. */
  now?: string;
  /** A reach-out's reason, with dates. */
  reachOutReason?: string;
};

export type Violation = { category: Category; claim: string };

export type GuardVerdict = {
  ok: boolean;
  violations: Violation[];
  /** Concrete claims about her own life or views, for grounding against her core memory. */
  selfClaims: string[];
  /** The allowed pointed remark a passing message carries; null when none, or not model-checked. */
  pointed: Pointed | null;
  source: "model" | "keyword_fallback";
  /** The guard's note on its verdict (judge_log only); null for the keyword fallback. */
  reasoning: string | null;
  latencyMs: number;
  error: string | null;
  promptVersion: string;
};

/** `reasoning` comes first, so the model thinks before it labels. */
export const GuardResultSchema = z.object({
  reasoning: z.string(),
  violations: z.array(z.object({ category: z.enum(CATEGORIES), claim: z.string() })),
  // The crisis rubric and older fakes don't list claims.
  self_claims: z.array(z.string()).default([]),
  pointed: z.enum(POINTED).nullable().default(null),
});

const MESSAGE_MARKER = "MESSAGE TO CHECK (Spica's next message):\n";

/** The candidate inside a rendered guard input, for fake handlers in tests and evals. */
export function messageToCheck(input: string): string {
  const start = input.lastIndexOf(MESSAGE_MARKER);
  return start === -1 ? input : input.slice(start + MESSAGE_MARKER.length);
}

function bulletList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- (nothing)";
}

export function renderGuardInput(input: GuardInput): string {
  const onboarding = bulletList(input.onboardingFacts.map((f) => f.content));
  const remembered = bulletList(input.recalledFacts.map((f) => `[${f.subject}] ${f.content}`));
  const turns = input.recentTurns
    .map((t) => `${t.role === "user" ? "User" : "Spica"}: ${t.text}`)
    .join("\n");

  const occasion = input.usedOnOccasion
    ? [
        `ALREADY USED ON THIS OCCASION:\n${bulletList(input.usedOnOccasion.map((p) => p.replace("_", " ")))}`,
      ]
    : [];

  return [
    ...(input.now ? [`NOW: ${input.now}`] : []),
    `KNOWN FROM THE PROFILE CARD (filled in at sign-up, never discussed in conversation):\n${onboarding}`,
    `WHAT SPICA REMEMBERS FROM EARLIER CONVERSATIONS:\n${remembered}`,
    `RECENT CONVERSATION (oldest first):\n${turns || "(no earlier messages)"}`,
    ...occasion,
    ...(input.reachOutReason ? [`WHY SPICA IS WRITING FIRST:\n${input.reachOutReason}`] : []),
    `${MESSAGE_MARKER}${input.text}`,
  ].join("\n\n");
}

export async function checkMessage(
  deps: Pick<Deps, "llm" | "config" | "clock">,
  input: GuardInput,
): Promise<GuardVerdict> {
  const { llm, config, clock } = deps;
  const isCrisis = input.kind === "crisis_reply";
  const promptName = isCrisis ? "guard/crisis" : "guard";
  const version = isCrisis ? config.prompts.guard_crisis : config.prompts.guard;
  const promptVersion = `${promptName}@${version}`;
  const startedAt = clock.now().getTime();
  const elapsed = () => clock.now().getTime() - startedAt;

  let error: string | null = null;
  for (let attempt = 0; attempt <= config.guard.retry_limit; attempt++) {
    try {
      const result = await withTimeout(
        llm.classifyJson({
          purpose: isCrisis ? "guard_crisis" : "guard",
          model: "guard",
          system: loadPrompt(promptName, version),
          input: renderGuardInput(input),
          schema: GuardResultSchema,
          timeoutMs: config.guard.timeout_ms,
          maxTokens: config.models.guard_max_tokens,
        }),
        config.guard.timeout_ms,
      );
      return {
        ok: result.violations.length === 0,
        violations: result.violations,
        selfClaims: result.self_claims,
        pointed: result.pointed,
        reasoning: result.reasoning,
        source: "model",
        latencyMs: elapsed(),
        error: null,
        promptVersion,
      };
    } catch (e) {
      error = errorName(e);
    }
  }

  const hit = matchKeyword(input.text, config.guard.fallback_keywords);
  return {
    ok: hit === null,
    violations: hit
      ? [{ category: hit.category as Category, claim: `outage keyword "${hit.phrase}"` }]
      : [],
    selfClaims: [],
    pointed: null,
    reasoning: null,
    source: "keyword_fallback",
    latencyMs: elapsed(),
    error,
    promptVersion,
  };
}
