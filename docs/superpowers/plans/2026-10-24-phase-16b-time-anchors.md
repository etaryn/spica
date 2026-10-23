# Phase 16b: Time Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stored text keeps the date each time phrase meant, every model reads it relative to its own day on its owner's calendar, and reach-outs can't go out on the wrong day.

**Architecture:**
- **Write side.** One pure module, `platform/time-anchors.ts`, resolves time phrases at write time into tokens: `⟦date|precision|zone⟧`, optionally with a `|said` phrase. The two insert points, user `insertFact` and core `memory.insert` (plus `insertSnapshot`), anchor every write by default. Writers that know more pass hints: dates they were shown, or extract's past/upcoming label.
- **Read side.** One wrapper around the model provider renders every token in every prompt relative to the clock's now. Her outgoing messages are never processed.
- **Reach-outs** get code-picked framing, a code date check, and a guard `wrong_day` category that drops them.

**Tech Stack:** TypeScript, chrono-node 2.10.1 (already a dependency), Drizzle and Postgres, Vitest, versioned prompt files.

**Spec:** `docs/2026-10-24-phase-16b-time-anchors-design.md` (settled with Ethan 2026-10-24; spec §20 row "Time anchors"). Memory `phase-16b-settled`, `her-speech-stays-free`.

## Global Constraints

- **Her messages to the user are never post-processed.** Only stored memory text is anchored; tokens never reach a model, because the provider wrapper renders them.
- **Numbers live in `config/default.json`:** `time.relative_max_days: 6` (new) is the only new number.
- **Prompts:** every prompt change is a new version file plus the config bump, and the old version file is deleted in the same task (`git mv` then edit).
- **Don't edit `prompts/persona/*`.**
- **`src/mind` stays framework-free:** time comes from `deps.clock` or a `now` argument.
- **Boundaries:** core code takes `CoreDeps` and reads only core. ESLint stops core, world and shared code importing user, process or admin code.
- **Comments say why, never cite spec sections, phases or review items.** New files start with a plain-English header.
- **Prettier at 100 columns.** No retries or regenerations anywhere (the no-retries side phase).
- **Tests:** targeted `pnpm test <path>` while working; the full suite (about 10 minutes) once, at close. One test process at a time.
- **Backslashes:** never write strings containing them through shell heredocs or `python -c`; use the Write/Edit tools (memory `phase-status` gotcha).
- **Replace from the ground up:** `memory/user/when.ts` and its test are deleted (the rules move into `time-anchors.ts`), and `noteRelativeWords` is deleted. Nothing old stays alongside.

## Review Focus

1. **Text that already holds tokens is anchored again** (a writer anchors, then the repo anchors): it must come out unchanged, and chrono must never parse the `2026-01-11` inside a token. Pinned in Task 1.
2. **A user with no zone or an invalid one:** `insertFact` must anchor in UTC, not throw. Pinned in Task 3.
3. **A token read across a year boundary** (written 30 December, read 2 January): the date must name its year when the year differs. Pinned in Task 1.
4. **An older message whose time word is "today"** ("today was rough", sent yesterday): the gloss must read "today (that's yesterday, …)". Pinned in Task 7.
5. **A reach-out naming two days** ("how was the race, and is your sister still coming saturday"): the code date check must not drop it. Only exactly one named day that isn't the event day drops. Pinned in Task 8.

---

## File map

| File | Change |
|---|---|
| `src/mind/platform/time-anchors.ts` (new) | anchor, render, absolute render, token dates, instants |
| `src/mind/platform/llm/render-net.ts` (new) | provider wrapper that renders tokens in every prompt |
| `src/mind/platform/config.ts`, `config/default.json` | `time.relative_max_days` |
| `src/mind/platform/relative-date.ts` | add `nowLine`; delete `noteRelativeWords` (Task 6) |
| `src/runtime/deps.ts`, `evals/lib/runner.ts`, `src/db/reset-self-cli.ts` | wrap the provider; give the core layer her zone |
| `src/db/repos/user/facts.ts` | `insertFact` anchors content and top-level payload strings |
| `src/db/repos/core/{index,memory}.ts`, `src/mind/memory/core/types.ts` | core layer zone; `insert` and `insertSnapshot` anchor |
| `src/mind/memory/user/extract.ts`, `prompts/extract/v10.md`; delete `when.ts` | past/upcoming label, anchoring, cross-check |
| `src/mind/process/user/{inputs,summarise,reflect,model,ideate,consolidate}.ts`, `prompts/user-mind/*` | shown-date hints, NOW in both zones, prompt lines |
| `src/mind/process/core/{thoughts,appraise,reflect,render-snapshot}.ts`, `prompts/core/*` | snapshot lines pre-anchored; prompt lines; slip logging removed |
| `src/mind/process/hot-path/{assemble,compose}.ts` | owner's calendar, NOW section, dividers and glosses, guard view |
| `src/mind/process/outreach/{candidates,send}.ts`, `prompts/reach-out/v4.md` | event day, framing, code date check, drop |
| `src/mind/process/guard/{categories,outgoing}.ts`, `prompts/guard/v7.md`, `src/db/schema.ts` + migration | `wrong_day`, `dropped` outcome |
| `evals/guard/{reach-out-dates,in-person}.yaml`, `evals/lib/review.ts` | `wrong_day` cases, B127 test fix, absolute render in the review |
| `tests/exit/phase-16b.test.ts` (new) | exit test with the leak canary |

---

### Task 1: The time-anchors module

**Files:**
- Create: `src/mind/platform/time-anchors.ts`
- Modify: `src/mind/platform/config.ts` (the `time` schema), `config/default.json`
- Test: `tests/mind/platform/time-anchors.test.ts` (new)

**Interfaces:**
- Produces:
  - `type Precision = "day" | "morning" | "afternoon" | "evening" | "night" | "time" | "weekend" | "week" | "month" | "since"`
  - `type AnchorContext = { at: Date; zone: string; known?: Date[]; direction?: "past" | "upcoming" | null; said?: boolean }`
  - `type AnchorHints = Omit<AnchorContext, "at" | "zone">`
  - `anchorTimes(text: string, ctx: AnchorContext): string`
  - `anchorFields<T>(value: T, ctx: AnchorContext): T`: anchors top-level string values of a plain object; other values pass through
  - `renderTimes(text: string, now: Date, maxDays: number): string`
  - `renderAbsolute(text: string): string`
  - `tokenDates(text: string): Date[]`
  - `isSingleToken(text: string): boolean`
  - config `config.time.relative_max_days: number`

- [ ] **Step 1: Write the failing tests**

Create `tests/mind/platform/time-anchors.test.ts`:

```ts
/** Time anchors: a phrase keeps the date it meant when written, and reads right on any later day. */
import { expect, test } from "vitest";
import {
  anchorFields,
  anchorTimes,
  isSingleToken,
  renderAbsolute,
  renderTimes,
  tokenDates,
} from "@/mind/platform/time-anchors";

const MON = new Date("2026-01-12T09:00:00Z"); // Monday 12 January 2026
const at = (iso: string) => new Date(iso);
const utc = { at: MON, zone: "UTC" };
const read = (text: string, now: Date) => renderTimes(text, now, 6);

test("relative words become the day they meant, and read right later", () => {
  const stored = anchorTimes("how'd the race go yesterday—legs hold up?", utc);
  expect(stored).not.toContain("yesterday");
  expect(read(stored, MON)).toBe("how'd the race go yesterday (Sunday 11 January)—legs hold up?");
  expect(read(stored, at("2026-01-13T09:00:00Z"))).toBe(
    "how'd the race go 2 days ago (Sunday 11 January)—legs hold up?",
  );
  const night = anchorTimes("Spica has a telescope booking confirmed for tonight.", utc);
  expect(read(night, MON)).toBe("Spica has a telescope booking confirmed for tonight.");
  expect(read(night, at("2026-01-13T09:00:00Z"))).toBe(
    "Spica has a telescope booking confirmed for last night (Monday 12 January).",
  );
});

test("a bare weekday takes a date the writer was shown, else points by the rule", () => {
  const race = at("2026-01-11T08:00:00Z"); // Sunday
  const written = at("2026-01-05T10:00:00Z"); // Monday the 5th
  const known = anchorTimes("Sam's got a half marathon Sunday.", {
    at: written,
    zone: "UTC",
    known: [race],
  });
  expect(tokenDates(known).map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-01-11"]);
  // With no shown date: forward unless the phrase itself points back; the same weekday is today.
  const forward = anchorTimes("Sam's got a half marathon Sunday.", { at: written, zone: "UTC" });
  expect(tokenDates(forward)[0]!.toISOString().slice(0, 10)).toBe("2026-01-11");
  const sameDay = anchorTimes("They're awake late on a Wednesday.", {
    at: at("2026-01-14T23:00:00Z"),
    zone: "UTC",
  });
  expect(tokenDates(sameDay)[0]!.toISOString().slice(0, 10)).toBe("2026-01-14");
  // Extract's label wins: "past" goes back, "upcoming" said on that weekday means next week.
  const past = anchorTimes("The user finished it on Saturday.", { ...utc, direction: "past" });
  expect(tokenDates(past)[0]!.toISOString().slice(0, 10)).toBe("2026-01-10");
  const ahead = anchorTimes("The user has a meeting on Monday.", { ...utc, direction: "upcoming" });
  expect(tokenDates(ahead)[0]!.toISOString().slice(0, 10)).toBe("2026-01-19");
});

test("weeks, weekends, offsets, explicit dates and durations anchor", () => {
  const days = (s: string) =>
    tokenDates(anchorTimes(s, utc)).map((d) => d.toISOString().slice(0, 10));
  expect(days("Both happen this week.")).toEqual(["2026-01-12"]);
  expect(days("Due by the end of the week.")).toEqual(["2026-01-16"]);
  expect(days("Sister visits Saturday 17 January.")).toEqual(["2026-01-17"]);
  expect(days("The results come in 3 days.")).toEqual(["2026-01-15"]);
  expect(days("She left 2 days ago.")).toEqual(["2026-01-10"]);
  // "over the weekend" with no label takes the nearest weekend: from a Monday, the one just past.
  expect(days("The user finished the task over the weekend.")).toEqual(["2026-01-10"]);
  const waited = anchorTimes("Still waiting on feedback, five days now.", utc);
  expect(read(waited, at("2026-01-13T09:00:00Z"))).toBe(
    "Still waiting on feedback, since Wednesday 7 January (6 days ago).",
  );
});

test("a time on a day anchors; a bare clock time, 'now' and weekday nouns don't", () => {
  const t = anchorTimes("The call is tomorrow at 3pm.", utc);
  expect(read(t, MON)).toBe("The call is tomorrow (Tuesday 13 January) at 15:00.");
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

test("a date in another year names its year", () => {
  const stored = anchorTimes("The party is on Wednesday 30 December.", {
    at: at("2026-12-28T09:00:00Z"),
    zone: "UTC",
  });
  // Her stored notes drop the "on" with the phrase; the date reads on its own.
  expect(read(stored, at("2027-01-20T09:00:00Z"))).toBe("The party is Wednesday 30 December 2026.");
});

test("each token reads on its own calendar", () => {
  // Written 23:30 in Singapore on Monday 12th: "tonight" is Singapore's Monday night.
  const her = anchorTimes("Clear skies tonight.", {
    at: at("2026-01-12T15:30:00Z"),
    zone: "Asia/Singapore",
  });
  // 01:00 Tuesday in Singapore is still Monday in London; her token reads on her calendar.
  expect(read(her, at("2026-01-12T17:00:00Z"))).toBe("Clear skies last night (Monday 12 January).");
});

test("said mode keeps the words and glosses them", () => {
  const glossed = anchorTimes("my race is tomorrow", { ...utc, said: true });
  expect(read(glossed, at("2026-01-13T08:00:00Z"))).toBe(
    "my race is tomorrow (that's today)",
  );
  expect(read(glossed, at("2026-01-14T08:00:00Z"))).toBe(
    "my race is tomorrow (that's yesterday (Tuesday 13 January))",
  );
});

test("absolute rendering, token dates, single tokens and fields", () => {
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
});
```

Add to `tests/mind/platform/config.test.ts` (with its existing `loadConfig` import):

```ts
test("time anchors render within a week as distances", () => {
  expect(loadConfig().time.relative_max_days).toBe(6);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/platform/time-anchors.test.ts tests/mind/platform/config.test.ts`
Expected: FAIL. The module doesn't exist and `config.time` is undefined.

- [ ] **Step 3: Config**

In `src/mind/platform/config.ts`, before `export const ConfigSchema`:

```ts
const time = z.object({ relative_max_days: positiveInt });
```

Add `time,` inside `ConfigSchema` after `prompts,`. In `config/default.json`, add a top-level `"time": { "relative_max_days": 6 },` before `"prompts"`, keeping the file's key order style.

- [ ] **Step 4: The module**

Create `src/mind/platform/time-anchors.ts`:

```ts
/**
 * Time anchors: stored text keeps the date each time phrase meant. When text is stored, each
 * phrase ("tomorrow", "on Sunday", "five days now") is resolved from the moment it was written, in
 * the writer's zone, and replaced by a token holding the day, its precision and that zone. When a
 * model reads the text, each token is rendered on its own calendar relative to that moment's now
 * ("yesterday (Sunday 11 January)"). Only stored text is anchored: her messages are never touched.
 */
import * as chrono from "chrono-node";
import { localDateString, localMidnight, shiftLocalDate, zoneOffsetMinutes } from "./timezone";

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
// Words pointing back in time: forward-dating would push "last friday" into next week.
const PAST = /\b(last|ago|yesterday|earlier|previous|before)\b/i;
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

/** Each token in words relative to `now`, on its own calendar. */
export function renderTimes(text: string, now: Date, maxDays: number): string {
  return text.replace(TOKEN, (_m, local: string, precision: Precision, zone: string, said?: string) => {
    const phrase = render({ local, precision, zone }, now, maxDays);
    if (!said) return phrase;
    return precision === "since" ? `${said} (since ${phrase})` : `${said} (that's ${phrase})`;
  });
}

/** Each token as a plain date with its year, for readers that have no "now" (the review). */
export function renderAbsolute(text: string): string {
  return text.replace(TOKEN, (_m, local: string, precision: Precision, _zone: string, said?: string) => {
    const abs = absolute(local, precision);
    return said ? `${said} (${abs})` : abs;
  });
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
    const days = count((n1 ?? n2)!) * ((u1 ?? u2)!.startsWith("week") ? 7 : 1);
    const t = token(shiftLocalDate(today(ctx), -days), "since", ctx, match);
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
    const wd = WEEKDAYS.indexOf(m[2]!);
    const local = m[1] ? explicitWeekday(day, wd, m[1]) : pickWeekday(day, wd, ctx, w);
    return { local, precision: (m[3] as Precision | undefined) ?? "day" };
  }
  if ((m = OFFSET.exec(w))) {
    const ago = m[3] !== undefined;
    const days = count((m[1] ?? m[3])!) * ((m[2] ?? m[4])!.startsWith("week") ? 7 : 1);
    return { local: shiftLocalDate(day, ago ? -days : days), precision: "day" };
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
    const ym = day.slice(0, 7);
    const [y, mo] = ym.split("-").map(Number) as [number, number];
    if (m[1]) {
      const shift = m[1].toLowerCase() === "next" ? 1 : m[1].toLowerCase() === "last" ? -1 : 0;
      const d = new Date(Date.UTC(y, mo - 1 + shift, 1));
      return { local: d.toISOString().slice(0, 7), precision: "month" };
    }
    // "in october" said in October is this October; otherwise the next one.
    const target = new Date(`${m[2]} 1, ${y} 12:00 UTC`).getUTCMonth() + 1;
    const year = target >= mo ? y : y + 1;
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
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(`${ym}-15T12:00:00Z`),
  );
}

function render(a: Anchor, now: Date, maxDays: number): string {
  const day = localDateString(now, a.zone);
  if (a.precision === "month") {
    const months = (Number(a.local.slice(0, 4)) - Number(day.slice(0, 4))) * 12 +
      (Number(a.local.slice(5, 7)) - Number(day.slice(5, 7)));
    const label = monthName(a.local);
    return months === 0 ? "this month" : months === -1 ? `last month (${label})` : months === 1 ? `next month (${label})` : label;
  }
  const [date, time] = a.local.split("T") as [string, string | undefined];
  const off = dayDiff(date, day);
  const name = dayName(date, date.slice(0, 4) !== day.slice(0, 4));
  const rel = off === 0 ? "today" : off === -1 ? "yesterday" : off === 1 ? "tomorrow" : off < 0 ? `${-off} days ago` : `in ${off} days`;
  const near = Math.abs(off) <= maxDays;
  switch (a.precision) {
    case "week": {
      const w = dayDiff(mondayOf(date), mondayOf(day)) / 7;
      return w === 0 ? "this week" : w === -1 ? `last week (the week of ${name})` : w === 1 ? `next week (the week of ${name})` : `the week of ${name}`;
    }
    case "weekend": {
      const w = dayDiff(mondayOf(date), mondayOf(day)) / 7;
      return w === 0 ? `this weekend (${name})` : w === -1 ? `last weekend (${name})` : w === 1 ? `next weekend (${name})` : `the weekend of ${name}`;
    }
    case "since":
      return near ? `${name} (${rel})` : name;
    case "night":
      if (off === 0) return "tonight";
      if (off === -1) return `last night (${name})`;
      if (off === 1) return `tomorrow night (${name})`;
      return near ? `the night of ${name} (${rel})` : `the night of ${name}`;
    case "morning":
    case "afternoon":
    case "evening":
      if (off === 0) return `this ${a.precision}`;
      if (Math.abs(off) === 1) return `${rel} ${a.precision} (${name})`;
      return near ? `${name}, in the ${a.precision} (${rel})` : `${name}, in the ${a.precision}`;
    case "time":
      return `${render({ ...a, local: date, precision: "day" }, now, maxDays)} at ${time}`;
    default:
      return off === 0 ? "today" : near ? `${rel} (${name})` : name;
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
      return `${name}, in the ${precision}`;
    case "time":
      return `${name} at ${time}`;
    default:
      return name;
  }
}
```

- [ ] **Step 5: Run the tests and fix against chrono's real output**

Run: `pnpm test tests/mind/platform/time-anchors.test.ts tests/mind/platform/config.test.ts`
Expected: PASS. Where chrono's span or certainty differs from what a test assumes (for example its `text` for "tomorrow at 3pm", or whether it parses "30 December" with a weekday), adjust the module's regexes, never the test's expectation of the date. Record each such fix in the ledger as a ruling. Then run `pnpm exec prettier --write` and `pnpm exec eslint` on both files.

- [ ] **Step 6: Replay the corpus (free check)**

Run the scratch replay from 2026-10-24 against the module:

```bash
pnpm exec tsx -e '
import fs from "node:fs";
import { anchorTimes } from "./src/mind/platform/time-anchors";
import { relativeWords } from "./src/mind/platform/relative-date";
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

