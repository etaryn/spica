/**
 * A keyword version of "has the user finished?": the turn judge's fallback when the model is
 * down, and the fake judge in tests. A message looks unfinished when it trails off ("…"), ends
 * on a cue word ("and", "but"), or is a single word.
 */

export function cueVerdict(buffer: string[], cues: string[]): { complete: boolean } {
  const last = (buffer.at(-1) ?? "").trim();
  const words = last
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const trailsOff = /(\.\.\.|…)$/.test(last);
  const endsOnCue = words.length > 0 && cues.includes(words.at(-1)!);
  const singleWord = words.length < 2;
  return { complete: !(trailsOff || endsOnCue || singleWord) };
}
