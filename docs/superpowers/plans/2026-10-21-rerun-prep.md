# Rerun Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix what the 2026-10-21 review run showed before the next run:
- her snapshot never empties a section;
- reflect stops churning near-copy goals and keeps seed goals for a week;
- the user-mind loops know NOW and each memory's date, and frame her reads of them as her
  impressions;
- an idea can follow an idea once they've replied;
- captions see what the picture shows;
- the small leftovers.

**Architecture:**
- **Code checks around existing loops:**
  - `render-snapshot.ts` keeps last night's section when the new one is empty;
  - `reflect.ts` checks goal twins with a new `CoreGoals.nearActive`;
  - `process/user/inputs.ts` carries the user's timezone, so every user loop gets `now` and dated
    memories.
- **Prompt versions:**
  - summarise v3, model v3, reflect v3, ideate v4 (the user mind);
  - no reply change: reply v18 already says a guess is never quoted back as theirs.
- **Data:** one migration, `web_find.description`.

**Tech Stack:** TypeScript, Drizzle + Postgres, Vitest, pnpm.

**Spec:**
- `docs/2026-10-21-rerun-prep-design.md` (settled lines);
- `spica-design-spec-v3.md`: §7 snapshot, §8.5 reflect, §9 user mind, §13 outreach, §16a posts,
  §10.1 turn judge;
- memory `no-night-settled` (pre-rerun lines).

## Global Constraints

- **Framework-free mind:** `src/mind` uses no `Date.now()` or `process.env`. Numbers go in
  `config/default.json` with a zod entry in `src/mind/platform/config.ts`.
- **Prompts:** a change is a new version file plus a config bump. Delete the old version, and
  update tests pinning it.
- **Scope:**
  - user loops may read core (V2);
  - nothing user-scoped reaches a core loop;
  - every user query is scoped by `user_id`.
- **Migrations:** `pnpm db:generate` (next is 0040), then `pnpm db:migrate`. Never edit an applied
  migration.
- **Comments:** they say why and never cite spec sections, phases or review items. Prettier runs
  at 100 columns.
- **Test strings:** never write one containing `\n` through a shell heredoc or Python. Use the
  Write/Edit tool, or `String.fromCharCode(10)`.
- **Tests:** one test process at a time (shared test DB). The full suite runs once, in the last
  task.
- **Commits:** on `main`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Paid run:** only after Ethan's go-ahead.

## Review Focus

- **Seed self on the first night:** with no previous snapshot row, the "last night" sections come
  from `persona.seedSelf`. Its markdown must parse into the same section names, including
  "Habits of speech" (a test renders night 1 with every section empty).
- **A section legitimately emptied by events:** the rule keeps old lines forever until the model
  writes new ones. That's accepted (the design says so). Make sure the kept lines also land in
  `core_self_line` for the new version, or retrieval loses them.
- **Goal twin vs the drop floor:** cancelling a drop because its twin was proposed must not let
  drops exceed the floor logic. Skipped adds must not count as replacements in `droppable`.
- **User timezone null or invalid:** `formatLocal` falls back to UTC (it already does); the
  loops never throw.
- **`lastSentKind` with `answered_at` set:** null, so ideas can go again. A row sent with no
  `answered_at` keeps blocking ideas.

---

### Task 1: The snapshot never empties a section

**Files:**
- Modify: `src/mind/process/core/render-snapshot.ts`
- Test: `tests/mind/process/core/render-snapshot.test.ts`

**Interfaces:**
- Produces: `export function sectionLines(markdown: string): Record<string, string[]>` (bullets
  under each `### Name`, without the `- `).

- [ ] **Step 1: Write the failing tests**

