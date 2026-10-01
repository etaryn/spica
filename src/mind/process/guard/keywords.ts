/**
 * The guard's outage keyword check: the first configured phrase found in a message, used only
 * when the guard model can't be reached.
 */

function normalize(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
}

export function matchKeyword(text: string, keywords: string[]): string | null {
  const normalized = normalize(text);
  return keywords.find((keyword) => normalized.includes(normalize(keyword))) ?? null;
}
