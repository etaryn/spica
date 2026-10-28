/** Date tokens: a stored date reads right on any later day, on its own calendar. */
import { expect, test } from "vitest";
import {
  dateToken,
  formatToken,
  nowLine,
  ownDate,
  renderAbsolute,
  renderTimes,
  stamped,
  tokenDates,
} from "@/mind/platform/time-anchors";

const MON = new Date("2026-01-12T09:00:00Z"); // Monday 12 January 2026
const at = (iso: string) => new Date(iso);
const read = (text: string, now: Date) => renderTimes(text, now, 6);

test("a day reads relative to the reader's now, and its kept words when they still hold", () => {
  const stored = `how'd the race go ${formatToken("2026-01-11", "day", "UTC", "yesterday")}—legs hold up?`;
  expect(read(stored, MON)).toBe("how'd the race go yesterday—legs hold up?");
  expect(read(stored, at("2026-01-13T09:00:00Z"))).toBe(
    "how'd the race go yesterday (that's 2 days ago, Sunday 11 January)—legs hold up?",
  );
  const night = `Telescope booking confirmed for ${formatToken("2026-01-12", "night", "UTC")}.`;
  expect(read(night, MON)).toBe("Telescope booking confirmed for tonight.");
  expect(read(night, at("2026-01-13T09:00:00Z"))).toBe(
    "Telescope booking confirmed for last night, Monday 12 January.",
  );
});

test("day counts follow the calendar across midnight and a DST change", () => {
  const late = dateToken(at("2026-01-11T23:30:00Z"), "UTC");
  expect(read(late, at("2026-01-12T00:10:00Z"))).toBe("yesterday, Sunday 11 January");
  const london = dateToken(at("2026-03-28T12:00:00Z"), "Europe/London");
  expect(read(london, at("2026-03-30T00:30:00Z"))).toBe("2 days ago, Saturday 28 March");
});

test("weeks, weekends, months and since read as spans", () => {
  expect(read(formatToken("2026-01-12", "week", "UTC"), MON)).toBe("this week");
  expect(read(formatToken("2026-01-17", "weekend", "UTC"), MON)).toBe(
    "this weekend, Saturday 17 January",
  );
  expect(read(formatToken("2026-10", "month", "UTC"), MON)).toBe("October 2026");
  expect(read(`waiting ${formatToken("2026-01-07", "since", "UTC", "five days now")}`, MON)).toBe(
    "waiting five days now (since Wednesday 7 January, 5 days ago)",
  );
});

test("a date read in another year names its year", () => {
  const stored = `The party is ${formatToken("2026-12-30", "day", "UTC")}.`;
  expect(read(stored, at("2027-01-20T09:00:00Z"))).toBe("The party is Wednesday 30 December 2026.");
});

test("each token reads on its own calendar", () => {
  const her = `Clear skies ${formatToken("2026-01-12", "night", "Asia/Singapore")}.`;
  expect(read(her, at("2026-01-12T17:00:00Z"))).toBe("Clear skies last night, Monday 12 January.");
});

test("dates code holds become tokens: a memory's date shows once; written stamps", () => {
  expect(read(dateToken(at("2026-01-11T08:00:00Z"), "UTC"), MON)).toBe(
    "yesterday, Sunday 11 January",
  );
  expect(read(dateToken(at("2026-01-15T19:00:00Z"), "UTC", "time"), MON)).toBe(
    "in 3 days, Thursday 15 January at 19:00",
  );
  const friday = at("2026-01-09T08:00:00Z");
  expect(ownDate("Sam is stressed.", friday, "UTC")).toBe(dateToken(friday, "UTC"));
  expect(ownDate(`The race is ${dateToken(MON, "UTC")}.`, MON, "UTC")).toBeNull();
  expect(ownDate("Sam is stressed.", null, "UTC")).toBeNull();
  expect(read(stamped("Lately: tides.", at("2026-01-10T20:00:00Z"), "UTC"), MON)).toBe(
    "(written 2 days ago, Saturday 10 January)\nLately: tides.",
  );
});

test("now on both calendars", () => {
  const t = at("2026-01-13T21:40:00Z");
  expect(nowLine(t, "UTC", "UTC")).toBe("It's Tuesday 13 January, 21:40.");
  expect(nowLine(t, "Europe/London", "Asia/Singapore")).toBe(
    "It's Tuesday 13 January, 21:40 where they are; Wednesday 14 January, 05:40 for you.",
  );
  expect(nowLine(t, "Europe/London", "Asia/Singapore", "where Spica is")).toContain(
    "05:40 where Spica is",
  );
});

test("absolute rendering and token dates", () => {
  const s = `the race ${formatToken("2026-01-13", "day", "UTC")}`;
  expect(renderAbsolute(s)).toBe("the race Tuesday 13 January 2026");
  expect(tokenDates(s)[0]!.toISOString()).toBe("2026-01-13T12:00:00.000Z");
});
