const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");

/** Outage-only pre-check: the first configured phrase contained in `text`, or null. */
export function matchKeyword(text: string, keywords: string[]): string | null {
  const t = norm(text);
  return keywords.find((k) => t.includes(norm(k))) ?? null;
}
