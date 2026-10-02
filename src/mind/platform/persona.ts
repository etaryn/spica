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
const GOALS = "### Goals";
const GOAL_LINE = /^- (.+?): (.+)$/;

/** Her starting goals: the bullets under the seed self's Goals heading. */
export function parseSeedGoals(seedSelf: string): { title: string; why: string }[] {
  const goals: { title: string; why: string }[] = [];
  let inGoals = false;
  for (const line of seedSelf.split("\n")) {
    if (line.startsWith("### ")) {
      inGoals = line.trim() === GOALS;
      continue;
    }
    const match = inGoals ? GOAL_LINE.exec(line.trim()) : null;
    if (match) goals.push({ title: match[1]!.trim(), why: match[2]!.trim() });
  }
  return goals;
}

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
