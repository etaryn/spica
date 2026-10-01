/**
 * Her own clock. Spica lives in one time zone, the same for every user, and her day plan, local
 * date and local hour are all read through it. Today the zone is fixed; when she starts moving
 * between zones, only `lifeTimezone` changes.
 */
import type { LifeConfig } from "@/mind/platform/config";
import { localDateString, localHour, localMidnight, nextLocalDate } from "@/mind/platform/timezone";

const MINUTE = 60_000;
const MINUTES_IN_DAY = 1440;

/** Her time zone at `at`. */
export function lifeTimezone(settings: LifeConfig, _at: Date): string {
  return settings.timezone;
}

/** Her local date at `at`, "YYYY-MM-DD". */
export function lifeDate(settings: LifeConfig, at: Date): string {
  return localDateString(at, lifeTimezone(settings, at));
}

/** Her local hour (0–23) at `at`. */
export function lifeHour(settings: LifeConfig, at: Date): number {
  return localHour(at, lifeTimezone(settings, at));
}

/** Minutes since midnight for "HH:MM"; "24:00" is the end of the day. */
export function minutesOf(hhmm: string): number {
  if (hhmm === "24:00") return MINUTES_IN_DAY;
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/**
 * The instant of "HH:MM" on her local `date` ("24:00" is the next local midnight). It is an offset
 * from the day's start, so it's exact except on a DST-change day in her zone (Asia/Singapore has
 * none).
 */
export function lifeInstant(settings: LifeConfig, date: string, hhmm: string): Date {
  const zone = lifeTimezone(settings, localMidnight(date, settings.timezone));
  if (hhmm === "24:00") return localMidnight(nextLocalDate(date), zone);

  const dayStart = localMidnight(date, zone);
  return new Date(dayStart.getTime() + minutesOf(hhmm) * MINUTE);
}

/** "Monday", "Tuesday", … for a "YYYY-MM-DD" date. */
export function weekday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}
