import type { LifeConfig } from "../config";
import { localDateString, localHour, localMidnight, nextLocalDate } from "../timezone";

const MIN = 60_000;

/**
 * Spica's own time zone at `at`. Fixed for the test phase; when she starts floating between
 * zones, only this function changes.
 */
export function lifeTimezone(cfg: LifeConfig, _at: Date): string {
  return cfg.timezone;
}

export const lifeDate = (cfg: LifeConfig, at: Date): string =>
  localDateString(at, lifeTimezone(cfg, at));
export const lifeHour = (cfg: LifeConfig, at: Date): number => localHour(at, lifeTimezone(cfg, at));

export function minutesOf(hhmm: string): number {
  if (hhmm === "24:00") return 1440;
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/**
 * The instant of "HH:MM" on her local `date` ("24:00" = the next local midnight). An offset from the day's
 * start, so exact except on a DST-change day in her zone (Asia/Singapore has none).
 */
export function lifeInstant(cfg: LifeConfig, date: string, hhmm: string): Date {
  const tz = lifeTimezone(cfg, localMidnight(date, cfg.timezone));
  if (hhmm === "24:00") return localMidnight(nextLocalDate(date), tz);
  return new Date(localMidnight(date, tz).getTime() + minutesOf(hhmm) * MIN);
}

export function weekday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}
