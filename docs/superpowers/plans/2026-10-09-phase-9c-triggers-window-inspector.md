# Phase 9c: Triggers, Crisis-Aware User Mind, Window Trim, Inspector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her user mind runs after long talks, after a crisis eases and before a reach-out on a stale picture; crisis memories reach her thinking but never her reach-outs; the reply window forgets turns from before a long gap; users can no longer edit her memory; the inspector shows every user-mind run.

**Architecture:** Three new `Trigger` kinds recorded through the existing `recordBigEvents` + `enqueueUserMindRun` (unique `source_ref` gives "once"). A new hourly `user_mind_tick` job detects `long_conversation` and `crisis_passed` and takes over the pending-run sweep; `outreachTickUser` records `stale_summary`. Sensitivity is a `payload.sensitive` flag carried from input facts to summaries and reflections; ideate and reach-outs read only unflagged items. The window trim is a pure change in `assemblePrompt`.

**Tech Stack:** TypeScript, Next.js App Router (inspector, server components), Drizzle + Postgres, pg-boss, Vitest, zod.

**Spec:** `docs/superpowers/specs/2026-10-09-phase-9c-triggers-window-inspector-design.md` (read it with this plan). Project rules: `CLAUDE.md`, `spica-design-spec-v3.md`.

## Global Constraints

- `src/mind` is framework-free: no Next imports, no `Date.now()`, no `process.env`; time comes from the injected `Clock` / a `now` argument.
- Every numeric constant goes in `config/default.json` and the zod schema in `src/mind/platform/config.ts`.
- Comments say why, never where from: no spec sections, phase names or backlog numbers in code.
- Every file starts with a short plain-English header; match the surrounding comment density.
- Prettier at 100 columns; `pnpm lint` must pass.
- Drizzle domain property names are snake_case.
- No prompt changes in this slice (no prompt version bumps).
- Scope rules: user data never reaches core; users never mix. The leak canary must pass.
- Test DB tests use `resetDb` / `createTestUser` / `makeTestDeps` from `tests/helpers/`.
- Commit after each task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A tick that runs twice in the same hour (or a retried outreach tick with the same `now`) must not record a second run — pinned in Task 5 and Task 6 tests.
2. Crisis text must never reach ideate's input or a reach-out's prompt, including via the summary or a reflection — pinned in Task 3, Task 4 and the exit (Task 8).
3. A reach-out after a gap longer than `window_gap_hours` has no old turns, and the prompt still ends on the reach-out cue — pinned in Task 2.
4. A long conversation inside a crisis window records nothing, and `crisis_passed` then fires after it — pinned in Task 5.
5. A capped `stale_summary` run must not delay the send — pinned in Task 6.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/memory/*` | delete | The "What I remember" page |
| `src/db/repos/user/facts.ts` | modify | Drop `forgetFact`, `listRememberedFacts`; `listFactsForSummary` returns `sensitive` |
| `src/app/chat/page.tsx`, `src/app/settings/page.tsx` | modify | Remove memory links |
| `evals/scripts/forget.yaml`, `evals/lib/script.ts`, `evals/lib/runner.ts`, `evals/baseline.json` | modify/delete | Remove the eval forget step |
| `src/mind/process/hot-path/assemble.ts` | modify | Trim the window at a long gap |
| `src/mind/process/hot-path/compose.ts` | modify | Pass `windowGapHours`; reach-out reads the latest non-sensitive summary |
| `src/mind/memory/user/retrieve.ts` | modify | Export `isSensitive` |
| `src/db/repos/user/user-mind.ts` | modify | New `Trigger` kinds; `latestNonSensitiveSummary` |
| `src/mind/process/user/inputs.ts` | modify | `triggerText` for new kinds; `memoryLines` over a fact list |
| `src/mind/process/user/summarise.ts`, `reflect.ts`, `ideate.ts` | modify | Sensitive marking / filtering |
| `src/db/repos/admin/user-mind.ts` | modify | `adminEndedLongSessions`, `adminCrisisEndedUsers` |
| `src/mind/process/user/tick.ts` | create | `userMindTick` |
| `src/mind/process/cold-path/sweep.ts` | modify | Stop sweeping user-mind runs |
| `src/mind/platform/jobs.ts`, `src/worker/user-mind-jobs.ts` | modify | `user_mind_tick` queue and schedule |
| `src/mind/process/outreach/tick.ts` | modify | `stale_summary` + send lead |
| `src/db/repos/admin/inspector.ts` | modify | `listUserMindRuns` |
| `src/app/inspector/[userId]/tabs.tsx`, `page.tsx` | modify | `MindTab` |
| `src/mind/platform/config.ts`, `config/default.json` | modify | New keys |
| `tests/exit/phase-9c.test.ts` | create | Phase exit + crisis canary |

---

### Task 1: Remove "What I remember" and per-fact forget

**Files:**
- Delete: `src/app/memory/page.tsx`, `src/app/memory/actions.ts`, `src/app/memory/forget-button.tsx`, `src/app/memory/memory.module.css`
- Delete: `evals/scripts/forget.yaml`
- Modify: `src/db/repos/user/facts.ts` (remove `forgetFact` at ~line 279 and `listRememberedFacts`, plus imports only they used)
- Modify: `src/app/chat/page.tsx:23-25`, `src/app/settings/page.tsx:24-26`
- Modify: `evals/lib/script.ts:49`, `evals/lib/runner.ts:23,581-586`, `evals/baseline.json:162-166`
- Modify: `src/db/repos/admin/inspector.ts:119` (comment)
- Modify tests: `tests/db/memory-repos.test.ts`, `tests/db/user-mind-repos.test.ts`, `tests/db/inspector.test.ts`, `tests/mind/memory/user/encode.test.ts`, `tests/mind/process/hot-path/compose.test.ts`, `tests/mind/process/user/summarise.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `forgetFact` and `listRememberedFacts` no longer exist. Tests that need a vanished fact use a direct delete:
  ```ts
  await getTestDb().delete(fact).where(eq(fact.id, id)); // fact from "@/db/schema", eq from "drizzle-orm"
  ```

- [ ] **Step 1: Delete the page, the eval script and the repo functions**

```bash
git rm -r src/app/memory evals/scripts/forget.yaml
```

In `src/db/repos/user/facts.ts` delete the whole `listRememberedFacts` function and the whole `forgetFact` function with its doc comments. Remove any import that becomes unused (`thread` from schema and `z` may still be used elsewhere in the file — let `pnpm typecheck`/`pnpm lint` tell you).

- [ ] **Step 2: Remove the links**

`src/app/chat/page.tsx` — delete:
```tsx
        <Link href="/memory" className={styles.settings}>
          Memory
        </Link>
```
`src/app/settings/page.tsx` — delete:
```tsx
        <p>
          <Link href="/memory">What Spica remembers about you</Link>
        </p>
```

- [ ] **Step 3: Remove the eval forget step**

`evals/lib/script.ts`: delete the line `forget: z.array(z.string().min(1)).default([]),`.
`evals/lib/runner.ts`: change the import to `import { insertFact } from "@/db/repos/user/facts";` (keep any other names already imported there) and delete:
```ts
      for (const needle of s.forget) {
        for (const f of await listRememberedFacts(db, userId)) {
          if (f.content.toLowerCase().includes(needle.toLowerCase()))
            await forgetFact(db, userId, f.id);
        }
      }
```
`evals/baseline.json`: delete the `"forget": { ... },` entry.

- [ ] **Step 4: Fix the inspector comment**

`src/db/repos/admin/inspector.ts:119` — replace the sentence `A missing id was hard-deleted since (\`forgetFact\`) — the caller shows "(deleted)".` with `A missing id was deleted since (the account was deleted mid-read) — the caller shows "(deleted)".`

- [ ] **Step 5: Update tests**

- `tests/db/memory-repos.test.ts`: delete the tests `"forgetFact deletes an orphaned thread but keeps a thread other facts still reference"`, `"forgetFact is scoped and malformed-safe"`, `"listRememberedFacts: user subject, active, private, newest first"`, `"listRememberedFacts: also the live summary, so the user can see and delete it"`. At line ~89 replace `await facts.forgetFact(db(), u, f2.id);` with `await db().delete(s.fact).where(eq(s.fact.id, f2.id));` (import `eq` from `drizzle-orm` if absent).
- `tests/mind/memory/user/encode.test.ts:285`: replace `await facts.forgetFact(db(), u, gone.id);` with `await db().delete(fact).where(eq(fact.id, gone.id));` (import `fact` from `@/db/schema`, `eq` from `drizzle-orm` as needed); rename the test's `"skips forgotten facts"` wording to `"skips deleted facts"`.
- `tests/db/user-mind-repos.test.ts`: delete test `"the memory view lists reflections and ideas"`; drop `listRememberedFacts` from the import.
- `tests/db/inspector.test.ts:120`: replace `expect(await forgetFact(getTestDb(), a, f.id)).toBe(true);` with `await getTestDb().delete(fact).where(eq(fact.id, f.id));` and fix imports.
- `tests/mind/process/hot-path/compose.test.ts:422`: replace `await forgetFact(getTestDb(), u, summary.id);` with `await getTestDb().delete(fact).where(eq(fact.id, summary.id));` and fix imports (check for a local variable named `fact` that would shadow the schema import; alias as `factTable` if so). Rename the test `"... goes when forgotten, and skips a crisis"` to `"... goes when deleted, and skips a crisis"`.
- `tests/mind/process/user/summarise.test.ts`: delete the test `"after the user deletes the summary, the next run writes a fresh one"`; drop `forgetFact` from the import.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass; `grep -rn "forgetFact\|listRememberedFacts\|/memory\"" src tests evals --include=*.ts --include=*.tsx` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat!: remove the memory view; users can't edit her memory

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Trim the reply window at a long gap

**Files:**
- Modify: `src/mind/process/hot-path/assemble.ts` (`AssembleInput`, `conversationMessages`)
- Modify: `src/mind/process/hot-path/compose.ts:~301` (pass the key)
- Modify: `src/mind/platform/config.ts` (`chat`), `config/default.json` (`chat`)
- Test: `tests/mind/process/hot-path/assemble.test.ts`

**Interfaces:**
- Produces: `AssembleInput.windowGapHours?: number` — turns before the latest gap of at least this many hours are left out. Config `chat.window_gap_hours` (72).

- [ ] **Step 1: Write the failing tests** (append inside `describe("time-gap markers in the message window", ...)` in `tests/mind/process/hot-path/assemble.test.ts`)

```ts
  test("turns before the latest gap of at least windowGapHours are left out", () => {
    const p = assemblePrompt({
      ...base,
      gapMarkerMinHours: 24,
      windowGapHours: 72,
      recentTurns: [
        { role: "user", text: "old news", created_at: at("2026-01-01T09:00:00Z") },
        { role: "companion", text: "old reply", created_at: at("2026-01-01T09:00:05Z") },
        { role: "user", text: "two days on", created_at: at("2026-01-03T09:00:00Z") },
        { role: "companion", text: "hey", created_at: at("2026-01-03T09:00:05Z") },
        { role: "user", text: "back after a week", created_at: at("2026-01-10T09:00:00Z") },
      ],
    });
    expect(p.messages.map((m) => m.content)).toEqual(["back after a week"]);
  });
  test("a gap under windowGapHours keeps the old turns and the marker", () => {
    const p = assemblePrompt({
      ...base,
      gapMarkerMinHours: 24,
      windowGapHours: 72,
      recentTurns: [
        { role: "user", text: "a", created_at: at("2026-01-01T09:00:00Z") },
        { role: "companion", text: "b", created_at: at("2026-01-01T09:00:05Z") },
        { role: "user", text: "c", created_at: at("2026-01-03T09:00:00Z") },
      ],
    });
    expect(p.messages.map((m) => m.content)).toEqual(["a", "b", "[2 days later] c"]);
  });
  test("a reach-out after a long gap has no old turns and still ends on its cue", () => {
    const p = assemblePrompt({
      ...base,
      windowGapHours: 72,
      now: at("2026-01-10T09:00:00Z"),
      recentTurns: [
        { role: "user", text: "old", created_at: at("2026-01-01T09:00:00Z") },
        { role: "companion", text: "older reply", created_at: at("2026-01-01T09:00:05Z") },
      ],
      reachOut: { slot: "why", cue: "CUE" },
    });
    expect(p.messages).toEqual([{ role: "user", content: "CUE" }]);
  });
```

Note: the third test needs the trim to also apply relative to `now` when the last turn is older than the gap (a reach-out answers no turn). Implement it that way: treat `now` as the end of the window.

Check the exact marker text the existing `elapsed()` produces for 48 h (the existing test shows `"[7 days later]"`); if it renders `"[2 days later]"` for 48 h keep the expectation, else adjust it to what `elapsed(48)` returns.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/mind/process/hot-path/assemble.test.ts`
Expected: the three new tests FAIL (old turns still present).

- [ ] **Step 3: Implement**

In `AssembleInput`, under `gapMarkerMinHours`:
```ts
  /**
   * Leaves out turns from before the latest gap of at least this many hours (the gap to `now`
   * counts too). After days apart the old transcript is stale; deep memory carries what matters.
   */
  windowGapHours?: number;
