import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, parseConfigOverrides } from "@/core/config";
import { VoyageEmbedder } from "@/core/embed/voyage";
import { AnthropicProvider } from "@/core/llm/anthropic";
import { FakeLLMProvider, keywordClassifier } from "@/core/llm/fake";
import { messageToJudge } from "@/core/safety/crisis";
import { assertDisposableDatabase } from "@/db/admin";
import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { aggregateRuns, findRegressions, toBaseline, type ScriptSummary } from "./lib/report";
import { runScript } from "./lib/runner";
import { loadProfiles, loadScripts } from "./lib/script";
import { UsageTally } from "./lib/usage";

const { values: args } = parseArgs({
  options: {
    llm: { type: "string", default: "fake" },
    runs: { type: "string" },
    compare: { type: "boolean", default: false },
    only: { type: "string" },
    profile: { type: "string" },
    trace: { type: "boolean", default: false },
    "update-baseline": { type: "boolean", default: false },
  },
});

const root = path.join(process.cwd(), "evals");
const dbUrl = process.env.EVAL_DATABASE_URL ?? "postgres://spica:spica@localhost:5432/spica_eval";
assertDisposableDatabase(dbUrl);

const config = loadConfig(parseConfigOverrides(process.env.SPICA_CONFIG));
if (args.llm !== "real" && args.llm !== "fake") throw new Error(`--llm must be fake or real, got ${args.llm}`);
const usage = new UsageTally();
const makeLlm = args.llm === "real"
  ? () => new AnthropicProvider(new Anthropic(), config.models, usage.record)
  : () => new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });

const real = args.llm === "real";
const runs = Number(args.runs ?? (real ? 3 : 1));
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer, got ${args.runs}`);
if (real && !process.env.VOYAGE_API_KEY) throw new Error("--llm=real needs VOYAGE_API_KEY");
const embedder = real
  ? new VoyageEmbedder({ apiKey: process.env.VOYAGE_API_KEY, model: config.embedding.model, dimensions: config.embedding.dimensions })
  : undefined;

const { db, pool } = createDb(dbUrl);
await runMigrations(db);

// `--profile <name>` runs the suite with one onboarding profile (the "how much profile data" experiment);
// scripts that opt out with `profile: none` stay cold.
const scripts = loadScripts(path.join(root, "scripts"))
  .filter((s) => !args.only || args.only.split(",").includes(s.name))
  .map((s) => (args.profile && s.profile !== "none" ? { ...s, profile: args.profile } : s));
if (scripts.length === 0) throw new Error(args.only ? `no script named ${args.only}` : "no eval scripts found");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const traceDir = path.join(root, "results", "traces", stamp);
if (args.trace) mkdirSync(traceDir, { recursive: true });

const profiles = loadProfiles(path.join(root, "profiles"));
const summaries: ScriptSummary[] = [];
for (const script of scripts) {
  const attempts = [];
  for (let k = 0; k < runs; k++) {
    const attempt = await runScript(script, { db, dbUrl, config, makeLlm, judge: real, embedder, profiles });
    if (args.trace) {
      writeFileSync(path.join(traceDir, `${script.name}-${k + 1}.json`),
        JSON.stringify({ status: attempt.status, error: attempt.error, assertions: attempt.assertions, meta: attempt.meta, ...attempt.trace }, null, 2));
    }
    attempts.push(attempt);
  }
  const s = aggregateRuns(attempts);
  summaries.push(s);
  console.log(`${s.status.toUpperCase().padEnd(7)} ${s.name}  (${s.passedRuns}/${s.runs} runs)${s.errors.length ? `  (${s.errors[0]})` : ""}`);
  for (const a of s.assertions.filter((x) => x.status !== "pass")) {
    console.log(`          ${a.status}: ${a.type}${a.check ? `/${a.check}` : ""} ${a.passes}/${a.runs}${a.detail ? ` — ${a.detail}` : ""}`);
  }
}
await pool.end();
for (const line of usage.format()) console.log(line);

mkdirSync(path.join(root, "results"), { recursive: true });
writeFileSync(path.join(root, "results", `${stamp}.json`), JSON.stringify({ llm: args.llm, runs, results: summaries, usage: usage.summary() }, null, 2));

const baselinePath = path.join(root, "baseline.json");
if (args["update-baseline"]) {
  writeFileSync(baselinePath, JSON.stringify(toBaseline(summaries), null, 2) + "\n");
  console.log(`baseline written: ${baselinePath}`);
}

let exitCode = 0;
if (args.compare) {
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
  const regressions = findRegressions(summaries, baseline);
  if (regressions.length) {
    console.error(`REGRESSIONS: ${regressions.join(", ")}`);
    exitCode = 1;
  } else {
    console.log("no regressions against baseline");
  }
} else if (summaries.some((s) => s.status === "fail" || s.status === "error")) {
  exitCode = 1;
}
process.exit(exitCode);
