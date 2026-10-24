# Phase 17a: Labelling the Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pieces, code-made layers, layered label schema with its checks, the time resolver and extract v12, then replay them over the recorded runs and invented chat conversations, in two processing units, with thinking off and on.

**Architecture:**
- Pure modules in `src/mind`:
  - `platform/time-labels.ts` resolves time meanings to dates;
  - `memory/user/pieces.ts` numbers messages into citable pieces and maps words back to character ranges;
  - `memory/user/layers.ts` derives conversations and exchanges from turns;
  - `memory/user/annotations.ts` holds v12's output schema and the checks that tie labels to the transcript;
  - `memory/user/label-input.ts` builds the call's input.
- An eval tool (`evals/extract-replay.ts` with `evals/lib/*`) runs the calls through the logged real provider and writes one review file.
- Nothing in the live pipeline changes; `prompts.extract` stays v11.

**Tech Stack:** TypeScript (~6.0), zod 4, Vitest, pnpm, tsx, Anthropic SDK 0.127.0 through `evals/lib/call-log.ts`.

**Spec:** `docs/2026-10-25-phase-17a-labelling-the-conversation-design.md` (slice) and `docs/2026-10-25-phase-17-labelled-memory-design.md` (phase). Read both first.

## Global Constraints

- **Work and commits:**
  - Work on branch `phase-17a` (Task 0); never commit to `main`.
  - Commit messages end with the attribution lines from the session's system reminder.
- **Code style:**
  - Every new file starts with a short plain-English header comment saying what it is, in v3 vocabulary.
  - Comments say why, never where from. No spec sections, phases, slice names or review item numbers (N7, B1, T3…) in code or tests.
  - Prettier at 100 columns; run `pnpm format` before each commit if a file was hand-wrapped.
- **`src/mind` rules:**
  - framework-free; no `Date.now()`, no `new Date()` without arguments, no `process.env`;
  - ESLint runs on every edited TS file.
- **Prompts:** `prompts.extract` in `config/default.json` stays `v11`. `prompts/extract/v12.md` is read only by the replay.
- **No retries:** a label that fails a check is dropped with its reason; a call that fails is recorded and the replay moves on.
- **Paid calls:**
  - Every real model call goes through `realProvider` from `evals/lib/call-log.ts`.
  - The paid replay (Task 11) needs Ethan's explicit go-ahead through the `review-run` skill.
- **Tests:**
  - Run targeted tests only (`pnpm test <path>`). The full suite runs once, in Task 10.
  - The test DB must be up (`pnpm db:up`), because Vitest's global setup migrates it.
  - Only one test process at a time.
- **Windows:** write files with the Write/Edit tools, never shell heredocs, since backslashes in regexes get mangled.

## Review Focus

1. **The model writes an enum value outside its list** (for example act `"explains"`). Structured output doesn't enforce enums in this SDK, so `schema.parse` throws inside `classifyJson`. The replay must record that call as failed and carry on, not crash. Pinned in Task 9 (a scripted call that throws is recorded and the loop continues).
2. **A label cites a piece id that doesn't exist or is malformed** (`"3-2"`, `"m3.1"`). It must be dropped as `bad_ref`, never throw. Pinned in Task 4.
3. **Quoted words differ from the text in case or spacing, or contain regex characters** (`"That's   Sunday"`, `"lol?"`). They must be found when present and never throw. Pinned in Task 2.
4. **The model reuses an id from "already labelled"** in exchange mode. The new label is dropped and the earlier one stays as it was. Pinned in Task 4.
5. **A conversation where no reply ends an exchange, or an exchange with no matching call-log entry.** Conversation mode still labels it, with no threads or interests, and the replay doesn't throw. Pinned in Tasks 7 and 9.

---

### Task 0: Branch

- [ ] **Step 1: Create the branch**

Run: `git checkout -b phase-17a`
Expected: `Switched to a new branch 'phase-17a'`

- [ ] **Step 2: Bring the design docs onto the branch**

```bash
git add docs/2026-10-25-phase-17-labelled-memory-design.md docs/2026-10-25-phase-17a-labelling-the-conversation-design.md docs/superpowers/plans/2026-10-25-phase-17a-labelling-the-conversation.md
git commit -m "docs: Phase 17 (labelled memory) and 17a design docs and plan"
```

