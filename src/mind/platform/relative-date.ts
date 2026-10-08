import { DAY } from "./time";
/**
 * Dates as she would say them: "today", "yesterday", "3 days ago", "in 2 days". Counted in whole
 * UTC calendar days.
 */

export function relativeDate(when: Date, now: Date): string {
  const days = Math.round((startOfDay(now) - startOfDay(when)) / DAY);

  if (days < 0) return `in ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function startOfDay(at: Date): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}
