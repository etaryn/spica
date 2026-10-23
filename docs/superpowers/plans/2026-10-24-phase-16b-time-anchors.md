# Phase 16b: Time Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One date system. Stored text keeps the date each time phrase meant, every date a builder holds goes into a prompt as a token on its owner's calendar, one wrapper renders all tokens on the reader's day, and reach-outs can't go out on the wrong day.

**Architecture:**
- **One time module.** `src/mind/platform/time-anchors.ts` replaces `relative-date.ts`. It makes tokens (`⟦date|precision|zone⟧`, plus `|said words` in her view of messages) from stored text (`anchorTimes`) and from dates code already holds (`dateToken`), and renders them (`renderTimes`).
- **Writes.** The two inserts anchor every write by default. Message timestamps are the anchoring moment for anything said in a conversation.
- **Reads.** Builders never render dates; they place tokens. One provider wrapper renders every token at the clock's now.
- **Reach-outs** get code-picked framing, and guard v7 `wrong_day` drops a misdated one.

**Tech Stack:** TypeScript, chrono-node 2.10.1 (already a dependency), Drizzle and Postgres, Vitest, versioned prompt files.

**Spec:** `docs/2026-10-24-phase-16b-time-anchors-design.md` (settled with Ethan 2026-10-24, items 1–9 and the review pass); spec §20 row "Time anchors". Memory `phase-16b-settled`, `her-speech-stays-free`.

## Global Constraints

- **Her messages to the user are never post-processed.** Only stored memory text is anchored. Tokens never reach a model, because the provider wrapper renders them.
- **One date system.** After this phase no builder renders a date itself. A date in a prompt is a token, rendered in one place. "Your day" clock times and extract's absolute turn labels are not relative dates and stay.
- **Numbers live in `config/default.json`:** `time.relative_max_days: 6` is the only new number.
- **Prompts:** every prompt change is a new version file (`git mv` from the old one, then edit) plus the config bump. No old version file stays.
- **Don't edit `prompts/persona/*`.**
- **`src/mind` stays framework-free:** time comes from `deps.clock` or a `now` argument.
- **Boundaries:** core reads only core. ESLint stops core, world and shared code importing user, process or admin code.
- **Comments say why,** never cite spec sections, phases or review items. New files start with a plain-English header.
- **Prettier at 100 columns.** No retries or regenerations (the no-retries side phase).
- **Tests:** targeted `pnpm test <path>`; the full suite once, at close; one test process at a time.
- **Backslashes:** never write strings containing them through shell heredocs or `python -c`; use the Write/Edit tools.
- **Replace from the ground up.** These are deleted in this phase, with their tests:
  - `src/mind/platform/relative-date.ts` (`relativeDate`, `dayInWords`, `itemWhen`, `writtenOn`, `stamped`, `noteRelativeWords`; `relativeWords` moves);
  - `src/mind/memory/user/when.ts`;
  - `guardNow`;
  - `RetrievedFact.noted`;
  - extract's `when`, `{when}`, its own `occurred_at` and its own thread `next_checkpoint`;
  - the "[N days later]" marker and `gapMarkerMinHours`;
  - the written stamp on ideas.

## Review Focus

1. **Text that already holds tokens is anchored again** (a writer anchors, then the repo anchors): it must come out unchanged, and chrono must never read the `2026-01-11` inside a token. Pinned in Task 1.
2. **A user with no zone or an invalid one:** `insertFact` anchors in UTC, never throws. Pinned in Task 3.
3. **A date read in another year** (written 28 December, read 20 January): it names its year. Pinned in Task 1.
4. **An older message whose time word is "today"** ("today was rough", sent yesterday): the gloss reads "today (that's yesterday, …)". A same-day message is never glossed. Pinned in Task 7.
5. **Extract's cross-check:**
   - when their message names two weekdays, the fact is left alone;
   - a right past date ("I finished it on Saturday", said Monday, labelled past) is never moved to the coming Saturday.

   Pinned in Task 5.

---

## File map

| File | Change |
|---|---|
| `src/mind/platform/time-anchors.ts` (new) | tokens from text and from dates, rendering, `nowLine`, `ownDate`, `written`, `stamped`, `relativeWords` |
| `src/mind/platform/relative-date.ts` | **deleted** (Task 4) |
| `src/mind/platform/llm/render-net.ts` (new) | provider wrapper: renders every token in every prompt |
| `src/mind/platform/config.ts`, `config/default.json` | `time.relative_max_days` |
| `src/runtime/deps.ts`, `evals/lib/runner.ts`, `src/db/reset-self-cli.ts` | wrap the provider; give the core layer her zone |
| `src/db/repos/user/facts.ts`, `src/db/repos/core/{index,memory}.ts`, `src/mind/memory/core/types.ts` | inserts anchor by default; hints; core zone |
| prompt builders (20 files, listed in Task 4) | place tokens instead of rendering dates |
| `src/mind/memory/user/extract.ts`, `prompts/extract/v10.md`; **delete** `when.ts` | time words stay in the fact; past/upcoming label; weekday cross-check |
| `src/mind/process/user/*`, `src/mind/process/core/render-snapshot.ts`, `prompts/user-mind/*`, `prompts/core/*` | shown-date hints; snapshot lines anchored once; prompt lines |
| `src/mind/process/hot-path/{assemble,compose}.ts` | `viewTurns` (dividers and glosses), the Now section |
| `src/mind/process/hot-path/compose.ts` (`renderReachOut`), `src/mind/process/outreach/{candidates,send}.ts`, `prompts/reach-out/v4.md` | framing; drop on `wrong_day` |
| `src/mind/process/guard/{categories,outgoing,guard}.ts`, `prompts/guard/v7.md`, `src/db/schema.ts` + migration | `wrong_day`, outcome `dropped` |
| `evals/guard/*.yaml`, `evals/lib/review.ts` | cases; absolute render; `relativeWords` import |
| `tests/exit/phase-16b.test.ts` (new) | exit test with the leak canary |

---

### Task 1: The time module

**Files:**
- Create: `src/mind/platform/time-anchors.ts`
- Modify: `src/mind/platform/config.ts` (the `time` schema), `config/default.json`
- Test: `tests/mind/platform/time-anchors.test.ts` (new), `tests/mind/platform/config.test.ts`

**Interfaces:**
- Produces:
  - `type Precision = "day" | "morning" | "afternoon" | "evening" | "night" | "time" | "weekend" | "week" | "month" | "since"`
  - `type AnchorContext = { at: Date; zone: string; known?: Date[]; direction?: "past" | "upcoming" | null; said?: boolean }` and `type AnchorHints = Omit<AnchorContext, "at" | "zone">`
  - `anchorTimes(text, ctx): string` and `anchorFields<T>(value: T, ctx): T`
  - `dateToken(at: Date, zone: string, precision?: "day" | "time"): string`
  - `ownDate(content: string, when: Date | null, zone: string): string | null`
  - `written(at: Date, zone: string): string`: "written ⟦…⟧"
  - `stamped(text: string, at: Date, zone: string): string`: "(written ⟦…⟧)\n" + text
  - `renderTimes(text, now, maxDays): string` and `renderAbsolute(text): string`
  - `tokenDates(text): Date[]` and `isSingleToken(text): boolean`
  - `nowLine(now: Date, theirs: string, hers: string, herLabel = "for you"): string`
  - `relativeWords(text): string[]` (moved from `relative-date.ts`)
  - config `config.time.relative_max_days`

- [ ] **Step 1: Write the failing tests**

Create `tests/mind/platform/time-anchors.test.ts`:

