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

/** "Mon, 05/01/2026, 09:00 (Europe/London)": local time with weekday, so the extractor can resolve "Friday". */
export function formatLocal(d: Date, tz: string | null): string {
  const zone = tz && isValidTimeZone(tz) ? tz : "UTC";
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return `${s} (${zone})`;
}
