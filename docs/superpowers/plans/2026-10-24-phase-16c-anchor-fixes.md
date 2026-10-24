# Phase 16c Time Anchor Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the date bugs the Phase 16b close run found, so anchoring never loses words, never stores a date twice, and never moves a day it was shown.

**Architecture:** Most of it lives in `src/mind/platform/time-anchors.ts`:

- The chrono pass runs per clause.
- Every rule must read the whole phrase.
- ISO dates are found by code.
- Adjacent anchors for the same day merge into one token.

Elsewhere:

- The core loop runner records the dates in each input a loop sends, and hands them to every memory write the loop commits.
- `insertFact` and core `memory.insert` add the row's own `occurred_at` to those dates.
- Extract's weekday cross-check is deleted.
- Extract v11 forbids adding dates.

**Tech Stack:** TypeScript, chrono-node 2.10.1, Vitest, Postgres (tests migrate their own DB), pnpm.

**Spec:** `docs/2026-10-24-phase-16c-anchor-fixes-design.md` (settled with Ethan, 2026-10-24); background in `evals/results/analysis-2026-10-24-phase-16b.md`.

## Global Constraints

- Anchoring touches stored memory and prompts only, never her outgoing messages (memory `her-speech-stays-free`).
- `src/mind` is framework-free: no `Date.now()`, time comes from `Clock`, numbers from config.
- Core loops read only core memory, core state and the world through `CoreDeps`; no user data reaches a core loop.
- Every prompt change is a new versioned file under `prompts/` (`git mv` from the previous one) plus a config bump.
- Comments say why, never cite spec sections, phases or review items.
- Prettier at 100 columns; ESLint runs on every edited TS file (a hook).
- Never write strings with backslashes through a shell heredoc or python; use the Edit or Write tool for those. A python edit must open files with `newline=''`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A clause split inside a real date phrase** ("Monday, 12 January" or "the 8th and 9th of January"): the date must still anchor once, with no word lost. The first is pinned in Task 1.
2. **Two adjacent anchors that both come from written-out dates but differ** ("Thursday 8 January, Friday 9 January"): both must stay, never merge. Pinned in Task 1.
3. **A merged pair in brackets** ("Thursday 8 January (yesterday)"): no stray ")" is left. Pinned in Task 1.
4. **Her own outgoing text:** the runner's shown dates never reach `insertTurn` or her messages. Only core memory writes take them; Task 4 checks a loop's commit only.
5. **A core loop whose input holds no tokens** (the seed self, no dated memory): shown dates are empty, and anchoring behaves exactly as before. Pinned in Task 4.

---

### Task 1: The chrono pass reads whole phrases, finds ISO dates and merges pairs

**Files:**
- Modify: `src/mind/platform/time-anchors.ts`:
  - `chronoPass` is rewritten;
  - add `DATE_PHRASE`, `ISO_DATE`, `CLAUSE`, the `Found` type and `merged`;
  - `classifyDay`'s month-with-digit branch uses `DATE_PHRASE`.
- Test: `tests/mind/platform/time-anchors.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `anchorTimes(text, ctx)` keeps its signature. Later tasks rely on three behaviours:
  - adjacent same-day anchors are one token;
  - ISO dates anchor as day tokens;
  - no non-time word is lost.

- [ ] **Step 1: Write the failing tests** (append to `tests/mind/platform/time-anchors.test.ts`; `utc`, `read`, `days` and `at` already exist there)

```ts
test("a long phrase around a date keeps every word (the 16b run's summary)", () => {
  const mon = { at: at("2026-01-05T10:21:40Z"), zone: "UTC" };
  const text =
    "Sam has a design job interview at a small studio on the afternoon of Thursday 8 January, in 3 days, and they're feeling nervous about it.";
  const stored = anchorTimes(text, mon);
  expect(read(stored, mon.at)).toBe(text);
  expect(days(stored)).toEqual(["2026-01-08"]);
});

