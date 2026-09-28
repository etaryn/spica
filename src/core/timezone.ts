/** True for a real IANA zone name (Intl throws RangeError for unknown zones). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * "Mon 2026-01-05 09:00 (Europe/London)": local time with weekday, so the extractor can resolve "Friday".
 * ISO order on purpose: the model misread "05/01/2026" as 5 May.
 */
export function formatLocal(d: Date, tz: string | null): string {
  const zone = tz && isValidTimeZone(tz) ? tz : "UTC";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${zone})`;
}

/** The calendar date of `d` in `tz`, as "YYYY-MM-DD" (en-CA formats ISO order). */
export function localDateString(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** The day before a "YYYY-MM-DD" date (calendar arithmetic, no time zone). */
export function previousLocalDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The day after a "YYYY-MM-DD" date (calendar arithmetic, no time zone). */
export function nextLocalDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The local hour-of-day (0-23) of `d` in `tz` (v2 §15.4 #33: the tick's local-hour gate). */
export function localHour(d: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d));
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * The **start** of local date "YYYY-MM-DD" `date` in `tz` (v2 §15.4 #34): the earliest instant whose local
 * date is ≥ `date`. This is usually literal local midnight, but not always — a zone whose clocks spring
 * forward across midnight (e.g. America/Santiago, 00:00 → 01:00) has no instant that reads as `date` at
 * 00:00, so the day's start is its first surviving instant instead (01:00 there); a zone that falls back
 * across midnight has two instants that read as `date`'s first hour, and this returns the earlier one.
 * Used to build a half-open UTC range for a local calendar day, so the range compares directly against
 * `created_at` and an index on it applies.
 *
 * Binary search, not offset arithmetic: every real UTC offset is within ±15h of UTC, and a DST shift is
 * always a whole number of minutes, so searching that window at 1-minute resolution using the existing
 * local-date formatter needs no zone-specific offset math and is exact by construction.
 */
export function localMidnight(date: string, tz: string): Date {
  const naive = Date.parse(`${date}T00:00:00Z`);
  let loMin = (naive - 15 * HOUR) / MIN; // local date here is always < `date`, for any real zone
  let hiMin = (naive + 15 * HOUR) / MIN; // local date here is always >= `date`
  while (hiMin - loMin > 1) {
    const midMin = loMin + Math.floor((hiMin - loMin) / 2);
    if (localDateString(new Date(midMin * MIN), tz) >= date) hiMin = midMin; else loMin = midMin;
  }
  return new Date(hiMin * MIN);
}