```
Replace the first two lines of `conversationMessages`:
```ts
function conversationMessages(input: AssembleInput): ChatMessage[] {
  const window = sinceLongGap(input);
  const firstUser = window.findIndex((t) => t.role === "user");
  const turns = firstUser === -1 ? [] : window.slice(firstUser);
```
and add below it:
```ts
/** The turns after the latest gap of at least `windowGapHours`, counting the gap up to now. */
function sinceLongGap(input: AssembleInput): AssembleInput["recentTurns"] {
  const turns = input.recentTurns;
  if (input.windowGapHours === undefined) return turns;
  const minGap = input.windowGapHours * HOUR;
  const last = turns.at(-1)?.created_at;
  if (last && input.now.getTime() - last.getTime() >= minGap) return [];
  for (let i = turns.length - 1; i > 0; i--) {
    const at = turns[i]!.created_at;
    const before = turns[i - 1]!.created_at;
    if (at && before && at.getTime() - before.getTime() >= minGap) return turns.slice(i);
  }
  return turns;
}
```
Careful: a normal reply's last turn is the user's message, created moments before `now`, so the `now` check never trims a live reply.

`src/mind/platform/config.ts` `chat`: add `window_gap_hours: z.number().positive(),`.
`config/default.json` `chat`: add `"window_gap_hours": 72,` after `"gap_line_min_hours": 24,`.
`src/mind/process/hot-path/compose.ts` in the `assemblePrompt({...})` call, after `gapMarkerMinHours: config.chat.gap_line_min_hours,` add `windowGapHours: config.chat.window_gap_hours,`.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/mind/process/hot-path tests/mind/process/outreach`
Expected: PASS. If an existing compose/outreach test seeds turns more than 72 h before the clock and asserts they appear in the prompt, move its turns inside 72 h (the behaviour change is intended).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(reply): leave out turns from before a gap of three days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Crisis memories in the user mind, marked forward

**Files:**
- Modify: `src/db/repos/user/facts.ts` (`listFactsForSummary`)
- Modify: `src/mind/memory/user/retrieve.ts:48` (export `isSensitive`)
- Modify: `src/db/repos/user/user-mind.ts` (add `latestNonSensitiveSummary`)
- Modify: `src/mind/process/user/inputs.ts`, `summarise.ts`, `reflect.ts`, `ideate.ts`
- Test: `tests/mind/process/user/summarise.test.ts`, `reflect.test.ts`, `ideate.test.ts`, `tests/db/user-mind-repos.test.ts`

**Interfaces:**
- Produces:
  - `listFactsForSummary(...)` rows gain `sensitive: boolean`; sensitive facts are no longer filtered out.
  - `export function isSensitive(fact: { payload: unknown }): boolean` from `@/mind/memory/user/retrieve`.
  - `export async function latestNonSensitiveSummary(db: Db, userId: string): Promise<FactRow | null>` in `@/db/repos/user/user-mind` — the newest `summary` fact (any status) whose payload isn't sensitive.
  - `memoryLines(facts: RunInputs["facts"])` (was `memoryLines(inputs)`).
  - A summary's payload is `{ where_things_stand, whats_live, how_i_feel, sensitive?: true }`; a reflection's payload is `{ sensitive: true }` or null.

- [ ] **Step 1: Write the failing tests**

Look at the existing `setup()` helpers at the top of `summarise.test.ts`, `reflect.test.ts` and `ideate.test.ts` (each has a `fact(content, salience)` inserter and a `run(sourceRef)` maker); add a `sensitive` option to the inserter in each file by passing `payload: { sensitive: true }` to `insertFact`. Then add:

`tests/mind/process/user/summarise.test.ts`:
```ts
test("a sensitive memory reaches summarise and marks the summary, and the mark carries forward", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They said they'd been thinking of ending it.", 0.9, { sensitive: true });
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  const input = deps.llm.calls.filter((c) => c.purpose === "user_summarise").at(-1)!.input;
  expect(input).toContain("thinking of ending it");
  const first = (await liveSummary(deps.db, userId))!;
  expect(first.payload).toMatchObject({ sensitive: true });

  await fact("They started a pottery class.", 0.9);
  await userSummarise(deps, await run("exchange:b"), await loadRunInputs(deps, userId));
  const second = (await liveSummary(deps.db, userId))!;
  expect(second.id).not.toBe(first.id);
  expect(second.payload).toMatchObject({ sensitive: true });
});

test("a summary from ordinary memories is not marked", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They started a pottery class.", 0.9);
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  expect((await liveSummary(deps.db, userId))!.payload).not.toHaveProperty("sensitive");
});
```

`tests/mind/process/user/reflect.test.ts`:
```ts
test("a reflection that read a sensitive memory is marked", async () => {
  const { deps, userId, fact, run } = await setup();
  deps.llm.handlers.user_reflect = () => ({ reflection: "They carry more than they show.", subject: "user" });
  await fact("They said they'd been thinking of ending it.", 0.9, { sensitive: true });
  const r = await run("exchange:a");
  await userReflect(deps, r, await loadRunInputs(deps, userId));
  const [row] = await recentReflections(deps.db, userId, 1);
  expect(row!.payload).toMatchObject({ sensitive: true });
});
```

`tests/mind/process/user/ideate.test.ts`:
```ts
test("ideate never sees a sensitive memory, summary or reflection", async () => {
  const { deps, userId, fact, run } = await setup();
  deps.llm.handlers.user_reflect = () => ({ reflection: "SECRET-REFLECTION", subject: "user" });
  await fact("SECRET-FACT thinking of ending it", 0.9, { sensitive: true });
  await fact("They started a pottery class.", 0.8);
  const r = await run("exchange:a");
  const inputs = await loadRunInputs(deps, userId);
  await userSummarise(deps, r, inputs);
  await userReflect(deps, r, inputs);
  await userIdeate(deps, r, inputs);
  const input = deps.llm.calls.filter((c) => c.purpose === "user_ideate").at(-1)!.input;
  expect(input).not.toContain("SECRET");
  expect(input).toContain("pottery");
  // The live summary read the sensitive fact, so ideate gets no summary at all here.
  expect(JSON.parse(input).summary).toBeNull();
});
```
(If the fake `user_summarise` handler echoes its input into the summary text, the summary would carry `SECRET-FACT` — that's exactly what the `summary: null` assertion guards. Adjust the imports for `userSummarise`, `userReflect`, `loadRunInputs` as the file needs.)

`tests/db/user-mind-repos.test.ts` (reuse the file's `put(u, kind, at)` helper; extend it to take an optional payload if it doesn't):
```ts
test("latestNonSensitiveSummary skips sensitive summaries, live or not", async () => {
  const u = await createTestUser();
  const plain = await put(u, "summary", T0);
  await getTestDb().update(fact).set({ status: "superseded" }).where(eq(fact.id, plain.id));
  await put(u, "summary", new Date(T0.getTime() + 60_000), { sensitive: true });
  expect((await latestNonSensitiveSummary(getTestDb(), u))?.id).toBe(plain.id);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/mind/process/user tests/db/user-mind-repos.test.ts`
Expected: new tests FAIL (sensitive facts filtered out; `latestNonSensitiveSummary` missing).

- [ ] **Step 3: Implement**

`src/db/repos/user/facts.ts` `listFactsForSummary`: update the doc comment's last sentence to add `Sensitive memories are included and flagged; each loop decides what it may read.`; add to the select:
```ts
      sensitive: sql<boolean>`COALESCE((${fact.payload}->>'sensitive')::boolean, false)`,
```
and delete the `sql\`COALESCE((${fact.payload}->>'sensitive')::boolean, false) = false\`,` condition.

`src/mind/memory/user/retrieve.ts`: `function isSensitive` → `export function isSensitive`.

`src/db/repos/user/user-mind.ts`, after `liveSummary`:
```ts
/** The newest summary that read nothing sensitive, live or superseded: what a reach-out may use. */
export async function latestNonSensitiveSummary(db: Db, userId: string): Promise<FactRow | null> {
  const rows = await db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, "summary"),
        sql`COALESCE((${fact.payload}->>'sensitive')::boolean, false) = false`,
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(1);
  return rows[0] ?? null;
}
```

`src/mind/process/user/inputs.ts`: update the header to mention sensitive memories (`Sensitive memories are included and flagged; ideate and reach-outs never read them.`) and change `memoryLines`:
```ts
/** The memories as a loop's prompt shows them. */
export function memoryLines(facts: RunInputs["facts"]) {
  return facts.map(({ subject, kind, content }) => ({ subject, kind, content }));
}
```

`summarise.ts`: `new_memories: memoryLines(facts),`; before the transaction:
```ts
    // What a crisis told her stays out of anything a reach-out reads, and a summary carries its
    // previous one forward.
    const sensitive = facts.some((f) => f.sensitive) || (!!previous && isSensitive(previous));
```
and in `insertFact`: `payload: sensitive ? { ...out, sensitive: true } : out,`. Import `isSensitive` from `@/mind/memory/user/retrieve`.

`reflect.ts`: `new_memories: memoryLines(inputs.facts),`; before the insert:
```ts
      const sensitive =
        inputs.facts.some((f) => f.sensitive) || (!!summary && isSensitive(summary));
```
and add `payload: sensitive ? { sensitive: true } : null,` to `insertFact`.

`ideate.ts`:
```ts
    // Ideas can become reach-outs and push notifications, so ideate never reads a crisis.
    const facts = inputs.facts.filter((f) => !f.sensitive);
    const summary = await latestNonSensitiveSummary(db, userId);
    const [latest] = await recentReflections(db, userId, 1);
    const noticed =
      latest && latest.created_at >= run.created_at && !isSensitive(latest) ? latest : null;
```
Then `new_memories: memoryLines(facts),` and trace `fact_ids: facts.map((f) => f.id),`. The ideate test asserts `summary: null` when the only summary is sensitive — but `latestNonSensitiveSummary` returns an older non-sensitive one if it exists; in the test there is none, so `null` holds.

Update each loop file's header comment if it describes what the loop reads (one clause each).

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/mind/process/user tests/db/user-mind-repos.test.ts tests/exit/phase-9a.test.ts tests/exit/phase-9b.test.ts tests/exit/mind-split.test.ts`
Expected: PASS. A pre-existing test asserting sensitive facts are excluded from summarise input must be inverted (they are now included) — that's the decided behaviour change.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(user-mind): crisis memories reach summarise and reflect, marked sensitive; ideate never reads them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A reach-out reads the latest non-sensitive summary

**Files:**
- Modify: `src/mind/process/hot-path/compose.ts:~229-240`
- Test: `tests/mind/process/hot-path/compose.test.ts`

**Interfaces:**
- Consumes: `latestNonSensitiveSummary` (Task 3).

- [ ] **Step 1: Write the failing test**

Add to the `describe("composeReachOut", ...)` block in `tests/mind/process/hot-path/compose.test.ts` (it already has `userTurn`, `insertFact`, `vec`, `getTestDb` in scope):

```ts
  test("a reach-out reads the newest summary that isn't sensitive; a reply reads the live one", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turn = await userTurn(deps, u, "night!");
    const summary = (stand: string, sensitive: boolean, at: Date) =>
      insertFact(getTestDb(), u, {
        subject: "shared",
        kind: "summary",
        content: stand,
        payload: {
          where_things_stand: stand,
          whats_live: "L.",
          how_i_feel: "F.",
          ...(sensitive ? { sensitive: true } : {}),
        },
        embedding: vec(),
        created_at: at,
        status: sensitive ? "open" : "superseded",
        salience: 0.6,
        valence: 0,
        confidence: 0.7,
        source: "generated",
      });
    await summary("Plain stand.", false, new Date(deps.clock.now().getTime() - 60_000));
    await summary("Crisis stand.", true, deps.clock.now());

    await composeReachOut(
      deps,
      u,
      { kind: "check_in", text: "", factId: null, threadId: null, coreMemoryId: null },
      [turn],
    );
    const reachOut = deps.llm.calls.at(-1)!.system;
    expect(reachOut).toContain("Plain stand.");
    expect(reachOut).not.toContain("Crisis stand.");

    await composeReply(deps, u, { turns: [turn], openQuestions: [], flag: null });
    expect(deps.llm.calls.at(-1)!.system).toContain("Crisis stand.");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/mind/process/hot-path/compose.test.ts`
Expected: FAIL — the reach-out shows "Crisis stand.".

- [ ] **Step 3: Implement**

In `compose.ts` replace the summary loader body:
```ts
        async (): Promise<AssembleInput["summary"]> => {
          // A reach-out can surface as a push notification, so it never reads a crisis.
          const row = input.reachOut
            ? await latestNonSensitiveSummary(db, userId)
            : await liveSummary(db, userId);
          const parsed = summaryPayload.safeParse(row?.payload);
          return parsed.success ? parsed.data : null;
        },
```
Import `latestNonSensitiveSummary` alongside `liveSummary`.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/mind/process/hot-path`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(reach-out): read the newest summary that isn't sensitive

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `user_mind_tick`: long conversations and passed crises

**Files:**
- Modify: `src/db/repos/user/user-mind.ts` (`Trigger`)
- Modify: `src/mind/process/user/inputs.ts` (`triggerText`)
- Modify: `src/db/repos/admin/user-mind.ts`
- Create: `src/mind/process/user/tick.ts`
- Modify: `src/mind/process/cold-path/sweep.ts` (remove the user-mind sweep)
- Modify: `src/mind/platform/jobs.ts`, `src/worker/user-mind-jobs.ts`
- Modify: `src/mind/platform/config.ts` (`userMind`), `config/default.json` (`user_mind`)
- Test: `tests/mind/process/user/tick.test.ts` (create), `tests/mind/process/cold-path/sweep.test.ts` if it asserts the user-mind sweep

**Interfaces:**
- Produces:
  - `Trigger` adds `| { kind: "long_conversation"; session_id: string; user_turns: number } | { kind: "crisis_passed" } | { kind: "stale_summary"; age_hours: number | null }`.
  - `adminEndedLongSessions(db, { endedAfter: Date; endedBefore: Date; minUserTurns: number; limit: number }): Promise<{ user_id: string; session_id: string; user_turns: number }[]>`
  - `adminCrisisEndedUsers(db, { after: Date; until: Date; limit: number }): Promise<{ user_id: string; crisis_quiet_until: Date }[]>`
  - `userMindTick(deps: Deps, now: Date): Promise<{ recorded: number; failed: number }>` from `@/mind/process/user/tick`
  - `USER_MIND_TICK_QUEUE = "user_mind_tick"` in jobs.ts
  - Config: `user_mind.tick.{cron, lookback_hours}`, `user_mind.triggers.long_conversation.{min_user_turns, quiet_minutes}`, `user_mind.triggers.stale_summary.{max_age_hours, lead_minutes}` (stale_summary used in Task 6; add it here so config lands once).

- [ ] **Step 1: Config**

`src/mind/platform/config.ts` `userMind`:
```ts
  tick: z.object({ cron: text, lookback_hours: z.number().positive() }),
  triggers: z.object({
    param_jump: unit,
    bands: z.array(unit).min(1),
    fact_salience: unit,
    long_conversation: z.object({ min_user_turns: positiveInt, quiet_minutes: countFromZero }),
    stale_summary: z.object({ max_age_hours: z.number().positive(), lead_minutes: countFromZero }),
  }),
```
(`text` is the schema helper already used for cron strings elsewhere in the file; if it's named differently, use the same one `relationship.tick_cron` uses.)

`config/default.json` `user_mind`:
```json
    "tick": { "cron": "25 * * * *", "lookback_hours": 24 },
    "triggers": {
      "param_jump": 0.15,
      "bands": [0.25, 0.5, 0.75],
      "fact_salience": 0.8,
      "long_conversation": { "min_user_turns": 20, "quiet_minutes": 30 },
      "stale_summary": { "max_age_hours": 72, "lead_minutes": 5 }
    },
```

- [ ] **Step 2: Trigger kinds and their words**

`src/db/repos/user/user-mind.ts`:
```ts
export type Trigger =
  | { kind: "param_jump" | "param_band"; param: string; from: number; to: number }
  | { kind: "salient_fact"; salience: number }
  | { kind: "make_up_done" }
  | { kind: "long_conversation"; session_id: string; user_turns: number }
  | { kind: "crisis_passed" }
  | { kind: "stale_summary"; age_hours: number | null };
```
`src/mind/process/user/inputs.ts` `triggerText`, add cases:
```ts
    case "long_conversation":
      return "you two just had a long conversation";
    case "crisis_passed":
      return "they went through something hard, and it has eased";
    case "stale_summary":
      return "you're about to write to them and haven't taken stock in a while";
```

- [ ] **Step 3: Write the failing tests** — `tests/mind/process/user/tick.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import { relationship } from "@/db/schema";
import { USER_MIND_RUN_QUEUE } from "@/mind/platform/jobs";
import { recordBigEvents } from "@/mind/process/user/run";
import { userMindTick } from "@/mind/process/user/tick";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T15:25:00Z");
const MIN = 60_000;

async function setup() {
  const deps = makeTestDeps({
    user_mind: { triggers: { long_conversation: { min_user_turns: 3, quiet_minutes: 30 } } },
  });
  deps.clock.set(now);
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, now, deps.config.relationship);
  return { deps, u };
}

/** A session of `userTurns` user turns (each answered), its last turn `endedMinutesAgo`. */
async function session(u: string, userTurns: number, endedMinutesAgo: number) {
  const sessionId = randomUUID();
  const end = now.getTime() - endedMinutesAgo * MIN;
  for (let i = 0; i < userTurns; i++) {
    const at = end - (userTurns - i) * 2 * MIN;
    await insertTurn(getTestDb(), u, {
      id: randomUUID(), session_id: sessionId, role: "user", text: `u${i}`, created_at: new Date(at),
    });
    await insertTurn(getTestDb(), u, {
      id: randomUUID(), session_id: sessionId, role: "companion", text: `c${i}`,
      created_at: new Date(at + 2 * MIN > end ? end : at + MIN),
    });
  }
  return sessionId;
}
const runs = async () =>
  (await getTestDb().execute(sql`SELECT source_ref, status, triggers FROM user_mind_run`)).rows;

test("a long conversation that has gone quiet fires once, even when the tick reruns", async () => {
  const { deps, u } = await setup();
  const sid = await session(u, 3, 45);
  expect(await userMindTick(deps, now)).toEqual({ recorded: 1, failed: 0 });
  expect(await userMindTick(deps, now)).toEqual({ recorded: 0, failed: 0 });
  expect(await runs()).toEqual([
    {
      source_ref: `long_conversation:${sid}`,
      status: "pending",
      triggers: [{ kind: "long_conversation", session_id: sid, user_turns: 3 }],
    },
  ]);
  expect(deps.queue.jobs.filter((j) => j.name === USER_MIND_RUN_QUEUE)).toHaveLength(1);
});

test("short, still-going, or too-old conversations fire nothing", async () => {
  const { deps, u } = await setup();
  await session(u, 2, 45); // too short
  await session(u, 3, 10); // not quiet yet
  await session(u, 3, 25 * 60); // ended before the lookback
  expect(await userMindTick(deps, now)).toEqual({ recorded: 0, failed: 0 });
});

test("an ended relationship fires nothing", async () => {
  const { deps, u } = await setup();
  await session(u, 3, 45);
  await getTestDb().update(relationship).set({ status: "ended_by_user" }).where(eq(relationship.user_id, u));
  expect((await userMindTick(deps, now)).recorded).toBe(0);
});

test("a long conversation inside a crisis window fires nothing; the crisis passing does, once", async () => {
  const { deps, u } = await setup();
  await session(u, 3, 45);
  const quietUntil = new Date(now.getTime() + 60 * MIN);
  await getTestDb().update(relationship).set({ crisis_quiet_until: quietUntil }).where(eq(relationship.user_id, u));
  expect((await userMindTick(deps, now)).recorded).toBe(0);

  const later = new Date(quietUntil.getTime() + 10 * MIN);
  deps.clock.set(later);
  expect(await userMindTick(deps, later)).toEqual({ recorded: 2, failed: 0 }); // the talk, then the crisis
  expect(await userMindTick(deps, later)).toEqual({ recorded: 0, failed: 0 });
  const refs = (await runs()).map((r) => r.source_ref).sort();
  expect(refs).toContain(`crisis_passed:${quietUntil.toISOString()}`);
});

test("a crisis that ended before the lookback fires nothing", async () => {
  const { deps, u } = await setup();
  await getTestDb()
    .update(relationship)
    .set({ crisis_quiet_until: new Date(now.getTime() - 25 * 60 * MIN) })
    .where(eq(relationship.user_id, u));
  expect((await userMindTick(deps, now)).recorded).toBe(0);
});

test("the tick re-queues pending runs whose job was lost", async () => {
  const { deps, u } = await setup();
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", [{ kind: "make_up_done" }]))!;
  const later = new Date(now.getTime() + 11 * MIN);
  await userMindTick(deps, later);
  expect(deps.queue.jobs).toContainEqual({ name: USER_MIND_RUN_QUEUE, data: { runId } });
});
```
Note on the "inside a crisis window" test: at `later` the session ended 45 + 70 min ago — still inside the 24 h lookback, now outside the crisis window, so it fires then. That is intended: the talk still deserves its run.

- [ ] **Step 4: Run to verify they fail**

Run: `pnpm vitest run tests/mind/process/user/tick.test.ts`
Expected: FAIL — module `@/mind/process/user/tick` not found.

- [ ] **Step 5: Admin queries** — append to `src/db/repos/admin/user-mind.ts` (update its header to `Cross-user: what the user mind's hourly tick scans for, and pending runs whose job was lost.`; add `sql` and `relationship` imports)

```ts
/** Sessions with at least `minUserTurns` user turns whose last turn falls in the window. */
export async function adminEndedLongSessions(
  db: Db,
  opts: { endedAfter: Date; endedBefore: Date; minUserTurns: number; limit: number },
): Promise<{ user_id: string; session_id: string; user_turns: number }[]> {
  const after = opts.endedAfter.toISOString();
  const before = opts.endedBefore.toISOString();
  const res = await db.execute(sql`
    SELECT user_id, session_id, count(*) FILTER (WHERE role = 'user')::int AS user_turns
    FROM session_log
    WHERE session_id IN (
      SELECT DISTINCT session_id FROM session_log WHERE created_at > ${after}::timestamptz
    )
    GROUP BY user_id, session_id
    HAVING max(created_at) > ${after}::timestamptz
      AND max(created_at) <= ${before}::timestamptz
      AND count(*) FILTER (WHERE role = 'user') >= ${opts.minUserTurns}
    ORDER BY max(created_at)
    LIMIT ${opts.limit}`);
  return res.rows as { user_id: string; session_id: string; user_turns: number }[];
}

/** Users whose stored crisis window ended in `(after, until]`. */
export async function adminCrisisEndedUsers(
  db: Db,
  opts: { after: Date; until: Date; limit: number },
): Promise<{ user_id: string; crisis_quiet_until: Date }[]> {
  const rows = await db
    .select({ user_id: relationship.user_id, crisis_quiet_until: relationship.crisis_quiet_until })
    .from(relationship)
    .where(
      and(
        gt(relationship.crisis_quiet_until, opts.after),
        lte(relationship.crisis_quiet_until, opts.until),
      ),
    )
    .limit(opts.limit);
  return rows as { user_id: string; crisis_quiet_until: Date }[];
}
```

- [ ] **Step 6: The tick** — create `src/mind/process/user/tick.ts`

```ts
/**
 * The hourly `user_mind_tick`: the big events no single exchange shows. A long conversation that
 * has gone quiet, and a crisis whose quiet window has ended. Each is recorded once (its source
 * names the session or the window's end), and runs whose job was lost are re-queued.
 */
import {
  adminCrisisEndedUsers,
  adminEndedLongSessions,
} from "@/db/repos/admin/user-mind";
import { getRelationshipRow } from "@/db/repos/user/relationship";
import type { Trigger } from "@/db/repos/user/user-mind";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { HOUR, MINUTE } from "@/mind/platform/time";
import { effectiveCrisisQuietUntil } from "@/mind/process/outreach/inputs";
import { enqueueUserMindRun, recordBigEvents, sweepPendingUserMindRuns } from "./run";

export async function userMindTick(
  deps: Deps,
  now: Date,
): Promise<{ recorded: number; failed: number }> {
  const { db, config, log } = deps;
  const settings = config.user_mind;
  const since = new Date(now.getTime() - settings.tick.lookback_hours * HOUR);
  let recorded = 0;
  let failed = 0;
  const each = async (userId: string, step: () => Promise<boolean>) => {
    try {
      if (await step()) recorded++;
    } catch (e) {
      failed++;
      log.error("user_mind_tick user failed", { userId, error: errorName(e) });
    }
  };

  const long = settings.triggers.long_conversation;
  const sessions = await adminEndedLongSessions(db, {
    endedAfter: since,
    endedBefore: new Date(now.getTime() - long.quiet_minutes * MINUTE),
    minUserTurns: long.min_user_turns,
    limit: config.cold_path.sweep_batch,
  });
  for (const s of sessions)
    await each(s.user_id, async () => {
      const rel = await getRelationshipRow(db, s.user_id);
      if (!rel || rel.status === "ended_by_user") return false;
      // Inside a crisis every mechanism waits; the talk gets its run once the window ends.
      const quietUntil = await effectiveCrisisQuietUntil(deps, s.user_id, rel.crisis_quiet_until, now);
      if (quietUntil && quietUntil > now) return false;
      return record(deps, s.user_id, `long_conversation:${s.session_id}`, [
        { kind: "long_conversation", session_id: s.session_id, user_turns: s.user_turns },
      ]);
    });

  const crises = await adminCrisisEndedUsers(db, {
    after: since,
    until: now,
    limit: config.cold_path.sweep_batch,
  });
  for (const c of crises)
    await each(c.user_id, async () => {
      const rel = await getRelationshipRow(db, c.user_id);
      if (!rel || rel.status === "ended_by_user") return false;
      return record(deps, c.user_id, `crisis_passed:${c.crisis_quiet_until.toISOString()}`, [
        { kind: "crisis_passed" },
      ]);
    });

  await sweepPendingUserMindRuns(deps, now);
  return { recorded, failed };
}

/** True when a new pending run was recorded (not a repeat, not capped). */
async function record(deps: Deps, userId: string, sourceRef: string, triggers: Trigger[]) {
  const runId = await recordBigEvents(deps, deps.db, userId, sourceRef, triggers);
  if (runId) await enqueueUserMindRun(deps, runId);
  return runId !== null;
}
```
Check `HOUR` exists in `@/mind/platform/time` (MINUTE and DAY do); add `export const HOUR = 60 * MINUTE;` there only if missing. Check `effectiveCrisisQuietUntil`'s first parameter type (`InputDeps`) accepts `Deps`. If ESLint forbids `process/user` importing `process/outreach`, move `effectiveCrisisQuietUntil` and `latestFlaggedTurnAt` usage into a shared place the lint allows (e.g. `src/mind/state/user/relationship/`), updating outreach's import — don't duplicate it.

Note: `recordBigEvents` returns null for a capped run too, so a capped trigger doesn't count as recorded — that matches the tests.

- [ ] **Step 7: Move the sweep and register the job**

`src/mind/process/cold-path/sweep.ts`: remove the `sweepPendingUserMindRuns` import and call; drop "It also re-queues user mind runs whose job was lost." from the header. If `tests/mind/process/cold-path/sweep.test.ts` (or similar) asserts user-mind runs are swept there, move that assertion into the tick test (already covered by the last tick test) and delete it.

`src/mind/platform/jobs.ts`: add `export const USER_MIND_TICK_QUEUE = "user_mind_tick";` after `USER_MIND_RUN_QUEUE`.

`src/worker/user-mind-jobs.ts`:
```ts
/** User mind jobs: one batch of her thinking about a user, and the hourly tick that finds big events no exchange shows. */
import type { PgBoss } from "pg-boss";
import type { Deps } from "@/mind/platform/deps";
import {
  USER_MIND_RUN_QUEUE,
  USER_MIND_TICK_QUEUE,
  type UserMindRunJob,
} from "@/mind/platform/jobs";
import { runUserMind } from "@/mind/process/user/run";
import { userMindTick } from "@/mind/process/user/tick";
import { scrubErrors } from "./jobs";

export const USER_MIND_QUEUES = [USER_MIND_RUN_QUEUE, USER_MIND_TICK_QUEUE];

export async function registerUserMindJobs(boss: PgBoss, deps: Deps): Promise<void> {
  await boss.work<UserMindRunJob>(
    USER_MIND_RUN_QUEUE,
    scrubErrors(USER_MIND_RUN_QUEUE, deps.log, async (jobs) => {
      for (const job of jobs) await runUserMind(deps, job.data);
    }),
  );
  await boss.work(
    USER_MIND_TICK_QUEUE,
    scrubErrors(USER_MIND_TICK_QUEUE, deps.log, async () => {
      await userMindTick(deps, deps.clock.now());
    }),
  );
  await boss.schedule(USER_MIND_TICK_QUEUE, deps.config.user_mind.tick.cron);
}
```
Check `src/worker/jobs.ts` creates queues from the `*_QUEUES` lists (it lists queue names for `createQueue`); if it creates each queue explicitly, add `USER_MIND_TICK_QUEUE` the way `SWEEP_QUEUE` is created.

Also find the eval harness's user-mind drain (`drainUserMind` in `evals/lib/runner.ts`) — if eval scripts rely on the cold-path sweep to recover user-mind runs, leave them; the harness drains the queue directly.

- [ ] **Step 8: Run tests**

Run: `pnpm vitest run tests/mind/process/user tests/mind/process/cold-path tests/worker 2>/dev/null; pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(user-mind): hourly tick for long conversations and passed crises; it re-queues lost runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `stale_summary` before a reach-out

**Files:**
- Modify: `src/mind/process/outreach/tick.ts`
- Test: `tests/mind/process/outreach/tick.test.ts`

**Interfaces:**
- Consumes: `Trigger` `stale_summary` (Task 5), `recordBigEvents`, `enqueueUserMindRun` (`@/mind/process/user/run`), `liveSummary` (`@/db/repos/user/user-mind`), config `user_mind.triggers.stale_summary` (Task 5).

- [ ] **Step 1: Write the failing tests** (append to `tests/mind/process/outreach/tick.test.ts`; reuse `setup`, `dueThread`, `rows`; merge the new names into the file's existing imports: `USER_MIND_RUN_QUEUE` from `@/mind/platform/jobs`, `sql` from `drizzle-orm`, `createTestUser`/`getTestDb` from the helpers, `recordBigEvents` from `@/mind/process/user/run`)

```ts
async function summaryAt(deps: ReturnType<typeof makeTestDeps>, u: string, at: Date) {
  await insertFact(deps.db, u, {
    subject: "shared",
    kind: "summary",
    content: "s",
    embedding: vec(),
    created_at: at,
    status: "open",
    salience: 0.6,
    valence: 0,
    confidence: 0.7,
    source: "generated",
    payload: { where_things_stand: "a", whats_live: "b", how_i_feel: "c" },
  });
}
const mindRuns = async () =>
  (
    await getTestDb().execute(
      sql`SELECT user_id, source_ref, status, triggers FROM user_mind_run ORDER BY created_at`,
    )
  ).rows;

test("a stale summary records a run before the send and pushes the send to the lead", async () => {
  const { deps, u } = await setup();
  await dueThread(deps, u);
  await summaryAt(deps, u, new Date(now.getTime() - 73 * 3_600_000));
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");
  expect(await mindRuns()).toEqual([
    {
      user_id: u,
      source_ref: `stale_summary:${now.toISOString()}`,
      status: "pending",
      triggers: [{ kind: "stale_summary", age_hours: 73 }],
    },
  ]);
  expect(deps.queue.jobs.filter((j) => j.name === USER_MIND_RUN_QUEUE)).toHaveLength(1);
  const [r] = await rows(deps, u);
  expect(r!.send_at!.getTime() - now.getTime()).toBeGreaterThanOrEqual(5 * 60_000);
});

test("no summary yet counts as stale; a fresh one records nothing", async () => {
  const { deps, u } = await setup();
  await dueThread(deps, u);
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");

  const b = await createTestUser("b");
  await ensureRelationship(deps.db, b, now, deps.config.relationship);
  await dueThread(deps, b);
  await summaryAt(deps, b, new Date(now.getTime() - 3_600_000));
  expect(await outreachTickUser(deps, b, now)).toBe("scheduled");

  expect(await mindRuns()).toEqual([
    expect.objectContaining({ user_id: u, triggers: [{ kind: "stale_summary", age_hours: null }] }),
  ]);
});

test("a retried tick with the same time records no second run", async () => {
  const { deps, u } = await setup();
  await dueThread(deps, u);
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");
  await deps.db.delete(reach_out_log).where(eq(reach_out_log.user_id, u)); // let the retry schedule again
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");
  expect(await mindRuns()).toHaveLength(1);
});

test("a capped stale-summary run enqueues nothing", async () => {
  const deps = makeTestDeps({
    life: { timezone: "UTC" },
    core: { world: { events_per_day_max: 0 } },
    user_mind: { max_triggers_per_day: 1 },
  });
  deps.clock.set(now);
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, now, deps.config.relationship);
  await recordBigEvents(deps, deps.db, u, "exchange:x", [{ kind: "make_up_done" }]);
  await dueThread(deps, u);
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");
  expect((await mindRuns()).map((r) => r.status)).toEqual(["pending", "capped"]);
  expect(deps.queue.jobs.filter((j) => j.name === USER_MIND_RUN_QUEUE)).toHaveLength(0);
});

test("a tick with no winner records no stale-summary run", async () => {
  const { deps, u } = await setup();
  expect(await outreachTickUser(deps, u, now)).toBe("none");
  expect(await mindRuns()).toHaveLength(0);
});
```
`recordBigEvents` only records; it doesn't enqueue, so the pre-recorded run adds no queue job. The capped path is the one-line `if (!runId) return sendAt;`, and the test pins that no run job goes out. If `insertReachOutLog` dedupes per tick time (check the repo), drop the delete line in the retry test and assert the second tick's outcome instead.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/mind/process/outreach/tick.test.ts`
Expected: new tests FAIL (no runs recorded).

- [ ] **Step 3: Implement** in `src/mind/process/outreach/tick.ts`

Header: add `A reach-out about to go out on an old picture of them first records a user mind run, and the send waits a few minutes for it.`

Replace:
```ts
  const sendAt =
    status === "scheduled" ? jitteredSendTime(userId, now, settings.jitter_max_minutes) : null;
```
with:
```ts
  const sendAt =
    status === "scheduled"
      ? await afterStaleSummary(
          deps,
          userId,
          now,
          jitteredSendTime(userId, now, settings.jitter_max_minutes),
        )
      : null;
```
and add:
```ts
/**
 * When her summary of them is missing or old, she takes stock before writing: a user mind run is
 * recorded, and the send moves to at least `lead_minutes` out so the run can finish first. A
 * capped or repeated run changes nothing; a slow run means the reach-out uses the old summary.
 */
async function afterStaleSummary(
  deps: Deps,
  userId: string,
  now: Date,
  sendAt: Date,
): Promise<Date> {
  const settings = deps.config.user_mind.triggers.stale_summary;
  const summary = await liveSummary(deps.db, userId);
  const ageHours = summary ? (now.getTime() - summary.created_at.getTime()) / HOUR : null;
  if (ageHours !== null && ageHours < settings.max_age_hours) return sendAt;
  const runId = await recordBigEvents(deps, deps.db, userId, `stale_summary:${now.toISOString()}`, [
    { kind: "stale_summary", age_hours: ageHours === null ? null : Math.round(ageHours) },
  ]);
  if (!runId) return sendAt;
  await enqueueUserMindRun(deps, runId);
  const earliest = new Date(now.getTime() + settings.lead_minutes * MINUTE);
  return sendAt > earliest ? sendAt : earliest;
}
```
Imports: `liveSummary` from `@/db/repos/user/user-mind`; `enqueueUserMindRun`, `recordBigEvents` from `@/mind/process/user/run`. `HOUR`/`MINUTE` are local consts in this file already.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/mind/process/outreach tests/exit/phase-9b.test.ts tests/exit/phase-9a.test.ts`
Expected: PASS. Existing tests that count all `deps.queue.jobs`, or count `user_mind_run` rows after a reach-out, will now see the extra stale-summary run; update those expectations (filter by queue name / source_ref prefix). In `phase-9b.test.ts`, a stale-summary run can take one of the day's 3 slots — if a test then expects a later trigger to run, seed a fresh summary before the reach-out tick so no stale run is recorded.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(outreach): take stock before writing on a stale summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Inspector User mind tab

**Files:**
- Modify: `src/db/repos/admin/inspector.ts` (add `listUserMindRuns`)
- Modify: `src/app/inspector/[userId]/tabs.tsx` (add `MindTab`)
- Modify: `src/app/inspector/[userId]/page.tsx` (register the tab)
- Modify: `src/mind/platform/config.ts` (`inspector`), `config/default.json` (`inspector`)
- Test: `tests/db/inspector.test.ts`

**Interfaces:**
- Produces: `listUserMindRuns(db: Db, userId: string, limit: number): Promise<(UserMindRunRow & { traces: UserLoopTraceRow[] })[]>` (newest run first, traces oldest first). Config `inspector.user_mind_runs` (20).

- [ ] **Step 1: Write the failing test** (append to `tests/db/inspector.test.ts`, merging imports)

```ts
test("listUserMindRuns: newest run first, each with its traces in order, one user only", async () => {
  const deps = makeTestDeps();
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const r1 = (await recordBigEvents(deps, deps.db, a, "exchange:1", [{ kind: "make_up_done" }]))!;
  deps.clock.set(new Date(deps.clock.now().getTime() + 60_000));
  const r2 = (await recordBigEvents(deps, deps.db, a, "exchange:2", [{ kind: "crisis_passed" }]))!;
  await recordBigEvents(deps, deps.db, b, "exchange:3", [{ kind: "make_up_done" }]);
  await runUserMind(deps, { runId: r1 });
  const runs = await listUserMindRuns(getTestDb(), a, 10);
  expect(runs.map((r) => r.id)).toEqual([r2, r1]);
  expect(runs[1]!.traces.map((t) => t.loop)).toEqual(["user_summarise", "user_reflect", "user_ideate"]);
  expect(runs[0]!.traces).toEqual([]);
});
```
(Imports: `makeTestDeps` from `../helpers/deps`, `recordBigEvents`, `runUserMind` from `@/mind/process/user/run`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/db/inspector.test.ts`
Expected: FAIL — `listUserMindRuns` not exported.

- [ ] **Step 3: Implement the repo read** (append to `src/db/repos/admin/inspector.ts`; import `asc` and `user_mind_run`, `user_loop_trace` from schema; update the header list to include "user mind runs")

```ts
/** Her latest user mind runs for one user, newest first, each with its loop traces in order. */
export async function listUserMindRuns(db: Db, userId: string, limit: number) {
  const runs = await db
    .select()
    .from(user_mind_run)
    .where(eq(user_mind_run.user_id, userId))
    .orderBy(desc(user_mind_run.created_at))
    .limit(limit);
  if (runs.length === 0) return [];
  const traces = await db
    .select()
    .from(user_loop_trace)
    .where(
      and(
        eq(user_loop_trace.user_id, userId),
        inArray(
          user_loop_trace.run_id,
          runs.map((r) => r.id),
        ),
      ),
    )
    .orderBy(asc(user_loop_trace.created_at), asc(user_loop_trace.id));
  return runs.map((run) => ({ ...run, traces: traces.filter((t) => t.run_id === run.id) }));
}
```
If the three traces of one run share a `created_at` (fake clock), order by insertion is not guaranteed by `id`; in that case order traces by a fixed loop order in code: `const ORDER = ["user_summarise", "user_reflect", "user_ideate"]` and sort by `ORDER.indexOf(t.loop)` then `created_at`. Use whichever makes the test deterministic.

- [ ] **Step 4: Implement the tab**

`src/mind/platform/config.ts`: `const inspector = z.object({ snapshot_versions: positiveInt, user_mind_runs: positiveInt });`
`config/default.json`: `"inspector": { "snapshot_versions": 5, "user_mind_runs": 20 },`

`src/app/inspector/[userId]/tabs.tsx` — add (imports: `liveIdeas`, `liveSummary`, `recentReflections`, `type Trigger` from `@/db/repos/user/user-mind`; `triggerText` from `@/mind/process/user/inputs`; `ideaCutoff` from `@/mind/process/user/ideate`; `isSensitive` from `@/mind/memory/user/retrieve`; `Config` type from `@/mind/platform/config`):

```tsx
export async function MindTab({
  db,
  userId,
  now,
  cfg,
  limit,
}: {
  db: Db;
  userId: string;
  now: Date;
  cfg: Config["user_mind"];
  limit: number;
}) {
  const runs = await r.listUserMindRuns(db, userId, limit);
  const summary = await liveSummary(db, userId);
  const reflections = await recentReflections(db, userId, cfg.reflect.recent);
  const ideas = await liveIdeas(db, userId, ideaCutoff(now, cfg.ideate.ttl_days), cfg.ideate.max_planned);
  const mark = (f: { payload: unknown }) => (isSensitive(f) ? " (sensitive)" : "");
  if (!runs.length && !summary) return <Empty phase={9} />;
  return (
    <>
      <h2>Where things stand{summary ? mark(summary) : ""}</h2>
      <p>{summary ? `${iso(summary.created_at)} — ${summary.content}` : "—"}</p>
      <h2>Reflections</h2>
      <ul>
        {reflections.map((f) => (
          <li key={f.id}>
            {iso(f.created_at)} — {f.content}
            {mark(f)}
          </li>
        ))}
      </ul>
      <h2>Live ideas</h2>
      <ul>
        {ideas.map((f) => (
          <li key={f.id}>
            {iso(f.created_at)} — {f.content}
          </li>
        ))}
      </ul>
      <h2>Runs</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>at</th>
            <th>status</th>
            <th>triggers</th>
            <th>finished</th>
            <th>loops</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{iso(run.created_at)}</td>
              <td>{run.status}</td>
              <td>{(run.triggers as Trigger[]).map(triggerText).join("; ")}</td>
              <td>{iso(run.finished_at)}</td>
              <td>
                {run.traces.map((t) => (
                  <details key={t.id}>
                    <summary>
                      {t.loop} · {t.status} · {t.calls} call(s) · $
                      {t.cost?.toFixed(4) ?? "0"}
                      {t.error ? ` · ${t.error}` : ""}
                    </summary>
                    {json({ inputs: t.inputs, outputs: t.outputs })}
                  </details>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
```
(`Empty`, `iso`, `json` and `styles` are already defined/imported in `tabs.tsx`; check `iso` accepts `null`, as `ReachOutsTab` passes nullable dates to it.)

`src/app/inspector/[userId]/page.tsx`: add `mind: "User mind",` to `TABS` (after `reachouts`), import `MindTab`, and render:
```tsx
      {tab === "mind" && (
        <MindTab
          db={db}
          userId={userId}
          now={clock.now()}
          cfg={config.user_mind}
          limit={config.inspector.user_mind_runs}
        />
      )}
```

- [ ] **Step 5: Verify**

Run: `pnpm vitest run tests/db/inspector.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS. Then start the dev server (`pnpm dev`) with the dev DB, open `/inspector/<a user id>?tab=mind` and check the page renders without errors (use the `run` skill if available).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(inspector): user mind tab with runs, loop traces, summary, reflections and ideas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Phase 9c exit and the crisis canary

**Files:**
- Create: `tests/exit/phase-9c.test.ts`

**Interfaces:**
- Consumes: everything above. Follow `tests/exit/phase-9b.test.ts` for setup (`coreDump`, `count`, scripted `deps()`), reusing its patterns, not importing from it.

- [ ] **Step 1: Write the exit test**

```ts
/**
 * Phase 9c exit, all fake: a long conversation, a passed crisis and a stale summary before a
 * reach-out each run her user mind exactly once, however often the ticks rerun; an idle user
 * runs nothing; what a crisis told her reaches her summary but never ideate, a reach-out or
 * another user, and core is untouched.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { insertFact } from "@/db/repos/user/facts";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import { relationship } from "@/db/schema";
import { USER_MIND_RUN_QUEUE } from "@/mind/platform/jobs";
import { outreachTickUser } from "@/mind/process/outreach/tick";
import { runReachOutSend } from "@/mind/process/outreach/send";
import { REACH_OUT_SEND_QUEUE } from "@/mind/platform/jobs";
import { listTurns } from "@/db/repos/user/session-log";
import { insertThread } from "@/db/repos/user/threads";
import { runUserMind } from "@/mind/process/user/run";
import { userMindTick } from "@/mind/process/user/tick";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const TOKEN = "CANARY-9c41d0";
const MIN = 60_000;
const now = new Date("2026-01-05T15:25:00Z");


function deps() {
  const d = makeTestDeps({
    life: { timezone: "UTC" },
    core: { world: { events_per_day_max: 0 } },
    user_mind: { triggers: { long_conversation: { min_user_turns: 3, quiet_minutes: 30 } } },
  });
  d.clock.set(now);
  return d;
}
async function user(d: ReturnType<typeof deps>, name: string) {
  const u = await createTestUser(name);
  await ensureRelationship(d.db, u, now, d.config.relationship);
  return u;
}
async function drain(d: ReturnType<typeof deps>) {
  for (const job of d.queue.drain((j) => j.name === USER_MIND_RUN_QUEUE))
    if (job.name === USER_MIND_RUN_QUEUE) await runUserMind(d, job.data);
}
// + session(), dueThread(), coreDump(), count(), HOUR: see the helper list after the tests.

test("each new trigger runs its batch exactly once", async () => {
  const d = deps();
  const talker = await user(d, "talker");
  const crisis = await user(d, "crisis");
  const writer = await user(d, "writer");

  await session(talker, 3, 45);
  const until = new Date(now.getTime() - 10 * MIN);
  await getTestDb().update(relationship).set({ crisis_quiet_until: until }).where(eq(relationship.user_id, crisis));
  await dueThread(d, writer);

  await userMindTick(d, now);
  await userMindTick(d, now);
  expect(await outreachTickUser(d, writer, now)).toBe("scheduled");
  await drain(d);
  await userMindTick(d, now);

  const runs = (await getTestDb().execute(sql`SELECT user_id, source_ref, status FROM user_mind_run ORDER BY source_ref`)).rows;
  expect(runs.map((r) => [r.user_id, String(r.source_ref).split(":")[0], r.status])).toEqual([
    [crisis, "crisis_passed", "done"],
    [talker, "long_conversation", "done"],
    [writer, "stale_summary", "done"],
  ]);
  expect(await count("user_loop_trace")).toBe(9);
});

test("an idle user runs no loop", async () => {
  const d = deps();
  await user(d, "idle");
  await userMindTick(d, now);
  await userMindTick(d, new Date(now.getTime() + 60 * MIN));
  expect(await count("user_mind_run")).toBe(0);
  expect(d.llm.calls).toHaveLength(0);
});

test("a crisis reaches her summary, never ideate, a reach-out, another user or core", async () => {
  const d = deps();
  const before = await coreDump();
  const alice = await user(d, "alice");
  const bob = await user(d, "bob");
  // The fake summary echoes the token when it read it, so a leak downstream would show.
  d.llm.handlers.user_summarise = (input: string) => ({
    where_things_stand: input.includes(TOKEN) ? `They told me ${TOKEN}.` : "Fine.",
    whats_live: "L.",
    how_i_feel: "F.",
  });
  await insertFact(d.db, alice, {
    subject: "user",
    kind: "feeling",
    content: `${TOKEN} they felt hopeless`,
    embedding: vec(),
    created_at: new Date(now.getTime() - 30 * HOUR),
    status: "open",
    salience: 0.9,
    valence: -0.9,
    confidence: 0.9,
    source: "turn",
    payload: { sensitive: true },
  });
  // A reach-out needs history: one old exchange, as phase-9b's outreachUser seeds.
  await insertTurn(d.db, alice, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "talk later",
    created_at: new Date(now.getTime() - 26 * HOUR),
  });
  await getTestDb()
    .update(relationship)
    .set({ crisis_quiet_until: new Date(now.getTime() - 10 * MIN) })
    .where(eq(relationship.user_id, alice));
  await session(bob, 3, 45);

  await userMindTick(d, now);
  await drain(d);

  const calls = (p: string) => d.llm.calls.filter((c) => c.purpose === p);
  // Exactly Alice's summarise read the crisis; ideate never did.
  expect(calls("user_summarise").filter((c) => JSON.stringify(c).includes(TOKEN))).toHaveLength(1);
  for (const c of calls("user_ideate")) expect(JSON.stringify(c)).not.toContain(TOKEN);

  // Alice's reach-out: her live summary is sensitive, so the reach-out never carries it.
  await dueThread(d, alice);
  const later = new Date(now.getTime() + HOUR);
  d.clock.set(later);
  const seen = d.llm.calls.length;
  expect(await outreachTickUser(d, alice, later)).toBe("scheduled");
  for (const job of d.queue.drain((j) => j.name === REACH_OUT_SEND_QUEUE))
    if (job.name === REACH_OUT_SEND_QUEUE) expect(await runReachOutSend(d, job.data)).toBe("sent");
  const sendCalls = d.llm.calls.slice(seen);
  expect(sendCalls.length).toBeGreaterThan(0);
  for (const c of sendCalls) expect(JSON.stringify(c)).not.toContain(TOKEN);
  const sent = (await listTurns(d.db, alice)).filter((t) => t.trigger === "reach_out");
  expect(sent).toHaveLength(1);
  expect(sent[0]!.text).not.toContain(TOKEN);

  // Bob's stored rows never carry it; core is unchanged.
  const bobRows = (
    await getTestDb().execute(
      sql`SELECT row_to_json(f)::text AS j FROM fact f WHERE f.user_id = ${bob}`,
    )
  ).rows;
  for (const r of bobRows) expect(String(r.j)).not.toContain(TOKEN);
  expect(await coreDump()).toBe(before);
});
```

Helpers in this file (write them out, copied from the named sources, not imported):
- `coreDump()` and `count()` from `tests/exit/phase-9b.test.ts` (with its `CORE_TABLES`).
- `session(u, userTurns, endedMinutesAgo)` from Task 5's `tests/mind/process/user/tick.test.ts` (it uses the module-level `now`).
- `dueThread(d, u)` from `tests/mind/process/outreach/tick.test.ts` (uses `insertThread`, `insertFact`, `now`).
- `const HOUR = 60 * MIN;`
- If the reach-out send can't run because the stale-summary run was recorded while the 9c batch needs the fake handlers for reflect/ideate, nothing changes: `drain` isn't called between the tick and the send here, so the reach-out reads Alice's sensitive live summary → `latestNonSensitiveSummary` returns null → no summary slot.

- [ ] **Step 2: Run**

Run: `pnpm vitest run tests/exit/phase-9c.test.ts`
Expected: PASS. Outreach is ticked only for `writer` in the first test, so `talker` and `crisis` get no `stale_summary` run; `drain` runs before the last `userMindTick`, so the three runs end `done` and the extra tick records nothing new.

- [ ] **Step 3: Full suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm eval --llm=fake --compare`
Expected: all pass; the eval compare shows no regressions (the `forget` script is gone from both run and baseline).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(exit): phase 9c exit and the crisis canary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Record 9c in the spec and project files

**Files:**
- Modify: `spica-design-spec-v3.md` (§9.4, §9.5, §10.3, §12.5, §17 inspector, §18, §20, §25), `CLAUDE.md`, `DECISIONS.md`
- Delete: nothing (the 9c design doc and this plan are deleted after the phase is merged, per project convention)

- [ ] **Step 1: Spec edits** (plain English, v3 vocabulary; no code citations of phases in code)

- §9.4: after "Built 9a triggers", add a "**Built 9c triggers**" list: `long_conversation` (hourly `user_mind_tick`, thresholds `user_mind.triggers.long_conversation.*`, skipped in a crisis window and for an ended relationship, `source_ref` per session); `crisis_passed` (stored `crisis_quiet_until` ended within `user_mind.tick.lookback_hours`); `stale_summary` (outreach tick, summary missing or older than `max_age_hours`, send moved to `lead_minutes`). Note the pending-run sweep now runs in `user_mind_tick`. Remove "the rest of the list is backlog (B63)" and "Deferred triggers: B63." (the first-time milestone trigger moves to Phase 10's list — say so in one clause).
- §9.5: add "**Built 9c:** crisis-period memories (`payload.sensitive`) reach summarise and reflect; a summary or reflection that read one, or a summary whose previous was sensitive, is marked sensitive; ideate reads none of them (memories, summary or reflection). Ideas never carry a crisis." Fix the 9a sentence that says summarise excludes sensitive facts.
- §10.3: the recent turns drop everything before the latest gap of `chat.window_gap_hours` (72), counting the gap to now; a reach-out's summary slot reads the newest non-sensitive summary.
- §12.5 and §18: the "what I remember" view and per-fact deletion are removed (2026-10-09, Ethan): users cannot edit her mind, core or user side; account deletion remains the only user-side erasure. Update the §1/§12 lines and CLAUDE.md's "Memory" and "Guardrails" bullets that mention the view or per-fact deletion.
- §17 (inspector): add the User mind tab.
- §20: add a built row "9c. Triggers and crisis-aware user mind" with what was built and the `pnpm test` file/test counts at close (from the Task 8 full run); change the Phase 9 next-phases row to "9a, 9b, 9c built; **9d** `user_consolidate` (user `episode` kind), `user_model` (her read on the user, `belief` facts), full Phase 9 exit". Record 9d's settled choices from the design doc's Decisions section.
- §25: B2 done (window trim); B63 done except the first-time milestone (moved to Phase 10); B66 closed (memory view removed). Add one new backlog item: "The sensitive mark is sticky through the summary chain, so after a crisis reach-outs read the last pre-crisis summary indefinitely; add a clear-down if reach-outs feel out of date. *Tuning.*" with the next free B number.
- Config list wherever v3 enumerates keys: add the new keys.

- [ ] **Step 2: CLAUDE.md** — current phase line: "Phases 9a, 9b and 9c (remaining triggers, crisis-aware user mind, window trim, memory view removed, inspector User mind tab) are built; 9d (consolidate, model, full Phase 9 exit) is next and needs a design doc." Update the Memory module bullet (drop the "what I remember" view) and the Guardrails Data bullet ("account deletion" only).

- [ ] **Step 3: DECISIONS.md** — append rows (date 2026-10-09):
  - `crisis_passed` keys on the stored `crisis_quiet_until`, not the effective window | Stable once the cold path commits, so each crisis fires once.
  - `stale_summary`'s `source_ref` is the tick time | The reach-out log row doesn't exist yet when the run is recorded; a retried tick has the same time.
  - The window trim counts the gap from the last turn to now | A reach-out answers no turn, so its window must also drop a stale transcript.
  - Tests that need a vanished fact delete the row directly | Per-fact forget is gone; account deletion is the only remaining erasure path.

- [ ] **Step 4: Verify and commit**

Run: `pnpm lint` (Prettier covers the markdown).
```bash
git add -A
git commit -m "docs: record phase 9c triggers, crisis-aware user mind, window trim, inspector tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: §1 triggers → Tasks 5–6; §2 crisis flow → Tasks 3–4; §3 B2 → Task 2; §4 removal → Task 1; §5 inspector → Task 7; §6 config → Tasks 2, 5, 7; §7 testing → each task + Task 8; §8 spec updates → Task 9.
- Types: `Trigger` kinds defined in Task 5 and used in Tasks 6–8; `latestNonSensitiveSummary` and `isSensitive` defined in Task 3, used in Tasks 4 and 7; `memoryLines(facts)` signature changed in Task 3 and all three callers updated there.
