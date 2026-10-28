/**
 * Dates, one way. A date is stored as a token holding the day, its precision and the zone it was
 * meant in, made by code from a date it holds or from a time label a model filled in. A token is
 * rendered only when a prompt reaches a model, on its own calendar relative to that moment's now
 * ("yesterday, Sunday 11 January"). Only stored text and prompts carry tokens: her messages are
 * never touched.
 */
import { localDateString, localMidnight, localTime, shiftLocalDate } from "./timezone";

export type Precision =
  | "day"
  | "morning"
  | "afternoon"
  | "evening"
  | "night"
  | "time"
  | "weekend"
  | "week"
  | "month"
  | "since";

type Anchor = { local: string; precision: Precision; zone: string };

const TOKEN = /⟦([^|⟧]+)\|([^|⟧]+)\|([^|⟧]+)(?:\|([^⟧]*))?⟧/g;
const ONE_TOKEN = /^⟦[^⟧]+⟧$/;
const DAY_MS = 86_400_000;
const PART_HOUR: Record<string, number> = { morning: 9, afternoon: 15, evening: 19, night: 22 };

// ---------- Making tokens ----------

/** The token for a date code already holds, on `zone`'s calendar. */
export function dateToken(at: Date, zone: string, precision: "day" | "time" = "day"): string {
  const day = localDateString(at, zone);
  return precision === "time"
    ? `⟦${day}T${localTime(at, zone)}|time|${zone}⟧`
    : `⟦${day}|day|${zone}⟧`;
}

/** A memory's date, shown once: nothing when its words already carry one. */
export function ownDate(content: string, when: Date | null, zone: string): string | null {
  return when && !content.includes("⟦") ? dateToken(when, zone) : null;
}

/** When a note about the present was written: what it calls today was that day's. */
export function written(at: Date, zone: string): string {
  return `written ${dateToken(at, zone)}`;
}

/** A note about the present, headed by the day it was written. */
export function stamped(text: string, at: Date, zone: string): string {
  return `(${written(at, zone)})\n${text}`;
}

// ---------- Reading tokens ----------

/** Each token in words relative to `now`, on its own calendar. Only the provider wrapper calls it. */
export function renderTimes(text: string, now: Date, maxDays: number): string {
  return text.replace(
    TOKEN,
    (_m, local: string, precision: Precision, zone: string, said?: string) => {
      const phrase = render({ local, precision, zone }, now, maxDays);
      if (!said) return phrase;
      // Words that still mean what they say need no gloss ("tomorrow", said today).
      if (phrase.toLowerCase().startsWith(said.toLowerCase())) return said;
      return precision === "since" ? `${said} (since ${phrase})` : `${said} (that's ${phrase})`;
    },
  );
}

/** Each token as a plain date with its year, for readers with no "now" (the review). */
export function renderAbsolute(text: string): string {
  return text.replace(
    TOKEN,
    (_m, local: string, precision: Precision, _zone: string, said?: string) => {
      const abs = absolute(local, precision);
      return said ? `${said} (${abs})` : abs;
    },
  );
}

/** The instants the tokens in `text` point at. */
export function tokenDates(text: string): Date[] {
  return [...text.matchAll(TOKEN)].map((m) =>
    instant({ local: m[1]!, precision: m[2] as Precision, zone: m[3]! }),
  );
}

export function isSingleToken(text: string): boolean {
  return ONE_TOKEN.test(text.trim());
}

/** "It's Tuesday 13 January, 21:40 where they are; …for you.": now on both calendars. */
export function nowLine(now: Date, theirs: string, hers: string, herLabel = "for you"): string {
  const at = (tz: string) =>
    `${new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
    })
      .format(now)
      .replace(",", "")}, ${localTime(now, tz)}`;
  return at(theirs) === at(hers)
    ? `It's ${at(theirs)}.`
    : `It's ${at(theirs)} where they are; ${at(hers)} ${herLabel}.`;
}

