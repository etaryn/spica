import type { Config } from "@/mind/platform/config";
import { loadPrompt } from "@/mind/platform/prompts";
import { CATEGORY_LABEL } from "./categories";
import type { Violation } from "./guard";

type FallbackKind = "reply" | "crisis_reply";
const KINDS: FallbackKind[] = ["reply", "crisis_reply"];

/** `## reply` / `## crisis_reply` sections of `- line` items. */
export function parseFallbacks(md: string): Record<FallbackKind, string[]> {
  const out: Record<string, string[]> = {};
  let cur: string | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(\S+)/.exec(line);
    if (heading) {
      cur = heading[1]!;
      out[cur] = [];
      continue;
    }
    const item = /^-\s+(.+)$/.exec(line);
    if (cur && item) out[cur]!.push(item[1]!.trim());
  }
  for (const k of KINDS)
    if (!out[k]?.length) throw new Error(`fallback prompt has no "${k}" lines`);
  return out as Record<FallbackKind, string[]>;
}

/** Same seed, same line: a retried message sends the same fallback. */
export function pickFallback(lines: string[], seed: string | null): string {
  let h = 0;
  for (const ch of seed ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return lines[h % lines.length]!;
}

export function fallbackLine(config: Config, kind: FallbackKind, seed: string | null): string {
  return pickFallback(
    parseFallbacks(loadPrompt("guard/fallback", config.prompts.guard_fallback))[kind],
    seed,
  );
}

export function correctiveNote(config: Config, violations: Violation[]): string {
  const reasons = violations.map((v) => `- ${CATEGORY_LABEL[v.category]} (${v.claim})`).join("\n");
  return loadPrompt("guard/corrective", config.prompts.guard_corrective).replace(
    "{{violations}}",
    reasons,
  );
}