test("a relative day beside its written-out date is one token", () => {
  const fri = { at: at("2026-01-09T20:00:00Z"), zone: "UTC" };
  const stored = anchorTimes(
    "They had a design job interview yesterday, Thursday 8 January, and I don't yet know how it went.",
    fri,
  );
  expect(days(stored)).toEqual(["2026-01-08"]);
  expect(read(stored, fri.at)).toBe(
    "They had a design job interview yesterday, Thursday 8 January, and I don't yet know how it went.",
  );
  // When the two disagree, the written-out date wins.
  expect(days(anchorTimes("The race was yesterday, Sunday 4 January.", fri))).toEqual([
    "2026-01-04",
  ]);
  // In brackets, no stray bracket is left.
  expect(anchorTimes("Due Thursday 8 January (yesterday).", fri)).toMatch(/^Due ⟦[^⟧]+⟧\.$/);
  // Two written-out dates stay two.
  expect(days(anchorTimes("Thursday 8 January, Friday 9 January.", fri))).toEqual([
    "2026-01-08",
    "2026-01-09",
  ]);
  // A comma inside a date is still one date.
  expect(days(anchorTimes("Back on Monday, 12 January.", fri))).toEqual(["2026-01-12"]);
});

test("ISO dates anchor, and merge with the day words beside them", () => {
  const fri = { at: at("2026-01-09T20:00:00Z"), zone: "UTC" };
  expect(anchorTimes("The user had a job interview on Friday 2026-01-09.", fri)).toBe(
    "The user had a job interview on ⟦2026-01-09|day|UTC⟧.",
  );
  expect(
    days(anchorTimes("The user had an interview on Thursday afternoon, 2026-01-08.", fri)),
  ).toEqual(["2026-01-08"]);
  expect(days(anchorTimes("The user can't sleep on the night of 2026-01-14.", fri))).toEqual([
    "2026-01-14",
  ]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/mind/platform/time-anchors.test.ts`
Expected: FAIL. The first test's stored text has lost "and they're".

- [ ] **Step 3: Implement** (Edit tool: these regexes contain backslashes)

Near the other regexes, add:

```ts
const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
// A written-out date, read whole: "the afternoon of Thursday 8 January", "Jan 8th 2026".
const DATE_PHRASE = new RegExp(
  `^(?:the )?(?:(morning|afternoon|evening|night) of )?(?:(?:${WEEKDAYS.join("|")}),? )?(?:the )?(?:(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTHS})|(${MONTHS}) (?:the )?(\\d{1,2})(?:st|nd|rd|th)?)(?:,? (\\d{4}))?$`,
  "i",
);
const ISO_DATE = new RegExp(`\\b(?:(?:${WEEKDAYS.join("|")}),? )?(\\d{4})-(\\d{2})-(\\d{2})\\b`, "gi");
// chrono reads across clause breaks ("…8 January, in 3 days, and they"), so it reads one clause at a time.
const CLAUSE = /,\s*|;\s*|\s+(?:and|but)\s+/g;
```

Replace `chronoPass` with:

```ts
type Found = { from: number; end: number; anchor: Omit<Anchor, "zone">; written: boolean };

function chronoPass(plain: string, ctx: AnchorContext): string {
  const ref = { instant: ctx.at, timezone: zoneOffsetMinutes(ctx.at, ctx.zone) };
  const found: Found[] = [];
  for (const m of plain.matchAll(ISO_DATE))
    found.push({
      from: m.index,
      end: m.index + m[0].length,
      anchor: { local: `${m[1]}-${m[2]}-${m[3]}`, precision: "day" },
      written: true,
    });
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
        from: ctx.said ? at + lead.length : at - the,
        end: at + lead.length + words.length,
        anchor,
        written: DATE_PHRASE.test(words),
      });
    }
    if (sep) start = sep.index + sep[0].length;
  }
  let out = plain;
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
```

In `classifyDay`, replace the branch that starts `if ((MONTH.test(w) && /\d/.test(w)) || ORDINAL.test(w)) {` with:

```ts
  if ((m = DATE_PHRASE.exec(w))) {
    const monthOf = (name: string) =>
      [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ].indexOf(name.slice(0, 3).toLowerCase()) + 1;
    const mo = String(monthOf((m[3] ?? m[4])!)).padStart(2, "0");
    const dd = String(Number(m[2] ?? m[5])).padStart(2, "0");
    const part = (m[1]?.toLowerCase() as Precision | undefined) ?? "day";
    if (m[6]) return { local: `${m[6]}-${mo}-${dd}`, precision: part };
    // A date without a year is on the side of now its label points to, else the nearest one.
    const y = Number(day.slice(0, 4));
    const options = [y - 1, y, y + 1]
      .map((year) => `${year}-${mo}-${dd}`)
      .filter((o) =>
        ctx.direction === "past" ? o <= day : ctx.direction === "upcoming" ? o >= day : true,
      );
    const nearest = options.sort((a, b) => Math.abs(dayDiff(a, day)) - Math.abs(dayDiff(b, day)))[0]!;
    return { local: nearest, precision: part };
  }
  if (ORDINAL.test(w)) {
    // "the 13th" is the occurrence nearest the moment it was written.
    const parsed = localDateString(r.start.date(), ctx.zone);
    return { local: parsed, precision: "day" };
  }
```

If `MONTH` is then unused, delete it. The `MONTH_ONLY` branch below stays.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/platform/time-anchors.test.ts tests/mind/platform/render-net.test.ts`
Expected: PASS, earlier tests included.

If an earlier test's expectation changes only because a clause split now merges a pair, the new single-token form is the intended behaviour; record a ruling. Then run the corpus replay: copy `.superpowers/sdd/2026-10-24-phase-16b-time-anchors/replay.ts` into this plan's workspace and run `pnpm exec tsx <workspace>/replay.ts`. Expected: 0 left with relative words. It printed 269 anchored last time; a lower count must be explained in a ruling.

- [ ] **Step 5: Commit**

```bash
git add src/mind/platform/time-anchors.ts tests/mind/platform/time-anchors.test.ts
git commit -m "fix(time): anchoring reads whole phrases, one clause at a time; a day said twice is one token; ISO dates anchor"
```

---

### Task 2: A part of the day with a clock time anchors as a time

**Files:**
- Modify: `src/mind/platform/time-anchors.ts` (`classify`)
- Test: `tests/mind/platform/time-anchors.test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

```ts
test("a part of the day with a clock time anchors as that time", () => {
  const fri = { at: at("2026-01-09T09:00:00Z"), zone: "UTC" };
  const stored = anchorTimes("tonight at 20:45 i'm finally watching the film", fri);
  expect(stored).toBe("⟦2026-01-09T20:45|time|UTC⟧ i'm finally watching the film");
  expect(read(stored, at("2026-01-10T09:00:00Z"))).toBe(
    "yesterday, Friday 9 January at 20:45 i'm finally watching the film",
  );
  expect(anchorTimes("tomorrow morning at 9", fri)).toBe("⟦2026-01-10T09:00|time|UTC⟧");
  expect(anchorTimes("see you at 8", fri)).toBe("see you at 8");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm test tests/mind/platform/time-anchors.test.ts`
Expected: FAIL. The text stays "tonight at 20:45 …".

- [ ] **Step 3: Implement**

In `classify`, replace

```ts
  if (!dated || dated.precision !== "day") return null;
```

with

```ts
  // A clock time sits on a day or a part of one ("tonight at 20:45"); the clock is the finer.
  if (!dated || !["day", "morning", "afternoon", "evening", "night"].includes(dated.precision))
    return null;
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm test tests/mind/platform/time-anchors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mind/platform/time-anchors.ts tests/mind/platform/time-anchors.test.ts
git commit -m "fix(time): a part of the day with a clock time keeps that time"
```

---

### Task 3: Extract keeps the model's weekday; extract v11 adds no dates

**Files:**
- Modify: `src/mind/memory/user/extract.ts`:
  - `anchorExtraction` loses `WEEKDAY_WORD`, `weekdaysIn`, the swap and its `log` parameter;
  - `extract`'s deps `Pick` drops `"log"`.
- Create: `prompts/extract/v11.md` (`git mv` from v10); config `prompts.extract` becomes `"v11"`.
- Modify: `tests/mind/memory/user/extract.test.ts`, `tests/exit/phase-15b.test.ts` (version pin), `tests/mind/platform/prompts.test.ts` if it pins the extract version.

**Interfaces:**
- Produces: `anchorExtraction(extraction: Extraction, turns: { role: string; text: string; created_at: Date }[], zone: string): Extraction`.

- [ ] **Step 1: Write the failing test**

Replace these three tests in `extract.test.ts` with the one below:

- "a weekday the message never named takes the one it did, in the fact's own direction";
- "the cross-check leaves a fact alone when the message names two weekdays, and never moves a right past date";
- "the weekday cross-check leaves her own facts, and a weekday from her turn, alone".

```ts
test("a fact keeps its own weekday whatever weekday their message names (the 16b run)", () => {
  const sent = new Date("2026-01-05T15:43:00Z"); // Monday
  const out = anchorExtraction(
    extraction([plainFact("The user has a design job interview on Thursday afternoon.", "upcoming")]),
    [{ role: "user", text: "no half marathon yet lol, that's sunday", created_at: sent }],
    "UTC",
  );
  expect(day(out.facts[0]!.occurred_at)).toBe("2026-01-08");
});
```

Then remove `log: silentLogger` from the two `extract(...)` calls and the `silentLogger` import.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm test tests/mind/memory/user/extract.test.ts`
Expected: FAIL. The date is 2026-01-11 (the swap), plus type errors for `log`.

- [ ] **Step 3: Implement**

In `extract.ts`:

- delete `WEEKDAY_WORD` and `weekdaysIn`;
- replace `anchorExtraction`'s doc comment and body with:

```ts
/**
 * Dates each fact from the moment its message was sent, in their zone, pointing the way extract
 * labelled it; the model never works out a date.
 */
export function anchorExtraction(
  extraction: Extraction,
  turns: { role: string; text: string; created_at: Date }[],
  zone: string,
): Extraction {
  const said = turns.filter((t) => t.role === "user");
  // A reach-out exchange has no message of theirs; its own last turn dates it.
  const at = said.at(-1)?.created_at ?? turns.at(-1)?.created_at ?? new Date(0);
  const facts = extraction.facts.map((f) => {
    const content = anchorTimes(f.content, { at, zone, direction: f.when_direction ?? null });
    return { ...f, content, occurred_at: tokenDates(content)[0] ?? null };
  });
  const threads = extraction.threads.map((t) => {
    const slot = t.checkpoint_when
      ? anchorTimes(t.checkpoint_when, { at, zone, direction: "upcoming" })
      : null;
    return { ...t, next_checkpoint: slot && isSingleToken(slot) ? tokenDates(slot)[0]! : null };
  });
  return { ...extraction, facts, threads };
}
```

- In `extract`: deps become `Pick<Deps, "llm" | "config">`, and the call becomes `anchorExtraction(normalizeExtraction(raw, config.extraction.max_candidates), args.newTurns, zone)`.
- Remove the `Logger` import if unused.

Prompt: `git mv prompts/extract/v10.md prompts/extract/v11.md`. In v11, after the "Times:" bullet's last sentence ("…code dates them from when the message was sent."), add: ` Never add a date or weekday they didn't say: "the interview happened", not "the interview on Friday 9 January".` Set `"extract": "v11"` in `config/default.json`, and update the `"v10"` pins in `tests/exit/phase-15b.test.ts` (and `tests/mind/platform/prompts.test.ts` if it has one).

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/mind/memory/user tests/mind/process/cold-path tests/mind/platform/prompts.test.ts tests/exit/phase-15b.test.ts tests/exit/phase-16b.test.ts tests/evals`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/mind/memory/user prompts/extract config/default.json tests
git commit -m "fix(extract): a fact keeps its own weekday; extract v11 adds no dates of its own"
```

---

### Task 4: Writers use the date a row carries, and her loops the dates they were shown

**Files:**
- Modify: `src/db/repos/user/facts.ts` (`insertFact`) and `src/db/repos/core/memory.ts` (the core `insert`; find it with `grep -n "insert(item" src/db/repos/core`). Both add `occurred_at` to the shown dates.
- Modify: `src/mind/process/core/runner.ts`:
  - `LoopContext` gains `shown(): Date[]`;
  - the metered model records `tokenDates(system + input)` for each `classifyJson`;
  - `commit` hands `apply` a scope whose `memory.insert` adds them to `known`.
- Modify: `src/mind/process/core/render-snapshot.ts` (item anchoring takes `known: ctx.shown()`).
- Modify: `src/mind/process/core/appraise.ts`: `Appraisal` gains `shown?: Date[]`, set from `tokenDates(system + input)` on a model appraisal; `applyAppraisal` passes `{ known: a.shown }` to its insert.
- Test: `tests/db/user-mind-repos.test.ts`, `tests/db/core-repos.test.ts`, `tests/mind/process/core/runner.test.ts`, `tests/mind/process/core/appraise.test.ts`

**Interfaces:**
- Consumes: `tokenDates(text): Date[]` (existing).
- Produces: `LoopContext.shown(): Date[]`, and `Appraisal.shown?: Date[]`.

- [ ] **Step 1: Write the failing tests**

`tests/db/user-mind-repos.test.ts` (uses the file's `summaryRow`):

```ts
test("a row's own date is a date its words were shown (the 16b seed)", async () => {
  const u = await createTestUser();
  const sunday = new Date("2026-01-04T10:00:00Z");
  const race = await insertFact(getTestDb(), u, {
    ...summaryRow("The user is running a half marathon on Sunday morning.", sunday),
    kind: "event",
    occurred_at: new Date("2026-01-11T09:00:00Z"),
  });
  expect(tokenDates(race.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-11");
  const sister = await insertFact(getTestDb(), u, {
    ...summaryRow("The user's sister is visiting on the weekend.", sunday),
    kind: "event",
    occurred_at: new Date("2026-01-17T12:00:00Z"),
  });
  expect(tokenDates(sister.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-17");
});
```

`tests/mind/process/core/runner.test.ts`, using the file's existing deps setup (follow "a run writes one trace with the calls it made" for how it builds `deps` and scripts the handler):

```ts
test("a loop's memory writes take the dates its input showed (the 16b wander)", async () => {
  // deps, now = Thursday 8 January 2026 09:00 UTC, as the file's other tests build them
  const result = await runCoreLoop(deps, "core_wander", now, async (ctx) => {
    await ctx.deps.llm.classifyJson({
      purpose: "core_wander",
      model: "core",
      system: "s",
      input: "The telescope booking ⟦2026-01-06|day|UTC⟧ came through, so Spica gets a real session.",
      schema: z.object({}).passthrough(),
      timeoutMs: 1000,
      maxTokens: 10,
    });
    return ctx.commit(async (tx) => {
      const id = await tx.memory.insert({
        kind: "thought",
        content: "the telescope booking came through for tuesday night",
        embedding: vec(),
        occurred_at: now,
        created_at: now,
        status: "recurring",
        salience: 0.25,
        valence: 0,
        confidence: 0.6,
        source: "loop",
        source_ref: null,
      });
      return { inputs: {}, outputs: { id } };
    });
  });
  const row = await deps.core.memory.get(result.outputs!.id);
  expect(row!.content).toContain("⟦2026-01-06|night|UTC⟧");
});

test("a loop shown no dates anchors as before", async () => {
  // as above, with input "no dates here" and content "watching tonight": stored ⟦2026-01-08|night|UTC⟧
});
```

Write the second test out in full in the same shape (input `"no dates here"`, content `"watching tonight"`, expecting `⟦2026-01-08|night|UTC⟧`). Give the fake LLM a `core_wander` handler returning `{}` if the file's helpers need one.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm test tests/db/user-mind-repos.test.ts tests/mind/process/core/runner.test.ts`
Expected: FAIL. The race is dated 2026-01-04, the sister 2026-01-03, and the wander thought ⟦2026-01-13|night|UTC⟧.

- [ ] **Step 3: Implement**

`insertFact`: build the context as

```ts
  const ctx = {
    at,
    zone: zoneOrUtc(await getTimezone(db, userId)),
    ...hints,
    // The date the row carries is the one its words mean.
    known: [...(hints.known ?? []), ...(row.occurred_at ? [row.occurred_at as Date] : [])],
  };
```

Core `insert(item, hints = {})`: add `item.occurred_at` (when set) to `known` the same way.

`runner.ts`:

```ts
import { tokenDates } from "@/mind/platform/time-anchors";
…
  const shown: Date[] = [];
  // The dates in what she was shown: a bare weekday she writes back takes the day she saw.
  const llm = Object.create(meter.llm) as typeof meter.llm;
  llm.classifyJson = (req) => {
    shown.push(...tokenDates(`${req.system}\n${req.input}`));
    return meter.llm.classifyJson(req);
  };
```

Use `llm` instead of `meter.llm` in `fn({ deps: { ...deps, llm }, … })`, and add `shown: () => [...shown]` to the context object.

In `commit`, call `apply` with a scope whose memory adds the dates:

```ts
      const memory = Object.create(tx.memory) as typeof tx.memory;
      memory.insert = (item, hints = {}) =>
        tx.memory.insert(item, { ...hints, known: [...shown, ...(hints.known ?? [])] });
      const value = await apply({ ...tx, memory });
```

Add `shown(): Date[];` to `LoopContext`, with the doc comment "Dates in the inputs this run sent the model."

`render-snapshot.ts`: the item anchoring becomes `anchorTimes(item.text, { at: now, zone, known: ctx.shown() })`.

`appraise.ts`:
- `Appraisal` gets `/** Dates in the input it was written from. */ shown?: Date[];`.
- In the model path return `{ ...bounded, shown: tokenDates(`${system}\n${input}`) }`.
- In `applyAppraisal`, pass `{ known: a.shown ?? [] }` as the insert's second argument.

Add an appraise test: an event whose input self carries ⟦2026-01-06|day|UTC⟧ and whose scripted episode says "on tuesday" is stored on 2026-01-06. Follow `appraise.test.ts`'s existing setup.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm test tests/db tests/mind/process/core tests/exit/mind-split.test.ts`
Expected: PASS. If a core test's stored date changes only because its input now supplies a shown date, update the expectation and record a ruling.

- [ ] **Step 5: Commit**

```bash
git add -A src/db/repos src/mind/process/core tests
git commit -m "fix(time): a row's own date and the dates her loops were shown date the words they write"
```

---

### Task 5: Phase 16c exit test and the free replay

**Files:**
- Create: `tests/exit/phase-16c.test.ts`
- Create (git-ignored): `<workspace>/replay-16c.ts`

- [ ] **Step 1: Write the exit test**

```ts
/**
 * Phase 16c exit, all fake, from the 16b close run: anchoring keeps every word, a day said twice
 * is one token, a fact keeps its own weekday, her loops date a weekday by the day they were shown,
 * a row's own date wins, and a part of the day with a clock time anchors. A's data never reaches
 * a core loop or B.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { anchorExtraction } from "@/mind/memory/user/extract";
import { coreDepsOf } from "@/mind/platform/deps";
import { anchorTimes, renderTimes, tokenDates } from "@/mind/platform/time-anchors";
import { coreWander } from "@/mind/process/core/wander";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const day = (d: Date | undefined | null) => d?.toISOString().slice(0, 10) ?? null;

test("1: the swallowed summary keeps every word", () => {
  const at = new Date("2026-01-05T10:21:40Z");
  const text =
    "Sam has a design job interview at a small studio on the afternoon of Thursday 8 January, in 3 days, and they're feeling nervous about it.";
  expect(renderTimes(anchorTimes(text, { at, zone: "UTC" }), at, 6)).toBe(text);
});

test("2: 'yesterday, Thursday 8 January' and an ISO twin are one date each", () => {
  const at = new Date("2026-01-09T20:00:00Z");
  expect(tokenDates(anchorTimes("Interview yesterday, Thursday 8 January.", { at, zone: "UTC" }))).toHaveLength(1);
  expect(
    tokenDates(anchorTimes("Interview on Thursday afternoon, 2026-01-08.", { at, zone: "UTC" })),
  ).toHaveLength(1);
});

test("3: the interview stays on Thursday when their message says 'that's sunday'", () => {
  const sent = new Date("2026-01-05T15:43:00Z");
  const fact = {
    subject: "user",
    kind: "event",
    content: "The user has a design job interview on Thursday afternoon.",
    occurred_at: null,
    when_direction: "upcoming",
    salience: 0.7,
    valence: 0,
    confidence: 0.9,
    entity_names: [],
    thread_title: null,
    claim_kind: null,
    idiolect_type: null,
    started_by: null,
  };
  const out = anchorExtraction(
    { facts: [fact], entities: [], threads: [], relationship: null, intimacy: null, bid: null } as never,
    [{ role: "user", text: "no half marathon yet lol, that's sunday", created_at: sent }],
    "UTC",
  );
  expect(day(out.facts[0]!.occurred_at)).toBe("2026-01-08");
});

test("4: a seed's own date dates its words", async () => {
  const u = await createTestUser();
  const r = await insertFact(getTestDb(), u, {
    subject: "user",
    kind: "event",
    content: "The user is running a half marathon on Sunday morning.",
    embedding: vec(),
    created_at: new Date("2026-01-04T10:00:00Z"),
    occurred_at: new Date("2026-01-11T09:00:00Z"),
    status: "open",
    salience: 0.6,
    valence: 0,
    confidence: 0.9,
    source: "turn",
  });
  expect(day(tokenDates(r.content)[0])).toBe("2026-01-11");
});

test("5: 'tonight at 20:45' anchors", () => {
  const at = new Date("2026-01-09T09:00:00Z");
  expect(anchorTimes("tonight at 20:45", { at, zone: "UTC" })).toBe("⟦2026-01-09T20:45|time|UTC⟧");
});

const CANARY = "CANARY-16c7d2";
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

test("6: leak canary: A's dated fact never reaches a core loop's input or core memory", async () => {
  const d = makeTestDeps({ life: { timezone: "UTC" } });
  const a = await createTestUser("alice");
  await insertFact(d.db, a, {
    subject: "user",
    kind: "event",
    content: `The user's gig ${CANARY} is tomorrow.`,
    embedding: vec(),
    created_at: d.clock.now(),
    status: "open",
    salience: 0.9,
    valence: 0,
    confidence: 1,
    source: "turn",
  });
  const before = await coreDump();
  await coreWander(coreDepsOf(d), d.clock.now());
  for (const c of d.llm.structuredCalls) expect(JSON.stringify(c)).not.toContain(CANARY);
  expect(await coreDump()).not.toContain(CANARY);
  expect(before).not.toContain(CANARY);
});
```

If `coreWander` needs a day plan or snapshot to run, seed them the way `tests/mind/process/core/wander.test.ts` does. If it returns `not_due` and makes no call, assert on that instead, and keep the core-dump check.

- [ ] **Step 2: Run it**

Run: `pnpm test tests/exit/phase-16c.test.ts`
Expected: PASS. Fix the code, never an assertion.

- [ ] **Step 3: The free replay of the 16b run**

Write `<workspace>/replay-16c.ts`. It does five things:

1. It reads `evals/results/calls/eval-2026-10-24T08-48-12-585Z.jsonl`. One JSON object per line, with `at`, `purpose`, `system`, `input` and `output`.
2. For every user-mind (`user_*`), core (`core_*`) and `extract` call, it takes each output text: the summary, read and idea fields, `reflection`, the thought and item `content`s, and the extract `facts[].content`.
3. It anchors each text with `anchorTimes(text, { at: <the call's simulated now>, zone: "UTC" })`. Take the simulated now from the input's NOW line, or from the first token in the input when there's none. If neither is present, skip the text and count the skip.
4. It counts three things:
   - **lost words:** words of four or more letters in the text, other than time words, missing from `renderAbsolute(anchored)`;
   - **doubled tokens:** two tokens with only `/^[\s,;(]*$/` between them and the same day;
   - **relative words left:** `relativeWords(anchored outside tokens)`.
5. It prints the three counts, the skipped count, and the first five examples of each.

Run: `pnpm exec tsx <workspace>/replay-16c.ts`
Expected: lost words 0, doubled tokens 0, relative words left 0. Ledger the counts.

- [ ] **Step 4: Commit**

```bash
git add tests/exit/phase-16c.test.ts
git commit -m "test(exit): Phase 16c anchor fixes from the 16b run, with leak canary"
```

---

### Task 6: Close

**Files:**
- `spica-design-spec-v3.md`:
  - §6 fact content: ISO and merging;
  - §8 core loops: shown dates via the runner;
  - §10.4/§12.3: extract v11, the cross-check gone;
  - §20: the 16c row becomes built.
- `docs/spec-v3-history.md`: the 16c row.
- `DECISIONS.md`:
  - the 2026-10-24 rows "Her own loops pass no shown dates" and "The extract weekday cross-check applies only to …" are superseded (new rows saying so);
  - new rows: clauses split at commas and "and"; a pair merges at the finer precision, with the written-out date winning; the ISO pass.
- `CLAUDE.md` "Current phase"; memory `phase-status` and `phase-16c-settled`.
- Delete the design doc and this plan once built.

- [ ] **Step 1:** `spica-close`, in order:
  - `pnpm format`, `pnpm typecheck`, `pnpm lint`;
  - the full `pnpm test`, in the foreground in parts with `--maxWorkers=4` (`tests/mind`, then the rest, then `tests/infra.test.ts`);
  - `pnpm test tests/exit/phase-16c.test.ts`;
  - `pnpm eval --llm=fake --compare`;
  - `git grep -nE "weekdaysIn|WEEKDAY_WORD" -- src tests evals` returns nothing;
  - `scope-reviewer` on the diff (told not to run tests);
  - the spec write-back;
  - commit.
- [ ] **Step 2:** the final whole-branch review (most capable model).
- [ ] **Step 3:** the paid run, only on Ethan's go-ahead:
  - `pnpm review:world-outreach`, started detached (`Start-Process cmd /c "pnpm review:world-outreach > evals/results/run-world-outreach-16c.log 2>&1"`) and watched with Monitor;
  - compared with `evals/results/review-2026-10-24T08-48-12-791Z.md` and the 16b analysis.