```ts
test("an emptied section keeps last night's lines, here the seed self on night 1", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await seedSnapshot(deps);
  const seed = (await deps.core.memory.latestSnapshot())!;
  all.llm.handlers.core_render_snapshot = () => ({
    Lately: [],
    Opinions: [{ text: "Solaris is overrated", depth: null }],
    Interests: [],
    Goals: [],
    People: [],
    "Habits of speech": [],
  });
  expect(await coreRenderSnapshot(deps, now)).toBe("done");
  const snap = (await deps.core.memory.latestSnapshot())!;
  expect(snap.sections.Lately).toBe(seed.sections.Lately);
  expect(snap.sections.Opinions).toBe("- Solaris is overrated");
  const lines = (await deps.core.memory.selfLines(snap.version)).map((l) => l.text);
  for (const kept of sectionLines(seed.content).Lately ?? []) expect(lines).toContain(kept);
});

test("sectionLines reads the bullets under each heading", () => {
  const md = ["### Lately", "- a", "- b", "", "### Goals", "- c"].join(String.fromCharCode(10));
  expect(sectionLines(md)).toEqual({ Lately: ["a", "b"], Goals: ["c"] });
});
```

Import `sectionLines` from `@/mind/process/core/render-snapshot`. Read `seedSnapshot`'s v0
first. If the seed has a section with no bullets, assert only on sections it does have.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test tests/mind/process/core/render-snapshot.test.ts`
Expected: FAIL (`sectionLines` not exported; Lately empty).

- [ ] **Step 3: Implement**

```ts
/** The bullet lines under each `### Name` heading of a snapshot or seed self. */
export function sectionLines(markdown: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current: string | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const heading = /^###\s+(.+?)\s*$/.exec(raw);
    if (heading) {
      current = heading[1]!;
      out[current] = [];
    } else if (current && raw.startsWith("- ")) out[current]!.push(raw.slice(2).trim());
  }
  return out;
}
```

In `coreRenderSnapshot`, after `result`, build the effective items:

```ts
    // A night's render can come back with a section emptied; her self doesn't vanish overnight,
    // so an empty section keeps last night's lines.
    const before = sectionLines(previous?.content ?? persona.seedSelf);
    const kept = Object.fromEntries(
      Object.entries(result).map(([name, items]) => [
        name,
        items.length ? items : (before[name] ?? []).map((text) => ({ text, depth: null })),
      ]),
    ) as typeof result;
```

Then use `kept` everywhere `result` was used below: `sections`, `content` and `lines`. Update the
file header: "…preserving the prior version on failure and a prior section when a render empties
it."

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm test tests/mind/process/core/render-snapshot.test.ts tests/mind/memory/core`
Expected: PASS. If the existing "each rendered line keeps its depth" test now finds kept seed
lines in the empty sections, it still passes: it only `find`s its own lines.

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/core/render-snapshot.ts tests/mind/process/core/render-snapshot.test.ts
git commit -m "fix(core): a nightly snapshot that empties a section keeps last night's lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Reflect merges near-twin goals and keeps seed goals for a week

**Files:**
- Modify:
  - `src/mind/state/core/types.ts` (`CoreGoals.nearActive`)
  - `src/db/repos/core/goals.ts`
  - `src/mind/process/core/reflect.ts`
  - `src/mind/platform/config.ts`, `config/default.json` (`core.goals.twin_similarity` 0.85,
    `core.goals.seed_keep_days` 7)
- Test: `tests/mind/process/core/reflect.test.ts`, `tests/db/core-repos.test.ts`

**Interfaces:**
- Produces: `nearActive(embedding: number[], minSimilarity: number): Promise<string | null>`, the
  nearest active goal at or above the similarity.

- [ ] **Step 1: Write the failing tests** (reflect.test.ts; goal embeddings use the fake embedder
  so similarity is real)

