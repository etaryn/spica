import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, parseConfigOverrides } from "@/mind/platform/config";
import { VoyageEmbedder } from "@/mind/platform/embedder/voyage";
import { AnthropicProvider } from "@/mind/platform/llm/anthropic";
import { FakeLLMProvider, keywordClassifier } from "@/mind/platform/llm/fake";
import { messageToJudge } from "@/mind/process/crisis/classifier";
import { loadHowToTextPhrases } from "@/mind/process/hot-path/how-to-text";
import { assertDisposableDatabase } from "@/db/admin";
import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { aggregateRuns, findRegressions, mergeBaseline, type ScriptSummary } from "./lib/report";
import { resolveProfile } from "./lib/profile";
import { renderReview, type ReviewRun } from "./lib/review";
import { RoutingLLM } from "./lib/routing-llm";
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
    real: { type: "string" },
    annotate: { type: "boolean", default: false },
    review: { type: "boolean", default: false },
    "update-baseline": { type: "boolean", default: false },
  },
});

const root = path.join(process.cwd(), "evals");
const dbUrl = process.env.EVAL_DATABASE_URL ?? "postgres://spica:spica@localhost:5432/spica_eval";
assertDisposableDatabase(dbUrl);

const config = loadConfig(parseConfigOverrides(process.env.SPICA_CONFIG));
// Exit profiles: each call purpose is real only when listed; everything else is fake.
const { realPurposes, realCalls, anyReal, realScripts, fake } = resolveProfile({
  llm: args.llm!,
  real: args.real,
  annotate: args.annotate,
});

const usage = new UsageTally();
// The fake side: keyword crisis classifier, no-op cold path, and a guard that passes everything.
const fakeProvider = () =>
  new FakeLLMProvider({
    classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)),
  });
const makeLlm =
  realCalls.length === 0
    ? fakeProvider
    : () =>
        new RoutingLLM(
          new AnthropicProvider(new Anthropic(), config.models, usage.record),
          fakeProvider(),
          realPurposes,
        );

const runs = Number(args.runs ?? (anyReal ? 3 : 1));
if (!Number.isInteger(runs) || runs < 1)
  throw new Error(`--runs must be a positive integer, got ${args.runs}`);
if (realCalls.length > 0 && !process.env.ANTHROPIC_API_KEY)
  throw new Error(`real ${realCalls.join(", ")} needs ANTHROPIC_API_KEY`);
if (realPurposes.has("embed") && !process.env.VOYAGE_API_KEY)
  throw new Error("real embed needs VOYAGE_API_KEY");
const embedder = realPurposes.has("embed")
  ? new VoyageEmbedder({
      apiKey: process.env.VOYAGE_API_KEY,
      model: config.embedding.model,
      dimensions: config.embedding.dimensions,
    })
  : undefined;
console.log(
  `real: ${[...realPurposes].join(", ") || "(none)"} | fake: ${fake.join(", ")}${realScripts ? "" : " | mode: real scripts skipped (need a real reply)"}`,
);

const { db, pool } = createDb(dbUrl);
await runMigrations(db);

// `--profile <name>` runs the suite with one onboarding profile (the "how much profile data" experiment);
// scripts that opt out with `profile: none` stay cold.
const scripts = loadScripts(path.join(root, "scripts"))
  .filter((s) => !args.only || args.only.split(",").includes(s.name))
  .map((s) => (args.profile && s.profile !== "none" ? { ...s, profile: args.profile } : s));
if (scripts.length === 0)
  throw new Error(args.only ? `no script named ${args.only}` : "no eval scripts found");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const traceDir = path.join(root, "results", "traces", stamp);
if (args.trace) mkdirSync(traceDir, { recursive: true });

const profiles = loadProfiles(path.join(root, "profiles"));
const summaries: ScriptSummary[] = [];
const reviewRuns: ReviewRun[] = [];
for (const script of scripts) {
  const attempts = [];
  for (let k = 0; k < runs; k++) {
    const attempt = await runScript(script, {
      db,
      dbUrl,
      config,
      makeLlm,
      real: realScripts,
      annotate: args.annotate,
      embedder,
      profiles,
      turnJudgeReal: realPurposes.has("turn_judge"),
      extractReal: realPurposes.has("extract"),
      realPurposes,
    });
    if (args.review)
      reviewRuns.push({
        script: script.name,
        attempt: k + 1,
        result: attempt,
        description: script.description,
        profile: script.profile,
      });
    if (args.trace) {
      writeFileSync(
        path.join(traceDir, `${script.name}-${k + 1}.json`),
        JSON.stringify(
          {
            status: attempt.status,
            error: attempt.error,
            assertions: attempt.assertions,
            annotations: attempt.annotations,
            meta: attempt.meta,
            ...attempt.trace,
          },
          null,
          2,
        ),
      );
    }
    attempts.push(attempt);
  }
  const s = aggregateRuns(attempts);
  summaries.push(s);
  console.log(
    `${s.status.toUpperCase().padEnd(7)} ${s.name}  (${s.passedRuns}/${s.runs} runs)${s.errors.length ? `  (${s.errors[0]})` : ""}`,
  );
  for (const a of s.assertions.filter((x) => x.status !== "pass")) {
    console.log(
      `          ${a.status}: ${a.type}${a.check ? `/${a.check}` : ""} ${a.passes}/${a.runs}${a.detail ? ` — ${a.detail}` : ""}`,
    );
  }
  // Annotations are review notes: printed, never counted.
  for (const [k, attempt] of attempts.entries()) {
    for (const n of attempt.annotations) {
      console.log(
        `  note${runs > 1 ? ` (run ${k + 1})` : ""}: ${n.type} ${n.verdict}${n.detail ? ` — ${n.detail}` : ""}`,
      );
    }
  }
}
await pool.end();
for (const line of usage.format()) console.log(line);

mkdirSync(path.join(root, "results"), { recursive: true });
writeFileSync(
  path.join(root, "results", `${stamp}.json`),
  JSON.stringify(
    { llm: args.llm, real: [...realPurposes], runs, results: summaries, usage: usage.summary() },
    null,
    2,
  ),
);

// --review: a markdown log of every input and output for manual analysis; no pass/fail, no baseline.
if (args.review) {
  const reviewPath = path.join(root, "results", `review-${stamp}.md`);
  writeFileSync(
    reviewPath,
    renderReview(reviewRuns, {
      stamp,
      real: [...realPurposes],
      annotate: args.annotate,
      voicePhrases: loadHowToTextPhrases(config),
    }),
  );
  console.log(`review written: ${reviewPath}`);
  process.exit(summaries.some((s) => s.status === "error") ? 1 : 0);
}

const baselinePath = path.join(root, "baseline.json");
if (args["update-baseline"]) {
  // Merge: a partial (--only) or fake run must not wipe the entries of scripts it didn't run.
  const existing = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
  writeFileSync(baselinePath, JSON.stringify(mergeBaseline(existing, summaries), null, 2) + "\n");
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
