/**
 * Dates, one way. Stored text keeps the date each time phrase meant: when it is stored, each
 * phrase ("tomorrow", "on Sunday", "five days now") is resolved from the moment it was written, in
 * the writer's zone, and replaced by a token holding the day, its precision and that zone. Code
 * puts any date it already holds into a prompt as the same kind of token. A token is rendered only
 * when a prompt reaches a model, on its own calendar relative to that moment's now ("yesterday,
 * Sunday 11 January"). Only stored text and prompts carry tokens: her messages are never touched.
 */
import * as chrono from "chrono-node";
import {
  localDateString,
  localMidnight,
  localTime,
  shiftLocalDate,
  zoneOffsetMinutes,
} from "./timezone";

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

export type AnchorContext = {
  /** The moment the text was written, or the message sent. */
  at: Date;
  zone: string;
  /** Dates the writer was shown: a bare weekday takes the nearest of these on that weekday. */
  known?: Date[];
  /** Extract's label for the time words: which way a bare weekday or weekend points. */
  direction?: "past" | "upcoming" | null;
  /** Keep the words and gloss them (her view of older messages) instead of replacing them. */
  said?: boolean;
};
export type AnchorHints = Omit<AnchorContext, "at" | "zone"> & {
  /** Store the words as given: a labelled memory quotes them, and its dates are already tokens. */
  asSaid?: boolean;
};

type Anchor = { local: string; precision: Precision; zone: string };

const TOKEN = /⟦([^|⟧]+)\|([^|⟧]+)\|([^|⟧]+)(?:\|([^⟧]*))?⟧/g;
const ONE_TOKEN = /^⟦[^⟧]+⟧$/;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const COUNT: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  "a couple of": 2,
};
const N = "(\\d+|a couple of|a|one|two|three|four|five|six|seven|eight|nine|ten)";
const RELATIVE_WORDS =
  /\b(today|tonight|tomorrow|yesterday|this (?:morning|afternoon|evening|week|weekend)|last night|next week)\b/gi;
const DURATION = new RegExp(
  `\\b(?:it'?s been|it has been)\\s+${N}\\s+(days?|weeks?)\\b|\\b${N}\\s+(days?|weeks?)\\s+now\\b`,
  "gi",
);
const WEEK =
  /\b(?:(?:later )?this week|next week|last week|(?:by |at )?(?:the )?end of (?:the|this) week)\b/gi;
const WEEKEND = /\b(?:(this|next|last) weekend|(?:on |over |at )?the weekend)\b/gi;
const RELATIVE =
  /^(today|tonight|tomorrow|yesterday)(?: (morning|afternoon|evening|night))?$|^last night$|^this (morning|afternoon|evening)$/i;
const WEEKDAY = new RegExp(
  `^(?:(this|next|last) )?(${WEEKDAYS.join("|")})(?: (morning|afternoon|evening|night))?$`,
  "i",
);
const OFFSET = new RegExp(`^in ${N} (days?|weeks?)$|^${N} (days?|weeks?) ago$`, "i");
const MONTH_NAMES = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
// A written-out date, read whole: "the afternoon of Thursday 8 January", "Jan 8th 2026".
const DATE_PHRASE = new RegExp(
  `^(?:the )?(?:(morning|afternoon|evening|night) of )?(?:(?:${WEEKDAYS.join("|")}),? )?(?:the )?(?:(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTHS})|(${MONTHS}) (?:the )?(\\d{1,2})(?:st|nd|rd|th)?)(?:,? (\\d{4}))?$`,
  "i",
);
const ISO_DATE = new RegExp(
  `\\b(?:(?:${WEEKDAYS.join("|")}),? )?(\\d{4})-(\\d{2})-(\\d{2})\\b`,
  "gi",
);
// chrono reads across clause breaks ("…8 January, in 3 days, and they"), so it reads one clause
// at a time.
// A comma before a year belongs to its date ("March 3, 2025").
const CLAUSE = /,(?!\s*\d{4}\b)\s*|;\s*|\s+(?:and|but)\s+/g;
const ORDINAL = /^(?:the )?\d{1,2}(?:st|nd|rd|th)$/i;
const MONTH_ONLY =
  /^(?:(this|next|last) month|in (january|february|march|april|may|june|july|august|september|october|november|december))$/i;
