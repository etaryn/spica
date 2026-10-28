# Phase 17e: core notes on labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every core writer (world events, intentions, episodes, thoughts, reflect, gists, goals,
snapshot) labels its own time words and may cite her memories by id through `platform/notes.ts`,
and the Phase 16 prose parser (`anchorTimes`, chrono, shown dates) is deleted.

**Architecture:** A core loop is shown her memories as numbered lines (`[m1] … (date)`) built by
`memory/core/citables.ts`. Its schema gains `times: noteTimesSchema([...fields]).default([])`.
Before it embeds or stores text, the loop runs `writeNote(fields, times, citables, { now, zone })`,
which turns each labelled time word into a token and each `[mN]` into the cited memory's date
token. The core repo stores text as given. Core-role calls think (`models.core_thinking`).

**Tech Stack:** TypeScript, zod 4, Vitest, Drizzle/Postgres, the Anthropic SDK (structured
output), pnpm.

**Spec:** `docs/2026-10-28-phase-17e-core-notes-on-labels-design.md` (settled with Ethan
2026-10-28). Read it with this plan. Background: `docs/2026-10-25-phase-17-labelled-memory-design.md`,
spec §8 (`grep -n '^##' spica-design-spec-v3.md`, then §8.1–§8.5 only).

## Global Constraints

- Branch `phase-17e` off `main`. Stage explicit paths only, never a directory (Ethan's untracked
  `docs/2026-10-21-vision-check.md` must never be committed).
- Core code takes `CoreDeps` only: no `db`, no `user_id`, no import from `@/mind/process/*`
  other than `@/mind/process/core`. ESLint enforces it on every edit.
- Every number lives in `config/default.json` plus its zod entry in `src/mind/platform/config.ts`.
- Every prompt is a versioned file. A new version replaces the old one, and the old file is
  deleted in the same task.
- Comments say why, never where from: no spec sections, phases or backlog numbers in code.
- Each file starts with a short plain-English header. Prettier wraps at 100 columns.
- Her speech stays free: nothing here touches what she says, only what she stores.
- No retries, no fallback parser. An unlabelled time word stays raw.
- Tests: `pnpm test <path>` while working; the full suite (`pnpm test`, ~10 min, one test process
  at a time) runs once, at the close. Never weaken an assertion to make it pass.
- Windows: write files containing backslashes (regexes, `\n`) with the Edit/Write tools, never
  through shell heredocs.

## Review Focus

1. **A citation or token cut in half.** `fitChars` cuts at `max_chars` with "…". Text must be fit
   *before* `writeNote`, and nothing may fit it again afterwards (`storeThoughts` re-validates).
   Task 3 pins this with a test: a full-length thought plus a citation is stored uncut.
2. **A time word in one field labelled against another.** Reflect and the snapshot have many
   fields. The field name in `times` must pick exactly one string. Tasks 5 and 6 test a word
   that appears in two fields.
3. **A gist's day counted from today.** Consolidate condenses a week at least 7 days back, so a
   weekday counted from today lands in the wrong week. The prompt says to count from a cited
   source. Task 5 tests `from: "m2"` resolving to that source's week.
4. **Reflect's targets after the move to m-ids.** `supersedes` and a fading `target_id` now take
   m-ids. An unknown id, or an id that isn't an opinion or interest, must change nothing. Task 5
   tests both.
5. **A kept snapshot line changed.** A section the render empties keeps last night's lines byte
   for byte, tokens included. Task 6 tests it.

---

## File structure

- Create: `src/mind/memory/core/citables.ts`. Numbers the core memories a loop is shown, and
  builds their input lines and `Citable`s.
- Create: `prompts/core/notes/v1.md`. Core rules for citing and labelling times.
- Create: `evals/lib/relative-words.ts`. The eval-only detector moved out of `time-anchors.ts`.
- Create: `tests/mind/memory/core/citables.test.ts`, `tests/exit/phase-17e.test.ts`.
- Create: `evals/scripts/long-conversation.yaml` (B142).
- Modify: `src/mind/platform/notes.ts` (`withNoteRules` takes a prompt name);
  `src/mind/platform/llm/anthropic.ts` (core thinking); `src/mind/platform/config.ts` and
  `config/default.json`; `src/mind/platform/llm/fake.ts`.
- Modify the writers: `src/mind/process/core/{thoughts,anticipate,ruminate,wander,appraise,resolve,world-tick,reflect,consolidate,render-snapshot,runner,drift-watch,post-words}.ts`
  and `src/mind/world/events.ts`.
- Modify: `src/db/repos/core/{memory,index}.ts`, `src/mind/memory/core/types.ts`,
  `src/runtime/deps.ts`, `src/db/reset-self-cli.ts`, `evals/lib/runner.ts`,
  `evals/lib/review.ts`.
- Modify (strip the parser): `src/mind/platform/time-anchors.ts`, `package.json` (drop
  `chrono-node`).
- Prompts replaced: `core/{appraise,anticipate,ruminate,wander,reflect,snapshot}` v4→v5,
  `core/consolidate` v2→v3, `core/resolve` v1→v2, `life/event` v7→v8.
- Delete: `tests/exit/phase-16c.test.ts`.

---

### Task 1: Core thinking, timeouts and token room

**Files:**
- Modify: `config/default.json` (`models`, `core.*.max_tokens`, `core.world.event_max_tokens`)
- Modify: `src/mind/platform/config.ts:45-72` (models schema)
- Modify: `src/mind/platform/llm/anthropic.ts:76-82`
- Modify: every `model: "core"` caller's `timeoutMs`: `src/mind/process/core/{anticipate,appraise,consolidate,drift-watch,post-words,reflect,render-snapshot,resolve,ruminate,wander}.ts`
- Modify: `src/mind/world/events.ts:310-324` (`life_event` moves to role `core`)
- Modify: `src/mind/process/core/world-tick.ts:192` (attempt log names `config.models.core`)
- Test: `tests/mind/platform/llm.test.ts`

**Interfaces:**
- Produces: `config.models.core_thinking: "adaptive" | "disabled" | …` (the same `thinking` enum
  as `user_mind_thinking`), and `config.models.core_timeout_ms: number`.

- [ ] **Step 1: Write the failing test.** In `tests/mind/platform/llm.test.ts`, after the
  "user_mind role thinks" test, add:

```ts
  test("the core role thinks by its own setting; other structured calls keep theirs", async () => {
    const { client, parse } = stubClient(undefined, { parsed_output: { ok: true } });
    const p = new AnthropicProvider(client, {
      ...models,
      core_thinking: "adaptive",
      structured_thinking: "disabled",
    });
    const schema = z.object({ ok: z.boolean() });
    for (const model of ["core", "life"] as const)
      await p.classifyJson({
        purpose: "x",
        model,
        system: "s",
        input: "i",
        schema,
        timeoutMs: 1,
        maxTokens: 1,
      });
    const [core, life] = parse.mock.calls.map((c) => c[0]);
    expect(core).toMatchObject({ thinking: { type: "adaptive" } });
    expect(life).toMatchObject({ thinking: { type: "disabled" } });
  });
```

  If the file's `models` fixture is typed as the config models, add `core_thinking: "disabled"`
  and `core_timeout_ms: 1` to it.

- [ ] **Step 2: Run it and check that it fails.** Run `pnpm test tests/mind/platform/llm.test.ts`.
  Expected: FAIL, because `core` gets `disabled`.

- [ ] **Step 3: Implement.**
  - `config.ts` models schema, after `user_mind_timeout_ms`:

```ts
  // Her core loops label their own time words, which takes thinking, room and time.
  core_thinking: thinking,
  core_timeout_ms: positiveInt,
```

  - `config/default.json` `models`: add `"core_thinking": "adaptive", "core_timeout_ms": 90000`.
  - `anthropic.ts`: extend the chain with
    `: model === "core" ? this.models.core_thinking : this.models.structured_thinking`.
  - `config/default.json` token caps go to 8000, because thinking counts toward `max_tokens`:
    `core.snapshot.max_tokens`, `core.loops.max_tokens` (wander, anticipate, ruminate and both
    post-words calls use it), `core.appraise.max_tokens`, `core.resolve.max_tokens`,
    `core.drift.max_tokens`, `core.reflect.max_tokens`, `core.consolidate.max_tokens`,
    `core.world.event_max_tokens`.
  - Every `classifyJson` call with `model: "core"` uses
    `timeoutMs: config.models.core_timeout_ms`, the 10 files listed above.
  - `events.ts` `life_event` call: `model: "core"`, `timeoutMs: config.models.core_timeout_ms`.
    `life_plan` (`day-plan.ts`) stays on `life`.
  - `world-tick.ts:192`: `model: a.source === "model" ? config.models.core : "injected"`.

