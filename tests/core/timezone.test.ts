import { expect, test } from "vitest";
import { formatLocal, isValidTimeZone } from "@/core/timezone";

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
