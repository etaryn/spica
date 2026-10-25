/**
 * Replay for labelled memory: reruns the live labelling (three calls, each thinking) over the
 * latest world runs' conversations and the invented chat ones, after each exchange, and writes one
 * review file to read by hand. Reads dumps and call logs;
 * writes no database. Every call is logged under evals/results/calls/. `--dry` builds every input
 * and prints the counts and one input, without calling a model.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { emptyLabels } from "@/mind/memory/user/annotations";
import { buildLabelInput } from "@/mind/memory/user/label-input";
import { messagesOf } from "@/mind/memory/user/layers";
import { numberPieces } from "@/mind/memory/user/pieces";
import { loadConfig } from "@/mind/platform/config";
import { spend } from "@/mind/platform/llm/meter";
import { realProvider } from "./lib/call-log";
import { runReplay } from "./lib/label-replay";
import { NAMED_CASES, renderReview } from "./lib/label-review";
import { loadRun } from "./lib/replay-source";
import { SLANG_CONVERSATIONS } from "./lib/slang-conversations";
import { UsageTally } from "./lib/usage";

const RESULTS = path.join(process.cwd(), "evals", "results");
const RUNS = [
  { run: "10-22", trace: "2026-10-22T08-27-19-368Z", calls: "eval-2026-10-22T08-27-19-194Z" },
  { run: "16b close", trace: "2026-10-24T08-48-12-791Z", calls: "eval-2026-10-24T08-48-12-585Z" },
  { run: "16c close", trace: "2026-10-24T15-12-40-678Z", calls: "eval-2026-10-24T15-12-40-452Z" },
];
const config = loadConfig();
const conversations = [
  ...RUNS.flatMap((r) =>
    loadRun(
      r.run,
      path.join(RESULTS, "traces", r.trace, "world-outreach-two-weeks-1-db.json"),
      path.join(RESULTS, "calls", `${r.calls}.jsonl`),
      config.extraction.context_turns,
    ),
  ),
  ...SLANG_CONVERSATIONS,
];

if (process.argv.includes("--dry")) {
  const exchanges = conversations.flatMap((c) => c.exchanges);
  const matched = exchanges.filter((e) => e.v11 !== null).length;
  console.log(
    `${conversations.length} conversations, ${exchanges.length} exchanges, ${matched} matched to a logged v11 call`,
  );
  const c = conversations.find((x) => x.run !== "invented" && x.turns.length > 3)!;
  console.log(
    buildLabelInput({
      pieces: numberPieces(messagesOf([...c.before, ...c.turns]), c.before.length),
      zone: c.zone,
      threads: c.exchanges[0]?.threads ?? [],
      interests: c.exchanges[0]?.interests ?? [],
      earlier: emptyLabels(),
    }),
  );
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("pnpm review:extract-labels needs ANTHROPIC_API_KEY");
}

const usage = new UsageTally();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(RESULTS, `review-extract-labels-${stamp}.md`);
mkdirSync(RESULTS, { recursive: true });

console.log("exchange mode: three calls, each thinking…");
const calls = await runReplay(
  { llm: realProvider(config, "extract-replay", usage.record), config },
  conversations,
);
const lines = usage.summary().map((u) => ({
  purpose: u.purpose,
  calls: u.calls,
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cost: spend([u], config.core.prices).cost,
}));
writeFileSync(
  file,
  renderReview({
    stamp,
    title: "exchange mode, three calls with thinking",
    conversations,
    calls,
    usage: lines,
    namedCases: NAMED_CASES,
  }),
);
console.log(`wrote ${file}`);
for (const line of usage.format()) console.log(line);
