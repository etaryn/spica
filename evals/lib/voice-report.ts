/**
 * The voice report for a review run: for each reply she drafted, the length she was steered to,
 * the move she was given and whether the draft did it, and the tells of written-not-texted in the
 * text that was sent (dashes, capitals, closing full stops, stage directions). Numbers to read
 * next to the transcript, never a verdict.
 */
import type { Phrases } from "@/mind/platform/phrases";
import { directiveMove, directiveOf } from "@/mind/process/hot-path/how-to-text";
import type { Move } from "@/mind/process/hot-path/move";
import { splitParts } from "@/mind/process/hot-path/split-parts";
import { wordCount } from "@/mind/process/hot-path/texting-shape";

export type VoiceCall = { prompt: string; draft: string };
export type VoiceStats = {
  words: number[];
  dashes: number;
  capitals: number;
  endStops: number;
  endsInQuestion: boolean;
  stageDirections: number;
};

/** Enough to keep every text separate when counting. */
const ALL_PARTS = 99;

export function voiceStats(text: string): VoiceStats {
  const bubbles = splitParts(text, ALL_PARTS);
  return {
    words: bubbles.map(wordCount),
    dashes: (text.match(/[—–]/g) ?? []).length,
    capitals: (text.match(/\b[A-Z][a-z']*\b/g) ?? []).length,
    endStops: bubbles.filter((b) => /(?<!\.)\.$/.test(b)).length,
    endsInQuestion: text.trim().endsWith("?"),
    stageDirections: (text.match(/\([^)]*\)|\*[^*\n]+\*/g) ?? []).length,
  };
}

/**
 * Cheap pattern checks: ask has a question; react has none; share doesn't end on one and says
 * something of hers.
 */
export function moveFollowed(move: Move, draft: string): boolean {
  const asks = /\?/.test(draft);
  if (move === "ask") return asks;
  if (move === "react") return !asks;
  return !draft.trim().endsWith("?") && /\b(i|i'm|i've|i'd|my|me)\b/i.test(draft);
}

function statLine(s: VoiceStats): string {
  return `words [${s.words.join(", ")}], dashes ${s.dashes}, capitals ${s.capitals}, end stops ${s.endStops}, ends in ? ${s.endsInQuestion ? "yes" : "no"}, stage directions ${s.stageDirections}`;
}

function bandOf(directive: string, phrases: Phrases): string {
  return (
    Object.keys(phrases).find(
      (k) => k.startsWith("band ") && phrases[k]!.some((p) => directive.includes(p)),
    ) ?? "band ?"
  );
}

export function renderVoiceReport(
  calls: VoiceCall[],
  finals: string[],
  phrases: Phrases,
): string[] {
  const out = ["### Voice", ""];
  let given = 0;
  let followed = 0;
  calls.forEach((call, i) => {
    const directive = directiveOf(call.prompt);
    const move = directive ? directiveMove(directive, phrases) : null;
    const did = move ? moveFollowed(move, call.draft) : null;
    if (move) given += 1;
    if (did) followed += 1;
    const band = directive ? bandOf(directive, phrases) : "no directive (crisis)";
    const moveText = move ? `move ${move} (${did ? "followed" : "not followed"})` : "no move";
    out.push(`- draft ${i + 1}: ${band}; ${moveText}; ${statLine(voiceStats(call.draft))}`);
  });
  finals.forEach((text, i) => out.push(`- sent ${i + 1}: ${statLine(voiceStats(text))}`));

  const sent = finals.map(voiceStats);
  const sum = (f: (s: VoiceStats) => number) => sent.reduce((n, s) => n + f(s), 0);
  const allWords = sent.flatMap((s) => s.words);
  const mean = allWords.length
    ? (allWords.reduce((a, b) => a + b, 0) / allWords.length).toFixed(1)
    : "-";
  out.push(
    "",
    `- totals: ${finals.length} sent, mean words per text ${mean}, dashes ${sum((s) => s.dashes)}, capitals ${sum((s) => s.capitals)}, end stops ${sum((s) => s.endStops)}, ending in ? ${sent.filter((s) => s.endsInQuestion).length}, stage directions ${sum((s) => s.stageDirections)}, moves followed ${followed}/${given}`,
    "",
  );
  return out;
}
