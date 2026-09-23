import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, parseConfigOverrides } from "@/core/config";
import { AnthropicProvider } from "@/core/llm/anthropic";
import { FakeLLMProvider, keywordClassifier } from "@/core/llm/fake";
import { messageToJudge } from "@/core/safety/crisis";
import { assertDisposableDatabase } from "@/db/admin";
import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { findRegressions, toBaseline } from "./lib/report";
import { runScript, type ScriptResult } from "./lib/runner";
import { loadScripts } from "./lib/script";

const { values: args } = parseArgs({
  options: {
    llm: { type: "string", default: "fake" },
    compare: { type: "boolean", default: false },
    only: { type: "string" },
    "update-baseline": { type: "boolean", default: false },
  },
});

const root = path.join(process.cwd(), "evals");
const dbUrl = process.env.EVAL_DATABASE_URL ?? "postgres://spica:spica@localhost:5432/spica_eval";
assertDisposableDatabase(dbUrl);

const config = loadConfig(parseConfigOverrides(process.env.SPICA_CONFIG));
if (args.llm !== "real" && args.llm !== "fake") throw new Error(`--llm must be fake or real, got ${args.llm}`);
const makeLlm = args.llm === "real"
  ? () => new AnthropicProvider(new Anthropic(), config.models)
  : () => new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });

const { db, pool } = createDb(dbUrl);
await runMigrations(db);

const scripts = loadScripts(path.join(root, "scripts")).filter((s) => !args.only || s.name === args.only);
if (scripts.length === 0) throw new Error(args.only ? `no script named ${args.only}` : "no eval scripts found");

const results: ScriptResult[] = [];
for (const script of scripts) {
  const r = await runScript(script, { db, dbUrl, config, makeLlm });
  results.push(r);
  console.log(`${r.status.toUpperCase().padEnd(7)} ${r.name}${r.error ? `  (${r.error})` : ""}`);
  for (const a of r.assertions.filter((x) => x.status !== "pass")) {
    console.log(`          ${a.status}: ${a.type}${a.check ? `/${a.check}` : ""}${a.detail ? ` — ${a.detail}` : ""}`);
  }
}
await pool.end();

mkdirSync(path.join(root, "results"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(path.join(root, "results", `${stamp}.json`), JSON.stringify({ llm: args.llm, results }, null, 2));

const baselinePath = path.join(root, "baseline.json");
if (args["update-baseline"]) {
  writeFileSync(baselinePath, JSON.stringify(toBaseline(results), null, 2) + "\n");
  console.log(`baseline written: ${baselinePath}`);
}

let exitCode = 0;
if (args.compare) {
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
  const regressions = findRegressions(results, baseline);
  if (regressions.length) {
    console.error(`REGRESSIONS: ${regressions.join(", ")}`);
    exitCode = 1;
  } else {
    console.log("no regressions against baseline");
  }
} else if (results.some((r) => r.status === "fail" || r.status === "error")) {
  exitCode = 1;
}
process.exit(exitCode);
