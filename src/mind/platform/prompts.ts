/**
 * Loads a versioned prompt file, prompts/<name>/<version>.md. Prompts never live inline in code,
 * so every change to what a model is told is a reviewable file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const PROMPT_NAME = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const PROMPT_VERSION = /^v\d+$/;

const cache = new Map<string, string>();

export function loadPrompt(
  name: string,
  version: string,
  root = path.join(process.cwd(), "prompts"),
): string {
  if (!PROMPT_NAME.test(name) || !PROMPT_VERSION.test(version)) {
    throw new Error(`invalid prompt reference ${name}@${version}`);
  }

  const file = path.join(root, name, `${version}.md`);
  const cached = cache.get(file);
  if (cached !== undefined) return cached;

  const text = readPromptFile(file);
  cache.set(file, text);
  return text;
}

function readPromptFile(file: string): string {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    throw new Error(`prompt not found: ${file}`);
  }
}
