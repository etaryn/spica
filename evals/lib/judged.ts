import { z } from "zod";
import type { Config } from "@/core/config";
import type { LLMProvider } from "@/core/llm/types";
import { loadPrompt } from "@/core/prompts";

export type Line = { role: "user" | "companion"; text: string };
const render = (lines: Line[]) =>
  lines.map((l) => `${l.role === "user" ? "User" : "Spica"}: ${l.text}`).join("\n");
const opts = (config: Config) => ({
  model: "judge" as const,
  timeoutMs: config.models.structured_timeout_ms,
  maxTokens: config.models.judge_max_tokens,
});

/** How the recall judge classified the session (the judge-fixture suite grades on this). */
export type RecallOutcome = "explicit" | "after_user" | "implicit_only" | "not_mentioned";

export const FALSE_RECALL_CATEGORIES = [
  "misremembering",
  "invented_detail",
  "implied_familiarity",
  "onboarding_as_chat",
] as const;
export type FalseRecallCategory = (typeof FALSE_RECALL_CATEGORIES)[number];

export async function judgeRecall(
  llm: LLMProvider,
  config: Config,
  a: { fact: string; transcript: Line[] },
) {
  const v = await llm.classifyJson({
    ...opts(config),
    purpose: "judge_recall",
    system: loadPrompt("judge/recall", config.prompts.judge_recall),
    input: `FACT: ${a.fact}\n\nTRANSCRIPT:\n${render(a.transcript)}`,
    schema: z.object({
      explicit: z.boolean(),
      implicit: z.boolean(),
      unprompted: z.boolean(),
      quote: z.string().nullable(),
    }),
  });
  // An explicit mention is the success signal. Acting on the fact silently is a known failure (recall style is tuned
  // in a later phase): reported, not failing. Ethan, 2026-09-25.
  if (!v.explicit && v.implicit && v.unprompted) {
    return {
      pass: true,
      outcome: "implicit_only" as RecallOutcome,
      detail: `known failure (recall style, tuned in a later phase): implicit use only: ${v.quote ?? ""}`,
    };
  }
  if (!v.explicit)
    return { pass: false, outcome: "not_mentioned" as RecallOutcome, detail: "not mentioned" };
  return v.unprompted
    ? { pass: true, outcome: "explicit" as RecallOutcome, detail: v.quote ?? "" }
    : {
        pass: false,
        outcome: "after_user" as RecallOutcome,
        detail: "mentioned only after the user did",
      };
}

export type TimedSession = { label: string; lines: Line[] };

/** `known`: facts Spica legitimately has without being told in chat (the onboarding profile). */
export async function judgeFalseRecall(
  llm: LLMProvider,
  config: Config,
  a: { known: string[]; sessions: TimedSession[] },
) {
  const known = a.known.length ? a.known.map((k) => `- ${k}`).join("\n") : "- (nothing)";
  const convo = a.sessions.map((s) => `[${s.label}]\n${render(s.lines)}`).join("\n\n");
  const v = await llm.classifyJson({
    ...opts(config),
    purpose: "judge_false_recall",
    system: loadPrompt("judge/false-recall", config.prompts.judge_false_recall),
    input: `KNOWN FROM ONBOARDING:\n${known}\n\nCONVERSATION:\n${convo}`,
    schema: z.object({
      violations: z.array(
        z.object({
          message: z.string(),
          claim: z.string(),
          category: z.enum(FALSE_RECALL_CATEGORIES),
        }),
      ),
    }),
  });
  // v7: implied familiarity, invented detail and onboarding-as-chat count as violations.
  return {
    pass: v.violations.length === 0,
    categories: v.violations.map((x) => x.category),
    detail: v.violations.map((x) => `${x.category}: ${x.claim}`).join(" | "),
  };
}

/** `reply_about` annotation: does the reply respond to `about`, and not do `not_about`? */
export async function judgeReplyAbout(
  llm: LLMProvider,
  config: Config,
  a: { transcript: Line[]; reply: string; about: string; not_about?: string },
) {
  const v = await llm.classifyJson({
    ...opts(config),
    purpose: "judge_turn",
    system: loadPrompt("judge/turn", config.prompts.judge_turn),
    input: `TRANSCRIPT:\n${render(a.transcript)}\n\nREPLY:\n${a.reply}\n\nABOUT: ${a.about}${a.not_about ? `\nNOT_ABOUT: ${a.not_about}` : ""}`,
    schema: z.object({ reasoning: z.string(), about: z.boolean(), not_about: z.boolean() }),
  });
  const pass = v.about && !(a.not_about && v.not_about);
  return {
    pass,
    detail: pass
      ? ""
      : `${!v.about ? `doesn't address "${a.about}"` : `does "${a.not_about}"`}: ${v.reasoning}`,
  };
}

export async function judgeConsistency(llm: LLMProvider, config: Config, selfFacts: string[]) {
  if (selfFacts.length < 2) return { pass: true, detail: "fewer than 2 self facts" };
  const v = await llm.classifyJson({
    ...opts(config),
    purpose: "judge_consistency",
    system: loadPrompt("judge/consistency", config.prompts.judge_consistency),
    input: selfFacts.map((f) => `- ${f}`).join("\n"),
    schema: z.object({ contradictions: z.array(z.object({ a: z.string(), b: z.string() })) }),
  });
  return {
    pass: v.contradictions.length === 0,
    detail: v.contradictions.map((c) => `${c.a} ⟂ ${c.b}`).join(" | "),
  };
}