// Only what is plainly a clock: a bare number may be the day of the month ("8 January at 3pm").
const CLOCK =
  /\s*\b(?:at\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon)|\d{1,2}(?::\d{2}(?:\s*(?:am|pm))?|\s*(?:am|pm))|noon)\b\s*/i;
const LEAD = /^(?:on|at)\s+/i;
const NOUN_AFTER =
  /^\s+(roast|brunch|lunch|dinner|service|market|papers?|school|league|mood|best|blues|vibes|feeling)\b/i;
const NOUN_BEFORE = /\b(black|good|easter|cyber|super|holy|ash|palm)\s+$/i;
// "a free Friday night", "every Sunday": a habit, not a day.
const HABIT_BEFORE = /\b(a|an|every|any|most|some)\s+(?:[a-z]+\s+)?$/i;
const PART_HOUR: Record<string, number> = { morning: 9, afternoon: 15, evening: 19, night: 22 };

// ---------- Making tokens ----------

/** Anchors every time phrase in `text`; text already anchored is left exactly as it is. */
export function anchorTimes(text: string, ctx: AnchorContext): string {
  const passes = [durations, weeks, weekends, chronoPass];
  return passes.reduce((t, pass) => mapPlain(t, (plain) => pass(plain, ctx)), text);
}

/** Anchors the top-level string values of a plain object (a summary's parts); others pass. */
export function anchorFields<T>(value: T, ctx: AnchorContext): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, typeof v === "string" ? anchorTimes(v, ctx) : v]),
  ) as T;
}

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

