/**
 * A memory as every reader sees it: its label and status, its dates as tokens the renderer reads
 * on the day a prompt is sent, then the words it rests on, quoted, each with who said it. Built
 * once, when the memory is written: the label and the words never change after that.
 */
import { labelToken, type ResolvedTime } from "@/mind/platform/time-labels";
import type { Act, CheckedMove } from "./annotations";
import type { Piece, Speaker } from "./pieces";

export type LineMove = { speaker: Speaker; act: Act; text: string };

const VERB: Partial<Record<Act, string>> = {
  asks: "asked",
  answers: "answered",
  confirms: "confirmed",
  denies: "denied",
  corrects: "corrected",
  promises: "promised",
  offers: "offered",
  requests: "asked",
};

export function memoryLine(
  p: { label: string; status: string | null },
  moves: LineMove[],
  times: ResolvedTime[],
  zone: string,
  quoteChars: number,
): string {
  const head = [p.label, p.status].filter(Boolean).join(", ");
  // The same day said twice is one date.
  const dates = [...new Set(times.map((t) => labelToken(t, zone)))].join(", ");
  return `${head}${dates ? ` ${dates}` : ""} — ${quoted(moves, quoteChars)}`;
}

/** A memory's label, status and dates: its line before the words it rests on. */
export function lineHead(content: string): string {
  const i = content.indexOf(" — ");
  return i < 0 ? content : content.slice(0, i);
}

export function quoted(moves: LineMove[], quoteChars: number): string {
  return moves
    .map(
      (m) =>
        `${m.speaker === "user" ? "the user" : "Spica"} ${VERB[m.act] ?? "said"} "${cap(clean(m.text), quoteChars)}"`,
    )
    .join("; ");
}

export function embedText(label: string, moves: LineMove[], quoteChars: number): string {
  return `${label}: ${moves.map((m) => cap(clean(m.text), quoteChars)).join(" / ")}`;
}

export function moveText(move: CheckedMove, pieces: Piece[]): string {
  return move.pieces
    .map((id) => pieces.find((p) => p.id === id)?.text)
    .filter(Boolean)
    .join(" / ");
}

// Their words may hold the token brackets or the separator; quoted, they must stay plain words.
function clean(text: string): string {
  return text.replace(/[⟦⟧|]/g, "").replace(/\s+/g, " ").trim();
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[,.;\s]+$/, "")}…`;
}
