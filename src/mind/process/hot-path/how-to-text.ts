/**
 * The "How to text this one" section of her reply: how long her texts run with this user, whether
 * she can be tidier or use emoji with them, and what she does this time. Code picks, the phrase
 * file words it, so the model never sees a number.
 */
import type { Config } from "@/mind/platform/config";
import { parseSummaryPhrases, type Phrases } from "@/mind/platform/phrases";
import { loadPrompt } from "@/mind/platform/prompts";
import { MOVES, type Move } from "./move";
import type { TextingShape } from "./texting-shape";

export const HOW_TO_TEXT_HEADING = "## How to text this one";

export function loadHowToTextPhrases(config: Config): Phrases {
  return parseSummaryPhrases(loadPrompt("voice/how-to-text", config.prompts.voice_how_to_text));
}

export function howToText(
  input: { shape: TextingShape; move: Move | null; mustAnswer: boolean },
  phrases: Phrases,
): string {
  const line = (key: string) => phrases[key]?.[0] ?? null;
  return [
    line(`band ${input.shape.band.key}`),
    line("more"),
    input.shape.formal ? line("formal") : null,
    input.shape.emoji ? line("emoji") : null,
    input.mustAnswer ? line("answer") : null,
    input.move ? line(`move ${input.move}`) : null,
  ]
    .filter((l): l is string => !!l)
    .join("\n");
}

/** The section's body inside a recorded reply prompt, for the voice report. */
export function directiveOf(prompt: string): string | null {
  const start = prompt.indexOf(`${HOW_TO_TEXT_HEADING}\n`);
  if (start === -1) return null;
  const body = prompt.slice(start + HOW_TO_TEXT_HEADING.length + 1);
  const end = body.indexOf("\n\n");
  return end === -1 ? body : body.slice(0, end);
}

export function directiveMove(directive: string, phrases: Phrases): Move | null {
  return MOVES.find((m) => (phrases[`move ${m}`] ?? []).some((p) => directive.includes(p))) ?? null;
}
