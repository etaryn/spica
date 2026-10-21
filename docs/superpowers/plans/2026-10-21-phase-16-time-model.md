# Phase 16: Time Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the date slips: code renders every time a prompt reads as a date plus its distance from now, ideas expire once their event has passed, and relative words in stored text are flagged.

**Architecture:**
- **Renderer.** `src/mind/platform/relative-date.ts` (which already has `relativeDate` and `dayInWords`) becomes the one renderer. Every prompt input that carries a time goes through it.
- **Expiry.** A new nullable `fact.stale_after` column is set by code when ideate writes an idea. The daily decay pass retires expired open facts as `stale`, and readers skip `stale_after <= now` between sweeps. It replaces `ideaCutoff`.
- **Present-tense notes.** Summaries, her notes on them (model), the snapshot and ideas carry a "written …" stamp.
- **Slipped words.** A shared `relativeWords` check logs any slip, and the review lists them.
- **Guard.** Guard v6 gets NOW in both zones, a misdating rule and the B127 line.

**Tech Stack:** TypeScript, Vitest, Drizzle and Postgres (pnpm `db:generate`), Intl for zones, YAML guard eval cases.

**Spec:** `docs/2026-10-21-phase-16-time-model-design.md` (settled 2026-10-21). Spec §20 "Time model" row, §25 B125, B126 and B127.

## Global Constraints

- Every numeric constant lives in `config/default.json`. No new constant is needed: the undated-idea chance stays `user_mind.ideate.ttl_days` (3).
- Every prompt change is a new version file plus the config bump in `config/default.json` → `prompts`. Delete the old version file in the same task (`prompts/CLAUDE.md`).
- Don't touch `prompts/persona/*` (Ethan's rewrite is pending).
- `src/mind` stays framework-free: no `Date.now()`; time comes from `deps.clock` or a `now` argument.
- Core code takes `CoreDeps` and never reads user data. ESLint stops core, world and shared code importing user, process or admin-repo code; don't work around it.
- Comments say why, never cite spec sections, phases or review items.
- Every file keeps its plain-English header comment; new files get one.
- Prettier at 100 columns (`pnpm format`).
- Tests: run targeted (`pnpm test <path>`). The full suite (~10 min) runs once, at close. Run one test process at a time: they share a test DB.
- Replace from the ground up: `ideaCutoff` and its test are deleted, not kept beside `stale_after`.
- Never write strings with backslashes through shell heredocs; use the Edit/Write tools.

## Review Focus

1. **A user with no time zone, or an invalid one.** Every renderer call takes a zone resolved through `zoneOrUtc`, so it falls back to UTC instead of throwing `RangeError` from Intl. Pinned in Task 1 (`zoneOrUtc`) and Task 4 (memory lines with `timezone: null`).
2. **An idea already used (resolved).** The expiry sweep must not turn it `stale`, or it drops out of `already_planned` and gets pitched again. Pinned in Task 2.
3. **An idea whose dated sources are all in the past** ("ask how Sunday's race went", written Monday). It keeps its 3-day chance and is not born stale. Pinned in Task 2.
4. **An event "tonight" for a user east of UTC.** The idea expires at the end of *their* local day, not the UTC day. Pinned in Task 2 (Asia/Singapore).
5. **An anticipation whose intention is gone or has no `event_at`.** It stays a candidate, with no crash. Pinned in Task 3.

---

## File map

| File | Change |
|---|---|
| `src/mind/platform/timezone.ts` | add `zoneOrUtc` |
| `src/mind/platform/relative-date.ts` | add `writtenOn`, `itemWhen`, `stamped`, `relativeWords`, `noteRelativeWords` |
| `src/db/schema.ts`, `src/db/migrations/0041_*.sql` | `fact.stale_after` + backfill |
| `src/db/repos/user/user-mind.ts` | `liveIdeas(db, userId, now, limit)` reads `stale_after` |
| `src/db/repos/admin/decay.ts` | the sweep expires open facts past `stale_after` |
| `src/mind/process/user/ideate.ts` | `ideaStaleAfter`, sets `stale_after`; `ideaCutoff` deleted |
| `src/mind/process/hot-path/compose.ts`, `src/mind/process/outreach/{inputs,send}.ts` | idea readers use `now` / `stale_after` |
| `src/mind/process/outreach/inputs.ts` | an anticipation past its event isn't a core-thought candidate |
| `src/db/repos/user/{facts,threads}.ts` | unread facts carry `created_at`; open threads carry `next_checkpoint` |
| `src/mind/process/user/{inputs,summarise,reflect,model,ideate,run}.ts` | rendered dates, written stamps, slip logging |
| `prompts/user-mind/{summarise,reflect,model}/v4.md`, `prompts/user-mind/ideate/v6.md` | date lines |
| `src/mind/process/cold-path/cold-path.ts` | extract's slip logging |
| `src/mind/memory/core/self.ts` (new) | `latestSelf`: her snapshot stamped with its night |
| `src/mind/process/core/{anticipate,appraise,resolve,ruminate,wander,reflect,render-snapshot,thoughts}.ts`, `src/mind/world/events.ts` | stamped self, rendered dates, slip logging |
| `prompts/core/{appraise,anticipate,ruminate,wander,reflect,snapshot}/v3.md` | date lines |
| `src/mind/memory/shared/types.ts`, `src/mind/memory/{user,core}/retrieve.ts` | `RetrievedFact.noted` |
| `src/mind/process/hot-path/{assemble,compose}.ts` | stamped snapshot, summary, read and ideas; `itemWhen` on facts |
| `src/mind/process/guard/guard.ts`, `prompts/guard/v6.md`, `evals/guard/*.yaml` | `guardNow`, guard v6, new cases |
| `evals/lib/review.ts` | lists relative words in stored text |
| `tests/exit/phase-16.test.ts` (new) | exit test with leak canary |
| `spica-design-spec-v3.md`, `DECISIONS.md`, `docs/spec-v3-history.md` | write-back at close |

---

### Task 1: The renderer and the slip check

**Files:**
- Modify: `src/mind/platform/timezone.ts` (add `zoneOrUtc`; `formatLocal` uses it)
- Modify: `src/mind/platform/relative-date.ts`
- Test: `tests/mind/platform/relative-date.test.ts`, `tests/mind/platform/timezone.test.ts`

**Interfaces:**
- Produces:
  - `zoneOrUtc(tz: string | null | undefined): string`
  - `writtenOn(at: Date, now: Date, tz: string): string` → `"written Tuesday 13 January, 2 days ago"`
  - `itemWhen(about: Date, noted: Date | null, now: Date, tz: string): string` → `"Saturday 17 January, in 2 days"`, or `"Saturday 17 January, in 2 days; noted Tuesday 13 January, 2 days ago"` when noted on another local day
  - `stamped(text: string, at: Date, now: Date, tz: string): string` → `"(written Tuesday 13 January, yesterday)\n<text>"`
  - `relativeWords(text: string): string[]`: the relative day words found, lowercased, in order
  - `noteRelativeWords(log: Logger, writer: string, texts: (string | null | undefined)[]): string[]`: logs `log.info("relative words in stored text", { writer, words })` when any are found; returns the words
- Existing, unchanged: `relativeDate(when, now, tz)` and `dayInWords(when, now, tz)` → `"Sunday 11 January, yesterday"`

- [ ] **Step 1: Write the failing tests**

Append to `tests/mind/platform/relative-date.test.ts` (and add the new names to its import):

```ts
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
  const logs: { msg: string; meta?: unknown }[] = [];
  const log = { info: (msg: string, meta?: unknown) => logs.push({ msg, meta }), error: () => {} };
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
```

Append to `tests/mind/platform/timezone.test.ts` (add `zoneOrUtc` to its import from `@/mind/platform/timezone`):

```ts
test("zoneOrUtc falls back to UTC for a missing or unknown zone", () => {
  expect(zoneOrUtc("Asia/Singapore")).toBe("Asia/Singapore");
  expect(zoneOrUtc(null)).toBe("UTC");
  expect(zoneOrUtc(undefined)).toBe("UTC");
  expect(zoneOrUtc("Mars/Olympus")).toBe("UTC");
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/platform/relative-date.test.ts tests/mind/platform/timezone.test.ts`
Expected: FAIL, because `itemWhen`, `writtenOn`, `stamped`, `relativeWords`, `noteRelativeWords` and `zoneOrUtc` are not exported.

- [ ] **Step 3: Implement**

In `src/mind/platform/timezone.ts`, after `isValidTimeZone`:

```ts
/** Their zone when it's a real one; UTC otherwise, so a bad zone never breaks a prompt. */
export function zoneOrUtc(tz: string | null | undefined): string {
  return tz && isValidTimeZone(tz) ? tz : "UTC";
}
```

and change the first line of `formatLocal` to `const zone = zoneOrUtc(tz);`.

Replace `src/mind/platform/relative-date.ts` with:

```ts
import type { Logger } from "./log";
import { DAY } from "./time";
import { localDateString } from "./timezone";
/**
 * Dates as she would say them: "today", "yesterday", "3 days ago", "in 2 days", counted in whole
 * calendar days of the given zone. Every time a prompt reads goes through here, so the model never
 * counts days; and stored text is checked for relative words, which go stale on the next day.
 */

export function relativeDate(when: Date, now: Date, tz: string): string {
  const days = Math.round((dayStart(now, tz) - dayStart(when, tz)) / DAY);

  if (days < 0) return `in ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** "Sunday 11 January, yesterday": the date itself and how far it is from now. */
export function dayInWords(when: Date, now: Date, tz: string): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(when)
    .replace(",", "");
  return `${date}, ${relativeDate(when, now, tz)}`;
}

/** "written Tuesday 13 January, 2 days ago": what a note calls today was that day's. */
export function writtenOn(at: Date, now: Date, tz: string): string {
  return `written ${dayInWords(at, now, tz)}`;
}

/** A note about the present, headed by the day it was written. */
export function stamped(text: string, at: Date, now: Date, tz: string): string {
  return `(${writtenOn(at, now, tz)})\n${text}`;
}

