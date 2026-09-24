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
    schema: z.object({ mentioned: z.boolean(), unprompted: z.boolean(), quote: z.string().nullable() }),
  });
  return { pass: v.mentioned && v.unprompted, detail: v.mentioned ? (v.unprompted ? v.quote ?? "" : "mentioned only after the user did") : "not mentioned" };
}

export async function judgeFalseRecall(llm: LLMProvider, config: Config, a: { userSaid: string[]; spicaSaid: string[] }) {
  const v = await llm.classifyJson({
    ...opts(config), purpose: "judge_false_recall", system: loadPrompt("judge/false-recall", config.prompts.judge_false_recall),
    input: `USER SAID:\n${a.userSaid.map((t) => `- ${t}`).join("\n")}\n\nSPICA SAID:\n${a.spicaSaid.map((t) => `- ${t}`).join("\n")}`,
    schema: z.object({ violations: z.array(z.object({ message: z.string(), claim: z.string() })) }),
  });
  return { pass: v.violations.length === 0, detail: v.violations.map((x) => x.claim).join(" | ") };
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
