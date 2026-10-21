import { expect, test } from "vitest";
import {
  formatLocal,
  isValidTimeZone,
  localDateString,
  localHour,
  localMidnight,
  nextLocalDate,
  previousLocalDate,
  shiftLocalDate,
  zoneOffsetMinutes,
  zoneOrUtc,
} from "@/mind/platform/timezone";

test("zoneOrUtc falls back to UTC for a missing or unknown zone", () => {
  expect(zoneOrUtc("Asia/Singapore")).toBe("Asia/Singapore");
  expect(zoneOrUtc(null)).toBe("UTC");
  expect(zoneOrUtc(undefined)).toBe("UTC");
  expect(zoneOrUtc("Mars/Olympus")).toBe("UTC");
});

test("validates IANA names", () => {
  expect(isValidTimeZone("Europe/London")).toBe(true);
  expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  expect(isValidTimeZone("")).toBe(false);
  expect(isValidTimeZone("x".repeat(80))).toBe(false);
});

test("formats in the user's zone with weekday; invalid timezone falls back to UTC", () => {
  const d = new Date("2026-01-05T09:00:00Z"); // a Monday
  expect(formatLocal(d, "America/New_York")).toMatch(/Mon.*04:00.*America\/New_York/);
  expect(formatLocal(d, "Mars/Olympus")).toMatch(/Mon.*09:00.*UTC/);
  expect(formatLocal(d, null)).toMatch(/UTC/);
});

test("uses an unambiguous ISO date (dd/mm vs mm/dd misreads turned 5 Jan into 5 May)", () => {
  expect(formatLocal(new Date("2026-01-05T09:00:00Z"), "Europe/London")).toBe(
    "Mon 2026-01-05 09:00 (Europe/London)",
  );
  expect(formatLocal(new Date("2026-01-05T02:30:00Z"), "America/New_York")).toBe(
    "Sun 2026-01-04 21:30 (America/New_York)",
  );
});

test("localDateString / previousLocalDate", () => {
  expect(localDateString(new Date("2026-01-05T23:30:00Z"), "UTC")).toBe("2026-01-05");
  expect(localDateString(new Date("2026-01-05T23:30:00Z"), "Asia/Tokyo")).toBe("2026-01-06");
  expect(previousLocalDate("2026-03-01")).toBe("2026-02-28");
});

test("nextLocalDate", () => {
  expect(nextLocalDate("2026-02-28")).toBe("2026-03-01");
  expect(nextLocalDate("2026-12-31")).toBe("2027-01-01");
});

test("localHour reads the local wall-clock hour", () => {
  expect(localHour(new Date("2026-01-05T09:00:00Z"), "UTC")).toBe(9);
  expect(localHour(new Date("2026-01-05T09:00:00Z"), "America/New_York")).toBe(4); // EST, UTC-5
  expect(localHour(new Date("2026-01-05T02:30:00Z"), "Asia/Tokyo")).toBe(11); // UTC+9
});

test("localMidnight finds the start of the local date, including where literal midnight doesn't exist", () => {
  // Plain UTC: local midnight is just midnight.
  expect(localMidnight("2026-01-05", "UTC").toISOString()).toBe("2026-01-05T00:00:00.000Z");
  // EST (UTC-5) outside DST: local midnight is 05:00 UTC.
  expect(localMidnight("2026-01-05", "America/New_York").toISOString()).toBe(
    "2026-01-05T05:00:00.000Z",
  );
  // Spring forward (2026-03-08, America/New_York): still EST (UTC-5) at local midnight, the change is later that day.
  expect(localMidnight("2026-03-08", "America/New_York").toISOString()).toBe(
    "2026-03-08T05:00:00.000Z",
  );
  // The day after spring-forward is EDT (UTC-4).
  expect(localMidnight("2026-03-09", "America/New_York").toISOString()).toBe(
    "2026-03-09T04:00:00.000Z",
  );
  // Fall back (2026-11-01, America/New_York): still EDT (UTC-4) at local midnight, the change is later that day.
  expect(localMidnight("2026-11-01", "America/New_York").toISOString()).toBe(
    "2026-11-01T04:00:00.000Z",
  );
  // The day after fall-back is EST (UTC-5) again.
  expect(localMidnight("2026-11-02", "America/New_York").toISOString()).toBe(
    "2026-11-02T05:00:00.000Z",
  );
  // A half-open day range built from consecutive local midnights is exactly 24h except across a DST change.
  const d1 = localMidnight("2026-03-08", "America/New_York");
  const d2 = localMidnight("2026-03-09", "America/New_York");
  expect(d2.getTime() - d1.getTime()).toBe(23 * 3_600_000); // the DST-shortened day

  // America/Santiago springs forward across midnight itself (2024-09-08 00:00 -> 01:00): 2024-09-08T00:00
  // local never happens, so the date's start is its first surviving instant, 01:00 (-03:00) = 04:00Z.
  expect(localMidnight("2024-09-08", "America/Santiago").toISOString()).toBe(
    "2024-09-08T04:00:00.000Z",
  );
  expect(localDateString(localMidnight("2024-09-08", "America/Santiago"), "America/Santiago")).toBe(
    "2024-09-08",
  );

  // Asia/Kolkata: a static half-hour offset (UTC+5:30, no DST).
  expect(localMidnight("2026-01-05", "Asia/Kolkata").toISOString()).toBe(
    "2026-01-04T18:30:00.000Z",
  );

  // Pacific/Kiritimati: the most-ahead real zone (UTC+14, no DST).
  expect(localMidnight("2026-01-05", "Pacific/Kiritimati").toISOString()).toBe(
    "2026-01-04T10:00:00.000Z",
  );
});

test("shiftLocalDate moves across month and year ends", () => {
  expect(shiftLocalDate("2026-01-05", -7)).toBe("2025-12-29");
  expect(shiftLocalDate("2026-02-28", 1)).toBe("2026-03-01");
});

test("zoneOffsetMinutes: minutes ahead of UTC at that instant", () => {
  expect(zoneOffsetMinutes(new Date("2026-01-05T09:00:00Z"), "Asia/Singapore")).toBe(480);
  expect(zoneOffsetMinutes(new Date("2026-01-05T09:00:00Z"), "America/New_York")).toBe(-300);
  expect(zoneOffsetMinutes(new Date("2026-07-05T09:00:00Z"), "Europe/London")).toBe(60);
});