/**
 * When a memory's thing happens, and when she learned it if that was another day: "about
 * Saturday" read on Tuesday and on Sunday are different news.
 */
export function itemWhen(about: Date, noted: Date | null, now: Date, tz: string): string {
  const day = dayInWords(about, now, tz);
  if (!noted || localDateString(noted, tz) === localDateString(about, tz)) return day;
  return `${day}; noted ${dayInWords(noted, now, tz)}`;
}

// Day words that mean something else when the text is read on a later day.
const RELATIVE =
  /\b(today|tonight|tomorrow|yesterday|this (?:morning|afternoon|evening|week|weekend)|last night|next week)\b/gi;

/** The relative day words in a text, lowercased, in order. */
export function relativeWords(text: string): string[] {
  return [...text.matchAll(RELATIVE)].map((m) => m[1]!.toLowerCase());
}

/**
 * Logs relative words that slipped into text about to be stored. Nothing is retried or changed:
 * readers see the written-on date, and the review counts the slips.
 */
export function noteRelativeWords(
  log: Logger,
  writer: string,
  texts: (string | null | undefined)[],
): string[] {
  const words = texts.flatMap((t) => (t ? relativeWords(t) : []));
  if (words.length) log.info("relative words in stored text", { writer, words });
  return words;
}

function dayStart(at: Date, tz: string): number {
  return Date.parse(`${localDateString(at, tz)}T00:00:00Z`);
}
```

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/platform/relative-date.test.ts tests/mind/platform/timezone.test.ts`
Expected: PASS. If the `Logger` meta type rejects the test's `unknown`, type the test's `meta` as `Record<string, unknown> | undefined`; never loosen `Logger`.

- [ ] **Step 5: Commit**

```bash
git add src/mind/platform/relative-date.ts src/mind/platform/timezone.ts tests/mind/platform/relative-date.test.ts tests/mind/platform/timezone.test.ts
git commit -m "feat(time): one renderer for dates, written-on stamps and a relative-word check"
```

---

### Task 2: Ideas expire by their event (`fact.stale_after`)

**Files:**
- Modify: `src/db/schema.ts` (the `fact` table)
- Create: `src/db/migrations/0041_*.sql` (generated) plus the backfill line
- Modify: `src/db/repos/user/user-mind.ts` (`liveIdeas`)
- Modify: `src/db/repos/admin/decay.ts`
- Modify: `src/mind/process/user/ideate.ts`
- Modify: `src/mind/process/hot-path/compose.ts:368-376`, `src/mind/process/outreach/inputs.ts:79-84`, `src/mind/process/outreach/send.ts:239-243`
- Test: `tests/mind/process/user/ideate.test.ts`, `tests/db/user-mind-repos.test.ts`, `tests/mind/memory/user/decay.test.ts`, `tests/mind/process/outreach/send.test.ts`, `tests/mind/process/outreach/inputs.test.ts`

**Interfaces:**
- Consumes: `zoneOrUtc` (Task 1); `localDateString`, `localMidnight`, `nextLocalDate` from `@/mind/platform/timezone`.
- Produces:
  - `fact.stale_after: Date | null`: null means no expiry.
  - `ideaStaleAfter(createdAt: Date, sourceDates: Date[], ttlDays: number, tz: string): Date`, exported from `ideate.ts`.
  - `liveIdeas(db, userId, now: Date, limit)`: open ideas with `stale_after` null or after `now`, newest first.
  - `adminDecayFacts(...)` returns `{ decayed, staled, expired, dormant }`.

- [ ] **Step 1: Write the failing tests**

In `tests/mind/process/user/ideate.test.ts`:
1. Change the import to `import { ideaStaleAfter, userIdeate } from "@/mind/process/user/ideate";`.
2. Replace every `liveIdeas(deps.db, userId, ideaCutoff(now, 3), 5)` and `liveIdeas(deps.db, userId, ideaCutoff(deps.clock.now(), 3), 5)` with `liveIdeas(deps.db, userId, deps.clock.now(), 5)`.
3. Delete the test `"ideaCutoff is ttl days back"`.
4. Add:

```ts
const D = 86_400_000;

test("an idea about an upcoming event goes stale at the end of that event's day", () => {
  const written = new Date("2026-01-06T09:00:00Z"); // Tue
  const event = new Date("2026-01-08T19:00:00Z"); // Thu evening
  expect(ideaStaleAfter(written, [event], 3, "UTC").toISOString()).toBe(
    "2026-01-09T00:00:00.000Z",
  );
});

test("an idea for tonight east of UTC ends at their midnight, not UTC's", () => {
  // 10:00 in Singapore on Tue 6th; "tonight" is 22:00 there (14:00 UTC).
  const written = new Date("2026-01-06T02:00:00Z");
  const tonight = new Date("2026-01-06T14:00:00Z");
  expect(ideaStaleAfter(written, [tonight], 3, "Asia/Singapore").toISOString()).toBe(
    "2026-01-06T16:00:00.000Z",
  );
});

test("an idea about a past event keeps its few days' chance; so does an undated one", () => {
  const written = new Date("2026-01-12T09:00:00Z"); // Mon
  const race = new Date("2026-01-11T08:00:00Z"); // Sun, already run
  const chance = new Date(written.getTime() + 3 * D);
  expect(ideaStaleAfter(written, [race], 3, "UTC")).toEqual(chance);
  expect(ideaStaleAfter(written, [], 3, "UTC")).toEqual(chance);
});

test("a far-off event never stretches an idea past its chance", () => {
  const written = new Date("2026-01-06T09:00:00Z");
  const later = new Date("2026-02-20T09:00:00Z");
  expect(ideaStaleAfter(written, [later], 3, "UTC")).toEqual(new Date(written.getTime() + 3 * D));
});

test("ideate stores stale_after from the dated facts it was written from", async () => {
  const { deps, userId, run } = await setup();
  const thursday = new Date(deps.clock.now().getTime() + 48 * 3_600_000);
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "event",
    content: "They have an interview on Thursday.",
    embedding: vec(),
    created_at: deps.clock.now(),
    occurred_at: thursday,
    status: "open",
    salience: 0.8,
    valence: 0,
    confidence: 0.9,
    source: "turn",
  });
  deps.llm.handlers.user_ideate = () => ({ idea: "Ask if they get a break after Thursday." });
  await userIdeate(deps, run, await loadRunInputs(deps, userId));
  const [idea] = await liveIdeas(deps.db, userId, deps.clock.now(), 5);
  expect(idea!.stale_after).toEqual(
    ideaStaleAfter(deps.clock.now(), [thursday], deps.config.user_mind.ideate.ttl_days, "UTC"),
  );
});
```

In `tests/db/user-mind-repos.test.ts`, replace the test `"live ideas are open and newer than the cut-off, newest first"` with:

```ts
test("live ideas are open and not yet stale, newest first", async () => {
  const u = await createTestUser();
  const old = await put(u, "idea", new Date(T0.getTime() - 4 * DAY), "old");
  await getTestDb()
    .update(fact)
    .set({ stale_after: new Date(T0.getTime() - DAY) })
    .where(eq(fact.id, old.id));
  const a = await put(u, "idea", new Date(T0.getTime() - DAY), "a");
  const b = await put(u, "idea", T0, "b");
  const ideas = await liveIdeas(getTestDb(), u, T0, 5);
  expect(ideas.map((i) => i.id)).toEqual([b.id, a.id]);
  expect(ideas.some((i) => i.id === old.id)).toBe(false);
});
```

Add `fact` (from `@/db/schema`) and `eq` (from `drizzle-orm`) to that file's imports if missing. Change the other two calls (`liveIdeas(getTestDb(), other, new Date(0), 5)` and `liveIdeas(getTestDb(), u, new Date(0), 5)`) to pass `T0` instead of `new Date(0)`.

In `tests/mind/memory/user/decay.test.ts`, add:

```ts
test("the sweep retires open facts past stale_after; a used idea keeps its status", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const now = new Date("2026-01-10T00:00:00Z");
  const idea = (content: string, status: "open" | "resolved", staleAfter: Date | null) =>
    facts.insertFact(getTestDb(), u, {
      subject: "shared",
      kind: "idea",
      content,
      embedding: vec(),
      created_at: new Date("2026-01-08T00:00:00Z"),
      stale_after: staleAfter,
      status,
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: "generated",
    });
  const past = await idea("clear skies tonight", "open", new Date("2026-01-09T00:00:00Z"));
  const ahead = await idea("good luck thursday", "open", new Date("2026-01-11T00:00:00Z"));
  const used = await idea("asked already", "resolved", new Date("2026-01-09T00:00:00Z"));
  const forever = await idea("no expiry", "open", null);
  const out = await decayPass(deps, now);
  expect(out.expired).toBe(1);
  const status = async (id: string) => (await facts.getFact(getTestDb(), u, id))!.status;
  expect(await status(past.id)).toBe("stale");
  expect(await status(ahead.id)).toBe("open");
  expect(await status(used.id)).toBe("resolved");
  expect(await status(forever.id)).toBe("open");
});
```

If `getFact` isn't exported under that name from `@/db/repos/user/facts`, use the existing single-fact reader there; `send.ts` imports one as `getFact`.

In `tests/mind/process/outreach/send.test.ts`, find `setup`'s `insertFact` for the idea (it takes `ideaAt`). Add `stale_after: new Date(ideaAt.getTime() + config.user_mind.ideate.ttl_days * 86_400_000)`, using that file's `config` or `makeTestDeps().config`. The test `"an idea past its chance → dropped, left as it was"` then holds as written.

