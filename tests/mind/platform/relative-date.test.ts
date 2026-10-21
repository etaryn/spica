/** Relative dates count whole days in her zone, and dayInWords pairs the date with that count. */
import { expect, test } from "vitest";
import {
  dayInWords,
  itemWhen,
  noteRelativeWords,
  relativeDate,
  relativeWords,
  stamped,
  writtenOn,
} from "@/mind/platform/relative-date";

test("day counts cross midnight by the calendar, not by 24 hours", () => {
  const now = new Date("2026-01-12T00:10:00Z");
  expect(relativeDate(new Date("2026-01-11T23:30:00Z"), now, "UTC")).toBe("yesterday");
  expect(relativeDate(new Date("2026-01-12T23:50:00Z"), now, "UTC")).toBe("today");
});

test("day counts hold across a DST change", () => {
  // Clocks went forward in London on 29 March 2026: the 28th is still two calendar days back.
  const now = new Date("2026-03-30T00:30:00Z");
  expect(relativeDate(new Date("2026-03-28T12:00:00Z"), now, "Europe/London")).toBe(
    "2 days ago",
  );
});

test("writtenOn and stamped date a note by the day it was written", () => {
  const now = new Date("2026-01-15T10:00:00Z");
  const at = new Date("2026-01-13T20:00:00Z");
  expect(writtenOn(at, now, "UTC")).toBe("written Tuesday 13 January, 2 days ago");
  expect(stamped("Lately: a lot of tides.", at, now, "UTC")).toBe(
    "(written Tuesday 13 January, 2 days ago)\nLately: a lot of tides.",
  );
});

test("itemWhen shows when it was noted only when that was another day", () => {
  const now = new Date("2026-01-15T10:00:00Z");
  const sat = new Date("2026-01-17T09:00:00Z");
  expect(itemWhen(sat, new Date("2026-01-15T08:00:00Z"), now, "UTC")).toBe(
    "Saturday 17 January, in 2 days; noted Thursday 15 January, today",
  );
  expect(itemWhen(sat, new Date("2026-01-17T07:00:00Z"), now, "UTC")).toBe(
    "Saturday 17 January, in 2 days",
  );
  expect(itemWhen(sat, null, now, "UTC")).toBe("Saturday 17 January, in 2 days");
});

test("relativeWords finds the words that go stale once read on another day", () => {
  expect(relativeWords("Sister visits tomorrow (the 17th), coming Today.")).toEqual([
    "tomorrow",
    "today",
  ]);
  expect(relativeWords("clear skies tonight; ran this morning; done this week")).toEqual([
    "tonight",
    "this morning",
    "this week",
  ]);
  expect(relativeWords("yesterday's race and last night")).toEqual(["yesterday", "last night"]);
  expect(relativeWords("The interview on Thursday 8 January went well.")).toEqual([]);
  // Words inside other words don't count.
  expect(relativeWords("todays-ish, tomorrowland")).toEqual([]);
});

test("noteRelativeWords logs a slip with its writer and returns the words", () => {
  const logs: { msg: string; meta?: Record<string, unknown> }[] = [];
  const log = {
    info: (msg: string, meta?: Record<string, unknown>) => logs.push({ msg, meta }),
    error: () => {},
  };
  expect(noteRelativeWords(log, "user_ideate", ["Ask how tonight goes.", null])).toEqual([
    "tonight",
  ]);
  expect(logs).toEqual([
    {
      msg: "relative words in stored text",
      meta: { writer: "user_ideate", words: ["tonight"] },
    },
  ]);
  expect(noteRelativeWords(log, "user_ideate", ["Ask about Friday 9 January."])).toEqual([]);
  expect(logs).toHaveLength(1);
});

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
