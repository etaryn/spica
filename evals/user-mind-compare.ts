/**
 * Haiku against Sonnet on her user-mind loops, same inputs: replays every logged user-mind call
 * from a call log on the reply model and writes both outputs side by side as X and Y in random
 * order, with the key in a separate file.
 */
import { randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, parseConfigOverrides } from "@/mind/platform/config";
import { realProvider } from "./lib/call-log";

const file = process.argv[2];
if (!file) throw new Error("usage: pnpm review:user-mind <evals/results/calls/eval-….jsonl>");
const config = loadConfig(parseConfigOverrides(process.env.SPICA_CONFIG));
const llm = realProvider(config, "user-mind-compare");

type Logged = { purpose: string; system: string; input: string; output?: unknown };
const calls = readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Logged)
  .filter((c) => c.purpose.startsWith("user_") && c.output !== undefined);

const out: string[] = [`# User-mind compare ${path.basename(file)}`, ""];
const key: string[] = [];
for (const [i, c] of calls.entries()) {
  const other = await llm.generateReply({
    system: [{ text: c.system }],
    messages: [{ role: "user", content: c.input }],
  });
  const haiku = JSON.stringify(c.output, null, 2);
  const [x, y, xIs] =
    randomInt(2) === 0 ? [haiku, other, "haiku"] : [other, haiku, config.models.reply];
  out.push(
    `## ${i + 1}. ${c.purpose}`,
    "",
    "```json",
    c.input,
    "```",
    "",
    "**X**",
    "",
    x,
    "",
    "**Y**",
    "",
    y,
    "",
  );
  key.push(`${i + 1}: X=${xIs}`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.join(process.cwd(), "evals", "results");
writeFileSync(path.join(dir, `user-mind-${stamp}.md`), out.join("\n"));
writeFileSync(path.join(dir, `user-mind-${stamp}-key.txt`), key.join("\n") + "\n");
console.log(`written: user-mind-${stamp}.md (key in user-mind-${stamp}-key.txt)`);