In `tests/mind/process/outreach/inputs.test.ts`, in `"core thoughts and live user ideas feed the candidates; a stale idea is absent"`, give the stale idea `stale_after: ago(24)`: `fact({ kind: "idea", content: "stale", created_at: ago(24 * 30), stale_after: ago(24) })`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/process/user/ideate.test.ts tests/db/user-mind-repos.test.ts tests/mind/memory/user/decay.test.ts`
Expected: FAIL: `stale_after` is not a column, and `ideaStaleAfter` is not exported.

- [ ] **Step 3: Schema and migration**

In `src/db/schema.ts`, in the `fact` table after `occurred_at: ts("occurred_at"),` add:

```ts
    // Past this, the item is no longer worth raising; the day sweep retires it. Null: no expiry.
    stale_after: ts("stale_after"),
```

Run: `pnpm db:generate`
Expected: a new `src/db/migrations/0041_<name>.sql` with `ALTER TABLE "fact" ADD COLUMN "stale_after" timestamp with time zone;`

Append to that new file (it isn't applied anywhere yet, so editing it is allowed):

```sql
--> statement-breakpoint
-- Open ideas written before expiry existed get the few days' chance they had: 3 days.
UPDATE "fact" SET "stale_after" = "created_at" + interval '3 days' WHERE "kind" = 'idea' AND "status" = 'open';
```

- [ ] **Step 4: Repos**

In `src/db/repos/user/user-mind.ts`, replace `liveIdeas` (and its doc comment, if any) with:

```ts
/** Open ideas still worth raising at `now`, newest first. */
export async function liveIdeas(
  db: Db,
  userId: string,
  now: Date,
  limit: number,
): Promise<FactRow[]> {
  return db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, "idea"),
        eq(fact.status, "open"),
        or(isNull(fact.stale_after), gt(fact.stale_after, now)),
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(limit);
}
```

Add `or` and `isNull` to the `drizzle-orm` import.

In `src/db/repos/admin/decay.ts`, after the `staled` statement, add the following and include `expired: expired.rowCount ?? 0` in the returned object. The return type becomes `Promise<{ decayed: number; staled: number; expired: number; dormant: number }>`.

```ts
  // Time-bound items retire when their time has passed. Only open ones: a used idea stays
  // resolved, so ideate still sees it among what she already brought up.
  const expired = await db.execute(sql`
    UPDATE fact SET status = 'stale'
    WHERE scope = 'private' AND status = 'open' AND stale_after IS NOT NULL
      AND stale_after <= ${now}::timestamptz`);
```

Update the file header comment's first sentence to: "The daily decay pass over every user's memories: weights fade, memories go `stale`, and time-bound ones retire once their time has passed."

- [ ] **Step 5: Ideate sets `stale_after`; readers switch; `ideaCutoff` is deleted**

In `src/mind/process/user/ideate.ts`:
1. Delete `ideaCutoff`.
2. Change the timezone import to `import { formatLocal, localDateString, localMidnight, nextLocalDate, zoneOrUtc } from "@/mind/platform/timezone";`.
3. Add:

```ts
/**
 * When an idea stops being worth raising: the end of the day, in their zone, of the latest event
 * it's about that hasn't passed when it's written, and never later than its few days' chance. An
 * idea from events already past (how did it go) keeps the few days; asking after an event is the
 * job of threads and their events.
 */
export function ideaStaleAfter(
  createdAt: Date,
  sourceDates: Date[],
  ttlDays: number,
  tz: string,
): Date {
  const chance = new Date(createdAt.getTime() + ttlDays * DAY);
  const today = localDateString(createdAt, tz);
  const last = sourceDates
    .map((d) => localDateString(d, tz))
    .filter((d) => d >= today)
    .sort()
    .at(-1);
  if (!last) return chance;
  const end = localMidnight(nextLocalDate(last), tz);
  return end < chance ? end : chance;
}
```

In `userIdeate`:
- `planned` uses `liveIdeas(db, userId, now, settings.max_planned)`.
- In the insert, compute `from` before `insertFact` and set `stale_after`:

```ts
      const from = await nearestDated(
        db,
        userId,
        facts.filter((f) => f.occurred_at !== null).map((f) => f.id),
        embedding!,
        settings.source_similarity,
        settings.dated_facts,
      );
      const row = await insertFact(db, userId, {
        subject: "shared",
        kind: "idea",
        content: out.idea,
        embedding: embedding!,
        created_at: now,
        stale_after: ideaStaleAfter(
          now,
          facts.filter((f) => from.includes(f.id)).map((f) => f.occurred_at!),
          settings.ttl_days,
          zoneOrUtc(inputs.timezone),
        ),
        status: "open",
        salience: settings.salience,
        valence: 0,
        confidence: settings.confidence,
        source: "generated",
        source_ref: `user_ideate:${ctx.traceId}`,
        // The dated facts it's about, so a reach-out carrying it knows their dates; a date it
        // isn't about would ride along into the message.
        payload: { from },
      });
```

Update the file header's "expires unused after a few days" to "expires unused once the event it's about has passed, or after a few days".

In `src/mind/process/hot-path/compose.ts`, in the `ideas` lookup, replace `ideaCutoff(clock.now(), config.user_mind.ideate.ttl_days)` with `clock.now()` and delete the `ideaCutoff` import.

In `src/mind/process/outreach/inputs.ts`, replace the `liveIdeas(...)` call with `liveIdeas(db, userId, now, settings.user_idea_limit)` and delete the `ideaCutoff` import.

In `src/mind/process/outreach/send.ts`, replace the `user_idea` branch with the following, and delete the `ideaCutoff` import:

```ts
  if (winner.kind === "user_idea") {
    const idea = winner.factId ? await getFact(db, userId, winner.factId) : null;
    return (
      idea?.kind === "idea" &&
      idea.status === "open" &&
      (idea.stale_after === null || idea.stale_after > at)
    );
  }
```

Check that nothing else references the deleted function:

Run: `pnpm exec tsc --noEmit -p . 2>&1 | grep -n ideaCutoff` (or `pnpm typecheck`)
Expected: no output from the grep.

- [ ] **Step 6: Run the tests and see them pass**

Run: `pnpm test tests/mind/process/user/ideate.test.ts tests/db/user-mind-repos.test.ts tests/mind/memory/user/decay.test.ts tests/mind/process/outreach/send.test.ts tests/mind/process/outreach/inputs.test.ts`
Expected: PASS. If a decay test asserts the exact returned object, add `expired: 0` to its expectation.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/migrations src/db/repos/user/user-mind.ts src/db/repos/admin/decay.ts src/mind/process/user/ideate.ts src/mind/process/hot-path/compose.ts src/mind/process/outreach/inputs.ts src/mind/process/outreach/send.ts tests
git commit -m "feat(time): ideas expire once their event has passed; the day sweep retires them"
```

---

### Task 3: An anticipation past its event isn't news

**Files:**
- Modify: `src/mind/process/outreach/inputs.ts` (the `coreThoughts` block, about lines 72–77)
- Test: `tests/mind/process/outreach/inputs.test.ts`

**Interfaces:**
- Consumes: `deps.core.memory.get(id): Promise<CoreMemoryItem | null>`. An anticipation thought has `payload.anticipates` (the intention id), and the intention has `payload.event_at` (ISO string).
- Produces: `loadCandidateInputs(...).coreThoughts` leaves out an anticipation whose plan time is at or before `now`.

- [ ] **Step 1: Write the failing test**

Append to `tests/mind/process/outreach/inputs.test.ts`:

```ts
test("an anticipation is news only until its plan's time; a broken link keeps it", async () => {
  const { deps, u } = await setup();
  const memory = (kind: "intention" | "thought", content: string, payload: unknown) =>
    deps.core.memory.insert({
      kind,
      content,
      payload,
      embedding: vec(),
      occurred_at: ago(5),
      created_at: ago(5),
      status: "open",
      salience: 0.4,
      valence: 0,
      confidence: 1,
      source: "loop",
      source_ref: null,
    });
  const past = await memory("intention", "Gallery opening.", { event_at: ago(1).toISOString() });
  const ahead = await memory("intention", "Open mic.", {
    event_at: new Date(now.getTime() + 3 * H).toISOString(),
  });
  const before = await memory("thought", "Nervous about the gallery.", { anticipates: past });
  const upcoming = await memory("thought", "Open mic soon.", { anticipates: ahead });
  const orphan = await memory("thought", "Linked to nothing.", { anticipates: randomUUID() });
  const ids = (await loadCandidateInputs(deps, u, now)).coreThoughts.map((t) => t.id);
  expect(ids).not.toContain(before);
  expect(ids).toEqual(expect.arrayContaining([upcoming, orphan]));
});
```

If `core.memory.insert` rejects `source: "loop"` with `source_ref: null` in this file's fakes, copy the field set from the existing core-thought test in the same file.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm test tests/mind/process/outreach/inputs.test.ts`
Expected: FAIL, because `before` is still in `coreThoughts`.

- [ ] **Step 3: Implement**

In `src/mind/process/outreach/inputs.ts`, replace the `coreThoughts` assignment with:

```ts
  const thoughtsFrom = new Date(now.getTime() - settings.core_thought_lookback_hours * HOUR);
  const recent = (
    await deps.core.memory.recentThoughts(thoughtsFrom, now, settings.core_thought_limit)
  ).filter(recallable);
  const fresh = await Promise.all(recent.map((m) => planPassed(deps, m, now)));
  const coreThoughts = recent
    .filter((_, i) => !fresh[i])
    .map((m) => ({ id: m.id, content: m.content, salience: m.salience, depth: m.depth }));
```

and add, next to `ideaSources`:

```ts
/**
 * An anticipation is about its plan: once the plan's time has passed it's no longer news, whatever
 * the thought window says. A thought without a readable plan stays.
 */
async function planPassed(deps: Pick<Deps, "core">, m: CoreMemoryItem, now: Date) {
  const id = (m.payload as { anticipates?: unknown } | null)?.anticipates;
  if (typeof id !== "string") return false;
  const plan = await deps.core.memory.get(id);
  const at = (plan?.payload as { event_at?: unknown } | null)?.event_at;
  return typeof at === "string" && new Date(at).getTime() <= now.getTime();
}
```

