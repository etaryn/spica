/**
 * Dates from what they said. The model copies the time words ("next monday", "in two weeks") and
 * code works out the date in their time zone: a model doing calendar sums put a fifth of its
 * weekdays on the wrong day.
 */
import * as chrono from "chrono-node";
import { DAY } from "@/mind/platform/time";
import { zoneOffsetMinutes } from "@/mind/platform/timezone";
import type { Extraction } from "./extract";

export type ResolvedWhen = { at: Date; label: string };

// Words pointing back in time: forward-dating would push "last friday" into next week.
const PAST = /\b(last|ago|yesterday|earlier|previous|before)\b/i;
const BARE_WEEKDAY = /^(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;

function parts(at: Date, zone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
}

/** "Monday 12 January 2026" in their zone. */
export function dayLabel(at: Date, zone: string): string {
  const p = parts(at, zone);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

export function resolveWhen(phrase: string, ref: Date, zone: string): ResolvedWhen | null {
  const text = phrase.trim();
  if (!text) return null;
  const past = PAST.test(text);
  const reference = { instant: ref, timezone: zoneOffsetMinutes(ref, zone) };
  const result = chrono.parse(text, reference, { forwardDate: !past })[0];
  if (!result) return null;
  const start = result.start;
  let at = start.date();
  // "monday" said on a Monday means next week's.
  if (BARE_WEEKDAY.test(text) && dayLabel(at, zone) === dayLabel(ref, zone))
    at = new Date(at.getTime() + 7 * DAY);

  const p = parts(at, zone);
  const day = start.isCertain("day") || start.isCertain("weekday");
  if (/\bweekend\b/i.test(text)) return { at, label: `the weekend of ${dayLabel(at, zone)}` };
  // chrono reads "next week" as that week's first day, certain; it means the whole week.
  if (/\bnext week\b/i.test(text)) return { at, label: `the week of ${dayLabel(at, zone)}` };
  if (day) return { at, label: dayLabel(at, zone) };
  if (start.isCertain("month")) return { at, label: `${p.month} ${p.year}` };
  return { at, label: p.year! };
}

/** Fills each fact's `{when}` and dates; the model's own date is the fallback, then its words. */
export function applyWhen(extraction: Extraction, ref: Date | null, zone: string): Extraction {
  const facts = extraction.facts.map((f) => {
    const resolved = ref && f.when ? resolveWhen(f.when, ref, zone) : null;
    const occurred_at = resolved?.at ?? f.occurred_at;
    const label =
      resolved?.label ?? (f.occurred_at ? dayLabel(f.occurred_at, zone) : (f.when ?? null));
    const content = label
      ? f.content.replace("{when}", label)
      : f.content.replace(/\s*\{when\}/, "");
    return { ...f, content: content.replace(/\s+([.,!?])/g, "$1"), occurred_at };
  });
  const threads = extraction.threads.map((t) => {
    const resolved = ref && t.checkpoint_when ? resolveWhen(t.checkpoint_when, ref, zone) : null;
    return { ...t, next_checkpoint: resolved?.at ?? t.next_checkpoint };
  });
  return { ...extraction, facts, threads };
}
