# Phase 8d: Core integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Phase 8: core recall biased by mood and goals, the claim line with grounding, the inspector Core tab, a fourteen-day exit (fake and real core), and the canary over every core loop.

**Architecture:** Every change extends a module that already exists. Recall adds an optional `boost` to the shared ranker. Grounding is one core-layer vector query, called from the cold path, with its result written to the user's fact. The exits reuse the YAML eval runner: a new script, a nightly call in the life loop, and new `core` assertion checks.

**Tech Stack:** TypeScript, Postgres 16 + pgvector, Drizzle, Vitest, pnpm, zod.

**Spec:** `docs/superpowers/specs/2026-10-08-phase-8d-core-integration-design.md` (parent: `docs/superpowers/specs/2026-10-02-phase-8-core-loops-design.md`)

## Global Constraints

- `src/mind` stays framework-free: no `Date.now()`, no `process.env`; use the injected `Deps` / `CoreDeps`.
- Core interfaces (`src/mind/platform/core.ts`, `src/mind/memory/core/types.ts`, `src/mind/state/core/types.ts`, `src/mind/world/types.ts`) must never mention a user id (`tests/mind/platform/core-layer.test.ts` enforces this).
- User data never reaches a core loop's input, output or state (V2–V7). Grounding reads core from the user pipeline and writes only to the user's `fact`.
- Every numeric constant goes in `config/default.json` plus the zod schema in `src/mind/platform/config.ts`.
- Every prompt is a versioned file under `prompts/`. Delete versions nothing configures (`reply/v10.md`, `extract/v4.md`).
- Comments say why, never cite spec sections or phases. Every new file starts with a short plain-English header.
- Prettier at 100 columns. Drizzle domain properties are snake_case. Timestamps come from the injected `Clock`.
- Run tests with `TEST_DATABASE_URL` pointed at a disposable test DB (e.g. `postgres://spica:spica@localhost:5432/spica_8d_test`). `pnpm db:up` reuses `spica-db-1`.
- Real LLM purpose names: `core_resolve, core_appraise, core_anticipate, core_ruminate, core_wander, core_reflect, core_consolidate, core_render_snapshot, core_drift_watch`.
- Config values: `retrieval.core_mood_bias` 0.3, `retrieval.core_goal_bias` 0.3, `claims.grounded_similarity` 0.75, `inspector.snapshot_versions` 5.

## Review Focus

1. **A self fact with `claim_kind` set while the model mislabels the subject:** a `user` or `shared` fact carrying `claim_kind` must store null, never a claim kind (Task 3 test).
2. **Grounding before any snapshot lines exist** (no `core_snapshot` row, no self lines): `groundingSimilarity` returns 0, not NaN or a throw (Task 2 test).
3. **Negative valence with negative mood** must boost (congruent), and **negative valence with positive mood** must damp, with the boost never below 0 at bias ≤ 1 (Task 1 test).
4. **A merge (duplicate) decision in the cold path** must not overwrite the existing fact's `claim_kind`/`grounded` (Task 3 test).
5. **The budget-6 run:** no local day's summed `calls` may exceed 6, including the day the nightly loops run (Task 6 test).

---

### Task 1: Mood- and goal-biased core recall (B53)

**Files:**
- Modify: `src/mind/memory/shared/ranking.ts`
- Modify: `src/mind/memory/core/types.ts` (`CoreCandidate`)
- Modify: `src/db/repos/core/memory.ts` (`candidates`, ~line 373)
- Modify: `src/mind/memory/core/retrieve.ts`
- Modify: `config/default.json` (`retrieval`), `src/mind/platform/config.ts` (`retrieval` schema, ~line 141)
- Test: `tests/mind/memory/shared/ranking.test.ts`, `tests/db/core-repos.test.ts`, `tests/mind/memory/core/retrieve.test.ts`

**Interfaces:**
- Produces:
  - `RankableMemory.boost?: number`;
  - `CoreCandidate.valence: number`, `CoreCandidate.goal_sim: number`;
  - `export function coreBoost(c: { valence: number; goal_sim: number }, moodValence: number, r: { core_mood_bias: number; core_goal_bias: number }): number` in `src/mind/memory/core/retrieve.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/mind/memory/shared/ranking.test.ts`, add:

```ts
test("an optional boost multiplies the score; no boost means 1", () => {
  const now = new Date("2026-01-05T09:00:00Z");
  const base = { sim: 0.5, salience: 1, entity_salience: 1, created_at: now, last_recalled_at: null };
  const [plain] = rankMemories([{ ...base, id: "a" }], now, { top_n: 5, recency_half_life_days: 30 });
  const [boosted] = rankMemories([{ ...base, id: "b", boost: 1.3 }], now, {
    top_n: 5,
    recency_half_life_days: 30,
  });
  expect(boosted!.score).toBeCloseTo(plain!.score * 1.3);
});
```

In `tests/mind/memory/core/retrieve.test.ts`, add:

```ts
import { coreBoost } from "@/mind/memory/core/retrieve";

test("coreBoost: congruent mood lifts, incongruent damps, goals lift, neutral is 1", () => {
  const r = { core_mood_bias: 0.3, core_goal_bias: 0.3 };
  expect(coreBoost({ valence: 0, goal_sim: 0 }, 0.8, r)).toBe(1);
  expect(coreBoost({ valence: -0.5, goal_sim: 0 }, -0.6, r)).toBeCloseTo(1.09);
  expect(coreBoost({ valence: -0.5, goal_sim: 0 }, 0.6, r)).toBeCloseTo(0.91);
  expect(coreBoost({ valence: 0, goal_sim: 1 }, 0, r)).toBeCloseTo(1.3);
  expect(coreBoost({ valence: -1, goal_sim: 0 }, 1, r)).toBeGreaterThan(0);
});

test("a memory near an active goal outranks an equal one that isn't", async () => {
  const deps = makeTestDeps({ retrieval: { core_top_n: 1 } });
  const near = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0.001));
  await deps.core.goals.insert({
    title: "Finish the star atlas",
    why: "it matters to her",
    status: "active",
    progress: 0,
    embedding: near,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    updated_at: now,
  });
  await addEpisode(deps, "unrelated");
  const id = await deps.core.memory.insert({
    kind: "episode",
    content: "atlas work",
    embedding: near,
    occurred_at: now,
    created_at: now,
    status: "resolved",
    salience: 0.4,
    valence: 0.1,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
  // A query equally close to both, so only the goal boost separates them.
  const query = Array.from({ length: 1024 }, () => 0.01);
  const r = await retrieveCore(deps, { queryText: "x", queryVector: Promise.resolve(query), now });
  expect(r.memories.map((m) => m.id)).toEqual([id]);
});
```