Rename the boolean list to `passed` if `fresh` reads backwards to you. The logic must keep thoughts whose `planPassed` is false.

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm test tests/mind/process/outreach/inputs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/outreach/inputs.ts tests/mind/process/outreach/inputs.test.ts
git commit -m "feat(time): an anticipation past its plan's time is no longer a reach-out topic"
```

---

### Task 4: The user mind reads rendered dates and written stamps

**Files:**
- Modify: `src/db/repos/user/facts.ts` (`listUnreadFacts` selects `created_at`)
- Modify: `src/db/repos/user/threads.ts` (`listOpenThreads` returns `next_checkpoint`)
- Modify: `src/mind/process/user/inputs.ts` (`memoryLines`, new `stampedNote`, `threadLines`)
- Modify: `src/mind/process/user/{summarise,reflect,model,ideate}.ts`, `src/mind/process/user/run.ts`
- Modify: `src/mind/process/cold-path/cold-path.ts` (extract's slip logging)
- Create: `prompts/user-mind/summarise/v4.md`, `prompts/user-mind/reflect/v4.md`, `prompts/user-mind/model/v4.md`, `prompts/user-mind/ideate/v6.md`; delete v3, v3, v3 and v5
- Modify: `config/default.json` (`prompts.user_summarise` v4, `user_reflect` v4, `user_model` v4, `user_ideate` v6)
- Test: `tests/mind/process/user/summarise.test.ts`, `tests/mind/process/user/ideate.test.ts`, `tests/mind/process/user/run.test.ts`

**Interfaces:**
- Consumes: `itemWhen`, `writtenOn`, `stamped`, `dayInWords`, `noteRelativeWords` (Task 1); `zoneOrUtc`; `lifeTimezone` from `@/mind/world/her-clock`.
- Produces:
  - `memoryLines(facts, tz: string | null, now: Date)`: `when` is `itemWhen(occurred_at, created_at, now, zone)` or null.
  - `stampedNote(row: { payload: unknown; created_at: Date } | null, now: Date, tz: string | null): Record<string, unknown> | null`: `{ written, ...payload }`.
  - `threadLines(threads: { title: string; next_checkpoint: Date | null }[], now: Date, tz: string | null): string[]`.
  - `listOpenThreads(...)`: `{ id: string; title: string; next_checkpoint: Date | null }[]`.
  - The loop inputs' `who_you_are` (`deps.snapshot`) is stamped with the night it was written, in her zone.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mind/process/user/summarise.test.ts`. Read its existing setup first and reuse its `setup()` and run helpers; the names below follow `ideate.test.ts`. Adapt `setup` and `run` to that file's helpers.

```ts
test("summarise reads dated memories, a stamped previous note and dated threads; no zone means UTC", async () => {
  const { deps, userId, run } = await setup();
  const now = deps.clock.now();
  const D = 86_400_000;
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "event",
    content: "Their sister visits on Saturday.",
    embedding: vec(),
    created_at: now,
    occurred_at: new Date(now.getTime() + 2 * D),
    status: "open",
    salience: 0.8,
    valence: 0.3,
    confidence: 0.9,
    source: "turn",
  });
  await insertFact(deps.db, userId, {
    subject: "shared",
    kind: "summary",
    content: "old",
    payload: { where_things_stand: "a", whats_live: "sister visits tomorrow", how_i_feel: "c" },
    embedding: vec(),
    created_at: new Date(now.getTime() - 2 * D),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  await insertThread(
    deps.db,
    userId,
    {
      title: "sister's visit",
      subject: "user",
      stakes: "med",
      next_checkpoint: new Date(now.getTime() + 2 * D),
    },
    now,
  );
  await userSummarise(deps, run, await loadRunInputs(deps, userId));
  const input = JSON.parse(
    deps.llm.structuredCalls.filter((c) => c.purpose === "user_summarise").at(-1)!.input,
  );
  const sat = dayInWords(new Date(now.getTime() + 2 * D), now, "UTC");
  expect(input.new_memories.find((m: { content: string }) => m.content.includes("sister")).when).toBe(sat);
  expect(input.previous.written).toBe(writtenOn(new Date(now.getTime() - 2 * D), now, "UTC"));
  expect(input.previous.whats_live).toBe("sister visits tomorrow");
  expect(input.open_threads).toContain(`sister's visit (next: ${sat})`);
});

test("a summary that slips a relative word is stored and the slip logged", async () => {
  const { deps, userId, run } = await setup();
  const logs: { msg: string; meta?: Record<string, unknown> }[] = [];
  const log = { info: (msg: string, meta?: Record<string, unknown>) => logs.push({ msg, meta }), error: () => {} };
  deps.llm.handlers.user_summarise = () => ({
    where_things_stand: "Fine.",
    whats_live: "Their sister visits tomorrow.",
    how_i_feel: "Glad.",
  });
  expect(await userSummarise({ ...deps, log }, run, await loadRunInputs(deps, userId))).toBe(
    "done",
  );
  expect(logs).toContainEqual({
    msg: "relative words in stored text",
    meta: { writer: "user_summarise", words: ["tomorrow"] },
  });
});
```

Imports to add: `insertThread` from `@/db/repos/user/threads`; `dayInWords` and `writtenOn` from `@/mind/platform/relative-date`; `insertFact`, `vec` and `loadRunInputs` if the file lacks them. The user in `createTestUser` has no timezone set; if it does, set `"UTC"` explicitly through the users repo. The UTC rendering *is* the Review Focus 1 check.

Append to `tests/mind/process/user/run.test.ts` (read its setup first; reuse how it seeds a snapshot and runs `runUserMind` or the equivalent entry). The assertion:

```ts
  // who_you_are is her snapshot headed by the night it was written, in her zone.
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_summarise")!;
  expect(JSON.parse(call.input).who_you_are).toMatch(/^\(written \w+ \d+ \w+, (today|yesterday)\)\n/);
```

If `run.test.ts` has no test that inserts a snapshot, insert one through `deps.core.memory.insertSnapshot({ version: 0, content: "### Lately\n- tides", sections: {}, embedding: vec(), source_ids: [], rendered_at: deps.clock.now(), model: "m", prompt_version: "v" })` before the run.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/process/user/summarise.test.ts tests/mind/process/user/run.test.ts`
Expected: FAIL. `when` is a `formatLocal` string, `previous.written` is undefined, threads are bare titles, and nothing is logged.

- [ ] **Step 3: Repos**

In `src/db/repos/user/facts.ts`, `listUnreadFacts` select: add `created_at: fact.created_at,` after `occurred_at`.

In `src/db/repos/user/threads.ts`, change `listOpenThreads`:
- return type: `Promise<{ id: string; title: string; next_checkpoint: Date | null }[]>`
- SQL: `SELECT t.id, t.title, t.next_checkpoint FROM thread t`
- mapping:

```ts
  return res.rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    next_checkpoint: r.next_checkpoint ? new Date(r.next_checkpoint as string | Date) : null,
  }));
```

Extract also reads `listOpenThreads` (cold path, `openThreads`); check how extract's prompt input serialises them. If it maps `{id, title}` explicitly, nothing changes. If it passes the rows whole, map them to `{ id, title }` there so the extract prompt input is unchanged.

- [ ] **Step 4: Inputs helpers**

In `src/mind/process/user/inputs.ts`, replace the `formatLocal` import with `import { zoneOrUtc } from "@/mind/platform/timezone";` and `import { dayInWords, itemWhen, writtenOn } from "@/mind/platform/relative-date";`. Replace `memoryLines` and add the two helpers:

```ts
/**
 * The memories as a loop's prompt shows them, each with its day and how far that is from now (and
 * when she learned it, if another day), so the model never counts days.
 */
export function memoryLines(facts: RunInputs["facts"], tz: string | null, now: Date) {
  const zone = zoneOrUtc(tz);
  return facts.map(({ subject, kind, content, occurred_at, created_at }) => ({
    subject,
    kind,
    content,
    when: occurred_at ? itemWhen(occurred_at, created_at, now, zone) : null,
  }));
}

/** One of her notes as a loop reads it, headed by when she wrote it: its "today" was that day's. */
export function stampedNote(
  row: { payload: unknown; created_at: Date } | null,
  now: Date,
  tz: string | null,
): Record<string, unknown> | null {
  if (!row?.payload || typeof row.payload !== "object") return null;
  return {
    written: writtenOn(row.created_at, now, zoneOrUtc(tz)),
    ...(row.payload as Record<string, unknown>),
  };
}

/** Open storylines, each with the next day to check in when there is one. */
export function threadLines(
  threads: { title: string; next_checkpoint: Date | null }[],
  now: Date,
  tz: string | null,
): string[] {
  const zone = zoneOrUtc(tz);
  return threads.map((t) =>
    t.next_checkpoint ? `${t.title} (next: ${dayInWords(t.next_checkpoint, now, zone)})` : t.title,
  );
}
```

- [ ] **Step 5: The four loops**

In each loop, `now` already exists. In `reflect.ts`, move `const now = deps.clock.now();` above its first use if needed. Make these changes:

**summarise.ts**
- `previous: stampedNote(previous, now, inputs.timezone),`
- `new_memories: memoryLines(facts, inputs.timezone, now),`
- `open_threads: threadLines(threads, now, inputs.timezone),`
- After `const out = await ctx.deps.llm.classifyJson(...)`: `noteRelativeWords(deps.log, "user_summarise", [out.where_things_stand, out.whats_live, out.how_i_feel]);`

**reflect.ts**
- `summary: stampedNote(summary, now, inputs.timezone),`
- `new_memories: memoryLines(inputs.facts, inputs.timezone, now),`
- After the call: `noteRelativeWords(deps.log, "user_reflect", [out.reflection]);`

**model.ts**
- `summary: stampedNote(summary, now, inputs.timezone),`
- `new_memories: memoryLines(inputs.facts, inputs.timezone, now),`
- `previous_read` keeps the zod parse (it strips stray payload keys) and adds the stamp. Above the call:

```ts
    const previousRead = previous ? modelPayload.safeParse(previous.payload).data : undefined;
```

and in the input:

```ts
        previous_read: previousRead
          ? {
              written: writtenOn(previous!.created_at, now, zoneOrUtc(inputs.timezone)),
              ...previousRead,
            }
          : null,
```

- After the call: `noteRelativeWords(deps.log, "user_model", [out.how_they_are, out.what_they_want, out.what_lands, ...out.beliefs.map((b) => b.text)]);`

**ideate.ts**
- `summary: stampedNote(summary, now, inputs.timezone),`
- `your_read_on_them: read ? { written: writtenOn(readRow!.created_at, now, zoneOrUtc(inputs.timezone)), ...read } : null,` (`read` stays the zod-parsed payload)
- `new_memories: memoryLines(facts, inputs.timezone, now),`
- `open_threads: threadLines(threads, now, inputs.timezone),`
- After the call: `noteRelativeWords(deps.log, "user_ideate", [out.idea]);`

Import `noteRelativeWords` (and `writtenOn` in model and ideate) from `@/mind/platform/relative-date`, `zoneOrUtc` from `@/mind/platform/timezone`, and `stampedNote` and `threadLines` from `./inputs`. Keep `formatLocal` for `now:` (an absolute stamp with the weekday is right for NOW).

Check `UserLoopDeps` includes `log`: `src/mind/process/user/runner.ts`. If it doesn't, add `"log"` to its `Pick`, since `run.ts` already passes `log` in `loopDeps`.

Existing assertions that compare `already_planned`, `your_read_on_them.how_they_are` and similar still hold: `stampedNote` spreads the payload. An assertion on `previous` or `summary` deep-equal to the raw payload gets `written: expect.any(String)` added.

**run.ts**: replace the snapshot line with:

```ts
    // Her self is dated on her calendar: "lately" lines from two nights ago read as that old.
    const now = clock.now();
    const latest = await deps.core.memory.latestSnapshot();
    const snapshot = latest
      ? stamped(latest.content, latest.rendered_at, now, lifeTimezone(config.life, now))
      : null;
```

with imports `stamped` from `@/mind/platform/relative-date` and `lifeTimezone` from `@/mind/world/her-clock`. If `now` is already declared in that scope, reuse it.

**cold-path.ts**: right after `const extraction = await extract(deps, { ... });` (about line 188):

```ts
  noteRelativeWords(deps.log, "extract", extraction.facts.map((f) => f.content));
```

If that function's `deps` type is a `Pick` without `"log"`, add `"log"`. Its callers pass full `Deps`.

- [ ] **Step 6: Prompts**

Create each new version by copying the old file, then editing. Use the Write/Edit tools, not shell redirection.

`prompts/user-mind/summarise/v4.md` = v3 with:
- In the input sentence: `previous` (your last notes on them, with `written`: the day you wrote them, or null); `open_threads` (ongoing things in their life or between you, with the next day to check in when there is one).
- The bullet starting "- Past or ahead comes from `now`…" replaced by these two bullets:

```
- Dates are worked out for you: each memory's `when` gives its day and how far it is from now ("Saturday 17 January, in 2 days"), and `written` says when you wrote `previous`. Trust them; never count days yourself. What `previous` called today, tonight or tomorrow meant the day it was written.
- These notes are read on later days, so write dates, never today, tonight, tomorrow, yesterday or this week: "their sister visits on Saturday 17 January", not "their sister visits tomorrow". When the day doesn't matter, leave time out.
```

`prompts/user-mind/reflect/v4.md` = v3 with:
- `summary` (your notes on where things stand, with `written`: the day you wrote them, or null)
- In the "Only what the input states" bullet, "past or ahead comes from `now` and its `when`" becomes "its `when` says whether it's past or ahead and how far; never count days yourself"
- A new bullet after it: `- What you write is read on later days: never today, tonight, tomorrow, yesterday or this week. Give the date, or leave time out.`

`prompts/user-mind/model/v4.md` = v3 with the same two edits as reflect v4, and the input description noting that `summary` and `previous_read` carry `written`.

`prompts/user-mind/ideate/v6.md` = v5 with:
- `summary` and `your_read_on_them` described as carrying `written`; `open_threads` with the next day to check in.
- In "Only what the input states…", "past or ahead comes from `now` and its `when`" becomes "its `when` says whether it's past or ahead and how far; never count days yourself"
- A new bullet after it: `- An idea goes out on a later day: never write today, tonight, tomorrow, yesterday or this week. Name the day ("ask how the interview on Thursday 8 January went") or leave time out.`

Then:
- `config/default.json`: `"user_summarise": "v4"`, `"user_reflect": "v4"`, `"user_model": "v4"`, `"user_ideate": "v6"`.
- Delete `prompts/user-mind/summarise/v3.md`, `prompts/user-mind/reflect/v3.md`, `prompts/user-mind/model/v3.md` and `prompts/user-mind/ideate/v5.md` (`git rm`).

- [ ] **Step 7: Run the tests and see them pass**

Run: `pnpm test tests/mind/process/user tests/mind/platform/prompts.test.ts tests/mind/process/cold-path`
Expected: PASS. A test that pinned the old `formatLocal` `when` format updates to `dayInWords` or `itemWhen` output, the new behaviour; don't weaken it to `expect.any`.

- [ ] **Step 8: Commit**

```bash
git add src/db/repos/user/facts.ts src/db/repos/user/threads.ts src/mind/process/user src/mind/process/cold-path/cold-path.ts prompts/user-mind config/default.json tests
git commit -m "feat(time): the user mind reads dates with their distance and notes with their written day"
```

---

### Task 5: Core loops read dates and a stamped self

**Files:**
- Create: `src/mind/memory/core/self.ts`
- Modify: `src/mind/process/core/{anticipate,appraise,resolve,ruminate,wander,reflect,render-snapshot,thoughts}.ts`, `src/mind/world/events.ts`
- Create: `prompts/core/{appraise,anticipate,ruminate,wander,reflect,snapshot}/v3.md`; delete their v2
- Modify: `config/default.json` (`core_appraise`, `core_anticipate`, `core_ruminate`, `core_wander`, `core_reflect` and `core_snapshot` → v3)
- Test: `tests/mind/memory/core/self.test.ts` (new), `tests/mind/process/core/anticipate.test.ts`, `tests/mind/process/core/wander.test.ts`

**Interfaces:**
- Consumes: `stamped`, `dayInWords`, `itemWhen`, `noteRelativeWords`; `localTime` (timezone.ts); `lifeTimezone` (her-clock).
- Produces: `latestSelf(memory: Pick<CoreMemory, "latestSnapshot">, seedSelf: string, now: Date, tz: string): Promise<string>`. `CoreMemory` is the core memory interface in `src/mind/memory/core/types.ts`; use its exported name.

- [ ] **Step 1: Write the failing tests**

Create `tests/mind/memory/core/self.test.ts`:

```ts
/** Her self as the core loops read it: the snapshot headed by its night, or the seed self. */
import { expect, test } from "vitest";
import { latestSelf } from "@/mind/memory/core/self";

const now = new Date("2026-01-15T10:00:00Z");

test("the latest snapshot comes headed by the day it was written", async () => {
  const memory = {
    latestSnapshot: async () => ({
      version: 3,
      embedding: null,
      content: "### Lately\n- tides",
      sections: {},
      source_ids: [],
      rendered_at: new Date("2026-01-14T22:00:00Z"),
      model: "m",
      prompt_version: "v",
    }),
  };
  expect(await latestSelf(memory, "SEED", now, "UTC")).toBe(
    "(written Wednesday 14 January, yesterday)\n### Lately\n- tides",
  );
});

test("before any snapshot it's the seed self, unstamped", async () => {
  expect(await latestSelf({ latestSnapshot: async () => null }, "SEED", now, "UTC")).toBe("SEED");
});
```

In `tests/mind/process/core/anticipate.test.ts`, add an assertion to an existing test that runs `coreAnticipate` to `applied` (read the file and pick the first such test). The prompt input's `When:` line is her local day and time, not ISO:

```ts
  const input = deps.llm.structuredCalls.find((c) => c.purpose === "core_anticipate")!.input;
  expect(input).not.toMatch(/When: \d{4}-\d{2}-\d{2}T/);
  expect(input).toMatch(/When: \w+day \d+ \w+, (today|in \d+ days?) at \d{2}:\d{2}/);
```

In `tests/mind/process/core/wander.test.ts`, add the same kind of assertion to a test that runs `coreWander` to a model call: `expect(input).toMatch(/Seed memory: .+ \(\w+day \d+ \w+, /);`

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/memory/core/self.test.ts tests/mind/process/core/anticipate.test.ts tests/mind/process/core/wander.test.ts`
Expected: FAIL. The module is missing, `When:` is ISO, and the seed has no date.

- [ ] **Step 3: `latestSelf`**

Create `src/mind/memory/core/self.ts`:

```ts
/**
 * Her self as her own loops read it: the latest nightly snapshot, headed by the night it was
 * written so a "lately" line reads as that old; the seed self before the first night.
 */
import { stamped } from "@/mind/platform/relative-date";
import type { CoreMemory } from "./types";

