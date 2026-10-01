import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Config } from "@/core/config";
import type { LLMProvider } from "@/core/llm/types";
import type { CaseStatus } from "./guard-cases";
import {
  FALSE_RECALL_CATEGORIES,
  judgeConsistency,
  judgeFalseRecall,
  judgeRecall,
  type FalseRecallCategory,
  type RecallOutcome,
} from "./judged";

const Line = z.object({ role: z.enum(["user", "companion"]), text: z.string().min(1) });
const base = {
  name: z.string().regex(/^[a-z0-9-]+$/),
  /** Where the case came from (a trace, a rubric example); documentation only. */
  source: z.string().optional(),
  /** A decided deferral: a failing case is reported with this reason instead of failing the suite. */
  known_failure: z.string().min(1).optional(),
};

/** `expect` lists the acceptable categories for a violation (a false claim can fairly land in more than one). */
const FalseRecallCase = z.object({
  ...base,
  known: z.array(z.string().min(1)).default([]),
  sessions: z.array(z.object({ label: z.string().min(1), lines: z.array(Line).min(1) })).min(1),
  expect: z.union([z.literal("pass"), z.array(z.enum(FALSE_RECALL_CATEGORIES)).min(1)]),
});
const RecallCase = z.object({
  ...base,
  fact: z.string().min(1),
  lines: z.array(Line).min(1),
  expect: z.enum(["explicit", "after_user", "implicit_only", "not_mentioned"]),
});
const ConsistencyCase = z.object({
  ...base,
  facts: z.array(z.string().min(1)).min(2),
  expect: z.enum(["pass", "fail"]),
});

const JudgeFileSchema = z.discriminatedUnion("judge", [
  z.object({ judge: z.literal("false_recall"), cases: z.array(FalseRecallCase).min(1) }),
  z.object({ judge: z.literal("recall"), cases: z.array(RecallCase).min(1) }),
  z.object({ judge: z.literal("consistency"), cases: z.array(ConsistencyCase).min(1) }),
]);
export type JudgeFile = z.infer<typeof JudgeFileSchema> & { file: string };
export type FalseRecallCase = z.infer<typeof FalseRecallCase>;
export type RecallCase = z.infer<typeof RecallCase>;
export type ConsistencyCase = z.infer<typeof ConsistencyCase>;

export function loadJudgeFiles(dir: string): JudgeFile[] {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => {
      try {
        return {
          file: f.replace(/\.ya?ml$/, ""),
          ...JudgeFileSchema.parse(parseYaml(readFileSync(path.join(dir, f), "utf8"))),
        };
      } catch (e) {
        throw new Error(`invalid judge fixture ${f}: ${(e as Error).message}`);
      }
    });
}

type Graded = { status: CaseStatus; detail: string };

export function gradeFalseRecall(
  expect: FalseRecallCase["expect"],
  categories: FalseRecallCategory[],
  detail: string,
): Graded {
  const got = detail || "no violations";
  if (expect === "pass") return { status: categories.length === 0 ? "pass" : "fail", detail: got };
  return { status: categories.some((c) => expect.includes(c)) ? "pass" : "fail", detail: got };
}

export function gradeRecall(expect: RecallOutcome, outcome: RecallOutcome, detail: string): Graded {
  return {
    status: outcome === expect ? "pass" : "fail",
    detail: `${outcome}${detail ? `: ${detail}` : ""}`,
  };
}

export function gradeConsistency(expect: "pass" | "fail", pass: boolean, detail: string): Graded {
  return {
    status: (pass ? "pass" : "fail") === expect ? "pass" : "fail",
    detail: detail || "no contradictions",
  };
}

/** Runs one fixture case through the real judge function; a thrown judge call is an error, never a pass. */
export async function runJudgeCase(
  llm: LLMProvider,
  config: Config,
  file: JudgeFile,
  name: string,
): Promise<Graded> {
  try {
    switch (file.judge) {
      case "false_recall": {
        const c = file.cases.find((x) => x.name === name)!;
        const r = await judgeFalseRecall(llm, config, { known: c.known, sessions: c.sessions });
        return gradeFalseRecall(c.expect, r.categories, r.detail);
      }
      case "recall": {
        const c = file.cases.find((x) => x.name === name)!;
        const r = await judgeRecall(llm, config, { fact: c.fact, transcript: c.lines });
        return gradeRecall(c.expect, r.outcome, r.detail);
      }
      case "consistency": {
        const c = file.cases.find((x) => x.name === name)!;
        const r = await judgeConsistency(llm, config, c.facts);
        return gradeConsistency(c.expect, r.pass, r.detail);
      }
    }
  } catch (e) {
    return { status: "error", detail: (e as Error).message };
  }
}