- [ ] **Step 4: Run the test and check that it passes.** Run
  `pnpm test tests/mind/platform/llm.test.ts`, then `pnpm typecheck`. Expected: PASS, no type
  errors. Fix any test fixture typed as full config models.
- [ ] **Step 5: Commit.**

```bash
git add config/default.json src/mind/platform/config.ts src/mind/platform/llm/anthropic.ts src/mind/process/core/anticipate.ts src/mind/process/core/appraise.ts src/mind/process/core/consolidate.ts src/mind/process/core/drift-watch.ts src/mind/process/core/post-words.ts src/mind/process/core/reflect.ts src/mind/process/core/render-snapshot.ts src/mind/process/core/resolve.ts src/mind/process/core/ruminate.ts src/mind/process/core/wander.ts src/mind/world/events.ts src/mind/process/core/world-tick.ts tests/mind/platform/llm.test.ts
git commit -m "feat(core): core-role calls think, with their own timeout and token room"
```

---

### Task 2: Core citables and the core notes prompt

**Files:**
- Create: `src/mind/memory/core/citables.ts`
- Create: `prompts/core/notes/v1.md`
- Modify: `src/mind/platform/notes.ts` (`withNoteRules`)
- Modify: `src/mind/platform/config.ts` (prompts schema `core_notes`), `config/default.json`
  (`prompts.core_notes: "v1"`)
- Test: `tests/mind/memory/core/citables.test.ts`, `tests/mind/platform/notes.test.ts`

**Interfaces:**
- Consumes: `Citable`, `writeNote`, `noteTimesSchema`, `NoteTime`, `Dropped` from
  `@/mind/platform/notes`, and `dateToken` from `@/mind/platform/time-anchors`.
- Produces:

```ts
export type CoreLine = { id: string; kind: string; content: string; when: string | null };
export function coreCitables(memories: CoreMemoryItem[], zone: string): {
  lines: CoreLine[];
  items: Citable[];
};
/** "[m1] She rewatched Solaris. (⟦…⟧)": a line for a text input. */
export function lineText(line: CoreLine): string;
export function withNoteRules(system: string, version: string, name?: string): string; // name defaults to "notes"
```

- [ ] **Step 1: Write the failing tests.** `tests/mind/memory/core/citables.test.ts`:

```ts
/** Her memories as a core loop is shown them: numbered, each cited as its own date. */
import { expect, test } from "vitest";
import { coreCitables, lineText } from "@/mind/memory/core/citables";
import type { CoreMemoryItem } from "@/mind/memory/core/types";
import { writeNote } from "@/mind/platform/notes";
import { dateToken } from "@/mind/platform/time-anchors";

const at = new Date("2026-01-06T12:00:00Z");
const item = (over: Partial<CoreMemoryItem>): CoreMemoryItem =>
  ({
    id: "row-1",
    kind: "episode",
    content: "She rewatched Solaris.",
    payload: null,
    entity_refs: [],
    occurred_at: at,
    created_at: at,
    status: "resolved",
    salience: 0.5,
    valence: 0,
    confidence: 1,
    depth: 2,
    source: "world",
    source_ref: null,
    ...over,
  }) as CoreMemoryItem;

test("each memory is numbered and cited as its date; an intention as its plan's moment", () => {
  const plan = new Date("2026-01-09T19:00:00Z");
  const { lines, items } = coreCitables(
    [item({}), item({ id: "row-2", kind: "intention", payload: { event_at: plan.toISOString() } })],
    "UTC",
  );
  expect(lines[0]).toEqual({
    id: "m1",
    kind: "episode",
    content: "She rewatched Solaris.",
    when: dateToken(at, "UTC"),
  });
  expect(items[1]).toMatchObject({
    id: "m2",
    ref: "row-2",
    owner: null,
    text: dateToken(plan, "UTC", "time"),
    at: plan,
  });
  expect(lineText(lines[0]!)).toBe(`[m1] She rewatched Solaris. (${dateToken(at, "UTC")})`);
});

test("a memory whose words carry a date shows none beside them, but its cite still dates it", () => {
  const content = `Booked the telescope for ${dateToken(at, "UTC")}.`;
  const { lines, items } = coreCitables([item({ content })], "UTC");
  expect(lines[0]!.when).toBeNull();
  expect(lineText(lines[0]!)).toBe(`[m1] ${content}`);
  expect(items[0]!.text).toBe(dateToken(at, "UTC"));
});

test("a citation in her note reads as the cited memory's date", () => {
  const { items } = coreCitables([item({})], "UTC");
  const note = writeNote({ thought: "Solaris [m1] still stays with her" }, [], items, {
    now: new Date("2026-01-08T09:00:00Z"),
    zone: "UTC",
  });
  expect(note.fields.thought).toBe(`Solaris (${dateToken(at, "UTC")}) still stays with her`);
  expect(note.memories).toEqual(["row-1"]);
});
```

  In `tests/mind/platform/notes.test.ts`, add:

```ts
test("core loops load their own note rules", () => {
  expect(withNoteRules("SYS", "v1", "core/notes")).toContain("## Citing and times");
  expect(withNoteRules("SYS", "v1", "core/notes")).not.toContain("theirs");
});
```

  Add `withNoteRules` to that file's import from `@/mind/platform/notes`.