```ts
const goalRow = async (deps: ReturnType<typeof setup>["deps"], title: string, o: object = {}) =>
  deps.core.goals.insert({
    title,
    why: "x",
    status: "active",
    progress: 0.2,
    source: "reflect",
    source_ref: null,
    started_at: new Date(now.getTime() - 30 * 86_400_000),
    target_at: null,
    embedding: (await deps.embedder.embed([`${title}: x`], "document"))[0]!,
    ...o,
  });

test("a goal that's a near-twin of an active one isn't added, and that one isn't dropped", async () => {
  const { all, deps } = setup();
  await memory(deps, "episode", "A day.");
  const old = await goalRow(deps, "Send the post rough");
  all.llm.handlers.core_reflect = () => ({
    insights: [],
    opinions: [],
    interests: [],
    goals: { add: [{ title: "Send the post rough", why: "x" }], drop: [old] },
    narrative: null,
  });
  expect(await coreReflect(deps, now)).toBe("done");
  const active = await deps.core.goals.active();
  expect(active.map((g) => g.id)).toEqual([old]);
  expect(active[0]!.progress).toBeCloseTo(0.2);
});

test("a seed goal can't be dropped in its first week", async () => {
  const { all, deps } = setup({ core: { goals: { min_active: 0 } } });
  await memory(deps, "episode", "A day.");
  const young = await goalRow(deps, "Learn the constellations", { source: "seed", started_at: now });
  const old = await goalRow(deps, "Finish the film list", { source: "seed" });
  all.llm.handlers.core_reflect = () => ({
    insights: [],
    opinions: [],
    interests: [],
    goals: { add: [], drop: [young, old] },
    narrative: null,
  });
  await coreReflect(deps, now);
  expect((await deps.core.goals.get(young))!.status).toBe("active");
  expect((await deps.core.goals.get(old))!.status).toBe("dropped");
});
```

A repo test (`core-repos.test.ts`): `nearActive` returns an active goal for its own embedding,
null for a dropped one, and null for an orthogonal vector (`Array.from({length:1024},(_, i) =>
i % 2 ? 0.01 : -0.01)`).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test tests/mind/process/core/reflect.test.ts tests/db/core-repos.test.ts`
Expected: FAIL (a twin is added and the old one dropped; the young seed goal is dropped;
`nearActive` is missing).

- [ ] **Step 3: Implement**

The repo, following `memory.near`'s SQL style in `src/db/repos/core/memory.ts`:

```ts
    async nearActive(embedding, minSimilarity) {
      const q = vecLiteral(embedding);
      const res = await db.execute(sql`
        SELECT id FROM core_goal
        WHERE status = 'active' AND (1 - (embedding <=> ${q}::vector)) >= ${minSimilarity}
        ORDER BY embedding <=> ${q}::vector LIMIT 1`);
      return res.rows[0] ? String(res.rows[0].id) : null;
    },
```

In `reflect.ts`, inside `commit`, before the drop loop:

```ts
      // Reflection rewords a goal it already has; the near-twin stays (with its progress) and the
      // rewording isn't added, nor is the original dropped for it.
      const twins = new Set<string>();
      const adds = [];
      for (const [index, goal] of goalAdds.entries()) {
        const twin = await tx.goals.nearActive(
          embeddings[proposals.length + index]!,
          config.core.goals.twin_similarity,
        );
        if (twin) twins.add(twin);
        else adds.push({ goal, embedding: embeddings[proposals.length + index]! });
      }
