/**
 * Splits a reply into texting-style bubbles at blank lines. Anything past `maxParts` merges into
 * the last bubble.
 */

export function splitParts(text: string, maxParts: number): string[] {
  const parts = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return [text.trim()];
  if (parts.length <= maxParts) return parts;

  const kept = parts.slice(0, maxParts - 1);
  const overflow = parts.slice(maxParts - 1).join("\n\n");
  return [...kept, overflow];
}
