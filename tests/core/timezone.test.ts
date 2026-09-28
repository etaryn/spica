import { expect, test } from "vitest";
import { formatLocal, isValidTimeZone, localDateString, previousLocalDate } from "@/core/timezone";

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
  expect(formatLocal(new Date("2026-01-05T09:00:00Z"), "Europe/London")).toBe("Mon 2026-01-05 09:00 (Europe/London)");
  expect(formatLocal(new Date("2026-01-05T02:30:00Z"), "America/New_York")).toBe("Sun 2026-01-04 21:30 (America/New_York)");
});

test("localDateString / previousLocalDate", () => {
  expect(localDateString(new Date("2026-01-05T23:30:00Z"), "UTC")).toBe("2026-01-05");
  expect(localDateString(new Date("2026-01-05T23:30:00Z"), "Asia/Tokyo")).toBe("2026-01-06");
  expect(previousLocalDate("2026-03-01")).toBe("2026-02-28");
});