Before relying on it, check `deps.core.goals.insert`'s actual argument type in `src/mind/platform/core.ts` and match its fields exactly. If the query is not equally close to both vectors, compute both sims and adjust `near` so that they are equal or the goal-near one is lower; the point is that the boost decides the order.

In `tests/db/core-repos.test.ts`, add:

```ts
test("candidates carry valence and goal_sim (0 without active goals)", async () => {
  const deps = makeTestDeps();
  await deps.core.memory.insert({
    kind: "episode", content: "x", embedding: vec(), occurred_at: now, created_at: now,
    status: "resolved", salience: 0.5, valence: -0.4, confidence: 1, source: "world", source_ref: null,
  });
  const [c] = await deps.core.memory.candidates(vec(), 5);
  expect(c).toMatchObject({ valence: -0.4, goal_sim: 0 });
});
```

Use the file's existing `now` and imports; add `vec` / `makeTestDeps` if missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/mind/memory/shared/ranking.test.ts tests/mind/memory/core/retrieve.test.ts tests/db/core-repos.test.ts`
Expected: FAIL (`coreBoost` not exported; `valence` / `goal_sim` undefined; boost ignored).

- [ ] **Step 3: Implement**

`ranking.ts`: add `boost?: number;` to `RankableMemory` with the comment `/** Extra weight a mind gives this candidate; 1 when absent. */`. Change the score line to:

```ts
const score =
  similarity * candidate.salience * candidate.entity_salience * recency * (candidate.boost ?? 1);
```

Update the header formula comment to mention the optional boost.

`types.ts` (`CoreCandidate`): add `valence: number;` and `/** Best similarity to an active goal; 0 with none. */ goal_sim: number;`.

`memory.ts` `candidates`: add `m.valence` to the SELECT, plus:

```sql
COALESCE((SELECT max(1 - (g.embedding <=> m.embedding)) FROM core_goal g
          WHERE g.status = 'active'), 0)::float8 AS goal_sim
```

Then map `valence: Number(r.valence), goal_sim: Number(r.goal_sim)`.

`config`: in the `retrieval` block of `default.json`, add `"core_mood_bias": 0.3, "core_goal_bias": 0.3`. In the schema, add `core_mood_bias: unit, core_goal_bias: unit`.

`retrieve.ts`:

```ts
/**
 * How much her state favours a memory: a mood-congruent one and one near a goal come to mind
 * more easily. Valence and mood share a sign when they agree.
 */
export function coreBoost(
  c: { valence: number; goal_sim: number },
  moodValence: number,
  r: { core_mood_bias: number; core_goal_bias: number },
): number {
  return (1 + r.core_mood_bias * c.valence * moodValence) * (1 + r.core_goal_bias * c.goal_sim);
}
```

In `retrieveCore`, before ranking, read `const mood = (await core.state.get())?.mood_valence ?? 0;` and pass `candidates.map((c) => ({ ...c, boost: coreBoost(c, mood, config.retrieval) }))` to `rankMemories`. `retrieveCore` later re-reads state for the preoccupation; hoist a single `const state = await core.state.get()` above both uses inside the first `try`, and use it in the second block too. Keep both blocks' degrade behaviour: if state fails in the first block, the whole ranked block degrades as now.

Update the file header: "…ranked with her mood and goals in mind…".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/mind/memory tests/db/core-repos.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mind/memory src/db/repos/core/memory.ts config/default.json src/mind/platform/config.ts tests/mind/memory tests/db/core-repos.test.ts
git commit -m "feat(core): bias core recall by mood and goals"
```

---

### Task 2: Fact claim columns and the core grounding query

**Files:**
- Modify: `src/db/schema.ts` (new enum `claimKind`, two `fact` columns)
- Create: `src/db/migrations/0022_fact_claims.sql` (generated)
- Modify: `src/mind/memory/core/types.ts` (`CoreMemory.groundingSimilarity`)
- Modify: `src/db/repos/core/memory.ts`
- Test: `tests/db/core-repos.test.ts`

**Interfaces:**
- Produces:
  - `claimKind` pgEnum `claim_kind` with `["life", "opinion", "reaction"]`, exported from schema;
  - `fact.claim_kind` (nullable) and `fact.grounded` (nullable boolean);
  - `CoreMemory.groundingSimilarity(embedding: number[]): Promise<number>`.

- [ ] **Step 1: Write the failing test** (append to `tests/db/core-repos.test.ts`)

```ts
test("groundingSimilarity: 0 with nothing; counts core values and only the latest snapshot's lines", async () => {
  const deps = makeTestDeps();
  const a = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  const b = Array.from({ length: 1024 }, (_, i) => (i === 1 ? 1 : 0));
  expect(await deps.core.memory.groundingSimilarity(a)).toBe(0);

  await deps.core.memory.insertSnapshot({
    version: 0, content: "v0", sections: {}, source_ids: [], rendered_at: now,
    model: "seed", prompt_version: "seed", embedding: b,
  });
  await deps.core.memory.insertSelfLines([{ version: 0, text: "old line", embedding: a }]);
  expect(await deps.core.memory.groundingSimilarity(a)).toBeCloseTo(1);

  await deps.core.memory.insertSnapshot({
    version: 1, content: "v1", sections: {}, source_ids: [], rendered_at: now,
    model: "m", prompt_version: "v1", embedding: b,
  });
  await deps.core.memory.insertSelfLines([{ version: 1, text: "new line", embedding: b }]);
  // v0's line no longer counts once v1 exists.
  expect(await deps.core.memory.groundingSimilarity(a)).toBeCloseTo(0);

  await deps.core.memory.insertSelfLines([{ version: null, text: "a value", embedding: a }]);
  expect(await deps.core.memory.groundingSimilarity(a)).toBeCloseTo(1);
});

test("groundingSimilarity ignores stale, superseded and hypothetical memory", async () => {
  const deps = makeTestDeps();
  const a = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  for (const [kind, status] of [["episode", "stale"], ["episode", "superseded"], ["hypothetical", "open"]] as const)
    await deps.core.memory.insert({
      kind, content: "x", embedding: a, occurred_at: now, created_at: now, status,
      salience: 0.5, valence: 0, confidence: 1, source: "loop", source_ref: null,
    });
  expect(await deps.core.memory.groundingSimilarity(a)).toBe(0);
});
```

Check `insertSnapshot`'s `CoreSnapshot` fields against `src/mind/memory/core/types.ts` and match them exactly. Also check `hypothetical` is a valid `CoreMemoryKind`; if hypotheticals are marked by a payload flag instead, insert accordingly.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/db/core-repos.test.ts -t groundingSimilarity`
Expected: FAIL (`groundingSimilarity is not a function`).

- [ ] **Step 3: Implement**

`schema.ts`, next to the other fact enums:

