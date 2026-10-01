/**
 * What the guard sends instead when a message can't be fixed: a fallback line from a prompt
 * file. Also the corrective note that asks the reply model to try again.
 */
import type { Config } from "@/mind/platform/config";
import { loadPrompt } from "@/mind/platform/prompts";
import { CATEGORY_LABEL } from "./categories";
import type { Violation } from "./guard";

type FallbackKind = "reply" | "crisis_reply";
const KINDS: FallbackKind[] = ["reply", "crisis_reply"];

/** Parses `## reply` and `## crisis_reply` sections of `- line` items; both must be present. */
export function parseFallbacks(markdown: string): Record<FallbackKind, string[]> {
  const sections: Record<string, string[]> = {};
  let heading: string | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();

    const headingMatch = /^##\s+(\S+)/.exec(line);
    if (headingMatch) {
      heading = headingMatch[1]!;
      sections[heading] = [];
      continue;
    }

    const itemMatch = /^-\s+(.+)$/.exec(line);
    if (heading && itemMatch) sections[heading]!.push(itemMatch[1]!.trim());
  }

  for (const kind of KINDS) {
    if (!sections[kind]?.length) throw new Error(`fallback prompt has no "${kind}" lines`);
  }
  return sections as Record<FallbackKind, string[]>;
}

/** The same seed picks the same line, so a retried message sends the same fallback. */
export function pickFallback(lines: string[], seed: string | null): string {
  let hash = 0;
  for (const char of seed ?? "") hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return lines[hash % lines.length]!;
}

export function fallbackLine(config: Config, kind: FallbackKind, seed: string | null): string {
  const fallbacks = parseFallbacks(loadPrompt("guard/fallback", config.prompts.guard_fallback));
  return pickFallback(fallbacks[kind], seed);
}

export function correctiveNote(config: Config, violations: Violation[]): string {
  const reasons = violations.map((v) => `- ${CATEGORY_LABEL[v.category]} (${v.claim})`).join("\n");
  const template = loadPrompt("guard/corrective", config.prompts.guard_corrective);
  return template.replace("{{violations}}", reasons);
}
