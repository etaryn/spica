import type { ScriptResult } from "./runner";

/** Scripts that pass in the baseline but not now. Scripts not run this time are ignored. */
export function findRegressions(current: ScriptResult[], baseline: Record<string, string>): string[] {
  const now = new Map(current.map((r) => [r.name, r.status]));
  return Object.entries(baseline)
    .filter(([name, status]) => status === "pass" && now.has(name) && now.get(name) !== "pass")
    .map(([name]) => name);
}

export function toBaseline(results: ScriptResult[]): Record<string, string> {
  return Object.fromEntries(results.map((r) => [r.name, r.status]));
}
