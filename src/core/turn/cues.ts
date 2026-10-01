/**
 * Deterministic `context_complete?`: the judge's outage fallback, and the fake judge.
 * Incomplete when the last message trails off ("…"), ends on a cue word, or is a single word.
 */
export function cueVerdict(buffer: string[], openQuestions: string[], cues: string[]) {
  const last = (buffer.at(-1) ?? "").trim();
  const words = last.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);
  const trailing = /(\.\.\.|…)$/.test(last);
  const cue = words.length > 0 && cues.includes(words.at(-1)!);
  const complete = !(trailing || cue || words.length < 2);
  const asked = buffer.filter((m) => m.trim().endsWith("?")).map((m) => m.trim());
  const open_questions = [...new Set([...openQuestions, ...asked])];
  return { complete, open_questions, backchannel: null };
}
