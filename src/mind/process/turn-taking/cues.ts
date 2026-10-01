/**
 * A keyword version of "has the user finished?": the turn judge's fallback when the model is
 * down, and the fake judge in tests. A message looks unfinished when it trails off ("…"), ends
 * on a cue word ("and", "but"), or is a single word.
 */

export function cueVerdict(buffer: string[], openQuestions: string[], cues: string[]) {
  const last = (buffer.at(-1) ?? "").trim();
  const words = last
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const trailsOff = /(\.\.\.|…)$/.test(last);
  const endsOnCue = words.length > 0 && cues.includes(words.at(-1)!);
  const singleWord = words.length < 2;
  const complete = !(trailsOff || endsOnCue || singleWord);

  const asked = buffer.filter((m) => m.trim().endsWith("?")).map((m) => m.trim());
  const open_questions = [...new Set([...openQuestions, ...asked])];

  return { complete, open_questions, backchannel: null };
}