// ---------- Internals ----------

function instant(a: Anchor): Date {
  const [date, time] = a.local.split("T");
  // A week points at its Friday: an idea about "this week" shouldn't expire the night it's said.
  const day =
    a.precision === "month"
      ? `${a.local}-01`
      : a.precision === "week"
        ? shiftLocalDate(date!, 4)
        : date!;
  const midnight = localMidnight(day, a.zone).getTime();
  if (time) {
    const [h, m] = time.split(":").map(Number);
    return new Date(midnight + (h! * 60 + m!) * 60_000);
  }
  return new Date(midnight + (PART_HOUR[a.precision] ?? 12) * 3_600_000);
}

/** A token in the one format every renderer reads. `said` keeps the words and glosses them. */
export function formatToken(
  local: string,
  precision: Precision,
  zone: string,
  said?: string,
): string {
  return `⟦${local}|${precision}|${zone}${said ? `|${said.replace(/[|⟧]/g, "")}` : ""}⟧`;
}

const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const mondayOf = (date: string) => shiftLocalDate(date, -((weekdayOf(date) + 6) % 7));
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);

function dayName(date: string, withYear: boolean): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(",", "");
}

function monthName(ym: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${ym}-15T12:00:00Z`));
}

function render(a: Anchor, now: Date, maxDays: number): string {
  const day = localDateString(now, a.zone);
  // A month reads as its name: "starts in November 2026" works whichever words it came from.
  if (a.precision === "month") return monthName(a.local);
  const [date, time] = a.local.split("T") as [string, string | undefined];
  const off = dayDiff(date, day);
  const name = dayName(date, date.slice(0, 4) !== day.slice(0, 4));
  const rel =
    off === 0
      ? "today"
      : off === -1
        ? "yesterday"
        : off === 1
          ? "tomorrow"
          : off < 0
            ? `${-off} days ago`
            : `in ${off} days`;
  const near = Math.abs(off) <= maxDays;
  const weeksApart = dayDiff(mondayOf(date), mondayOf(day)) / 7;
  switch (a.precision) {
    case "week":
      if (weeksApart === 0) return "this week";
      if (weeksApart === -1) return `last week, the week of ${name}`;
      if (weeksApart === 1) return `next week, the week of ${name}`;
      return `the week of ${name}`;
    case "weekend":
      if (weeksApart === 0) return `this weekend, ${name}`;
      if (weeksApart === -1) return `last weekend, ${name}`;
      if (weeksApart === 1) return `next weekend, ${name}`;
      return `the weekend of ${name}`;
    case "since":
      return near && off !== 0 ? `${name}, ${rel}` : name;
    case "night":
      if (off === 0) return "tonight";
      if (off === -1) return `last night, ${name}`;
      if (off === 1) return `tomorrow night, ${name}`;
      return near ? `the night of ${name}, ${rel}` : `the night of ${name}`;
    case "morning":
    case "afternoon":
    case "evening":
      if (off === 0) return `this ${a.precision}`;
      if (Math.abs(off) === 1) return `${rel} ${a.precision}, ${name}`;
      return near ? `the ${a.precision} of ${name}, ${rel}` : `the ${a.precision} of ${name}`;
    case "time":
      return `${render({ ...a, local: date, precision: "day" }, now, maxDays)} at ${time}`;
    default:
      return off === 0 ? "today" : near ? `${rel}, ${name}` : name;
  }
}

function absolute(local: string, precision: Precision): string {
  if (precision === "month") return monthName(local);
  const [date, time] = local.split("T") as [string, string | undefined];
  const name = dayName(date, true);
  switch (precision) {
    case "week":
      return `the week of ${name}`;
    case "weekend":
      return `the weekend of ${name}`;
    case "night":
      return `the night of ${name}`;
    case "morning":
    case "afternoon":
    case "evening":
      return `the ${precision} of ${name}`;
    case "time":
      return `${name} at ${time}`;
    default:
      return name;
  }
}
