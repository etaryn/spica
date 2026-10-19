// PostToolUse hook: ESLint the file Claude just edited, so a broken boundary rule (core reading
// user data, the mind touching the clock or env) surfaces at the edit instead of at the end.
// Formatting is left to `pnpm format` before commit.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const file = input.tool_input?.file_path ?? input.tool_response?.filePath;
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const eslint = path.join(root, "node_modules", "eslint", "bin", "eslint.js");

if (!file || !/\.(ts|tsx|mjs)$/.test(file) || !existsSync(eslint)) process.exit(0);
const rel = path.relative(root, file);
if (rel.startsWith("..") || path.isAbsolute(rel)) process.exit(0);

const run = spawnSync(process.execPath, [eslint, "--no-warn-ignored", rel], {
  cwd: root,
  encoding: "utf8",
});
if (run.status !== 0) {
  process.stderr.write(`ESLint failed on ${rel}:\n${run.stdout}${run.stderr}`);
  process.exit(2);
}