```

Then:
- `droppable` uses `adds.length` instead of `goalAdds.length`.
- The drop loop skips `twins.has(id)` and a goal with
  `goal.source === "seed" && now - goal.started_at < seed_keep_days days`.
- The add loop iterates `adds`.

Config: `goals: { …, twin_similarity: unit, seed_keep_days: positiveInt }`.

**Existing fixtures:** the existing tests that drop seed goals started `now`
("fade and drop…", "drops never leave her fewer…") need `started_at` 30 days back. Their goals and
adds use `vec()` for every embedding, which is a near-twin of any fake vector. Give those fixtures
`source: "reflect"` or an old `started_at`, and per-title fake embeddings (as `goalRow` does).

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm typecheck && pnpm test tests/mind/process/core/reflect.test.ts tests/db/core-repos.test.ts tests/exit/phase-15d.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/mind/state/core/types.ts src/db/repos/core/goals.ts src/mind/process/core/reflect.ts src/mind/platform/config.ts config/default.json tests
git commit -m "fix(core): reflect keeps a goal instead of adding its near-twin, and keeps seed goals a week

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The user mind knows NOW and each memory's date; her reads stay hers

**Files:**
- Modify:
  - `src/mind/process/user/inputs.ts` (`RunInputs.timezone`, `memoryLines`)
  - `summarise.ts`, `reflect.ts`, `model.ts`, `ideate.ts` (add `now` to the input)
  - `config/default.json` (`user_summarise` v3, `user_reflect` v3, `user_model` v3,
    `user_ideate` v4)
- Create:
  - `prompts/user-mind/summarise/v3.md`
  - `prompts/user-mind/reflect/v3.md`
  - `prompts/user-mind/model/v3.md`
  - `prompts/user-mind/ideate/v4.md`
- Delete: the v2/v2/v2/v3 files those replace.
- Test:
  - `tests/mind/process/user/summarise.test.ts`
  - `tests/mind/process/user/ideate.test.ts`
  - `tests/mind/platform/config.test.ts` (if it pins these versions)

**Interfaces:**
- Produces:
  - `RunInputs.timezone: string | null`;
  - `memoryLines(facts, tz)` returns `{ subject, kind, content, when: string | null }`, where
    `when = occurred_at ? formatLocal(occurred_at, tz) : null`.

- [ ] **Step 1: Write the failing test** (summarise.test.ts)

```ts
test("the loop sees NOW and each memory's date, in their zone", async () => {
  const { deps, userId, run } = await setup();
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "event",
    content: "They have an interview on Thursday.",
    embedding: vec(),
    created_at: deps.clock.now(),
    occurred_at: new Date("2026-01-08T14:00:00Z"),
    status: "open",
    salience: 0.9,
    valence: 0,
    confidence: 0.9,
    source: "turn",
  });
  await userSummarise(deps, await run("exchange:d"), await loadRunInputs(deps, userId));
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_summarise")!;
  const input = JSON.parse(call.input);
  expect(input.now).toMatch(/^\w{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC\)$/);
  expect(input.new_memories).toContainEqual(
    expect.objectContaining({ content: "They have an interview on Thursday.", when: "Thu 2026-01-08 14:00 (UTC)" }),
  );
});
```

Check `formatLocal`'s exact output format in `src/mind/platform/timezone.ts`, and match the
regex to it.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/mind/process/user/summarise.test.ts`
Expected: FAIL (no `now`, no `when`).

- [ ] **Step 3: Implement**
- `loadRunInputs`: `timezone: await getTimezone(db, userId)`.
- `memoryLines(facts, tz)`: add `when` as above (the `occurred_at` field is already selected).
- Each loop's input adds `now: formatLocal(now, inputs.timezone)` and passes `inputs.timezone`
  to `memoryLines`.
- **Prompts** (copy each previous version, bump the title, and add these lines):
  - Every user-mind prompt's input list gains: "`now` (the current time) and each memory's `when`
    (when it happens or happened, or null). Something whose `when` is before `now` has happened;
    after `now`, it's still ahead."
  - **summarise v3:** "Say whether each plan is done or still ahead from `now` and its `when`,
    never from how it was phrased."
  - **model v3 and reflect v3:** "Your read on them can come through your own lens, as anyone's
    does, but it is your impression: write it as what you think ('I get the sense…'), never as
    something they said or a habit they have, unless a memory says so. Don't make every read about
    the same theme."
  - **ideate v4:** "An idea starts from something they told you (a memory), not from your read of
    them alone. Never write 'like you said' or put words in their mouth unless a memory has them
    saying it."
- Bump the config to the new versions and `git rm` the old files.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm typecheck && pnpm test tests/mind/process/user tests/mind/platform/config.test.ts tests/exit/mind-split.test.ts`
Expected: PASS. Fix pinned-version tests (`mind-split` checks prompts by purpose, not version).

- [ ] **Step 5: Commit**

```bash
git add -A src/mind/process/user prompts/user-mind config/default.json tests
git commit -m "feat(user-mind): the loops see now and each memory's date; her reads of them stay her impressions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: An idea can follow an idea once they've replied

**Files:**
- Modify: `src/db/repos/user/reach-out.ts` (`lastSentKind`), the `CandidateInputs.lastSentKind`
  doc in `types.ts`, and the `idea_again` comment in `candidates.ts`
- Test: `tests/mind/process/outreach/inputs.test.ts`