Expected: leftover relative words in under 3% of texts, each one an understood miss (for example "the morning" used generically). Note the count in the ledger. If a miss is a real phrase the filters drop wrongly, fix the filter and add that sentence to the test file.

- [ ] **Step 7: Commit**

```bash
git add src/mind/platform/time-anchors.ts src/mind/platform/config.ts config/default.json tests/mind/platform/time-anchors.test.ts tests/mind/platform/config.test.ts
git commit -m "feat(time): anchors keep the date each time phrase meant and read it on any later day"
```

---

### Task 2: Render every prompt through the clock

**Files:**
- Create: `src/mind/platform/llm/render-net.ts`
- Modify: `src/runtime/deps.ts:58-60`, `evals/lib/runner.ts:391-400` (and its `llm.prompts` / `llm.replies` reads), `evals/lib/review.ts` (Final facts lines)
- Test: `tests/mind/platform/llm.test.ts` (or a new `tests/mind/platform/render-net.test.ts`), `tests/evals/review.test.ts`

**Interfaces:**
- Consumes: `renderTimes`, `renderAbsolute`, `anchorTimes` (Task 1).
- Produces: `withTimeRendering<T extends LLMProvider>(inner: T, clock: Clock, maxDays: number): T`

- [ ] **Step 1: Write the failing tests**

Create `tests/mind/platform/render-net.test.ts`:

```ts
/** Every prompt reaches the model with its time anchors read on the clock's day. */
import { expect, test } from "vitest";
import { z } from "zod";
import { SimClock } from "@/mind/platform/clock";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { withTimeRendering } from "@/mind/platform/llm/render-net";
import { anchorTimes } from "@/mind/platform/time-anchors";

const written = { at: new Date("2026-01-12T09:00:00Z"), zone: "UTC" };

test("reply and structured prompts are rendered relative to the clock; the fake still records", async () => {
  const fake = new FakeLLMProvider();
  const clock = new SimClock(new Date("2026-01-13T09:00:00Z"));
  const llm = withTimeRendering(fake, clock, 6);
  const note = anchorTimes("the race was yesterday", written);
  fake.replies.push("ok");
  await llm.generateReply({
    system: [{ text: note, cache: true }],
    messages: [{ role: "user", content: note }],
  });
  expect(fake.calls[0]!.system).toBe("the race was 2 days ago (Sunday 11 January)");
  expect(fake.calls[0]!.messages[0]!.content).toBe("the race was 2 days ago (Sunday 11 January)");
  fake.handlers.probe = () => ({ ok: true });
  await llm.classifyJson({
    purpose: "probe",
    system: note,
    input: JSON.stringify({ note }),
    schema: z.object({ ok: z.boolean() }),
    timeoutMs: 1000,
    maxTokens: 10,
  });
  expect(fake.structuredCalls.at(-1)!.input).toContain("2 days ago (Sunday 11 January)");
  expect(fake.structuredCalls.at(-1)!.input).not.toContain("⟦");
  // Reading through the wrapper reaches the fake's own fields.
  expect((llm as FakeLLMProvider).calls).toBe(fake.calls);
});
```

