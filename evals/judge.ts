import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, parseConfigOverrides } from "@/core/config";
import { AnthropicProvider } from "@/core/llm/anthropic";
import {
  caseResult,
  findGuardRegressions,
  type CaseStatus,
  type GuardBaselineEntry,
  type GuardRunRow,
} from "./lib/guard-cases";
import { loadJudgeFiles, runJudgeCase } from "./lib/judge-cases";
import { UsageTally } from "./lib/usage";

/**
 * Judge fixture suite: fixed transcripts with known verdicts, run through the eval judges alone (no replies,
 * DB or embeddings), so a judge model or prompt change can be checked for leniency cheaply. Real model only.
 */
const { values: args } = parseArgs({
  options: {
    runs: { type: "string", default: "3" },
    only: { type: "string" },
    compare: { type: "boolean", default: false },
    "update-baseline": { type: "boolean", default: false },
  },
});
const runs = Number(args.runs);
if (!Number.isInteger(runs) || runs < 1)
  throw new Error(`--runs must be a positive integer, got ${args.runs}`);
if (!process.env.ANTHROPIC_API_KEY) throw new Error("pnpm eval:judge needs ANTHROPIC_API_KEY");

const config = loadConfig(parseConfigOverrides(process.env.SPICA_CONFIG));
const usage = new UsageTally();
const llm = new AnthropicProvider(new Anthropic(), config.models, usage.record);
const root = path.join(process.cwd(), "evals");
const files = loadJudgeFiles(path.join(root, "judge"));
const only = args.only?.split(",");

const rows: (GuardRunRow & { details: string[] })[] = [];
for (const f of files) {
  for (const c of f.cases.filter((x) => !only || only.includes(x.name) || only.includes(f.file))) {
    const statuses: CaseStatus[] = [];
    const details: string[] = [];
    for (let k = 0; k < runs; k++) {
      const g = await runJudgeCase(llm, config, f, c.name);
      statuses.push(g.status);
      if (g.status !== "pass") details.push(`${g.status}: ${g.detail}`);
    }
    // Judges are graded on a majority of runs, like the memory eval's judged assertions.
    const { status, reason } = caseResult(c, statuses, "majority");
    const passes = statuses.filter((s) => s === "pass").length;
    rows.push({
      file: f.file,
      name: c.name,
      status,
      passes,
      runs,
      details,
      knownFailure: c.known_failure ?? null,
    });
    const label = status === "known_failure" ? "KNOWN" : status.toUpperCase();
    console.log(
      `${label.padEnd(5)} ${f.file}/${c.name}  (${passes}/${runs})${reason ? `  [known failure (${reason})]` : ""}${details.length ? `  — ${details[0]}` : ""}`,
    );
  }
}

const failed = rows.filter((r) => r.status === "fail");
const known = rows.filter((r) => r.status === "known_failure");
for (const line of usage.format()) console.log(line);
console.log(
  `\n${rows.length - failed.length - known.length}/${rows.length} cases pass (judge ${config.models.judge})${known.length ? `, ${known.length} known failure(s)` : ""}`,
);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(path.join(root, "results"), { recursive: true });
writeFileSync(
  path.join(root, "results", `judge-${stamp}.json`),
  JSON.stringify({ model: config.models.judge, runs, rows, usage: usage.summary() }, null, 2),
);

const baselinePath = path.join(root, "judge-baseline.json");
if (args["update-baseline"]) {
  const baseline = Object.fromEntries(
    rows.map((r) => [`${r.file}/${r.name}`, { status: r.status, runs: r.runs, passes: r.passes }]),
  );
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`baseline written: ${baselinePath}`);
}
let exitCode = failed.length ? 1 : 0;
if (args.compare && existsSync(baselinePath)) {
  const drops = findGuardRegressions(
    rows,
    JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, GuardBaselineEntry>,
  );
  if (drops.length) {
    console.error(`REGRESSIONS: ${drops.map((r) => `${r.file}/${r.name}`).join(", ")}`);
    exitCode = 1;
  }
}
process.exit(exitCode);
