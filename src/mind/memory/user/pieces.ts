/**
 * Pieces: the numbered addresses a labelling call cites. Each message is split at its line breaks
 * (her bubbles) and after sentence ends, and numbered "<message>.<piece>" from the first message
 * shown. A piece is an address, never a unit of meaning: a label covers any set of them. Every
 * piece, and every phrase quoted inside one, maps back to a character range in its message; that
 * range is what gets kept, so the split can change without breaking anything stored.
 */
import { formatLocal } from "@/mind/platform/timezone";

export type Speaker = "user" | "spica";
export type Message = { id: string; speaker: Speaker; text: string; at: Date };
/** A character range in one message's text: the only way a label points at words. */
export type Coordinate = { turnId: string; start: number; end: number };
export type Piece = {
  id: string;
  message: Message;
  start: number;
  end: number;
  text: string;
  /** Part of what is being labelled now; older pieces are there to be read and pointed back at. */
  isNew: boolean;
};

const LINE = /[^\n]+/g;
const SENTENCE_END = /[.!?]+(?=\s)/g;

/** Messages from index `firstNew` on are new. A message with no words keeps its number. */
export function numberPieces(messages: Message[], firstNew: number): Piece[] {
  return messages.flatMap((message, i) =>
    splitRanges(message.text).map(([start, end], k) => ({
      id: `${i + 1}.${k + 1}`,
      message,
      start,
      end,
      text: message.text.slice(start, end),
      isNew: i >= firstNew,
    })),
  );
}

/** The character ranges of a message's pieces: its lines, each cut after a sentence end, trimmed. */
export function splitRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const line of text.matchAll(LINE)) {
    let start = 0;
    for (const end of line[0].matchAll(SENTENCE_END)) {
      const stop = end.index + end[0].length;
      pushTrimmed(ranges, line[0], line.index, start, stop);
      start = stop;
    }
    pushTrimmed(ranges, line[0], line.index, start, line[0].length);
  }
  return ranges;
}

export function coordinate(piece: Piece): Coordinate {
  return { turnId: piece.message.id, start: piece.start, end: piece.end };
}

/** Where `words` sit inside the piece, ignoring case and spacing; null when they aren't there. */
export function findPhrase(piece: Piece, words: string): Coordinate | null {
  const tokens = words.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (tokens.length === 0) return null;
  const match = new RegExp(tokens.join("\\s+"), "i").exec(piece.text);
  if (!match) return null;
  const start = piece.start + match.index;
  return { turnId: piece.message.id, start, end: start + match[0].length };
}

/** The pieces as the call reads them: a message's first piece carries its speaker and time. */
export function renderPieces(pieces: Piece[], zone: string): string {
  let last: string | null = null;
  return pieces
    .map((p) => {
      const who = p.message.speaker === "user" ? "User" : "Spica";
      const head = p.message.id === last ? who : `${who} · ${formatLocal(p.message.at, zone)}`;
      last = p.message.id;
      return `[${p.id}] ${head}: ${p.text}`;
    })
    .join("\n");
}

function pushTrimmed(
  ranges: [number, number][],
  line: string,
  offset: number,
  start: number,
  end: number,
): void {
  while (start < end && /\s/.test(line[start]!)) start += 1;
  while (end > start && /\s/.test(line[end - 1]!)) end -= 1;
  if (end > start) ranges.push([offset + start, offset + end]);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
