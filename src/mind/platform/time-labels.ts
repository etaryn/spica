/**
 * Time labels: what time words mean, in a fixed structure a model fills and code resolves. The
 * model says which day the words point at ("the next Friday", "three days back"); code counts it
 * from the day they were said. No model works out a date, and no code reads the words.
 */
import { z } from "zod";
import { formatToken, tokenDates } from "./time-anchors";
import { shiftLocalDate } from "./timezone";

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/** What time words mean, counted from a base day: the day they were said, or another time's. */
export const TimeMeaningSchema = z.object({
  unit: z.enum(["day", "weekday", "date", "week", "weekend", "month"]),
  shift: z.number().int(),
  weekday: z.enum(WEEKDAYS).nullable(),
  month: z.number().int().nullable(),
  day_of_month: z.number().int().nullable(),
  part: z.enum(["morning", "afternoon", "evening", "night", "start", "end"]).nullable(),
  clock: z.string().nullable(),
  span: z.enum(["at", "since", "until"]),
  rough: z.boolean(),
});
export type TimeMeaning = z.infer<typeof TimeMeaningSchema>;

export type ResolvedTime = {
  /** "YYYY-MM-DD": the day itself, or the first day of its week, weekend or month. */
  date: string;
  precision: "day" | "week" | "weekend" | "month";
  part: TimeMeaning["part"];
  clock: string | null;
  span: TimeMeaning["span"];
  rough: boolean;
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
// A date search gives up after this many months (or years) without finding the day, so an
// impossible one ("the 30th of February") comes back null instead of looping.
const MAX_STEPS = 48;
const PRECISION: Record<TimeMeaning["unit"], ResolvedTime["precision"]> = {
  day: "day",
  weekday: "day",
  date: "day",
  week: "week",
  weekend: "weekend",
  month: "month",
};
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The day `meaning` points at from `base` ("YYYY-MM-DD"); null when it doesn't hold together. */
export function resolveTime(meaning: TimeMeaning, base: string): ResolvedTime | null {
  if (meaning.clock !== null && !CLOCK.test(meaning.clock)) return null;
  const date = resolveDate(meaning, base);
  if (date === null) return null;
  return {
    date,
    precision: PRECISION[meaning.unit],
    part: meaning.part,
    clock: meaning.clock,
    span: meaning.span,
    rough: meaning.rough,
  };
}

/**
 * The day words counting from another time count from. A day counts from itself. From a week,
 * weekend or month, a weekday or a date is the first one inside it ("monday" of next week), a
 * number of days runs from its start, and either runs from its last day when its end was said.
 */
export function countFrom(base: ResolvedTime, unit: TimeMeaning["unit"]): string {
  if (base.precision === "day") return base.date;
  if (base.part === "end") {
    if (base.precision === "month") return shiftLocalDate(firstOfMonth(base.date, 1), -1);
    return shiftLocalDate(base.date, base.precision === "week" ? 6 : 1);
  }
  // Weekdays and dates count strictly after their base, so start the day before the span.
  return unit === "weekday" || unit === "date" ? shiftLocalDate(base.date, -1) : base.date;
}

/** A resolved time written out for a reader: "Friday 9 January 2026", "since around …". */
export function renderResolved(t: ResolvedTime): string {
  const [year, month, day] = t.date.split("-").map(Number) as [number, number, number];
  const named = `${DAY_NAMES[weekdayOf(t.date)]} ${day} ${MONTH_NAMES[month - 1]} ${year}`;
  const stretch =
    t.precision === "day"
      ? named
      : t.precision === "week"
        ? `the week of ${named}`
        : t.precision === "weekend"
          ? `the weekend of ${named}`
          : `${MONTH_NAMES[month - 1]} ${year}`;
  const edge = t.part === "start" || t.part === "end";
  const parts = [edge ? `the ${t.part} of ${stretch}` : stretch];
  if (t.part && !edge) parts.push(t.part);
  if (t.clock) parts.push(t.clock);
  const when = (t.rough ? "around " : "") + parts.join(", ");
  return t.span === "at" ? when : `${t.span} ${when}`;
}

/**
 * A resolved time as a date token, so it reads with its distance on whatever day a prompt is
 * sent. Its edges ("around", "until", "the end of") sit outside the token; with `said`, the
 * words stay and the date is glossed beside them.
 */
export function labelToken(t: ResolvedTime, zone: string, said?: string): string {
  const day = t.part && t.part !== "start" && t.part !== "end" ? t.part : "day";
  const precision =
    t.span === "since" ? "since" : t.precision !== "day" ? t.precision : t.clock ? "time" : day;
  const local =
    precision === "month"
      ? t.date.slice(0, 7)
      : precision === "time"
        ? `${t.date}T${t.clock}`
        : t.date;
  const token = formatToken(local, precision, zone, said);
  if (said) return token;
  const edge = t.part === "start" || t.part === "end" ? `the ${t.part} of ` : "";
  return `${t.rough ? "around " : ""}${t.span === "until" ? "until " : ""}${edge}${token}`;
}

/** The moment a resolved time points at, as the renderer reads its token. */
export function labelInstant(t: ResolvedTime, zone: string): Date {
  return tokenDates(labelToken(t, zone))[0]!;
}

function resolveDate(m: TimeMeaning, base: string): string | null {
  switch (m.unit) {
    case "day":
      return shiftLocalDate(base, m.shift);
    case "weekday":
      return nthWeekday(base, m.weekday, m.shift);
    case "date":
      return nthDate(base, m.month, m.day_of_month, m.shift);
    case "week":
      return shiftLocalDate(base, -((weekdayOf(base) + 6) % 7) + 7 * m.shift);
    case "weekend":
      return shiftLocalDate(base, toSaturday(weekdayOf(base)) + 7 * m.shift);
    case "month":
      return firstOfMonth(base, m.shift);
  }
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Days from a weekday to the Saturday of the weekend under way or next to come. */
function toSaturday(weekday: number): number {
  return weekday === 0 ? -1 : 6 - weekday;
}

/** 1 is the first such weekday after `base`, -1 the last before it, 2 the one after next. */
function nthWeekday(base: string, weekday: TimeMeaning["weekday"], shift: number): string | null {
  if (weekday === null || shift === 0) return null;
  const target = WEEKDAYS.indexOf(weekday);
  const from = weekdayOf(base);
  if (shift > 0) return shiftLocalDate(base, ((target - from + 7) % 7 || 7) + 7 * (shift - 1));
  return shiftLocalDate(base, -((from - target + 7) % 7 || 7) + 7 * (shift + 1));
}

/**
 * The |shift|-th date with that day of the month after `base` (before it when shift is negative),
 * in that month when one is given.
 */
function nthDate(
  base: string,
  month: number | null,
  day: number | null,
  shift: number,
): string | null {
  if (day === null || day < 1 || day > 31 || shift === 0) return null;
  if (month !== null && (month < 1 || month > 12)) return null;
  const [year, baseMonth] = base.split("-").map(Number) as [number, number];
  const step = Math.sign(shift);
  let found = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    const candidate =
      month === null
        ? isoDate(year, baseMonth + i * step, day)
        : isoDate(year + i * step, month, day);
    if (candidate === null || (step > 0 ? candidate <= base : candidate >= base)) continue;
    found += 1;
    if (found === Math.abs(shift)) return candidate;
  }
  return null;
}

/** "YYYY-MM-DD" for a month that may run past December or before January; null if it lacks the day. */
function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCDate() === day ? d.toISOString().slice(0, 10) : null;
}

function firstOfMonth(base: string, shift: number): string {
  const [year, month] = base.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 + shift, 1)).toISOString().slice(0, 10);
}
