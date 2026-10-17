/** Relative dates count whole days in her zone, and dayInWords pairs the date with that count. */
import { expect, test } from "vitest";
import { dayInWords, relativeDate } from "@/mind/platform/relative-date";

test("days are counted in her zone, not UTC", () => {
  // 23:30 UTC on the 10th is the 11th in Singapore; "now" is 09:00 on the 12th there.
  const when = new Date("2026-01-10T23:30:00Z");
  const now = new Date("2026-01-12T01:00:00Z");
  expect(relativeDate(when, now, "Asia/Singapore")).toBe("yesterday");
  expect(relativeDate(when, now, "UTC")).toBe("2 days ago");
});

test("dayInWords names the weekday and date with the relative day", () => {
  const when = new Date("2026-01-11T09:00:00Z");
  const now = new Date("2026-01-12T10:00:00Z");
  expect(dayInWords(when, now, "UTC")).toBe("Sunday 11 January, yesterday");
  expect(dayInWords(new Date("2026-01-14T09:00:00Z"), now, "UTC")).toBe(
    "Wednesday 14 January, in 2 days",
  );
});
