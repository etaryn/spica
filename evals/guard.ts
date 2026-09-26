import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { systemClock } from "@/core/clock";
import { loadConfig, parseConfigOverrides } from "@/core/config";
import { checkMessage } from "@/core/guard/guard";
import { AnthropicProvider } from "@/core/llm/anthropic";
import { caseResult, findGuardRegressions, gradeCase, loadGuardFiles, toGuardInput, type CaseStatus, type GuardBaselineEntry } from "./lib/guard-cases";

/** Guard fixture suite (spec §7.2): real guard model only; there is no fake mode. */
const { values: args } = parseArgs({
  options: {
    runs: { type: "string", default: "3" },
    only: { type: "string" },
    compare: { type: "boolean", default: false },
    "update-baseline": { type: "boolean", default: false },
  },
});
const runs = Number(args.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer, got ${args.runs}`);
if (!process.env.ANTHROPIC_API_KEY) throw new Error("pnpm eval:guard needs ANTHROPIC_API_KEY");

const config = loadConfig(parseConfigOverrides(process.env.SPICA_CONFIG));
const deps = { llm: new AnthropicProvider(new Anthropic(), config.models), config, clock: systemClock };
const root = path.join(process.cwd(), "evals");
const files = loadGuardFiles(path.join(root, "guard"));

type Row = { file: string; name: string; status: "pass" | "fail" | "known_failure"; passes: number; runs: number; details: string[]; knownFailure: string | null };
const rows: Row[] = [];
for (const f of files) {
  for (const c of f.cases.filter((x) => !args.only || x.name === args.only || f.file === args.only)) {
    const statuses: CaseStatus[] = [];
    const details: string[] = [];
    for (let k = 0; k < runs; k++) {
      const g = gradeCase(c, await checkMessage(deps, toGuardInput(c, new Date())), f.gate);
      statuses.push(g.status);
      if (g.status !== "pass") details.push(`${g.status}: ${g.detail}`);
    }
    const { status, reason } = caseResult(c, statuses, f.gate);
    const passes = statuses.filter((s) => s === "pass").length;
    rows.push({ file: f.file, name: c.name, status, passes, runs, details, knownFailure: c.known_failure ?? null });
    const label = status === "known_failure" ? `KNOWN` : status.toUpperCase();
    const known = reason ? `  [known failure (${reason})]` : "";
    console.log(`${label.padEnd(5)} ${f.file}/${c.name}  (${passes}/${runs})${known}${details.length ? `  — ${details[0]}` : ""}`);
  }
}

const failed = rows.filter((r) => r.status === "fail");
const known = rows.filter((r) => r.status === "known_failure");
console.log(`\n${rows.length - failed.length - known.length}/${rows.length} cases pass${known.length ? `, ${known.length} known failure(s)` : ""}`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(path.join(root, "results"), { recursive: true });
writeFileSync(path.join(root, "results", `guard-${stamp}.json`), JSON.stringify({ model: config.models.guard, runs, rows }, null, 2));

const baselinePath = path.join(root, "guard-baseline.json");
if (args["update-baseline"]) {
  const baseline = Object.fromEntries(rows.map((r) => [`${r.file}/${r.name}`, { status: r.status, runs: r.runs, passes: r.passes }]));
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`baseline written: ${baselinePath}`);
}
let exitCode = failed.length ? 1 : 0;
if (args.compare && existsSync(baselinePath)) {
  const base = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, GuardBaselineEntry>;
  const drops = findGuardRegressions(rows, base);
  if (drops.length) {
    console.error(`REGRESSIONS: ${drops.map((r) => `${r.file}/${r.name}`).join(", ")}`);
    exitCode = 1;
  }
}
process.exit(exitCode);