In `tests/evals/review.test.ts`, add a test like the existing relative-words one: a final fact whose content is `anchorTimes("Sister visits tomorrow.", { at: new Date("2026-01-12T09:00:00Z"), zone: "UTC" })` must appear in the review as `Sister visits Tuesday 13 January 2026.`, with no "⟦".

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/platform/render-net.test.ts tests/evals/review.test.ts`
Expected: FAIL. The module doesn't exist, and the review prints the raw token.

- [ ] **Step 3: Implement**

Create `src/mind/platform/llm/render-net.ts`:

```ts
/**
 * Every prompt passes through here on its way to a model: each time anchor in it is rendered on
 * its own calendar relative to the clock's now, so stored text reads right on whatever day it is
 * read. Wrapping by delegation keeps the inner provider's own fields reachable (test recorders).
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

`src/runtime/deps.ts`: `llm: withTimeRendering(new AnthropicProvider(new Anthropic(), config.models), systemClock, config.time.relative_max_days),`. Import it.

`evals/lib/runner.ts`: keep the recorder in its own constant and wrap it:

```ts
  const recording = new RecordingLLM(useScripted ? new SignalLLM(baseLlm, byText) : baseLlm);
  const llm = withTimeRendering(recording, clock, config.time.relative_max_days);
```

Change every later read of `llm.prompts`, `llm.replies` and the core-call list in the runner to `recording.…`, so nothing reads through the wrapper. Grep `llm\.` in the runner to find them all.

`evals/lib/review.ts`: in the Final facts lines, print `fmt(renderAbsolute(String(f.content ?? "")))`. Import `renderAbsolute`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/platform/render-net.test.ts tests/evals tests/mind/platform/llm.test.ts`
Expected: PASS. `pnpm typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add src/mind/platform/llm/render-net.ts src/runtime/deps.ts evals/lib/runner.ts evals/lib/review.ts tests
git commit -m "feat(time): every prompt reads its time anchors on the clock's day"
```

---

### Task 3: The repos anchor every write

**Files:**
- Modify: `src/db/repos/user/facts.ts:143-150` (`insertFact`)
- Modify: `src/db/repos/core/memory.ts:49` (`coreMemoryRepo`), `:266-274` (`insert`), `:561-568` (`insertSnapshot`)
- Modify: `src/db/repos/core/index.ts` (`scope`, `createCoreLayer`), `src/mind/memory/core/types.ts` (the `CoreMemory.insert` signature)
- Modify: `src/runtime/deps.ts`, `evals/lib/runner.ts`, `src/db/reset-self-cli.ts`: `createCoreLayer(db, config.life.timezone)`
- Test: `tests/db/user-mind-repos.test.ts` (or `tests/db/facts.test.ts` if one exists for `insertFact`), `tests/db/core-repos.test.ts`

**Interfaces:**
- Consumes: `anchorTimes`, `anchorFields`, `AnchorHints` (Task 1); `getTimezone` (`src/db/repos/user/users.ts`); `zoneOrUtc` (`platform/timezone.ts`).
- Produces:
  - `insertFact(db, userId, row, hints?: AnchorHints): Promise<FactRow>`
  - `CoreMemory.insert(item: NewCoreMemory, hints?: AnchorHints): Promise<string>`
  - `createCoreLayer(db: Db, zone = "UTC"): CoreLayer`
  - `coreMemoryRepo(db: Db, zone = "UTC"): CoreMemory`

- [ ] **Step 1: Write the failing tests**

In `tests/db/user-mind-repos.test.ts` (it imports `insertFact`, `setTimezone`, `getTestDb`, `createTestUser`, `vec`), add:

```ts
import { renderTimes, tokenDates } from "@/mind/platform/time-anchors";

test("insertFact anchors content and payload strings in the user's zone; no zone means UTC", async () => {
  const u = await createTestUser();
  const at = new Date("2026-01-12T23:30:00Z"); // Monday 23:30 UTC, Tuesday 07:30 in Singapore
  const put = (content: string) =>
    insertFact(getTestDb(), u, {
      subject: "shared",
      kind: "summary",
      content,
      payload: { whats_live: content, sensitive: true },
      embedding: vec(),
      created_at: at,
      status: "open",
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: "generated",
    });
  const utc = await put("Sister visits tomorrow.");
  expect(tokenDates(utc.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-13");
  expect((utc.payload as { whats_live: string }).whats_live).toBe(utc.content);
  expect((utc.payload as { sensitive: boolean }).sensitive).toBe(true);
  await setTimezone(getTestDb(), u, "Asia/Singapore");
  const sg = await put("Sister visits tomorrow.");
  expect(renderTimes(sg.content, at, 6)).toBe("Sister visits tomorrow (Wednesday 14 January).");
  await setTimezone(getTestDb(), u, "Mars/Olympus");
  const bad = await put("Sister visits tomorrow.");
  expect(tokenDates(bad.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-13");
});

test("insertFact takes hints: a weekday matches a shown date", async () => {
  const u = await createTestUser();
  const row = await insertFact(
    getTestDb(),
    u,
    {
      subject: "shared",
      kind: "summary",
      content: "Race Sunday.",
      embedding: vec(),
      created_at: new Date("2026-01-14T09:00:00Z"), // Wednesday
      status: "open",
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: "generated",
    },
    { known: [new Date("2026-01-11T08:00:00Z")] },
  );
  expect(tokenDates(row.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-11");
});
```

Check the exact name and signature of `setTimezone` in `src/db/repos/user/users.ts` and use it as written there.

In `tests/db/core-repos.test.ts`, add a test that builds `createCoreLayer(getTestDb(), "Asia/Singapore")` and inserts a memory with content "Clear skies tonight." and `created_at` `2026-01-12T15:30:00Z`. Assert that `renderTimes(content, new Date("2026-01-12T17:00:00Z"), 6)` is "Clear skies last night (Monday 12 January)." (Singapore's Monday night). Also insert a snapshot whose content has "tonight" and assert the stored content holds a token (`tokenDates(...).length === 1`). Copy the insert field set from an existing core memory insert in that file.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/db/user-mind-repos.test.ts tests/db/core-repos.test.ts`
Expected: FAIL. Content is stored as written.

- [ ] **Step 3: Implement**

`src/db/repos/user/facts.ts`:

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
  const ctx = { at: row.created_at, zone: zoneOrUtc(await getTimezone(db, userId)), ...hints };
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

Imports: `anchorFields`, `anchorTimes`, `type AnchorHints` from `@/mind/platform/time-anchors`; `zoneOrUtc` from `@/mind/platform/timezone`; `getTimezone` from `./users`. If `row.created_at` types as `Date | SQL`, narrow with `row.created_at as Date`. Every caller passes a Date; add a comment saying so. If ESLint forbids `src/db` importing `@/mind/platform`, check how other repos import mind types (they import `@/mind/platform/core`); a pure platform module should be allowed. If it isn't, stop and record a ruling.

`src/db/repos/core/memory.ts`: `export function coreMemoryRepo(db: Db, zone = "UTC"): CoreMemory`, then:

```ts
    async insert(item, hints = {}) {
      const ctx = { at: item.created_at, zone, ...hints };
      const row = one(
        await db
          .insert(core_memory)
          .values({ ...item, content: anchorTimes(item.content, ctx), entity_refs: item.entity_refs ?? [] })
          .returning({ id: core_memory.id }),
      );
      return row.id;
    },
```

and in `insertSnapshot`:

```ts
    async insertSnapshot(snapshot) {
      const ctx = { at: snapshot.rendered_at, zone };
      const rows = await db
        .insert(core_snapshot)
        .values({
          ...snapshot,
          content: anchorTimes(snapshot.content, ctx),
          sections: anchorFields(snapshot.sections, ctx),
        })
        .onConflictDoNothing()
        .returning({ version: core_snapshot.version });
      return rows.length > 0;
    },
```

`src/mind/memory/core/types.ts`: `insert(item: NewCoreMemory, hints?: AnchorHints): Promise<string>;` (import the type).

`src/db/repos/core/index.ts`: `function scope(db: Db, zone: string)`, `memory: coreMemoryRepo(db, zone)`, and

```ts
/** `zone` is her life zone: what she writes is anchored on her calendar. */
export function createCoreLayer(db: Db, zone = "UTC"): CoreLayer {
  return {
    ...scope(db, zone),
    transaction: (fn) => db.transaction((tx) => fn(scope(tx, zone))),
  };
}
```

Callers: `src/runtime/deps.ts`, `evals/lib/runner.ts` and `src/db/reset-self-cli.ts` pass `config.life.timezone`. Tests keep the UTC default. `src/db/repos/admin/inspector-core.ts` keeps `coreMemoryRepo(db)` (it only reads).

- [ ] **Step 4: Run them and see them pass, then the repo neighbours**

Run: `pnpm test tests/db tests/mind/memory`
Expected: PASS. A test that asserted stored content equal to an input containing "tomorrow", "tonight" and so on now sees a token. Change it to assert `renderAbsolute(content)` or the token date: that's the new behaviour. Never weaken it to `expect.any`.

- [ ] **Step 5: Commit**

```bash
git add src/db src/mind/memory/core/types.ts src/runtime/deps.ts evals/lib/runner.ts tests
git commit -m "feat(time): every stored fact and memory keeps the date its time words meant"
```

---

### Task 4: Extract labels direction and is cross-checked

**Files:**
- Modify: `src/mind/memory/user/extract.ts` (schema line about 50; the `applyWhen` call at about 282)
- Delete: `src/mind/memory/user/when.ts`, `tests/mind/memory/user/when.test.ts` (port its cases to Task 4's test)
- Create: `prompts/extract/v10.md` (`git mv` from v9, then edit); config `prompts.extract` → `"v10"`
- Test: `tests/mind/memory/user/extract.test.ts`, plus `extract-when.test.ts` if one exists. Find the tests importing `applyWhen` or `resolveWhen` with grep and move their cases here.

**Interfaces:**
- Consumes: `anchorTimes`, `isSingleToken`, `tokenDates` (Task 1).
- Produces: `anchorExtraction(extraction: Extraction, turns: { role: string; text: string; created_at: Date }[], ref: Date | null, zone: string, log?: Logger): Extraction`, exported from `extract.ts`. Facts gain `when_direction: "past" | "upcoming" | null`.

- [ ] **Step 1: Write the failing tests**

In the extract test file, add, importing `anchorExtraction` and `tokenDates` and a minimal `Extraction` builder. Reuse the file's builder if it has one; otherwise build `{ facts: [...], entities: [], threads: [], relationship: null }` with the fields `normalizeExtraction` fills:

```ts
const ref = new Date("2026-01-12T09:00:00Z"); // Monday
const fact = (content: string, when: string | null, when_direction: "past" | "upcoming" | null) => ({
  subject: "user" as const,
  kind: "event" as const,
  content,
  occurred_at: null,
  when,
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
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

test("the {when} slot takes an anchored date in the labelled direction", () => {
  const out = anchorExtraction(
    { facts: [fact("The user finished the task {when}.", "over the weekend", "past")], entities: [], threads: [], relationship: null } as never,
    [],
    ref,
    "UTC",
  );
  expect(day(out.facts[0]!.occurred_at)).toBe("2026-01-10");
  expect(tokenDates(out.facts[0]!.content).map(day)).toEqual(["2026-01-10"]);
});

test("a weekday left in the text is anchored too, upcoming by its label", () => {
  const out = anchorExtraction(
    { facts: [fact("The user is running a half marathon on Sunday morning.", null, "upcoming")], entities: [], threads: [], relationship: null } as never,
    [],
    ref,
    "UTC",
  );
  expect(tokenDates(out.facts[0]!.content).map(day)).toEqual(["2026-01-18"]);
  expect(day(out.facts[0]!.occurred_at)).toBe("2026-01-18");
});

test("a fact's day that their message never named takes the one day it did name", () => {
  const turns = [{ role: "user", text: "interview is on thursday, nervous", created_at: ref }];
  const out = anchorExtraction(
    { facts: [fact("The user has an interview {when}.", "on friday", "upcoming")], entities: [], threads: [], relationship: null } as never,
    turns,
    ref,
    "UTC",
  );
  expect(day(out.facts[0]!.occurred_at)).toBe("2026-01-15");
  expect(tokenDates(out.facts[0]!.content).map(day)).toEqual(["2026-01-15"]);
});

test("a thread checkpoint is always ahead", () => {
  const out = anchorExtraction(
    {
      facts: [],
      entities: [],
      relationship: null,
      threads: [{ action: "open", title: "race", subject: "user", stakes: "med", next_checkpoint: null, checkpoint_when: "sunday evening", thread_id: null }],
    } as never,
    [],
    ref,
    "UTC",
  );
  expect(out.threads[0]!.next_checkpoint!.toISOString()).toBe("2026-01-18T19:00:00.000Z");
});
```

Port the date cases from `tests/mind/memory/user/when.test.ts` into `tests/mind/platform/time-anchors.test.ts` as `anchorTimes` cases on the bare phrase:
- weekdays land on the right day;
- "tomorrow" at 23:30 in Singapore;
- "this week" is a week token;
- "end of this week" is Friday;
- "in october" said in October is this October.

Each asserts `tokenDates(anchorTimes(phrase, ctx))` dates. Then delete `when.test.ts`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/memory/user/extract.test.ts tests/mind/platform/time-anchors.test.ts`
Expected: FAIL. `anchorExtraction` isn't exported.

- [ ] **Step 3: Implement**

In `extract.ts`, in `FactSchema`, after `when`:

```ts
  // Which way the time words point; code resolves the day. Fixtures without it read as null.
  when_direction: z.enum(["past", "upcoming"]).nullable().default(null),
```

Add (replacing the `applyWhen` import and call):

```ts
/**
 * Dates each fact from their own words, in their zone: the `{when}` slot and any other time phrase
 * become anchors, pointing the way extract labelled them. A day their message never named, when
 * it named exactly one, gives way to that one: a copied weekday ("friday" for their "thursday").
 */
export function anchorExtraction(
  extraction: Extraction,
  turns: { role: string; text: string; created_at: Date }[],
  ref: Date | null,
  zone: string,
  log?: Logger,
): Extraction {
  const at = ref ?? new Date(0);
  const named = [
    ...new Set(
      turns
        .filter((t) => t.role === "user")
        .flatMap((t) => tokenDates(anchorTimes(t.text, { at: t.created_at, zone })))
        .map((d) => localDateString(d, zone)),
    ),
  ];
  const facts = extraction.facts.map((f) => {
    const ctx = { at, zone, direction: f.when_direction ?? null };
    const slot = ref && f.when ? anchorTimes(f.when, ctx) : null;
    const filled = slot && isSingleToken(slot) ? slot : (f.when ?? "");
    let content = anchorTimes(
      f.content.includes("{when}")
        ? f.content.replace("{when}", filled).replace(/\s+([.,!?])/g, "$1")
        : f.content,
      ctx,
    );
    let occurred_at = tokenDates(content)[0] ?? f.occurred_at;
    const own = occurred_at ? localDateString(occurred_at, zone) : null;
    if (own && named.length === 1 && !named.includes(own)) {
      log?.info("extract date taken from their message", { from: own, to: named[0] });
      content = content.replace(/⟦\d{4}-\d{2}-\d{2}/, `⟦${named[0]}`);
      occurred_at = tokenDates(content)[0] ?? occurred_at;
    }
    return { ...f, content, occurred_at };
  });
  const threads = extraction.threads.map((t) => {
    const slot = ref && t.checkpoint_when
      ? anchorTimes(t.checkpoint_when, { at, zone, direction: "upcoming" })
      : null;
    const next = slot && isSingleToken(slot) ? tokenDates(slot)[0] : null;
    return { ...t, next_checkpoint: next ?? t.next_checkpoint };
  });
  return { ...extraction, facts, threads };
}
```

Replace the old `return applyWhen(...)` in `extract` with:

```ts
  return anchorExtraction(
    normalizeExtraction(raw, config.extraction.max_candidates),
    args.newTurns,
    ref,
    zone,
    deps.log,
  );
```

If `extract`'s deps type lacks `log`, add `"log"` to its `Pick` (callers pass full `Deps`). Imports: `anchorTimes`, `isSingleToken`, `tokenDates`; `localDateString`; `Logger` type. Delete `src/mind/memory/user/when.ts` and remove its import.

**Rulings to record if they bite:**
- **Two dates in the content:** `content.replace(/⟦\d{4}-\d{2}-\d{2}/, …)` swaps the first token only. When the content has two tokens, skip the cross-check; it's for single-date facts.
- **An empty `{when}` slot:** the old code removed it (`replace(/\s*\{when\}/, "")`). Keep that behaviour when `filled` is empty.

`prompts/extract/v10.md` = v9 plus, after the `occurred_at` bullet:

```
- when_direction: "past" when the time words point to something that already happened ("I finished it over the weekend"), "upcoming" when it's still ahead ("my race is on sunday"), null when `when` is null.
```

Then: `config/default.json` `"extract": "v10"`, and `git mv` the v9 file away (the new file replaces it).

The fake extract handler in `src/mind/platform/llm/fake.ts` returns facts without `when_direction`. The schema default (null) covers it.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/memory/user tests/mind/process/cold-path tests/mind/platform/time-anchors.test.ts tests/mind/platform/prompts.test.ts`
Expected: PASS. Tests that asserted the old label text ("Thursday 8 January 2026" filled into `{when}`) now assert `renderAbsolute(content)` against the same day.

- [ ] **Step 5: Commit**

```bash
git add -A src/mind/memory/user prompts/extract config/default.json tests
git commit -m "feat(extract): time words are labelled past or upcoming and cross-checked against their message"
```

---

### Task 5: The user mind writes with the dates it was shown

**Files:**
- Modify: `src/mind/process/user/inputs.ts` (add `shownDates`), `summarise.ts`, `reflect.ts`, `model.ts`, `ideate.ts`, `consolidate.ts`
- Modify: `src/mind/process/cold-path/cold-path.ts` (remove the `noteRelativeWords` call)
- Modify: `src/mind/platform/relative-date.ts` (add `nowLine`)
- Create: `prompts/user-mind/summarise/v5.md`, `reflect/v5.md`, `model/v5.md`, `ideate/v7.md`; config bumps
- Test: `tests/mind/process/user/summarise.test.ts`, `ideate.test.ts`, `tests/mind/platform/relative-date.test.ts`

**Interfaces:**
- Consumes: `insertFact(…, hints)` (Task 3), `tokenDates`, `anchorTimes` (Task 1).
- Produces:
  - `shownDates(facts: { occurred_at: Date | null }[], threads: { next_checkpoint: Date | null }[], texts: (string | null | undefined)[]): Date[]`
  - `nowLine(now: Date, theirs: string, hers: string): string` → "It's Tuesday 13 January, 21:40 where they are; Wednesday 14 January, 04:40 for you." (one clause, without "where they are", when both read the same)

- [ ] **Step 1: Write the failing tests**

`tests/mind/platform/relative-date.test.ts`:

```ts
test("nowLine gives their local time and hers when it reads differently", () => {
  const at = new Date("2026-01-13T21:40:00Z");
  expect(nowLine(at, "UTC", "UTC")).toBe("It's Tuesday 13 January, 21:40.");
  expect(nowLine(at, "Europe/London", "Asia/Singapore")).toBe(
    "It's Tuesday 13 January, 21:40 where they are; Wednesday 14 January, 05:40 for you.",
  );
});
```

`tests/mind/process/user/summarise.test.ts` (reuse its `setup`, `run` and `insertFact`):

```ts
test("a weekday in the summary takes the date of the memory it was shown", async () => {
  const { deps, userId, run } = await setup();
  const race = new Date(deps.clock.now().getTime() + 6 * 86_400_000); // the coming Sunday
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "event",
    content: "The user runs a half marathon.",
    embedding: vec(),
    created_at: deps.clock.now(),
    occurred_at: race,
    status: "open",
    salience: 0.8,
    valence: 0.3,
    confidence: 0.9,
    source: "turn",
  });
  deps.llm.handlers.user_summarise = () => ({
    where_things_stand: "Fine.",
    whats_live: "The race Sunday.",
    how_i_feel: "Glad.",
  });
  await userSummarise(deps, await run("exchange:w"), await loadRunInputs(deps, userId));
  const live = (await liveSummary(deps.db, userId))!;
  expect(tokenDates((live.payload as { whats_live: string }).whats_live)[0]!.toISOString().slice(0, 10)).toBe(
    race.toISOString().slice(0, 10),
  );
  const input = JSON.parse(deps.llm.structuredCalls.find((c) => c.purpose === "user_summarise")!.input);
  expect(input.now).toMatch(/^It's \w+ \d+ \w+, \d{2}:\d{2}/);
});
```

The test clock starts Monday 2026-01-05 09:00 UTC, so +6 days is Sunday the 11th. In `ideate.test.ts`, add: an idea "Ask how tonight's gig goes." written with no sources gets `stale_after` at the end of today (its own anchor), not 3 days.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/platform/relative-date.test.ts tests/mind/process/user/summarise.test.ts tests/mind/process/user/ideate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`relative-date.ts`:

```ts
/** "It's Tuesday 13 January, 21:40 where they are; …for you.": now on both calendars. */
export function nowLine(now: Date, theirs: string, hers: string): string {
  const at = (tz: string) =>
    `${new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" })
      .format(now)
      .replace(",", "")}, ${localTime(now, tz)}`;
  return at(theirs) === at(hers)
    ? `It's ${at(theirs)}.`
    : `It's ${at(theirs)} where they are; ${at(hers)} for you.`;
}
```

Import `localTime` from `./timezone`.

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

In each loop:
- Replace `now: formatLocal(now, inputs.timezone)` with `now: nowLine(now, zoneOrUtc(inputs.timezone), lifeTimezone(config.life, now))`.
- Delete the `noteRelativeWords(...)` call and its import.
- Pass hints to every `insertFact`:
  - **summarise:** `insertFact(tx, userId, {...}, { known: shownDates(facts, threads, [previous?.content]) })`
  - **reflect:** `{ known: shownDates(inputs.facts, [], [summary?.content]) }`
  - **model:** `{ known: shownDates(inputs.facts, [], [summary?.content, previous?.content, noticed?.content]) }` on both inserts (the read and the beliefs)
  - **ideate:** `{ known: shownDates(facts, threads, [summary?.content, readRow?.content]) }`, and the idea's own dates join its sources:

    ```ts
        const known = shownDates(facts, threads, [summary?.content, readRow?.content]);
        const own = tokenDates(anchorTimes(out.idea, { at: now, zone: zoneOrUtc(inputs.timezone), known }));
        // in ideaStaleAfter's source dates:
        [...facts.filter((f) => from.includes(f.id)).map((f) => f.occurred_at!), ...own],
    ```

  - **consolidate** (`process/user/consolidate.ts`): pass `{ known: <the group's source facts>.flatMap((s) => (s.occurred_at ? [s.occurred_at] : [])) }` to its `insertFact`.

`cold-path.ts`: delete the `noteRelativeWords(...)` call after `extract` and its import.

Prompts:
- **summarise:** `git mv prompts/user-mind/summarise/v4.md prompts/user-mind/summarise/v5.md`, then:
  - the input's `now` description becomes "`now` (the current time where they are, and where you are when it differs)";
  - the bullet starting "- These notes are read on later days, so write dates, never…" becomes: `- When you mention a day, copy its date as you see it ("their sister visits on Saturday 17 January"); what you write is dated for you, so plain words like "tomorrow" are fine too.`
- **reflect v5, model v5:** the same `now` description, and the bullet "- What you write is read on later days: never today, tonight, tomorrow, yesterday or this week. Give the date, or leave time out." becomes: `- When you mention a day, copy its date as you see it; what you write is dated for you.`
- **ideate v7** (from v6): the same `now` description, and the bullet "- An idea goes out on a later day: never write today, tonight, tomorrow, yesterday or this week. Name the day (…) or leave time out." becomes: `- When you mention a day, copy its date as you see it ("ask how the interview on Thursday 8 January went"); what you write is dated for you.`

Config: `user_summarise` v5, `user_reflect` v5, `user_model` v5, `user_ideate` v7.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/process/user tests/mind/process/cold-path tests/mind/platform/relative-date.test.ts tests/mind/platform/prompts.test.ts`
Expected: PASS. Tests that pinned `now` to `formatLocal(...)` now expect `nowLine(...)`.

- [ ] **Step 5: Commit**

```bash
git add -A src/mind/process/user src/mind/process/cold-path src/mind/platform/relative-date.ts prompts/user-mind config/default.json tests
git commit -m "feat(time): the user mind writes with the dates it was shown and sees now on both calendars"
```

---

### Task 6: Her own writers

**Files:**
- Modify: `src/mind/process/core/render-snapshot.ts` (anchor item texts before building content and lines; delete `noteRelativeWords`)
- Modify: `src/mind/process/core/{thoughts,appraise,reflect}.ts` (delete the `noteRelativeWords` calls)
- Modify: `src/mind/platform/relative-date.ts` (delete `noteRelativeWords`; keep `relativeWords`, which the review uses)
- Create: `prompts/core/{appraise,anticipate,ruminate,wander,reflect,snapshot}/v4.md` (`git mv` from v3); config bumps
- Test: `tests/mind/process/core/render-snapshot.test.ts`, `tests/mind/platform/relative-date.test.ts` (delete the `noteRelativeWords` test)

**Interfaces:**
- Consumes: `anchorTimes` (Task 1); the core layer's zone (Task 3).
- Produces: snapshot lines and content anchored identically, so `snapshotWithin` and the self-line match still work.

- [ ] **Step 1: Write the failing test**

In `render-snapshot.test.ts`, add a test where the fake `core_render_snapshot` handler returns a Lately line "Telescope booking tonight." Assert that:
- the stored snapshot content holds a token (`tokenDates(content).length === 1`);
- the self line for it has the identical text to that content line (`selfLines(version)` contains the line text exactly as it appears in `content`).

Set the handler on `all.llm.handlers.core_render_snapshot`, following how the file's existing tests drive it.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm test tests/mind/process/core/render-snapshot.test.ts`
Expected: FAIL. The line isn't anchored; and once the repo anchors the content but not the self lines, the texts differ.

- [ ] **Step 3: Implement**

In `render-snapshot.ts`, right after `kept` is computed, anchor every item text once, so the content, sections and self lines are built from the same strings:

```ts
    // Anchored once, here, so the snapshot's text and its self lines stay the same strings.
    const zone = lifeTimezone(config.life, now);
    for (const items of Object.values(kept))
      for (const item of items) item.text = anchorTimes(item.text, { at: now, zone });
```

Delete the `noteRelativeWords(...)` call and its import. Delete the `noteRelativeWords` calls and imports in `thoughts.ts`, `appraise.ts` and `reflect.ts`. Delete `noteRelativeWords` from `relative-date.ts`, along with its test and its `Logger` import if nothing else uses it.

Prompts, `git mv` v3 → v4, then:
- **appraise, anticipate, ruminate, wander, reflect:** the "Dates:" paragraph becomes `Dates: the input gives days with how far they are from now ("Friday 9 January, in 2 days"); never count days yourself. When you mention a day, copy its date as you see it; what you write is dated for you.`
- **snapshot:** the line "The previous snapshot starts with the day it was written. These lines are read for days: never write today, tonight, tomorrow, yesterday or this week; name the day or leave time out." becomes `The previous snapshot starts with the day it was written. When a line mentions a day, copy its date as you see it; what you write is dated for you.`

Config: the six `core_*` keys → `"v4"`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/process/core tests/mind/memory/core tests/mind/world tests/mind/platform`
Expected: PASS. `git grep noteRelativeWords` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add -A src/mind/process/core src/mind/platform/relative-date.ts prompts/core config/default.json tests
git commit -m "feat(time): her own notes and snapshot keep their dates; slip logging goes"
```

---

### Task 7: Her view: owner's calendar, NOW, dividers and glosses

**Files:**
- Modify: `src/mind/process/hot-path/assemble.ts`:
  - `AssembleInput`: add `userTimezone: string` and `nowLine?: string | null`; remove `gapMarkerMinHours`;
  - `factList` zones; the `Now` section; `conversationMessages`;
  - add an exported `viewTurns`.
- Modify: `src/mind/process/hot-path/compose.ts`:
  - compute `theirZone` early;
  - stamps in their zone;
  - pass `userTimezone` and `nowLine`;
  - guard turns through `viewTurns`;
  - core guard facts in her zone.
- Test: `tests/mind/process/hot-path/assemble.test.ts`, `tests/mind/process/hot-path/compose.test.ts`

**Interfaces:**
- Consumes: `anchorTimes` (Task 1, `said` mode), `dayInWords`, `nowLine` (Task 5), `localDateString`.
- Produces: `viewTurns(turns: { text: string; created_at?: Date }[], now: Date, zone: string): string[]`. Texts with a "— Monday 12 January, yesterday —" divider at each date change, and earlier-day texts anchored in `said` mode (rendered later by the provider wrapper).

- [ ] **Step 1: Write the failing tests**

`assemble.test.ts`:

```ts
import { renderTimes } from "@/mind/platform/time-anchors";

test("older messages get a day divider and their time words glossed; today's stay as typed", () => {
  const now = new Date("2026-01-13T09:00:00Z"); // Tuesday
  const texts = viewTurns(
    [
      { text: "my race is tomorrow", created_at: new Date("2026-01-12T20:00:00Z") },
      { text: "today was rough", created_at: new Date("2026-01-12T20:05:00Z") },
      { text: "morning! legs ok", created_at: new Date("2026-01-13T08:50:00Z") },
    ],
    now,
    "UTC",
  ).map((t) => renderTimes(t, now, 6));
  expect(texts[0]).toBe("— Monday 12 January, yesterday —\nmy race is tomorrow (that's today)");
  expect(texts[1]).toBe("today was rough (that's yesterday (Monday 12 January))");
  expect(texts[2]).toBe("— Tuesday 13 January, today —\nmorning! legs ok");
});

test("their things are dated on their calendar, hers on hers, under a Now line", () => {
  const now = new Date("2026-01-12T17:00:00Z"); // Monday 17:00 London, Tuesday 01:00 Singapore
  const { system } = assemblePrompt({
    ...base,
    now,
    timezone: "Asia/Singapore",
    userTimezone: "Europe/London",
    nowLine: "It's Monday 12 January, 17:00 where they are; Tuesday 13 January, 01:00 for you.",
    recentTurns: [],
    retrieval: {
      ...emptyRetrieval(),
      facts: { user: [{ id: "u", content: "Race day.", when: new Date("2026-01-12T09:00:00Z") }], self: [], shared: [] },
    },
    coreMemories: [{ id: "c", content: "Telescope night.", when: new Date("2026-01-12T14:00:00Z") }],
  });
  expect(system).toContain("## Now\nIt's Monday 12 January, 17:00 where they are");
  expect(system).toContain("- Race day. (Monday 12 January, today)");
  expect(system).toContain("- Telescope night. (Monday 12 January, yesterday)");
});
```

In `compose.test.ts`, update the existing gap-marker test, if one asserts "[N days later]", to assert the divider instead.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/process/hot-path/assemble.test.ts`
Expected: FAIL. `viewTurns`, `userTimezone` and the Now section don't exist.

- [ ] **Step 3: Implement**

In `assemble.ts`:

```ts
/**
 * Her view of the conversation: a divider wherever the date changes, and in a message from an
 * earlier day each time word kept with what it means now, worked out from that message's own
 * send time. The stored transcript is never changed.
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
    const divider = day !== lastDay && !(lastDay === null && day === today)
      ? `— ${dayInWords(t.created_at, now, zone)} —\n`
      : "";
    lastDay = day;
    const text = day === today ? t.text : anchorTimes(t.text, { at: t.created_at, zone, said: true });
    return `${divider}${text}`;
  });
}
```

`conversationMessages`: compute `const texts = viewTurns(turns, input.now, input.userTimezone);`, use `content: texts[i]!` for each message, and delete the gap-marker branch and `elapsed()`. Remove `gapMarkerMinHours` from `AssembleInput` and from compose.

`factList` zones in `memorySection`:
- "About them", "Between you" and "What you've told them" use `input.userTimezone`;
- "From your own life" uses `input.timezone`.

Add `section("Now", input.nowLine ?? null)` as the first of the uncached `sections`.

In `compose.ts`:
- Move `const theirZone = await userZone(deps, userId);` up next to `herZone`.
- The summary and read `writtenOn(...)` and the ideas' `writtenOn(...)` use `theirZone`.
- `assemblePrompt({ …, userTimezone: theirZone, nowLine: nowLine(clock.now(), theirZone, herZone) })`.
- The guard input: `recentTurns: viewTurns(recent, clock.now(), theirZone).map((text, i) => ({ role: recent[i]!.role, text, at: recent[i]!.created_at }))`.
- In `guardFacts`, core memories use `herZone`. Pass both zones: `guardFacts(retrieval, herMemories, clock.now(), theirZone, herZone)`, and update its signature.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/process/hot-path tests/mind/process/guard`
Expected: PASS. Assemble and compose tests that pinned the old "[2 days later]" marker or her-zone fact dates update to the new behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/hot-path tests
git commit -m "feat(time): her view dates each thing on its owner's calendar and glosses older messages"
```

---

### Task 8: Reach-outs can't go out on the wrong day

**Files:**
- Modify: `src/mind/process/outreach/candidates.ts` (export `eventDay`), `src/mind/process/outreach/send.ts` (export `wrongDay`, the drop checks after compose)
- Modify: `src/mind/process/hot-path/compose.ts` (`renderReachOut` framing)
- Modify: `src/mind/process/guard/categories.ts` (`wrong_day`), `src/mind/process/guard/outgoing.ts` (the drop)
- Modify: `src/db/schema.ts` (`guardOutcome` adds `"dropped"`), plus a generated migration
- Create: `prompts/reach-out/v4.md`, `prompts/guard/v7.md`; config bumps
- Modify: `evals/guard/reach-out-dates.yaml`, `evals/guard/in-person.yaml`
- Test: `tests/mind/process/outreach/send.test.ts`, `tests/mind/process/hot-path/compose.test.ts`, `tests/mind/process/guard/outgoing.test.ts`

**Interfaces:**
- Consumes: `anchorTimes`, `tokenDates` (Task 1); `dayInWords`.
- Produces:
  - `eventDay(notes: Note[]): Date | null`: the latest dated note
  - `wrongDay(text: string, eventAt: Date, now: Date, zone: string): boolean`
  - guard category `wrong_day`
  - outcome `dropped`

- [ ] **Step 1: Write the failing tests**

`send.test.ts`:

```ts
import { wrongDay } from "@/mind/process/outreach/send";

test("a reach-out naming one day that isn't the event's is the wrong day; two days or none is fine", () => {
  const race = new Date("2026-01-11T09:00:00Z"); // Sunday
  const tue = new Date("2026-01-13T14:00:00Z");
  expect(wrongDay("hey, how'd the race go yesterday", race, tue, "UTC")).toBe(true);
  expect(wrongDay("hey, how'd the race go sunday", race, tue, "UTC")).toBe(false);
  // Two days named (Sunday the 11th, Saturday the 17th): not checked.
  expect(
    wrongDay("how was sunday's race, and is your sister still coming saturday", race, tue, "UTC"),
  ).toBe(false);
  expect(wrongDay("how are the legs", race, tue, "UTC")).toBe(false);
});
```

Also add an integration test with the file's `setup({ winner })`:
- a thread winner whose notes say the race was Sunday 11th (`at` an ISO date, `dated: true`);
- the fake reply "hey, how'd the race go yesterday";
- clock on Tuesday 13th;
- expect `runReachOutSend` to return "dropped" and the log `gate_results.dropped` to be "wrong_day".

`compose.test.ts` (`renderReachOut` is exported):

```ts
test("a reach-out about their thing says whether it's ahead, today or over", () => {
  const md = loadPrompt("reach-out", loadConfig().prompts.reach_out);
  const now = new Date("2026-01-05T12:00:00Z"); // Monday
  const trigger = (iso: string) => ({
    kind: "thread" as const,
    text: "interview",
    factId: null,
    threadId: "t",
    coreMemoryId: null,
    notes: [{ text: "The user has an interview.", at: iso, dated: true }],
  });
  const zones = { hers: "UTC", theirs: "UTC" };
  expect(renderReachOut(md, trigger("2026-01-08T10:00:00Z"), now, zones).slot).toContain(
    "it hasn't happened yet",
  );
  expect(renderReachOut(md, trigger("2026-01-05T15:00:00Z"), now, zones).slot).toContain("It's today");
  expect(renderReachOut(md, trigger("2026-01-04T10:00:00Z"), now, zones).slot).toContain("it's over");
});
```

`tests/mind/process/guard/outgoing.test.ts`: a reach-out whose scripted guard verdict has `{ category: "wrong_day" }` returns `text: ""` and `outcome: "dropped"`. A reply with the same verdict returns its draft with `outcome: "sent_with_violation"`. Follow the file's existing scripted-verdict pattern.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/process/outreach/send.test.ts tests/mind/process/hot-path/compose.test.ts tests/mind/process/guard/outgoing.test.ts`
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

`send.ts`:

```ts
// Their own things: her news is dated on her calendar, so a day she names isn't checked against it.
const DATED = new Set<Candidate["kind"]>(["thread", "user_event", "user_idea"]);

/**
 * A reach-out that names exactly one day, and not the day its topic is on, has the day wrong:
 * "how'd the race go yesterday" for a race two days ago. Two days named, or none, isn't checked.
 */
export function wrongDay(text: string, eventAt: Date, now: Date, zone: string): boolean {
  const anchored = anchorTimes(text, { at: now, zone, known: [eventAt] });
  // Only named days count: "this week" or "since Friday" says nothing wrong about the day.
  const days = [
    ...new Set(
      [...anchored.matchAll(/⟦([^|⟧]+)\|(\w+)\|/g)]
        .filter((m) => !["week", "weekend", "month", "since"].includes(m[2]!))
        .map((m) => m[1]!.slice(0, 10)),
    ),
  ];
  return days.length === 1 && days[0] !== localDateString(eventAt, zone);
}
```

Right after `composed = await composeReachOut(...)`:

```ts
    // The guard drops a reach-out with the day wrong; so does the date check on their own things.
    const eventAt = DATED.has(winner.kind) ? eventDay(winner.notes) : null;
    const zone = zoneOrUtc(await getTimezone(db, userId));
    if (!composed.text || (eventAt && wrongDay(composed.text, eventAt, clock.now(), zone))) {
      await composed.writeGuardLog();
      return await drop("wrong_day");
    }
```

`compose.ts` `renderReachOut`: after `guidance` is built:

```ts
  // Their own things get the day's status from code, so she never asks how a coming thing went.
  const at = ["thread", "user_event", "user_idea"].includes(trigger.kind)
    ? eventDay(trigger.notes ?? [])
    : null;
  const status = !at
    ? null
    : localDateString(at, tz) === localDateString(now, tz)
      ? "today"
      : at > now ? "ahead" : "past";
  const framing = status
    ? (phrases[status] ?? []).map((l) => l.replace("{{day}}", () => dayInWords(at!, now, tz)))
    : [];
  const guidance = [...(phrases[trigger.kind] ?? []), ...framing].join(" ");
```

This replaces the old `const guidance` line. Import `eventDay` and `localDateString`.

`prompts/reach-out/v4.md` = v3 with:
- the `## thread` line changed to "- Something they told you about has reached the point where you'd naturally ask about it.";
- three new sections at the end:

```
## ahead
- It's {{day}}: it hasn't happened yet. Ask how they're feeling about it or wish them luck; don't ask how it went.

## today
- It's today ({{day}}).

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

`schema.ts`: `guardOutcome` gains `"dropped"`. Then run `pnpm db:generate` (the migration adds the enum value) and check the generated SQL is `ALTER TYPE "public"."guard_outcome" ADD VALUE 'dropped';`.

`prompts/guard/v7.md` = v6 with:
- the bullet "- Getting a day wrong is invented_detail too. …" replaced by: `- wrong_day: putting something on the wrong day. The dates in WHY SPICA IS WRITING FIRST and WHAT SPICA REMEMBERS say how far each thing is from NOW ("Sunday 11 January, yesterday"); a message that puts it on another day ("isn't the race this morning" for yesterday's race, "clear skies tonight" for last night), asks about a past thing as still ahead, or asks how a coming thing went ("how'd it go" when it's in 3 days) is wrong_day, not invented_detail.`
- the honesty heading's list mentions `wrong_day`.

Config: `reach_out` v4, `guard` v7.

Evals:
- **`reach-out-dates.yaml`:** `misdated-this-morning`, `upcoming-after-it-happened` and `stale-tonight` expect `[wrong_day]`. Add:

  ```yaml
    - name: asked-how-it-went-before-it-happened
      kind: reach_out
      now: "Monday, 5 January 2026 at 12:00 where they are"
      reason: |-
        interview: The user has an interview Thursday 8 January.
        - The user has an interview Thursday 8 January. (Thursday 8 January, in 3 days)
      message: "hey, thursday's the day right? how'd it go"
      expect: [wrong_day]
  ```

- **`in-person.yaml`** (B127): give `ip-offer-by-text` a second recent turn, `{ role: user, text: "wish we could grab a coffee before it lol" }`, and keep `expect: pass`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/process/outreach tests/mind/process/hot-path tests/mind/process/guard tests/evals tests/mind/platform/prompts.test.ts`
Expected: PASS. Then `pnpm eval --llm=fake --compare` (free): no regressions against the baseline.

- [ ] **Step 5: Commit**

```bash
git add -A src/mind/process/outreach src/mind/process/hot-path/compose.ts src/mind/process/guard src/db prompts/reach-out prompts/guard config/default.json evals/guard tests
git commit -m "feat(outreach): code frames their day, checks the drafted day, and a wrong day drops the reach-out"
```

---

### Task 9: Phase 16b exit test

**Files:**
- Create: `tests/exit/phase-16b.test.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the exit test**

```ts
/**
 * Phase 16b exit, all fake: stored text keeps the date each time phrase meant and every prompt
 * reads it on its own day; a weekday takes the date she was shown; extract points by its label
 * and their message; her view glosses older messages; a reach-out on the wrong day is dropped.
 * A's anchors never reach B, the time wrapper sends no raw token to a model, and nothing moves
 * in core.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun, liveSummary } from "@/db/repos/user/user-mind";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { withTimeRendering } from "@/mind/platform/llm/render-net";
import { renderTimes, tokenDates } from "@/mind/platform/time-anchors";
import { viewTurns } from "@/mind/process/hot-path/assemble";
import { wrongDay } from "@/mind/process/outreach/send";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { userSummarise } from "@/mind/process/user/summarise";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const D = 86_400_000;
const summaryRow = (content: string, at: Date) => ({
  subject: "shared" as const,
  kind: "summary" as const,
  content,
  payload: { where_things_stand: content, whats_live: "", how_i_feel: "" },
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
  const row = await insertFact(getTestDb(), u, summaryRow("Sister visits tomorrow.", day1));
  expect(renderTimes(row.content, new Date(day1.getTime() + D), 6)).toBe("Sister visits today.");
  expect(renderTimes(row.content, new Date(day1.getTime() + 2 * D), 6)).toBe(
    "Sister visits yesterday (Tuesday 13 January).",
  );
});

test("2: a weekday in her summary takes the date of the memory she was shown", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const race = new Date(d.clock.now().getTime() + 6 * D);
  await insertFact(d.db, u, {
    subject: "user",
    kind: "event",
    content: "The user runs a half marathon.",
    embedding: vec(),
    created_at: d.clock.now(),
    occurred_at: race,
    status: "open",
    salience: 0.8,
    valence: 0.3,
    confidence: 0.9,
    source: "turn",
  });
  d.llm.handlers.user_summarise = () => ({ where_things_stand: "Race Sunday.", whats_live: "", how_i_feel: "" });
  const run = (await insertRun(d.db, u, {
    sourceRef: "exchange:a",
    triggers: [{ kind: "salient_fact", salience: 0.9 }],
    localDate: "2026-01-05",
    now: d.clock.now(),
    cap: 9,
  }))!;
  await userSummarise({ ...d, snapshot: null }, run, await loadRunInputs(d, u));
  const live = (await liveSummary(d.db, u))!;
  expect(tokenDates(live.content)[0]!.toISOString().slice(0, 10)).toBe(race.toISOString().slice(0, 10));
});

test("3: her view keeps an older message's words and says what they mean now", () => {
  const now = new Date("2026-01-13T09:00:00Z");
  const [line] = viewTurns([{ text: "my race is tomorrow", created_at: new Date("2026-01-12T20:00:00Z") }], now, "UTC");
  expect(renderTimes(line!, now, 6)).toBe("— Monday 12 January, yesterday —\nmy race is tomorrow (that's today)");
});

test("4: a reach-out that puts the race on the wrong day is caught", () => {
  expect(
    wrongDay("hey, how'd the race go yesterday", new Date("2026-01-11T09:00:00Z"), new Date("2026-01-13T14:00:00Z"), "UTC"),
  ).toBe(true);
});

const TOKEN = "CANARY-16b4e1";
const CORE_TABLES = ["core_memory", "core_state", "core_goal", "core_snapshot", "world_event"];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`));
    parts.push(...res.rows.map((r) => String(r.j)));
  }
  return parts.join("\n");
}

