/**
 * Blind model comparison for her voice: runs the same review scripts once with each reply model,
 * saves the two review files as X and Y in random order, and writes which is which to a separate
 * key file, so the transcripts can be read without knowing the model.
 */
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    only: {
      type: "string",
      default: "voice-texting-styles,guard-provoke-banter,guard-provoke-absence",
    },
    a: { type: "string", default: "claude-sonnet-5" },
    b: { type: "string", default: "claude-haiku-5-5" },
  },
});

/** Haiku 4.5 rejects `effort`, so it runs without one. */
function overrides(model: string): string {
  const effort = /haiku-4/.test(model) ? { reply_effort: null } : {};
  return JSON.stringify({ models: { reply: model, ...effort } });
}

function run(model: string): string {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "--env-file-if-exists=.env",
      "evals/run.ts",
      "--only",
      args.only!,
      "--runs",
      "1",
      "--review",
      "--real",
      "reply,guard,guard_crisis,turn_judge,labels_read,labels_meaning,labels_signals,embed",
    ],
    {
      env: { ...process.env, SPICA_CONFIG: overrides(model) },
      encoding: "utf8",
      shell: true,
    },
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  const written = /review written: (.+)$/m.exec(result.stdout ?? "")?.[1]?.trim();
  if (!written) throw new Error(`no review file from the ${model} run`);
  return written;
}

const files: Record<string, string> = { [args.a!]: run(args.a!), [args.b!]: run(args.b!) };
const [x, y] = randomInt(2) === 0 ? [args.a!, args.b!] : [args.b!, args.a!];
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.join(process.cwd(), "evals", "results");
copyFileSync(files[x]!, path.join(dir, `voice-${stamp}-X.md`));
copyFileSync(files[y]!, path.join(dir, `voice-${stamp}-Y.md`));
writeFileSync(path.join(dir, `voice-${stamp}-key.txt`), `X: ${x}\nY: ${y}\n`);
console.log(`blind files: voice-${stamp}-X.md and -Y.md (key in voice-${stamp}-key.txt)`);
