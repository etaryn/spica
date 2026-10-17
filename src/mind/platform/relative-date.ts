import { DAY } from "./time";
import { localDateString } from "./timezone";
/**
 * Dates as she would say them: "today", "yesterday", "3 days ago", "in 2 days", counted in whole
 * calendar days of the given zone (hers, so "yesterday" is her yesterday).
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

function dayStart(at: Date, tz: string): number {
  return Date.parse(`${localDateString(at, tz)}T00:00:00Z`);
}
