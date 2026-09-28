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

/** `tz`'s UTC offset (minutes, local = UTC + offset) at instant `t` (ms). */
function offsetMinutesAt(t: number, tz: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return (asUtc - t) / 60_000;
}

/**
 * The UTC instant of local midnight on "YYYY-MM-DD" `date` in `tz`, DST-correct (v2 §15.4 #34): used to
 * build a half-open UTC range for a local calendar day, so the range compares directly against
 * `created_at` and an index on it applies. Two-step fixed-point refinement (the offset can only take the
 * zone's small set of values, so it converges in at most two passes, including across a DST change).
 */
export function localMidnight(date: string, tz: string): Date {
  const naive = Date.parse(`${date}T00:00:00Z`);
  let t = naive;
  for (let i = 0; i < 2; i++) t = naive - offsetMinutesAt(t, tz) * 60_000;
  return new Date(t);
}
