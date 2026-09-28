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
