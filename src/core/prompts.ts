import { readFileSync } from "node:fs";
import path from "node:path";

const cache = new Map<string, string>();

/** Loads prompts/<name>/<version>.md. Prompts never live inline in code. */
export function loadPrompt(name: string, version: string, root = path.join(process.cwd(), "prompts")): string {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(name) || !/^v\d+$/.test(version)) {
    throw new Error(`invalid prompt reference ${name}@${version}`);
  }
  const file = path.join(root, name, `${version}.md`);
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  let text: string;
  try {
    text = readFileSync(file, "utf8").trim();
  } catch {
    throw new Error(`prompt not found: ${file}`);
  }
  cache.set(file, text);
  return text;
}
