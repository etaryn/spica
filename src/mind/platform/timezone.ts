/**
 * Time-zone arithmetic for users' zones and hers: local dates, local hours, the start of a local
 * day, and a readable local timestamp. Everything goes through Intl, so there is no zone-specific
 * offset maths.
 */

const MAX_ZONE_NAME_LENGTH = 64;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Every real UTC offset lies within this distance of UTC. */
const MAX_UTC_OFFSET = 15 * HOUR;

/** True for a real IANA zone name (Intl throws RangeError for unknown zones). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > MAX_ZONE_NAME_LENGTH) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * "Mon 2026-01-05 09:00 (Europe/London)": local time with the weekday, so the extractor can
 * resolve "Friday". ISO date order on purpose: the model misread "05/01/2026" as 5 May.
 */
export function formatLocal(at: Date, tz: string | null): string {
  const zone = tz && isValidTimeZone(tz) ? tz : "UTC";

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(at).map((p) => [p.type, p.value]));

  return `${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${zone})`;
}

/** The calendar date of `at` in `tz`, as "YYYY-MM-DD" (en-CA formats in ISO order). */
export function localDateString(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** The day before a "YYYY-MM-DD" date (calendar arithmetic, no time zone). */
export function previousLocalDate(date: string): string {
  return shiftLocalDate(date, -1);
}

/** The day after a "YYYY-MM-DD" date (calendar arithmetic, no time zone). */
export function nextLocalDate(date: string): string {
  return shiftLocalDate(date, 1);
}

/** A "YYYY-MM-DD" date moved by `days` (calendar arithmetic, no time zone). */
export function shiftLocalDate(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** The local hour of day (0–23) of `at` in `tz`. */
export function localHour(at: Date, tz: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hourCycle: "h23",
  });
  return Number(formatter.format(at));
}

/**
 * The start of local date `date` in `tz`: the earliest instant whose local date is on or after
 * `date`. Usually that is local midnight, but not always:
 * - where clocks spring forward across midnight (America/Santiago, 00:00 → 01:00) no instant reads
 *   00:00, so the day starts at its first surviving instant (01:00 there);
 * - where clocks fall back across midnight two instants read as the first hour, and this returns
 *   the earlier one.
 * It builds a half-open UTC range for a local day, so the range compares directly against
 * `created_at` and an index on it applies.
 *
 * Found by binary search at one-minute resolution, not offset arithmetic. Offsets stay within
 * ±15h and DST shifts are whole minutes, so the search is exact by construction.
 */
export function localMidnight(date: string, tz: string): Date {
  const naive = Date.parse(`${date}T00:00:00Z`);
  // The local date at `low` is always before `date`, and at `high` always on or after it.
  let lowMinute = (naive - MAX_UTC_OFFSET) / MINUTE;
  let highMinute = (naive + MAX_UTC_OFFSET) / MINUTE;

  while (highMinute - lowMinute > 1) {
    const midMinute = lowMinute + Math.floor((highMinute - lowMinute) / 2);
    const midDate = localDateString(new Date(midMinute * MINUTE), tz);
    if (midDate >= date) highMinute = midMinute;
    else lowMinute = midMinute;
  }

  return new Date(highMinute * MINUTE);
}

/** Minutes the zone is ahead of UTC at that instant (480 for Singapore, -300 for New York in winter). */
export function zoneOffsetMinutes(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((local - at.getTime()) / 60_000);
}