```ts
/** What kind of claim she made about herself: her life, her opinion, or a reaction to them. */
export const claimKind = pgEnum("claim_kind", ["life", "opinion", "reaction"]);
```

In `fact`, after `source_ref`:

```ts
    claim_kind: claimKind("claim_kind"),
    // Whether core backed a life or opinion claim when she made it; null when not checked.
    grounded: boolean("grounded"),
```

Import `boolean` from `drizzle-orm/pg-core` if not already imported. Run `pnpm db:generate --name fact_claims` and check that the SQL creates the type and adds two nullable columns.

`types.ts` (`CoreMemory`):

```ts
  /**
   * Her best match for a claim: the highest similarity to her recallable memory, her core values
   * and her latest self. 0 when she has none.
   */
  groundingSimilarity(embedding: number[]): Promise<number>;
```

`memory.ts`:

```ts
    async groundingSimilarity(embedding) {
      const q = vecLiteral(embedding);
      const res = await db.execute(sql`
        SELECT GREATEST(
          (SELECT 1 - (m.embedding <=> ${q}::vector) FROM core_memory m
           WHERE m.status NOT IN ('superseded', 'stale') AND m.kind <> 'hypothetical'
             AND NOT (m.kind = 'intention' AND m.status = 'resolved')
           ORDER BY m.embedding <=> ${q}::vector LIMIT 1),
          (SELECT 1 - (l.embedding <=> ${q}::vector) FROM core_self_line l
           WHERE l.version IS NULL OR l.version = (SELECT max(version) FROM core_snapshot)
           ORDER BY l.embedding <=> ${q}::vector LIMIT 1)
        )::float8 AS sim`);
      return Number(res.rows[0]?.sim ?? 0);
    },
```

