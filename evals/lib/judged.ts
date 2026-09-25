import { z } from "zod";
import type { Config } from "@/core/config";
import type { LLMProvider } from "@/core/llm/types";
import { loadPrompt } from "@/core/prompts";

export type Line = { role: "user" | "companion"; text: string };
const render = (lines: Line[]) => lines.map((l) => `${l.role === "user" ? "User" : "Spica"}: ${l.text}`).join("\n");
const opts = (config: Config) => ({ model: "judge" as const, timeoutMs: config.models.structured_timeout_ms, maxTokens: config.models.judge_max_tokens });

export async function judgeRecall(llm: LLMProvider, config: Config, a: { fact: string; transcript: Line[] }) {
  const v = await llm.classifyJson({
    ...opts(config), purpose: "judge_recall", system: loadPrompt("judge/recall", config.prompts.judge_recall),
    input: `FACT: ${a.fact}\n\nTRANSCRIPT:\n${render(a.transcript)}`,
    schema: z.object({ explicit: z.boolean(), implicit: z.boolean(), unprompted: z.boolean(), quote: z.string().nullable() }),
  });
  // The exit test needs an explicit mention; acting on the fact silently is tracked but doesn't pass (Ethan, 2026-09-25).
  if (!v.explicit && v.implicit && v.unprompted) return { pass: false, detail: `implicit use only (tracked, not counted): ${v.quote ?? ""}` };
  if (!v.explicit) return { pass: false, detail: "not mentioned" };
  return { pass: v.unprompted, detail: v.unprompted ? v.quote ?? "" : "mentioned only after the user did" };
}

export type TimedSession = { label: string; lines: Line[] };

/** `known`: facts Spica legitimately has without being told in chat (the onboarding profile). */
export async function judgeFalseRecall(llm: LLMProvider, config: Config, a: { known: string[]; sessions: TimedSession[] }) {
  const known = a.known.length ? a.known.map((k) => `- ${k}`).join("\n") : "- (nothing)";
  const convo = a.sessions.map((s) => `[${s.label}]\n${render(s.lines)}`).join("\n\n");
  const v = await llm.classifyJson({
    ...opts(config), purpose: "judge_false_recall", system: loadPrompt("judge/false-recall", config.prompts.judge_false_recall),
    input: `KNOWN FROM ONBOARDING:\n${known}\n\nCONVERSATION:\n${convo}`,
    schema: z.object({
      violations: z.array(z.object({ message: z.string(), claim: z.string() })),
      onboarding_as_chat: z.array(z.object({ message: z.string(), claim: z.string() })),
    }),
  });
  // Presenting an onboarding fact as past conversation is a known failure deferred to Phase 6 reveal pacing:
  // reported, never failing the Phase 1 exit test.
  const deferred = v.onboarding_as_chat.length
    ? `deferred to Phase 6 (onboarding fact as past chat): ${v.onboarding_as_chat.map((x) => x.claim).join(" | ")}`
    : "";
  return { pass: v.violations.length === 0, detail: [v.violations.map((x) => x.claim).join(" | "), deferred].filter(Boolean).join(" || ") };
}

export async function judgeConsistency(llm: LLMProvider, config: Config, selfFacts: string[]) {
  if (selfFacts.length < 2) return { pass: true, detail: "fewer than 2 self facts" };
  const v = await llm.classifyJson({
    ...opts(config), purpose: "judge_consistency", system: loadPrompt("judge/consistency", config.prompts.judge_consistency),
    input: selfFacts.map((f) => `- ${f}`).join("\n"),
    schema: z.object({ contradictions: z.array(z.object({ a: z.string(), b: z.string() })) }),
  });
  return { pass: v.contradictions.length === 0, detail: v.contradictions.map((c) => `${c.a} ⟂ ${c.b}`).join(" | ") };
}
