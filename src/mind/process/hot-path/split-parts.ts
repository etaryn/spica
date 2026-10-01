/** Splits a reply into texting-style bubbles on blank lines; overflow merges into the last bubble. */
export function splitParts(text: string, maxParts: number): string[] {
  const parts = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return [text.trim()];
  if (parts.length <= maxParts) return parts;
  return [...parts.slice(0, maxParts - 1), parts.slice(maxParts - 1).join("\n\n")];
}