- [ ] **Step 1: Write the failing test** (append to the `lastSentKind` test)

```ts
  // Once they've written since, it no longer counts.
  await deps.db
    .update(reach_out_log)
    .set({ answered_at: ago(1) })
    .where(eq(reach_out_log.topic, "user_idea"));
  expect((await loadCandidateInputs(deps, u, now)).lastSentKind).toBeNull();
```

Import `reach_out_log` from `@/db/schema`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/mind/process/outreach/inputs.test.ts`
Expected: FAIL (still "user_idea").

- [ ] **Step 3: Implement.** Select `answered_at` with the winner, and return null when it is set:
  "The winner kind of the last reach-out, while it's unanswered; null once they've written since,
  or before the first."
  - Rename nothing.
  - Update the field doc ("The kind of the last reach-out while it's still unanswered") and the
    candidates comment ("…two in a row without a word from them reads as an interview").

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm test tests/mind/process/outreach`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/user/reach-out.ts src/mind/process/outreach tests/mind/process/outreach/inputs.test.ts
git commit -m "fix(outreach): an idea can follow an idea once they've written back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Captions see what the picture shows

**Files:**
- Modify:
  - `src/db/schema.ts` (`web_find.description: text("description")`, nullable)
  - `src/mind/world/types.ts` (`WebItem.description?: string | null`, and `NewWebFind`)
  - `src/runtime/web-sources.ts`
  - `src/db/repos/core/posts.ts` (insert and read)
  - `src/mind/process/core/browse.ts` (carry it)
  - `src/mind/process/core/post-words.ts` (draft and check inputs)
  - `src/mind/platform/config.ts`, `config/default.json` (`posts.description_max_chars` 300)
- Create: `src/db/migrations/0040_*.sql` (generated)
- Test:
  - `tests/runtime/web-sources.test.ts`
  - `tests/mind/process/core/post-words.test.ts`
  - `tests/mind/process/core/browse.test.ts`

- [ ] **Step 1: Write the failing tests**
  - **web-sources:** extend the `item` helper with an optional `description`. Then test that an
    ESO item with
    `<description>&lt;p&gt;A telescope dome under the Milky Way.&lt;/p&gt;</description>`
    yields `description: "A telescope dome under the Milky Way."`, and that one with none yields
    `null`.
  - **post-words:** with `find.description` set, the draft call's input contains
    `What it shows: A telescope dome under the Milky Way.`; without it, there's no "What it shows"
    line. The check gets the same line.
  - **browse:** a find from a `webItem({ description: "d" })` stores `description: "d"`. Read the
    file's `webItem` helper.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test tests/runtime/web-sources.test.ts tests/mind/process/core/post-words.test.ts tests/mind/process/core/browse.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - **Sources:** `web-sources.ts` `rssPictureOfWeek` reads `<description>`, decodes entities,
    strips tags (`.replace(/<[^>]+>/g, " ")`), collapses whitespace and cuts at
    `descriptionMaxChars` with `cutAtWord` (import it from `post-words`, or move it to a shared
    module if lint forbids runtime importing process code; if so, record a ledger ruling).
    - Add `descriptionMaxChars` to `Options` and wire it from config where the sources are built.
    - Commons returns `description: null`, since its description is already the title.
  - **Schema and migration:** the schema column, then `pnpm db:generate` and `pnpm db:migrate`.
  - **Data path:** browse writes `description: item.description ?? null`, and the posts repo
    returns it on finds.
  - **Prompt inputs** (`post-words.ts`): after the "What you found" line, add
    `find.description ? \`What it shows: ${find.description}\` : null`, filter out nulls, and do
    the same in the check.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm typecheck && pnpm test tests/runtime tests/mind/process/core tests/db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/db/schema.ts src/db/migrations src/mind src/runtime src/db/repos config/default.json tests
git commit -m "feat(posts): drafts and checks see the feed's description of the picture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Leftovers

**Files:**
- Modify:
  - `config/default.json` (`turn.judge_timeout_ms` 5000)
  - `src/mind/state/core/core-state.ts`, `src/mind/state/core/tick.ts`
  - `spica-design-spec-v3.md` (backlog header)
