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