/** Relative day words left in a text, lowercased: the review counts what anchoring missed. */
export function relativeWords(text: string): string[] {
  return [...text.matchAll(RELATIVE_WORDS)].map((m) => m[1]!.toLowerCase());
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

// Quoted words are what someone said ("see you tomorrow" as a ritual, 'Taco Tuesday'), never a
// date to fix. A straight single quote counts only at word edges, so "don't" stays plain.
const KEPT = new RegExp(
  `${TOKEN.source}|"[^"\\n]*"|\u201c[^\u201d\\n]*\u201d|\u2018[^\u2019\\n]*\u2019|(?<=^|[\\s(])'[^'\\n]+'(?=[\\s.,;:!?)]|$)`,
  "g",
);

/** Runs `fn` on the text between tokens and quotes only, so neither is read again. */
function mapPlain(text: string, fn: (plain: string) => string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(KEPT)) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
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

function token(local: string, precision: Precision, ctx: AnchorContext, words: string): string {
  return formatToken(local, precision, ctx.zone, ctx.said ? words : undefined);
}

const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const mondayOf = (date: string) => shiftLocalDate(date, -((weekdayOf(date) + 6) % 7));
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
const count = (n: string) => COUNT[n.toLowerCase()] ?? Number(n);
const today = (ctx: AnchorContext) => localDateString(ctx.at, ctx.zone);

function durations(plain: string, ctx: AnchorContext): string {
  return plain.replace(DURATION, (match, n1?: string, u1?: string, n2?: string, u2?: string) => {
    const span = count((n1 ?? n2)!) * ((u1 ?? u2)!.toLowerCase().startsWith("week") ? 7 : 1);
    const t = token(shiftLocalDate(today(ctx), -span), "since", ctx, match);
    return ctx.said ? t : `since ${t}`;
  });
}

function weeks(plain: string, ctx: AnchorContext): string {
  const monday = mondayOf(today(ctx));
  return plain.replace(WEEK, (match) => {
    const m = match.toLowerCase();
    if (m.includes("end of")) return token(shiftLocalDate(monday, 4), "day", ctx, match);
    const shift = m.startsWith("next") ? 7 : m.startsWith("last") ? -7 : 0;
    return token(shiftLocalDate(monday, shift), "week", ctx, match);
  });
}

function weekends(plain: string, ctx: AnchorContext): string {
  const day = today(ctx);
  const wd = weekdayOf(day);
  // The weekend under way or coming: Sunday belongs to the weekend that began on Saturday.
  const thisSat = wd === 0 ? shiftLocalDate(day, -1) : shiftLocalDate(day, 6 - wd);
  return plain.replace(WEEKEND, (match, which?: string) => {
    const w = which?.toLowerCase();
    let sat: string;
    if (w === "this") sat = thisSat;
    else if (w === "next") sat = shiftLocalDate(thisSat, 7);
    else if (w === "last") sat = shiftLocalDate(thisSat, -7);
    else {
      const prevSat = wd === 0 || wd === 6 ? thisSat : shiftLocalDate(thisSat, -7);
      const known = nearestKnown(ctx, [6, 0], day);
      if (ctx.direction === "past") sat = prevSat;
      else if (ctx.direction === "upcoming") sat = thisSat;
      else if (known) sat = weekdayOf(known) === 0 ? shiftLocalDate(known, -1) : known;
      else
        sat =
          Math.abs(dayDiff(prevSat, day)) <= Math.abs(dayDiff(thisSat, day)) ? prevSat : thisSat;
    }
    return token(sat, "weekend", ctx, match);
  });
}

/** The known date on one of these weekdays nearest to `day`, as a local date. */
function nearestKnown(ctx: AnchorContext, weekdays: number[], day: string): string | null {
  return (
    (ctx.known ?? [])
      .map((d) => localDateString(d, ctx.zone))
      .filter((d) => weekdays.includes(weekdayOf(d)))
      .sort((a, b) => Math.abs(dayDiff(a, day)) - Math.abs(dayDiff(b, day)))[0] ?? null
  );
}

function pickWeekday(day: string, wd: number, ctx: AnchorContext): string | null {
  const back = (weekdayOf(day) - wd + 7) % 7; // days since it last came round (0: today)
  const ahead = (wd - weekdayOf(day) + 7) % 7; // days until it comes round (0: today)
  if (ctx.direction === "past") return shiftLocalDate(day, -back);
  // "monday" said on a Monday about something coming means next week's.
  if (ctx.direction === "upcoming") return shiftLocalDate(day, ahead || 7);
  const known = nearestKnown(ctx, [wd], day);
  if (known) return known;
  // Read as typed, a bare weekday could point either way; the day line above it dates it.
  if (ctx.said) return null;
  return shiftLocalDate(day, ahead);
}

function explicitWeekday(day: string, wd: number, which: string): string {
  const back = (weekdayOf(day) - wd + 7) % 7;
  const ahead = (wd - weekdayOf(day) + 7) % 7;
  if (which === "last") return shiftLocalDate(day, -(back || 7));
  if (which === "next") return shiftLocalDate(day, ahead || 7);
  return shiftLocalDate(day, ahead);
}

type Found = { from: number; end: number; anchor: Omit<Anchor, "zone">; written: boolean };

function chronoPass(plain: string, ctx: AnchorContext): string {
  const ref = { instant: ctx.at, timezone: zoneOffsetMinutes(ctx.at, ctx.zone) };
  const found: Found[] = [];
  for (const m of plain.matchAll(ISO_DATE)) {
    // A reference number shaped like a date ("2026-13-45") is not one; its token would never read.
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    if (isNaN(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso) continue;
    found.push({
      from: m.index,
      end: m.index + m[0].length,
      anchor: { local: iso, precision: "day" },
      written: true,
    });
  }
  let start = 0;
  for (const sep of [...plain.matchAll(CLAUSE), null]) {
    const end = sep ? sep.index : plain.length;
    const clause = plain.slice(start, end);
    for (const r of chrono.casual.parse(clause, ref)) {
      const at = start + r.index;
      if (found.some((f) => at < f.end && at + r.text.length > f.from)) continue;
      const lead = LEAD.exec(r.text)?.[0] ?? "";
      const words = r.text.slice(lead.length).replace(/[\s,.;:!?]+$/, "");
      const anchor = classify(words, clause, r, ctx);
      if (!anchor) continue;
      // "the afternoon of …" renders with its own "the".
      const the = /\bthe\s+$/i.test(clause.slice(0, r.index)) && / of /i.test(words) ? 4 : 0;
      found.push({
        // Her own notes drop "on"/"at"; her view of older messages keeps every word.
        from: ctx.said ? at + lead.length : at - the,
        end: at + lead.length + words.length,
        anchor,
        written: DATE_PHRASE.test(words.replace(CLOCK, " ").trim()),
      });
    }
    if (sep) start = sep.index + sep[0].length;
  }
  let out = plain;
  // From the end backwards, so earlier indices stay valid while the text changes.
  for (const f of merged(found, plain).sort((a, b) => b.from - a.from))
    out =
      out.slice(0, f.from) +
      token(f.anchor.local, f.anchor.precision, ctx, plain.slice(f.from, f.end)) +
      out.slice(f.end);
  return out;
}

const FINER: Precision[] = ["time", "morning", "afternoon", "evening", "night", "day"];

/**
 * Two anchors with only a comma, space or bracket between them are one date said twice
 * ("yesterday, Thursday 8 January"): one token, at the finer precision. When they disagree,
 * the written-out date wins; two different written-out dates stay two.
 */
function merged(found: Found[], plain: string): Found[] {
  const out: Found[] = [];
  for (const f of [...found].sort((a, b) => a.from - b.from)) {
    const prev = out.at(-1);
    const gap = prev ? plain.slice(prev.end, f.from) : "";
    if (prev && /^[\s,;(]*$/.test(gap)) {
      const same = prev.anchor.local.slice(0, 10) === f.anchor.local.slice(0, 10);
      if (same || prev.written !== f.written) {
        const keep = same
          ? FINER.indexOf(f.anchor.precision) < FINER.indexOf(prev.anchor.precision)
            ? f
            : prev
          : prev.written
            ? prev
            : f;
        const close = gap.includes("(") && plain[f.end] === ")" ? 1 : 0;
        out[out.length - 1] = { ...keep, from: prev.from, end: f.end + close };
        continue;
      }
    }
    out.push(f);
  }
  return out;
}

function classify(
  words: string,
  plain: string,
  r: chrono.ParsedResult,
  ctx: AnchorContext,
): Omit<Anchor, "zone"> | null {
  // A clock time rides on a day ("tomorrow at 3pm"); a bare clock time ("at 8") anchors nothing.
  if (!r.start.isCertain("hour")) return classifyDay(words, plain, r, ctx);
  const rest = words.replace(CLOCK, " ").trim();
  if (!rest || rest === words) return null;
  const dated = classifyDay(rest, plain, r, ctx);
  // A clock time sits on a day or a part of one ("tonight at 20:45"); the clock is the finer.
  if (!dated || !["day", "morning", "afternoon", "evening", "night"].includes(dated.precision))
    return null;
  const hh = String(r.start.get("hour")).padStart(2, "0");
  const mm = String(r.start.get("minute") ?? 0).padStart(2, "0");
  return { local: `${dated.local}T${hh}:${mm}`, precision: "time" };
}

function classifyDay(
  words: string,
  plain: string,
  r: chrono.ParsedResult,
  ctx: AnchorContext,
): Omit<Anchor, "zone"> | null {
  const day = today(ctx);
  const w = words.toLowerCase();
  if (!w || /^(right )?now$/.test(w)) return null;
  let m: RegExpExecArray | null;
  if ((m = RELATIVE.exec(w))) {
    const shift =
      w.startsWith("yesterday") || w === "last night" ? -1 : w.startsWith("tomorrow") ? 1 : 0;
    const part = (m[2] ?? m[3] ?? (/night/.test(w) ? "night" : null)) as Precision | null;
    return { local: shiftLocalDate(day, shift), precision: part ?? "day" };
  }
  if ((m = WEEKDAY.exec(w))) {
    // What comes right before the weekday word itself, not before chrono's "on".
    const before = plain.slice(0, r.index + Math.max(0, r.text.indexOf(words)));
    const after = plain.slice(r.index + r.text.length);
    if (!m[1] && !m[3] && (NOUN_AFTER.test(after) || NOUN_BEFORE.test(before))) return null;
    if (!m[1] && HABIT_BEFORE.test(before)) return null;
    const wd = WEEKDAYS.indexOf(m[2]!.toLowerCase());
    const local = m[1] ? explicitWeekday(day, wd, m[1].toLowerCase()) : pickWeekday(day, wd, ctx);
    if (!local) return null;
    return { local, precision: (m[3]?.toLowerCase() as Precision | undefined) ?? "day" };
  }
  if ((m = OFFSET.exec(w))) {
    const ago = m[3] !== undefined;
    const span = count((m[1] ?? m[3])!) * ((m[2] ?? m[4])!.startsWith("week") ? 7 : 1);
    return { local: shiftLocalDate(day, ago ? -span : span), precision: "day" };
  }
  if ((m = DATE_PHRASE.exec(w))) {
    const mo = String(MONTH_NAMES.indexOf((m[3] ?? m[4])!.slice(0, 3)) + 1).padStart(2, "0");
    const dd = String(Number(m[2] ?? m[5])).padStart(2, "0");
    const part = (m[1] as Precision | undefined) ?? "day";
    if (m[6]) return { local: `${m[6]}-${mo}-${dd}`, precision: part };
    // A date without a year is on the side of now its label points to, else the nearest one.
    const y = Number(day.slice(0, 4));
    const options = [y - 1, y, y + 1]
      .map((year) => `${year}-${mo}-${dd}`)
      .filter((o) =>
        ctx.direction === "past" ? o <= day : ctx.direction === "upcoming" ? o >= day : true,
      );
    const nearest = options.sort(
      (a, b) => Math.abs(dayDiff(a, day)) - Math.abs(dayDiff(b, day)),
    )[0]!;
    return { local: nearest, precision: part };
  }
  if (ORDINAL.test(w)) {
    // "the 13th" is the occurrence nearest the moment it was written.
    return { local: localDateString(r.start.date(), ctx.zone), precision: "day" };
  }
  // chrono reads "in october" as "october"; only with the "in" before it is it a month to come
  // (a lone "may" stays a verb).
  const inMonth = /\bin\s+$/i.test(plain.slice(0, r.index)) ? `in ${w}` : w;
  if ((m = MONTH_ONLY.exec(inMonth))) {
    const [y, mo] = day.slice(0, 7).split("-").map(Number) as [number, number];
    if (m[1]) {
      const shift = m[1].toLowerCase() === "next" ? 1 : m[1].toLowerCase() === "last" ? -1 : 0;
      const local = new Date(Date.UTC(y, mo - 1 + shift, 1)).toISOString().slice(0, 7);
      return { local, precision: "month" };
    }
    // "in october" said in October is this October; otherwise the next one, or the last one when
    // it already happened.
    const target = new Date(`${m[2]} 1, ${y} 12:00 UTC`).getUTCMonth() + 1;
    const year = ctx.direction === "past" ? (target <= mo ? y : y - 1) : target >= mo ? y : y + 1;
    return { local: `${year}-${String(target).padStart(2, "0")}`, precision: "month" };
  }
  return null;
}

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