```ts
/** Time anchors: a phrase keeps the date it meant when written, and reads right on any later day. */
import { expect, test } from "vitest";
import {
  anchorFields,
  anchorTimes,
  dateToken,
  isSingleToken,
  nowLine,
  ownDate,
  relativeWords,
  renderAbsolute,
  renderTimes,
  stamped,
  tokenDates,
} from "@/mind/platform/time-anchors";

const MON = new Date("2026-01-12T09:00:00Z"); // Monday 12 January 2026
const at = (iso: string) => new Date(iso);
const utc = { at: MON, zone: "UTC" };
const read = (text: string, now: Date) => renderTimes(text, now, 6);
const days = (text: string) => tokenDates(text).map((d) => d.toISOString().slice(0, 10));

test("relative words become the day they meant, and read right later", () => {
  const stored = anchorTimes("how'd the race go yesterday—legs hold up?", utc);
  expect(stored).not.toContain("yesterday");
  expect(read(stored, MON)).toBe("how'd the race go yesterday, Sunday 11 January—legs hold up?");
  expect(read(stored, at("2026-01-13T09:00:00Z"))).toBe(
    "how'd the race go 2 days ago, Sunday 11 January—legs hold up?",
  );
  const night = anchorTimes("Spica has a telescope booking confirmed for tonight.", utc);
  expect(read(night, MON)).toBe("Spica has a telescope booking confirmed for tonight.");
  expect(read(night, at("2026-01-13T09:00:00Z"))).toBe(
    "Spica has a telescope booking confirmed for last night, Monday 12 January.",
  );
});

test("day counts follow the calendar across midnight and a DST change", () => {
  const late = anchorTimes("today", { at: at("2026-01-11T23:30:00Z"), zone: "UTC" });
  expect(read(late, at("2026-01-12T00:10:00Z"))).toBe("yesterday, Sunday 11 January");
  const london = anchorTimes("today", { at: at("2026-03-28T12:00:00Z"), zone: "Europe/London" });
  expect(read(london, at("2026-03-30T00:30:00Z"))).toBe("2 days ago, Saturday 28 March");
});

test("a bare weekday takes a date the writer was shown, else points by the rule", () => {
  const written = at("2026-01-05T10:00:00Z"); // Monday the 5th
  const race = at("2026-01-11T08:00:00Z"); // Sunday
  expect(days(anchorTimes("Sam's got a half marathon Sunday.", { at: written, zone: "UTC", known: [race] }))).toEqual(["2026-01-11"]);
  expect(days(anchorTimes("Sam's got a half marathon Sunday.", { at: written, zone: "UTC" }))).toEqual(["2026-01-11"]);
  expect(days(anchorTimes("They're awake late on a Wednesday.", { at: at("2026-01-14T23:00:00Z"), zone: "UTC" }))).toEqual(["2026-01-14"]);
  expect(days(anchorTimes("The user finished it on Saturday.", { ...utc, direction: "past" }))).toEqual(["2026-01-10"]);
  expect(days(anchorTimes("The user has a meeting on Monday.", { ...utc, direction: "upcoming" }))).toEqual(["2026-01-19"]);
});

test("weeks, weekends, offsets, explicit dates and durations anchor", () => {
  expect(days(anchorTimes("Both happen this week.", utc))).toEqual(["2026-01-12"]);
  expect(days(anchorTimes("Due by the end of the week.", utc))).toEqual(["2026-01-16"]);
  expect(days(anchorTimes("Sister visits Saturday 17 January.", utc))).toEqual(["2026-01-17"]);
  expect(days(anchorTimes("The results come in 3 days.", utc))).toEqual(["2026-01-15"]);
  expect(days(anchorTimes("She left 2 days ago.", utc))).toEqual(["2026-01-10"]);
  // "over the weekend" with no label takes the nearest weekend: from a Monday, the one just past.
  expect(days(anchorTimes("The user finished the task over the weekend.", utc))).toEqual(["2026-01-10"]);
  expect(days(anchorTimes("Starts in october.", utc))).toEqual(["2026-10-01"]);
  const waited = anchorTimes("Still waiting on feedback, five days now.", utc);
  expect(read(waited, at("2026-01-13T09:00:00Z"))).toBe(
    "Still waiting on feedback, since Wednesday 7 January, 6 days ago.",
  );
});

test("a time on a day anchors; a bare clock time, 'now' and weekday nouns don't", () => {
  expect(read(anchorTimes("The call is tomorrow at 3pm.", utc), MON)).toBe(
    "The call is tomorrow, Tuesday 13 January at 15:00.",
  );
  for (const s of [
    "Sam's in the thick of it right now.",
    "She ran mile 10 at 8 pace.",
    "She loves Sunday roast and Black Friday sales.",
    "the trap was waiting for the night that would be different",
    "she's catching the pattern everywhere this year",
  ])
    expect(anchorTimes(s, utc)).toBe(s);
});

test("anchoring twice changes nothing, and dates inside tokens are never re-read", () => {
  const once = anchorTimes("Sister visits Saturday 17 January, then the race tomorrow.", utc);
  expect(anchorTimes(once, utc)).toBe(once);
  expect(anchorTimes(once, { at: at("2027-06-01T09:00:00Z"), zone: "Asia/Singapore" })).toBe(once);
});

test("a date read in another year names its year", () => {
  const stored = anchorTimes("The party is on Wednesday 30 December.", { at: at("2026-12-28T09:00:00Z"), zone: "UTC" });
  // Her stored notes drop the "on" with the phrase; the date reads on its own.
  expect(read(stored, at("2027-01-20T09:00:00Z"))).toBe("The party is Wednesday 30 December 2026.");
});

test("each token reads on its own calendar", () => {
  const her = anchorTimes("Clear skies tonight.", { at: at("2026-01-12T15:30:00Z"), zone: "Asia/Singapore" });
  expect(read(her, at("2026-01-12T17:00:00Z"))).toBe("Clear skies last night, Monday 12 January.");
});

test("said mode keeps the words and glosses them only when their meaning moved", () => {
  const glossed = anchorTimes("my race is tomorrow", { ...utc, said: true });
  expect(read(glossed, at("2026-01-12T20:00:00Z"))).toBe("my race is tomorrow");
  expect(read(glossed, at("2026-01-13T08:00:00Z"))).toBe("my race is tomorrow (that's today)");
  expect(read(glossed, at("2026-01-14T08:00:00Z"))).toBe(
    "my race is tomorrow (that's yesterday, Tuesday 13 January)",
  );
});

test("dates code holds become tokens: a memory's date shows once; written stamps", () => {
  expect(read(dateToken(at("2026-01-11T08:00:00Z"), "UTC"), MON)).toBe("yesterday, Sunday 11 January");
  expect(read(dateToken(at("2026-01-15T19:00:00Z"), "UTC", "time"), MON)).toBe("in 3 days, Thursday 15 January at 19:00");
  expect(ownDate("Sam is stressed.", at("2026-01-09T08:00:00Z"), "UTC")).toBe(dateToken(at("2026-01-09T08:00:00Z"), "UTC"));
  expect(ownDate(anchorTimes("The race is tomorrow.", utc), MON, "UTC")).toBeNull();
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
  expect(nowLine(t, "Europe/London", "Asia/Singapore", "where Spica is")).toContain("05:40 where Spica is");
});

test("absolute rendering, token dates, single tokens, fields, leftover words", () => {
  const s = anchorTimes("the race tomorrow", utc);
  expect(renderAbsolute(s)).toBe("the race Tuesday 13 January 2026");
  expect(tokenDates(s)[0]!.toISOString()).toBe("2026-01-13T12:00:00.000Z");
  expect(isSingleToken(anchorTimes("tomorrow", utc))).toBe(true);
  expect(isSingleToken("tomorrow")).toBe(false);
  expect(anchorFields({ a: "see you tomorrow", n: 3, from: ["x"] }, utc)).toEqual({
    a: anchorTimes("see you tomorrow", utc),
    n: 3,
    from: ["x"],
  });
  expect(anchorFields(null, utc)).toBeNull();
  expect(relativeWords("Sister visits tomorrow, coming Today.")).toEqual(["tomorrow", "today"]);
});
```

Add to `tests/mind/platform/config.test.ts`:

```ts
test("time anchors read as distances within a week", () => {
  expect(loadConfig().time.relative_max_days).toBe(6);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/platform/time-anchors.test.ts tests/mind/platform/config.test.ts`
Expected: FAIL. The module doesn't exist and `config.time` is undefined.

- [ ] **Step 3: Config**

In `src/mind/platform/config.ts`, before `export const ConfigSchema`, add `const time = z.object({ relative_max_days: positiveInt });`, and `time,` inside `ConfigSchema` after `prompts,`. In `config/default.json`, add a top-level `"time": { "relative_max_days": 6 },` before `"prompts"`.

- [ ] **Step 4: The module**

Create `src/mind/platform/time-anchors.ts`:

```ts
/**
 * Dates, one way. Stored text keeps the date each time phrase meant: when it is stored, each
 * phrase ("tomorrow", "on Sunday", "five days now") is resolved from the moment it was written, in
 * the writer's zone, and replaced by a token holding the day, its precision and that zone. Code
 * puts any date it already holds into a prompt as the same kind of token. A token is rendered only
 * when a prompt reaches a model, on its own calendar relative to that moment's now ("yesterday,
 * Sunday 11 January"). Only stored text and prompts carry tokens: her messages are never touched.
 */
import * as chrono from "chrono-node";
import { localDateString, localMidnight, localTime, shiftLocalDate, zoneOffsetMinutes } from "./timezone";

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
export type AnchorHints = Omit<AnchorContext, "at" | "zone">;

type Anchor = { local: string; precision: Precision; zone: string };

const TOKEN = /⟦([^|⟧]+)\|([^|⟧]+)\|([^|⟧]+)(?:\|([^⟧]*))?⟧/g;
const ONE_TOKEN = /^⟦[^⟧]+⟧$/;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const COUNT: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  "a couple of": 2,
};
const N = "(\\d+|a couple of|a|one|two|three|four|five|six|seven|eight|nine|ten)";
// Words pointing back in time: forward-dating would push "last friday" into next week.
const PAST = /\b(last|ago|yesterday|earlier|previous|before)\b/i;
const RELATIVE_WORDS = /\b(today|tonight|tomorrow|yesterday|this (?:morning|afternoon|evening|week|weekend)|last night|next week)\b/gi;
const DURATION = new RegExp(
  `\\b(?:it'?s been|it has been)\\s+${N}\\s+(days?|weeks?)\\b|\\b${N}\\s+(days?|weeks?)\\s+now\\b`,
  "gi",
);
const WEEK = /\b(?:(?:later )?this week|next week|last week|(?:by |at )?(?:the )?end of (?:the|this) week)\b/gi;
const WEEKEND = /\b(?:(this|next|last) weekend|(?:on |over |at )?the weekend)\b/gi;
const RELATIVE = /^(today|tonight|tomorrow|yesterday)(?: (morning|afternoon|evening|night))?$|^last night$|^this (morning|afternoon|evening)$/i;
const WEEKDAY = new RegExp(
  `^(?:(this|next|last) )?(${WEEKDAYS.join("|")})s?(?: (morning|afternoon|evening|night))?$`,
  "i",
);
const OFFSET = new RegExp(`^in ${N} (days?|weeks?)$|^${N} (days?|weeks?) ago$`, "i");
const MONTH = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const ORDINAL = /^(?:the )?\d{1,2}(?:st|nd|rd|th)$/i;
const MONTH_ONLY = /^(?:(this|next|last) month|in (january|february|march|april|may|june|july|august|september|october|november|december))$/i;
const CLOCK = /\s*\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b\s*/i;
const LEAD = /^(?:on|at)\s+/i;
const NOUN_AFTER = /^\s+(roast|brunch|lunch|dinner|service|market|papers?|school|league|mood|best|blues|vibes|feeling)\b/i;
const NOUN_BEFORE = /\b(black|good|easter|cyber|super|holy|ash|palm)\s+$/i;
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
  return precision === "time" ? `⟦${day}T${localTime(at, zone)}|time|${zone}⟧` : `⟦${day}|day|${zone}⟧`;
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
  return text.replace(TOKEN, (_m, local: string, precision: Precision, zone: string, said?: string) => {
    const phrase = render({ local, precision, zone }, now, maxDays);
    if (!said) return phrase;
    // Words that still mean what they say need no gloss ("tomorrow", said today).
    if (phrase.toLowerCase().startsWith(said.toLowerCase())) return said;
    return precision === "since" ? `${said} (since ${phrase})` : `${said} (that's ${phrase})`;
  });
}

/** Each token as a plain date with its year, for readers with no "now" (the review). */
export function renderAbsolute(text: string): string {
  return text.replace(TOKEN, (_m, local: string, precision: Precision, _zone: string, said?: string) => {
    const abs = absolute(local, precision);
    return said ? `${said} (${abs})` : abs;
  });
}

/** The instants the tokens in `text` point at. */
export function tokenDates(text: string): Date[] {
  return [...text.matchAll(TOKEN)].map((m) => instant({ local: m[1]!, precision: m[2] as Precision, zone: m[3]! }));
}

export function isSingleToken(text: string): boolean {
  return ONE_TOKEN.test(text.trim());
}

/** "It's Tuesday 13 January, 21:40 where they are; …for you.": now on both calendars. */
export function nowLine(now: Date, theirs: string, hers: string, herLabel = "for you"): string {
  const at = (tz: string) =>
    `${new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" })
      .format(now)
      .replace(",", "")}, ${localTime(now, tz)}`;
  return at(theirs) === at(hers) ? `It's ${at(theirs)}.` : `It's ${at(theirs)} where they are; ${at(hers)} ${herLabel}.`;
}

/** Relative day words left in a text, lowercased: the review counts what anchoring missed. */
export function relativeWords(text: string): string[] {
  return [...text.matchAll(RELATIVE_WORDS)].map((m) => m[1]!.toLowerCase());
}

