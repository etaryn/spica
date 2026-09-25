import type { ScriptResult } from "./runner";

export type AssertionSummary = {
  type: string; check?: string; user?: string; passes: number; runs: number;
  status: "pass" | "fail" | "skipped"; detail?: string;
};
export type ScriptSummary = {
  name: string; status: "pass" | "fail" | "skipped" | "error"; runs: number; passedRuns: number;
  assertions: AssertionSummary[]; errors: string[];
};
type BaselineEntry = string | { status: string; runs: number; passedRuns: number };

/**
 * Guardrail checks (crisis, sensitive data, cross-user isolation) must pass on every run; everything else is memory
 * behaviour and passes on a majority. Ethan 2026-09-25: for Phase 1, memory that works matters more than memory that
 * never fails; fine-tuning and guarding come in later phases.
 */
const EVERY_RUN_CHECKS = new Set(["turn_flagged", "crisis_card_shown", "fact_flag", "prompt_mentions", "foreign_turn_count"]);

export function aggregateRuns(runs: ScriptResult[]): ScriptSummary {
  const name = runs[0]?.name ?? "";
  const errors = runs.filter((r) => r.status === "error").map((r) => r.error ?? "error");
  const counted = runs.filter((r) => r.status !== "error" && r.status !== "skipped");
  const base = { name, runs: runs.length, passedRuns: runs.filter((r) => r.status === "pass").length, errors };
  if (errors.length > 0) return { ...base, status: "error", assertions: [] };
  if (counted.length === 0) return { ...base, status: "skipped", assertions: [] };

  const assertions: AssertionSummary[] = counted[0]!.assertions.map((a0, i) => {
    const sts = counted.map((r) => r.assertions[i]?.status ?? "error");
    const passes = sts.filter((s) => s === "pass").length;
    const skipped = sts.every((s) => s === "skipped");
    const everyRun = a0.type === "state" && a0.check !== undefined && EVERY_RUN_CHECKS.has(a0.check);
    const ok = everyRun ? passes === counted.length : passes * 2 > counted.length;
    const detail = counted.map((r) => r.assertions[i]).find((x) => x && x.status !== "pass")?.detail;
    return { type: a0.type, check: a0.check, user: a0.user, passes, runs: counted.length,
      status: skipped ? "skipped" : ok ? "pass" : "fail", detail };
  });
  const status = assertions.some((a) => a.status === "fail") ? "fail" : assertions.some((a) => a.status === "pass") ? "pass" : "skipped";
  return { ...base, status, assertions };
}

export function toBaseline(summaries: ScriptSummary[]): Record<string, BaselineEntry> {
  return Object.fromEntries(summaries.map((s) => [s.name, { status: s.status, runs: s.runs, passedRuns: s.passedRuns }]));
}

/**
 * Baseline-passing scripts that no longer pass, or whose pass rate dropped. Scripts not run are ignored, and a
 * `skipped` script counts as not run (e.g. a `mode: real` script under --llm=fake against a real-run baseline).
 */
export function findRegressions(current: ScriptSummary[], baseline: Record<string, BaselineEntry>): string[] {
  const now = new Map(current.map((s) => [s.name, s]));
  const out: string[] = [];
  for (const [name, entry] of Object.entries(baseline)) {
    const cur = now.get(name);
    const status = typeof entry === "string" ? entry : entry.status;
    if (!cur || cur.status === "skipped" || status !== "pass") continue;
    if (cur.status !== "pass") out.push(name);
    else if (typeof entry !== "string" && entry.runs > 0 && cur.runs > 0 && cur.passedRuns / cur.runs < entry.passedRuns / entry.runs) {
      out.push(`${name} (pass rate ${cur.passedRuns}/${cur.runs} < ${entry.passedRuns}/${entry.runs})`);
    }
  }
  return out;
}
