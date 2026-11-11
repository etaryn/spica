// PreToolUse hook: a shell command that calls a real (paid) model always asks Ethan first, even in
// auto mode. Free runs (`pnpm test`, `pnpm eval` with fakes) pass untouched.
import { readFileSync } from "node:fs";

const PAID = [
  // Every review, exit and calibration script runs real model calls.
  /\b(?:pnpm|npm\s+run|yarn)\s+(?:run\s+)?(?:review:|exit:|calibrate:|eval:guard\b|eval:judge\b)/,
  // `pnpm eval` is free with fakes and paid with --real or --llm=real.
  /\b(?:pnpm|npm\s+run|yarn)\s+(?:run\s+)?eval\b[^;&|]*--(?:real\b|llm[= ]real\b)/,
  // The same entry points called directly.
  /\btsx\b[^;&|]*evals[\\/](?:guard|judge|guard-replay|voice-compare|user-mind-compare|scripts[\\/](?:posts-review|formats-add))\.ts/,
  /\btsx\b[^;&|]*evals[\\/]run\.ts[^;&|]*--(?:real\b|llm[= ]real\b)/,
];

const input = JSON.parse(readFileSync(0, "utf8"));
const command = String(input.tool_input?.command ?? "");

if (PAID.some((re) => re.test(command))) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          "Paid model run. Approve only if Ethan agreed to this run; its calls log to evals/results/.",
      },
    }),
  );
}