export async function latestSelf(
  memory: Pick<CoreMemory, "latestSnapshot">,
  seedSelf: string,
  now: Date,
  tz: string,
): Promise<string> {
  const snapshot = await memory.latestSnapshot();
  return snapshot ? stamped(snapshot.content, snapshot.rendered_at, now, tz) : seedSelf;
}
```

If the interface isn't named `CoreMemory`, use the type that declares `latestSnapshot()` in `types.ts`, about line 192.

- [ ] **Step 4: Each reader uses it, and inputs carry dates**

Let `tz = lifeTimezone(config.life, now)`, with `lifeTimezone` imported from `@/mind/world/her-clock`. Replace each `(await core.memory.latestSnapshot())?.content ?? persona.seedSelf` with `await latestSelf(core.memory, persona.seedSelf, now, tz)` in:
- `anticipate.ts:67`
- `appraise.ts:133` (it has `now`? If `proposeAppraisal` has no `now`, use `ctx.deps.clock.now()`: core deps carry `clock`.)
- `resolve.ts:31` (same note on `now`)
- `ruminate.ts:75`
- `wander.ts:192`
- `src/mind/world/events.ts:301`

In `reflect.ts`, the system prompt uses `snapshot?.content ?? persona.seedSelf`. Replace it with `snapshot ? stamped(snapshot.content, snapshot.rendered_at, now, tz) : persona.seedSelf`; keep the `Promise.all` read.

In `render-snapshot.ts`, the input's `previous: previous?.content ?? persona.seedSelf` becomes `previous: previous ? stamped(previous.content, previous.rendered_at, now, lifeTimezone(config.life, now)) : persona.seedSelf`. The empty-section fallback below keeps reading the raw `previous?.content`. Only the model's input is stamped.

Dates in the inputs:
- `anticipate.ts`: `` `When: ${event.at.toISOString()}` `` → `` `When: ${dayInWords(event.at, now, tz)} at ${localTime(event.at, tz)}` ``
- `ruminate.ts`: `` `Landed episode: ${episode.content}` `` → `` `Landed episode: ${episode.content} (${dayInWords(episode.occurred_at ?? episode.created_at, now, tz)})` ``
- `wander.ts`:
  - `` `Seed memory: ${seed.content} (${dayInWords(seed.occurred_at ?? seed.created_at, now, tz)})` ``
  - associated: `chain.map((item) => `${item.content} (${dayInWords(item.occurred_at ?? item.created_at, now, tz)})`).join("\n")`
- `reflect.ts` input:
  - `inputs: inputs.map(({ id, kind, content, occurred_at, created_at }) => ({ id, kind, content, when: dayInWords(occurred_at ?? created_at, now, tz) }))`
  - leave `context` (opinions and interests are timeless) unchanged

Slip logging:
- `thoughts.ts` `storeThoughts`: deps type `Pick<CoreDeps, "config" | "log">`; at the top of the function, after `validated`: `noteRelativeWords(deps.log, meta.loop, validated.map((v) => v.item.content));`. Callers pass `ctx.deps`, which has `log`.
- `appraise.ts` `proposeAppraisal`: after `const bounded = boundAppraisal(...)` and before `if (bounded) return bounded;`: `if (bounded) noteRelativeWords(log, "core_appraise", [bounded.episode]);`
- `reflect.ts`: after the model call: `noteRelativeWords(deps.log, "core_reflect", [...result.insights.map((i) => i.content), ...result.opinions.map((o) => o.stance), ...result.interests.flatMap((i) => (i.status === "new" ? [i.content] : [])), result.narrative]);` Use `ctx.deps.log` if `deps` there is the outer `CoreDeps`; either has `log`.
- `render-snapshot.ts`: after `result`: `noteRelativeWords(deps.log, "core_render_snapshot", Object.values(result).flat().map((l) => l.text));`

- [ ] **Step 5: Prompts**

For each of `appraise`, `anticipate`, `ruminate`, `wander` and `reflect`, create `prompts/core/<name>/v3.md` = v2 plus this paragraph inserted before the `Depth:` paragraph:

```
Dates: the input gives days with how far they are from now ("Friday 9 January, in 2 days"); never count days yourself. The note at the top of who she's been lately says when it was written. What you write is read on later days, so never write today, tonight, tomorrow, yesterday or this week: name the day ("on Friday 9 January") or leave time out.
```

`prompts/core/snapshot/v3.md` = v2 plus, before `Depth:`:

```
The previous snapshot starts with the day it was written. These lines are read for days: never write today, tonight, tomorrow, yesterday or this week; name the day or leave time out.
```

Then:
- `config/default.json` `prompts`: `core_appraise`, `core_anticipate`, `core_ruminate`, `core_wander`, `core_reflect` and `core_snapshot` → `"v3"`.
- `git rm` the six v2 files.

Check the fake LLM (`src/mind/platform/llm/fake.ts`) doesn't parse the `previous` input of `core_render_snapshot` in a way the stamp breaks. It has a handler at line 172. If it reads sections from `previous`, it must still find them after the first line; adjust the fake, not the stamp.

- [ ] **Step 6: Run the tests and see them pass**

Run: `pnpm test tests/mind/memory/core tests/mind/process/core tests/mind/world tests/mind/platform/prompts.test.ts`
Expected: PASS. `pnpm lint` on the touched files must also pass. If ESLint blocks `memory/core/self.ts` importing `platform/relative-date`, that's a real boundary: move `latestSelf` into `src/mind/process/core/runner.ts`. `events.ts` (world) can't import process code, so there inline the same two lines with `stamped`.

- [ ] **Step 7: Commit**

```bash
git add src/mind/memory/core/self.ts src/mind/process/core src/mind/world/events.ts prompts/core config/default.json tests
git commit -m "feat(time): her loops read her days with their distance and her self with its night"
```

---

### Task 6: The reply reads stamped notes and dated memories

**Files:**
- Modify: `src/mind/memory/shared/types.ts` (`RetrievedFact.noted?: Date`)
- Modify: `src/mind/memory/user/retrieve.ts:113,149`, `src/mind/memory/core/retrieve.ts:86,104,117` (set `noted: <row>.created_at`)
- Modify: `src/mind/process/hot-path/assemble.ts` (`AssembleInput.summary` and `read` gain `written?: string | null`; `factList` uses `itemWhen`)
- Modify: `src/mind/process/hot-path/compose.ts` (stamped snapshot, summary, read and ideas)
- Test: `tests/mind/process/hot-path/assemble.test.ts`, plus `compose.test.ts` if one exists under `tests/mind/process/hot-path/`

**Interfaces:**
- Consumes: `itemWhen`, `writtenOn`, `stamped` (Task 1); `lifeTimezone`.
- Produces: `assemblePrompt` renders the summary as `"(written …)\n- …"` when `written` is set, the read the same way, and each fact as `- <content> (<itemWhen>)`.

- [ ] **Step 1: Write the failing tests**

In `tests/mind/process/hot-path/assemble.test.ts` (read it first; reuse its base `AssembleInput` builder), add:

```ts
test("summary and read are headed by the day she wrote them; facts carry day and distance", () => {
  const now = new Date("2026-01-15T10:00:00Z");
  const D = 86_400_000;
  const req = assemblePrompt({
    ...base(), // the file's existing minimal input
    now,
    timezone: "UTC",
    summary: { where_things_stand: "a", whats_live: "b", how_i_feel: "c", written: "written Tuesday 13 January, 2 days ago" },
    read: { how_they_are: "x", what_they_want: "y", what_lands: "z", written: "written Wednesday 14 January, yesterday" },
    retrieval: {
      ...emptyRetrieval(),
      facts: {
        user: [
          {
            id: "f1",
            content: "Their sister visits on Saturday 17 January.",
            when: new Date(now.getTime() + 2 * D),
            noted: new Date(now.getTime() - 2 * D),
          },
        ],
        self: [],
        shared: [],
      },
    },
  });
  const system = req.system.map((s) => s.text).join("\n");
  expect(system).toContain("## Where things stand with them\n(written Tuesday 13 January, 2 days ago)\n- a");
  expect(system).toContain("## Your read on them\n(written Wednesday 14 January, yesterday)\n- How they are: x");
  expect(system).toContain(
    "- Their sister visits on Saturday 17 January. (Saturday 17 January, in 2 days; noted Tuesday 13 January, 2 days ago)",
  );
});
```

If the file has no `base()` helper, build the minimal input inline from the `AssembleInput` fields the existing tests use.

If a compose test exists that captures the reply prompt (look for `assemblePrompt` or `system[0]` assertions in `tests/mind/process/hot-path/compose*.test.ts`), add this there. For two users at the same instant, the cached first block is identical and starts with the stamped snapshot:

```ts
  expect(systemA[0]!.text).toBe(systemB[0]!.text);
  expect(systemA[0]!.text).toMatch(/## Who you are lately\n\(written /);
```

If no compose test captures two users, put the same-prefix assertion in Task 7's exit test (test 6 there already composes for two users).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/process/hot-path/assemble.test.ts`
Expected: FAIL. `written` isn't a field, and facts render as `(in 2 days)`.

- [ ] **Step 3: Implement**

`src/mind/memory/shared/types.ts`, in `RetrievedFact` after `when`:

```ts
  /** When she learned it, shown when that was another day than `when`. */
  noted?: Date;
```

In the five retrieve sites, add `noted: <row>.created_at,` next to each `when:`.

`assemble.ts`:
- `summary?: { where_things_stand: string; whats_live: string; how_i_feel: string; written?: string | null } | null;` and the same `written?` on `read`.
- The summary section body:

```ts
      input.summary
        ? [
            ...(input.summary.written ? [`(${input.summary.written})`] : []),
            ...[input.summary.where_things_stand, input.summary.whats_live, input.summary.how_i_feel].map(
              (line) => `- ${line}`,
            ),
          ].join("\n")
        : null,
```

- The read section the same way: the `(written …)` line first, then the three `- …` lines.
- `factList`: `` return `- ${fact.content} (${itemWhen(fact.when, fact.noted ?? null, now, tz)})${onMind}${tail}`; `` with `itemWhen` imported from `@/mind/platform/relative-date`. If `relativeDate` is then used only by `relationshipLine`, keep the import.

`compose.ts`:
- After `const latestSnapshot = await snapshot;` add `const herZone = lifeTimezone(config.life, clock.now());`.
- The `snapshot:` field of `assemblePrompt`:

```ts
    // Stamped on her calendar, so it's the same for every user and stays the cached prefix.
    snapshot: latestSnapshot
      ? stamped(
          snapshotWithin(latestSnapshot.content, selfLines, allowed.open),
          latestSnapshot.rendered_at,
          clock.now(),
          herZone,
        )
      : null,
```

- The summary and read loaders return `{ ...parsed.data, written: writtenOn(row!.created_at, clock.now(), lifeTimezone(config.life, clock.now())) }` when parsed succeeds. `row` is non-null there because parse of `undefined` fails. Keep the return type `AssembleInput["summary"]` / `["read"]`.
- `ideas: shownIdeas.map((i) => `${i.content} (${writtenOn(i.created_at, clock.now(), herZone)})`),`. `liveIdeas` returns `FactRow`, which has `created_at`. If the `ideas` promise's declared type is `{ id: string; content: string }[]`, widen it to `{ id: string; content: string; created_at: Date }[]`.

Imports: `stamped` and `writtenOn` from `@/mind/platform/relative-date`; `lifeTimezone` is already imported.

The reply `timezone` for facts stays hers (`input.timezone`), as before. The written stamps use her zone too, so one reply prompt counts days on one calendar.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/process/hot-path tests/mind/memory`
Expected: PASS. Tests pinning the old `(yesterday)`-only fact format update to the `itemWhen` output.

- [ ] **Step 5: Commit**

```bash
git add src/mind/memory src/mind/process/hot-path tests
git commit -m "feat(time): the reply reads her notes with their written day and memories with day and distance"
```

---

### Task 7: Guard v6: NOW in both zones, misdating, text support (B127)

**Files:**
- Modify: `src/mind/process/guard/guard.ts` (export `guardNow`)
- Modify: `src/mind/process/hot-path/compose.ts` (the guard's `now:` argument, about line 536)
- Create: `prompts/guard/v6.md`; delete `prompts/guard/v5.md`
- Modify: `config/default.json` (`prompts.guard` → `"v6"`)
- Modify: `evals/guard/reach-out-dates.yaml` (new case)
- Test: `tests/mind/process/guard/guard.test.ts` (or the existing guard test file in that folder)

**Interfaces:**
- Produces: `guardNow(at: Date, theirs: string, hers: string): string` → `"Monday 12 January 2026 at 13:35 where they are"`, plus `"; Monday 12 January 2026 at 21:35 where Spica is"` when her local time reads differently.

- [ ] **Step 1: Write the failing test**

Append to the guard test file:

```ts
import { guardNow } from "@/mind/process/guard/guard";

test("NOW is their local time, and hers too when her calendar reads differently", () => {
  const at = new Date("2026-01-12T13:35:00Z");
  expect(guardNow(at, "Europe/London", "Europe/London")).toBe(
    "Monday 12 January 2026 at 13:35 where they are",
  );
  expect(guardNow(at, "Europe/London", "Asia/Singapore")).toBe(
    "Monday 12 January 2026 at 13:35 where they are; Monday 12 January 2026 at 21:35 where Spica is",
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm test tests/mind/process/guard`
Expected: FAIL, because `guardNow` is not exported.

- [ ] **Step 3: Implement**

In `guard.ts`:

```ts
/**
 * NOW as the guard reads it: their local time, since the message's day words land on their
 * calendar, plus hers when it reads differently, since her own news is dated on hers.
 */
export function guardNow(at: Date, theirs: string, hers: string): string {
  const local = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(
      at,
    );
  const them = `${local(theirs)} where they are`;
  return local(hers) === local(theirs) ? them : `${them}; ${local(hers)} where Spica is`;
}
```

Check the en-GB `full`/`short` output in Node matches "Monday 12 January 2026 at 13:35". If Node's ICU prints it without "at", fix the test's expected string to Node's real output. That's a format fact, not a behaviour change.

In `compose.ts`, the guard input's `now:` becomes:

```ts
      now: guardNow(clock.now(), await userZone(deps, userId), lifeTimezone(config.life, clock.now())),
```

and the `Intl.DateTimeFormat` block there is deleted.

`prompts/guard/v6.md` = v5 with three edits:
1. The NOW bullet becomes: `- NOW: the current date and time where the user is, and where Spica is when that reads differently. Anything dated before NOW has already happened; asking how it went is not presuming.`
2. After the `invented_detail` bullet, add: `- Getting a day wrong is invented_detail too. The dates in WHY SPICA IS WRITING FIRST and WHAT SPICA REMEMBERS say how far each thing is from NOW ("Sunday 11 January, yesterday"); a message that puts it on another day ("isn't the race this morning" for yesterday's race, "clear skies tonight" for last night) or asks about a past thing as still ahead states a date nobody gave.`
3. The `in_person` bullet's last sentence becomes: `Being there by text before or after something ("text me when you're heading in") is fine, and so is saying she can't meet while offering to be there by text ("can't do coffee obviously, but I'm around by text"): only offering, agreeing to or treating as real a meetup is in_person.`

Then `config/default.json` `"guard": "v6"`, and `git rm prompts/guard/v5.md`.

Append to `evals/guard/reach-out-dates.yaml`:

```yaml
  - name: stale-tonight
    kind: reach_out
    now: "Wednesday 7 January 2026 at 11:00 where they are"
    reason: |-
      Orion: clear skies for Orion.
      - Spica said the sky would be clear for Orion. (Tuesday 6 January, yesterday)
    message: "clear skies tonight for orion, you going out to look?"
    expect: [invented_detail, false_familiarity]
```

The in-person twin (`ip-offer-by-text`) already exists and is the B127 check.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/process/guard tests/mind/process/hot-path tests/evals tests/mind/platform/prompts.test.ts`
Expected: PASS. Then run `pnpm eval --llm=fake --compare` (free).
Expected: no regressions against `evals/baseline.json`. A diff that only reflects the new prompt version is expected; update the baseline only if the harness asks for it.

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/guard/guard.ts src/mind/process/hot-path/compose.ts prompts/guard config/default.json evals/guard tests
git commit -m "feat(guard): v6 reads NOW in both zones, flags a misdated day, and lets text support pass"
```

---

### Task 8: The review lists relative words in stored text

**Files:**
- Modify: `evals/lib/review.ts`
- Test: `tests/evals/review.test.ts`

**Interfaces:**
- Consumes: `relativeWords` (Task 1).
- Produces: under each user, after "Final facts", a "Relative words in stored text:" list (when any); and a "### Relative words in her loops" section listing core calls whose output has any.

- [ ] **Step 1: Write the failing test**

In `tests/evals/review.test.ts` (read how it builds a `ReviewRun` with `trace.memory`), add:

```ts
test("the review lists stored text with relative words", () => {
  const md = renderReview(
    [
      {
        script: "s",
        attempt: 1,
        result: {
          ...emptyResult(), // the file's existing minimal ScriptResult builder
          trace: {
            ...emptyTrace(),
            memory: {
              sam: {
                facts: [
                  { status: "open", subject: "shared", kind: "summary", content: "Sister visits tomorrow." },
                  { status: "open", subject: "user", kind: "event", content: "Interview on Thursday 8 January." },
                ],
              },
            },
            coreCalls: [
              { purpose: "core_wander", input: "i", output: { items: [{ content: "clear tonight" }] } },
            ],
          },
        },
      },
    ],
    { stamp: "t", real: [], annotate: false },
  );
  expect(md).toContain("Relative words in stored text:\n\n- summary (tomorrow): Sister visits tomorrow.");
  expect(md).not.toContain("(none): Interview");
  expect(md).toContain("### Relative words in her loops\n\n- core_wander: tonight");
});
```

Use the file's existing builders for `ScriptResult` and the trace; if it has none, copy the smallest object an existing test passes and set only `trace.memory` and `trace.coreCalls`.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm test tests/evals/review.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `evals/lib/review.ts`, import `relativeWords` from `@/mind/platform/relative-date`. After the "Final facts" block, add:

```ts
      const slips = facts
        .map((f) => ({ f, words: relativeWords(String(f.content ?? "")) }))
        .filter((s) => s.words.length);
      if (slips.length)
        out.push(
          "Relative words in stored text:",
          "",
          ...slips.map((s) => `- ${fmt(s.f.kind)} (${s.words.join(", ")}): ${fmt(s.f.content)}`),
          "",
        );
```

After the "### Core loop calls" block (before "### Checks"), add:

```ts
    const loopSlips = calls
      .map((c) => ({ purpose: c.purpose, words: relativeWords(JSON.stringify(c.output)) }))
      .filter((s) => s.words.length);
    if (loopSlips.length)
      out.push(
        "### Relative words in her loops",
        "",
        ...loopSlips.map((s) => `- ${s.purpose}: ${s.words.join(", ")}`),
        "",
      );
```

`calls` is the `trace?.coreCalls ?? []` already declared there. User facts quoting the user ("said today was rough") also show; that's fine, since the review is read by hand.

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm test tests/evals/review.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add evals/lib/review.ts tests/evals/review.test.ts
git commit -m "feat(evals): the review lists relative words that slipped into stored text"
```

---

### Task 9: Phase 16 exit test

**Files:**
- Create: `tests/exit/phase-16.test.ts`

**Interfaces:**
- Consumes everything above: `ideaStaleAfter`, `liveIdeas(db, u, now, n)`, `decayPass`, `loadCandidateInputs`, `userIdeate`, `loadRunInputs`, `relativeDate`, `dayInWords`, `noteRelativeWords`.

- [ ] **Step 1: Write the exit test**

Model the imports, `coreDump` and canary on `tests/exit/phase-15d.test.ts`.

```ts
/**
 * Phase 16 exit, all fake: dates count by the calendar in the reader's zone, across midnight and a
 * DST change; an idea about an event retires once it has passed and never reaches a reach-out; an
 * undated idea keeps its few days; an anticipation past its plan is no reach-out topic; a slipped
 * relative word is stored and logged. A's idea never reaches B, and an idea run leaves core
 * unchanged.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun, liveIdeas } from "@/db/repos/user/user-mind";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { decayPass } from "@/mind/memory/user/decay";
import { dayInWords, relativeDate } from "@/mind/platform/relative-date";
import { loadCandidateInputs } from "@/mind/process/outreach/inputs";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { ideaStaleAfter, userIdeate } from "@/mind/process/user/ideate";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const H = 3_600_000;
const D = 24 * H;

test("1: day counts follow the reader's calendar across midnight and DST", () => {
  expect(
    relativeDate(new Date("2026-01-11T23:30:00Z"), new Date("2026-01-12T00:10:00Z"), "UTC"),
  ).toBe("yesterday");
  expect(
    relativeDate(new Date("2026-01-10T23:30:00Z"), new Date("2026-01-12T01:00:00Z"), "Asia/Singapore"),
  ).toBe("yesterday");
  expect(
    relativeDate(new Date("2026-03-28T12:00:00Z"), new Date("2026-03-30T00:30:00Z"), "Europe/London"),
  ).toBe("2 days ago");
  expect(dayInWords(new Date("2026-01-14T09:00:00Z"), new Date("2026-01-12T10:00:00Z"), "UTC")).toBe(
    "Wednesday 14 January, in 2 days",
  );
});

async function ideaRun(d: ReturnType<typeof makeTestDeps>, u: string, ref: string) {
  return (await insertRun(d.db, u, {
    sourceRef: ref,
    triggers: [{ kind: "salient_fact", salience: 0.9 }],
    localDate: "2026-01-06",
    now: d.clock.now(),
    cap: 9,
  }))!;
}

test("2: an idea for tonight retires after tonight and never reaches a reach-out", async () => {
  const d = makeTestDeps({ life: { timezone: "UTC" } });
  const tue = new Date("2026-01-06T09:00:00Z");
  d.clock.set(tue);
  const u = await createTestUser();
  await ensureRelationship(d.db, u, tue, d.config.relationship);
  await insertFact(d.db, u, {
    subject: "self",
    kind: "event",
    content: "Spica said the sky would be clear for Orion on Tuesday 6 January.",
    embedding: vec(),
    created_at: tue,
    occurred_at: new Date("2026-01-06T22:00:00Z"),
    status: "open",
    salience: 0.7,
    valence: 0.3,
    confidence: 0.9,
    source: "turn",
  });
  d.llm.handlers.user_ideate = () => ({ idea: "Ask if they saw Orion with the clear sky." });
  expect(await userIdeate(d, await ideaRun(d, u, "exchange:a"), await loadRunInputs(d, u))).toBe(
    "done",
  );
  const [idea] = await liveIdeas(d.db, u, tue, 5);
  expect(idea!.stale_after).toEqual(new Date("2026-01-07T00:00:00Z"));

  const wed = new Date("2026-01-07T09:00:00Z");
  expect((await loadCandidateInputs(d, u, wed)).userIdeas).toEqual([]);
  await decayPass(d, wed);
  expect(await liveIdeas(d.db, u, wed, 5)).toEqual([]);
});

test("3: an undated idea keeps its few days", () => {
  const at = new Date("2026-01-06T09:00:00Z");
  expect(ideaStaleAfter(at, [], 3, "UTC")).toEqual(new Date(at.getTime() + 3 * D));
});

test("4: an anticipation past its plan is no reach-out topic", async () => {
  const d = makeTestDeps({ life: { timezone: "UTC" } });
  const now = new Date("2026-01-10T12:00:00Z");
  const u = await createTestUser();
  const plan = await d.core.memory.insert({
    kind: "intention",
    content: "Gallery opening.",
    payload: { event_at: new Date(now.getTime() - H).toISOString() },
    embedding: vec(),
    occurred_at: new Date(now.getTime() - 5 * H),
    created_at: new Date(now.getTime() - 5 * H),
    status: "open",
    salience: 0.4,
    valence: 0,
    confidence: 1,
    source: "loop",
    source_ref: null,
  });
  const thought = await d.core.memory.insert({
    kind: "thought",
    content: "Nervous about the gallery.",
    payload: { anticipates: plan },
    embedding: vec(),
    occurred_at: new Date(now.getTime() - 4 * H),
    created_at: new Date(now.getTime() - 4 * H),
    status: "open",
    salience: 0.4,
    valence: 0,
    confidence: 1,
    source: "loop",
    source_ref: null,
  });
  const ids = (await loadCandidateInputs(d, u, now)).coreThoughts.map((t) => t.id);
  expect(ids).not.toContain(thought);
});

test("5: a slipped relative word is stored as written and logged", async () => {
  const d = makeTestDeps();
  const logs: { msg: string; meta?: Record<string, unknown> }[] = [];
  const log = {
    info: (msg: string, meta?: Record<string, unknown>) => logs.push({ msg, meta }),
    error: () => {},
  };
  const u = await createTestUser();
  d.llm.handlers.user_ideate = () => ({ idea: "Ask how tonight's gig goes." });
  await userIdeate({ ...d, log }, await ideaRun(d, u, "exchange:b"), await loadRunInputs(d, u));
  expect((await liveIdeas(d.db, u, d.clock.now(), 5))[0]!.content).toBe(
    "Ask how tonight's gig goes.",
  );
  expect(logs).toContainEqual({
    msg: "relative words in stored text",
    meta: { writer: "user_ideate", words: ["tonight"] },
  });
});

const TOKEN = "CANARY-16a3f9";
const CORE_TABLES = ["core_memory", "core_state", "core_goal", "core_snapshot", "world_event"];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(
      sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`),
    );
    parts.push(...res.rows.map((r) => String(r.j)));
  }
  return parts.join("\n");
}

test("6: leak canary: A's idea never reaches B; an idea run and the sweep leave core unchanged", async () => {
  const d = makeTestDeps({ life: { timezone: "UTC" } });
  const at = new Date("2026-01-06T09:00:00Z");
  d.clock.set(at);
  const a = await createTestUser("alice");
  const b = await createTestUser("bob");
  for (const u of [a, b]) await ensureRelationship(d.db, u, at, d.config.relationship);
  await insertFact(d.db, a, {
    subject: "user",
    kind: "event",
    content: `The user's gig code is ${TOKEN}.`,
    embedding: vec(),
    created_at: at,
    occurred_at: new Date(at.getTime() + 10 * H),
    status: "open",
    salience: 0.9,
    valence: 0,
    confidence: 1,
    source: "turn",
  });
  const before = await coreDump();
  d.llm.handlers.user_ideate = () => ({ idea: `Ask about the gig, ${TOKEN}.` });
  await userIdeate(d, await ideaRun(d, a, "exchange:c"), await loadRunInputs(d, a));
  const bStart = d.llm.structuredCalls.length;
  d.llm.handlers.user_ideate = () => ({ idea: null });
  await userIdeate(d, await ideaRun(d, b, "exchange:d"), await loadRunInputs(d, b));
  for (const c of d.llm.structuredCalls.slice(bStart)) expect(JSON.stringify(c)).not.toContain(TOKEN);
  expect(JSON.stringify(await loadCandidateInputs(d, b, at))).not.toContain(TOKEN);
  await decayPass(d, new Date(at.getTime() + 2 * D));
  expect(await coreDump()).toBe(before);
});
```

If Task 6 left the two-user same-prefix assertion to this file, add it as test 7. Compose a reply for `alice` and `bob` at the same instant through the hot path's exported compose entry (see how `phase-15d.test.ts` drives `outreachTickUser` and `runReachOutSend`). Then assert the first system block is identical and starts with the stamped snapshot.

- [ ] **Step 2: Run it**

Run: `pnpm test tests/exit/phase-16.test.ts`
Expected: PASS (the behaviour is built in Tasks 1–8). If a test fails, fix the code, never the assertion. If `ideaRun`'s `insertRun` rejects the trigger shape, copy the trigger from `tests/mind/process/user/ideate.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/exit/phase-16.test.ts
git commit -m "test(exit): Phase 16 time model, with leak canary"
```

---

### Task 10: Close (definition of done, write-back)

**Files:**
- Modify: `spica-design-spec-v3.md`:
  - §6: `fact.stale_after`.
  - §9: ideate sets `stale_after`; inputs carry rendered dates and written stamps; prompt versions.
  - §12.3: the sweep retires open facts past `stale_after`.
  - §13: idea readers use `stale_after`; anticipations past their plan are skipped.
  - §8: core loop inputs dated; `latestSelf`.
  - §10.3: reply stamps; guard v6 NOW.
  - §17: the review's relative-word list.
  - §20: Phase 16 row → Built.
  - §25: B125, B126 and B127 move to history.
- Modify: `docs/spec-v3-history.md` (Phase 16 entry; B125, B126 and B127 resolutions)
- Modify: `DECISIONS.md`
- Modify: `CLAUDE.md` "Current phase"
- Delete: `docs/superpowers/plans/2026-10-21-phase-16-time-model.md` once built (history is in git)

- [ ] **Step 1: DECISIONS.md rows** (one line each):
  - An idea's event is its latest dated source on or after the day it's written; past sources leave it the 3-day chance, and the chance caps a far event.
  - Expiry is at the end of the event's local day in their zone, since dates carry no hour flag.
  - `stale_after` is user-scoped only; her own memories don't expire. Her news keeps its 24 h window, and an anticipation is skipped by outreach once its plan's time passes.
  - The written-on stamps for her snapshot use her zone, which keeps the reply's cached prefix identical across users.
  - The reply's due threads carry no dates (they are due now); the user-mind open threads show their next check-in day.
  - Slips are logged with `log.info`; the review counts them from stored text, not from traces.
  - Extract's turn labels keep their absolute local time (`formatLocal`): code resolves the time words from those turns, so a distance adds nothing there.
  - The Your-day line keeps its clock times: its blocks are all today, on her calendar.
- [ ] **Step 2:** Run the `spica-close` skill. In order:
  - `pnpm typecheck`
  - `pnpm lint`
  - the full `pnpm test` (once; ~10 min)
  - `pnpm test tests/exit/phase-16.test.ts` and the leak canary
  - `scope-reviewer` on the diff (told not to run tests)
  - spec write-back
  - commit
- [ ] **Step 3: Paid runs** (Ethan settled both; each goes through `review-run`, and the hook asks first):
  - `pnpm review:world-outreach` (~$1.20). Compare the misdating counts against `evals/results/review-2026-10-21T09-11-13-924Z.md`, and read the new relative-word lists.
  - `pnpm eval:guard` (~$0.85). Check `misdated-this-morning`, `stale-tonight` and `ip-offer-by-text`.