(Leave `docs/2026-10-21-vision-check.md` untracked: it is Ethan's.)

---

### Task 1: Time labels: resolve a time meaning to a date

**Files:**
- Create: `src/mind/platform/time-labels.ts`
- Test: `tests/mind/platform/time-labels.test.ts`

**Interfaces:**
- Consumes: `shiftLocalDate(date: string, days: number): string` from `src/mind/platform/timezone.ts`.
- Produces:
  - `WEEKDAYS` (readonly tuple, Sunday first);
  - `TimeMeaningSchema` (zod object);
  - `type TimeMeaning`;
  - `type ResolvedTime = { date: string; precision: "day" | "week" | "weekend" | "month"; part: TimeMeaning["part"]; clock: string | null; span: "at" | "since" | "until"; rough: boolean }`;
  - `resolveTime(meaning: TimeMeaning, base: string): ResolvedTime | null`;
  - `renderResolved(t: ResolvedTime): string`.

- [ ] **Step 1: Write the failing test**

```ts
/** Time labels: a model's reading of time words resolves to the day they meant. */
import { expect, test } from "vitest";
import { renderResolved, resolveTime, type TimeMeaning } from "@/mind/platform/time-labels";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/mind/platform/time-labels.test.ts`
Expected: FAIL, failed to resolve import `@/mind/platform/time-labels`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Time labels: what time words mean, in a fixed structure a model fills and code resolves. The
 * model says which day the words point at ("the next Friday", "three days back"); code counts it
 * from the day they were said. No model works out a date, and no code reads the words.
 */
import { z } from "zod";
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/mind/platform/time-labels.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/mind/platform/time-labels.ts tests/mind/platform/time-labels.test.ts
git commit -m "feat(time): time labels: a model's reading of time words resolves to a date in code"
```

---

### Task 2: Pieces: numbered addresses and coordinates

**Files:**
- Create: `src/mind/memory/user/pieces.ts`
- Test: `tests/mind/memory/user/pieces.test.ts`

**Interfaces:**
- Consumes: `formatLocal(at: Date, tz: string | null): string` from `src/mind/platform/timezone.ts`.
- Produces:
  - `type Speaker = "user" | "spica"`;
  - `type Message = { id: string; speaker: Speaker; text: string; at: Date }`;
  - `type Coordinate = { turnId: string; start: number; end: number }`;
  - `type Piece = { id: string; message: Message; start: number; end: number; text: string; isNew: boolean }`;
  - `splitRanges(text: string): [number, number][]`;
  - `numberPieces(messages: Message[], firstNew: number): Piece[]`;
  - `coordinate(piece: Piece): Coordinate`;
  - `findPhrase(piece: Piece, words: string): Coordinate | null`;
  - `renderPieces(pieces: Piece[], zone: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
/** Pieces: messages numbered into addresses, and cited words mapped back to where they sit. */
import { expect, test } from "vitest";
import {
  coordinate,
  findPhrase,
  numberPieces,
  renderPieces,
  splitRanges,
  type Message,
} from "@/mind/memory/user/pieces";

const msg = (
  id: string,
  speaker: Message["speaker"],
  text: string,
  iso = "2026-01-07T20:41:00Z",
): Message => ({ id, speaker, text, at: new Date(iso) });
const texts = (text: string) => splitRanges(text).map(([s, e]) => text.slice(s, e));

test("a message splits at its line breaks and after sentence ends, trimmed", () => {
  expect(texts("hey sam\n\nthe half marathon week, right? nerves or excitement or both")).toEqual([
    "hey sam",
    "the half marathon week, right?",
    "nerves or excitement or both",
  ]);
  expect(texts("nervous more than ready tbh. and no half marathon yet lol, that's sunday")).toEqual([
    "nervous more than ready tbh.",
    "and no half marathon yet lol, that's sunday",
  ]);
  expect(texts("wait...")).toEqual(["wait..."]);
  expect(texts("   ")).toEqual([]);
});

test("pieces are numbered by message, keep their ranges and know whether they are new", () => {
  const pieces = numberPieces(
    [msg("a", "spica", "is it thursday?"), msg("b", "user", "   "), msg("c", "user", "yep. moved to friday")],
    1,
  );
  expect(pieces.map((p) => [p.id, p.text, p.isNew])).toEqual([
    ["1.1", "is it thursday?", false],
    ["3.1", "yep.", true],
    ["3.2", "moved to friday", true],
  ]);
  expect(coordinate(pieces[2]!)).toEqual({ turnId: "c", start: 5, end: 20 });
});

test("a phrase is found inside its piece whatever its case and spacing, or not at all", () => {
  const [piece] = numberPieces([msg("m", "user", "and no half marathon yet lol, that's sunday")], 0);
  const found = findPhrase(piece!, "That's   Sunday")!;
  expect(found.turnId).toBe("m");
  expect(piece!.message.text.slice(found.start, found.end)).toBe("that's sunday");
  expect(findPhrase(piece!, "saturday")).toBeNull();
  expect(findPhrase(piece!, "lol?")).toBeNull();
  expect(findPhrase(piece!, "  ")).toBeNull();
});

test("the call reads a message's first piece with its speaker and time, the rest with the speaker", () => {
  const pieces = numberPieces(
    [msg("a", "user", "so\nthey moved it"), msg("b", "spica", "noo why", "2026-01-07T20:42:00Z")],
    0,
  );
  expect(renderPieces(pieces, "UTC")).toBe(
    [
      "[1.1] User · Wed 2026-01-07 20:41 (UTC): so",
      "[1.2] User: they moved it",
      "[2.1] Spica · Wed 2026-01-07 20:42 (UTC): noo why",
    ].join("\n"),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/mind/memory/user/pieces.test.ts`
Expected: FAIL, failed to resolve import `@/mind/memory/user/pieces`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Pieces: the numbered addresses a labelling call cites. Each message is split at its line breaks
 * (her bubbles) and after sentence ends, and numbered "<message>.<piece>" from the first message
 * shown. A piece is an address, never a unit of meaning: a label covers any set of them. Every
 * piece, and every phrase quoted inside one, maps back to a character range in its message; that
 * range is what gets kept, so the split can change without breaking anything stored.
 */
import { formatLocal } from "@/mind/platform/timezone";

export type Speaker = "user" | "spica";
export type Message = { id: string; speaker: Speaker; text: string; at: Date };
/** A character range in one message's text: the only way a label points at words. */
export type Coordinate = { turnId: string; start: number; end: number };
export type Piece = {
  id: string;
  message: Message;
  start: number;
  end: number;
  text: string;
  /** Part of what is being labelled now; older pieces are there to be read and pointed back at. */
  isNew: boolean;
};

const LINE = /[^\n]+/g;
const SENTENCE_END = /[.!?]+(?=\s)/g;

/** Messages from index `firstNew` on are new. A message with no words keeps its number. */
export function numberPieces(messages: Message[], firstNew: number): Piece[] {
  return messages.flatMap((message, i) =>
    splitRanges(message.text).map(([start, end], k) => ({
      id: `${i + 1}.${k + 1}`,
      message,
      start,
      end,
      text: message.text.slice(start, end),
      isNew: i >= firstNew,
    })),
  );
}

/** The character ranges of a message's pieces: its lines, each cut after a sentence end, trimmed. */
export function splitRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const line of text.matchAll(LINE)) {
    let start = 0;
    for (const end of line[0].matchAll(SENTENCE_END)) {
      const stop = end.index + end[0].length;
      pushTrimmed(ranges, line[0], line.index, start, stop);
      start = stop;
    }
    pushTrimmed(ranges, line[0], line.index, start, line[0].length);
  }
  return ranges;
}

export function coordinate(piece: Piece): Coordinate {
  return { turnId: piece.message.id, start: piece.start, end: piece.end };
}

/** Where `words` sit inside the piece, ignoring case and spacing; null when they aren't there. */
export function findPhrase(piece: Piece, words: string): Coordinate | null {
  const tokens = words.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (tokens.length === 0) return null;
  const match = new RegExp(tokens.join("\\s+"), "i").exec(piece.text);
  if (!match) return null;
  const start = piece.start + match.index;
  return { turnId: piece.message.id, start, end: start + match[0].length };
}

/** The pieces as the call reads them: a message's first piece carries its speaker and time. */
export function renderPieces(pieces: Piece[], zone: string): string {
  let last: string | null = null;
  return pieces
    .map((p) => {
      const who = p.message.speaker === "user" ? "User" : "Spica";
      const head = p.message.id === last ? who : `${who} · ${formatLocal(p.message.at, zone)}`;
      last = p.message.id;
      return `[${p.id}] ${head}: ${p.text}`;
    })
    .join("\n");
}

function pushTrimmed(
  ranges: [number, number][],
  line: string,
  offset: number,
  start: number,
  end: number,
): void {
  while (start < end && /\s/.test(line[start]!)) start += 1;
  while (end > start && /\s/.test(line[end - 1]!)) end -= 1;
  if (end > start) ranges.push([offset + start, offset + end]);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/mind/memory/user/pieces.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/mind/memory/user/pieces.ts tests/mind/memory/user/pieces.test.ts
git commit -m "feat(memory): pieces: numbered addresses into messages, mapped back to character ranges"
```

---

### Task 3: Code-made layers: conversations and exchanges

**Files:**
- Create: `src/mind/memory/user/layers.ts`
- Test: `tests/mind/memory/user/layers.test.ts`

**Interfaces:**
- Consumes:
  - `type Turn` from `src/db/repos/user/session-log.ts`; `role` is `"user" | "companion"`, `trigger` is `"reach_out" | "backchannel" | … | null`;
  - `type Message` from Task 2.
- Produces:
  - `type LayerTurn = Pick<Turn, "id" | "role" | "text" | "created_at" | "session_id" | "reply_to" | "trigger">`;
  - `type Exchange = { burst: string[]; replyId: string }`;
  - `type Conversation = { id: string; turns: LayerTurn[]; exchanges: Exchange[] }`;
  - `conversations(turns: LayerTurn[]): Conversation[]`;
  - `messagesOf(turns: LayerTurn[]): Message[]`.

- [ ] **Step 1: Write the failing test**

```ts
/** Code-made layers: conversations and exchanges come from the transcript alone. */
import { expect, test } from "vitest";
import { conversations, messagesOf, type LayerTurn } from "@/mind/memory/user/layers";

const turn = (
  id: string,
  role: LayerTurn["role"],
  minute: number,
  extra: Partial<LayerTurn> = {},
): LayerTurn => ({
  id,
  role,
  text: id,
  created_at: new Date(Date.UTC(2026, 0, 7, 20, minute)),
  session_id: "s1",
  reply_to: null,
  trigger: null,
  ...extra,
});

test("a reply ends an exchange with the user turns it answers; a reach-out is an exchange alone", () => {
  const result = conversations([
    turn("c3", "companion", 36, { reply_to: "u4" }),
    turn("r1", "companion", 0, { trigger: "reach_out", session_id: "s0" }),
    turn("u1", "user", 30),
    turn("b1", "companion", 30, { trigger: "backchannel" }),
    turn("u2", "user", 31),
    turn("c1", "companion", 32, { reply_to: "u2" }),
    turn("u3", "user", 33),
    turn("u4", "user", 34),
    turn("c2", "companion", 35, { reply_to: "u3" }),
  ]);
  expect(result.map((c) => [c.id, c.turns.map((t) => t.id)])).toEqual([
    ["s0", ["r1"]],
    ["s1", ["u1", "b1", "u2", "c1", "u3", "u4", "c2", "c3"]],
  ]);
  expect(result[0]!.exchanges).toEqual([{ burst: [], replyId: "r1" }]);
  expect(result[1]!.exchanges).toEqual([
    { burst: ["u1", "u2"], replyId: "c1" },
    { burst: ["u3"], replyId: "c2" },
    { burst: ["u4"], replyId: "c3" },
  ]);
});

test("turns become messages with a speaker", () => {
  expect(messagesOf([turn("u1", "user", 0), turn("c1", "companion", 1)])).toEqual([
    { id: "u1", speaker: "user", text: "u1", at: new Date(Date.UTC(2026, 0, 7, 20, 0)) },
    { id: "c1", speaker: "spica", text: "c1", at: new Date(Date.UTC(2026, 0, 7, 20, 1)) },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/mind/memory/user/layers.test.ts`
Expected: FAIL, failed to resolve import `@/mind/memory/user/layers`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The layers code makes from the transcript alone: conversations (the turns sharing a session) and
 * exchanges (a reply of hers with the run of user turns it answers, or a reach-out on its own). No
 * model is involved, so these are always right about what they are.
 */
import type { Turn } from "@/db/repos/user/session-log";
import type { Message } from "./pieces";

export type LayerTurn = Pick<
  Turn,
  "id" | "role" | "text" | "created_at" | "session_id" | "reply_to" | "trigger"
>;
/** What one cold-path job reads: the user turns her reply answers (the burst), then the reply. */
export type Exchange = { burst: string[]; replyId: string };
export type Conversation = { id: string; turns: LayerTurn[]; exchanges: Exchange[] };

export function conversations(turns: LayerTurn[]): Conversation[] {
  const byId = new Map<string, Conversation>();
  let burst: string[] = [];
  for (const turn of [...turns].sort((a, b) => a.created_at.getTime() - b.created_at.getTime())) {
    const conversation = byId.get(turn.session_id) ?? {
      id: turn.session_id,
      turns: [],
      exchanges: [],
    };
    byId.set(turn.session_id, conversation);
    conversation.turns.push(turn);
    if (turn.role === "user") {
      burst.push(turn.id);
      continue;
    }
    // Only a reply or a reach-out ends an exchange; a backchannel or a busy note sits inside one.
    if (turn.reply_to) {
      const answered = burst.indexOf(turn.reply_to) + 1;
      conversation.exchanges.push({ burst: burst.slice(0, answered), replyId: turn.id });
      burst = burst.slice(answered);
    } else if (turn.trigger === "reach_out") {
      conversation.exchanges.push({ burst: [], replyId: turn.id });
    }
  }
  return [...byId.values()];
}

export function messagesOf(turns: LayerTurn[]): Message[] {
  return turns.map((t) => ({
    id: t.id,
    speaker: t.role === "user" ? "user" : "spica",
    text: t.text,
    at: t.created_at,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/mind/memory/user/layers.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/mind/memory/user/layers.ts tests/mind/memory/user/layers.test.ts
git commit -m "feat(memory): code-made layers: conversations and exchanges from the transcript"
```

---

### Task 4: Annotations: v12's output schema and the checks

**Files:**
- Create: `src/mind/memory/user/annotations.ts`
- Test: `tests/mind/memory/user/annotations.test.ts`

**Interfaces:**
- Consumes:
  - from Task 1: `TimeMeaningSchema`, `resolveTime`, `type TimeMeaning`, `type ResolvedTime`;
  - from Task 2: `findPhrase`, `coordinate`, `type Piece`, `type Speaker`, `type Coordinate`;
  - `localDateString(at: Date, tz: string): string` (timezone);
  - `clamp` (`src/mind/platform/math.ts`);
  - `factKind`, `claimKind`, `entityType` (`src/db/schema.ts`);
  - `BID_RESPONSES`, `IntimacySchema`, `RelationshipSignalsSchema` (`src/mind/state/user/relationship/signals.ts`);
  - `IDIOLECT_TYPES` (`./idiolect`).
- Produces:
  - `ACTS`, `type Act`;
  - `LabelsSchema`, `type Labels`;
  - `type CheckedMove = { id: string; pieces: string[]; coords: Coordinate[]; speaker: Speaker; act: Act; repliesTo: string | null }`;
  - `type CheckedMention`, `type CheckedTime`, `type CheckedProposition`, `type CheckedThread`, `type CheckedIdiolect`;
  - `type DropReason`, `type Drop = { layer: string; id: string; reason: DropReason }`;
  - `type CheckedLabels`;
  - `emptyLabels(): CheckedLabels`;
  - `mergeLabels(a: CheckedLabels, b: CheckedLabels): CheckedLabels`;
  - `type CheckContext = { pieces: Piece[]; zone: string; threadIds: string[]; earlier: CheckedLabels }`;
  - `checkLabels(raw: Labels, ctx: CheckContext): CheckedLabels`.

- [ ] **Step 1: Write the failing test**

```ts
/** Labels: one call's layers held to the transcript, and dropped with a reason when they aren't. */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { expect, test } from "vitest";
import {
  checkLabels,
  emptyLabels,
  LabelsSchema,
  type CheckContext,
  type CheckedLabels,
  type CheckedMove,
  type Labels,
} from "@/mind/memory/user/annotations";
import { numberPieces, type Message } from "@/mind/memory/user/pieces";

const at = (minute: number) => new Date(Date.UTC(2026, 0, 7, 20, minute)); // Wed 7 January 2026
const messages: Message[] = [
  { id: "a", speaker: "spica", text: "is the interview still thursday?", at: at(30) },
  { id: "b", speaker: "spica", text: "also did you ever book the train", at: at(30) },
  { id: "c", speaker: "user", text: "so\nthey moved it\nfriday now lol", at: at(41) },
  { id: "d", speaker: "user", text: "and yes booked", at: at(42) },
  { id: "e", speaker: "spica", text: "friday's close enough now", at: at(43) },
  { id: "f", speaker: "user", text: "and the night before i'm prepping", at: at(44) },
];
// Messages 1 and 2 were labelled by an earlier call; 3 to 6 are new.
const pieces = numberPieces(messages, 2);
const move = (id: string, ids: string[], speaker: CheckedMove["speaker"], act: CheckedMove["act"]) =>
  ({ id, pieces: ids, coords: [], speaker, act, repliesTo: null }) satisfies CheckedMove;
const earlier: CheckedLabels = {
  ...emptyLabels(),
  moves: [move("m1", ["1.1"], "spica", "asks"), move("m2", ["2.1"], "spica", "asks")],
};
const ctx: CheckContext = { pieces, zone: "UTC", threadIds: ["th1"], earlier };

type Proposition = Labels["propositions"][number];
const prop = (p: Partial<Proposition>): Proposition => ({
  id: "p",
  moves: [],
  subject: "user",
  kind: "event",
  label: "x",
  status: "planned",
  times: [],
  mentions: [],
  thread_id: null,
  new_thread: null,
  updates: null,
  salience: 0.7,
  valence: 0,
  confidence: 0.9,
  claim_kind: null,
  ...p,
});
const time = (t: Partial<Labels["times"][number]>): Labels["times"][number] => ({
  id: "t",
  piece: "3.3",
  words: "friday",
  from: "said",
  unit: "weekday",
  shift: 1,
  weekday: "friday",
  month: null,
  day_of_month: null,
  part: null,
  clock: null,
  span: "at",
  rough: false,
  ...t,
});
/** A reply over three bubbles correcting her first question, and a late yes to her second. */
function base(): Labels {
  return {
    moves: [
      { id: "m3", pieces: ["3.1", "3.2", "3.3"], act: "corrects", replies_to: "m1" },
      { id: "m4", pieces: ["4.1"], act: "confirms", replies_to: "m2" },
    ],
    mentions: [
      {
        id: "e1",
        piece: "3.2",
        words: "it",
        refers_to: "th1",
        name: null,
        type: null,
        subject: null,
        relation: null,
      },
    ],
    times: [time({ id: "t1", words: "Friday" })],
    propositions: [
      prop({ id: "p1", moves: ["m3"], label: "job interview", times: ["t1"], mentions: ["e1"], thread_id: "th1" }),
      prop({ id: "p2", moves: ["m4", "m2"], label: "train ticket", status: "happened" }),
    ],
    threads: [
      {
        action: "touch",
        thread_id: "th1",
        title: "job interview",
        subject: "user",
        stakes: "high",
        checkpoint: "t1",
        propositions: ["p1"],
      },
    ],
    idiolect: [],
    relationship: null,
    intimacy: { user_disclosure: 0.1, user_responsiveness: null, moves: ["m3"] },
    bid_response: { response: "toward", move: "m4" },
  };
}
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test("a reply spread over three bubbles and a late answer to an earlier question both hold", () => {
  const out = checkLabels(base(), ctx);
  expect(out.drops).toEqual([]);
  expect(out.moves.map((m) => [m.id, m.speaker, m.repliesTo])).toEqual([
    ["m3", "user", "m1"],
    ["m4", "user", "m2"],
  ]);
  expect(out.moves[0]!.coords).toEqual([
    { turnId: "c", start: 0, end: 2 },
    { turnId: "c", start: 3, end: 16 },
    { turnId: "c", start: 17, end: 31 },
  ]);
  expect(out.times[0]!.resolved?.date).toBe("2026-01-09");
  expect(out.times[0]!.coord).toEqual({ turnId: "c", start: 17, end: 23 });
  expect(ids(out.propositions)).toEqual(["p1", "p2"]);
  expect(out.threads[0]!.checkpointAt?.date).toBe("2026-01-09");
  expect(out.bid_response).toEqual({ response: "toward", move: "m4" });
});

test("her guess never becomes their fact, and neither does an old fact on a new reaction", () => {
  const guess = base();
  guess.moves.push({ id: "m5", pieces: ["5.1"], act: "guesses", replies_to: null });
  guess.propositions.push(prop({ id: "p3", moves: ["m5"], label: "studio deadline" }));
  expect(checkLabels(guess, ctx).drops).toEqual([
    { layer: "proposition", id: "p3", reason: "wrong_speaker" },
  ]);

  const reaction = base();
  reaction.moves[1] = { id: "m4", pieces: ["4.1"], act: "reacts", replies_to: "m2" };
  expect(checkLabels(reaction, ctx).drops).toEqual([
    { layer: "proposition", id: "p2", reason: "wrong_speaker" },
  ]);
});

test("labels resting only on earlier messages are not new", () => {
  const raw = base();
  raw.propositions.push(prop({ id: "p3", moves: ["m1", "m2"] }));
  raw.times.push(time({ id: "t2", piece: "1.1", words: "thursday" }));
  expect(checkLabels(raw, ctx).drops).toEqual([
    { layer: "time", id: "t2", reason: "nothing_new" },
    { layer: "proposition", id: "p3", reason: "nothing_new" },
  ]);
});

test("a move mixing speakers, or replying to something said after it, falls with what rests on it", () => {
  const fallen = [
    { layer: "proposition", id: "p1", reason: "bad_ref" },
    { layer: "thread", id: "th1", reason: "bad_ref" },
    { layer: "intimacy", id: "intimacy", reason: "bad_ref" },
  ];
  const mixed = base();
  mixed.moves[0] = { id: "m3", pieces: ["3.1", "5.1"], act: "corrects", replies_to: "m1" };
  expect(checkLabels(mixed, ctx).drops).toEqual([
    { layer: "move", id: "m3", reason: "bad_move" },
    ...fallen,
  ]);

  const backwards = base();
  backwards.moves[0] = { id: "m3", pieces: ["3.1", "3.2", "3.3"], act: "corrects", replies_to: "m4" };
  expect(checkLabels(backwards, ctx).drops).toEqual([
    { layer: "move", id: "m3", reason: "bad_move" },
    ...fallen,
  ]);
});

test("time words must be in their piece, and every reference must exist", () => {
  const missing = base();
  missing.times[0] = time({ id: "t1", words: "saturday" });
  expect(checkLabels(missing, ctx).drops).toEqual([
    { layer: "time", id: "t1", reason: "words_missing" },
    { layer: "proposition", id: "p1", reason: "bad_ref" },
    { layer: "thread", id: "th1", reason: "bad_ref" },
  ]);

  const broken = base();
  broken.mentions[0] = { ...broken.mentions[0]!, piece: "3-2" };
  broken.moves.push({ id: "m6", pieces: ["m3.1"], act: "states", replies_to: null });
  broken.propositions[1] = { ...broken.propositions[1]!, thread_id: "th9" };
  const drops = checkLabels(broken, ctx).drops;
  expect(drops).toContainEqual({ layer: "move", id: "m6", reason: "bad_ref" });
  expect(drops).toContainEqual({ layer: "mention", id: "e1", reason: "bad_ref" });
  expect(drops).toContainEqual({ layer: "proposition", id: "p2", reason: "bad_ref" });
});

test("an id already used in this conversation is rejected, and the earlier label stays", () => {
  const raw = base();
  raw.moves.push({ id: "m1", pieces: ["4.1"], act: "states", replies_to: null });
  const out = checkLabels(raw, ctx);
  expect(out.drops).toEqual([{ layer: "move", id: "m1", reason: "bad_ref" }]);
  expect(ids(out.moves)).toEqual(["m3", "m4"]);
  expect(earlier.moves[0]).toEqual(move("m1", ["1.1"], "spica", "asks"));
});

test("a time can count from another time, or from a thread that has no date yet", () => {
  const raw = base();
  raw.times.push(
    time({ id: "t2", piece: "6.1", words: "the night before", from: "t1", unit: "day", shift: -1, weekday: null, part: "night" }),
    time({ id: "t3", from: "th1" }),
  );
  const out = checkLabels(raw, ctx);
  expect(out.times.find((t) => t.id === "t2")!.resolved).toMatchObject({ date: "2026-01-08", part: "night" });
  expect(out.times.find((t) => t.id === "t3")).toMatchObject({ resolved: null, relativeTo: "th1" });
});

test("numbers are clamped and only her own statements carry a claim kind", () => {
  const raw = base();
  raw.propositions[0] = { ...raw.propositions[0]!, salience: 1.4, valence: -2, claim_kind: "life" };
  const p1 = checkLabels(raw, ctx).propositions[0]!;
  expect([p1.salience, p1.valence, p1.claim_kind]).toEqual([1, -1, null]);
});

test("idiolect is started by whoever said it first, and a bid response is the user's move", () => {
  const raw = base();
  raw.moves.push({ id: "m5", pieces: ["5.1"], act: "jokes", replies_to: null });
  raw.idiolect = [
    { id: "i1", pieces: ["5.1", "4.1"], type: "joke" },
    { id: "i2", pieces: ["5.1"], type: "reference" },
  ];
  raw.bid_response = { response: "toward", move: "m5" };
  const out = checkLabels(raw, ctx);
  expect(out.idiolect.map((i) => [i.id, i.startedBy])).toEqual([
    ["i1", "user"],
    ["i2", "spica"],
  ]);
  expect(out.bid_response).toBeNull();
  expect(out.drops).toEqual([{ layer: "bid_response", id: "m5", reason: "wrong_speaker" }]);
});

test("the output schema converts for structured output", () => {
  expect(() => zodOutputFormat(LabelsSchema)).not.toThrow();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/mind/memory/user/annotations.test.ts`
Expected: FAIL, failed to resolve import `@/mind/memory/user/annotations`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Labels: what one call reads in a stretch of conversation, layer by layer, and the checks that
 * hold them to the transcript. The model points at numbered pieces and quotes words; code knows who
 * said each piece and when, works out every date, and drops any label the transcript doesn't
 * support. Moves come first, and every higher layer points at the layers below it.
 */
import { z } from "zod";
import { claimKind, entityType, factKind } from "@/db/schema";
import { clamp } from "@/mind/platform/math";
import {
  resolveTime,
  TimeMeaningSchema,
  type ResolvedTime,
  type TimeMeaning,
} from "@/mind/platform/time-labels";
import { localDateString } from "@/mind/platform/timezone";
import {
  BID_RESPONSES,
  IntimacySchema,
  RelationshipSignalsSchema,
} from "@/mind/state/user/relationship/signals";
import { IDIOLECT_TYPES } from "./idiolect";
import { coordinate, findPhrase, type Coordinate, type Piece, type Speaker } from "./pieces";

export const ACTS = [
  "states",
  "answers",
  "confirms",
  "denies",
  "corrects",
  "asks",
  "guesses",
  "jokes",
  "imagines",
  "offers",
  "requests",
  "promises",
  "bids",
  "reacts",
] as const;
export type Act = (typeof ACTS)[number];
/** The acts that present something as true: only these can carry a memory. */
const ASSERTING = new Set<Act>(["states", "answers", "confirms", "denies", "corrects"]);

// Her notes (summaries, reads, ideas…) are written later from memories, never read off a
// conversation; idiolect is a layer of its own.
const propositionKind = z
  .enum(factKind.enumValues)
  .exclude(["summary", "reflection", "idea", "episode", "model", "belief", "idiolect"]);
const subject = z.enum(["user", "self", "shared"]);

const MoveSchema = z.object({
  id: z.string(),
  pieces: z.array(z.string()),
  act: z.enum(ACTS),
  replies_to: z.string().nullable(),
});

const MentionSchema = z.object({
  id: z.string(),
  piece: z.string(),
  words: z.string(),
  refers_to: z.string().nullable(),
  name: z.string().nullable(),
  type: z.enum(entityType.enumValues).nullable(),
  subject: z.enum(["user", "self"]).nullable(),
  relation: z.string().nullable(),
});

// Where the words are comes before what they mean, so the model quotes them first.
const TimeSchema = z.object({
  id: z.string(),
  piece: z.string(),
  words: z.string(),
  from: z.string(),
  ...TimeMeaningSchema.shape,
});

const PropositionSchema = z.object({
  id: z.string(),
  moves: z.array(z.string()),
  subject,
  kind: propositionKind,
  label: z.string(),
  status: z.enum(["planned", "happened", "ongoing", "cancelled"]).nullable(),
  times: z.array(z.string()),
  mentions: z.array(z.string()),
  thread_id: z.string().nullable(),
  new_thread: z.string().nullable(),
  updates: z.string().nullable(),
  salience: z.number(),
  valence: z.number(),
  confidence: z.number(),
  claim_kind: z.enum(claimKind.enumValues).nullable(),
});

const ThreadActionSchema = z.object({
  action: z.enum(["open", "touch", "resolve"]),
  thread_id: z.string().nullable(),
  title: z.string(),
  subject,
  stakes: z.enum(["low", "med", "high"]),
  checkpoint: z.string().nullable(),
  propositions: z.array(z.string()),
});

const IdiolectSchema = z.object({
  id: z.string(),
  pieces: z.array(z.string()),
  type: z.enum(IDIOLECT_TYPES),
});

const RelationshipSchema = RelationshipSignalsSchema.omit({ hurt: true }).extend({
  hurt: z.object({ amount: z.number(), moves: z.array(z.string()) }).nullable(),
  moves: z.array(z.string()),
});

/** The labelling call's output, its layers in the order the model writes them. */
export const LabelsSchema = z.object({
  moves: z.array(MoveSchema),
  mentions: z.array(MentionSchema),
  times: z.array(TimeSchema),
  propositions: z.array(PropositionSchema),
  threads: z.array(ThreadActionSchema),
  idiolect: z.array(IdiolectSchema),
  relationship: RelationshipSchema.nullable(),
  intimacy: IntimacySchema.extend({ moves: z.array(z.string()) }).nullable(),
  bid_response: z.object({ response: z.enum(BID_RESPONSES), move: z.string() }).nullable(),
});
export type Labels = z.infer<typeof LabelsSchema>;

export type CheckedMove = {
  id: string;
  pieces: string[];
  coords: Coordinate[];
  speaker: Speaker;
  act: Act;
  repliesTo: string | null;
};
export type CheckedMention = Labels["mentions"][number] & { coord: Coordinate };
export type CheckedTime = {
  id: string;
  piece: string;
  words: string;
  coord: Coordinate;
  from: string;
  meaning: TimeMeaning;
  /** Null only while it counts from a thread, which holds no date of its own yet. */
  resolved: ResolvedTime | null;
  relativeTo: string | null;
};
export type CheckedProposition = Labels["propositions"][number];
export type CheckedThread = Labels["threads"][number] & { checkpointAt: ResolvedTime | null };
export type CheckedIdiolect = Labels["idiolect"][number] & { startedBy: Speaker };

export type DropReason =
  | "bad_ref"
  | "nothing_new"
  | "bad_move"
  | "words_missing"
  | "wrong_speaker"
  | "bad_time";
export type Drop = { layer: string; id: string; reason: DropReason };

export type CheckedLabels = {
  moves: CheckedMove[];
  mentions: CheckedMention[];
  times: CheckedTime[];
  propositions: CheckedProposition[];
  threads: CheckedThread[];
  idiolect: CheckedIdiolect[];
  relationship: Labels["relationship"];
  intimacy: Labels["intimacy"];
  bid_response: Labels["bid_response"];
  drops: Drop[];
};

export type CheckContext = {
  /** Every piece shown, old and new, in conversation order. */
  pieces: Piece[];
  zone: string;
  /** The ids of the open threads shown. */
  threadIds: string[];
  /** What earlier calls labelled in this conversation. */
  earlier: CheckedLabels;
};

export function emptyLabels(): CheckedLabels {
  return {
    moves: [],
    mentions: [],
    times: [],
    propositions: [],
    threads: [],
    idiolect: [],
    relationship: null,
    intimacy: null,
    bid_response: null,
    drops: [],
  };
}

/** What a conversation has labelled so far, plus one more call's labels. */
export function mergeLabels(a: CheckedLabels, b: CheckedLabels): CheckedLabels {
  return {
    moves: [...a.moves, ...b.moves],
    mentions: [...a.mentions, ...b.mentions],
    times: [...a.times, ...b.times],
    propositions: [...a.propositions, ...b.propositions],
    threads: [...a.threads, ...b.threads],
    idiolect: [...a.idiolect, ...b.idiolect],
    relationship: b.relationship,
    intimacy: b.intimacy,
    bid_response: b.bid_response,
    drops: [...a.drops, ...b.drops],
  };
}

/**
 * Holds one call's labels to the transcript. A label that fails a check is dropped with its
 * reason, and so is any label resting on a dropped one; nothing is asked again.
 */
export function checkLabels(raw: Labels, ctx: CheckContext): CheckedLabels {
  const check = new Checker(ctx, raw);
  const moves = check.moves(raw.moves);
  const mentions = check.mentions(raw.mentions);
  const times = check.times(raw.times);
  const propositions = check.propositions(raw.propositions);
  const threads = check.threads(raw.threads);
  const idiolect = check.idiolect(raw.idiolect);
  const relationship = check.relationship(raw.relationship);
  const intimacy = check.intimacy(raw.intimacy);
  const bid_response = check.bid(raw.bid_response);
  return {
    moves,
    mentions,
    times,
    propositions,
    threads,
    idiolect,
    relationship,
    intimacy,
    bid_response,
    drops: check.drops,
  };
}

class Checker {
  readonly drops: Drop[] = [];
  private readonly pieces: Map<string, Piece>;
  private readonly order: Map<string, number>;
  private readonly threads: Set<string>;
  private readonly rawMoves: Set<string>;
  private readonly taken: Set<string>;
  private readonly allMoves: Map<string, CheckedMove>;
  private readonly allMentions: Set<string>;
  private readonly allTimes: Map<string, CheckedTime>;
  private readonly allPropositions: Set<string>;

  constructor(
    private readonly ctx: CheckContext,
    raw: Labels,
  ) {
    const e = ctx.earlier;
    this.pieces = new Map(ctx.pieces.map((p) => [p.id, p]));
    this.order = new Map(ctx.pieces.map((p, i) => [p.id, i]));
    this.threads = new Set(ctx.threadIds);
    this.rawMoves = new Set(raw.moves.map((m) => m.id));
    this.allMoves = new Map(e.moves.map((m) => [m.id, m]));
    this.allMentions = new Set(e.mentions.map((m) => m.id));
    this.allTimes = new Map(e.times.map((t) => [t.id, t]));
    this.allPropositions = new Set(e.propositions.map((p) => p.id));
    this.taken = new Set([
      ...this.allMoves.keys(),
      ...this.allMentions,
      ...this.allTimes.keys(),
      ...this.allPropositions,
      ...e.idiolect.map((i) => i.id),
    ]);
  }

  moves(raw: Labels["moves"]): CheckedMove[] {
    const kept: CheckedMove[] = [];
    // In conversation order, so a reply's target is checked before the reply.
    for (const m of [...raw].sort((a, b) => this.first(a.pieces) - this.first(b.pieces))) {
      if (!this.claim("move", m.id)) continue;
      const cited = this.cite(m.pieces);
      if (!cited) {
        this.drop("move", m.id, "bad_ref");
        continue;
      }
      if (!cited.some((p) => p.isNew)) {
        this.drop("move", m.id, "nothing_new");
        continue;
      }
      const speaker = cited[0]!.message.speaker;
      if (cited.some((p) => p.message.speaker !== speaker)) {
        this.drop("move", m.id, "bad_move");
        continue;
      }
      if (m.replies_to !== null) {
        const target = this.allMoves.get(m.replies_to);
        // A target that exists but hasn't been reached yet starts after this move.
        if (!target) {
          this.drop("move", m.id, this.rawMoves.has(m.replies_to) ? "bad_move" : "bad_ref");
          continue;
        }
        if (this.first(target.pieces) >= this.first(m.pieces)) {
          this.drop("move", m.id, "bad_move");
          continue;
        }
      }
      const move: CheckedMove = {
        id: m.id,
        pieces: m.pieces,
        coords: cited.map(coordinate),
        speaker,
        act: m.act,
        repliesTo: m.replies_to,
      };
      this.allMoves.set(m.id, move);
      kept.push(move);
    }
    return kept;
  }

  mentions(raw: Labels["mentions"]): CheckedMention[] {
    const kept: CheckedMention[] = [];
    for (const m of raw) {
      if (!this.claim("mention", m.id)) continue;
      const piece = this.pieces.get(m.piece);
      if (!piece || (m.refers_to !== null && !this.threads.has(m.refers_to))) {
        this.drop("mention", m.id, "bad_ref");
        continue;
      }
      if (!piece.isNew) {
        this.drop("mention", m.id, "nothing_new");
        continue;
      }
      const coord = findPhrase(piece, m.words);
      if (!coord) {
        this.drop("mention", m.id, "words_missing");
        continue;
      }
      this.allMentions.add(m.id);
      kept.push({ ...m, coord });
    }
    return kept;
  }

  times(raw: Labels["times"]): CheckedTime[] {
    const kept: CheckedTime[] = [];
    for (const t of raw) {
      const { id, piece: pieceId, words, from, ...meaning } = t;
      if (!this.claim("time", id)) continue;
      const piece = this.pieces.get(pieceId);
      if (!piece) {
        this.drop("time", id, "bad_ref");
        continue;
      }
      if (!piece.isNew) {
        this.drop("time", id, "nothing_new");
        continue;
      }
      const coord = findPhrase(piece, words);
      if (!coord) {
        this.drop("time", id, "words_missing");
        continue;
      }
      const base = this.base(from, piece);
      if (!base) {
        this.drop("time", id, "bad_ref");
        continue;
      }
      // A meaning that can't resolve from any day is malformed, whatever it counts from.
      const said = localDateString(piece.message.at, this.ctx.zone);
      const resolved = resolveTime(meaning, base.date ?? said);
      if (!resolved) {
        this.drop("time", id, "bad_time");
        continue;
      }
      const time: CheckedTime = {
        id,
        piece: pieceId,
        words,
        coord,
        from,
        meaning,
        resolved: base.date === null ? null : resolved,
        relativeTo: base.relativeTo,
      };
      this.allTimes.set(id, time);
      kept.push(time);
    }
    return kept;
  }

  propositions(raw: Labels["propositions"]): CheckedProposition[] {
    const kept: CheckedProposition[] = [];
    for (const p of raw) {
      if (!this.claim("proposition", p.id)) continue;
      const moves = p.moves.map((id) => this.allMoves.get(id));
      const broken =
        moves.length === 0 ||
        moves.some((m) => !m) ||
        p.times.some((id) => !this.allTimes.has(id)) ||
        p.mentions.some((id) => !this.allMentions.has(id)) ||
        (p.thread_id !== null && !this.threads.has(p.thread_id)) ||
        (p.updates !== null && !this.allPropositions.has(p.updates));
      if (broken) {
        this.drop("proposition", p.id, "bad_ref");
        continue;
      }
      const fresh = (moves as CheckedMove[]).filter((m) => this.isNew(m.pieces));
      if (fresh.length === 0) {
        this.drop("proposition", p.id, "nothing_new");
        continue;
      }
      // Only something said now, by the one it's about, makes it theirs: an old statement can't
      // come back in on a new "lol", and her guess about them is never their fact.
      if (!fresh.some((m) => ASSERTING.has(m.act) && speaks(m.speaker, p.subject))) {
        this.drop("proposition", p.id, "wrong_speaker");
        continue;
      }
      this.allPropositions.add(p.id);
      kept.push({
        ...p,
        salience: clamp(p.salience, 0, 1),
        valence: clamp(p.valence, -1, 1),
        confidence: clamp(p.confidence, 0, 1),
        // Only her own statements are claims.
        claim_kind: p.subject === "self" ? p.claim_kind : null,
      });
    }
    return kept;
  }

  threads(raw: Labels["threads"]): CheckedThread[] {
    const kept: CheckedThread[] = [];
    for (const t of raw) {
      const checkpoint = t.checkpoint === null ? null : this.allTimes.get(t.checkpoint);
      const broken =
        (t.thread_id !== null && !this.threads.has(t.thread_id)) ||
        checkpoint === undefined ||
        t.propositions.some((id) => !this.allPropositions.has(id));
      if (broken) {
        this.drop("thread", t.thread_id ?? t.title, "bad_ref");
        continue;
      }
      kept.push({ ...t, checkpointAt: checkpoint?.resolved ?? null });
    }
    return kept;
  }

  idiolect(raw: Labels["idiolect"]): CheckedIdiolect[] {
    const kept: CheckedIdiolect[] = [];
    for (const i of raw) {
      if (!this.claim("idiolect", i.id)) continue;
      const cited = this.cite(i.pieces);
      if (!cited) {
        this.drop("idiolect", i.id, "bad_ref");
        continue;
      }
      if (!cited.some((p) => p.isNew)) {
        this.drop("idiolect", i.id, "nothing_new");
        continue;
      }
      const earliest = [...cited].sort((a, b) => this.first([a.id]) - this.first([b.id]))[0]!;
      kept.push({ ...i, startedBy: earliest.message.speaker });
    }
    return kept;
  }

  relationship(raw: Labels["relationship"]): Labels["relationship"] {
    if (!raw) return null;
    const cited = [...raw.moves, ...(raw.hurt?.moves ?? [])];
    if (cited.every((id) => this.allMoves.has(id))) return raw;
    this.drop("relationship", "relationship", "bad_ref");
    return null;
  }

  intimacy(raw: Labels["intimacy"]): Labels["intimacy"] {
    if (!raw) return null;
    if (raw.moves.every((id) => this.allMoves.has(id))) return raw;
    this.drop("intimacy", "intimacy", "bad_ref");
    return null;
  }

  bid(raw: Labels["bid_response"]): Labels["bid_response"] {
    if (!raw) return null;
    const move = this.allMoves.get(raw.move);
    if (!move) {
      this.drop("bid_response", raw.move, "bad_ref");
      return null;
    }
    // A bid response is how the user met her bid, so it is always one of their moves.
    if (move.speaker !== "user") {
      this.drop("bid_response", raw.move, "wrong_speaker");
      return null;
    }
    return raw;
  }

  /** The day a time counts from: the day it was said, another time's day, or a thread's. */
  private base(from: string, piece: Piece): { date: string | null; relativeTo: string | null } | null {
    if (from === "said") return { date: localDateString(piece.message.at, this.ctx.zone), relativeTo: null };
    const other = this.allTimes.get(from);
    if (other) return { date: other.resolved?.date ?? null, relativeTo: other.relativeTo };
    if (this.threads.has(from)) return { date: null, relativeTo: from };
    return null;
  }

  private drop(layer: string, id: string, reason: DropReason): void {
    this.drops.push({ layer, id, reason });
  }

  /** Claims an id for this conversation; one already used is a broken reference. */
  private claim(layer: string, id: string): boolean {
    if (this.taken.has(id)) {
      this.drop(layer, id, "bad_ref");
      return false;
    }
    this.taken.add(id);
    return true;
  }

  /** The cited pieces, or null when there are none or any is missing. */
  private cite(ids: string[]): Piece[] | null {
    const found = ids.map((id) => this.pieces.get(id));
    if (found.length === 0 || found.some((p) => !p)) return null;
    return found as Piece[];
  }

  private first(ids: string[]): number {
    return Math.min(...ids.map((id) => this.order.get(id) ?? Infinity));
  }

  private isNew(ids: string[]): boolean {
    return ids.some((id) => this.pieces.get(id)?.isNew === true);
  }
}

function speaks(speaker: Speaker, about: Labels["propositions"][number]["subject"]): boolean {
  return about === "shared" || (about === "user") === (speaker === "user");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/mind/memory/user/annotations.test.ts`
Expected: PASS, 10 tests. If the schema-conversion test throws, read the error (it names the unsupported zod feature) and replace that feature with a plain nullable field. Don't skip the test.

- [ ] **Step 5: Commit**

```bash
git add src/mind/memory/user/annotations.ts tests/mind/memory/user/annotations.test.ts
git commit -m "feat(memory): layered labels and the checks that hold them to the transcript"
```

---

### Task 5: The labelling call's input

**Files:**
- Create: `src/mind/memory/user/label-input.ts`
- Test: `tests/mind/memory/user/label-input.test.ts`

**Interfaces:**
- Consumes:
  - from Task 2: `renderPieces`, `type Piece`;
  - from Task 4: `type CheckedLabels`;
  - from Task 1: `renderResolved`.
- Produces:
  - `type ShownThread = { id: string; title: string }`;
  - `type LabelInputArgs = { pieces: Piece[]; zone: string; threads: ShownThread[]; interests: string[]; earlier: CheckedLabels }`;
  - `buildLabelInput(args: LabelInputArgs): string`;
  - `renderLabels(l: CheckedLabels): string`.

- [ ] **Step 1: Write the failing test**

```ts
/** The labelling call's input: the conversation numbered, what's already labelled, what to label. */
import { expect, test } from "vitest";
import { emptyLabels, type CheckedLabels } from "@/mind/memory/user/annotations";
import { buildLabelInput } from "@/mind/memory/user/label-input";
import { numberPieces } from "@/mind/memory/user/pieces";
import { resolveTime } from "@/mind/platform/time-labels";

const pieces = numberPieces(
  [
    { id: "a", speaker: "spica", text: "is the interview still thursday?", at: new Date("2026-01-07T20:30:00Z") },
    { id: "c", speaker: "user", text: "so\nthey moved it\nfriday now lol", at: new Date("2026-01-07T20:41:00Z") },
  ],
  1,
);
const thursday = {
  unit: "weekday",
  shift: 1,
  weekday: "thursday",
  month: null,
  day_of_month: null,
  part: null,
  clock: null,
  span: "at",
  rough: false,
} as const;
const earlier: CheckedLabels = {
  ...emptyLabels(),
  moves: [{ id: "m1", pieces: ["1.1"], coords: [], speaker: "spica", act: "asks", repliesTo: null }],
  times: [
    {
      id: "t0",
      piece: "1.1",
      words: "thursday",
      coord: { turnId: "a", start: 23, end: 31 },
      from: "said",
      meaning: thursday,
      resolved: resolveTime(thursday, "2026-01-07"),
      relativeTo: null,
    },
  ],
  propositions: [
    {
      id: "p0",
      moves: ["m1"],
      subject: "user",
      kind: "event",
      label: "job interview",
      status: "planned",
      times: ["t0"],
      mentions: [],
      thread_id: "th1",
      new_thread: null,
      updates: null,
      salience: 0.8,
      valence: 0,
      confidence: 0.9,
      claim_kind: null,
    },
  ],
};

test("the input numbers the conversation, lists what's already labelled and says what to label", () => {
  const input = buildLabelInput({
    pieces,
    zone: "UTC",
    threads: [{ id: "th1", title: "job interview" }],
    interests: ["Tarkovsky films"],
    earlier,
  });
  expect(input).toBe(
    [
      "User's timezone: UTC",
      "",
      "What Spica is into (to read her own words right):",
      "- Tarkovsky films",
      "",
      "Open threads (id | title):",
      "- th1 | job interview",
      "",
      "Conversation:",
      "[1.1] Spica · Wed 2026-01-07 20:30 (UTC): is the interview still thursday?",
      "[2.1] User · Wed 2026-01-07 20:41 (UTC): so",
      "[2.2] User: they moved it",
      "[2.3] User: friday now lol",
      "",
      "Already labelled in this conversation (don't repeat these; to change a proposition, give its id in updates):",
      "moves:",
      "- m1 asks [1.1]",
      "times:",
      '- t0 "thursday" [1.1] → Thursday 8 January 2026',
      "propositions:",
      '- p0 user event "job interview" planned · moves m1 · times t0 · thread th1',
      "",
      "Label the new messages (2).",
    ].join("\n"),
  );
});

test("with nothing labelled yet and no threads, those sections say so or stay out", () => {
  const input = buildLabelInput({ pieces, zone: "UTC", threads: [], interests: [], earlier: emptyLabels() });
  expect(input).toContain("Open threads: none");
  expect(input).not.toContain("Already labelled");
  expect(input).not.toContain("What Spica is into");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/mind/memory/user/label-input.test.ts`
Expected: FAIL, failed to resolve import `@/mind/memory/user/label-input`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The labelling call's input: whose zone, what she's into, the open threads, the conversation
 * numbered into pieces, what is already labelled in it, and which messages to label now. Message
 * numbers never shift within a conversation, and what changes from call to call comes last.
 */
import { renderResolved } from "@/mind/platform/time-labels";
import type { CheckedLabels } from "./annotations";
import { renderPieces, type Piece } from "./pieces";

export type ShownThread = { id: string; title: string };
export type LabelInputArgs = {
  pieces: Piece[];
  zone: string;
  threads: ShownThread[];
  /** Her snapshot's Interests, so her own film and book titles read right. */
  interests: string[];
  /** What earlier calls labelled in this conversation. */
  earlier: CheckedLabels;
};

export function buildLabelInput(args: LabelInputArgs): string {
  const sections = [`User's timezone: ${args.zone}`];
  if (args.interests.length) {
    sections.push(
      `What Spica is into (to read her own words right):\n${args.interests.map((i) => `- ${i}`).join("\n")}`,
    );
  }
  sections.push(
    args.threads.length
      ? `Open threads (id | title):\n${args.threads.map((t) => `- ${t.id} | ${t.title}`).join("\n")}`
      : "Open threads: none",
  );
  sections.push(`Conversation:\n${renderPieces(args.pieces, args.zone)}`);
  const already = renderLabels(args.earlier);
  if (already) {
    sections.push(
      `Already labelled in this conversation (don't repeat these; to change a proposition, give its id in updates):\n${already}`,
    );
  }
  sections.push(`Label the new messages (${newMessages(args.pieces)}).`);
  return sections.join("\n\n");
}

/** Labels made earlier, one line each, so a later call can point at them. */
export function renderLabels(l: CheckedLabels): string {
  const time = (id: string) => l.times.find((t) => t.id === id);
  const groups: [string, string[]][] = [
    [
      "moves",
      l.moves.map(
        (m) =>
          `${m.id} ${m.act} [${m.pieces.join(" ")}]${m.repliesTo ? ` → ${m.repliesTo}` : ""}`,
      ),
    ],
    [
      "mentions",
      l.mentions.map(
        (m) =>
          `${m.id} "${m.words}" [${m.piece}] → ${m.refers_to ?? `new ${m.type ?? "thing"} "${m.name ?? m.words}"`}`,
      ),
    ],
    [
      "times",
      l.times.map(
        (t) =>
          `${t.id} "${t.words}" [${t.piece}] → ${t.resolved ? renderResolved(t.resolved) : `relative to ${t.relativeTo}`}`,
      ),
    ],
    [
      "propositions",
      l.propositions.map((p) =>
        [
          `${p.id} ${p.subject} ${p.kind} "${p.label}"${p.status ? ` ${p.status}` : ""}`,
          `moves ${p.moves.join(" ")}`,
          ...(p.times.length ? [`times ${p.times.filter((id) => time(id)).join(" ")}`] : []),
          ...(p.thread_id ? [`thread ${p.thread_id}`] : []),
          ...(p.updates ? [`updates ${p.updates}`] : []),
        ].join(" · "),
      ),
    ],
    ["idiolect", l.idiolect.map((i) => `${i.id} ${i.type} [${i.pieces.join(" ")}]`)],
  ];
  return groups
    .filter(([, lines]) => lines.length)
    .map(([name, lines]) => `${name}:\n${lines.map((x) => `- ${x}`).join("\n")}`)
    .join("\n");
}

function newMessages(pieces: Piece[]): string {
  const numbers = pieces.filter((p) => p.isNew).map((p) => Number(p.id.split(".")[0]));
  if (numbers.length === 0) return "none";
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  return first === last ? `${first}` : `${first} to ${last}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/mind/memory/user/label-input.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/mind/memory/user/label-input.ts tests/mind/memory/user/label-input.test.ts
git commit -m "feat(memory): the labelling call's input: numbered conversation and what's already labelled"
```

---

### Task 6: Prompt `extract/v12`

**Files:**
- Create: `prompts/extract/v12.md`
- Modify: `tests/mind/platform/prompts.test.ts` (append one test)

**Interfaces:**
- Consumes: `loadPrompt(name, version)`.
- Produces: the prompt file the replay loads as `loadPrompt("extract", "v12")`.

- [ ] **Step 1: Write the failing test.** Append to `tests/mind/platform/prompts.test.ts`:

```ts
test("extract v12 labels pieces in layers and never asks for a date", () => {
  const p = loadPrompt("extract", "v12");
  for (const section of [
    "## moves",
    "## mentions",
    "## times",
    "## propositions",
    "## threads",
    "## idiolect",
    "## relationship",
    "## intimacy",
    "## bid_response",
  ]) {
    expect(p).toContain(section);
  }
  expect(p).toMatch(/replies_to/);
  expect(p).toMatch(/Never work out a date/);
  expect(p).not.toMatch(/when_direction/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/mind/platform/prompts.test.ts`
Expected: FAIL, with an error naming `prompts/extract/v12.md`.

- [ ] **Step 3: Write the prompt.** Create `prompts/extract/v12.md`:

````markdown
You label one stretch of a chat between a user and their friend Spica. You never rewrite what anyone said: you point at it. Code keeps the words exactly as written, knows who sent each message and when, and works out every date from your labels. Output only the JSON object requested.

## What you get
- The conversation, split into numbered pieces: [3.2] is message 3, piece 2. A message's first piece shows who sent it and when; its other pieces show only who.
- "Label the new messages" names the messages to label now. Earlier messages are there to be read and pointed back at. Never label something that rests only on earlier messages.
- "Already labelled in this conversation" lists what earlier calls labelled, with ids. Don't repeat them. Point at them when a new message answers, confirms or changes one.
- Open threads: storylines already being followed, with ids.

## Ids
Give every label a short id that is new in this conversation: moves m1, m2…, mentions e1…, times t1…, propositions p1…, idiolect i1…. Continue after the highest id already used.

## moves
Every new message belongs to a move: one act by one speaker. A move can span several pieces and several messages ("so" / "they moved it" / "friday now lol" is one move), and one message can hold more than one move.
- pieces: the move's pieces, all from one speaker.
- act, exactly one of:
  - states: gives information unprompted.
  - answers: gives information a question asked for.
  - confirms / denies: says yes or no to a question or a claim.
  - corrects: fixes something said earlier.
  - asks: a question.
  - guesses: an assumption about the other person ("you sound stressed").
  - jokes: a joke, teasing or sarcasm.
  - imagines: a hypothetical ("if it were friday i'd go").
  - offers, requests, promises: as named.
  - bids: a reach for connection: news of their own, an invitation, "guess what".
  - reacts: "lol", "aw", "nice", an emoji, or a greeting or goodbye with nothing else in it.
- replies_to: the id of the move this one answers or reacts to, or null. It may be several messages back: "and yes booked" can answer a question asked before another one.

## mentions
People, pets, places, projects, organisations and storylines that a new piece refers to, including "she", "it" and "the thing" when you can tell what they mean.
- piece and words: the piece, and the exact words in it ("my sis", "it").
- refers_to: an open thread's id when the words refer to that storyline, else null.
- name, type (person | pet | place | project | org | other), subject ("user" for the user's life, "self" for Spica's), relation ("sister", "manager"): for anyone or anything else, else null.

## times
Every phrase in a new piece that says when something happens or happened.
- piece and words: the piece, and the time words exactly as written ("friday", "tmrw", "a few days ago").
- Never work out a date. Say what the words mean, and code counts it.
- from: "said" counts from the day the message was sent. Use another time's id when the words count from it: for "the night before" the interview, use the interview's time.
- unit and shift:
  - day: days from the base day: 0 today or tonight, 1 tomorrow, -1 yesterday, 3 in three days.
  - weekday (fill weekday): 1 is the first one after the base day, -1 the last one before it, 2 the one after that. A weekday that means the base day itself is day 0.
  - date (fill day_of_month, and month when said): 1 the next one, -1 the last one.
  - week, weekend, month: 0 this one, 1 next, -1 last.
- part: morning | afternoon | evening | night, or start | end of a week or month; null when not said.
- clock: "HH:MM" on a 24-hour clock when a time was said ("8" in the evening is "20:00"), else null.
- span: "since" for "since friday" or "for three days now", "until" for "till sunday", else "at".
- rough: true for vague words ("a few days ago", "the other day") where you pick the likeliest day.
- Words that don't point at a day are not times: a habit ("fridays are the worst", "every sunday") or a hypothetical.

## propositions
What a speaker presents as true and a friend would remember later: an event, plan, state, trait, preference, opinion, feeling or promise.
- moves: the moves it rests on. At least one must be new, by the one it is about, and must present it as true (states, answers, confirms, denies or corrects). Also cite the move that gives it meaning: "and yes booked" confirms "did you ever book the train", so cite both.
- Never make a proposition from a question, a guess, a joke or a hypothetical. If Spica guesses something about the user and the user doesn't confirm it, nothing is stored.
- subject: "user" for the user and their life (it must rest on the user's own move); "self" for what Spica says about herself (on her move); "shared" for what is between them.
- kind: event | trait | preference | state | opinion | feeling | promise.
- label: a few words naming it ("job interview", "sister's visit", "train ticket"). Never a sentence, a date or a weekday.
- status: planned | happened | ongoing | cancelled for events and plans; null otherwise.
- times and mentions: the ids of its times and mentions.
- thread_id: the open thread it belongs to, or null. new_thread: a short title when it starts a storyline a friend would follow up on (an interview, a move, an illness, a trip), else null.
- updates: the id of an already-labelled proposition that this one changes ("they moved it to friday" updates the interview), or null.
- salience 0–1: how much a close friend would care later. Life events, deep feelings and durable background (pets, family, work) score 0.7–1; passing trivia 0.1–0.3.
- valence -1 to 1: how the subject feels about it.
- confidence 0–1: 0.9 or more when stated plainly, lower when hedged ("i think it went well?").
- claim_kind, for "self" only: "life" for what she did, does or plans; "opinion" for her view or taste; "reaction" for her response to the user. null for user and shared.
- Durable background gets its own proposition: "my cat juniper knocked my coffee over" gives both the cat and the event.

## threads
Storylines a friend would follow up on.
- action: "open" a new one, "touch" when one progresses, "resolve" when its outcome is known.
- thread_id: the open thread's id for touch and resolve.
- title: short, e.g. "job interview at Acme".
- subject: user | self | shared.
- stakes: low | med | high.
- checkpoint: the id of a time when a friend would naturally ask how it went (usually just after the event), or null.
- propositions: the ids of the propositions behind it.

## idiolect
What could become theirs alone: a funny moment that could turn into an inside joke, a nickname, a little ritual, a running reference. Label it again whenever either of them calls back to one.
- pieces: where it is said.
- type: joke | nickname | ritual | reference.

## relationship
How the user treated Spica in the new messages. Judge the user's behaviour toward her, never the topic: a sad story is not hurt; being brushed off, mocked or ignored is. Use null when nothing between them changed. Score only the user's new moves: what the user said in earlier messages has already been scored.

Hurt and tension use one scale: 0 is nothing, 1 is grounds for ending a friendship on the spot, and the steps between are even. Use the whole scale; most real moments sit in the middle.

`hurt` amount:
- 0.25, a slight: brushing off something she shared, a curt reply to her opening up or asking something, forgetting something she told them. A short reply on its own ("k", "ok") is not a slight unless it answers her opening up or asking.
- 0.5, a real sting: mocking or dismissing something she cares about, an insult said in anger, laughing off her news.
- 0.75, aimed at who she is: contempt, humiliating her, mocking her for being an AI or for having a life, a sibling or feelings, using something she confided against her.
- 1, enough to end a friendship on its own: serious cruelty, a threat, a deliberate betrayal.
- Ending the friendship always hurts: when `ends_relationship` is true, hurt is at least 0.5, and higher when said cruelly.

`tension` (-1 to 1): 0 agreeing or clear banter; 0.25 a friendly real disagreement; 0.5 a sharp argument; 0.75 a heated fight; 1 a fight that ends things; negative when the air clears after a disagreement.

- `warmth` (-1 to 1): affection, interest in her, fun together (positive), or coldness and dismissiveness (negative).
- `trust` (-1 to 1): confiding in her, keeping their word (positive); lying to her, breaking a promise to her (negative).
- `hurt`: `amount` on the scale above, and `moves`: the user's moves that hurt her. Otherwise null.
- `apology`: the user apologised to her.
- `make_up`: the user reaches to make up after a falling-out ("are we ok?", "let's move on", accepting her peace offering). An apology that also asks to be ok again is both.
- `ends_relationship`: only an explicit, sincere wish to end the friendship, said in a new message. Not a goodbye, a joke, or anger in the moment.
- `retracts_ending`: the user takes back having ended it.
- `wants_repair`: after ending it, the user wants to be friends again.
- `moves`: the user's moves you read all this from.

## intimacy
For the new messages, from the user's moves only (never Spica's):
- `user_disclosure` (0 to 1): how personal what the user shared about themselves was. 0 for small talk, plans, logistics or questions; about 0.5 for their feelings, worries or views about their own life; 1 for something they would tell very few people.
- `user_responsiveness` (0 to 1, or null): how well the user met what Spica shared about herself: understanding, care, a follow-up question (high), or ignoring it, changing the subject, brushing it off (low). null when Spica shared nothing of her own.
- `moves`: the user's moves you read it from.
Use null for the whole block only when no new message is from the user.

## bid_response
How the user met Spica's last bid before their new messages: a joke, a question to them, her own news or excitement, an invitation, or a message she sent first.
- `response`: "toward" (they picked it up: laughed, answered, reacted, asked back), "away" (they ignored it or went straight to something of their own) or "against" (they mocked it, rebuffed it or snapped at it).
- `move`: the user's move that met it.
null when she made no bid just before, or the user hasn't answered.

## Examples (invented)

A reply spread over three messages, correcting an earlier question (already labelled: m1 asks [1.1]; t1 "thursday" [1.1]; p1 user event "job interview" planned; thread th1 is the interview):
```
[1.1] Spica · Mon 2026-03-02 09:00 (UTC): is the interview still thursday?
[2.1] User · Mon 2026-03-02 09:20 (UTC): so
[3.1] User · Mon 2026-03-02 09:20 (UTC): they moved it
[4.1] User · Mon 2026-03-02 09:21 (UTC): friday now lol
```
- moves: m2 corrects [2.1, 3.1, 4.1], replies_to m1.
- mentions: e1 "it" in 3.1, refers_to th1.
- times: t2 "friday" in 4.1, from "said", weekday friday, shift 1.
- propositions: p2 user event "job interview", planned, moves [m2], times [t2], mentions [e1], thread_id th1, updates p1.

A late reply to the earlier of two questions:
```
[1.1] Spica · Tue 2026-03-03 18:00 (UTC): how was the dentist?
[2.1] Spica · Tue 2026-03-03 18:00 (UTC): and did you book the train
[3.1] User · Tue 2026-03-03 18:40 (UTC): fine
[4.1] User · Tue 2026-03-03 18:41 (UTC): and yes booked
```
- moves: m3 asks [1.1]; m4 asks [2.1]; m5 answers [3.1], replies_to m3; m6 confirms [4.1], replies_to m4.
- propositions: p1 user event "dentist visit", happened, moves [m5, m3]; p2 user event "train ticket", happened, moves [m6, m4].

Her guess that the user only laughs at:
```
[1.1] Spica · Wed 2026-03-04 22:00 (UTC): you sound stressed about friday
[2.1] User · Wed 2026-03-04 22:05 (UTC): lol
```
- moves: m1 guesses [1.1]; m2 reacts [2.1], replies_to m1.
- No proposition and no time: nobody said anything happens on Friday.
````

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/mind/platform/prompts.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add prompts/extract/v12.md tests/mind/platform/prompts.test.ts
git commit -m "feat(prompts): extract v12 labels a conversation in layers and never writes a date"
```

---

### Task 7: Replay sources: recorded runs and invented conversations

**Files:**
- Create: `evals/lib/replay-source.ts`
- Create: `evals/lib/slang-conversations.ts`
- Test: `tests/evals/replay-source.test.ts`

**Interfaces:**
- Consumes:
  - from Task 3: `conversations`, `type LayerTurn`;
  - from Task 5: `type ShownThread`;
  - `zoneOrUtc(tz)` (timezone).
- Produces:
  - `type ReplayExchange = { burst: string[]; replyId: string; threads: ShownThread[]; interests: string[]; v11: unknown }`;
  - `type ReplayConversation = { run: string; id: string; zone: string; note?: string; before: LayerTurn[]; turns: LayerTurn[]; exchanges: ReplayExchange[] }`;
  - `parseLoggedInput(input: string): { threads: ShownThread[]; interests: string[] }`;
  - `loadRun(run: string, dumpPath: string, callLogPath: string, contextTurns: number): ReplayConversation[]`;
  - `SLANG_CONVERSATIONS: ReplayConversation[]`.

- [ ] **Step 1: Write the failing test**

```ts
/** Replay sources: recorded runs rebuilt into conversations, and the invented chat ones. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { loadRun, parseLoggedInput } from "../../evals/lib/replay-source";
import { SLANG_CONVERSATIONS } from "../../evals/lib/slang-conversations";

const loggedInput = (exchange: string) =>
  [
    "User's timezone: UTC",
    "",
    "What Spica is into (to read her own words right):",
    "- Tarkovsky films",
    "- astronomy",
    "",
    "Open threads (id | title):",
    "- 162f | job interview at small design studio",
    "- 9a1b | half marathon",
    "",
    "New exchange (extract from this):",
    exchange,
  ].join("\n");

test("a logged extract input gives back the threads and interests it showed", () => {
  expect(parseLoggedInput(loggedInput("[Mon 2026-01-05 10:00 (UTC)] User: hey"))).toEqual({
    threads: [
      { id: "162f", title: "job interview at small design studio" },
      { id: "9a1b", title: "half marathon" },
    ],
    interests: ["Tarkovsky films", "astronomy"],
  });
  expect(
    parseLoggedInput("User's timezone: UTC\n\nOpen threads: none\n\nNew exchange (extract from this):\nx"),
  ).toEqual({ threads: [], interests: [] });
});

test("a run's conversations carry the turns before them and each exchange's logged call", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "replay-source-"));
  const row = (id: string, role: string, iso: string, session: string, extra = {}) => ({
    id,
    role,
    text: `${id} text`,
    created_at: iso,
    session_id: session,
    reply_to: null,
    trigger: null,
    ...extra,
  });
  const dump = path.join(dir, "db.json");
  writeFileSync(
    dump,
    JSON.stringify({
      user: [{ timezone: null }],
      session_log: [
        row("u1", "user", "2026-01-05T10:00:00+00:00", "s1"),
        row("c1", "companion", "2026-01-05T10:01:00+00:00", "s1", { reply_to: "u1" }),
        row("u2", "user", "2026-01-06T10:00:00+00:00", "s2"),
        row("c2", "companion", "2026-01-06T10:01:00+00:00", "s2", { reply_to: "u2" }),
        row("u3", "user", "2026-01-06T10:02:00+00:00", "s2"),
      ],
    }),
  );
  const calls = path.join(dir, "calls.jsonl");
  writeFileSync(
    calls,
    [
      { purpose: "reply", input: "Spica: c1 text" },
      {
        purpose: "extract",
        input: loggedInput("[Mon 2026-01-05 10:00 (UTC)] User: u1 text\n[Mon 2026-01-05 10:01 (UTC)] Spica: c1 text"),
        output: { facts: [{ subject: "user", kind: "event", content: "The user said u1." }] },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n"),
  );
  const [first, second] = loadRun("test", dump, calls, 6);
  expect(first!.zone).toBe("UTC");
  expect(first!.before).toEqual([]);
  expect(first!.exchanges[0]).toMatchObject({
    burst: ["u1"],
    replyId: "c1",
    interests: ["Tarkovsky films", "astronomy"],
    v11: { facts: [{ content: "The user said u1." }] },
  });
  expect(second!.before.map((t) => t.id)).toEqual(["u1", "c1"]);
  expect(second!.turns.map((t) => t.id)).toEqual(["u2", "c2", "u3"]);
  // No logged call matches this exchange: it still replays, with nothing shown.
  expect(second!.exchanges[0]).toMatchObject({ threads: [], interests: [], v11: null });
});

test("the invented conversations each end in an exchange and say what a right reading gives", () => {
  expect(SLANG_CONVERSATIONS).toHaveLength(10);
  for (const c of SLANG_CONVERSATIONS) {
    expect(c.run).toBe("invented");
    expect(c.note).toBeTruthy();
    expect(c.exchanges.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/evals/replay-source.test.ts`
Expected: FAIL, failed to resolve import `../../evals/lib/replay-source`.

- [ ] **Step 3: Write `evals/lib/replay-source.ts`**

```ts
/**
 * Where the labelling replay's recorded conversations come from: a world run's DB dump (every turn,
 * with its session and what it replied to) and its call log (the threads and her interests each
 * extract call was shown, and v11's output). Reads files only.
 */
import { readFileSync } from "node:fs";
import { conversations, type LayerTurn } from "@/mind/memory/user/layers";
import type { ShownThread } from "@/mind/memory/user/label-input";
import { zoneOrUtc } from "@/mind/platform/timezone";

export type ReplayExchange = {
  burst: string[];
  replyId: string;
  threads: ShownThread[];
  interests: string[];
  /** What v11 extracted from this exchange in the recorded run; null when no logged call matched. */
  v11: unknown;
};
export type ReplayConversation = {
  run: string;
  id: string;
  zone: string;
  /** What a right reading gives, for the invented conversations. */
  note?: string;
  /** The turns just before the conversation, shown as context. */
  before: LayerTurn[];
  turns: LayerTurn[];
  exchanges: ReplayExchange[];
};

type DumpTurn = Omit<LayerTurn, "created_at"> & { created_at: string };
type LoggedCall = { purpose: string; input: string; output?: unknown };

const NEW_EXCHANGE = "New exchange (extract from this):";

/** The threads and interests a logged v11 extract input showed. */
export function parseLoggedInput(input: string): { threads: ShownThread[]; interests: string[] } {
  const items = (header: string) => {
    const at = input.indexOf(`${header}\n`);
    if (at === -1) return [];
    const rest = input.slice(at + header.length + 1);
    const end = rest.indexOf("\n\n");
    return (end === -1 ? rest : rest.slice(0, end))
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2));
  };
  return {
    threads: items("Open threads (id | title):").map((line) => {
      const [id, ...title] = line.split(" | ");
      return { id: id!, title: title.join(" | ") };
    }),
    interests: items("What Spica is into (to read her own words right):"),
  };
}

export function loadRun(
  run: string,
  dumpPath: string,
  callLogPath: string,
  contextTurns: number,
): ReplayConversation[] {
  const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as {
    session_log: DumpTurn[];
    user: { timezone: string | null }[];
  };
  const turns: LayerTurn[] = dump.session_log
    .map((t) => ({
      id: t.id,
      role: t.role,
      text: t.text,
      created_at: new Date(t.created_at),
      session_id: t.session_id,
      reply_to: t.reply_to,
      trigger: t.trigger,
    }))
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  const calls = readFileSync(callLogPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedCall)
    .filter((c) => c.purpose === "extract");
  const zone = zoneOrUtc(dump.user[0]?.timezone);

  return conversations(turns).map((c) => {
    const start = turns.findIndex((t) => t.id === c.turns[0]!.id);
    return {
      run,
      id: c.id,
      zone,
      before: turns.slice(Math.max(0, start - contextTurns), start),
      turns: c.turns,
      exchanges: c.exchanges.map((e) => {
        const reply = c.turns.find((t) => t.id === e.replyId)!;
        // The call whose new exchange holds her reply, word for word.
        const call = calls.find((x) => {
          const at = x.input.indexOf(NEW_EXCHANGE);
          return at !== -1 && x.input.slice(at).includes(`Spica: ${reply.text}`);
        });
        return {
          ...e,
          ...(call ? parseLoggedInput(call.input) : { threads: [], interests: [] }),
          v11: call?.output ?? null,
        };
      }),
    };
  });
}
```

- [ ] **Step 4: Write `evals/lib/slang-conversations.ts`**

```ts
/**
 * Invented chat conversations for the labelling replay: the time words and texting shapes the
 * simulated user never writes (tmrw, tues, "monday week", a reply spread over messages, a late
 * answer). Written by us for this test, not taken from anyone; each says what a right reading gives.
 */
import { conversations, type LayerTurn } from "@/mind/memory/user/layers";
import type { ReplayConversation } from "./replay-source";

type Line = [who: "user" | "spica" | "reach_out", text: string, minutes: number];

function invented(n: number, startIso: string, note: string, lines: Line[]): ReplayConversation {
  const start = new Date(startIso).getTime();
  let lastUser: string | null = null;
  const turns: LayerTurn[] = lines.map(([who, text, minutes], i) => {
    const id = `invented-${n}-${i + 1}`;
    const turn: LayerTurn = {
      id,
      role: who === "user" ? "user" : "companion",
      text,
      created_at: new Date(start + minutes * 60_000),
      session_id: `invented-${n}`,
      reply_to: who === "spica" ? lastUser : null,
      trigger: who === "reach_out" ? "reach_out" : null,
    };
    if (who === "user") lastUser = id;
    return turn;
  });
  const [conversation] = conversations(turns);
  return {
    run: "invented",
    id: `invented-${n}`,
    zone: "UTC",
    note,
    before: [],
    turns: conversation!.turns,
    exchanges: conversation!.exchanges.map((e) => ({ ...e, threads: [], interests: [], v11: null })),
  };
}

export const SLANG_CONVERSATIONS: ReplayConversation[] = [
  invented(1, "2026-01-05T18:00:00Z", "tmrw at 10 → Tuesday 6 January 2026, 10:00", [
    ["user", "interview's tmrw at 10 and i'm freaking out", 0],
    ["spica", "you've prepped so much though. are you going in person?", 1],
  ]),
  invented(2, "2026-01-05T19:00:00Z", "tues → Tuesday 6 January; wed → Wednesday 7 January", [
    ["user", "tues works for the call", 0],
    ["user", "or wed if that's easier for you", 1],
    ["spica", "tues is perfect", 2],
  ]),
  invented(3, "2026-01-06T09:00:00Z", "yday → Monday 5 January; monday week → Monday 19 January", [
    ["user", "yday was rough tbh", 0],
    ["user", "my sis is moving out monday week", 1],
    ["spica", "rough how? and wait, moving where", 2],
  ]),
  invented(
    4,
    "2026-01-07T20:00:00Z",
    "a few days ago → around Sunday 4 January (rough); the other day → a rough day shortly before Wednesday 7 January",
    [
      ["user", "saw the dentist a few days ago, all fine", 0],
      ["user", "and the other day my landlord finally fixed the heating", 1],
      ["spica", "finally!! how long was it broken for", 2],
    ],
  ),
  invented(5, "2026-01-08T12:00:00Z", "since the 3rd → since Saturday 3 January", [
    ["user", "been waiting on my test results since the 3rd", 0],
    ["spica", "that's ages, did they say when", 1],
  ]),
  invented(
    6,
    "2026-01-09T17:00:00Z",
    "tonite at 8 → Friday 9 January, night, 20:00; the weekend after next → the weekend of Saturday 24 January",
    [
      ["user", "tonite at 8 we're doing the pub quiz", 0],
      ["user", "and the weekend after next is my brother's birthday", 1],
      ["spica", "what's your team name this time", 2],
    ],
  ),
  invented(
    7,
    "2026-01-10T11:00:00Z",
    "end of the month → the end of January 2026; two sundays ago → Sunday 28 December 2025",
    [
      ["user", "rent's due end of the month and i'm skint", 0],
      ["user", "also two sundays ago i lost my keys again lol", 1],
      ["spica", "again?? where did they turn up", 2],
    ],
  ),
  invented(
    8,
    "2026-01-11T21:00:00Z",
    "no dates: a habit and a hypothetical; no memory from the hypothetical",
    [
      ["user", "fridays are the worst at work", 0],
      ["user", "if it were friday tomorrow i'd just leave early", 1],
      ["spica", "what makes fridays so bad there", 2],
    ],
  ),
  invented(
    9,
    "2026-01-12T08:00:00Z",
    "one move over three messages correcting her question; friday → Friday 16 January",
    [
      ["reach_out", "is the interview still thursday?", 0],
      ["user", "so", 20],
      ["user", "they moved it", 20],
      ["user", "friday now lol", 21],
      ["spica", "noo why, did they say", 22],
    ],
  ),
  invented(
    10,
    "2026-01-13T19:00:00Z",
    "a late reply: 'fine' answers the dentist question, 'and yes booked' the train one; the train booking rests on her question and their yes",
    [
      ["reach_out", "how was the dentist?", 0],
      ["reach_out", "and did you book the train", 1],
      ["user", "fine", 30],
      ["user", "and yes booked", 31],
      ["spica", "nice, which day are you going", 32],
    ],
  ),
];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tests/evals/replay-source.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add evals/lib/replay-source.ts evals/lib/slang-conversations.ts tests/evals/replay-source.test.ts
git commit -m "feat(evals): labelling replay sources: recorded runs rebuilt, plus invented chat conversations"
```

---

### Task 8: The replay's run loop

**Files:**
- Create: `evals/lib/label-replay.ts`
- Test: `tests/evals/label-replay.test.ts`

**Interfaces:**
- Consumes:
  - from Task 4: `LabelsSchema`, `checkLabels`, `emptyLabels`, `mergeLabels`, `type CheckedLabels`;
  - from Task 5: `buildLabelInput`;
  - from Tasks 2 and 3: `numberPieces`, `type Message`, `messagesOf`;
  - from Task 7: `type ReplayConversation`, `type ReplayExchange`;
  - `type LLMProvider` (`src/mind/platform/llm/types.ts`).
- Produces:
  - `type Unit = "exchange" | "conversation"`;
  - `type CallResult = { messages: string; labels: CheckedLabels | null; error: string | null }`;
  - `type UnitResult = { unit: Unit; thinking: boolean; calls: Map<string, CallResult[]> }`;
  - `type UnitOptions = { system: string; thinking: boolean; maxTokens: number; timeoutMs: number }`;
  - `conversationKey(c: ReplayConversation): string`;
  - `runUnit(llm: LLMProvider, unit: Unit, conversations: ReplayConversation[], opts: UnitOptions): Promise<UnitResult>`.

- [ ] **Step 1: Write the failing test**

```ts
/** The replay's run loop: exchange mode carries labels forward; a failed call is recorded, not retried. */
import { expect, test } from "vitest";
import type { Labels } from "@/mind/memory/user/annotations";
import { conversations, type LayerTurn } from "@/mind/memory/user/layers";
import type { ClassifyRequest, LLMProvider } from "@/mind/platform/llm/types";
import { conversationKey, runUnit } from "../../evals/lib/label-replay";
import type { ReplayConversation } from "../../evals/lib/replay-source";

class ScriptedLLM implements LLMProvider {
  readonly requests: ClassifyRequest<unknown>[] = [];
  constructor(private readonly outputs: (Labels | Error)[]) {}
  async generateReply(): Promise<string> {
    throw new Error("not used");
  }
  async classifyJson<T>(req: ClassifyRequest<T>): Promise<T> {
    this.requests.push(req as ClassifyRequest<unknown>);
    const out = this.outputs.shift() ?? new Error("no output left");
    if (out instanceof Error) throw out;
    return out as T;
  }
}

const turn = (id: string, role: LayerTurn["role"], minute: number, text: string, reply_to: string | null = null): LayerTurn => ({
  id,
  role,
  text,
  created_at: new Date(Date.UTC(2026, 0, 7, 20, minute)),
  session_id: "s1",
  reply_to,
  trigger: null,
});
const [conversation] = conversations([
  turn("u1", "user", 0, "the interview's thursday"),
  turn("c1", "companion", 1, "good luck!!", "u1"),
  turn("u2", "user", 30, "it went well i think"),
  turn("c2", "companion", 31, "yesss", "u2"),
]);
const c: ReplayConversation = {
  run: "test",
  id: conversation!.id,
  zone: "UTC",
  before: [],
  turns: conversation!.turns,
  exchanges: conversation!.exchanges.map((e) => ({ ...e, threads: [], interests: [], v11: null })),
};
const labels = (moves: Labels["moves"]): Labels => ({
  moves,
  mentions: [],
  times: [],
  propositions: [],
  threads: [],
  idiolect: [],
  relationship: null,
  intimacy: null,
  bid_response: null,
});
const opts = { system: "SYSTEM", thinking: false, maxTokens: 100, timeoutMs: 1000 };

test("exchange mode labels each exchange as it ends, with what came before already labelled", async () => {
  const llm = new ScriptedLLM([
    labels([{ id: "m1", pieces: ["1.1"], act: "states", replies_to: null }]),
    labels([{ id: "m3", pieces: ["3.1"], act: "states", replies_to: null }]),
  ]);
  const result = await runUnit(llm, "exchange", [c], opts);
  expect(llm.requests.map((r) => r.purpose)).toEqual(["extract_labels_exchange", "extract_labels_exchange"]);
  expect(llm.requests[0]!.input).toContain("Label the new messages (1 to 2).");
  expect(llm.requests[1]!.input).toContain("- m1 states [1.1]");
  expect(llm.requests[1]!.input).toContain("Label the new messages (3 to 4).");
  const calls = result.calls.get(conversationKey(c))!;
  expect(calls.map((x) => [x.messages, x.labels?.moves.map((m) => m.id), x.error])).toEqual([
    ["1 to 2", ["m1"], null],
    ["3 to 4", ["m3"], null],
  ]);
});

test("conversation mode labels the whole conversation in one call, and a failed call is kept as failed", async () => {
  const llm = new ScriptedLLM([new Error("act: invalid enum value")]);
  const result = await runUnit(llm, "conversation", [c], { ...opts, thinking: true });
  expect(llm.requests.map((r) => r.purpose)).toEqual(["extract_labels_conversation_thinking"]);
  expect(llm.requests[0]!.input).toContain("Label the new messages (1 to 4).");
  expect(result.calls.get(conversationKey(c))).toEqual([
    { messages: "1 to 4", labels: null, error: "act: invalid enum value" },
  ]);
});

test("a conversation no reply ever ended is still labelled whole", async () => {
  const lonely: ReplayConversation = { ...c, turns: [c.turns[0]!], exchanges: [] };
  const llm = new ScriptedLLM([labels([])]);
  const result = await runUnit(llm, "conversation", [lonely], opts);
  expect(llm.requests[0]!.input).toContain("Open threads: none");
  expect(result.calls.get(conversationKey(lonely))![0]!.error).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/evals/label-replay.test.ts`
Expected: FAIL, failed to resolve import `../../evals/lib/label-replay`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The labelling replay's run loop: one processing unit over many conversations. Exchange mode
 * labels each exchange as it ends, seeing the conversation so far and what is already labelled in
 * it; conversation mode labels a whole conversation in one call. A call that fails is recorded and
 * the loop moves on: nothing is asked again.
 */
import {
  checkLabels,
  emptyLabels,
  LabelsSchema,
  mergeLabels,
  type CheckedLabels,
} from "@/mind/memory/user/annotations";
import { buildLabelInput } from "@/mind/memory/user/label-input";
import { messagesOf } from "@/mind/memory/user/layers";
import { numberPieces, type Message } from "@/mind/memory/user/pieces";
import type { LLMProvider } from "@/mind/platform/llm/types";
import type { ReplayConversation, ReplayExchange } from "./replay-source";

export type Unit = "exchange" | "conversation";
/** One call: which messages it labelled, its checked labels, or why it failed. */
export type CallResult = { messages: string; labels: CheckedLabels | null; error: string | null };
export type UnitResult = { unit: Unit; thinking: boolean; calls: Map<string, CallResult[]> };
export type UnitOptions = { system: string; thinking: boolean; maxTokens: number; timeoutMs: number };

export const conversationKey = (c: ReplayConversation) => `${c.run}/${c.id}`;

export async function runUnit(
  llm: LLMProvider,
  unit: Unit,
  conversations: ReplayConversation[],
  opts: UnitOptions,
): Promise<UnitResult> {
  const calls = new Map<string, CallResult[]>();
  for (const c of conversations) {
    calls.set(
      conversationKey(c),
      unit === "exchange" ? await byExchange(llm, c, opts) : [await whole(llm, c, opts)],
    );
  }
  return { unit, thinking: opts.thinking, calls };
}

async function byExchange(
  llm: LLMProvider,
  c: ReplayConversation,
  opts: UnitOptions,
): Promise<CallResult[]> {
  const messages = messagesOf([...c.before, ...c.turns]);
  const results: CallResult[] = [];
  let earlier = emptyLabels();
  let labelledUpTo = c.before.length;
  for (const exchange of c.exchanges) {
    const end = messages.findIndex((m) => m.id === exchange.replyId) + 1;
    const shown = messages.slice(0, end);
    const result = await label(llm, "exchange", opts, c, shown, labelledUpTo, exchange, earlier);
    if (result.labels) earlier = mergeLabels(earlier, result.labels);
    results.push(result);
    labelledUpTo = end;
  }
  return results;
}

async function whole(
  llm: LLMProvider,
  c: ReplayConversation,
  opts: UnitOptions,
): Promise<CallResult> {
  const messages = messagesOf([...c.before, ...c.turns]);
  // The threads open when the conversation began, as its first exchange was shown them.
  const shown = c.exchanges[0] ?? null;
  return label(llm, "conversation", opts, c, messages, c.before.length, shown, emptyLabels());
}

async function label(
  llm: LLMProvider,
  unit: Unit,
  opts: UnitOptions,
  c: ReplayConversation,
  messages: Message[],
  firstNew: number,
  shown: ReplayExchange | null,
  earlier: CheckedLabels,
): Promise<CallResult> {
  const pieces = numberPieces(messages, firstNew);
  const threads = shown?.threads ?? [];
  const range = `${firstNew + 1} to ${messages.length}`;
  try {
    const raw = await llm.classifyJson({
      purpose: `extract_labels_${unit}${opts.thinking ? "_thinking" : ""}`,
      model: "extract",
      system: opts.system,
      input: buildLabelInput({
        pieces,
        zone: c.zone,
        threads,
        interests: shown?.interests ?? [],
        earlier,
      }),
      schema: LabelsSchema,
      timeoutMs: opts.timeoutMs,
      maxTokens: opts.maxTokens,
      cache: "5m",
    });
    const labels = checkLabels(raw, {
      pieces,
      zone: c.zone,
      threadIds: threads.map((t) => t.id),
      earlier,
    });
    return { messages: range, labels, error: null };
  } catch (e) {
    return { messages: range, labels: null, error: (e as Error).message };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/evals/label-replay.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add evals/lib/label-replay.ts tests/evals/label-replay.test.ts
git commit -m "feat(evals): labelling replay run loop, per exchange and per conversation"
```

---

### Task 9: The review file

**Files:**
- Create: `evals/lib/label-review.ts`
- Test: `tests/evals/label-review.test.ts`

**Interfaces:**
- Consumes:
  - from Task 4: `emptyLabels`, `mergeLabels`, `type CheckedLabels`;
  - from Task 3: `messagesOf`;
  - from Task 2: `numberPieces`, `renderPieces`, `type Piece`;
  - from Task 1: `renderResolved`;
  - from Task 8: `conversationKey`, `type UnitResult`;
  - from Task 7: `type ReplayConversation`.
- Produces:
  - `type UsageLine = { purpose: string; calls: number; input: number; output: number; cacheRead: number; cost: number | null }`;
  - `type NamedCase = { title: string; text: string }`;
  - `NAMED_CASES: NamedCase[]`;
  - `type ReviewInput = { stamp: string; conversations: ReplayConversation[]; results: UnitResult[]; usage: UsageLine[]; namedCases: NamedCase[] }`;
  - `renderReview(input: ReviewInput): string`.

- [ ] **Step 1: Write the failing test**

```ts
/** The labelling replay's review file: totals, named cases first, then every conversation. */
import { expect, test } from "vitest";
import { emptyLabels } from "@/mind/memory/user/annotations";
import { conversations, type LayerTurn } from "@/mind/memory/user/layers";
import { conversationKey, type UnitResult } from "../../evals/lib/label-replay";
import { renderReview } from "../../evals/lib/label-review";
import type { ReplayConversation } from "../../evals/lib/replay-source";

const turn = (id: string, role: LayerTurn["role"], minute: number, text: string, extra: Partial<LayerTurn> = {}): LayerTurn => ({
  id,
  role,
  text,
  created_at: new Date(Date.UTC(2026, 0, 12, 10, minute)),
  session_id: "s1",
  reply_to: null,
  trigger: null,
  ...extra,
});
const [conversation] = conversations([
  turn("r1", "companion", 0, "has it been dark since friday", { trigger: "reach_out" }),
  turn("u1", "user", 30, "yeah nothing yet"),
  turn("c1", "companion", 31, "ugh, waiting is the worst", { reply_to: "u1" }),
]);
const c: ReplayConversation = {
  run: "16c close",
  id: conversation!.id,
  zone: "UTC",
  before: [],
  turns: conversation!.turns,
  exchanges: conversation!.exchanges.map((e) => ({
    ...e,
    threads: [],
    interests: [],
    v11: { facts: [{ subject: "user", kind: "event", content: "The user has been waiting since Friday." }] },
  })),
};
const labelled = {
  ...emptyLabels(),
  moves: [{ id: "m2", pieces: ["2.1"], coords: [], speaker: "user" as const, act: "answers" as const, repliesTo: "m1" }],
  propositions: [
    {
      id: "p1",
      moves: ["m2"],
      subject: "user" as const,
      kind: "state" as const,
      label: "waiting to hear back",
      status: null,
      times: [],
      mentions: [],
      thread_id: null,
      new_thread: null,
      updates: null,
      salience: 0.5,
      valence: -0.3,
      confidence: 0.9,
      claim_kind: null,
    },
  ],
  drops: [{ layer: "proposition", id: "p2", reason: "wrong_speaker" as const }],
};
const results: UnitResult[] = [
  {
    unit: "conversation",
    thinking: false,
    calls: new Map([[conversationKey(c), [{ messages: "1 to 3", labels: labelled, error: null }]]]),
  },
  {
    unit: "conversation",
    thinking: true,
    calls: new Map([[conversationKey(c), [{ messages: "1 to 3", labels: null, error: "bad enum" }]]]),
  },
];

test("the review shows totals, the named case, the numbered conversation, v11 and each unit's labels", () => {
  const out = renderReview({
    stamp: "STAMP",
    conversations: [c],
    results,
    usage: [{ purpose: "extract_labels_conversation", calls: 1, input: 3500, output: 1200, cacheRead: 0, cost: 0.00095 }],
    namedCases: [{ title: "since friday, from her own question", text: "has it been dark since friday" }],
  });
  expect(out).toContain("# Labelling replay STAMP");
  expect(out).toContain("| conversation | off | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 1 (wrong_speaker 1) |");
  expect(out).toContain("| conversation | on | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |");
  expect(out).toContain("| extract_labels_conversation | 1 | 3500 | 1200 | 0 | $0.001 |");
  expect(out.indexOf("### since friday, from her own question")).toBeLessThan(out.indexOf("## Conversations"));
  expect(out).toContain("[2.1] User · Mon 2026-01-12 10:30 (UTC): yeah nothing yet");
  expect(out).toContain("- user event: The user has been waiting since Friday.");
  expect(out).toContain('- m2 answers → m1: "yeah nothing yet" (User)');
  expect(out).toContain('- p1 user state "waiting to hear back" · salience 0.5 · rests on m2: "yeah nothing yet" (User)');
  expect(out).toContain("- dropped proposition p2: wrong_speaker");
  expect(out).toContain("- failed: bad enum");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/evals/label-review.test.ts`
Expected: FAIL, failed to resolve import `../../evals/lib/label-review`.

- [ ] **Step 3: Write the implementation**

````ts
/**
 * The labelling replay's review file: totals per unit and pass, tokens and cost, the named cases,
 * then every conversation numbered into pieces with v11's facts beside each unit's labels, cited
 * words and dates written out, and every dropped label with its reason.
 */
import { emptyLabels, mergeLabels, type CheckedLabels } from "@/mind/memory/user/annotations";
import { messagesOf } from "@/mind/memory/user/layers";
import { numberPieces, renderPieces, type Piece } from "@/mind/memory/user/pieces";
import { renderResolved } from "@/mind/platform/time-labels";
import { conversationKey, type UnitResult } from "./label-replay";
import type { ReplayConversation } from "./replay-source";

export type UsageLine = {
  purpose: string;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cost: number | null;
};
export type NamedCase = { title: string; text: string };
export type ReviewInput = {
  stamp: string;
  conversations: ReplayConversation[];
  results: UnitResult[];
  usage: UsageLine[];
  namedCases: NamedCase[];
};

/** The recorded moments the old pipeline got wrong, found by their words. */
export const NAMED_CASES: NamedCase[] = [
  { title: "since friday, from her own question", text: "has it been dark since friday" },
  { title: "a day added to the interview", text: "okay the interview happened" },
  { title: "a user fact from her words", text: "ok i should really try to sleep" },
  { title: "the speaker swap", text: "telescope zoning out sounds nice" },
  { title: "the interview moved to the race's Sunday", text: "no half marathon yet lol" },
  { title: "extract's own ISO dates", text: "i think it went well?" },
];

const LAYERS = ["moves", "mentions", "times", "propositions", "threads", "idiolect"] as const;

export function renderReview(input: ReviewInput): string {
  const named = input.namedCases.flatMap((n) => {
    const c = input.conversations.find((x) =>
      [...x.before, ...x.turns].some((t) => t.text.includes(n.text)),
    );
    return c ? [{ title: n.title, c }] : [];
  });
  const invented = input.conversations.filter((c) => c.run === "invented").length;
  return [
    `# Labelling replay ${input.stamp}`,
    "",
    `Extract v12 over ${input.conversations.length} conversations (${invented} invented).`,
    "",
    "## Totals",
    "",
    ...totals(input.results),
    "",
    "## Tokens and cost",
    "",
    ...usage(input.usage),
    "",
    "## Named cases",
    "",
    ...named.flatMap(({ title, c }) => [`### ${title}`, "", ...conversation(c, input.results)]),
    "## Conversations",
    "",
    ...input.conversations.flatMap((c) => [
      `### ${c.run} · ${c.turns[0]?.created_at.toISOString().slice(0, 16) ?? ""} · ${c.id.slice(0, 8)}`,
      "",
      ...conversation(c, input.results),
    ]),
  ].join("\n");
}

function totals(results: UnitResult[]): string[] {
  const rows = results.map((r) => {
    const calls = [...r.calls.values()].flat();
    const ok = calls.flatMap((x) => (x.labels ? [x.labels] : []));
    const counts = LAYERS.map((layer) => ok.reduce((n, l) => n + l[layer].length, 0));
    const drops = ok.flatMap((l) => l.drops);
    const reasons = new Map<string, number>();
    for (const d of drops) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
    const why = [...reasons].map(([reason, n]) => `${reason} ${n}`).join(", ");
    const failed = calls.length - ok.length;
    return `| ${r.unit} | ${r.thinking ? "on" : "off"} | ${calls.length} | ${failed} | ${counts.join(" | ")} | ${drops.length}${why ? ` (${why})` : ""} |`;
  });
  return [
    `| Unit | Thinking | Calls | Failed | ${LAYERS.map((l) => l[0]!.toUpperCase() + l.slice(1)).join(" | ")} | Drops |`,
    `|${" --- |".repeat(LAYERS.length + 5)}`,
    ...rows,
  ];
}

function usage(lines: UsageLine[]): string[] {
  const money = (cost: number | null) => (cost === null ? "?" : `$${cost.toFixed(3)}`);
  const total = lines.reduce<number | null>(
    (sum, u) => (sum === null || u.cost === null ? null : sum + u.cost),
    0,
  );
  return [
    "| Purpose | Calls | Input | Output | Cache read | Cost |",
    "| --- | --- | --- | --- | --- | --- |",
    ...lines.map(
      (u) => `| ${u.purpose} | ${u.calls} | ${u.input} | ${u.output} | ${u.cacheRead} | ${money(u.cost)} |`,
    ),
    `| total | | | | | ${money(total)} |`,
  ];
}

function conversation(c: ReplayConversation, results: UnitResult[]): string[] {
  const turns = [...c.before, ...c.turns];
  const pieces = numberPieces(messagesOf(turns), c.before.length);
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const number = (id: string) => turns.findIndex((t) => t.id === id) + 1;
  const exchanges = c.exchanges.map((e) => [...e.burst, e.replyId].map(number).join(","));
  const v11 = c.exchanges.flatMap((e) => factsOf(e.v11));
  const lines = [
    ...(c.note ? [`Expected: ${c.note}`, ""] : []),
    "```",
    renderPieces(pieces, c.zone),
    "```",
    "",
    `Exchanges (messages): ${exchanges.join(" · ") || "none"}`,
    "",
    ...(v11.length ? ["v11 (as logged):", ...v11, ""] : []),
  ];
  for (const r of results) {
    lines.push(`#### ${r.unit} mode, thinking ${r.thinking ? "on" : "off"}`, "");
    let known = emptyLabels();
    for (const call of r.calls.get(conversationKey(c)) ?? []) {
      lines.push(`Call (messages ${call.messages}):`);
      if (!call.labels) {
        lines.push(`- failed: ${call.error}`, "");
        continue;
      }
      known = mergeLabels(known, call.labels);
      lines.push(...describe(call.labels, known, byId), "");
    }
  }
  return lines;
}

function factsOf(output: unknown): string[] {
  const facts =
    (output as { facts?: { subject: string; kind: string; content: string }[] } | null)?.facts ??
    [];
  return facts.map((f) => `- ${f.subject} ${f.kind}: ${f.content}`);
}

/** One call's labels for a reader, with cited words and dates written out. */
function describe(l: CheckedLabels, known: CheckedLabels, pieces: Map<string, Piece>): string[] {
  const words = (ids: string[]) => ids.map((id) => pieces.get(id)?.text ?? `?${id}`).join(" / ");
  const who = (ids: string[]) =>
    pieces.get(ids[0] ?? "")?.message.speaker === "user" ? "User" : "Spica";
  const cited = (ids: string[]) => `"${words(ids)}" (${who(ids)})`;
  const when = (id: string) => {
    const t = known.times.find((x) => x.id === id);
    if (t?.resolved) return renderResolved(t.resolved);
    return t?.relativeTo ? `relative to ${t.relativeTo}` : id;
  };
  const moves = new Map(known.moves.map((m) => [m.id, m]));
  return [
    ...l.moves.map((m) => `- ${m.id} ${m.act}${m.repliesTo ? ` → ${m.repliesTo}` : ""}: ${cited(m.pieces)}`),
    ...l.mentions.map(
      (m) =>
        `- ${m.id} "${m.words}" → ${m.refers_to ?? `new ${m.type ?? "thing"} "${m.name ?? m.words}"${m.relation ? ` (${m.subject ?? "?"}, ${m.relation})` : ""}`}`,
    ),
    ...l.times.map((t) => `- ${t.id} "${t.words}" → ${when(t.id)}`),
    ...l.propositions.map((p) => {
      const rests = p.moves.map((id) => {
        const m = moves.get(id);
        return m ? `${id}: ${cited(m.pieces)}` : id;
      });
      const parts = [
        `${p.subject} ${p.kind} "${p.label}"`,
        p.status,
        ...p.times.map(when),
        p.updates && `updates ${p.updates}`,
        p.thread_id && `thread ${p.thread_id}`,
        p.new_thread && `new thread "${p.new_thread}"`,
        `salience ${p.salience}`,
      ].filter(Boolean);
      return `- ${p.id} ${parts.join(" · ")} · rests on ${rests.join("; ")}`;
    }),
    ...l.threads.map(
      (t) =>
        `- thread ${t.action} ${t.thread_id ?? "new"} "${t.title}" ${t.stakes}${t.checkpointAt ? ` · check in ${renderResolved(t.checkpointAt)}` : ""}`,
    ),
    ...l.idiolect.map((i) => `- ${i.id} ${i.type}, started by ${i.startedBy}: ${cited(i.pieces)}`),
    ...(l.relationship ? [`- relationship ${JSON.stringify(l.relationship)}`] : []),
    ...(l.intimacy ? [`- intimacy ${JSON.stringify(l.intimacy)}`] : []),
    ...(l.bid_response ? [`- bid response ${l.bid_response.response} (${l.bid_response.move})`] : []),
    ...l.drops.map((d) => `- dropped ${d.layer} ${d.id}: ${d.reason}`),
  ];
}
````

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/evals/label-review.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add evals/lib/label-review.ts tests/evals/label-review.test.ts
git commit -m "feat(evals): labelling replay review file"
```

---

### Task 10: The replay command, a free dry run, and the local checks

**Files:**
- Create: `evals/extract-replay.ts`
- Modify: `package.json` (add one script after `"review:extract"`)
- Modify: `DECISIONS.md` (append four rows)

**Interfaces:**
- Consumes everything above, plus:
  - `realProvider` (`evals/lib/call-log.ts`);
  - `UsageTally` (`evals/lib/usage.ts`);
  - `spend` (`src/mind/platform/llm/meter.ts`);
  - `loadConfig`;
  - `loadPrompt`.
- Produces: `pnpm review:extract-labels` (and `-- --dry`).

- [ ] **Step 1: Write `evals/extract-replay.ts`**

```ts
/**
 * Replay for labelled memory: reruns the labelling call (extract v12) over the latest world runs'
 * conversations and the invented chat ones, after each exchange and once per conversation, with
 * thinking off and on, and writes one review file to read by hand. Reads dumps and call logs;
 * writes no database. Every call is logged under evals/results/calls/. `--dry` builds every input
 * and prints the counts and one input, without calling a model.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { emptyLabels } from "@/mind/memory/user/annotations";
import { buildLabelInput } from "@/mind/memory/user/label-input";
import { messagesOf } from "@/mind/memory/user/layers";
import { numberPieces } from "@/mind/memory/user/pieces";
import { loadConfig } from "@/mind/platform/config";
import { spend } from "@/mind/platform/llm/meter";
import { loadPrompt } from "@/mind/platform/prompts";
import { realProvider } from "./lib/call-log";
import { runUnit, type UnitResult } from "./lib/label-replay";
import { NAMED_CASES, renderReview } from "./lib/label-review";
import { loadRun } from "./lib/replay-source";
import { SLANG_CONVERSATIONS } from "./lib/slang-conversations";
import { UsageTally } from "./lib/usage";

const RESULTS = path.join(process.cwd(), "evals", "results");
const RUNS = [
  { run: "10-22", trace: "2026-10-22T08-27-19-368Z", calls: "eval-2026-10-22T08-27-19-194Z" },
  { run: "16b close", trace: "2026-10-24T08-48-12-791Z", calls: "eval-2026-10-24T08-48-12-585Z" },
  { run: "16c close", trace: "2026-10-24T15-12-40-678Z", calls: "eval-2026-10-24T15-12-40-452Z" },
];
// A dev tool's limits, not the mind's: room for every layer of a whole conversation, and for
// thinking before it.
const MAX_TOKENS = { off: 8192, on: 16384 };
const TIMEOUT_MS = 180_000;

const config = loadConfig();
const thinkingConfig = loadConfig({ models: { structured_thinking: "adaptive" } });
const conversations = [
  ...RUNS.flatMap((r) =>
    loadRun(
      r.run,
      path.join(RESULTS, "traces", r.trace, "world-outreach-two-weeks-1-db.json"),
      path.join(RESULTS, "calls", `${r.calls}.jsonl`),
      config.extraction.context_turns,
    ),
  ),
  ...SLANG_CONVERSATIONS,
];

if (process.argv.includes("--dry")) {
  const exchanges = conversations.flatMap((c) => c.exchanges);
  const matched = exchanges.filter((e) => e.v11 !== null).length;
  console.log(
    `${conversations.length} conversations, ${exchanges.length} exchanges, ${matched} matched to a logged v11 call`,
  );
  const c = conversations.find((x) => x.run !== "invented" && x.turns.length > 3)!;
  console.log(
    buildLabelInput({
      pieces: numberPieces(messagesOf([...c.before, ...c.turns]), c.before.length),
      zone: c.zone,
      threads: c.exchanges[0]?.threads ?? [],
      interests: c.exchanges[0]?.interests ?? [],
      earlier: emptyLabels(),
    }),
  );
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("pnpm review:extract-labels needs ANTHROPIC_API_KEY");
}

const usage = new UsageTally();
const system = loadPrompt("extract", "v12");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(RESULTS, `review-extract-labels-${stamp}.md`);
const results: UnitResult[] = [];
mkdirSync(RESULTS, { recursive: true });

const passes = [
  { thinking: false, llm: realProvider(config, "extract-replay", usage.record) },
  { thinking: true, llm: realProvider(thinkingConfig, "extract-replay-thinking", usage.record) },
];
for (const { thinking, llm } of passes) {
  for (const unit of ["exchange", "conversation"] as const) {
    console.log(`${unit} mode, thinking ${thinking ? "on" : "off"}…`);
    results.push(
      await runUnit(llm, unit, conversations, {
        system,
        thinking,
        maxTokens: thinking ? MAX_TOKENS.on : MAX_TOKENS.off,
        timeoutMs: TIMEOUT_MS,
      }),
    );
    // Written after every unit, so a crash later still leaves what was paid for.
    const lines = usage.summary().map((u) => ({
      purpose: u.purpose,
      calls: u.calls,
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens,
      cost: spend([u], config.core.prices).cost,
    }));
    writeFileSync(
      file,
      renderReview({ stamp, conversations, results, usage: lines, namedCases: NAMED_CASES }),
    );
  }
}
console.log(`wrote ${file}`);
for (const line of usage.format()) console.log(line);
```

- [ ] **Step 2: Add the script to `package.json`.** Right after the `"review:extract": …` line:

```json
    "review:extract-labels": "tsx --env-file-if-exists=.env evals/extract-replay.ts",
```

- [ ] **Step 3: Dry-run it (free, no model calls)**

Run: `pnpm review:extract-labels -- --dry`

Expected:
- the first line reads `55 conversations, 81 exchanges, N matched to a logged v11 call`: 45 recorded plus 10 invented conversations, and 68 recorded plus 13 invented exchanges. N should be close to 66 (the logs hold 22 extract calls per run); a low N means the call matching is wrong, so stop and fix it;
- then one full input in the Task 5 format, with numbered pieces, open threads with ids, and "Label the new messages (…)".

If a paid-run hook asks for confirmation, confirm only after checking `--dry` is in the command.

- [ ] **Step 4: Append the decisions.** Add these rows to the table in `DECISIONS.md` (dated the day they're written):

```markdown
| 2026-10-25 | `prompts/extract/v12.md` exists while `prompts.extract` stays v11 | The labelling replay reads it by name; the next slice makes it live or deletes it, so no unread version outlives the change. |
| 2026-10-25 | A labelled proposition needs a new move that presents it as true, by the one it is about | An old statement can't come back in on a new "lol", her guess is never their fact, and a late "yep" still carries a fact together with the question it answers. |
| 2026-10-25 | A label failing a check is dropped with everything resting on it; the relationship, intimacy and bid blocks drop whole | Nothing is asked again, and a block resting on a missing move can't be traced to what it was read from. |
| 2026-10-25 | The labelling replay's token caps and timeout are constants in `evals/extract-replay.ts` | They are a dev tool's limits, not the mind's settings. |
```

- [ ] **Step 5: Run the local checks**

Run:
- `pnpm typecheck`: expect no errors.
- `pnpm lint`: expect no errors. If Prettier complains, run `pnpm format` and re-check.
- `pnpm test`, the full suite, once, about 10 minutes; run it in the foreground with `--maxWorkers=4` if it times out. Expect it to pass, as before plus the new tests. A failure is reported with its output, never weakened.

- [ ] **Step 6: Commit**

```bash
git add evals/extract-replay.ts package.json DECISIONS.md
git commit -m "feat(evals): pnpm review:extract-labels, the labelling replay (with --dry)"
```

---

### Task 11: The paid replay (gated: needs Ethan's go-ahead)

**Files:** none changed. Outputs:
- `evals/results/review-extract-labels-<stamp>.md`;
- `evals/results/calls/extract-replay-<stamp>.jsonl`;
- `evals/results/calls/extract-replay-thinking-<stamp>.jsonl`;
- `evals/results/run-extract-labels-17a.log`.

- [ ] **Step 1: Pre-flight through the `review-run` skill.** Tell Ethan:
  - purpose: does v12's layered labelling hold, and which unit and thinking setting goes into 17b;
  - calls: 136 per pass (81 in exchange mode, 55 in conversation mode), two passes;
  - cost: about 12 cents with thinking off; the thinking pass is estimated at 25 to 40 cents more;
  - where the outputs land (above).

  **Wait for his explicit yes.**

- [ ] **Step 2: Start it detached.** Background shells get reaped on this box. In PowerShell:

```powershell
Start-Process cmd -ArgumentList '/c', 'pnpm review:extract-labels > evals\results\run-extract-labels-17a.log 2>&1' -WindowStyle Hidden
```

Watch the log with Monitor until it prints `wrote …review-extract-labels-…md`.

- [ ] **Step 3: Check the run left readable outputs:** the review file, both call logs, and the usage lines at the end of the log. Report the measured cost to Ethan.

---

### Task 12: Analysis, read together

**Files:**
- Create: `evals/results/analysis-<date>-phase-17a.md`

- [ ] **Step 1: Write the analysis from the review file** (not the call logs whole, per the `review-run` skill). Cover:
  - **The totals per unit and pass:** failed calls and why (invalid enum values, timeouts); drops per reason.
  - **Each named case:** did it reproduce? Quote the labels.
  - **The invented conversations:** did each time word resolve to the "Expected" date? Were the moves over three messages and the late reply grouped right?
  - **What v11 caught that v12 missed,** on a hand pass over the recorded conversations.
  - **Exchange mode against conversation mode,** and thinking off against on: label quality differences, tokens and cost.
  - **Checks that misfired:** drops that were actually right.

- [ ] **Step 2: Read it with Ethan** and settle the choices for 17b:
  - the unit (exchange, conversation or both);
  - thinking on or off;
  - prompt changes;
  - check changes;
  - whether bad enum values should drop one label instead of failing the call.

  Record his choices in memory (`memory-overhaul-settled`).

---

### Task 13: Close 17a

- [ ] **Step 1: Run the `spica-close` skill.** It runs the definition of done in order, stopping at the first failure:
  1. typecheck, lint and tests;
  2. the leak canary (unchanged, since no pipeline change);
  3. `scope-reviewer` on the branch diff (`main..phase-17a`; tell it not to run tests);
  4. the spec write-back:
     - §20: add the Phase 17 row (Labelled memory; 17a built, replay only; both design docs);
     - §10.4: one line saying `prompts/extract/v12.md` labels a conversation in layers for the replay only, and that `prompts.extract` stays v11 until 17b;
     - §25: B129–B132 and B1 "paused for Phase 17, re-checked at 17b's close";
  5. CLAUDE.md "Current phase": Phase 17 labelled memory, 17a built, next 17b;
  6. the commit.
- [ ] **Step 2: Merge to `main` only when Ethan says so.** Then delete this plan file in the same commit, since built plans are deleted and the history is in git.
