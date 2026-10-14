/**
 * Puts a reply into her texting form after the guard has passed it: dashes become commas, and
 * unless this user writes tidily, capitalised words go lowercase and a text loses its closing
 * full stop. A text running well past this user's length splits at sentence ends into more texts.
 * Only form changes: every word is kept, so the guard's verdict still holds.
 */
import { wordCount } from "./texting-shape";

export type ShapeLimits = { maxWords: number; formal: boolean };

/** A dash between two numbers is a range ("3 – 5" reads "3–5"); any other dash is a pause. */
const DASH = /(\d?)\s*([—–])\s*(\d?)/g;
const SENTENCE_BREAK = /(?<=[.!?])\s+/;
/** Capitalised words ("Hey", "I", "I'm", "Sam's"); all-caps words like "GPS" don't match. */
const CAPITALISED = /\b[A-Z][a-z']*\b/g;
/** A single closing full stop; "..." keeps its dots. */
const CLOSING_STOP = /(?<!\.)\.$/;

function undash(bubble: string): string {
  return bubble
    .replace(DASH, (_, a: string, dash: string, b: string) =>
      a && b ? `${a}${dash}${b}` : `${a}, ${b}`,
    )
    .replace(/,\s*([,.!?])/g, "$1")
    .replace(/^,\s*/, "")
    .replace(/,\s*$/, "");
}

/** Packs whole sentences into texts of at most `maxWords`; a single long sentence stays whole. */
function splitLong(bubble: string, maxWords: number): string[] {
  if (wordCount(bubble) <= maxWords) return [bubble];
  const out: string[] = [];
  let current = "";
  for (const sentence of bubble.split(SENTENCE_BREAK)) {
    const joined = current ? `${current} ${sentence}` : sentence;
    if (current && wordCount(joined) > maxWords) {
      out.push(current);
      current = sentence;
    } else {
      current = joined;
    }
  }
  if (current) out.push(current);
  return out;
}

function casual(bubble: string): string {
  return bubble.replace(CAPITALISED, (w) => w.toLowerCase()).replace(CLOSING_STOP, "");
}

export function shapeText(text: string, limits: ShapeLimits, maxParts: number): string {
  const bubbles = text
    .split(/\n\s*\n/)
    .map((b) => undash(b.trim()))
    .filter(Boolean)
    .flatMap((b) => splitLong(b, limits.maxWords))
    .map((b) => (limits.formal ? b : casual(b)));
  const kept =
    bubbles.length <= maxParts
      ? bubbles
      : [...bubbles.slice(0, maxParts - 1), bubbles.slice(maxParts - 1).join(" ")];
  return kept.join("\n\n");
}
