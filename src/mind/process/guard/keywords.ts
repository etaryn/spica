/**
 * The guard's outage keyword check: the first configured phrase found in a message, used only
 * when the guard model can't be reached.
 */

function normalize(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
}

export type KeywordMap = Partial<Record<string, string[]>>;

/** The first phrase found, with the category it stands for, so an outage hit is logged truly. */
export function matchKeyword(
  text: string,
  keywords: KeywordMap,
): { category: string; phrase: string } | null {
  const normalized = normalize(text);
  for (const [category, phrases] of Object.entries(keywords)) {
    const phrase = phrases?.find((k) => normalized.includes(normalize(k)));
    if (phrase) return { category, phrase };
  }
  return null;
}