- [ ] **Step 2: Run and check that they fail.** Run
  `pnpm test tests/mind/memory/core/citables.test.ts tests/mind/platform/notes.test.ts`.
  Expected: FAIL (the module doesn't exist; `withNoteRules` takes no name).

- [ ] **Step 3: Implement.** `src/mind/memory/core/citables.ts`:

```ts
/**
 * Her memories as a core loop is shown them: numbered (m1, m2…) so what she writes can cite one.
 * Every one is hers and its words are already in the loop's input, so a citation reads as the
 * memory's date alone: a plan's moment for an intention, otherwise when it happened.
 */
import type { Citable } from "@/mind/platform/notes";
import { dateToken } from "@/mind/platform/time-anchors";
import type { CoreMemoryItem } from "./types";

export type CoreLine = { id: string; kind: string; content: string; when: string | null };

function moment(m: CoreMemoryItem): { at: Date; precision: "day" | "time" } {
  if (m.kind === "intention") {
    const p = m.payload as Record<string, unknown> | null;
    const at = typeof p?.event_at === "string" ? new Date(p.event_at) : null;
    if (at && Number.isFinite(at.getTime())) return { at, precision: "time" };
  }
  return { at: m.occurred_at ?? m.created_at, precision: "day" };
}

export function coreCitables(memories: CoreMemoryItem[], zone: string) {
  const out = memories.map((m, i) => {
    const id = `m${i + 1}`;
    const { at, precision } = moment(m);
    const date = dateToken(at, zone, precision);
    const item: Citable = { id, ref: m.id, kind: "memory", text: date, owner: null, at };
    // Words that already carry a date show no second one beside them.
    const line: CoreLine = {
      id,
      kind: m.kind,
      content: m.content,
      when: m.content.includes("⟦") ? null : date,
    };
    return { item, line };
  });
  return { lines: out.map((o) => o.line), items: out.map((o) => o.item) };
}

export function lineText(line: CoreLine): string {
  return `[${line.id}] ${line.content}${line.when ? ` (${line.when})` : ""}`;
}
```

  `notes.ts`:

```ts
/** A loop's prompt with the shared rules for citing and for labelling its own time words. */
export function withNoteRules(system: string, version: string, name = "notes"): string {
  return `${system}\n\n${loadPrompt(name, version)}`;
}
```

  Update the header comment's last sentence to "It holds no one's data, so both minds write
  through it, each with its own rules." Add `core_notes: promptVersion` after `notes` in the
  config prompts schema, and `"core_notes": "v1"` after `"notes"` in `config/default.json`.

  `prompts/core/notes/v1.md`:

```markdown
## Citing and times

`now` says what day and time it is for you. Each memory of yours you're shown has an id in square
brackets (m1, m2…). When what you write is about one, you may put its id in square brackets right
after the words it's about: "the screening [m2] still stays with her". Code adds that memory's date
there in brackets, so never write a date one already carries. You don't have to cite.

`times` lists every time word you write yourself, outside a citation ("tonight", "Sunday", "this
weekend", "the 17th", "the day after"). An empty list is right only when you wrote none.
- field: which part of your answer the words are in, by the name your instructions give it.
  words: exactly as you wrote them there.
- Never work out a date. Say what the words mean, and code counts it.
- from: "" counts from today, the day in `now`. A cited id counts from that memory's day: for "the
  day after" the screening [m2], use "m2".
- unit and shift:
  - day: days from the base day: 0 today or tonight, 1 tomorrow, -1 yesterday, 3 in three days.
  - weekday (fill weekday): 1 is the first one after the base day, -1 the last one before it, 2
    the one after that. A weekday that means the base day itself is day 0.
  - date (fill day_of_month, and month when you name it): 1 the next one, -1 the last one.
  - week, weekend, month: 0 this one, 1 next, -1 last.
- part: morning | afternoon | evening | night, or start | end of a week or month; null when you
  don't say one.
- clock: "HH:MM" on a 24-hour clock when you name a time, else "".
- span: "since" for "since friday", "until" for "till sunday", else "at".
- rough: true for vague words ("in a few days") where you mean the likeliest day.
- Words that don't point at a day are not times: a habit ("every sunday") or a hypothetical.
```

- [ ] **Step 4: Run the tests and check that they pass.** Run
  `pnpm test tests/mind/memory/core/citables.test.ts tests/mind/platform/notes.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/mind/memory/core/citables.ts prompts/core/notes/v1.md src/mind/platform/notes.ts src/mind/platform/config.ts config/default.json tests/mind/memory/core/citables.test.ts tests/mind/platform/notes.test.ts
git commit -m "feat(core): core citables and core note rules"
```

---

### Task 3: Thoughts label their time words (anticipate, ruminate, wander)

**Files:**
- Modify: `src/mind/process/core/thoughts.ts`
- Modify: `src/mind/process/core/{anticipate,ruminate,wander}.ts`
- Create: `prompts/core/{anticipate,ruminate,wander}/v5.md`. Delete each `v4.md`.
- Modify: `config/default.json` prompts `core_anticipate`, `core_ruminate`, `core_wander` → `v5`
- Modify: `src/mind/platform/llm/fake.ts` (`core_anticipate`, `core_ruminate`, `core_wander`)
- Test: `tests/mind/process/core/{thoughts,anticipate,ruminate,wander}.test.ts`

**Interfaces:**
- Consumes: `coreCitables`, `lineText` (Task 2), `writeNote`, `noteTimesSchema`, `withNoteRules`,
  `type Citable`, `type NoteTime`, `type Dropped`, and `nowLine` from
  `@/mind/platform/time-anchors`.
- Produces:

```ts
export type ThoughtNote = {
  times: NoteTime[];
  citables: Citable[];
  now: Date;
  zone: string;
  /** The `times` field each item's words are under, by position. */
  fields: string[];
};
export type PreparedThought = {
  item: ThoughtInput;
  embedding: number[];
  /** The memories its words cite, stored as `payload.cites`. */
  cites?: string[];
  dropped?: Dropped[];
};
export async function prepareThoughts(
  deps: CoreDeps,
  items: ThoughtInput[],
  note?: ThoughtNote,
): Promise<PreparedThought[]>;
// ApplyOutput gains `note_dropped?: Dropped[]`.
```

- [ ] **Step 1: Write the failing tests.** In `tests/mind/process/core/thoughts.test.ts`:

```ts
const tomorrowNight = {
  field: "thought",
  words: "tomorrow night",
  from: "",
  unit: "day" as const,
  shift: 1,
  weekday: null,
  month: null,
  day_of_month: null,
  part: "night" as const,
  clock: "",
  span: "at" as const,
  rough: false,
};

test("a thought's time words and citation become tokens, and a full-length thought is never cut after", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  const max = deps.config.core.loops.max_chars;
  const cited = { id: "m1", ref: "mem-1", kind: "memory" as const, text: "⟦2026-01-03|day|UTC⟧", owner: null, at: new Date("2026-01-03T12:00:00Z") };
  const long = `Solaris [m1] again tomorrow night ${"x".repeat(max)}`;
  const [prepared] = await prepareThoughts(
    deps,
    [{ kind: "thought", content: long, salience: "low" }],
    { times: [tomorrowNight], citables: [cited], now, zone: "UTC", fields: ["thought"] },
  );
  // Monday the 5th: "tomorrow night" said with its words kept is Tuesday's night.
  expect(prepared!.item.content.startsWith("Solaris (⟦2026-01-03|day|UTC⟧) again ⟦2026-01-06|night|UTC|tomorrow night⟧")).toBe(true);
  expect(prepared!.cites).toEqual(["mem-1"]);
  const { ids } = await deps.core.transaction((tx) => storeThoughts(tx, deps, [prepared!], meta));
  const row = await deps.core.memory.get(ids[0]!);
  expect(row!.content).toBe(prepared!.item.content);
  expect(row!.payload).toEqual({ seed: "a-memory", cites: ["mem-1"] });
});
```

  In `tests/mind/process/core/wander.test.ts`, add a test like the existing "done" path. Script
  `d.llm.handlers.core_wander = () => ({ items: [{ kind: "thought", content: "the telescope [m1] tonight", salience: "low" }], times: [{ ...tonightTime, field: "item_1" }] })`,
  with `tonightTime` meaning day 0 night, and assert:
  - the stored thought contains the seed's date token in brackets and the night token;
  - `payload.cites` holds the seed's id;
  - the input the fake received (`d.llm.structuredCalls.at(-1)!.input`) contains `[m1] ` and
    starts with `It's `.

  Add the same kind of test in `anticipate.test.ts` (field `"thought"`; the intention is m1 and
  its citation is the event's time token, precision `time`) and in `ruminate.test.ts` (the
  episode is m1).

- [ ] **Step 2: Run and check that they fail.** Run
  `pnpm test tests/mind/process/core/thoughts.test.ts tests/mind/process/core/wander.test.ts tests/mind/process/core/anticipate.test.ts tests/mind/process/core/ruminate.test.ts`.
  Expected: the new tests FAIL.

- [ ] **Step 3: Implement `thoughts.ts`.**
  - `validItem(item, maxChars: number | null)`: when `maxChars` is null it only trims and checks
    the text is non-empty. A stored thought already carries its tokens, and cutting would split
    one.
  - `prepareThoughts(deps, items, note?)`:

```ts
  const normalized = items.map((item) => validItem(item, deps.config.core.loops.max_chars));
  if (!normalized.length) return [];
  // Fit first, then label: a token or citation added after the fit is never cut.
  const written = normalized.map((item, i) => {
    if (!note) return { item, cites: [] as string[], dropped: [] as Dropped[] };
    const field = note.fields[i]!;
    const n = writeNote({ [field]: item.content }, note.times, note.citables, note);
    return { item: { ...item, content: n.fields[field]! }, cites: n.memories, dropped: n.dropped };
  });
  const embeddings = await deps.embedder.embed(written.map((w) => w.item.content), "document");
  if (embeddings.length !== written.length) throw new Error("invalid thought embedding batch");
  return written.map((w, index) => ({
    ...w,
    embedding: validEmbedding(embeddings[index]!, deps.config.embedding.dimensions),
  }));
```

  - `storeThoughts`: validate with `validItem(item, null)`, carry `cites` from each prepared
    item, and store
    `payload: cites?.length ? { ...(meta.payload as object), cites } : meta.payload`.
  - `ApplyOutput` gains `note_dropped?: Dropped[]`.

- [ ] **Step 4: Implement the three loops.** In each one: build citables from what it shows,
  start the input with `nowLine(now, tz, tz)`, show memories with `lineText`, add `times` to the
  schema, load the rules with `withNoteRules`, and pass the note to `prepareThoughts`.
  - **anticipate:** `const cite = coreCitables([intention], tz);`. Input lines:
    `nowLine(now, tz, tz)`, then `Upcoming plan: ${event.content}`, then
    `When: ${dateToken(event.at, tz, "time")}`, then
    `Her intention: ${lineText(cite.lines[0]!)}`, then the rest unchanged. Schema:
    `times: noteTimesSchema(["thought"]).default([])`. System:
    `[persona.coreValues, self, withNoteRules(loadPrompt("core/anticipate", config.prompts.core_anticipate), config.prompts.core_notes, "core/notes")]`.
    Prepare with
    `prepareThoughts(ctx.deps, [raw.thought], { times: raw.times, citables: cite.items, now, zone: tz, fields: ["thought"] })`.
    Add `note_dropped: prepared.flatMap((p) => p.dropped ?? [])` to the applied outputs.
  - **ruminate:** `coreCitables([episode], tz)`. The input line becomes
    `Landed episode: ${lineText(cite.lines[0]!)}`. Everything else is as in anticipate, with
    field `"thought"`.
  - **wander:** `coreCitables([seed, ...chain], tz)`. The input becomes
    `Seed memory: ${lineText(lines[0]!)}` and
    `Associated memories: ${lines.slice(1).map(lineText).join("\n") || "none"}`, with
    `nowLine` first. Schema: `times: noteTimesSchema(["item_1", "item_2"]).default([])`, keeping
    `max_items` at 2 (if the config value differs, build the fields from
    `config.core.wander.max_items`). Fields: `items.map((_, i) => `item_${i + 1}`)`. Delete the
    local `dated` helper.
- [ ] **Step 5: Prompts v5.** Each v5 is its v4 with two changes. The "Dates:" paragraph is
  replaced, and the schema sentence mentions `times`. The replacement paragraph, the same in all
  three:

```markdown
Dates: the input gives days with how far they are from now ("Friday 9 January, in 2 days"); never count days yourself. The note at the top of who she's been lately says when it was written.
```

  The schema sentence adds `times` (see "Citing and times" below):
  - **anticipate:** "Return JSON with `thought` (…), `emotion` (…) and `times`; the field for words in the thought is `thought`."
  - **ruminate:** "Return JSON with `thought` (…) and `times`; the field for words in the thought is `thought`."
  - **wander:** "Return JSON with `items` … and `times`; the field for words in your first item is `item_1`, in your second `item_2`."

  Change the title line's "(v1)" to "(v5)". Delete the three `v4.md` files. Set the three
  prompt keys in `config/default.json` to `"v5"`.
- [ ] **Step 6: Fakes.** In `fake.ts`, the three handlers strip the leading id from what they
  echo: `.replace(/^\[m\d+\] /, "")` on the captured seed, episode or plan. Each returns
  `times: []`.
- [ ] **Step 7: Run the tests and check that they pass.** Run
  `pnpm test tests/mind/process/core/thoughts.test.ts tests/mind/process/core/wander.test.ts tests/mind/process/core/anticipate.test.ts tests/mind/process/core/ruminate.test.ts tests/mind/process/core/mind-tick.test.ts tests/exit/phase-8b.test.ts`,
  then `pnpm typecheck`. Expected: PASS. Existing tests that matched the old input text
  (`Seed memory: X (`, `Landed episode: X (`) are updated to the `[m1] ` form. That is a format
  change, not a weakened assertion.
- [ ] **Step 8: Commit.**

```bash
git add src/mind/process/core/thoughts.ts src/mind/process/core/anticipate.ts src/mind/process/core/ruminate.ts src/mind/process/core/wander.ts prompts/core/anticipate prompts/core/ruminate prompts/core/wander config/default.json src/mind/platform/llm/fake.ts tests/mind/process/core/thoughts.test.ts tests/mind/process/core/wander.test.ts tests/mind/process/core/anticipate.test.ts tests/mind/process/core/ruminate.test.ts
git commit -m "feat(core): her thoughts cite memories and label their own time words"
```

  If other test files changed for the input format, add them by path.

---

### Task 4: The world writes labelled: events, intentions, resolutions, episodes

**Files:**
- Modify: `src/mind/world/events.ts` (`CoreEventContext`, `coreEventContext`, `buildEventInput`,
  `EventSchema`, `generateCoreEvents`, `AcceptedEvent`)
- Modify: `src/mind/process/core/world-tick.ts` (intention payload, trace outputs)
- Modify: `src/mind/process/core/resolve.ts`, `src/mind/process/core/appraise.ts`
- Create: `prompts/life/event/v8.md`, `prompts/core/resolve/v2.md`, `prompts/core/appraise/v5.md`.
  Delete `life/event/v7.md`, `core/resolve/v1.md`, `core/appraise/v4.md`.
- Modify: `config/default.json` prompts `life_event: v8`, `core_resolve: v2`, `core_appraise: v5`
- Modify: `src/mind/platform/llm/fake.ts` (`life_event`, `core_resolve`, `core_appraise` regexes)
- Test: `tests/mind/world/events.test.ts`, `tests/mind/process/core/{resolution,appraise,appraise-propose,world-tick}.test.ts`

**Interfaces:**
- Consumes: Task 2 and Task 3 helpers.
- Produces:
  - `CoreEventContext.recent: { lines: CoreLine[]; items: Citable[] }` replaces `episodes`.
  - `AcceptedEvent` gains `cites: string[]` (what the thought cites).
  - `generateCoreEvents` returns `dropped: Dropped[]` as well.
  - `ResolutionProposal` gains `dropped: Dropped[]`.
  - `Appraisal` loses `shown` and gains `cites?: string[]` and `dropped?: Dropped[]`.

- [ ] **Step 1: Write the failing tests.**
  - `events.test.ts`: update the `buildEventInput` test. Its context now passes
    `recent: coreCitables([episodeItem], "UTC")`, where `episodeItem` is a `CoreMemoryItem` with
    content "She rewatched Solaris." occurring a day earlier. Assert the input contains
    `- [m1] She rewatched Solaris. (` and starts with `It's `. The empty case passes
    `recent: { lines: [], items: [] }`. Add a test: a scripted `life_event` returns a planned
    event with `thought: "Spica is thinking of rewatching Solaris tonight."` and
    `times: [{ field: "thought", words: "tonight", from: "", unit: "day", shift: 0, part: "night", … }]`.
    Assert that the accepted candidate's `thought` contains the night token for the generation
    day, and `content` is unchanged.
  - `world-tick.test.ts`: a planned event whose thought cites `[m1]` (a recent episode) stores
    an intention with `payload` equal to `{ event_at: …, cites: [episodeId] }`.
  - `resolution.test.ts`: a scripted `core_resolve` returning
    `content: "Instead she watched it the next day"` with a `times` entry for "the next day"
    (`from: "m1"`, day +1, where m1 is the intention, dated at the plan's moment) stores the
    resolution world event with the token for the day after the plan.
  - `appraise-propose.test.ts`: replace the `a.shown` test (line ~221) with: a scripted
    `core_appraise` whose `episode` says "tonight" with a `times` entry gives an `Appraisal`
    whose `episode` holds the night token. With an intention, `What she expected: [m1] …`
    appears in the input, and `a.cites` holds the intention's id when the episode cites
    `[m1]`.
  - `appraise.test.ts`: delete the test "an episode's bare weekday takes the day its appraisal
    was shown" (line ~279). Add: `applyAppraisal` with `cites: ["x"]` stores
    `payload: { appraisal_emotion: …, cites: ["x"] }`.
- [ ] **Step 2: Run and check that they fail.** Run
  `pnpm test tests/mind/world/events.test.ts tests/mind/process/core/resolution.test.ts tests/mind/process/core/appraise.test.ts tests/mind/process/core/appraise-propose.test.ts tests/mind/process/core/world-tick.test.ts`.
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement `events.ts`.**
  - `EventSchema` adds `times: noteTimesSchema(["content", "thought"]).default([])`.
    `EventCandidate` keeps its shape; `checkEvent` passes `times` through unchanged (add
    `times: raw.times` to its return).
  - `coreEventContext` keeps the episodes as items:
    `recent: coreCitables(episodes, lifeTimezone(deps.config.life, now))`.
  - `buildEventInput`: the first part becomes `${nowLine(now, tz, tz)} Today is ${day} in her zone.`.
    The lately list is ``ctx.recent.lines.map((l) => `- ${lineText(l)}`).join("\n")``.
    The `tz` parameter stays.
  - In `generateCoreEvents`, right after `checkEvent` passes and before the rules and the
    embedding:

```ts
    // Its own time words become the days they mean before anything embeds or stores them.
    const note = writeNote(
      { content: c.content, ...(c.thought !== null ? { thought: c.thought } : {}) },
      c.times,
      ctx.recent.items,
      { now, zone: lifeTimezone(config.life, now) },
    );
    dropped.push(...note.dropped);
    c.content = note.fields.content!;
    if (c.thought !== null) c.thought = note.fields.thought!;
```

    Here `dropped: Dropped[]` is declared next to `accepted`. Push `cites: note.memories` onto
    the accepted event, and return `dropped` in every return path. A note's `memories` mixes
    content and thought cites, which is fine: they are lineage only.
    `injected` candidates carry `times: []`.
  - `world-tick.ts`: intention
    `payload: { event_at: e.at.toISOString(), ...(e.cites.length ? { cites: e.cites } : {}) }`,
    and `note_dropped: generated.dropped` in the `life_event` trace outputs.
- [ ] **Step 4: Implement resolve and appraise.**
  - `resolve.ts`: schema `times: noteTimesSchema(["content"]).default([])`. Build
    `const cite = coreCitables(intention ? [intention] : [], tz)`. The input becomes
    `nowLine(now, tz, tz)`, then the planned event line, the expected feeling, and
    `What she expected: ${intention ? lineText(cite.lines[0]!) : "no recorded intention"}`.
    The system uses `withNoteRules(prompt, config.prompts.core_notes, "core/notes")`. After
    `fitChars`:
    `const note = writeNote({ content }, raw.times, cite.items, { now, zone: tz });`, returning
    `content: note.fields.content!, dropped: note.dropped`. `world-tick.ts`'s `core_resolve`
    trace outputs add `dropped: proposal?.dropped ?? []`.
  - `appraise.ts`:
    - `AppraisalSchema` adds `times: noteTimesSchema(["episode"]).default([])`.
    - `proposeAppraisal` builds `cite = coreCitables(expected ? [expected] : [], tz)` and
      starts the input with `nowLine(now, tz, tz)`. The expected line uses `lineText` when
      there is one.
    - The system's prompt is wrapped with `withNoteRules(…, config.prompts.core_notes, "core/notes")`.
    - After `boundAppraisal`:

```ts
    if (bounded) {
      const note = writeNote({ episode: bounded.episode }, raw.times, cite.items, { now, zone: tz });
      return { ...bounded, episode: note.fields.episode!, cites: note.memories, dropped: note.dropped };
    }
```

    - Remove `shown` from `Appraisal`, and drop the `tokenDates` import.
    - In `applyAppraisal`, insert with
      `payload: { appraisal_emotion: a.emotion, ...(a.cites?.length ? { cites: a.cites } : {}) }`
      and no second `insert` argument.
    - The `core_appraise` trace outputs in `world-tick.ts` add
      `note_dropped: [...proposals.values()].flatMap((a) => a.dropped ?? [])`.
- [ ] **Step 5: Prompts.**
  - `life/event/v8.md` = v7 plus, at the end:

```markdown
`times` lists the time words you write yourself in `content` or `thought` (the fields are named `content` and `thought`): "tonight", "this afternoon", "tomorrow". Her recent life is listed with ids ([m1]…); you may cite one in square brackets after the words it's about, and code adds its date.
```

    with `withNoteRules(…, config.prompts.core_notes, "core/notes")` around the `life/event`
    prompt in `generateCoreEvents`' system. Title "(v8)".
  - `core/resolve/v2.md` = v1 with "Return only JSON with `content` (the surface event), `valence` (from -1 to 1), `stakes` (`low` or `high`) and `times` (the field for words in `content` is `content`)." Title "(v2)".
  - `core/appraise/v5.md` = v4 with the "Dates:" paragraph replaced by the Task 3 paragraph, and
    the return sentence adding "and `times` (the field for words in the episode is `episode`)". Title "(v5)".
  - Delete `prompts/life/event/v7.md`, `prompts/core/resolve/v1.md` and
    `prompts/core/appraise/v4.md`. Bump the three keys in `config/default.json`.
- [ ] **Step 6: Fakes.** `core_resolve` and `core_appraise` keep their regexes (their first line
  is now `It's …`, and the regexes are line-anchored with `m`, so they still match). Check this
  by running the tests. The `life_event` fake returns `times: []` (it is spread from
  `FAKE_DAY_EVENT`: add `times: []` there).
- [ ] **Step 7: Run the tests and check that they pass.** Run the Step 2 command plus
  `pnpm test tests/exit/core-loops.test.ts tests/exit/phase-15d.test.ts tests/exit/phase-14.test.ts`,
  then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 8: Commit.**

```bash
git add src/mind/world/events.ts src/mind/process/core/world-tick.ts src/mind/process/core/resolve.ts src/mind/process/core/appraise.ts prompts/life/event prompts/core/resolve prompts/core/appraise config/default.json src/mind/platform/llm/fake.ts tests/mind/world/events.test.ts tests/mind/process/core/resolution.test.ts tests/mind/process/core/appraise.test.ts tests/mind/process/core/appraise-propose.test.ts tests/mind/process/core/world-tick.test.ts
git commit -m "feat(core): world events, intentions, resolutions and episodes label their time words"
```

---

### Task 5: Reflect and consolidate label their time words

**Files:**
- Modify: `src/mind/process/core/reflect.ts`, `src/mind/process/core/consolidate.ts`
- Create: `prompts/core/reflect/v5.md`, `prompts/core/consolidate/v3.md`. Delete
  `reflect/v4.md` and `consolidate/v2.md`.
- Modify: `config/default.json` prompts `core_reflect: v5`, `core_consolidate: v3`
- Test: `tests/mind/process/core/reflect.test.ts`, `tests/mind/process/core/consolidate.test.ts`

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces: reflect's model-facing ids for inputs, context and narrative become m-ids;
  `supersedes` and a fading `target_id` take m-ids and are mapped back to row ids in code.

- [ ] **Step 1: Write the failing tests.**
  - `reflect.test.ts`:
    1. A scripted reflect returns an insight "the week of screenings [m1] ends tomorrow", with a
       `times` entry for "tomorrow" under `insight_1`, and a goal
       `{ title: "Finish the essay by Sunday", why: "it matters" }` with "Sunday" labelled under
       `goal_1_title` (weekday sunday shift 1). Assert:
       - the stored insight holds m1's date token and tomorrow's token;
       - its payload is `{ cites: [inputId] }`;
       - the stored goal title holds the Sunday token, and its why is unchanged.
    2. "Tomorrow" appears in both `insight_1` and `opinion_1`, but `times` labels only
       `opinion_1`. The insight keeps the raw word, and the opinion gets the token.
    3. `supersedes: "m2"`, where m2 is a context opinion, supersedes that opinion's row. A
       `supersedes: "m9"` (unknown) supersedes nothing and falls through to the twin rule. A
       fading `target_id` naming an episode's m-id fades nothing.
    4. Update every existing scripted `supersedes`/`target_id` uuid in this file to the m-id
       the input shows. Each test's own setup tells you its position: inputs first, then
       context, then the narrative.
  - `consolidate.test.ts`: a scripted gist "the screening that Saturday [m2]" with a time
    "that Saturday" (`from: "m2"`, unit `day`, shift 0) stores m2's day token, not today's
    Saturday. The gist payload is `{ gist_of: ids, cites: [secondSourceId] }`.
- [ ] **Step 2: Run and check that they fail.** Run
  `pnpm test tests/mind/process/core/reflect.test.ts tests/mind/process/core/consolidate.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement reflect.**

```ts
    const cite = coreCitables([...inputs, ...context, ...(narrative ? [narrative] : [])], tz);
    const refOf = new Map(cite.items.map((c) => [c.id, c.ref]));
    const maxGoals = config.core.goals.max_active;
    const fields = [
      ...range(bounds.max_insights).map((i) => `insight_${i}`),
      ...range(bounds.max_opinions).map((i) => `opinion_${i}`),
      ...range(bounds.max_interests).map((i) => `interest_${i}`),
      "narrative",
      ...range(maxGoals).flatMap((i) => [`goal_${i}_title`, `goal_${i}_why`]),
    ] as [string, ...string[]];
```

  - Define `range(n)` locally as `Array.from({ length: n }, (_, i) => i + 1)`.
  - Schema changes: `supersedes: z.string().nullable().optional()`;
    `target_id: z.string()` in the fading branch; `times: noteTimesSchema(fields).default([])`.
  - Input JSON adds `now: nowLine(now, tz, tz)`, and
    `inputs: cite.lines.slice(0, inputs.length)`,
    `context: cite.lines.slice(inputs.length, inputs.length + context.length)`,
    `narrative: narrative ? cite.lines.at(-1) : null`. Goals stay as they are.
  - After the call, write each field as its own note, so each proposal keeps only its own
    citations:

```ts
    const dropped: Dropped[] = [];
    // One note per field: a proposal's cites are its own words', and its times are its field's.
    const written = (key: string, text: string) => {
      const n = writeNote({ [key]: text }, result.times, cite.items, { now, zone: tz });
      dropped.push(...n.dropped);
      return { text: n.fields[key]!, cites: n.memories };
    };
```

    Each proposal then takes `written(key, text)`, with these keys:
    - `insight_${i + 1}` with `item.content`;
    - `opinion_${i + 1}` with `` `${item.subject}: ${item.stance}` ``;
    - `interest_${i + 1}` with `item.content`, with `i` its index in `result.interests`;
    - `narrative` with `result.narrative`.

    Each proposal carries `cites` alongside `content`. Goal adds at index `i < maxGoals` take
    `title: written(`goal_${i + 1}_title`, g.title).text` and
    `why: written(`goal_${i + 1}_why`, g.why).text`, built before the embedding texts.
  - Proposals: `target: item.supersedes ? (refOf.get(item.supersedes) ?? null) : null`. A
    fading item resolves `refOf.get(interest.target_id)`; when that is undefined, skip it.
  - Insert each memory with `payload: cites.length ? { cites } : null` (`NewCoreMemory.payload`
    is optional).
  - Goals: `goalAdds` takes title and why from the written fields (adds past `maxGoals` keep
    their raw text: they can never be inserted, since `available` caps adds at
    `max_active - active`).
  - The system's reflect prompt is wrapped with
    `withNoteRules(…, config.prompts.core_notes, "core/notes")`.
  - Trace outputs add `note_dropped`.
- [ ] **Step 4: Implement consolidate.**
  - `const cite = coreCitables(group.sources, timezone);`. The input JSON becomes
    `{ now: nowLine(now, timezone, timezone), week: group.week, sources: cite.lines }`.
  - Schema `times: noteTimesSchema(["gist"]).default([])`. The system is
    `withNoteRules(loadPrompt("core/consolidate", …), config.prompts.core_notes, "core/notes")`.
  - After the call:
    `const note = writeNote({ gist }, times, cite.items, { now, zone: timezone }); gist = note.fields.gist!;`
    before embedding. Payload `{ gist_of: ids, ...(note.memories.length ? { cites: note.memories } : {}) }`.
    Outputs add `note_dropped`.
  - The fake `core_consolidate` still reads `sources[].content`, so no change is needed.
- [ ] **Step 5: Prompts.**
  - `core/reflect/v5.md`: v4 with these changes:
    - Ids are m-ids now: "supersedes: an opinion's id from `context` (m…) or null", and
      "target_id: an interest's id from `context`".
    - The Task 3 "Dates:" paragraph.
    - Plus: "`times` field names: `insight_1`, `insight_2` for your insights in order; `opinion_1`… for opinions (subject and stance); `interest_1`… for interests, counted over the whole interests list; `narrative`; `goal_1_title`, `goal_1_why`… for the goals you add."
  - `core/consolidate/v3.md`: v2 plus:

```markdown
Return `times` for any time words in the gist (field `gist`). A day inside the week you condense counts from the source it is about: cite that source ([m2]) and set `from` to its id, never "", which counts from today.
```

  - Delete `v4.md` and `v2.md`. Bump the keys.
- [ ] **Step 6: Run the tests and check that they pass.** Run
  `pnpm test tests/mind/process/core/reflect.test.ts tests/mind/process/core/consolidate.test.ts tests/mind/process/core/nightly.test.ts tests/exit/core-loops.test.ts`,
  then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 7: Commit.**

```bash
git add src/mind/process/core/reflect.ts src/mind/process/core/consolidate.ts prompts/core/reflect prompts/core/consolidate config/default.json tests/mind/process/core/reflect.test.ts tests/mind/process/core/consolidate.test.ts
git commit -m "feat(core): reflect and consolidate cite memories by m-id and label their time words"
```

---

### Task 6: The snapshot labels its new lines

**Files:**
- Modify: `src/mind/process/core/render-snapshot.ts`
- Create: `prompts/core/snapshot/v5.md`. Delete `v4.md`.
- Modify: `config/default.json` `prompts.core_snapshot: v5`
- Test: `tests/mind/process/core/render-snapshot.test.ts`

**Interfaces:**
- Consumes: Task 2 helpers. The `times` field names are `"<Section> <n>"` (for example
  `"Lately 1"` or `"Habits of speech 2"`), with n counted from 1 within the section.

- [ ] **Step 1: Write the failing tests** in `render-snapshot.test.ts`:
  1. A scripted render returns `Lately: [{ text: "Screenings every night [m1] until Sunday", depth: null }]`
     with "until Sunday" labelled under `"Lately 1"` (weekday sunday shift 1, span `until`).
     The stored snapshot's Lately line holds m1's date and `until ⟦…|day|…|Sunday⟧`, or
     whatever `labelToken` gives (assert with `labelToken(resolveTime(...))`). The matching
     `core_self_line.text` equals the snapshot's line.
  2. "Sunday" appears in both `"Lately 1"` and `"Opinions 1"`, but only the Opinions one is
     labelled. Lately keeps the raw word.
  3. A section the render empties keeps last night's line exactly, tokens included. Seed a
     previous snapshot whose Interests line contains `⟦2026-01-03|day|UTC⟧` and assert that the
     new snapshot's Interests line is byte-identical.
- [ ] **Step 2: Run and check that they fail.** Run
  `pnpm test tests/mind/process/core/render-snapshot.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `const SECTIONS = ["Lately", "Opinions", "Interests", "Goals", "People", "Habits of speech"] as const;`.
    Build the schema object from it (keep `.strict()`).
  - `const cite = coreCitables([...(narrative ? [narrative] : []), ...opinions, ...interests, ...insights, ...notes], zone);`.
    The input JSON sends `now: nowLine(now, zone, zone)`; `narrative`, `opinions`,
    `interests`, `insights` and `notes` as their `cite.lines` slices (in that order); and
    `goals` and `people` unchanged.
  - `times: noteTimesSchema(SECTIONS.flatMap((s) => range(bounds.max_items).map((i) => `${s} ${i}`)) as [string, ...string[]]).default([])`,
    with `range` as in Task 5.
  - The system is
    `[persona.coreValues, withNoteRules(loadPrompt("core/snapshot", …), config.prompts.core_notes, "core/notes")]`.
  - Replace the `anchorTimes` loop with labelling only the lines the model returned (kept lines
    stay as stored):

```ts
    const fresh: Record<string, string> = {};
    for (const name of SECTIONS)
      result[name].forEach((item, i) => (fresh[`${name} ${i + 1}`] = item.text));
    const note = writeNote(fresh, result.times, cite.items, { now, zone });
    for (const name of SECTIONS)
      if (result[name].length)
        kept[name]!.forEach((item, i) => (item.text = note.fields[`${name} ${i + 1}`]!));
```

    Run this after `kept` is built (a section the model returned is in `kept` as those items).
    Remove the `anchorTimes` import. Trace outputs add `note_dropped: note.dropped`.
- [ ] **Step 4: Prompt v5.** `core/snapshot/v5.md` = v4 with the "copy its date" paragraph
  replaced by:

```markdown
The previous snapshot starts with the day it was written. `times` field names are the section and the line's place in it: "Lately 1" for the first Lately line, "Habits of speech 2" for the second habit.
```

  Delete `v4.md` and bump the key.
- [ ] **Step 5: Run the tests and check that they pass.** Run
  `pnpm test tests/mind/process/core/render-snapshot.test.ts tests/mind/process/core/nightly.test.ts tests/mind/process/core/drift-watch.test.ts`,
  then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add src/mind/process/core/render-snapshot.ts prompts/core/snapshot config/default.json tests/mind/process/core/render-snapshot.test.ts
git commit -m "feat(core): the snapshot labels its new lines' time words and cites memories"
```

---

### Task 7: Delete the Phase 16 parser

**Files:**
- Modify: `src/db/repos/core/memory.ts:4,265-287,575-588`, `src/db/repos/core/index.ts`,
  `src/mind/memory/core/types.ts:6,146-147`, `src/runtime/deps.ts:59`,
  `src/db/reset-self-cli.ts:26`, `evals/lib/runner.ts:398`
- Modify: `src/mind/process/core/runner.ts` (shown dates)
- Modify: `src/mind/platform/time-anchors.ts` (strip the parser), `package.json` (drop
  `chrono-node`, then `pnpm install`)
- Create: `evals/lib/relative-words.ts`. Modify `evals/lib/review.ts`.
- Delete: `tests/exit/phase-16c.test.ts`
- Modify tests: `tests/mind/platform/time-anchors.test.ts`, `tests/db/core-repos.test.ts`
  (910–960), `tests/exit/phase-15c.test.ts` (test 4), `tests/evals/review.test.ts`,
  `tests/mind/platform/render-net.test.ts`, `tests/mind/process/core/runner.test.ts` (274–330)

**Interfaces:**
- Produces: `CoreMemory.insert(item: NewCoreMemory): Promise<string>` stores the content as
  given. `createCoreLayer(db: Db)` and `coreMemoryRepo(db: Db)` take no zone. `LoopContext` has
  no `shown`. `time-anchors.ts` exports only `Precision`, `dateToken`, `ownDate`, `written`,
  `stamped`, `renderTimes`, `renderAbsolute`, `tokenDates`, `isSingleToken`, `nowLine` and
  `formatToken`. `evals/lib/relative-words.ts` exports `relativeWords(text: string): string[]`.

- [ ] **Step 1: Write the failing test.** In `tests/db/core-repos.test.ts`, replace the two tests
  "her memories and snapshots are anchored on her calendar" and "a core row's own date is a date
  its words were shown" with:

```ts
test("her memories and snapshots are stored exactly as written", async () => {
  const layer = core();
  const words = "clear skies tonight, the screening on tuesday";
  const id = await layer.memory.insert({ ...memoryRow(), content: words });
  expect((await layer.memory.get(id))!.content).toBe(words);
});
```

  Use whatever row helper the file already has for a memory. If none exists, copy the object
  from the deleted test.
- [ ] **Step 2: Run it and check that it fails.** Run `pnpm test tests/db/core-repos.test.ts`.
  Expected: FAIL ("tonight" becomes a token).
- [ ] **Step 3: Delete the anchoring.**
  - `memory.ts`: `insert(item)` values are `{ ...item, entity_refs: item.entity_refs ?? [] }`.
    `insertSnapshot` values are `snapshot`. Drop the import and the `zone` parameter of
    `coreMemoryRepo`.
  - `index.ts`: drop `zone` from `scope` and `createCoreLayer`, and from the header comment.
  - The callers `src/runtime/deps.ts`, `src/db/reset-self-cli.ts` and `evals/lib/runner.ts`
    become `createCoreLayer(db)`.
  - `types.ts`: drop the `AnchorHints` import. `insert(item: NewCoreMemory): Promise<string>;`
    with the comment "Stored as written: her loops label their own dates."
  - `runner.ts`: delete `shown` from `LoopContext`, the `llm` wrapper (pass
    `deps: { ...deps, llm: meter.llm }`) and the `memory.insert` override in `commit` (call
    `apply(tx)`). Drop the `tokenDates` import.
  - `time-anchors.ts`: delete `AnchorContext`, `AnchorHints`, `Anchor` (keep it if
    `instant`/`render` still need it: keep `type Anchor = { local: string; precision: Precision; zone: string }`),
    `anchorTimes`, `anchorFields`, `relativeWords`, the chrono import, and every constant and
    function only they use:
    - `COUNT`, `N`, `RELATIVE_WORDS`, `DURATION`, `WEEK`, `WEEKEND`, `RELATIVE`, `WEEKDAY`,
      `OFFSET`, `MONTH_NAMES`, `MONTHS`, `DATE_PHRASE`, `ISO_DATE`, `CLAUSE`, `ORDINAL`,
      `MONTH_ONLY`, `CLOCK`, `LEAD`, `NOUN_AFTER`, `NOUN_BEFORE`, `HABIT_BEFORE`, `PART_HOUR`,
      `WEEKDAYS`, `KEPT`;
    - `mapPlain`, `token`, `count`, `today`, `durations`, `weeks`, `weekends`, `nearestKnown`,
      `pickWeekday`, `explicitWeekday`, `chronoPass`, `FINER`, `merged`, `classify`,
      `classifyDay`.

    Let `pnpm typecheck` and ESLint's no-unused rules find what is left over. Keep `TOKEN`,
    `ONE_TOKEN`, `DAY_MS`, `weekdayOf`, `mondayOf`, `dayDiff`, `instant`, `render`,
    `absolute`, `dayName` and `monthName`.

    Rewrite the header: "Dates, one way. A date is stored as a token holding the day, its
    precision and the zone it was meant in, made by code from a date it holds or from a time
    label a model filled in. A token is rendered only when a prompt reaches a model, on its own
    calendar relative to that moment's now ("yesterday, Sunday 11 January"). Only stored text
    and prompts carry tokens: her messages are never touched."
  - `package.json`: remove `"chrono-node"`, then run `pnpm install`.
  - `evals/lib/relative-words.ts`:

```ts
/**
 * Relative day words left in stored text or a loop's output: the review counts the time words
 * her loops wrote without labelling them. It reads text for the review only, never for storage.
 */
const RELATIVE_WORDS =
  /\b(today|tonight|tomorrow|yesterday|this (?:morning|afternoon|evening|week|weekend)|last night|next week)\b/gi;

export function relativeWords(text: string): string[] {
  return [...text.matchAll(RELATIVE_WORDS)].map((m) => m[1]!.toLowerCase());
}
```

  - `evals/lib/review.ts`: import `relativeWords` from `./relative-words` (and `renderAbsolute`
    still from `@/mind/platform/time-anchors`). The loop-outputs section counts only words the
    output didn't label:

```ts
    const loopSlips = calls
      .map((c) => {
        const { times, ...rest } = (c.output ?? {}) as { times?: { words?: string }[] };
        const labelled = new Set((times ?? []).flatMap((t) => relativeWords(t.words ?? "")));
        const words = relativeWords(JSON.stringify(rest)).filter((w) => !labelled.has(w));
        return { purpose: c.purpose, words };
      })
      .filter((s) => s.words.length);
```

- [ ] **Step 4: Fix the tests that used the parser.**
  - `tests/exit/phase-16c.test.ts`: delete the file. Every test in it asserts parsing.
  - `tests/exit/phase-15c.test.ts`: delete test 4 ("'next monday' said on a Monday…") and its
    imports.
  - `tests/mind/process/core/runner.test.ts`: delete `shownInput` and the tests from line ~274
    that assert `ctx.shown()` or "a loop shown no dates anchors as before".
  - `tests/mind/platform/time-anchors.test.ts`: keep the rendering tests and rewrite their
    inputs with `dateToken` or `formatToken` instead of `anchorTimes`. For example, "relative
    words become the day they meant" becomes
    `formatToken("2026-01-11", "day", "UTC", "yesterday")` read on Monday and on Tuesday, with
    the same expectations. Delete the tests that only check parsing:
    - "a bare weekday takes a date…";
    - "weeks, weekends, offsets…";
    - "a time on a day anchors…";
    - "anchoring twice…";
    - "phrases land where…";
    - "quoted words stay as said";
    - "a long phrase around a date…";
    - "a relative day beside its written-out date…";
    - "ISO dates anchor…";
    - "a part of the day with a clock time…";
    - "a written-out date with a clock time…" (both);
    - "a year after a comma…";
    - "an ISO-shaped string…".

    In "absolute rendering, token dates, single tokens, fields, leftover words", drop the
    `anchorFields` and `relativeWords` lines and build `s` with
    `` `the race ${formatToken("2026-01-13", "day", "UTC")}` ``. The `relativeWords` assertion
    moves to a new `tests/evals/relative-words.test.ts`:
    `expect(relativeWords("Sister visits tomorrow, coming Today.")).toEqual(["tomorrow", "today"]);`.
    The `ownDate(anchorTimes(...))` line becomes
    `ownDate(`The race is ${dateToken(MON, "UTC")}.`, MON, "UTC")`.
  - `tests/mind/platform/render-net.test.ts`:
    `const note = `the race was ${formatToken("2026-01-11", "day", "UTC", "yesterday")}`;`.
    The expectations stay; check that the rendered text still equals
    "the race was 2 days ago, Sunday 11 January". If the `said` form renders as
    "yesterday (that's 2 days ago…)", use `dateToken(new Date("2026-01-11T12:00:00Z"), "UTC")`
    without `said`, giving "the race was 2 days ago, Sunday 11 January".
  - `tests/evals/review.test.ts`: "the review prints anchored text as plain dates" builds
    `content` with `` `Sister visits ${formatToken("2026-01-13", "day", "UTC")}.` ``. Add a test:
    a core call whose output is `{ items: [{ content: "clear tonight" }], times: [{ words: "tonight" }] }`
    produces no "Relative words in her loops" section.
- [ ] **Step 5: Check nothing uses the parser.** Run
  `git grep -n "anchorTimes\|anchorFields\|AnchorHints\|AnchorContext\|chrono\|shown()" -- src evals tests prompts`.
  Expected: no output. Then `git grep -n "copy its date" -- prompts`. Expected: no output.
- [ ] **Step 6: Run the tests and check that they pass.** Run
  `pnpm test tests/db/core-repos.test.ts tests/mind/platform/time-anchors.test.ts tests/mind/platform/render-net.test.ts tests/evals/review.test.ts tests/evals/relative-words.test.ts tests/mind/process/core/runner.test.ts tests/exit/phase-15c.test.ts tests/exit/phase-16.test.ts tests/exit/phase-16b.test.ts tests/mind/memory/core/self.test.ts`,
  then `pnpm typecheck` and `pnpm lint`. Expected: PASS.
- [ ] **Step 7: Commit.**

```bash
git rm tests/exit/phase-16c.test.ts
git add src/db/repos/core/memory.ts src/db/repos/core/index.ts src/mind/memory/core/types.ts src/runtime/deps.ts src/db/reset-self-cli.ts evals/lib/runner.ts src/mind/process/core/runner.ts src/mind/platform/time-anchors.ts package.json pnpm-lock.yaml evals/lib/relative-words.ts evals/lib/review.ts tests/mind/platform/time-anchors.test.ts tests/db/core-repos.test.ts tests/exit/phase-15c.test.ts tests/evals/review.test.ts tests/evals/relative-words.test.ts tests/mind/platform/render-net.test.ts tests/mind/process/core/runner.test.ts
git commit -m "refactor(time): delete the prose date parser; core stores what its loops labelled"
```

---

### Task 8: Phase 17e exit test

**Files:**
- Create: `tests/exit/phase-17e.test.ts`

**Interfaces:**
- Consumes: `coreWander`, `coreRenderSnapshot`, `coreWorldTick`, `runUserMind`, `insertRun`,
  `insertFact`, `CapturingLLM`, and the helpers in `tests/helpers/{db,deps,llm}.ts`.

- [ ] **Step 1: Write the test.** It runs on the fake LLM with a real DB. Copy the `coreDump`
  helper and the user-mind `run` helper from `tests/exit/phase-17d.test.ts`. Header:

```ts
/**
 * Phase 17e exit, all fake (scripted core loops, fake reply, fake guard), real DB: her core loops
 * label their own time words and cite her memories, and code makes both dates; nothing reads her
 * prose for dates. A user's data never reaches a core loop, and a user's run leaves core unchanged.
 */
```

  Tests, each written out in full:
  1. "1: wander's 'tomorrow night' is stored as tomorrow's night, and [m1] as the seed's date".
     Set up like the deleted 16c test 6: a UTC life, a plan for the day, one episode on
     2026-01-06, and the clock on Thu 2026-01-08 09:00Z. Script `core_wander` to return
     `items: [{ kind: "thought", content: "the telescope [m1], again tomorrow night", salience: "low" }]`
     with `times: [{ field: "item_1", words: "tomorrow night", from: "", unit: "day", shift: 1, weekday: null, month: null, day_of_month: null, part: "night", clock: "", span: "at", rough: false }]`.
     Assert:
     - the stored content contains `(⟦2026-01-06|day|UTC⟧)`;
     - it contains a night token for 2026-01-09;
     - `payload.cites` is `[episodeId]`.
  2. "2: an unlabelled weekday stays as written". Script wander with "the screening on tuesday"
     and `times: []`. Assert that the stored content is exactly that text, with no `⟦` in it.
  3. "3: a planned event's thought and a reflected goal carry tokens".
     - Run `coreWorldTick` with a scripted `life_event`: a planned event at 20:00, thought
       "Spica is thinking of rewatching Solaris tonight.", "tonight" labelled. Assert that the
       open intention's content contains the night token for the day.
     - Run `coreReflect` with a goal "Finish the essay by Sunday", "Sunday" labelled under
       `goal_1_title`. Assert that the `core_goal` title contains a token.
  4. "4: the snapshot labels a new line and keeps a kept line byte for byte". Seed a previous
     snapshot with a tokened Interests line. Script the render with `Interests: []` and a
     Lately line with a labelled "this weekend". Assert both.
  5. "5: leak canary: A's data never reaches a core loop; A's run leaves core unchanged".
     - Use `CapturingLLM` as `d.llm`. Insert user A's fact containing `CANARY-17e4c1`.
     - Run user A's user-mind run (the copied `run` helper). Assert that
       `llm.seen.some((c) => c.purpose === "user_summarise" && c.text.includes(TOKEN))` holds,
       and that `coreDump()` is unchanged.
     - Then run `coreWander`, `coreReflect` and `coreRenderSnapshot` (each with what it needs
       to be due: a plan and an episode for wander, an unreflected episode for reflect).
     - Assert that no `llm.seen` entry with a `core_`/`life_` purpose contains the token, and
       that `coreDump()` doesn't contain it.
- [ ] **Step 2: Run it.** Run `pnpm test tests/exit/phase-17e.test.ts`. Expected: PASS (this
  test confirms Tasks 3–7). If one fails, fix the code, not the test, unless the test has a
  setup bug.
- [ ] **Step 3: Commit.**

```bash
git add tests/exit/phase-17e.test.ts
git commit -m "test(exit): Phase 17e exit with a core loop in the leak canary"
```

---

### Task 9: A long-conversation script (B142)

**Files:**
- Create: `evals/scripts/long-conversation.yaml`
- Modify: `package.json` (script `exit:long`)

- [ ] **Step 1: Write the script.** Format: copy `evals/scripts/user-mind-two-weeks.yaml`. Keep
  every value quoted when it has a colon followed by a space.

```yaml
name: long-conversation
description: One user's long evening session (24 turns, a job offer, a sister's visit, a weekend plan) so long_conversation fires, then a lease signed nine days later so consolidate can gist the first week (pnpm exit:long).
profile: none
life: { plan: model, inject: [], until: "day 9 20:00" }
sessions:
  - at: "day 0 19:00"
    turns:
      - "hey, long day"
      - "work was a mess, the client changed the brief again"
      - "third time this month"
      - "anyway I have news"
      - "I got an offer from the studio in Osaka"
      - "they want me to start on the 1st"
      - "I haven't told my manager yet"
      - "I'm telling her tomorrow morning"
      - "kind of dreading it honestly"
      - "she's been good to me"
      - "also my sister is visiting this weekend"
      - "she lands saturday afternoon"
      - "we're going to that ramen place on sunday"
      - "the one with the 40 minute queue"
      - "she doesn't know about osaka yet either"
      - "I want to tell her in person"
      - "do you think she'll be upset"
      - "she always said I'd leave one day"
      - "ok what about you, what did you do today"
      - "that sounds nice"
      - "I should pack soon, I have so much stuff"
      - "like three boxes of just cables"
      - "ok I'm fading, early start tomorrow"
      - "night!"
  - at: "day 9 15:00"
    turns: ["I signed the lease on a tiny place in Osaka!"]
assertions:
  - { type: relationship, after_session: 2, status: active }
```

- [ ] **Step 2: The package script.** In `package.json`, next to `exit:user`:

```json
"exit:long": "tsx --env-file-if-exists=.env evals/run.ts --only long-conversation --runs 1 --review --trace --real labels_read,labels_meaning,labels_signals,user_summarise,user_reflect,user_model,user_ideate,user_consolidate",
```

- [ ] **Step 3: Fake run.** Run
  `pnpm eval --llm=fake --only long-conversation --runs 1 --trace`. Expected: it completes, the
  trace shows a `long_conversation` trigger after day 0's session, and the run passes its
  assertion. If `long_conversation` doesn't fire because each turn gets its own session, check
  that turns within one `at` share the session (`session.idle_gap_minutes` is 30) and report
  what you see rather than changing config.
- [ ] **Step 4: Commit.**

```bash
git add evals/scripts/long-conversation.yaml package.json
git commit -m "feat(evals): a long-conversation script so long_conversation and consolidate run"
```

---

### Task 10: Close

- [ ] **Step 1:** Invoke the `spica-close` skill. It runs, in order:
  - typecheck, lint, the full suite (foreground parts, `--maxWorkers=4`);
  - `pnpm eval --llm=fake --compare`;
  - the leak canary;
  - the `scope-reviewer` agent on the branch diff (tell it not to run tests);
  - the spec write-back (§8.1, §8.3, §8.5 with a "Built 17e" bullet replacing Built 16, 16b and
    16c; §20 Phase 17 row; §25: B132 to history and a new entry for core notes not retired on
    supersede; the full Phase 17 row in `docs/spec-v3-history.md`);
  - CLAUDE.md current phase;
  - `DECISIONS.md` rows for: life_event on role core; core token caps at 8000; core notes prompt
    as its own file; core notes not retired; reflect on m-ids; the snapshot field names;
    the "now" line in core inputs.
- [ ] **Step 2:** The paid close runs go through the `review-run` skill, each with Ethan's go
  first: `pnpm exit:core-day` (the grammar and thinking check, especially reflect),
  `pnpm review:world-outreach`, and `pnpm exit:long`. If reflect is refused for grammar size
  with thinking on, stop and bring Ethan the error. The design doc's fallback is thinking off
  for reflect alone, which needs a per-loop key.
- [ ] **Step 3:** Delete this plan and the 17e design doc once the history row holds them
  (history is in git). Then merge `phase-17e` to `main`.
