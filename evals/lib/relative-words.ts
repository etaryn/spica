/**
 * Relative day words left in stored text or a loop's output: the review counts the time words her
 * loops wrote without labelling them. It reads text for the review only, never for storage.
 */
const RELATIVE_WORDS =
  /\b(today|tonight|tomorrow|yesterday|this (?:morning|afternoon|evening|week|weekend)|last night|next week)\b/gi;

export function relativeWords(text: string): string[] {
  return [...text.matchAll(RELATIVE_WORDS)].map((m) => m[1]!.toLowerCase());
}
