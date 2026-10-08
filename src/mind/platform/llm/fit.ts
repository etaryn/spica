/**
 * Fitting model output to the bounds code owns. Strict structured output can't enforce lengths or
 * item counts (the model only sees them as hints), so a schema built from these trims what the
 * model overfills: extra list items are dropped and overlong text is cut with an ellipsis. One
 * extra line no longer fails a whole loop; empty or wrongly shaped output still does.
 */
import { z } from "zod";

/**
 * At most `max` UTF-16 units, the length zod and the database count, ending in "…" when cut and
 * never splitting a surrogate pair.
 */
export function fitChars(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut}…`;
}

/** One line of text: whitespace collapsed, at most `max` characters, never empty. */
export const fitText = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" ? fitChars(value.replace(/\s+/g, " ").trim(), max) : value,
    z.string().min(1).max(max),
  );

/** A list of at most `max` items, keeping the model's first ones. */
export const fitList = <T extends z.ZodType>(item: T, max: number) =>
  z.preprocess(
    (value) => (Array.isArray(value) ? value.slice(0, max) : value),
    z.array(item).max(max),
  );
