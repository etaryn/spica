/**
 * Phrase files: a prompt file of `## key` headings, each followed by `- phrase` lines, read into
 * lists by key.
 */

/** Phrase lists by heading, parsed from a prompt file of `## heading` and `- phrase` lines. */
export type Phrases = Record<string, string[]>;

export function parseSummaryPhrases(markdown: string): Phrases {
  const phrases: Phrases = {};
  let heading: string | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();

    const headingMatch = /^##\s+(.+)$/.exec(line);
    if (headingMatch) {
      heading = headingMatch[1]!.trim();
      phrases[heading] = [];
      continue;
    }

    const itemMatch = /^-\s+(.+)$/.exec(line);
    if (heading && itemMatch) phrases[heading]!.push(itemMatch[1]!.trim());
  }
  return phrases;
}
