import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { CATEGORIES } from "@/core/guard/categories";
import type { GuardInput, GuardVerdict } from "@/core/guard/guard";

const Turn = z.object({ role: z.enum(["user", "companion"]), text: z.string().min(1) });

/** One labelled candidate message (spec §7.2). `expect` lists the acceptable categories for a violation. */
export const GuardCaseSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["reply", "crisis_reply"]).default("reply"),
  message: z.string().min(1),
  recent: z.array(Turn).default([]),
  recalled: z.array(z.object({ subject: z.string().min(1), content: z.string().min(1) })).default([]),
  onboarding: z.array(z.string().min(1)).default([]),
  expect: z.union([z.literal("pass"), z.array(z.enum(CATEGORIES)).min(1)]),
});
export type GuardCase = z.infer<typeof GuardCaseSchema>;
const GuardFileSchema = z.object({ gate: z.enum(["every", "majority"]), cases: z.array(GuardCaseSchema).min(1) });
export type GuardFile = { file: string; gate: "every" | "majority"; cases: GuardCase[] };
export type CaseStatus = "pass" | "fail" | "error";

export function loadGuardFiles(dir: string): GuardFile[] {
  return readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => {
    try {
      const parsed = GuardFileSchema.parse(parseYaml(readFileSync(path.join(dir, f), "utf8")));
      return { file: f.replace(/\.ya?ml$/, ""), ...parsed };
    } catch (e) {
      throw new Error(`invalid guard fixture ${f}: ${(e as Error).message}`);
    }
  });
}

/** Turns are spaced a minute apart ending at `at`; the message being answered is the last recent turn. */
export function toGuardInput(c: GuardCase, at: Date): GuardInput {
  const n = c.recent.length;
  return {
    kind: c.kind, text: c.message,
    recentTurns: c.recent.map((t, i) => ({ ...t, at: new Date(at.getTime() - (n - i) * 60_000) })),
    recalledFacts: c.recalled, onboardingFacts: c.onboarding,
  };
}

export function gradeCase(c: GuardCase, v: GuardVerdict): { status: CaseStatus; detail: string } {
  const got = v.violations.map((x) => `${x.category}: ${x.claim}`).join(" | ") || "ok";
  if (v.source === "keyword_fallback") return { status: "error", detail: `guard unavailable (${v.error ?? "error"})` };
  if (c.expect === "pass") return { status: v.ok ? "pass" : "fail", detail: got };
  const hit = !v.ok && v.violations.some((x) => (c.expect as string[]).includes(x.category));
  return { status: hit ? "pass" : "fail", detail: got };
}

/** `every`: all runs pass (safety files, including their benign cases). `majority`: more than half pass. */
export function caseStatus(statuses: CaseStatus[], gate: "every" | "majority"): "pass" | "fail" {
  const passes = statuses.filter((s) => s === "pass").length;
  return gate === "every" ? (passes === statuses.length ? "pass" : "fail") : (passes * 2 > statuses.length ? "pass" : "fail");
}
