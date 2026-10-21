import type { Logger } from "./log";
import { DAY } from "./time";
import { localDateString } from "./timezone";
/**
 * Dates as she would say them: "today", "yesterday", "3 days ago", "in 2 days", counted in whole
 * calendar days of the given zone. Every time a prompt reads goes through here, so the model never
 * counts days; and stored text is checked for relative words, which go stale on the next day.
 */

export function relativeDate(when: Date, now: Date, tz: string): string {
  const days = Math.round((dayStart(now, tz) - dayStart(when, tz)) / DAY);

  if (days < 0) return `in ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** "Sunday 11 January, yesterday": the date itself and how far it is from now. */
export function dayInWords(when: Date, now: Date, tz: string): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(when)
    .replace(",", "");
  return `${date}, ${relativeDate(when, now, tz)}`;
}

/** "written Tuesday 13 January, 2 days ago": what a note calls today was that day's. */
export function writtenOn(at: Date, now: Date, tz: string): string {
  return `written ${dayInWords(at, now, tz)}`;
}

/** A note about the present, headed by the day it was written. */
export function stamped(text: string, at: Date, now: Date, tz: string): string {
  return `(${writtenOn(at, now, tz)})\n${text}`;
}

/**
 * When a memory's thing happens, and when she learned it if that was another day: "about
 * Saturday" read on Tuesday and on Sunday are different news.
 */
export function itemWhen(about: Date, noted: Date | null, now: Date, tz: string): string {
  const day = dayInWords(about, now, tz);
  if (!noted || localDateString(noted, tz) === localDateString(about, tz)) return day;
  return `${day}; noted ${dayInWords(noted, now, tz)}`;
}

// Day words that mean something else when the text is read on a later day.
const RELATIVE =
  /\b(today|tonight|tomorrow|yesterday|this (?:morning|afternoon|evening|week|weekend)|last night|next week)\b/gi;

/** The relative day words in a text, lowercased, in order. */
export function relativeWords(text: string): string[] {
  return [...text.matchAll(RELATIVE)].map((m) => m[1]!.toLowerCase());
}

/**
 * Logs relative words that slipped into text about to be stored. Nothing is retried or changed:
 * readers see the written-on date, and the review counts the slips.
 */
export function noteRelativeWords(
  log: Logger,
  writer: string,
  texts: (string | null | undefined)[],
): string[] {
  const words = texts.flatMap((t) => (t ? relativeWords(t) : []));
  if (words.length) log.info("relative words in stored text", { writer, words });
  return words;
}

function dayStart(at: Date, tz: string): number {
  return Date.parse(`${localDateString(at, tz)}T00:00:00Z`);
}
