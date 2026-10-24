/**
 * Replay for labelled memory: reruns the labelling call (extract v12) over the latest world runs'
 * conversations and the invented chat ones, after each exchange and once per conversation, with
 * thinking off and on, and writes one review file to read by hand. Reads dumps and call logs;
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
import { loadPrompt } from "@/mind/platform/prompts";
import { realProvider } from "./lib/call-log";
import { runUnit, type UnitResult } from "./lib/label-replay";
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
// A dev tool's limits, not the mind's: room for every layer of a whole conversation, and for
// thinking before it.
const MAX_TOKENS = { off: 8192, on: 16384 };
const TIMEOUT_MS = 180_000;

const config = loadConfig();
const thinkingConfig = loadConfig({ models: { structured_thinking: "adaptive" } });
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
const system = loadPrompt("extract", "v12");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(RESULTS, `review-extract-labels-${stamp}.md`);
const results: UnitResult[] = [];
mkdirSync(RESULTS, { recursive: true });

const passes = [
  { thinking: false, llm: realProvider(config, "extract-replay", usage.record) },
  { thinking: true, llm: realProvider(thinkingConfig, "extract-replay-thinking", usage.record) },
];
for (const { thinking, llm } of passes) {
  for (const unit of ["exchange", "conversation"] as const) {
    console.log(`${unit} mode, thinking ${thinking ? "on" : "off"}…`);
    results.push(
      await runUnit(llm, unit, conversations, {
        system,
        thinking,
        maxTokens: thinking ? MAX_TOKENS.on : MAX_TOKENS.off,
        timeoutMs: TIMEOUT_MS,
      }),
    );
    // Written after every unit, so a crash later still leaves what was paid for.
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
      renderReview({ stamp, conversations, results, usage: lines, namedCases: NAMED_CASES }),
    );
  }
}
console.log(`wrote ${file}`);
for (const line of usage.format()) console.log(line);
