/** Time labels: a model's reading of time words resolves to the day they meant. */
import { expect, test } from "vitest";
import {
  countFrom,
  renderResolved,
  resolveTime,
  type TimeMeaning,
} from "@/mind/platform/time-labels";

const MON = "2026-01-05"; // Monday 5 January 2026
const meaning = (m: Partial<TimeMeaning>): TimeMeaning => ({
  unit: "day",
  shift: 0,
  weekday: null,
  month: null,
  day_of_month: null,
  part: null,
  clock: null,
  span: "at",
  rough: false,
  ...m,
});
const date = (m: Partial<TimeMeaning>, base = MON) => resolveTime(meaning(m), base)?.date ?? null;
const read = (m: Partial<TimeMeaning>) => renderResolved(resolveTime(meaning(m), MON)!);

test("days count from the base day", () => {
  expect(date({ unit: "day", shift: 1 })).toBe("2026-01-06");
  expect(date({ unit: "day", shift: -1 })).toBe("2026-01-04");
  expect(date({ unit: "day", shift: -3, rough: true })).toBe("2026-01-02");
});

test("a weekday is the next or the last one, never the base day itself", () => {
  expect(date({ unit: "weekday", weekday: "tuesday", shift: 1 })).toBe("2026-01-06");
  expect(date({ unit: "weekday", weekday: "sunday", shift: 1 })).toBe("2026-01-11");
  expect(date({ unit: "weekday", weekday: "friday", shift: -1 })).toBe("2026-01-02");
  expect(date({ unit: "weekday", weekday: "sunday", shift: -2 })).toBe("2025-12-28");
  expect(date({ unit: "weekday", weekday: "monday", shift: 1 })).toBe("2026-01-12");
  expect(date({ unit: "weekday", weekday: "monday", shift: -1 })).toBe("2025-12-29");
  expect(date({ unit: "weekday", weekday: "friday", shift: 2 })).toBe("2026-01-16");
});

test("a day of the month is the next or the last one, in its month when one is given", () => {
  expect(date({ unit: "date", day_of_month: 3, shift: -1 })).toBe("2026-01-03");
  expect(date({ unit: "date", day_of_month: 8, shift: 1 })).toBe("2026-01-08");
  expect(date({ unit: "date", day_of_month: 5, shift: 1 })).toBe("2026-02-05");
  expect(date({ unit: "date", day_of_month: 31, shift: 1 }, "2026-01-31")).toBe("2026-03-31");
  expect(date({ unit: "date", month: 2, day_of_month: 14, shift: 1 })).toBe("2026-02-14");
  expect(date({ unit: "date", month: 12, day_of_month: 25, shift: -1 })).toBe("2025-12-25");
});

test("weeks start on Monday, weekends on Saturday, months on the 1st", () => {
  expect(date({ unit: "week", shift: 0 })).toBe("2026-01-05");
  expect(date({ unit: "week", shift: 0 }, "2026-01-11")).toBe("2026-01-05");
  expect(date({ unit: "week", shift: 1 })).toBe("2026-01-12");
  expect(date({ unit: "weekend", shift: 0 })).toBe("2026-01-10");
  expect(date({ unit: "weekend", shift: 0 }, "2026-01-10")).toBe("2026-01-10");
  expect(date({ unit: "weekend", shift: 0 }, "2026-01-11")).toBe("2026-01-10");
  expect(date({ unit: "weekend", shift: -1 })).toBe("2026-01-03");
  expect(date({ unit: "weekend", shift: 2 })).toBe("2026-01-24");
  expect(date({ unit: "month", shift: 0 })).toBe("2026-01-01");
  expect(date({ unit: "month", shift: -1 })).toBe("2025-12-01");
});

test("a meaning that doesn't hold together resolves to nothing", () => {
  expect(date({ unit: "weekday", weekday: null, shift: 1 })).toBeNull();
  expect(date({ unit: "weekday", weekday: "friday", shift: 0 })).toBeNull();
  expect(date({ unit: "date", day_of_month: null, shift: 1 })).toBeNull();
  expect(date({ unit: "date", day_of_month: 32, shift: 1 })).toBeNull();
  expect(date({ unit: "date", month: 2, day_of_month: 30, shift: 1 })).toBeNull();
  expect(date({ unit: "date", month: 13, day_of_month: 1, shift: 1 })).toBeNull();
  expect(date({ unit: "day", shift: 0, clock: "8pm" })).toBeNull();
  expect(date({ unit: "day", shift: 0, clock: "24:00" })).toBeNull();
});

test("a resolved time keeps its part of the day, clock, span and roughness, and reads out whole", () => {
  expect(resolveTime(meaning({ part: "night", clock: "20:00" }), MON)).toEqual({
    date: "2026-01-05",
    precision: "day",
    part: "night",
    clock: "20:00",
    span: "at",
    rough: false,
  });
  expect(read({ part: "night", clock: "20:00" })).toBe("Monday 5 January 2026, night, 20:00");
  expect(read({ unit: "weekday", weekday: "friday", shift: -1, span: "since" })).toBe(
    "since Friday 2 January 2026",
  );
  expect(read({ unit: "day", shift: -3, rough: true })).toBe("around Friday 2 January 2026");
  expect(read({ unit: "month", shift: 0, part: "end" })).toBe("the end of January 2026");
  expect(read({ unit: "weekend", shift: 2 })).toBe("the weekend of Saturday 24 January 2026");
  expect(read({ unit: "week", shift: 1 })).toBe("the week of Monday 12 January 2026");
});

test("counting from a week, weekend or month starts inside it, or at its end when the end was said", () => {
  const span = (m: Partial<TimeMeaning>, base: string) => resolveTime(meaning(m), base)!;
  const nextWeek = span({ unit: "week", shift: 1 }, "2026-10-21"); // the week of Monday 26 October
  expect(
    resolveTime(
      meaning({ unit: "weekday", weekday: "monday", shift: 1 }),
      countFrom(nextWeek, "weekday"),
    )?.date,
  ).toBe("2026-10-26");
  const nextMonth = span({ unit: "month", shift: 1 }, "2026-10-21");
  expect(
    resolveTime(meaning({ unit: "date", day_of_month: 1, shift: 1 }), countFrom(nextMonth, "date"))
      ?.date,
  ).toBe("2026-11-01");
  const weekend = span({ unit: "weekend", shift: 0 }, "2026-10-21"); // Saturday 24 October
  expect(
    resolveTime(
      meaning({ unit: "weekday", weekday: "saturday", shift: 1 }),
      countFrom(weekend, "weekday"),
    )?.date,
  ).toBe("2026-10-24");
  const monthEnd = span({ unit: "month", shift: 0, part: "end" }, "2026-01-05");
  expect(resolveTime(meaning({ unit: "day", shift: 1 }), countFrom(monthEnd, "day"))?.date).toBe(
    "2026-02-01",
  );
  const day = span({ unit: "day", shift: 1 }, "2026-01-05");
  expect(countFrom(day, "weekday")).toBe("2026-01-06");
});