- Test: `tests/mind/state/core/core-state.test.ts`, `tests/mind/state/core/tick.test.ts`

- [ ] **Step 1: Write the failing tests**
  - **core-state:** `driftStep` returns `{ mood_valence, mood_arousal }` only. Change the test to
    `expect(next).not.toHaveProperty("energy")`. Its `target` is `{ mood_valence, mood_arousal }`.
  - **tick:**

```ts
test("a busy block running to midnight drains her in the first tick after it", async () => {
  const run = async (busy: boolean) => {
    await resetDb();
    const full = makeTestDeps({ core: { state: { noise: 0 } }, life: { timezone: "UTC" } });
    if (busy)
      await insertLifeDay(full.db, {
        date: "2026-01-04",
        plan: { blocks: [{ start: "22:00", end: "24:00", kind: "busy", busy: 1, label: "reading" }] },
        source: "scripted",
        model: "none",
        prompt_version: "scripted",
        generated_at: at,
      });
    await coreStateTick(coreDepsOf(full), new Date("2026-01-05T00:45:00Z"));
    return (await full.core.state.get())!.energy;
  };
  expect(await run(true)).toBeLessThan(await run(false));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test tests/mind/state/core`
Expected: FAIL (energy present; no drain across midnight).

- [ ] **Step 3: Implement**
  - **`driftStep`:** takes and returns only mood (`Omit<CoreMood, "energy">`). The tick builds
    `next = { ...driftStep(...), energy: energyStep(...) }`.
  - **The tick:** reads the blocks of the past hour's local date too:

```ts
  const hourAgo = new Date(now.getTime() - HOUR);
  const blocks = [
    ...(await todaysBlocks(deps, now)),
    ...(lifeDate(config.life, hourAgo) !== lifeDate(config.life, now)
      ? blocksForDay(config.life, lifeDate(config.life, hourAgo), await deps.core.world.plan(lifeDate(config.life, hourAgo)))
      : []),
  ];
```

  (Simplify into a local `const day = …` and `const prevDay = …`.)
  - **Config:** `turn.judge_timeout_ms` to 5000.
  - **Spec:** the backlog header "highest so far: B124".

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm typecheck && pnpm test tests/mind/state tests/mind/process/turn-taking`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A config/default.json src/mind/state tests/mind/state spica-design-spec-v3.md
git commit -m "fix(core): drift leaves energy to the battery; a busy block before midnight still drains her; judge timeout 5 s

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Close

- [ ] **Step 1: Spec write-back**
  - §7: an emptied section keeps last night's lines.
  - §8.5: goal twins (`core.goals.twin_similarity`) and the seed week (`seed_keep_days`).
  - §9: `now` and memory `when`; summarise v3, model v3, reflect v3, ideate v4; reads framed as
    her impressions.
  - §13: `idea_again` lifts on their reply.
  - §16a: `web_find.description` (migration 0040) and `posts.description_max_chars`.
  - §10.1: the judge timeout 5000.
  - Backlog: B121 done, moved to the history doc.
  - DECISIONS rows:
    - the goal twin threshold;
    - skipping the reworded add vs replacing;
    - the seed week counts from `started_at`;
    - the description cut at a word.
- [ ] **Step 2: Checks**
  - `git grep` that the old prompt versions are unreferenced.
  - In the background: `pnpm format && pnpm typecheck && pnpm lint && pnpm test > .data/full-rerun-prep.log 2>&1`.
  - Then `pnpm eval --llm=fake --compare`, which should show no regressions.
- [ ] **Step 3: Review**
  - `scope-reviewer` on the range since this plan's commit. It must not run tests while anything
    else uses the DB.
  - Fix Critical and Important findings.
- [ ] **Step 4: Housekeeping**
  - Memory `phase-status` "Now" line.
  - `git rm` this plan; keep the design doc until the run.
  - Commit: `docs: record the rerun prep fixes`.
- [ ] **Step 5: Ask Ethan** before `pnpm review:world-outreach` (about $1.20).