// ---------- Internals ----------

function instant(a: Anchor): Date {
  const [date, time] = a.local.split("T");
  const day = a.precision === "month" ? `${a.local}-01` : date!;
  const midnight = localMidnight(day, a.zone).getTime();
  if (time) {
    const [h, m] = time.split(":").map(Number);
    return new Date(midnight + (h! * 60 + m!) * 60_000);
  }
  return new Date(midnight + (PART_HOUR[a.precision] ?? 12) * 3_600_000);
}

/** Runs `fn` on the text between tokens only, so nothing inside a token is read again. */
function mapPlain(text: string, fn: (plain: string) => string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  return out + fn(text.slice(last));
}

function token(local: string, precision: Precision, ctx: AnchorContext, words: string): string {
  const said = ctx.said ? `|${words.replace(/[|⟧]/g, "")}` : "";
  return `⟦${local}|${precision}|${ctx.zone}${said}⟧`;
}

const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const mondayOf = (date: string) => shiftLocalDate(date, -((weekdayOf(date) + 6) % 7));
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
const count = (n: string) => COUNT[n.toLowerCase()] ?? Number(n);
const today = (ctx: AnchorContext) => localDateString(ctx.at, ctx.zone);

function durations(plain: string, ctx: AnchorContext): string {
  return plain.replace(DURATION, (match, n1?: string, u1?: string, n2?: string, u2?: string) => {
    const span = count((n1 ?? n2)!) * ((u1 ?? u2)!.startsWith("week") ? 7 : 1);
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
      else sat = Math.abs(dayDiff(prevSat, day)) <= Math.abs(dayDiff(thisSat, day)) ? prevSat : thisSat;
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

function pickWeekday(day: string, wd: number, ctx: AnchorContext, words: string): string {
  const back = (weekdayOf(day) - wd + 7) % 7; // days since it last came round (0: today)
  const ahead = (wd - weekdayOf(day) + 7) % 7; // days until it comes round (0: today)
  if (ctx.direction === "past") return shiftLocalDate(day, -back);
  // "monday" said on a Monday about something coming means next week's.
  if (ctx.direction === "upcoming") return shiftLocalDate(day, ahead || 7);
  const known = nearestKnown(ctx, [wd], day);
  if (known) return known;
  return PAST.test(words) ? shiftLocalDate(day, -back) : shiftLocalDate(day, ahead);
}

function explicitWeekday(day: string, wd: number, which: string): string {
  const back = (weekdayOf(day) - wd + 7) % 7;
  const ahead = (wd - weekdayOf(day) + 7) % 7;
  if (which === "last") return shiftLocalDate(day, -(back || 7));
  if (which === "next") return shiftLocalDate(day, ahead || 7);
  return shiftLocalDate(day, ahead);
}

function chronoPass(plain: string, ctx: AnchorContext): string {
  const ref = { instant: ctx.at, timezone: zoneOffsetMinutes(ctx.at, ctx.zone) };
  let out = plain;
  // From the end backwards, so earlier indices stay valid while the text changes.
  for (const r of chrono.casual.parse(plain, ref).reverse()) {
    const lead = LEAD.exec(r.text)?.[0] ?? "";
    const words = r.text.slice(lead.length).replace(/[\s,.;:!?]+$/, "");
    const anchor = classify(words, plain, r, ctx);
    if (!anchor) continue;
    const from = ctx.said ? r.index + lead.length : r.index; // her own notes drop "on"/"at"
    const end = r.index + lead.length + words.length;
    out = out.slice(0, from) + token(anchor.local, anchor.precision, ctx, words) + out.slice(end);
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
  if (!dated || dated.precision !== "day") return null;
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
    const shift = w.startsWith("yesterday") || w === "last night" ? -1 : w.startsWith("tomorrow") ? 1 : 0;
    const part = (m[2] ?? m[3] ?? (/night/.test(w) ? "night" : null)) as Precision | null;
    return { local: shiftLocalDate(day, shift), precision: part ?? "day" };
  }
  if ((m = WEEKDAY.exec(w))) {
    const before = plain.slice(0, r.index);
    const after = plain.slice(r.index + r.text.length);
    if (!m[1] && !m[3] && (NOUN_AFTER.test(after) || NOUN_BEFORE.test(before))) return null;
    const wd = WEEKDAYS.indexOf(m[2]!.toLowerCase());
    const local = m[1] ? explicitWeekday(day, wd, m[1].toLowerCase()) : pickWeekday(day, wd, ctx, w);
    return { local, precision: (m[3]?.toLowerCase() as Precision | undefined) ?? "day" };
  }
  if ((m = OFFSET.exec(w))) {
    const ago = m[3] !== undefined;
    const span = count((m[1] ?? m[3])!) * ((m[2] ?? m[4])!.startsWith("week") ? 7 : 1);
    return { local: shiftLocalDate(day, ago ? -span : span), precision: "day" };
  }
  if ((MONTH.test(w) && /\d/.test(w)) || ORDINAL.test(w)) {
    // A date without a year is the occurrence nearest the moment it was written.
    const parsed = localDateString(r.start.date(), ctx.zone);
    if (r.start.isCertain("year")) return { local: parsed, precision: "day" };
    const options = [-1, 0, 1].map((y) => `${Number(parsed.slice(0, 4)) + y}${parsed.slice(4)}`);
    const nearest = options.sort((a, b) => Math.abs(dayDiff(a, day)) - Math.abs(dayDiff(b, day)))[0]!;
    return { local: nearest, precision: "day" };
  }
  if ((m = MONTH_ONLY.exec(w))) {
    const [y, mo] = day.slice(0, 7).split("-").map(Number) as [number, number];
    if (m[1]) {
      const shift = m[1].toLowerCase() === "next" ? 1 : m[1].toLowerCase() === "last" ? -1 : 0;
      return { local: new Date(Date.UTC(y, mo - 1 + shift, 1)).toISOString().slice(0, 7), precision: "month" };
    }
    // "in october" said in October is this October; otherwise the next one.
    const target = new Date(`${m[2]} 1, ${y} 12:00 UTC`).getUTCMonth() + 1;
    return { local: `${target >= mo ? y : y + 1}-${String(target).padStart(2, "0")}`, precision: "month" };
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
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(`${ym}-15T12:00:00Z`),
  );
}

function render(a: Anchor, now: Date, maxDays: number): string {
  const day = localDateString(now, a.zone);
  if (a.precision === "month") {
    const months =
      (Number(a.local.slice(0, 4)) - Number(day.slice(0, 4))) * 12 +
      (Number(a.local.slice(5, 7)) - Number(day.slice(5, 7)));
    const label = monthName(a.local);
    return months === 0 ? "this month" : months === -1 ? `last month, ${label}` : months === 1 ? `next month, ${label}` : label;
  }
  const [date, time] = a.local.split("T") as [string, string | undefined];
  const off = dayDiff(date, day);
  const name = dayName(date, date.slice(0, 4) !== day.slice(0, 4));
  const rel = off === 0 ? "today" : off === -1 ? "yesterday" : off === 1 ? "tomorrow" : off < 0 ? `${-off} days ago` : `in ${off} days`;
  const near = Math.abs(off) <= maxDays;
  const weeksApart = dayDiff(mondayOf(date), mondayOf(day)) / 7;
  switch (a.precision) {
    case "week":
      return weeksApart === 0 ? "this week" : weeksApart === -1 ? `last week, the week of ${name}` : weeksApart === 1 ? `next week, the week of ${name}` : `the week of ${name}`;
    case "weekend":
      return weeksApart === 0 ? `this weekend, ${name}` : weeksApart === -1 ? `last weekend, ${name}` : weeksApart === 1 ? `next weekend, ${name}` : `the weekend of ${name}`;
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
```

- [ ] **Step 5: Run the tests; fix against chrono's real output**

Run: `pnpm test tests/mind/platform/time-anchors.test.ts tests/mind/platform/config.test.ts`
Expected: PASS. Where chrono's span or certainty differs from what a test assumes, adjust the module's regexes, never a test's expected date, and record each fix as a ruling. Then run `pnpm exec prettier --write` and `pnpm exec eslint` on both files.

- [ ] **Step 6: Replay the corpus (free check)**

```bash
pnpm exec tsx -e '
import fs from "node:fs";
import { anchorTimes, relativeWords } from "./src/mind/platform/time-anchors";
let left = 0, texts = 0;
for (const d of fs.readdirSync("evals/results/traces")) {
  const f = `evals/results/traces/${d}/world-outreach-two-weeks-1-db.json`;
  if (!fs.existsSync(f)) continue;
  const db = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const r of [...db.fact, ...db.core_memory]) {
    texts++;
    const out = anchorTimes(r.content, { at: new Date(r.created_at), zone: "UTC" });
    const words = relativeWords(out.replace(/⟦[^⟧]*⟧/g, ""));
    if (words.length) { left++; if (left <= 20) console.log(words.join(","), "|", out.slice(0, 120)); }
  }
}
console.log({ texts, leftWithRelativeWords: left });
'
```

Expected: leftover relative words in under 3% of texts, each an understood miss. Note the count in the ledger. If the filters drop a real phrase, fix the filter and add the sentence to the tests.

- [ ] **Step 7: Commit**

```bash
git add src/mind/platform/time-anchors.ts src/mind/platform/config.ts config/default.json tests/mind/platform/time-anchors.test.ts tests/mind/platform/config.test.ts
git commit -m "feat(time): one time module: anchors and date tokens, read on any later day"
```

---

### Task 2: One wrapper renders every prompt

**Files:**
- Create: `src/mind/platform/llm/render-net.ts`
- Modify:
  - `src/runtime/deps.ts:60`;
  - `evals/lib/runner.ts:391-400`, plus every later read of `llm.prompts`, `llm.replies` or the core calls;
  - `evals/lib/review.ts` (Final facts lines; import `relativeWords` from the new module).
- Test: `tests/mind/platform/render-net.test.ts` (new), `tests/evals/review.test.ts`

**Interfaces:**
- Consumes: `renderTimes`, `renderAbsolute`, `anchorTimes` (Task 1).
- Produces: `withTimeRendering<T extends LLMProvider>(inner: T, clock: Clock, maxDays: number): T`

- [ ] **Step 1: Write the failing tests**

`tests/mind/platform/render-net.test.ts`:

```ts
/** Every prompt reaches the model with its dates read on the clock's day. */
import { expect, test } from "vitest";
import { z } from "zod";
import { SimClock } from "@/mind/platform/clock";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { withTimeRendering } from "@/mind/platform/llm/render-net";
import { anchorTimes } from "@/mind/platform/time-anchors";

test("reply and structured prompts are rendered at the clock's now; the inner provider records them", async () => {
  const fake = new FakeLLMProvider();
  const llm = withTimeRendering(fake, new SimClock(new Date("2026-01-13T09:00:00Z")), 6);
  const note = anchorTimes("the race was yesterday", { at: new Date("2026-01-12T09:00:00Z"), zone: "UTC" });
  fake.replies.push("ok");
  await llm.generateReply({ system: [{ text: note, cache: true }], messages: [{ role: "user", content: note }] });
  expect(fake.calls[0]!.system).toBe("the race was 2 days ago, Sunday 11 January");
  expect(fake.calls[0]!.messages[0]!.content).toBe("the race was 2 days ago, Sunday 11 January");
  fake.handlers.probe = () => ({ ok: true });
  await llm.classifyJson({
    purpose: "probe",
    system: note,
    input: JSON.stringify({ note }),
    schema: z.object({ ok: z.boolean() }),
    timeoutMs: 1000,
    maxTokens: 10,
  });
  expect(fake.structuredCalls.at(-1)!.input).toContain("2 days ago, Sunday 11 January");
  expect(fake.structuredCalls.at(-1)!.input).not.toContain("⟦");
});
```

In `tests/evals/review.test.ts`, add a case: a final fact whose content is `anchorTimes("Sister visits tomorrow.", { at: new Date("2026-01-12T09:00:00Z"), zone: "UTC" })` shows in the review as "Sister visits Tuesday 13 January 2026.", with no "⟦".

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/platform/render-net.test.ts tests/evals/review.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * Every prompt passes through here on its way to a model: each date token in it is rendered on
 * its own calendar relative to the clock's now, so the model reads dates on the day it reads them
 * and never counts days. Wrapping by delegation keeps the inner provider's own fields reachable.
 */
import type { Clock } from "../clock";
import { renderTimes } from "../time-anchors";
import type { LLMProvider } from "./types";

export function withTimeRendering<T extends LLMProvider>(inner: T, clock: Clock, maxDays: number): T {
  const render = (text: string) => renderTimes(text, clock.now(), maxDays);
  const wrapped = Object.create(inner) as T;
  wrapped.generateReply = (request) =>
    inner.generateReply({
      system: request.system.map((b) => ({ ...b, text: render(b.text) })),
      messages: request.messages.map((m) => ({ ...m, content: render(m.content) })),
    });
  wrapped.classifyJson = (request) =>
    inner.classifyJson({ ...request, system: render(request.system), input: render(request.input) });
  return wrapped;
}
```

Wiring:
- **`src/runtime/deps.ts`:** `llm: withTimeRendering(new AnthropicProvider(new Anthropic(), config.models), systemClock, config.time.relative_max_days)`.
- **`evals/lib/runner.ts`:** keep the recorder as `const recording = new RecordingLLM(…)`, then `const llm = withTimeRendering(recording, clock, config.time.relative_max_days)`. Change every later `llm.prompts`, `llm.replies` and core-call read to `recording.…`, so nothing is assigned or read through the wrapper.
- **`evals/lib/review.ts`:** Final facts lines print `fmt(renderAbsolute(String(f.content ?? "")))`; import `relativeWords` from `@/mind/platform/time-anchors`.
- **Tests keep the bare fake** (they assign `failReplies`, `replyHook`, `classify`). Builder tests assert tokens or render with `renderTimes`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/platform/render-net.test.ts tests/evals`
Expected: PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add src/mind/platform/llm/render-net.ts src/runtime/deps.ts evals/lib tests
git commit -m "feat(time): every prompt reads its dates on the clock's day, in one place"
```

---

### Task 3: The inserts anchor every write

**Files:**
- Modify:
  - `src/db/repos/user/facts.ts:143-150` (`insertFact`);
  - `src/db/repos/core/memory.ts:49` (`coreMemoryRepo`), `:266-274` (`insert`), `:561-568` (`insertSnapshot`);
  - `src/db/repos/core/index.ts`;
  - `src/mind/memory/core/types.ts` (`CoreMemory.insert`);
  - `src/runtime/deps.ts`, `evals/lib/runner.ts`, `src/db/reset-self-cli.ts`: `createCoreLayer(db, config.life.timezone)`.
- Test: `tests/db/user-mind-repos.test.ts`, `tests/db/core-repos.test.ts`

**Interfaces:**
- Consumes: `anchorTimes`, `anchorFields`, `AnchorHints` (Task 1); `getTimezone` (`src/db/repos/user/users.ts`); `zoneOrUtc`.
- Produces:
  - `insertFact(db, userId, row, hints?: AnchorHints)`
  - `CoreMemory.insert(item, hints?: AnchorHints)`
  - `createCoreLayer(db, zone = "UTC")`, `coreMemoryRepo(db, zone = "UTC")`

- [ ] **Step 1: Write the failing tests**

In `tests/db/user-mind-repos.test.ts`:

```ts
import { renderTimes, tokenDates } from "@/mind/platform/time-anchors";

const summaryRow = (content: string, at: Date) => ({
  subject: "shared" as const,
  kind: "summary" as const,
  content,
  payload: { whats_live: content, sensitive: true },
  embedding: vec(),
  created_at: at,
  status: "open" as const,
  salience: 0.5,
  valence: 0,
  confidence: 0.6,
  source: "generated" as const,
});

test("insertFact anchors content and payload strings in the user's zone; no or a bad zone is UTC", async () => {
  const u = await createTestUser();
  const at = new Date("2026-01-12T23:30:00Z"); // Monday 23:30 UTC, Tuesday 07:30 in Singapore
  const utc = await insertFact(getTestDb(), u, summaryRow("Sister visits tomorrow.", at));
  expect(tokenDates(utc.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-13");
  expect((utc.payload as { whats_live: string }).whats_live).toBe(utc.content);
  expect((utc.payload as { sensitive: boolean }).sensitive).toBe(true);
  await setTimezone(getTestDb(), u, "Asia/Singapore");
  const sg = await insertFact(getTestDb(), u, summaryRow("Sister visits tomorrow.", at));
  expect(renderTimes(sg.content, at, 6)).toBe("Sister visits tomorrow, Wednesday 14 January.");
  await setTimezone(getTestDb(), u, "Mars/Olympus");
  const bad = await insertFact(getTestDb(), u, summaryRow("Sister visits tomorrow.", at));
  expect(tokenDates(bad.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-13");
});

test("insertFact takes hints: a weekday matches a shown date", async () => {
  const u = await createTestUser();
  const row = await insertFact(
    getTestDb(),
    u,
    summaryRow("Race Sunday.", new Date("2026-01-14T09:00:00Z")), // Wednesday
    { known: [new Date("2026-01-11T08:00:00Z")] },
  );
  expect(tokenDates(row.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-11");
});
```

Use `setTimezone` as written in `users.ts`. If it rejects an invalid zone, write the bad zone with a direct `db.update(user)`.

In `tests/db/core-repos.test.ts`:
- `createCoreLayer(getTestDb(), "Asia/Singapore")` inserts "Clear skies tonight." at `2026-01-12T15:30:00Z`, and `renderTimes(content, new Date("2026-01-12T17:00:00Z"), 6)` is "Clear skies last night, Monday 12 January.".
- A snapshot with "tonight" in its content is stored with one token.

Copy the insert fields from an existing insert in that file.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/db/user-mind-repos.test.ts tests/db/core-repos.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`facts.ts`:

```ts
/**
 * Stored text keeps the date each time phrase meant: content and a summary's or read's parts are
 * anchored from the moment written, in the user's zone, so they read right on any later day.
 */
export async function insertFact(
  db: Db,
  userId: string,
  row: NewFact,
  hints: AnchorHints = {},
): Promise<FactRow> {
  const ctx = { at: row.created_at as Date, zone: zoneOrUtc(await getTimezone(db, userId)), ...hints };
  return one(
    await db
      .insert(fact)
      .values({
        ...row,
        content: anchorTimes(row.content, ctx),
        payload: anchorFields(row.payload, ctx),
        user_id: userId,
      })
      .returning(),
  );
}
```

Imports: `anchorFields`, `anchorTimes`, `type AnchorHints`; `zoneOrUtc`; `getTimezone` from `./users`. If ESLint forbids `src/db` importing `@/mind/platform/time-anchors`, stop and record a ruling. Other repos already import `@/mind/platform/core` types, so a pure platform module should be allowed.

`core/memory.ts`: `export function coreMemoryRepo(db: Db, zone = "UTC"): CoreMemory`:
- `insert(item, hints = {})` anchors `item.content` with `{ at: item.created_at, zone, ...hints }`;
- `insertSnapshot` anchors `content` and `anchorFields(sections)` with `{ at: snapshot.rendered_at, zone }`.

`types.ts`: `insert(item: NewCoreMemory, hints?: AnchorHints): Promise<string>;`.

`core/index.ts`:

```ts
/** `zone` is her life zone: what she writes is anchored on her calendar. */
export function createCoreLayer(db: Db, zone = "UTC"): CoreLayer {
  return { ...scope(db, zone), transaction: (fn) => db.transaction((tx) => fn(scope(tx, zone))) };
}
```

`scope(db, zone)` passes the zone to `coreMemoryRepo`. Callers pass `config.life.timezone`; tests keep UTC; `inspector-core.ts` keeps `coreMemoryRepo(db)` (read-only).

- [ ] **Step 4: Run the repo and memory tests**

Run: `pnpm test tests/db tests/mind/memory`
Expected: PASS. A test that compared stored content with input text holding "tomorrow" or "tonight" now asserts the token's date (`tokenDates`) or `renderAbsolute(content)`. That's the new behaviour; never loosen it to `expect.any`.

- [ ] **Step 5: Commit**

```bash
git add src/db src/mind/memory/core/types.ts src/runtime/deps.ts evals/lib/runner.ts tests
git commit -m "feat(time): every stored fact and memory keeps the date its time words meant"
```

---

### Task 4: Builders place tokens; `relative-date.ts` goes

**Files:** every remaining caller of `relative-date.ts`, `guardNow`, and `formatLocal` used for "now":
- `src/mind/process/hot-path/compose.ts`:
  - `renderReachOut` notes;
  - summary and read `written`;
  - ideas without a stamp;
  - the snapshot `stamped`;
  - the guard's `now`;
  - `guardFacts`;
  - `loadRelationshipLine`.
- `src/mind/process/hot-path/assemble.ts`:
  - `factList` / `memorySection` (zones per owner);
  - `relationshipLine`;
  - `AssembleInput` gains `userTimezone` and `nowLine`, and a `## Now` section.
- `src/mind/process/user/inputs.ts`: `memoryLines`, `stampedNote`, `threadLines`, with `now` parameters dropped.
- `src/mind/process/user/{summarise,reflect,model,ideate,run}.ts`: `now: nowLine(...)`; `written`; `stamped`.
- `src/mind/memory/core/self.ts`: `latestSelf(memory, seedSelf, zone)` with no `now`.
- Callers of `latestSelf` (`src/mind/process/core/{anticipate,appraise,resolve,ruminate,wander}.ts`, `src/mind/world/events.ts`) and `stamped` (`src/mind/process/core/{reflect,render-snapshot}.ts`).
- Her loops' dated inputs:
  - `wander.ts` `dated()`;
  - the `ruminate.ts` episode;
  - the `reflect.ts` inputs' `when`;
  - `anticipate.ts`'s "When:" (`dateToken(at, tz, "time")`);
  - the `events.ts` episodes.
- Every `noteRelativeWords` call: `src/mind/process/{user/*,core/thoughts,core/appraise,core/reflect,core/render-snapshot,cold-path/cold-path}.ts`.
- `src/mind/process/guard/guard.ts`: delete `guardNow`.
- **Delete** `src/mind/platform/relative-date.ts` and `tests/mind/platform/relative-date.test.ts`. Their cases are already ported in Task 1.
- `src/mind/memory/shared/types.ts`, `src/mind/memory/{user,core}/retrieve.ts`: delete `RetrievedFact.noted`.
- Tests:
  - `tests/mind/process/hot-path/{assemble,compose}.test.ts`;
  - `tests/mind/process/user/{summarise,ideate,model,run}.test.ts`;
  - `tests/mind/process/guard/guard.test.ts`;
  - `tests/mind/memory/core/self.test.ts`;
  - `tests/mind/process/core/{anticipate,wander}.test.ts`;
  - `tests/exit/phase-16.test.ts`, `tests/exit/phase-15c.test.ts`.

**Interfaces:**
- Consumes: `dateToken`, `ownDate`, `written`, `stamped`, `nowLine` (Task 1).
- Produces:
  - `memoryLines(facts, tz)`, `stampedNote(row, tz)`, `threadLines(threads, tz)`, with no `now`;
  - `latestSelf(memory, seedSelf, zone)`;
  - `assemblePrompt` input fields `userTimezone: string` and `nowLine?: string | null`;
  - `guardFacts(retrieval, core, theirZone, herZone)`.

- [ ] **Step 1: Update the tests to the token behaviour (they fail first)**

A builder now places tokens. Each test that asserted a rendered date wraps the prompt in `renderTimes(text, now, 6)` and expects the new comma style ("yesterday, Sunday 11 January"). Concretely:
- **`assemble.test.ts`:** factList expectations become `"- Race day. (today)"` style after `renderTimes(system, now, 6)`. Add the owner's-calendar test:

  ```ts
  test("their things are dated on their calendar, hers on hers, under a Now line", () => {
    const now = new Date("2026-01-12T17:00:00Z"); // Monday 17:00 London, Tuesday 01:00 Singapore
    const { system } = assemblePrompt({
      ...base,
      now,
      timezone: "Asia/Singapore",
      userTimezone: "Europe/London",
      nowLine: "It's Monday 12 January, 17:00 where they are; Tuesday 13 January, 01:00 for you.",
      recentTurns: [],
      retrieval: { ...emptyRetrieval(), facts: { user: [{ id: "u", content: "Race day.", when: new Date("2026-01-12T09:00:00Z") }], self: [], shared: [] } },
      coreMemories: [{ id: "c", content: "Telescope night.", when: new Date("2026-01-12T14:00:00Z") }],
    });
    const seen = renderTimes(system, now, 6);
    expect(seen).toContain("## Now\nIt's Monday 12 January, 17:00 where they are");
    expect(seen).toContain("- Race day. (today)");
    expect(seen).toContain("- Telescope night. (yesterday, Monday 12 January)");
  });

  test("a memory whose words carry its date isn't dated twice", () => {
    const now = new Date("2026-01-12T09:00:00Z");
    const content = anchorTimes("The race is tomorrow.", { at: now, zone: "UTC" });
    const { system } = assemblePrompt({
      ...base, now, timezone: "UTC", userTimezone: "UTC", recentTurns: [],
      retrieval: { ...emptyRetrieval(), facts: { user: [{ id: "u", content, when: now }], self: [], shared: [] } },
    });
    expect(renderTimes(system, now, 6)).toContain("- The race is tomorrow, Tuesday 13 January.\n");
  });
  ```

  `base` gains `userTimezone: "UTC"`.
- **`compose.test.ts`:** the summary-written and snapshot-stamp tests render `deps.llm.calls.at(-1)!.system` with `renderTimes(…, deps.clock.now(), 6)` before matching. Keep the two-user snapshot test: the raw first blocks are still identical, since tokens are the same for every user.
- **`guard.test.ts`:** replace the `guardNow` test with nothing (`nowLine` is tested in Task 1). The remembered-facts test passes `when: dateToken(...)` and checks the rendered input.
- **`self.test.ts`:** `latestSelf(memory, "SEED", "UTC")`; render before comparing ("(written yesterday, Wednesday 14 January)…").
- **User-mind tests:** `input.now` matches `/^It's \w+ \d+ \w+, \d{2}:\d{2}/`; memory `when` and note `written` are tokens; render them before comparing.
- **`exit/phase-16.test.ts` test 1** (day counts): rewrite with `renderTimes(dateToken(…), now, 6)` for the same four instants, with the new-style strings. `phase-15c.test.ts`: replace its relative-date import the same way. **`phase-15d.test.ts` test 3** (the reason carries its dates): render the `renderReachOut` reason with `renderTimes` before matching, with the new-style strings.
- **Core anticipate and wander tests:** render the captured input before the regex, e.g. `/When: (today|in \d+ days|tomorrow), \w+ \d+ \w+ at \d{2}:\d{2}/`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/process/hot-path tests/mind/process/user tests/mind/process/guard tests/mind/memory/core tests/mind/process/core tests/exit/phase-16.test.ts tests/exit/phase-15c.test.ts`
Expected: FAIL, because the builders still render with `relative-date.ts`.

- [ ] **Step 3: Convert the builders (the pattern, then the list)**

The pattern for every call site: replace `<render>(at, now, tz)` with a token placed in the owner's zone, and drop the `now` that existed only for rendering.

| Old | New |
|---|---|
| `dayInWords(at, now, tz)` | `dateToken(at, tz)` |
| `relativeDate(at, now, tz)` | `dateToken(at, tz)` |
| `itemWhen(when, noted, now, tz)` | `ownDate(content, when, tz)`: append `(${d})` only when it's non-null |
| `writtenOn(at, now, tz)` | `written(at, tz)` |
| `stamped(text, at, now, tz)` | `stamped(text, at, tz)` |
| `formatLocal(now, tz)` as a loop's `now` | `nowLine(now, zoneOrUtc(tz), lifeTimezone(config.life, now))` |
| `guardNow(now, theirs, hers)` | `nowLine(now, theirs, hers, "where Spica is")` |
| `` `When: ${dayInWords(at,…)} at ${localTime(at,…)}` `` | `` `When: ${dateToken(event.at, tz, "time")}` `` |

Per file:
- **`assemble.ts`:**
  - `factList(title, facts, zone)` builds `` `- ${f.content}${d ? ` (${d})` : ""}${onMind}${tail}` `` with `d = ownDate(f.content, f.when, zone)`;
  - in `memorySection`, "About them", "Between you" and "What you've told them" use `input.userTimezone`, and "From your own life" uses `input.timezone`;
  - add `section("Now", input.nowLine ?? null)` first in the uncached sections;
  - `relationshipLine(stats, zone)` writes `` `You first talked ${dateToken(stats.first, zone)}, …` ``;
  - remove the `relative-date` import.
- **`compose.ts`:**
  - compute `const theirZone = await userZone(deps, userId)` beside `herZone`;
  - summary and read `written: written(row!.created_at, theirZone)`;
  - ideas `shownIdeas.map((i) => i.content)`;
  - `snapshot: stamped(snapshotWithin(...), latestSnapshot.rendered_at, herZone)`;
  - `assemblePrompt({ …, userTimezone: theirZone, nowLine: nowLine(clock.now(), theirZone, herZone) })`;
  - guard `now: nowLine(clock.now(), theirZone, herZone, "where Spica is")`;
  - `guardFacts(retrieval, herMemories, theirZone, herZone)` gives `when: ownDate(f.content, f.when, zone) ?? undefined`, with core in `herZone`;
  - `renderReachOut` notes: `const when = n.dated ? dateToken(at, tz) : \`they told you ${dateToken(at, tz)}\``;
  - `loadRelationshipLine` passes `tz` only.
- **`inputs.ts`:**
  - `memoryLines(facts, tz)`: `when: ownDate(content, occurred_at, zoneOrUtc(tz))`;
  - `stampedNote(row, tz)`: `written: written(row.created_at, zoneOrUtc(tz))`;
  - `threadLines(threads, tz)`: `` `${t.title} (next: ${dateToken(t.next_checkpoint, zone)})` ``.
- **The four loops and `run.ts`:**
  - `now: nowLine(…)`;
  - `written(...)` instead of `writtenOn`;
  - `run.ts` uses `stamped(latest.content, latest.rendered_at, lifeTimezone(config.life, now))`;
  - drop the `now` arguments to the helpers above.
- **`self.ts`:** `latestSelf(memory, seedSelf, zone)` uses `stamped(snapshot.content, snapshot.rendered_at, zone)`. Callers drop `now`.
- **Core inputs:**
  - `wander` uses `` `${m.content} (${dateToken(m.occurred_at ?? m.created_at, tz)})` ``;
  - `ruminate` writes the episode as `` `… (${dateToken(…)})` ``;
  - `reflect` uses `when: dateToken(occurred_at ?? created_at, tz)`;
  - `events.ts` uses `` `(${dateToken(e.when, tz)})` ``.
- **`noteRelativeWords`:** delete every call and import. Anchoring at insert replaces logging.
- **`retrieve.ts` (user and core) and `shared/types.ts`:** delete `noted`.
- **`guard.ts`:** delete `guardNow`.
- **Finally:** `git rm src/mind/platform/relative-date.ts tests/mind/platform/relative-date.test.ts`.

- [ ] **Step 4: Run the tests; check nothing renders dates outside the module**

Run: `pnpm test tests/mind tests/exit/phase-16.test.ts tests/exit/phase-15c.test.ts tests/exit/phase-15d.test.ts`
Expected: PASS.

Run: `git grep -nE "relativeDate|dayInWords|itemWhen|writtenOn|guardNow|noteRelativeWords|relative-date" -- src tests evals`
Expected: no output.

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "refactor(time): builders place date tokens on their owner's calendar; one renderer, relative-date goes"
```

---

### Task 5: Extract dates from the message's own time

**Files:**
- Modify: `src/mind/memory/user/extract.ts`:
  - `FactSchema` drops `occurred_at` and `when`, adds `when_direction`;
  - the thread schema drops `next_checkpoint`;
  - `normalizeExtraction` no longer parses dates;
  - `parseDate` is deleted if unused;
  - `ExtractedFact` drops `when`;
  - the `applyWhen` call becomes `anchorExtraction`.
- Modify: `src/mind/memory/user/hurt.ts` if typecheck flags `when`.
- Delete: `src/mind/memory/user/when.ts`, `tests/mind/memory/user/when.test.ts` (its cases live in Task 1's tests).
- Create: `prompts/extract/v10.md` (`git mv` from v9); config `prompts.extract` → `"v10"`.
- Modify: `src/mind/platform/llm/fake.ts` (the extract handler) only if typecheck requires it. Zod drops unknown keys.
- Test: `tests/mind/memory/user/extract.test.ts`, plus whichever test imported `applyWhen` or `resolveWhen`.

**Interfaces:**
- Consumes: `anchorTimes`, `isSingleToken`, `tokenDates` (Task 1).
- Produces: `anchorExtraction(extraction: Extraction, turns: { role: string; text: string; created_at: Date }[], zone: string, log?: Logger): Extraction`, exported. Facts carry `when_direction`; `occurred_at` is the fact's first anchor; a thread's `next_checkpoint` is its `checkpoint_when` anchored ahead.

- [ ] **Step 1: Write the failing tests**

```ts
import { anchorExtraction } from "@/mind/memory/user/extract";
import { tokenDates } from "@/mind/platform/time-anchors";

const sent = new Date("2026-01-12T09:00:00Z"); // Monday
const user = (text: string) => ({ role: "user", text, created_at: sent });
const fact = (content: string, when_direction: "past" | "upcoming" | null) => ({
  subject: "user" as const,
  kind: "event" as const,
  content,
  occurred_at: null,
  when_direction,
  salience: 0.7,
  valence: 0,
  confidence: 0.9,
  entity_names: [],
  thread_title: null,
  claim_kind: null,
  idiolect_type: null,
  started_by: null,
});
const extraction = (facts: unknown[], threads: unknown[] = []) =>
  ({ facts, entities: [], threads, relationship: null, intimacy: null, bid: null }) as never;
const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;

test("a fact's time words are anchored at the message's send time, in the labelled direction", () => {
  const out = anchorExtraction(
    extraction([fact("The user finished the task over the weekend.", "past"), fact("The user runs a half marathon on Sunday morning.", "upcoming")]),
    [user("finished it over the weekend! race on sunday morning")],
    "UTC",
  );
  expect(day(out.facts[0]!.occurred_at)).toBe("2026-01-10");
  expect(day(out.facts[1]!.occurred_at)).toBe("2026-01-18");
});

test("a weekday the message never named takes the one it did, in the fact's own direction", () => {
  const out = anchorExtraction(
    extraction([fact("The user has an interview on Friday.", "upcoming")]),
    [user("interview is on thursday, nervous")],
    "UTC",
  );
  expect(day(out.facts[0]!.occurred_at)).toBe("2026-01-15");
});

test("the cross-check leaves a fact alone when the message names two weekdays, and never moves a right past date", () => {
  const two = anchorExtraction(
    extraction([fact("The user has an interview on Friday.", "upcoming")]),
    [user("thursday is the interview, saturday the party")],
    "UTC",
  );
  expect(day(two.facts[0]!.occurred_at)).toBe("2026-01-16");
  const past = anchorExtraction(
    extraction([fact("The user finished the task on Saturday.", "past")]),
    [user("I finished it on saturday")],
    "UTC",
  );
  expect(day(past.facts[0]!.occurred_at)).toBe("2026-01-10");
});

test("a thread's check-in words are always ahead", () => {
  const out = anchorExtraction(
    extraction([], [{ action: "open", title: "race", subject: "user", stakes: "med", checkpoint_when: "sunday evening", thread_id: null }]),
    [user("race sunday")],
    "UTC",
  );
  expect(out.threads[0]!.next_checkpoint!.toISOString()).toBe("2026-01-18T19:00:00.000Z");
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/memory/user/extract.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`FactSchema`:
- delete `occurred_at` and `when`;
- add `when_direction: z.enum(["past", "upcoming"]).nullable().default(null),` with the comment "Which way the fact's time words point; code dates them. Fixtures without it read as null.";
- in the thread schema, delete `next_checkpoint`.

`normalizeExtraction`: facts get `occurred_at: null`, threads get `next_checkpoint: null`; delete the `parseDate` uses and the function if nothing else uses it. `ExtractedFact` loses `when`, and its `Omit` list loses `"when"`. `ExtractedThread` keeps `next_checkpoint: Date | null` and `checkpoint_when`.

Then:

```ts
const WEEKDAY_WORD = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const weekdaysIn = (text: string) => new Set([...text.matchAll(WEEKDAY_WORD)].map((m) => m[1]!.toLowerCase()));

/**
 * Dates each fact from the moment its message was sent, in their zone, pointing the way extract
 * labelled it; the model never works out a date. When their message names exactly one weekday and
 * a fact names a different one, the fact takes theirs: a copied weekday ("friday" for their
 * "thursday"), corrected by name so a right past date is never moved.
 */
export function anchorExtraction(
  extraction: Extraction,
  turns: { role: string; text: string; created_at: Date }[],
  zone: string,
  log?: Logger,
): Extraction {
  const said = turns.filter((t) => t.role === "user");
  const at = said.at(-1)?.created_at ?? turns.at(-1)?.created_at ?? new Date(0);
  const theirs = weekdaysIn(said.map((t) => t.text).join(" "));
  const facts = extraction.facts.map((f) => {
    let content = f.content;
    const own = weekdaysIn(content);
    if (theirs.size === 1 && own.size === 1 && !theirs.has([...own][0]!)) {
      const [from, to] = [[...own][0]!, [...theirs][0]!];
      log?.info("extract weekday taken from their message", { from, to });
      content = content.replace(new RegExp(`\\b${from}\\b`, "i"), to[0]!.toUpperCase() + to.slice(1));
    }
    content = anchorTimes(content, { at, zone, direction: f.when_direction ?? null });
    return { ...f, content, occurred_at: tokenDates(content)[0] ?? null };
  });
  const threads = extraction.threads.map((t) => {
    const slot = t.checkpoint_when ? anchorTimes(t.checkpoint_when, { at, zone, direction: "upcoming" }) : null;
    return { ...t, next_checkpoint: slot && isSingleToken(slot) ? tokenDates(slot)[0]! : null };
  });
  return { ...extraction, facts, threads };
}
```

`new RegExp(…)` with backslashes is fine in the source file; write it with the Edit/Write tool. In `extract`, replace the `applyWhen` return with `anchorExtraction(normalizeExtraction(raw, config.extraction.max_candidates), args.newTurns, zone, deps.log)`; add `"log"` to the deps `Pick` if missing; remove the `ref` computation and the `applyWhen` import. Then `git rm src/mind/memory/user/when.ts tests/mind/memory/user/when.test.ts`.

`prompts/extract/v10.md` (from v9):
- the "Times:" bullet becomes: `- Times: keep the time words as said in the content ("The user starts a new job at a bakery next monday", "The user finished the task over the weekend"); never work out a date yourself: code dates them from when the message was sent.`
- the `occurred_at` bullet is replaced by: `- when_direction: "past" when the fact's time words point to something that already happened, "upcoming" when it's still ahead, null when there are none.`
- any mention of `when`, `{when}` or a thread `next_checkpoint` field is deleted (keep `checkpoint_when`).

Config `"extract": "v10"`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/memory/user tests/mind/process/cold-path tests/mind/platform/prompts.test.ts tests/evals`
Expected: PASS. Fixtures with `when` or `{when}` change to natural time words, and their expected content becomes `renderAbsolute(content)` against the same day.

- [ ] **Step 5: Commit**

```bash
git add -A src/mind/memory/user src/mind/platform/llm/fake.ts prompts/extract config/default.json tests
git commit -m "feat(extract): facts keep their time words, dated from the message's own time and labelled past or upcoming"
```

---

### Task 6: Writers use the dates they were shown

**Files:**
- Modify: `src/mind/process/user/inputs.ts` (add `shownDates`), `summarise.ts`, `reflect.ts`, `model.ts`, `ideate.ts`, `consolidate.ts`
- Modify: `src/mind/process/core/render-snapshot.ts` (anchor item texts once, before content and lines)
- Create: `prompts/user-mind/{summarise,reflect,model}/v5.md`, `ideate/v7.md`, `prompts/core/{appraise,anticipate,ruminate,wander,reflect,snapshot}/v4.md` (each by `git mv`); config bumps
- Test: `tests/mind/process/user/{summarise,ideate}.test.ts`, `tests/mind/process/core/render-snapshot.test.ts`

**Interfaces:**
- Consumes: `insertFact(…, hints)` (Task 3); `anchorTimes`, `tokenDates` (Task 1).
- Produces: `shownDates(facts: { occurred_at: Date | null }[], threads: { next_checkpoint: Date | null }[], texts: (string | null | undefined)[]): Date[]`

- [ ] **Step 1: Write the failing tests**

`summarise.test.ts` (reuse `setup`, `run` and `insertFact`):

```ts
test("a weekday in the summary takes the date of the memory it was shown", async () => {
  const { deps, userId, run } = await setup();
  const race = new Date(deps.clock.now().getTime() + 6 * 86_400_000); // the coming Sunday
  await insertFact(deps.db, userId, {
    subject: "user", kind: "event", content: "The user runs a half marathon.", embedding: vec(),
    created_at: deps.clock.now(), occurred_at: race, status: "open", salience: 0.8, valence: 0.3,
    confidence: 0.9, source: "turn",
  });
  deps.llm.handlers.user_summarise = () => ({ where_things_stand: "Fine.", whats_live: "The race Sunday.", how_i_feel: "Glad." });
  await userSummarise(deps, await run("exchange:w"), await loadRunInputs(deps, userId));
  const live = (await liveSummary(deps.db, userId))!;
  expect(tokenDates((live.payload as { whats_live: string }).whats_live)[0]!.toISOString().slice(0, 10)).toBe(race.toISOString().slice(0, 10));
});
```

`ideate.test.ts`: an idea "Ask how tonight's gig goes." written with no dated sources gets `stale_after` at the end of today, from its own anchor, not three days.

`render-snapshot.test.ts`: a Lately line "Telescope booking tonight." is stored as a token in the content, and its self line is the identical string.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/process/user/summarise.test.ts tests/mind/process/user/ideate.test.ts tests/mind/process/core/render-snapshot.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`inputs.ts`:

```ts
/** The dates a loop was shown, so a weekday it writes takes the day it saw. */
export function shownDates(
  facts: { occurred_at: Date | null }[],
  threads: { next_checkpoint: Date | null }[],
  texts: (string | null | undefined)[],
): Date[] {
  return [
    ...facts.flatMap((f) => (f.occurred_at ? [f.occurred_at] : [])),
    ...threads.flatMap((t) => (t.next_checkpoint ? [t.next_checkpoint] : [])),
    ...texts.flatMap((t) => (t ? tokenDates(t) : [])),
  ];
}
```

Every `insertFact` in the loops gets `{ known }`:
- **summarise:** `shownDates(facts, threads, [previous?.content])`.
- **reflect:** `shownDates(inputs.facts, [], [summary?.content])`.
- **model** (both inserts): `shownDates(inputs.facts, [], [summary?.content, previous?.content, noticed?.content])`.
- **ideate:** `shownDates(facts, threads, [summary?.content, readRow?.content])`, and the idea's own dates join its sources for `stale_after`:

  ```ts
      const own = tokenDates(anchorTimes(out.idea, { at: now, zone: zoneOrUtc(inputs.timezone), known }));
      // ideaStaleAfter's dates:
      [...facts.filter((f) => from.includes(f.id)).map((f) => f.occurred_at!), ...own],
  ```

- **consolidate:** the group's source dates.

`render-snapshot.ts`, right after `kept`:

```ts
    // Anchored once here, so the snapshot's text and its self lines stay the same strings.
    const zone = lifeTimezone(config.life, now);
    for (const items of Object.values(kept))
      for (const item of items) item.text = anchorTimes(item.text, { at: now, zone });
```

Prompts (each by `git mv`, then edit):
- **User-mind (summarise v5, reflect v5, model v5, ideate v7):**
  - the `now` description becomes "`now` (the current time where they are, and where you are when it differs)";
  - the bullet forbidding today/tonight/tomorrow/yesterday/this week becomes `- When you mention a day, copy its date as you see it; what you write is dated for you.`;
  - ideate keeps its example: `("ask how the interview on Thursday 8 January went")`.
- **Core (appraise, anticipate, ruminate, wander, reflect v4):** the "Dates:" paragraph becomes `Dates: the input gives days with how far they are from now ("Friday 9 January, in 2 days"); never count days yourself. When you mention a day, copy its date as you see it; what you write is dated for you.`
- **Snapshot v4:** `The previous snapshot starts with the day it was written. When a line mentions a day, copy its date as you see it; what you write is dated for you.`

Config: `user_summarise` v5, `user_reflect` v5, `user_model` v5, `user_ideate` v7, and the six `core_*` keys v4.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/process/user tests/mind/process/core tests/mind/platform/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/mind/process/user src/mind/process/core/render-snapshot.ts prompts/user-mind prompts/core config/default.json tests
git commit -m "feat(time): writers use the dates they were shown; her snapshot lines keep theirs"
```

---

### Task 7: Her view of the conversation, from each message's timestamp

**Files:**
- Modify: `src/mind/process/hot-path/assemble.ts`:
  - add the exported `viewTurns`;
  - `conversationMessages` uses it;
  - delete the gap marker, `elapsed()` and `gapMarkerMinHours`.
- Modify: `src/mind/process/hot-path/compose.ts`: the guard's `recentTurns` go through `viewTurns`; stop passing `gapMarkerMinHours`.
- Test: `tests/mind/process/hot-path/{assemble,compose}.test.ts`

**Interfaces:**
- Consumes: `anchorTimes` (said mode), `dateToken`, `renderTimes` (tests).
- Produces: `viewTurns(turns: { text: string; created_at?: Date }[], now: Date, zone: string): string[]`

- [ ] **Step 1: Write the failing test**

```ts
test("older messages get a day divider and glosses from their own send time; today's read as typed", () => {
  const now = new Date("2026-01-13T09:00:00Z"); // Tuesday
  const texts = viewTurns(
    [
      { text: "my race is tomorrow", created_at: new Date("2026-01-12T20:00:00Z") },
      { text: "today was rough", created_at: new Date("2026-01-12T20:05:00Z") },
      { text: "morning! race is today", created_at: new Date("2026-01-13T08:50:00Z") },
    ],
    now,
    "UTC",
  ).map((t) => renderTimes(t, now, 6));
  expect(texts[0]).toBe("— yesterday, Monday 12 January —\nmy race is tomorrow (that's today)");
  expect(texts[1]).toBe("today was rough (that's yesterday, Monday 12 January)");
  expect(texts[2]).toBe("— today —\nmorning! race is today");
});
```

Update any assemble or compose test asserting "[N days later]" to the divider.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm test tests/mind/process/hot-path/assemble.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * Her view of the conversation: a divider wherever the date changes, and each time word in a
 * message from an earlier day kept with what it means now, worked out from that message's own
 * send time. Messages from today read exactly as typed. The stored transcript is never changed.
 */
export function viewTurns(
  turns: { text: string; created_at?: Date }[],
  now: Date,
  zone: string,
): string[] {
  const today = localDateString(now, zone);
  let lastDay: string | null = null;
  return turns.map((t) => {
    if (!t.created_at) return t.text;
    const day = localDateString(t.created_at, zone);
    const divider =
      day !== lastDay && !(lastDay === null && day === today) ? `— ${dateToken(t.created_at, zone)} —\n` : "";
    lastDay = day;
    const text = day === today ? t.text : anchorTimes(t.text, { at: t.created_at, zone, said: true });
    return `${divider}${text}`;
  });
}
```

`conversationMessages`:
- compute `const texts = viewTurns(turns, input.now, input.userTimezone)` and use `content: texts[i]!`;
- delete the `gapHours` and `marked` branch and `elapsed()`;
- remove `gapMarkerMinHours` from `AssembleInput` and from compose.

In compose, the guard gets `recentTurns: viewTurns(recent, clock.now(), theirZone).map((text, i) => ({ role: recent[i]!.role, text, at: recent[i]!.created_at }))`. The `## Now` section stays as Task 4 left it.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/process/hot-path tests/mind/process/guard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/hot-path tests
git commit -m "feat(time): her view of the conversation dates each day and glosses older messages from their own time"
```

---

### Task 8: Reach-outs: framing, and a wrong day drops them

**Files:**
- Modify: `src/mind/process/outreach/candidates.ts` (export `eventDay`), `src/mind/process/hot-path/compose.ts` (`renderReachOut` framing), `src/mind/process/outreach/send.ts` (drop on empty text)
- Modify: `src/mind/process/guard/categories.ts` (`wrong_day`), `src/mind/process/guard/outgoing.ts`
- Modify: `src/db/schema.ts` (`guardOutcome` adds `"dropped"`), plus a migration from `pnpm db:generate`
- Create: `prompts/reach-out/v4.md`, `prompts/guard/v7.md` (each by `git mv`); config bumps
- Modify: `evals/guard/reach-out-dates.yaml`, `evals/guard/in-person.yaml`
- Test: `tests/mind/process/hot-path/compose.test.ts`, `tests/mind/process/guard/outgoing.test.ts`, `tests/mind/process/outreach/send.test.ts`

**Interfaces:**
- Consumes: `dateToken`, `renderTimes` (Task 1).
- Produces: `eventDay(notes: Note[]): Date | null`, guard category `wrong_day`, guard outcome `dropped`.

- [ ] **Step 1: Write the failing tests**

`compose.test.ts`:

```ts
test("a reach-out about their thing says whether it's ahead, today or over", () => {
  const md = loadPrompt("reach-out", loadConfig().prompts.reach_out);
  const now = new Date("2026-01-05T12:00:00Z"); // Monday
  const trigger = (iso: string) => ({
    kind: "thread" as const, text: "interview", factId: null, threadId: "t", coreMemoryId: null,
    notes: [{ text: "The user has an interview.", at: iso, dated: true }],
  });
  const zones = { hers: "UTC", theirs: "UTC" };
  const slot = (iso: string) => renderTimes(renderReachOut(md, trigger(iso), now, zones).slot, now, 6);
  expect(slot("2026-01-08T10:00:00Z")).toContain("It's in 3 days, Thursday 8 January: it hasn't happened yet");
  expect(slot("2026-01-05T15:00:00Z")).toContain("It's today");
  expect(slot("2026-01-04T10:00:00Z")).toContain("It was yesterday, Sunday 4 January: it's over");
});
```

`outgoing.test.ts`, following the file's scripted-verdict pattern:
- a `reach_out` whose verdict is `{ ok: false, violations: [{ category: "wrong_day", claim: "x" }] }` returns `text: ""` and `outcome: "dropped"`;
- a `reply` with the same verdict returns its draft and `sent_with_violation`.

`send.test.ts`: with the guard handler scripted to return `wrong_day` for the reach-out, `runReachOutSend` returns "dropped", the log's `gate_results.dropped` is "wrong_day", and no turn is written.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/process/hot-path/compose.test.ts tests/mind/process/guard/outgoing.test.ts tests/mind/process/outreach/send.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`candidates.ts`:

```ts
/** The day a topic is about: its latest dated note; null when nothing behind it is dated. */
export function eventDay(notes: Note[]): Date | null {
  const dated = notes.filter((n) => n.dated).map((n) => new Date(n.at).getTime());
  return dated.length ? new Date(Math.max(...dated)) : null;
}
```

`renderReachOut`: after the notes, replace the `guidance` line with:

```ts
  // Their own things get the day's status from code, so she never asks how a coming thing went.
  const at = ["thread", "user_event", "user_idea"].includes(trigger.kind) ? eventDay(trigger.notes ?? []) : null;
  const status = !at
    ? null
    : localDateString(at, tz) === localDateString(now, tz)
      ? "today"
      : at > now ? "ahead" : "past";
  const framing = status ? (phrases[status] ?? []).map((l) => l.replace("{{day}}", () => dateToken(at!, tz))) : [];
  const guidance = [...(phrases[trigger.kind] ?? []), ...framing].join(" ");
```

`prompts/reach-out/v4.md` (from v3):
- the `## thread` line becomes "- Something they told you about has reached the point where you'd naturally ask about it.";
- append:

```
## ahead
- It's {{day}}: it hasn't happened yet. Ask how they're feeling about it or wish them luck; don't ask how it went.

## today
- It's today.

## past
- It was {{day}}: it's over. Ask how it went.
```

`categories.ts`: add `"wrong_day"` to `HONESTY_CATEGORIES`, and say in the header that a wrong day on a reach-out drops it.

`outgoing.ts`, before the final `return hasSafety(...)`:

```ts
  // Writing first is optional: a reach-out with the day wrong isn't sent at all.
  if (args.input.kind === "reach_out" && verdict.violations.some((v) => v.category === "wrong_day"))
    return send("", "dropped");
```

`schema.ts`: `guardOutcome` gains `"dropped"`. Then run `pnpm db:generate`; the generated SQL adds the enum value.

`send.ts`, right after `composed = await composeReachOut(...)`:

```ts
    // The guard drops a reach-out with the day wrong; nothing goes out.
    if (!composed.text) {
      await composed.writeGuardLog();
      return await drop("wrong_day");
    }
```

Check `shapeText("")` returns "" in compose; if it doesn't, make compose return `text: ""` when `guarded.text` is empty, and record a ruling.

`prompts/guard/v7.md` (from v6): the "- Getting a day wrong is invented_detail too. …" bullet becomes:

```
- wrong_day: putting something on the wrong day. The dates in WHY SPICA IS WRITING FIRST, WHAT SPICA REMEMBERS and the conversation say how far each thing is from NOW; a message that puts it on another day ("isn't the race this morning" for yesterday's race, "clear skies tonight" for last night), asks about a past thing as still ahead, or asks how a coming thing went ("how'd it go" when it's in 3 days) is wrong_day, not invented_detail.
```

Config: `reach_out` v4, `guard` v7.

Evals:
- **`reach-out-dates.yaml`:** `misdated-this-morning`, `upcoming-after-it-happened` and `stale-tonight` expect `[wrong_day]`. Add:

  ```yaml
    - name: asked-how-it-went-before-it-happened
      kind: reach_out
      now: "Monday, 5 January 2026 at 12:00 where they are"
      reason: |-
        interview: The user has an interview Thursday 8 January.
        - The user has an interview Thursday 8 January. (in 3 days, Thursday 8 January)
      message: "hey, thursday's the day right? how'd it go"
      expect: [wrong_day]
  ```

- **`in-person.yaml`** (B127): `ip-offer-by-text` gets a second recent turn, `{ role: user, text: "wish we could grab a coffee before it lol" }`, and keeps `expect: pass`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/process/outreach tests/mind/process/hot-path tests/mind/process/guard tests/evals tests/mind/platform/prompts.test.ts`
Expected: PASS. Then `pnpm eval --llm=fake --compare` (free): no regressions.

- [ ] **Step 5: Commit**

```bash
git add -A src/mind/process/outreach src/mind/process/hot-path/compose.ts src/mind/process/guard src/db prompts/reach-out prompts/guard config/default.json evals/guard tests
git commit -m "feat(outreach): code frames their day, and a reach-out with the day wrong is dropped"
```

---

### Task 9: Phase 16b exit test

**Files:** Create: `tests/exit/phase-16b.test.ts`

- [ ] **Step 1: Write the exit test**

```ts
/**
 * Phase 16b exit, all fake: stored text keeps the date each time phrase meant and every prompt
 * reads it on its own day, each on its owner's calendar; a weekday takes the date she was shown;
 * extract dates from the message's own time; her view glosses older messages; a reach-out on the
 * wrong day is dropped. A's dates never reach B, no raw token reaches a model, core is unchanged.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun, liveSummary } from "@/db/repos/user/user-mind";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { anchorExtraction } from "@/mind/memory/user/extract";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { withTimeRendering } from "@/mind/platform/llm/render-net";
import { renderTimes, tokenDates } from "@/mind/platform/time-anchors";
import { viewTurns } from "@/mind/process/hot-path/assemble";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { userSummarise } from "@/mind/process/user/summarise";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const D = 86_400_000;
const row = (content: string, at: Date, kind: "summary" | "event" = "summary") => ({
  subject: (kind === "summary" ? "shared" : "user") as "shared" | "user",
  kind,
  content,
  embedding: vec(),
  created_at: at,
  status: "open" as const,
  salience: 0.5,
  valence: 0,
  confidence: 0.6,
  source: "generated" as const,
});

test("1: 'tomorrow' stored on day 1 reads as today on day 2 and yesterday on day 3", async () => {
  const u = await createTestUser();
  const day1 = new Date("2026-01-12T09:00:00Z");
  const r = await insertFact(getTestDb(), u, row("Sister visits tomorrow.", day1));
  expect(renderTimes(r.content, new Date(day1.getTime() + D), 6)).toBe("Sister visits today.");
  expect(renderTimes(r.content, new Date(day1.getTime() + 2 * D), 6)).toBe("Sister visits yesterday, Tuesday 13 January.");
});

test("2: a weekday in her summary takes the date of the memory she was shown", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const race = new Date(d.clock.now().getTime() + 6 * D);
  await insertFact(d.db, u, { ...row("The user runs a half marathon.", d.clock.now(), "event"), source: "turn", occurred_at: race });
  d.llm.handlers.user_summarise = () => ({ where_things_stand: "Race Sunday.", whats_live: "", how_i_feel: "" });
  const run = (await insertRun(d.db, u, { sourceRef: "exchange:a", triggers: [{ kind: "salient_fact", salience: 0.9 }], localDate: "2026-01-05", now: d.clock.now(), cap: 9 }))!;
  await userSummarise({ ...d, snapshot: null }, run, await loadRunInputs(d, u));
  expect(tokenDates((await liveSummary(d.db, u))!.content)[0]!.toISOString().slice(0, 10)).toBe(race.toISOString().slice(0, 10));
});

test("3: extract dates a fact from its message's own time, in the labelled direction", () => {
  const sent = new Date("2026-01-12T09:00:00Z");
  const out = anchorExtraction(
    { facts: [{ subject: "user", kind: "event", content: "The user finished the task over the weekend.", occurred_at: null, when_direction: "past", salience: 0.7, valence: 0, confidence: 0.9, entity_names: [], thread_title: null, claim_kind: null, idiolect_type: null, started_by: null }], entities: [], threads: [], relationship: null, intimacy: null, bid: null } as never,
    [{ role: "user", text: "finished it over the weekend", created_at: sent }],
    "UTC",
  );
  expect(out.facts[0]!.occurred_at!.toISOString().slice(0, 10)).toBe("2026-01-10");
});

test("4: her view keeps an older message's words and says what they mean now", () => {
  const now = new Date("2026-01-13T09:00:00Z");
  const [line] = viewTurns([{ text: "my race is tomorrow", created_at: new Date("2026-01-12T20:00:00Z") }], now, "UTC");
  expect(renderTimes(line!, now, 6)).toBe("— yesterday, Monday 12 January —\nmy race is tomorrow (that's today)");
});

const CANARY = "CANARY-16b4e1";
const CORE_TABLES = ["core_memory", "core_state", "core_goal", "core_snapshot", "world_event"];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`));
    parts.push(...res.rows.map((r) => String(r.j)));
  }
  return parts.join("\n");
}

test("5: leak canary: A's dates never reach B; no raw token reaches the model; core unchanged", async () => {
  const base = makeTestDeps();
  const fake = new FakeLLMProvider();
  const d = { ...base, llm: withTimeRendering(fake, base.clock, 6) };
  const a = await createTestUser("alice");
  const b = await createTestUser("bob");
  for (const u of [a, b]) await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  await insertFact(d.db, a, { ...row(`Gig ${CANARY} tomorrow.`, d.clock.now(), "event"), source: "turn" });
  await insertFact(d.db, b, { ...row("Gig at the Lexington tomorrow.", d.clock.now(), "event"), source: "turn" });
  const before = await coreDump();
  fake.handlers.user_summarise = () => ({ where_things_stand: "Fine.", whats_live: "", how_i_feel: "" });
  const run = async (u: string, ref: string) =>
    (await insertRun(d.db, u, { sourceRef: ref, triggers: [{ kind: "salient_fact", salience: 0.9 }], localDate: "2026-01-05", now: d.clock.now(), cap: 9 }))!;
  await userSummarise({ ...d, snapshot: null }, await run(a, "exchange:a"), await loadRunInputs(d, a));
  const bStart = fake.structuredCalls.length;
  await userSummarise({ ...d, snapshot: null }, await run(b, "exchange:b"), await loadRunInputs(d, b));
  for (const c of fake.structuredCalls.slice(bStart)) expect(JSON.stringify(c)).not.toContain(CANARY);
  for (const c of fake.structuredCalls) expect(c.input + c.system).not.toContain("⟦");
  expect(await coreDump()).toBe(before);
});
```

The reach-out drop is pinned by Task 8's send test; the owner's calendars by Task 4's assemble test.

- [ ] **Step 2: Run it**

Run: `pnpm test tests/exit/phase-16b.test.ts`
Expected: PASS. Fix the code, never an assertion. If `userSummarise`'s deps or the trigger shape differ, copy them from `tests/exit/phase-16.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/exit/phase-16b.test.ts
git commit -m "test(exit): Phase 16b time anchors, with leak canary"
```

---

### Task 10: Close

**Files:**
- `spica-design-spec-v3.md`:
  - §6: content holds anchors; the core layer zone;
  - §9: user-mind hints, NOW, prompt versions;
  - §10.3: one date system, the Now section, dividers and glosses, one date per memory;
  - §10.4 and §12.3: extract v10, anchoring at the message's time, the weekday cross-check, `when.ts` gone;
  - §10.5: guard v7 `wrong_day`, outcome `dropped`;
  - §13: framing and the drop;
  - §17: the review renders absolute;
  - §20: the 16b row becomes built.
- `docs/spec-v3-history.md`: the 16b row; B127 done (its test fixed).
- `DECISIONS.md` rows:
  - no backfill;
  - thread titles not anchored (matched by exact title);
  - world event text, goals, the transcript and the inspector stay raw;
  - her own loops pass no shown dates;
  - the comma render style;
  - gloss skipped when the words still mean what they say;
  - "You last talked N days ago" kept beside the dividers (the window drops old messages);
  - every ruling from the ledger.
- `CLAUDE.md` "Current phase"; memory `phase-status`.
- Delete this plan and the design doc once built.

- [ ] **Step 1:** `spica-close`, in order:
  - `pnpm format`, `pnpm typecheck`, `pnpm lint`;
  - the full `pnpm test` (once);
  - `pnpm test tests/exit/phase-16b.test.ts`;
  - `pnpm eval --llm=fake --compare`;
  - `git grep -nE "relativeDate|dayInWords|itemWhen|writtenOn|guardNow|noteRelativeWords|applyWhen|resolveWhen|dayLabel|gapMarkerMinHours" -- src tests evals` returns nothing;
  - the `scope-reviewer` on the diff (told not to run tests);
  - the spec write-back;
  - commit.
- [ ] **Step 2:** The paid runs (Ethan, 2026-10-24), each through `review-run`:
  - `pnpm review:world-outreach`: misdated reach-outs and the leftover relative-words list, against `evals/results/review-2026-10-22T08-27-19-368Z.md`;
  - `pnpm eval:guard`: the `wrong_day` cases and `ip-offer-by-text`.
