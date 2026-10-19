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
// Words meaning now: "this morning" at 23:30 is today's, "this friday" on a Friday is today.
const PRESENT = /\b(this|today|tonight)\b/i;
const TODAY = /\b(today|this (morning|afternoon|evening))\b/i;
const BARE_WEEKDAY = /^(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
// chrono reads "this week" as its first day (last Sunday), certain; it means the week it was said in.
// The whole phrase only: "friday this week" names its day and stays with chrono.
const THIS_WEEK = /^(later )?this week$/i;
const WEEK_END = /^(by |at )?(the )?end of (the|this) week$/i;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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

/** Monday of the week `ref` falls in, in their zone. */
function mondayOf(ref: Date, zone: string): Date {
  const back = WEEKDAYS.indexOf(parts(ref, zone).weekday!);
  return new Date(ref.getTime() - back * DAY);
}

/** "Monday 12 January 2026" in their zone. */
export function dayLabel(at: Date, zone: string): string {
  const p = parts(at, zone);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

export function resolveWhen(phrase: string, ref: Date, zone: string): ResolvedWhen | null {
  const text = phrase.trim();
  if (!text) return null;
  if (WEEK_END.test(text)) {
    const monday = mondayOf(ref, zone);
    return {
      at: new Date(monday.getTime() + 4 * DAY),
      label: `the end of the week of ${dayLabel(monday, zone)}`,
    };
  }
  if (THIS_WEEK.test(text)) {
    return { at: ref, label: `the week of ${dayLabel(mondayOf(ref, zone), zone)}` };
  }
  const past = PAST.test(text);
  const reference = { instant: ref, timezone: zoneOffsetMinutes(ref, zone) };
  let result = chrono.parse(text, reference, { forwardDate: !past && !PRESENT.test(text) })[0];
  if (!result) return null;
  // "in october" said in October is this October, not next year's.
  if (!result.start.isCertain("day") && result.start.isCertain("month")) {
    const plain = chrono.parse(text, reference)[0];
    if (plain && parts(plain.start.date(), zone).month === parts(ref, zone).month) result = plain;
  }
  const start = result.start;
  let at = start.date();
  // "this morning" or "today" is the day it was said, even late at night.
  if (TODAY.test(text) && dayLabel(at, zone) !== dayLabel(ref, zone) && at > ref)
    at = new Date(at.getTime() - DAY);
  // "monday" said on a Monday means next week's.
  if (BARE_WEEKDAY.test(text) && dayLabel(at, zone) === dayLabel(ref, zone))
    at = new Date(at.getTime() + 7 * DAY);

  const p = parts(at, zone);
  const day = start.isCertain("day") || start.isCertain("weekday") || start.isCertain("hour");
  if (/\bweekend\b/i.test(text)) return { at, label: `the weekend of ${dayLabel(at, zone)}` };
  // chrono reads "next week" as that week's first day, certain; it means the whole week.
  if (/\bnext week\b/i.test(text)) return { at, label: `the week of ${dayLabel(at, zone)}` };
  if (day) return { at, label: dayLabel(at, zone) };
  if (start.isCertain("month")) return { at, label: `${p.month} ${p.year}` };
  if (start.isCertain("year")) return { at, label: p.year! };
  // No day, month or year given ("this evening"): it's about the day it was said, or chrono's move.
  return { at, label: dayLabel(at, zone) };
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
