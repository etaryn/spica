/**
 * Her persona file has two parts: the core values, which nothing ever rewrites, and the seed self,
 * her starting snapshot. The split lives in the file's headings, so moving a line from one part
 * to the other is an edit to the prompt file, never to code.
 */
import type { Config } from "./config";
import { loadPrompt } from "./prompts";

export type Persona = { coreValues: string; seedSelf: string };

const CORE = "Core values";
const SEED = "Seed self";

/** Splits the file at its top-level `# ` headings; sections other than these two are ignored. */
export function parsePersona(markdown: string): Persona {
  const sections = new Map<string, string>();
  let current: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current !== null) sections.set(current, lines.join("\n").trim());
  };
  for (const line of markdown.split("\n")) {
    const heading = /^# (.+)$/.exec(line);
    if (heading) {
      flush();
      current = heading[1]!.trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();

  const coreValues = sections.get(CORE);
  const seedSelf = sections.get(SEED);
  if (!coreValues) throw new Error(`persona file has no "# ${CORE}" section`);
  if (!seedSelf) throw new Error(`persona file has no "# ${SEED}" section`);
  return { coreValues, seedSelf };
}

export function loadPersona(config: Config): Persona {
  return parsePersona(loadPrompt("persona", config.prompts.persona));
}