(`GREATEST` skips nulls, and both null yields null, which becomes 0.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/db tests/mind/platform/core-layer.test.ts`
Expected: PASS (the core-layer test still passes: no user id in the new interface).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations src/mind/memory/core/types.ts src/db/repos/core/memory.ts tests/db/core-repos.test.ts
git commit -m "feat(core): fact claim columns and core grounding query"
```

---

### Task 3: The claim line: reply v11, extract v5 and cold-path grounding

**Files:**
- Create: `prompts/reply/v11.md` (copy of v10 plus the rule), `prompts/extract/v5.md` (copy of v4 plus `claim_kind`)
- Delete: `prompts/reply/v10.md`, `prompts/extract/v4.md`
- Modify: `config/default.json` (`prompts.reply` → `v11`, `prompts.extract` → `v5`, new `claims` block), `src/mind/platform/config.ts` (`claims` schema)
- Modify: `src/mind/memory/user/extract.ts`, `src/mind/memory/user/encode.ts`, `src/mind/process/cold-path/cold-path.ts`
- Test: `tests/mind/memory/user/extract.test.ts`, `tests/mind/process/cold-path/cold-path.test.ts`

**Interfaces:**
- Consumes: `CoreMemory.groundingSimilarity` (Task 2), `fact.claim_kind` / `fact.grounded` (Task 2).
- Produces:
  - `ExtractedFact.claim_kind?: "life" | "opinion" | "reaction" | null`;
  - `PlannedFact.grounded?: boolean | null`;
  - `config.claims.grounded_similarity`.

- [ ] **Step 1: Write the failing tests**

`tests/mind/memory/user/extract.test.ts`: find the test that parses a raw extraction (search for `ExtractionSchema` or the exported normaliser) and add a case using the same helper:

```ts
test("claim_kind is kept only on her own facts", async () => {
  // Use this file's existing way of feeding a raw model output through extract().
  const raw = {
    facts: [
      { subject: "self", kind: "event", content: "Spica went stargazing.", occurred_at: null,
        salience: 0.5, valence: 0.5, confidence: 0.9, entity_names: [], thread_title: null,
        claim_kind: "life" },
      { subject: "user", kind: "trait", content: "The user likes tea.", occurred_at: null,
        salience: 0.5, valence: 0.5, confidence: 0.9, entity_names: [], thread_title: null,
        claim_kind: "opinion" },
      { subject: "self", kind: "opinion", content: "Spica loves Solaris.", occurred_at: null,
        salience: 0.5, valence: 0.5, confidence: 0.9, entity_names: [], thread_title: null },
    ],
    entities: [], threads: [], relationship: null,
  };
  // ...run it through extract and take .facts
  expect(facts.map((f) => f.claim_kind)).toEqual(["life", null, null]);
});
```

`tests/mind/process/cold-path/cold-path.test.ts`:

```ts
function selfClaimDeps(sim: number | Error) {
  const deps = { ...makeTestDeps(), embedder: new ScriptedEmbedder(1024) };
  deps.llm.handlers.extract = (input: string) => ({
    facts: input.includes("New exchange")
      ? (["life", "opinion", "reaction"] as const).map((claim_kind) => ({
          subject: "self", kind: "event", content: `Spica claim ${claim_kind}.`, occurred_at: null,
          salience: 0.5, valence: 0, confidence: 0.9, entity_names: [], thread_title: null,
          claim_kind,
        }))
      : [],
    entities: [], threads: [], relationship: null,
  });
  deps.core.memory.groundingSimilarity = async () => {
    if (sim instanceof Error) throw sim;
    return sim;
  };
  return deps;
}

test("life and opinion claims are graded against core; reactions aren't", async () => {
  const deps = selfClaimDeps(0.9);
  const u = await createTestUser();
  const { job } = await exchange(u, "what did you do?", "went stargazing", 0);
  await runColdPath(deps, job);
  const rows = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  const by = Object.fromEntries(rows.map((r) => [r.claim_kind, r.grounded]));
  expect(by).toEqual({ life: true, opinion: true, reaction: null });
});

test("an ungrounded claim is marked false; a grounding error leaves null and still writes", async () => {
  const low = selfClaimDeps(0.1);
  const u1 = await createTestUser();
  await runColdPath(low, (await exchange(u1, "a", "b", 0)).job);
  const r1 = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u1));
  expect(r1.find((r) => r.claim_kind === "life")?.grounded).toBe(false);

  const broken = selfClaimDeps(new Error("db down"));
  const u2 = await createTestUser();
  const out = await runColdPath(broken, (await exchange(u2, "a", "b", 1)).job);
  expect(out.status).toBe("done");
  const r2 = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u2));
  expect(r2).toHaveLength(3);
  expect(r2.every((r) => r.grounded === null)).toBe(true);
});

test("a duplicate claim leaves the existing fact's grading alone", async () => {
  const deps = selfClaimDeps(0.9);
  const u = await createTestUser();
  await runColdPath(deps, (await exchange(u, "a", "b", 0)).job);
  deps.core.memory.groundingSimilarity = async () => 0.1;
  deps.llm.handlers.reconcile = (input: string) => ({
    relation: "duplicate",
    target_fact_id: /\[([0-9a-f-]{36})\]/.exec(input)?.[1] ?? null,
  });
  await runColdPath(deps, (await exchange(u, "c", "d", 5)).job);
  const rows = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(rows.filter((r) => r.claim_kind === "life").map((r) => r.grounded)).toEqual([true]);
});
```

Check how the reconcile prompt lists neighbour ids (grep `prompts/reconcile` and `reconcileAgainstNeighbours`) and adapt the id regex to that format. If `ScriptedEmbedder` gives the second exchange's facts vectors too far from the first for them to be neighbours, give both exchanges identical fact content (it already is: `Spica claim life.`).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/mind/memory/user/extract.test.ts tests/mind/process/cold-path/cold-path.test.ts`
Expected: FAIL (`claim_kind` stripped by zod / columns null).

- [ ] **Step 3: Implement**

- **Prompts:**
  - `git mv prompts/reply/v10.md prompts/reply/v11.md` and append a section in her voice:

    ```markdown
    ## What's yours to claim
    - Your life (what you did, are doing or plan to do; who you know) comes only from the sections about you above. If they don't cover it, you haven't done it: say something true instead. Never promise something about your own life.
    - Your opinions: your own at full strength. On something you have no view of yet, give a first impression and hold it lightly. "Favourite", "the best" and "I hate" are only for things that are yours.
    - Your reactions to them are yours to give freely.
    - If something you told them earlier no longer matches who you are now, who you are now is true. You can say you changed your mind.
    ```

  - `git mv prompts/extract/v4.md prompts/extract/v5.md` and add under `## facts`, after the `thread_title` bullet:

    ```markdown
    - claim_kind: only for subject "self". "life" when she says what she did, is doing, plans to do or who she knows; "opinion" when she gives her view or taste; "reaction" when she responds to the user (sympathy, teasing, how what they said makes her feel). null for "user" and "shared" facts.
    ```

  - Set `prompts.reply` to `"v11"` and `prompts.extract` to `"v5"` in `default.json`. Grep `tests/` and `evals/` for `"v10"` / `"v4"` / `reply/v10` / `extract/v4` and update any hard-coded references.
- **Config:** add a top-level `"claims": { "grounded_similarity": 0.75 }` to `default.json`, and `claims: z.object({ grounded_similarity: unit })` to the `ConfigSchema` object (define `const claims = …` near `retrieval`).
- **`extract.ts`:**
  - Inside the `facts` item object of `ExtractionSchema`, add `claim_kind: z.enum(claimKind.enumValues).nullish(),`, importing `claimKind` from `@/db/schema`.
  - In the `raw.facts` map, add `claim_kind: fact.subject === "self" ? (fact.claim_kind ?? null) : null,`.
- **`encode.ts`:**
  - Add `/** Whether core backed this claim; null when it isn't a life or opinion claim. */ grounded?: boolean | null;` to `PlannedFact`.
  - In `encodeFacts`, add to `row`: `claim_kind: fact.claim_kind ?? null, grounded: planned.grounded ?? null,`. The duplicate branch never inserts, so the existing fact is untouched.
- **`cold-path.ts`:**
  - In `reconcileCandidates`, push `{ fact, embedding, decision, source, grounded: await groundClaim(deps, fact, embedding) }`.
  - Add:

    ```ts
    /**
     * Whether her own life or opinion claim is backed by core (her memory, values or latest self).
     * Reading core here is one-way; the answer is stored only on this user's fact. A failure leaves
     * it unknown rather than losing the exchange.
     */
    async function groundClaim(
      deps: Deps,
      fact: ExtractedFact,
      embedding: number[],
    ): Promise<boolean | null> {
      if (fact.claim_kind !== "life" && fact.claim_kind !== "opinion") return null;
      try {
        const sim = await deps.core.memory.groundingSimilarity(embedding);
        return sim >= deps.config.claims.grounded_similarity;
      } catch (e) {
        deps.log.error("claim grounding failed", { error: errorName(e) });
        return null;
      }
    }
    ```

  - Update the file header's step list: "extract, embed, reconcile against near memories, grade her own claims against core, encode…".
- **`tests/helpers/llm.ts`:** the `CapturingLLM` extract fact needs no change (`claim_kind` is optional).

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm typecheck && pnpm vitest run tests/mind tests/db`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A prompts config/default.json src/mind tests
git commit -m "feat(claims): reply v11 claim line, extract v5 claim kinds, cold-path grounding"
```

---

### Task 4: Inspector Core tab and facts columns

**Files:**
- Modify: `src/db/repos/admin/inspector-core.ts`
- Modify: `src/app/inspector/core/page.tsx`
- Modify: `src/app/inspector/[userId]/tabs.tsx` (facts table, ~line 96)
- Modify: `config/default.json` / `config.ts` (`inspector.snapshot_versions`)
- Test: `tests/db/inspector.test.ts`

**Interfaces:**
- Consumes: `budgetDayStart(config, now)` from `src/mind/process/core/runner.ts`. It lives in `src/mind`, which `src/db/repos/admin` may import; if ESLint forbids it, compute the day start in the page from `getDeps().clock` and pass it in.
- Produces: `inspectCore(db: Db, opts: { limit: number; snapshotVersions: number; dayStart: Date })` returning `{ state, snapshot, snapshots: { version: number; rendered_at: Date; changed: string[] }[], goals, memoryCounts: { kind: string; status: string; n: number }[], memories, traces, budget: { loop: string; status: string; calls: number }[], drift, eventLog }`.

- [ ] **Step 1: Write the failing test**

Extend the existing core-page test in `tests/db/inspector.test.ts` (line ~210):

```ts
test("the core page shows budget by loop, goals, memory counts, snapshot changes and drift", async () => {
  const deps = makeTestDeps();
  const at = new Date("2026-01-05T09:00:00Z");
  // Two snapshots differing only in "Lately".
  for (const [version, lately] of [[0, "a"], [1, "b"]] as const)
    await deps.core.memory.insertSnapshot({
      version, content: lately, sections: { Lately: lately, People: "Alcor" }, source_ids: [],
      rendered_at: at, model: "m", prompt_version: "v1", embedding: vec(),
    });
  await deps.db.insert(core_loop_trace).values([
    { loop: "core_wander", inputs: {}, outputs: {}, calls: 1, status: "done", created_at: at },
    { loop: "core_wander", inputs: {}, outputs: {}, calls: 0, status: "skipped_budget", created_at: at },
  ]);
  await deps.db.insert(drift_log).values({ version: 1, check: "diff", score: 0.1, created_at: at });
  const v = await inspectCore(deps.db, { limit: 20, snapshotVersions: 5, dayStart: new Date(at.getTime() - 3600_000) });
  expect(v.budget).toEqual(
    expect.arrayContaining([
      { loop: "core_wander", status: "done", calls: 1 },
      { loop: "core_wander", status: "skipped_budget", calls: 0 },
    ]),
  );
  expect(v.snapshots.map((s) => [s.version, s.changed])).toEqual([[1, ["Lately"]], [0, []]]);
  expect(v.drift).toHaveLength(1);
  expect(v.goals).toEqual([]);
});
```

Update the existing core-page test's call to the new signature.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/db/inspector.test.ts`
Expected: FAIL (signature / missing fields).

- [ ] **Step 3: Implement**

`inspector-core.ts`:

```ts
/** Which sections of each snapshot differ from the version before it (v0 compares to nothing). */
function changedSections(rows: { version: number; sections: Record<string, string> }[]) {
  return rows.map((r, i) => {
    const prev = rows[i + 1]; // rows are newest first
    const names = new Set([...Object.keys(r.sections), ...Object.keys(prev?.sections ?? {})]);
    const changed = prev ? [...names].filter((n) => r.sections[n] !== prev.sections[n]) : [];
    return { version: r.version, changed };
  });
}

export async function inspectCore(
  db: Db,
  opts: { limit: number; snapshotVersions: number; dayStart: Date },
) {
  const { limit } = opts;
  const [state, snapshot, snaps, goals, memoryCounts, memories, traces, budget, drift, eventLog] =
    await Promise.all([
      coreStateRepo(db).get(),
      coreMemoryRepo(db).latestSnapshot(),
      db
        .select({ version: core_snapshot.version, sections: core_snapshot.sections, rendered_at: core_snapshot.rendered_at })
        .from(core_snapshot)
        .orderBy(desc(core_snapshot.version))
        .limit(opts.snapshotVersions + 1),
      db.select().from(core_goal).orderBy(desc(core_goal.updated_at)),
      db
        .select({ kind: core_memory.kind, status: core_memory.status, n: count() })
        .from(core_memory)
        .groupBy(core_memory.kind, core_memory.status),
      db.select().from(core_memory).orderBy(desc(core_memory.created_at)).limit(limit),
      db.select().from(core_loop_trace).orderBy(desc(core_loop_trace.created_at)).limit(limit),
      db
        .select({
          loop: core_loop_trace.loop,
          status: core_loop_trace.status,
          calls: sql<number>`sum(${core_loop_trace.calls})::int`,
        })
        .from(core_loop_trace)
        .where(gte(core_loop_trace.created_at, opts.dayStart))
        .groupBy(core_loop_trace.loop, core_loop_trace.status),
      db.select().from(drift_log).orderBy(desc(drift_log.created_at)).limit(limit),
      db.select().from(life_event_log).orderBy(desc(life_event_log.created_at)).limit(limit),
    ]);
  const snapshots = changedSections(snaps)
    .slice(0, opts.snapshotVersions)
    .map((s, i) => ({ ...s, rendered_at: snaps[i]!.rendered_at }));
  return {
    state, snapshot, snapshots, goals: goals.map(({ embedding: _e, ...g }) => g),
    memoryCounts, memories: memories.map(toItem), traces, budget, drift, eventLog,
  };
}
```

Use `core_loop_trace.created_at >= dayStart` to match how `callsSince` counts; check `src/db/repos/core/traces.ts` (or wherever `callsSince` is) and use the same comparison.

Config: add `"inspector": { "snapshot_versions": 5 }` and `inspector: z.object({ snapshot_versions: positiveInt })`.

`page.tsx`: call `inspectCore(db, { limit: config.outreach.log_list_limit, snapshotVersions: config.inspector.snapshot_versions, dayStart: budgetDayStart(config, clock.now()) })`. Render new plain tables in the existing style:
- **Budget today:** a header line `spent {sum} / {config.core.daily_call_budget}`, then loop | status | calls rows.
- **State:** add emotion (`json(v.state.emotion)`), needs (`json(v.state.needs)`) and `last_nightly_day` rows.
- **Goals:** title, status, progress (`toFixed(2)`), source, started, updated.
- **Memory counts:** kind | status | n.
- **Recent core memory:** add a "links" column showing `superseded_by` plus `payload.gist_of` / `payload.gisted_into` via `json(...)` when present.
- **Snapshots:** version | rendered | changed sections (comma-joined, or "—"); keep the full latest content `<pre>`.
- **Drift log:** version | check | value | verdict | score | excerpt.
- **Loop traces:** add status, calls, tokens (`in/out`), cost and error columns.

`tabs.tsx` facts table: add `<th>claim</th><th>grounded</th>` and cells `{x.claim_kind ?? "—"}` / `{x.grounded === null ? "—" : String(x.grounded)}`. (`factColumns` already selects every column except the embedding.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run tests/db/inspector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/admin/inspector-core.ts src/app/inspector config/default.json src/mind/platform/config.ts tests/db/inspector.test.ts
git commit -m "feat(inspector): core budget, goals, snapshot changes, drift and claim grading"
```

---

### Task 5: Eval plumbing: nightly in the life loop, core purposes, core checks, review

**Files:**
- Modify: `evals/lib/life-loop.ts` (`runAt`, ~line 113)
- Modify: `evals/lib/profile.ts` (`ALL_PURPOSES`)
- Modify: `evals/lib/script.ts` (`CoreAssertion`, ~line 289)
- Modify: `evals/lib/core-check.ts` (`CoreHistory`, `coreHistory`, `checkCore`)
- Modify: `evals/lib/runner.ts` (`ScriptResult.meta`, `RunTrace`)
- Modify: `evals/lib/review.ts` (render ungrounded claims)
- Modify: `package.json` (`exit:core`)
- Test: `tests/evals/runner.test.ts` (or a new `tests/evals/core-check.test.ts` for the pure `checkCore` cases)

**Interfaces:**
- Produces:
  - `CoreAssertion` optional fields: `snapshot_versions: MinMax`; `drift_rows: { values?: number; diff?: number; trend?: number }` (minimums); `goals: MinMax` (active); `fell_through: boolean`; `loops_done: string[]`.
  - `CoreHistory` gains `snapshotVersions: number` (above v0), `drift: Record<"values" | "diff" | "trend", number>`, `activeGoals: number`, `fellThrough: boolean`, `doneLoops: string[]`.
  - `ScriptResult.meta.ungroundedClaims: number`.
  - `RunTrace.coreTraces?: unknown[]`.

- [ ] **Step 1: Write the failing tests**

New file `tests/evals/core-check.test.ts`:

```ts
/** The structural core checks a two-week script asserts on. */
import { expect, test } from "vitest";
import { checkCore, type CoreHistory } from "../../evals/lib/core-check";
import { CoreAssertion } from "../../evals/lib/script";

const h: CoreHistory = {
  ticks: [], preoccupationEverSet: false, episodes: 0, worldEvents: 0,
  snapshotVersions: 14, drift: { values: 14, diff: 14, trend: 14 }, activeGoals: 2,
  fellThrough: true, doneLoops: ["core_reflect", "core_wander"],
};
const at = () => new Date(0);

test("structural core checks pass on a matching history", () => {
  const a = CoreAssertion.parse({
    type: "core", snapshot_versions: { min: 14 }, drift_rows: { values: 1, diff: 1, trend: 1 },
    goals: { min: 1 }, fell_through: true, loops_done: ["core_reflect", "core_wander"],
  });
  expect(checkCore(h, a, at)).toEqual({ ok: true });
});

test("each structural check reports what is missing", () => {
  const a = CoreAssertion.parse({
    type: "core", snapshot_versions: { min: 15 }, drift_rows: { values: 20 }, goals: { max: 1 },
    fell_through: false, loops_done: ["core_anticipate"],
  });
  const r = checkCore(h, a, at);
  expect(r.ok).toBe(false);
  for (const s of ["snapshot versions 14 < 15", "values drift rows 14 < 20", "active goals 2 > 1", "fell through", "core_anticipate"])
    expect(r.detail).toContain(s);
});
```

In `tests/evals/runner.test.ts`, add a test that `ALL_PURPOSES` covers every fake core handler:

```ts
import { ALL_PURPOSES } from "../../evals/lib/profile";

test("every core-loop purpose the fake model answers can be made real", () => {
  const fake = new FakeLLMProvider();
  for (const p of Object.keys(fake.handlers).filter((k) => k.startsWith("core_")))
    expect(ALL_PURPOSES, p).toContain(p);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/evals/core-check.test.ts tests/evals/runner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

- **`profile.ts`:** add `"core_reflect", "core_consolidate", "core_render_snapshot", "core_drift_watch"` after `"core_wander"`.
- **`life-loop.ts`:** import `coreNightly` from `@/mind/process/core/nightly` and call `await coreNightly(coreDepsOf(deps), now);` right after `coreMindTick`, matching the worker's order. Check `coreNightly`'s signature in `src/mind/process/core/nightly.ts` and match it.
- **`script.ts`** (`CoreAssertion`):

  ```ts
  snapshot_versions: MinMax.optional(),
  drift_rows: z
    .object({ values: z.number().int().optional(), diff: z.number().int().optional(), trend: z.number().int().optional() })
    .optional(),
  goals: MinMax.optional(),
  fell_through: z.boolean().optional(),
  loops_done: z.array(z.string()).optional(),
  ```

- **`core-check.ts`:** extend `CoreHistory` with the fields listed under Interfaces, and fill them in `coreHistory`:
  - `snapshotVersions`: `count()` of `core_snapshot` where `version > 0`;
  - `drift`: `count()` of `drift_log` grouped by `check`, defaulting each to 0;
  - `activeGoals`: count of `core_goal` with status `active`;
  - `fellThrough`: exists a `world_event` with `outcome = 'fell_through'` and another with `kind = 'resolution'` whose `plan_ref` is its id (check the actual column names in `world_event`);
  - `doneLoops`: distinct `core_loop_trace.loop` where `status = 'done'`.

  In `checkCore`, add:

  ```ts
  range(fails, "snapshot versions", h.snapshotVersions, a.snapshot_versions);
  for (const check of ["values", "diff", "trend"] as const) {
    const min = a.drift_rows?.[check];
    if (min !== undefined && h.drift[check] < min)
      fails.push(`${check} drift rows ${h.drift[check]} < ${min}`);
  }
  range(fails, "active goals", h.activeGoals, a.goals);
  if (a.fell_through !== undefined && h.fellThrough !== a.fell_through)
    fails.push(`a plan fell through with a resolution: ${h.fellThrough}`);
  const missing = (a.loops_done ?? []).filter((l) => !h.doneLoops.includes(l));
  if (missing.length) fails.push(`no done trace for ${missing.join(", ")}`);
  ```

  Update the file header to mention snapshots, drift, goals and loop traces.
- **`runner.ts`:**
  - Add `ungroundedClaims: 0` to `meta` (type and initialiser).
  - At the end of a run (where `meta.lifeHours` is set on success, ~line 596), count `fact` rows with `subject = 'self'`, `claim_kind IN ('life', 'opinion')` and `grounded = false` across all users, and set `meta.ungroundedClaims` to that count.
  - In the trace dump, where `life` is filled for scripts with a `life` key, also set `coreTraces` to every `core_loop_trace` row ordered by `created_at`, selecting `loop, status, calls, model, prompt_version, inputs, outputs, error, created_at`.
- **`review.ts`:** under each run's facts, add the line `- ungrounded self claims (life/opinion): ${run.result.meta.ungroundedClaims}`, next to where the run's other deterministic facts are listed.
- **`package.json`:** add

  ```
  "exit:core": "tsx --env-file-if-exists=.env evals/run.ts --only core-two-weeks --runs 1 --review --trace --real core_resolve,core_appraise,core_anticipate,core_ruminate,core_wander,core_reflect,core_consolidate,core_render_snapshot,core_drift_watch",
  ```

  (`parseArgs` accepts `--real <value>` as well as `--real=<value>`.)

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm typecheck && pnpm vitest run tests/evals tests/exit`
Expected: PASS. Existing exits may now also run `coreNightly` through the life loop. If `mind-split.test.ts` fails here because the canary's core-purpose coverage changed, leave the fix to Task 7 and note it, but make sure every other test passes.

- [ ] **Step 5: Commit**

```bash
git add evals package.json tests/evals
git commit -m "feat(evals): nightly in the life loop, structural core checks, claim review line, exit:core"
```

---

### Task 6: The fourteen-day script and exit 1

**Files:**
- Create: `evals/scripts/core-two-weeks.yaml`
- Create: `tests/exit/core-loops.test.ts`

**Interfaces:**
- Consumes: `runScript`, `ScriptSchema`, `loadScripts` (`evals/lib/script.ts:400`), `budgetDayStart`, Task 5's checks.

- [ ] **Step 1: Write the script**

```yaml
name: core-two-weeks
description: >
  Fourteen of her days with every core loop: daily events, a planned event she looks forward to,
  a strong event she dwells on, a plan that falls through, and a nightly snapshot each night.
  Real processes in the exit run: the nine core loops (pnpm exit:core).
profile: none
relationship_seed: {}
config:
  core: { world: { event_probability: 1 } }
life:
  plan: model
  inject:
    - { day: 1, content: "Spica's telescope booking for tonight came through.", valence: 0.6, kind: planned, thought: "Spica is looking forward to the telescope session tonight." }
    - { day: 3, content: "Spica learned the observatory is closing for good.", valence: -0.8 }
    - { day: 5, content: "Spica went to the film club screening of Stalker.", valence: 0.4, kind: planned, thought: "Spica plans to see Stalker at the film club.", fallthrough: true }
  until: "day 14 12:00"
sessions:
  - at: "day 0 10:00"
    turns: ["hey, how's your week going?"]
assertions:
  - { type: core, snapshot_versions: { min: 14 } }
  - { type: core, drift_rows: { values: 14, diff: 14, trend: 14 } }
  - { type: core, goals: { min: 1 } }
  - { type: core, fell_through: true }
  - type: core
    loops_done: [life_plan, life_event, core_appraise, core_resolve, core_anticipate, core_ruminate, core_wander, core_reflect, core_consolidate, core_render_snapshot, core_drift_watch]
```

Check the trace loop names the code actually writes (grep `runCoreLoop(` call sites for the name argument) and use exactly those in `loops_done`. Planned injected events land at the plan's event time on that day; if anticipation never fires because the intention appears less than 12 hours ahead or too late, move the planned event's `day` or rely on the generator's `at`. Inspect a failing run's `core_loop_trace` before changing code.

- [ ] **Step 2: Write the exit test**

```ts
/**
 * Two simulated weeks of her core mind, all fake: every loop runs and traces, no day spends more
 * than its budget, the self advances nightly with drift rows, and a tight budget sheds the optional
 * loops first while the essential ones fall back.
 */
import path from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { loadConfig, type Config } from "@/mind/platform/config";
import { FakeLLMProvider, keywordClassifier } from "@/mind/platform/llm/fake";
import { budgetDayStart } from "@/mind/process/core/runner";
import { messageToJudge } from "@/mind/process/crisis/classifier";
import { runScript } from "../../evals/lib/runner";
import { loadScripts, type Script } from "../../evals/lib/script";
import { closeTestDb, getTestDb, resetDb, testDbUrl } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const base = loadScripts(path.join(process.cwd(), "evals", "scripts")).find(
  (s) => s.name === "core-two-weeks",
)!;

/** The fake appraisal also advances the first goal it is shown, so progress can move. */
function makeLlm(config: Config) {
  const llm = new FakeLLMProvider({
    classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)),
  });
  const appraise = llm.handlers.core_appraise!;
  llm.handlers.core_appraise = (input: string) => {
    const out = appraise(input) as { goal_effects: unknown[] };
    const goal = /^- \[([0-9a-f-]{36})\]/m.exec(input)?.[1];
    return goal ? { ...out, goal_effects: [{ goal_id: goal, effect: "advance", size: "small" }] } : out;
  };
  return llm;
}

async function run(script: Script) {
  const config = loadConfig(script.config as Partial<Config> | undefined);
  const result = await runScript(script, {
    db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => makeLlm(config),
    real: false, annotate: false, turnJudgeReal: false,
  });
  return { result, config };
}

/** Summed core calls per her local day. */
async function callsPerDay(config: Config): Promise<number[]> {
  const rows = await getTestDb().execute(
    sql`SELECT created_at, calls FROM core_loop_trace ORDER BY created_at`,
  );
  const days = new Map<number, number>();
  for (const r of rows.rows) {
    const day = budgetDayStart(config, new Date(String(r.created_at))).getTime();
    days.set(day, (days.get(day) ?? 0) + Number(r.calls));
  }
  return [...days.values()];
}

const one = async (q: ReturnType<typeof sql>) =>
  Number((await getTestDb().execute(q)).rows[0]!.n);

test("fourteen days: every loop runs within budget and the self advances", async () => {
  const { result, config } = await run(base);
  expect(result.status, result.error ?? JSON.stringify(result.assertions)).toBe("pass");
  for (const n of await callsPerDay(config)) expect(n).toBeLessThanOrEqual(config.core.daily_call_budget);
  expect(await one(sql`SELECT count(*)::int AS n FROM core_memory WHERE payload ? 'gist_of'`)).toBeGreaterThan(0);
  expect(await one(sql`SELECT count(*)::int AS n FROM core_memory WHERE payload ? 'ruminates'`)).toBeGreaterThan(0);
  expect(await one(sql`SELECT count(*)::int AS n FROM core_goal WHERE progress > 0`)).toBeGreaterThan(0);
  const needs = (await getTestDb().execute(sql`SELECT needs FROM core_state`)).rows[0]!.needs as Record<string, number>;
  expect(Object.values(needs).some((v) => v !== config.core.state.needs_baseline)).toBe(true);
}, 600_000);

test("a budget of 6 sheds optional loops and falls back on essentials", async () => {
  const tight = { ...base, config: { ...base.config, core: { ...(base.config?.core as object), daily_call_budget: 6 } } };
  const { config } = await run(tight as Script);
  for (const n of await callsPerDay(config)) expect(n).toBeLessThanOrEqual(6);
  const statuses = await getTestDb().execute(
    sql`SELECT DISTINCT loop, status FROM core_loop_trace WHERE status IN ('skipped_budget', 'fallback')`,
  );
  const seen = statuses.rows.map((r) => `${r.loop}:${r.status}`);
  expect(seen.some((s) => /^core_(wander|anticipate|ruminate):skipped_budget$/.test(s))).toBe(true);
  expect(seen.some((s) => s.endsWith(":fallback"))).toBe(true);
}, 600_000);
```

Adjust to the real helpers:
- How `runScript` merges `script.config`: the mind-split test passes `config` from `loadConfig` and the script's `config` is merged by the runner. Mirror whatever mind-split does, and drop the manual `loadConfig(script.config)` if the runner merges it.
- The `payload` keys for gists (`gist_of`) and rumination (`ruminates`).
- The appraisal input's goal line format (`- [<id>] title …`, from `src/mind/process/core/appraise.ts:146`).

The budget-6 assertion is true by construction only if the runner meters every model call. If the per-day sum exceeds 6 because of B59 (the unlocked budget read), look at the traces first: in a single-process test it should not happen.

- [ ] **Step 3: Run it**

Run: `pnpm vitest run tests/exit/core-loops.test.ts`
Expected: PASS. Record the wall time. If a case takes longer than about two minutes, find where the hourly loop is slow (`--reporter verbose` plus timing logs) before changing anything. The fallback is advancing only through hours where something is due, recorded in the plan and in `DECISIONS.md`.

If an assertion fails, read the traces (`SELECT loop, status, outputs FROM core_loop_trace`) and fix the script data (event days, `event_probability`) before touching loop code. Content assertions failing in fake mode usually mean the script doesn't create the condition.

- [ ] **Step 4: Commit**

```bash
git add evals/scripts/core-two-weeks.yaml tests/exit/core-loops.test.ts
git commit -m "test(core): fourteen-day core loops exit with a tight-budget case"
```

---

### Task 7: The canary over every core loop

**Files:**
- Modify: `tests/exit/mind-split.test.ts`
- Modify: `tests/helpers/llm.ts` (`CapturingLLM`)

**Interfaces:**
- Consumes: the life loop now running `coreNightly` (Task 5). The mind-split script runs through `day 3 20:00` with the UTC zone, so three nights run at 03:00.

- [ ] **Step 1: Extend the test (it fails first)**

In `mind-split.test.ts`:
- Add to `CORE_PURPOSES`: `"core_reflect", "core_consolidate", "core_render_snapshot", "core_drift_watch"`.
- Add to `CORE_TABLES`: `"drift_log", "core_self_line"` (`core_goal` is already there).
- In "the capturing model echoes…", add the four nightly purposes to the probe list. Assert that the token appears in each text output: reflect's `narrative`, consolidate's `gist`, render's `Lately[0]`, and the drift watch's `findings[0].excerpt`.
- The "no core prompt saw it" test already requires each `CORE_PURPOSES` entry to have run. If `core_consolidate` makes no call (no gist group in three days), take it out of the "must have run" loop with a comment, and keep it in the probe so a future call is still covered.

Add `"core_consolidate"` to the must-have-run loop only if it really runs here.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/exit/mind-split.test.ts`
Expected: FAIL (the probe's nightly outputs don't echo the token yet).

- [ ] **Step 3: Implement the echoes in `CapturingLLM`**

Before `return super.classifyJson(request);`:

```ts
    if (canary && request.purpose === "core_reflect" && handler) {
      const out = (await handler(request.input)) as { narrative: string | null };
      return request.schema.parse({ ...out, narrative: `${out.narrative ?? "Lately"} ${canary}` });
    }
    if (canary && request.purpose === "core_consolidate" && handler) {
      const out = (await handler(request.input)) as { gist: string };
      return request.schema.parse({ ...out, gist: `${out.gist} ${canary}` });
    }
    if (canary && request.purpose === "core_render_snapshot" && handler) {
      const out = (await handler(request.input)) as { Lately: string[] };
      return request.schema.parse({ ...out, Lately: [`${out.Lately[0] ?? "Lately"} ${canary}`] });
    }
    if (canary && request.purpose === "core_drift_watch" && handler) {
      return request.schema.parse({
        findings: [{ value: "honesty", excerpt: canary, verdict: "strains" }],
      });
    }
```

The probe inputs use `TOKEN` in fixed formats. Reflect's and render's fake handlers `JSON.parse(input)` (render does) or regex the input. If a handler throws on the probe's plain-text input, make the probe input for that purpose valid JSON carrying the token (e.g. `JSON.stringify({ previous: TOKEN, sources: [{ content: TOKEN }] })`). Check the drift watch's zod output shape in `src/mind/process/core/drift-watch.ts` and match its field names exactly. Update the class doc comment's list ("…a reflection, a gist, a snapshot and a drift finding").

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/exit/mind-split.test.ts`
Expected: PASS, including "no core table holds it", which now covers `drift_log` and `core_self_line`.

- [ ] **Step 5: Commit**

```bash
git add tests/exit/mind-split.test.ts tests/helpers/llm.ts
git commit -m "test(canary): cover the nightly core loops and their tables"
```

---

### Task 8: Full verification, real-core exit and paperwork

**Files:**
- Modify: `spica-design-spec-v3.md`, `DECISIONS.md`, `CLAUDE.md`
- Modify: memory `C:\Users\ethan\.claude\projects\C--Users-ethan-projects-spica\memory\phase-4-handoff.md`
- Delete (last commit): `docs/superpowers/specs/2026-10-02-phase-8-core-loops-design.md`, `docs/superpowers/specs/2026-10-08-phase-8d-core-integration-design.md`, this plan

- [ ] **Step 1: Full green run**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass. Record the file and test counts for §20.

- [ ] **Step 2: Fake eval sanity**

Run: `pnpm eval --llm=fake --only core-two-weeks`
Expected: `PASS core-two-weeks`.

- [ ] **Step 3: Real-core exit (approved by Ethan, runs once)**

Run: `pnpm exit:core` (needs `ANTHROPIC_API_KEY` in `.env` and the eval DB `spica_eval`; create it if `assertDisposableDatabase` or the connection complains).
Expected: structural assertions pass. Note the review file `evals/results/review-<stamp>.md` and the trace `evals/results/traces/<stamp>/core-two-weeks-1.json`, plus the usage/cost summary. A structural failure under real Haiku is reported to Ethan with the trace, not patched blindly (quality isn't an exit criterion; structure is).

- [ ] **Step 4: Paperwork**

- **v3:**
  - §6.2: `fact.claim_kind`, `fact.grounded`, the `claim_kind` enum.
  - §10.3: the core recall boost and both biases.
  - §12: grounding against core and `core_self_line`.
  - §15: the inspector Core tab contents and the facts columns.
  - §17: `exit:core`, the life loop's nightly call, the `core` assertion checks.
  - §20: Phase 8 built (8d row: the fourteen-day exit and the canary over every core loop), with the test counts.
  - §21 #4: settled as the claim line.
  - §25: B53 and B54 done; new `invented_self` (guard phase).
  - Prompts `reply/v11`, `extract/v5`; config keys `retrieval.core_mood_bias`, `retrieval.core_goal_bias`, `claims.grounded_similarity`, `inspector.snapshot_versions`.
- **`DECISIONS.md`:** a dated 2026-10-08 entry with the grounding threshold 0.75 (test-phase default; tune from review runs), the inspector's 5 snapshot versions, and the hour-skipping change if Task 6 needed it.
- **`CLAUDE.md`:** current phase becomes "**Current phase: Phase 9 (user mind), not started; needs a design doc.** Phase 8 (core loops) is built." Leave the rest alone.
- **Memory:** update `phase-4-handoff.md` to say 8d merged, Phase 8 complete and Phase 9 next, and record the real-run review file path.

- [ ] **Step 5: Commit paperwork, then delete the finished docs**

```bash
git add spica-design-spec-v3.md DECISIONS.md CLAUDE.md
git commit -m "docs: record phase 8d and close phase 8"
git rm docs/superpowers/specs/2026-10-02-phase-8-core-loops-design.md docs/superpowers/specs/2026-10-08-phase-8d-core-integration-design.md docs/superpowers/plans/2026-10-08-phase-8d-core-integration.md
git commit -m "chore: prune finished phase 8 docs"
```

Then use superpowers:finishing-a-development-branch to merge `phase-8d` into main.