test("5: leak canary and raw tokens: A's anchors never reach B; no token reaches the model; core unchanged", async () => {
  const base = makeTestDeps();
  const fake = new FakeLLMProvider();
  const d = { ...base, llm: withTimeRendering(fake, base.clock, 6) };
  const a = await createTestUser("alice");
  const b = await createTestUser("bob");
  for (const u of [a, b]) await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  await insertFact(d.db, a, { ...summaryRow(`Gig ${TOKEN} tomorrow.`, d.clock.now()), kind: "event", subject: "user" });
  await insertFact(d.db, b, { ...summaryRow("Gig at the Lexington tomorrow.", d.clock.now()), kind: "event", subject: "user" });
  const before = await coreDump();
  fake.handlers.user_summarise = () => ({ where_things_stand: "Fine.", whats_live: "", how_i_feel: "" });
  const run = async (u: string, ref: string) =>
    (await insertRun(d.db, u, { sourceRef: ref, triggers: [{ kind: "salient_fact", salience: 0.9 }], localDate: "2026-01-05", now: d.clock.now(), cap: 9 }))!;
  await userSummarise({ ...d, snapshot: null }, await run(a, "exchange:a"), await loadRunInputs(d, a));
  const bStart = fake.structuredCalls.length;
  await userSummarise({ ...d, snapshot: null }, await run(b, "exchange:b"), await loadRunInputs(d, b));
  for (const c of fake.structuredCalls.slice(bStart)) expect(JSON.stringify(c)).not.toContain(TOKEN);
  for (const c of fake.structuredCalls) expect(c.input + c.system).not.toContain("⟦");
  expect(await coreDump()).toBe(before);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test tests/exit/phase-16b.test.ts`
Expected: PASS. If a test fails, fix the code, never the assertion. If `userSummarise`'s deps or the run trigger shape differ, copy them from `tests/exit/phase-16.test.ts`.

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
  - §9: user-mind hints, NOW in both zones, prompt versions;
  - §10.3: Now section, dividers and glosses, owner's calendar;
  - §10.4 and §12.3: extract v10, the cross-check, anchoring at insert, `when.ts` deleted;
  - §10.5: guard v7 `wrong_day`, outcome `dropped`;
  - §13: framing, the code date check, the drop;
  - §17: the review renders absolute;
  - §20: the 16b row becomes built.
- `docs/spec-v3-history.md`: the 16b row; B127 done (its test fixed).
- `DECISIONS.md` rows:
  - no backfill;
  - thread titles not anchored (matched by exact title);
  - world event text, goals and the inspector stay raw;
  - core writers pass no shown dates (their bare weekdays are rare);
  - the code date check covers their things only;
  - the said-gloss format;
  - each ruling from the ledger.
- `CLAUDE.md` "Current phase"; memory `phase-status`.
- Delete this plan and the design doc after the build (history is in git).

- [ ] **Step 1:** `spica-close`, in order:
  - `pnpm format`, `pnpm typecheck`, `pnpm lint`;
  - the full `pnpm test` (once);
  - `pnpm test tests/exit/phase-16b.test.ts`;
  - `pnpm eval --llm=fake --compare`;
  - `git grep -n "noteRelativeWords\|applyWhen\|resolveWhen\|dayLabel"` returns nothing in `src`;
  - the `scope-reviewer` on the diff (told not to run tests);
  - the spec write-back;
  - commit.
- [ ] **Step 2:** The paid runs (Ethan, 2026-10-24), each through `review-run`, with the hook asking first:
  - `pnpm review:world-outreach`: misdated reach-outs, and the leftover relative words list, against `evals/results/review-2026-10-22T08-27-19-368Z.md`;
  - `pnpm eval:guard`: the `wrong_day` cases and `ip-offer-by-text`.
