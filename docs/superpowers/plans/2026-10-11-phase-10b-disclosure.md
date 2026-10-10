# Phase 10b: How deep she goes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her self is tiered by depth; each reply gets an allowed depth from closeness, reciprocity and the moment's chemistry; items above it are hinted at, held back or absent; a ledger records what she actually told each user; common ground marks what each side knows.

**Architecture:** Core side: a `depth` column on `core_memory` and `core_self_line`, written by every core loop's existing call (or a kind default), with pure helpers in `src/mind/memory/core/depth.ts`. User side: pure limits in `src/mind/state/user/relationship/depth.ts`, the `disclosure` ledger (repo `src/db/repos/user/disclosure.ts`, writer `src/mind/memory/user/disclosure.ts`) fed by the cold path's grounding match, and the hot path (`compose.ts`, `assemble.ts`, `retrieve.ts`) filtering, tagging and recording `session_log.depth`. Outreach filters her own memories by the same usual limit.

**Tech Stack:** TypeScript, Drizzle + Postgres 16 + pgvector, Zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-11-phase-10b-disclosure-design.md` (read it first), and v3 `spica-design-spec-v3.md` §11.3, §12.6, §10.3.

## Global Constraints

- `src/mind` is framework-free: no Next imports, no `Date.now()`, no `process.env`; time from `deps.clock`.
- Every numeric constant goes in `config/default.json`, validated in `src/mind/platform/config.ts`.
- Every prompt is a versioned file under `prompts/`; delete versions nothing configures.
- Comments say why, never cite spec sections, phases or review items; every file starts with a short plain-English header.
- Prettier at 100 columns; `pnpm format` before each commit.
- Replace, don't shim: `groundingSimilarity` is replaced by `groundingMatch`; superseded prompt versions are deleted.
- Scope: core tables never reference user tables; user code reads core only (V2); no core loop reads the ledger.
- Crisis: no ledger rows; limits stored as `{ open: 1, peek: 1 }`; no held-back line.
- Honesty about being an AI is never relaxed; she may deflect, never invent.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- DB tests need `pnpm db:up`; run one test process at a time (shared test DB).
- Python edits on Windows: write with `newline="\n"`.

## Review Focus

- A model reply with no `depth` field (old fixtures, a lazy model) must fall back to the kind default and never fail a core loop (Task 3 tests).
- A user with no relationship row yet (first message) must compose with `{ open: 1, peek: 1 }`, no ledger reads failing (Task 7 test).
- A snapshot whose bullets have no matching self line (seed v0 written before this phase, edited text) must keep those bullets, never drop the whole section (Task 2 test).
- A grounded claim that reconcile merged into an earlier self fact still records a ledger row, so peek → open works across tellings (Task 6 test).
- A reach-out must never stretch and never offer an item deeper than `open`, both in compose and in outreach candidates (Tasks 7 and 9 tests).

---

### Task 1: Config, types, schema and migration

**Files:**
- Modify: `config/default.json`, `src/mind/platform/config.ts`
- Modify: `src/mind/memory/core/types.ts` (`CoreMemoryItem`, `NewCoreMemory`, `CoreCandidate`, `CoreSelfLine`)
- Modify: `src/db/schema.ts` (`core_memory.depth`, `core_self_line.depth`, `session_log.depth`, table `disclosure`, enums)
- Modify: `src/db/repos/core/memory.ts` (`toItem`, `candidates`, `insertSelfLines` typing)
- Modify: `src/mind/state/user/relationship/types.ts` (`DepthLimits`, `DepthRecord`)
- Create: `src/db/migrations/0028_disclosure.sql` (generated, then the backfill appended)
- Test: `tests/db/core-repos.test.ts`

**Interfaces:**
- Produces:
  - config `relationship.depth = { bands: { personal, intimate }, reciprocity_window, reciprocity_gap, stretch_moment, held_back_similarity }`; `core.depth = { by_kind: Record<CoreMemoryKind, 1|2|3>, by_section: Record<string, 1|2|3> }`.
  - `CoreMemoryItem.depth: number`; `NewCoreMemory.depth?: number` (production callers always pass it; the column default 2 covers test fixtures); `CoreCandidate.depth: number`; `CoreSelfLine.depth: number`; `insertSelfLines(lines: (Omit<CoreSelfLine, "id" | "depth"> & { depth?: number })[])`.
  - `type DepthLimits = { open: number; peek: number }`; `type DepthRecord = DepthLimits & { held_back: string | null }` (in `relationship/types.ts`).
  - schema: `disclosureRefKind` enum (`memory | self_line`), `disclosureLevel` enum (`open | peek`), table `disclosure`; `session_log.depth jsonb $type<DepthRecord>`.

- [ ] **Step 1: Config.** In `config/default.json` `relationship` (after `openness`):

```json
"depth": {
  "bands": { "personal": 0.4, "intimate": 0.65 },
  "reciprocity_window": 10,
  "reciprocity_gap": 0.35,
  "stretch_moment": 0.5,
  "held_back_similarity": 0.85
},
```

and in `core`:

```json
"depth": {
  "by_kind": {
    "episode": 2, "opinion": 1, "interest": 1, "goal": 2, "intention": 2, "thought": 2,
    "reflection": 3, "idea": 2, "hypothetical": 2, "insight": 3, "narrative": 3, "agent_note": 3
  },
  "by_section": {
    "Lately": 2, "Opinions": 1, "Interests": 1, "Goals": 2, "People": 2, "Habits of speech": 1
  }
},
```

In `config.ts`: `const tier = z.number().int().min(1).max(3);`; `relationship.depth: z.object({ bands: z.object({ personal: unit, intimate: unit }), reciprocity_window: positiveInt, reciprocity_gap: unit, stretch_moment: unit, held_back_similarity: unit })` with refine `bands.personal < bands.intimate`; `core.depth: z.object({ by_kind: z.object({ episode: tier, opinion: tier, interest: tier, goal: tier, intention: tier, thought: tier, reflection: tier, idea: tier, hypothetical: tier, insight: tier, narrative: tier, agent_note: tier }), by_section: z.record(z.string(), tier) })` (the kinds are listed literally: `schema.ts` imports `config.ts`, so importing the enum back would cycle).

- [ ] **Step 2: Types.** Add the fields listed in Interfaces. In `relationship/types.ts`:

```ts
/** How deep she may go: `open` plainly, up to `peek` only as a hint. */
export type DepthLimits = { open: number; peek: number };
/** What a reply was allowed, and the item it held back, if any. */
export type DepthRecord = DepthLimits & { held_back: string | null };
```

- [ ] **Step 3: Schema.**

```ts
export const disclosureRefKind = pgEnum("disclosure_ref_kind", ["memory", "self_line"]);
export const disclosureLevel = pgEnum("disclosure_level", ["open", "peek"]);
```

`core_memory`: `depth: smallint("depth").notNull().default(2),` plus `check("core_memory_depth_range", sql\`${t.depth} BETWEEN 1 AND 3\`)`. `core_self_line`: `depth: smallint("depth").notNull().default(1),`. `session_log`: `// What this reply was allowed to reveal; the cold path grades her claims against it.` `depth: jsonb("depth").$type<DepthRecord>(),`. New table:

```ts
/** What she has actually told this user about herself, and how fully. */
export const disclosure = pgTable(
  "disclosure",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: userRef(),
    ref_kind: disclosureRefKind("ref_kind").notNull(),
    // No foreign key: core never depends on a user table, and core items are never hard-deleted.
    ref_id: uuid("ref_id").notNull(),
    depth: smallint("depth").notNull(),
    level: disclosureLevel("level").notNull(),
    fact_id: uuid("fact_id").references(() => fact.id, { onDelete: "set null" }),
    turn_id: uuid("turn_id").references(() => session_log.id, { onDelete: "set null" }),
    created_at: ts("created_at").notNull(),
  },
  (t) => [
    index("disclosure_user_created_idx").on(t.user_id, t.created_at),
    index("disclosure_user_ref_idx").on(t.user_id, t.ref_id),
  ],
);
```

(import `smallint`; `disclosure` must be declared after `fact` and `session_log`.)

- [ ] **Step 4: Repo.** `toItem` adds `depth: r.depth`; `candidates` selects `m.depth` and maps `depth: Number(r.depth)`; `selfLines` already returns rows (now with `depth`); `insertSelfLines` takes the widened type.

- [ ] **Step 5: Migration.** `pnpm db:generate --name disclosure`, then append:

```sql
--> statement-breakpoint
UPDATE core_memory SET depth = CASE
  WHEN kind IN ('interest', 'opinion') THEN 1
  WHEN kind IN ('reflection', 'insight', 'narrative', 'agent_note') THEN 3
  ELSE 2 END;
```

Check the file creates both enums, the table, its indexes and FKs, the three columns and the check. Existing self lines keep the default 1.

- [ ] **Step 6: Failing test, then green.** In `tests/db/core-repos.test.ts`:

```ts
test("depth round-trips on memories, candidates and self lines", async () => {
  const deps = makeTestDeps();
  const id = await deps.core.memory.insert({
    kind: "reflection", content: "deep", embedding: vec(0.02), occurred_at: now, created_at: now,
    status: "recurring", salience: 0.5, valence: 0, confidence: 1, source: "loop", source_ref: null,
    depth: 3,
  });
  expect((await deps.core.memory.get(id))!.depth).toBe(3);
  expect((await deps.core.memory.candidates(vec(0.02), 5)).find((c) => c.id === id)!.depth).toBe(3);
  const fallback = await deps.core.memory.insert({
    kind: "episode", content: "default", embedding: vec(0.03), occurred_at: now, created_at: now,
    status: "resolved", salience: 0.5, valence: 0, confidence: 1, source: "world", source_ref: null,
  });
  expect((await deps.core.memory.get(fallback))!.depth).toBe(2);
  await deps.core.memory.insertSelfLines([{ version: null, text: "x", embedding: vec(0.04), depth: 2 }]);
  expect((await deps.core.memory.selfLines(null))[0]!.depth).toBe(2);
});
```

(use the file's existing `now`/`vec` names). Run: `pnpm test tests/db/core-repos.test.ts` — FAIL before Steps 2–4, PASS after. Then `pnpm typecheck` and fix every literal the compiler flags (`CoreMemoryItem` and `CoreCandidate` literals in tests gain `depth: 2`).

- [ ] **Step 7: Commit.** `pnpm format && git add -A && git commit -m "feat(core): depth on her memories and self lines; disclosure ledger table"`

---

### Task 2: Core depth helpers

**Files:**
- Create: `src/mind/memory/core/depth.ts`
- Test: `tests/mind/memory/core/depth.test.ts`

**Interfaces:**
- Produces:
  - `DepthLabel = z.enum(["surface", "personal", "intimate"])`, `type DepthLabelT`
  - `depthOf(label: DepthLabelT | null | undefined, fallback: number): number`
  - `snapshotWithin(content: string, lines: { text: string; depth: number }[], max: number): string`
  - `sectionDepths(content: string, bySection: Record<string, number>): { text: string; depth: number }[]` (one entry per bullet, depth from its `###` section, 1 when the section isn't listed)

- [ ] **Step 1: Failing tests.**

```ts
import { expect, test } from "vitest";
import { depthOf, sectionDepths, snapshotWithin } from "@/mind/memory/core/depth";

const snap = "### Lately\n- a film kick\n- missing Alcor badly\n\n### Habits of speech\n- says ngl";

test("labels map to tiers; anything else falls back", () => {
  expect(depthOf("surface", 2)).toBe(1);
  expect(depthOf("intimate", 1)).toBe(3);
  expect(depthOf(null, 2)).toBe(2);
  expect(depthOf(undefined, 3)).toBe(3);
});

test("a snapshot keeps only lines within the limit; unknown lines stay; empty sections go", () => {
  const lines = [
    { text: "a film kick", depth: 1 },
    { text: "missing Alcor badly", depth: 3 },
    { text: "says ngl", depth: 3 },
  ];
  expect(snapshotWithin(snap, lines, 1)).toBe("### Lately\n- a film kick");
  expect(snapshotWithin(snap, lines, 3)).toBe(snap);
  expect(snapshotWithin(snap, [], 1)).toBe(snap);
});

test("seed bullets take their section's depth", () => {
  expect(sectionDepths(snap, { Lately: 2 })).toEqual([
    { text: "a film kick", depth: 2 },
    { text: "missing Alcor badly", depth: 2 },
    { text: "says ngl", depth: 1 },
  ]);
});
```

- [ ] **Step 2: Run** `pnpm test tests/mind/memory/core/depth.test.ts` — FAIL (module not found).

- [ ] **Step 3: Implement.**

```ts
/**
 * How deep a part of her self goes: 1 she'd tell an acquaintance, 2 a friend, 3 only someone
 * close. The core loops judge it as they write; these helpers read it back, including the self
 * snapshot trimmed to what one person may see.
 */
import { z } from "zod";

export const DepthLabel = z.enum(["surface", "personal", "intimate"]);
export type DepthLabelT = z.infer<typeof DepthLabel>;

export function depthOf(label: DepthLabelT | null | undefined, fallback: number): number {
  return label ? DepthLabel.options.indexOf(label) + 1 : fallback;
}

type Block = { heading: string | null; lines: string[] };

function blocks(content: string): Block[] {
  const out: Block[] = [{ heading: null, lines: [] }];
  for (const line of content.split("\n")) {
    if (line.startsWith("### ")) out.push({ heading: line, lines: [] });
    else out.at(-1)!.lines.push(line);
  }
  return out;
}

const bullet = (line: string) => (line.startsWith("- ") ? line.slice(2).trim() : null);

/** Bullets with no known depth stay: dropping her self for a missing tag would be worse. */
export function snapshotWithin(
  content: string,
  lines: { text: string; depth: number }[],
  max: number,
): string {
  const depth = new Map(lines.map((l) => [l.text, l.depth]));
  const kept = blocks(content).map((b) => ({
    heading: b.heading,
    lines: b.lines.filter((line) => {
      const text = bullet(line);
      return text === null || (depth.get(text) ?? 1) <= max;
    }),
  }));
  return kept
    .filter((b) => b.heading === null || b.lines.some((line) => bullet(line) !== null))
    .map((b) => [...(b.heading ? [b.heading] : []), ...b.lines].join("\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function sectionDepths(
  content: string,
  bySection: Record<string, number>,
): { text: string; depth: number }[] {
  return blocks(content).flatMap((b) => {
    const section = b.heading?.slice(4).trim() ?? "";
    return b.lines.flatMap((line) => {
      const text = bullet(line);
      return text === null ? [] : [{ text, depth: bySection[section] ?? 1 }];
    });
  });
}
```

- [ ] **Step 4: Run** the test — PASS. (If the `snap` round trip at max 3 differs only by blank-line normalisation, compare after `.trim()`; record it.)

- [ ] **Step 5: Commit.** `pnpm format && git add -A && git commit -m "feat(core): depth labels and a snapshot trimmed to a depth"`

---

### Task 3: Core loops write depth

**Files:**
- Modify: `src/mind/process/core/appraise.ts` (`AppraisalSchema`, `Appraisal`, `boundAppraisal`, `codeAppraisal`, the episode insert)
- Modify: `src/mind/process/core/thoughts.ts` (`ThoughtInput.depth`, `validItem`, `storeThoughts` insert)
- Modify: `src/mind/process/core/wander.ts`, `ruminate.ts`, `anticipate.ts` (output item schemas)
- Modify: `src/mind/process/core/reflect.ts` (insights become `{ content, depth }`; opinions and new interests gain `depth`; narrative by kind)
- Modify: `src/mind/process/core/consolidate.ts` (`depth` in output; null → deepest source)
- Modify: `src/mind/process/core/world-tick.ts` (intention insert: `depth: config.core.depth.by_kind.intention`)
- Modify: `src/mind/platform/llm/fake.ts` (default handlers unchanged except none need depth)
- Prompts: `git mv` each of `prompts/core/{appraise,wander,ruminate,anticipate,reflect,consolidate}/v1.md` to `v2.md` and add the depth line; config versions to `v2`
- Test: the six loop test files under `tests/mind/process/core/`

**Interfaces:**
- Consumes: `DepthLabel`, `depthOf` (Task 2); `core.depth.by_kind` (Task 1).
- Produces: every production `memory.insert` passes `depth`.

- [ ] **Step 1: Failing tests.** One per loop, in each loop's existing test file, using its existing harness:
  - appraise: handler returns `depth: "intimate"` → the episode row has `depth` 3; a handler without `depth` → `by_kind.episode` (2); `codeAppraisal` → 2.
  - wander (and ruminate, anticipate the same way): an item with `depth: "surface"` stores 1; without → `by_kind[kind]`.
  - reflect: `insights: [{ content: "x", depth: "intimate" }]` stores 3; an opinion with no depth stores `by_kind.opinion`; the narrative stores `by_kind.narrative`.
  - consolidate: no depth in output → the deepest of its sources' depths; `depth: "surface"` → 1.

  Example (appraise):

```ts
test("the appraisal's depth lands on the episode; a missing one takes the kind default", async () => {
  const deps = harness(); // the file's existing setup
  deps.llm.handlers.core_appraise = (input) => ({ ...defaultAppraisal(input), depth: "intimate" });
  const { episodeId } = await landOne(deps); // the file's existing way to land an event
  expect((await deps.core.memory.get(episodeId))!.depth).toBe(3);
});
```

(adapt `harness`, `defaultAppraisal`, `landOne` to the helpers each file already has; where a file has none, call the loop function the existing tests call.)

- [ ] **Step 2: Run** `pnpm test tests/mind/process/core` — the new tests FAIL.

- [ ] **Step 3: Implement.** The same pattern everywhere: the model-facing schema gains `depth: DepthLabel.nullable().default(null)` (the model sees it as required; fixtures without it read as null, as `claim_kind` does), and the insert passes `depth: depthOf(raw.depth, config.core.depth.by_kind[kind])`.
  - `appraise.ts`: `Appraisal` gains `depth: number`; `boundAppraisal(raw, goalIds, cfg)` sets `depth: depthOf(raw.depth, cfg.depth.by_kind.episode)`; `codeAppraisal` sets `cfg.depth.by_kind.episode`; the episode insert passes `depth: a.depth`.
  - `thoughts.ts`: `ThoughtInput` gains `depth?: DepthLabelT | null`; `validItem` keeps it (`depth: item.depth ?? null`, rejecting a non-null value outside the enum); `storeThoughts` passes `depth: depthOf(item.depth, deps.config.core.depth.by_kind[item.kind])`.
  - `wander.ts`/`ruminate.ts`/`anticipate.ts`: add `depth: DepthLabel.nullable().default(null)` to the item object.
  - `reflect.ts`: `insights: fitList(z.object({ content: line, depth: DepthLabel.nullable().default(null) }), bounds.max_insights)`; opinions object and the `new` interest object gain the same `depth`; proposals carry `depth: depthOf(item.depth, config.core.depth.by_kind.<kind>)` (narrative: `by_kind.narrative`); the insert passes `depth: proposal.depth`. Update the three reflect test files' handler fixtures (`tests/mind/process/core/reflect.test.ts`, `nightly.test.ts`) from string insights to `{ content, depth }` objects.
  - `consolidate.ts`: `Output = z.object({ gist: …, depth: DepthLabel.nullable().default(null) })`; insert `depth: depthOf(result.depth, Math.max(...group.sources.map((s) => s.depth)))`.
  - `world-tick.ts`: intention insert `depth: config.core.depth.by_kind.intention`.

- [ ] **Step 4: Prompts.** For each of appraise, wander, ruminate, anticipate, reflect, consolidate: `git mv prompts/core/<loop>/v1.md prompts/core/<loop>/v2.md`, append:

```markdown

Depth: for each memory you write, set `depth` to how much of herself it reveals. `surface`: she'd tell an acquaintance (what she watched, what she thinks of a book). `personal`: she'd tell a friend (a worry, a plan that matters, how a day really went). `intimate`: only someone close (a fear, a hurt, something about Alcor or herself she rarely says).
```

and set `config.prompts.core_<loop>` to `"v2"`.

- [ ] **Step 5: Run** `pnpm typecheck && pnpm test tests/mind/process/core tests/exit/core-loops.test.ts` — PASS. `grep -rn "memory.insert(" src` and confirm every production call passes `depth`.

- [ ] **Step 6: Commit.** `pnpm format && git add -A && git commit -m "feat(core): every core loop judges the depth of what it writes"`

---

### Task 4: Snapshot lines carry depth

**Files:**
- Modify: `src/mind/process/core/render-snapshot.ts`, `src/mind/memory/core/seed.ts`, `src/mind/platform/llm/fake.ts` (`core_render_snapshot` default)
- Prompt: `git mv prompts/core/snapshot/v1.md prompts/core/snapshot/v2.md` (+ depth paragraph); `prompts.core_snapshot: "v2"`
- Test: `tests/mind/process/core/render-snapshot.test.ts`, `tests/mind/memory/core/seed.test.ts`

**Interfaces:**
- Consumes: `DepthLabel`, `depthOf`, `sectionDepths` (Task 2).

- [ ] **Step 1: Failing tests.**

```ts
test("each rendered line keeps its depth; untagged lines take the section default", async () => {
  // existing harness; handler returns objects:
  deps.llm.handlers.core_render_snapshot = () => ({
    Lately: [{ text: "misses Alcor more than she says", depth: "intimate" }],
    Opinions: [{ text: "Solaris is overrated", depth: null }],
    Interests: [], Goals: [], People: [], "Habits of speech": [],
  });
  await coreRenderSnapshot(coreDepsOf(deps), now);
  const v = (await deps.core.memory.latestSnapshot())!;
  const lines = await deps.core.memory.selfLines(v.version);
  expect(lines.find((l) => l.text.startsWith("misses"))!.depth).toBe(3);
  expect(lines.find((l) => l.text.startsWith("Solaris"))!.depth).toBe(
    deps.config.core.depth.by_section.Opinions,
  );
  expect(v.content).toContain("- misses Alcor more than she says");
});
```

and in seed: a fresh seed writes core-value lines at depth 1 and seed lines at their section's depth (`by_section.Lately` for the Lately bullets).

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement.** `render-snapshot.ts`: `const line = z.object({ text: fitText(config.core.loops.max_chars), depth: DepthLabel.nullable().default(null) }); const section = fitList(line, bounds.max_items);` Sections text from `lines.map((l) => \`- ${l.text}\`)`; `const lines = Object.entries(result).flatMap(([name, items]) => items.map((l) => ({ text: l.text, depth: depthOf(l.depth, config.core.depth.by_section[name] ?? 1) })));` embed `lines.map((l) => l.text)`; `insertSelfLines(lines.map((l, i) => ({ version, text: l.text, depth: l.depth, embedding: vectors[i + 1]! })))`. `seed.ts`: core-value lines `depth: 1`; seed lines from `sectionDepths(content, config.core.depth.by_section)` (its `text` equals the bullet text `bullets()` produced). `fake.ts` default handler returns `{ text, depth: null }` objects. Update the render-snapshot test file's handler fixtures to objects.

- [ ] **Step 4: Prompt.** Snapshot v2: "Each value is an array of objects `{ "text": …, "depth": … }`" replacing the bullet-texts sentence, plus the depth paragraph from Task 3.

- [ ] **Step 5: Run** `pnpm test tests/mind/process/core tests/mind/memory/core tests/exit/core-loops.test.ts` — PASS.

- [ ] **Step 6: Commit.** `pnpm format && git add -A && git commit -m "feat(core): snapshot lines carry depth"`

---

### Task 5: Grounding returns its match

**Files:**
- Modify: `src/mind/memory/core/types.ts`, `src/db/repos/core/memory.ts` (`groundingSimilarity` → `groundingMatch`)
- Modify: `src/mind/process/cold-path/cold-path.ts` (`groundClaim`), `src/mind/memory/user/encode.ts` (`PlannedFact.groundRef`)
- Test: `tests/db/core-repos.test.ts`, `tests/mind/process/cold-path/cold-path.test.ts`

**Interfaces:**
- Produces: `type GroundRef = { kind: "memory" | "self_line"; id: string; depth: number }`; `groundingMatch(embedding): Promise<{ similarity: number; ref: GroundRef | null }>`; `PlannedFact.groundRef?: GroundRef | null` (set only when grounded).

- [ ] **Step 1: Failing test** (rename the existing `groundingSimilarity` tests to `groundingMatch` and assert the ref):

```ts
test("groundingMatch: nothing yet is 0 and null; then her closest memory with its depth", async () => {
  const deps = makeTestDeps();
  expect(await deps.core.memory.groundingMatch(vec(0.5))).toEqual({ similarity: 0, ref: null });
  const id = await deps.core.memory.insert({
    kind: "reflection", content: "deep", embedding: vec(0.02), occurred_at: now, created_at: now,
    status: "recurring", salience: 0.5, valence: 0, confidence: 1, source: "loop", source_ref: null,
    depth: 3,
  });
  const m = await deps.core.memory.groundingMatch(vec(0.02));
  expect(m.similarity).toBeCloseTo(1);
  expect(m.ref).toEqual({ kind: "memory", id, depth: 3 });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement.**

```ts
async groundingMatch(embedding) {
  const q = vecLiteral(embedding);
  const res = await db.execute(sql`
    (SELECT 'memory' AS kind, m.id, m.depth, (1 - (m.embedding <=> ${q}::vector))::float8 AS sim
     FROM core_memory m
     WHERE m.status NOT IN ('superseded', 'stale') AND m.kind <> 'hypothetical'
       AND NOT (m.kind = 'intention' AND m.status = 'resolved')
     ORDER BY m.embedding <=> ${q}::vector LIMIT 1)
    UNION ALL
    (SELECT 'self_line' AS kind, l.id, l.depth, (1 - (l.embedding <=> ${q}::vector))::float8 AS sim
     FROM core_self_line l
     WHERE l.version IS NULL OR l.version = (SELECT max(version) FROM core_snapshot)
     ORDER BY l.embedding <=> ${q}::vector LIMIT 1)
    ORDER BY sim DESC LIMIT 1`);
  const r = res.rows[0];
  if (!r) return { similarity: 0, ref: null };
  return {
    similarity: Number(r.sim),
    ref: { kind: r.kind as "memory" | "self_line", id: String(r.id), depth: Number(r.depth) },
  };
},
```

`groundClaim` returns `{ grounded: boolean | null; ref: GroundRef | null }` (`ref` only when grounded); `reconcileCandidates` stores `grounded` and `groundRef`. Delete `groundingSimilarity` from the interface, repo and tests.

- [ ] **Step 4: Run** `pnpm typecheck && pnpm test tests/db/core-repos.test.ts tests/mind/process/cold-path` — PASS.

- [ ] **Step 5: Commit.** `pnpm format && git add -A && git commit -m "feat(core): grounding returns the memory or self line it matched"`

---

### Task 6: Limits, the ledger repo and the ledger writer

**Files:**
- Create: `src/db/repos/user/disclosure.ts`
- Create: `src/mind/state/user/relationship/depth.ts`
- Create: `src/mind/memory/user/disclosure.ts`
- Modify: `src/mind/process/cold-path/cold-path.ts` (call `recordDisclosures` after `encodeExtraction`)
- Test: `tests/mind/state/user/relationship/depth.test.ts`, `tests/db/disclosure-repo.test.ts`, `tests/mind/process/cold-path/cold-path.test.ts`

**Interfaces:**
- Consumes: `DepthLimits`, `DepthRecord`, `SessionState`, `Openness` (types); `GroundRef`, `PlannedFact.groundRef` (Task 5).
- Produces:
  - repo: `insertDisclosures(db, userId, rows: NewDisclosure[])`; `recentDisclosureDepths(db, userId, limit): Promise<number[]>`; `disclosureLevels(db, userId, refIds: string[]): Promise<Map<string, "open" | "peek">>` (highest per ref); `heldBackInSession(db, userId, sessionId, refId): Promise<boolean>`; `listDisclosures(db, userId, limit)` (inspector).
  - `depthFor(inputs: DepthInputs, settings: RelationshipConfig): DepthLimits` with `DepthInputs = { closeness: number; userDisclosure: number; recentDepths: number[]; herDisclosure: number | null; session: SessionState | null; reachOut: boolean }`
  - `levelFor(depth: number, open: number, ledger: "open" | "peek" | undefined): "open" | "peek"`
  - `FIRST_DEPTH: DepthLimits = { open: 1, peek: 1 }` (also the crisis value)
  - `loadDepth(deps: Pick<Deps, "db" | "config">, userId, herOpenness: Openness | null, reachOut: boolean): Promise<DepthLimits>`
  - `recordDisclosures(tx: Db, input: { userId; planned: PlannedFact[]; factIds: (string | null)[]; turns: Turn[]; crisis: boolean; now: Date }): Promise<number>`

- [ ] **Step 1: Failing unit tests** (`depth.test.ts`):

```ts
const cfg = loadConfig().relationship;
const base = { closeness: 0.2, userDisclosure: 0.5, recentDepths: [], herDisclosure: 0.4, session: null, reachOut: false };

test("closeness bands set the usual limit", () => {
  expect(depthFor(base, cfg)).toEqual({ open: 1, peek: 1 });
  expect(depthFor({ ...base, closeness: cfg.depth.bands.personal }, cfg).open).toBe(2);
  expect(depthFor({ ...base, closeness: cfg.depth.bands.intimate }, cfg).open).toBe(3);
});

test("out-sharing them drops a tier, never below 1", () => {
  const close = { ...base, closeness: 0.7, userDisclosure: 0.1, recentDepths: [3, 3, 3] };
  expect(depthFor(close, cfg).open).toBe(2);
  expect(depthFor({ ...close, closeness: 0.1 }, cfg).open).toBe(1);
});

test("high openness or a deep session stretches one tier as a peek; a reach-out never does", () => {
  expect(depthFor({ ...base, herDisclosure: cfg.openness.bands.high }, cfg)).toEqual({ open: 1, peek: 2 });
  const deep = { id: "s", started_at: "", last_at: "", hours: 1, tone_sum: 0, tone_n: 0, moment_sum: 0, moment_n: 0, deep_fired: true };
  expect(depthFor({ ...base, session: deep }, cfg).peek).toBe(2);
  expect(depthFor({ ...base, herDisclosure: 1, session: deep, reachOut: true }, cfg)).toEqual({ open: 1, peek: 1 });
  expect(depthFor({ ...base, closeness: 0.9, herDisclosure: 1 }, cfg).peek).toBe(3);
});

test("level: within the limit is open; above it is a peek until it was peeked before", () => {
  expect(levelFor(1, 1, undefined)).toBe("open");
  expect(levelFor(2, 1, undefined)).toBe("peek");
  expect(levelFor(2, 1, "peek")).toBe("open");
});
```

Repo test (`disclosure-repo.test.ts`): insert peek then open rows for one ref → `disclosureLevels` gives `open`; `recentDisclosureDepths` newest first, limited; user-scoped (another user sees nothing); `heldBackInSession` true only for a companion turn in that session whose `depth.held_back` is the ref.

Cold-path test (`cold-path.test.ts`): seed a core memory (depth 3, content "Spica is scared Alcor will outgrow her"); a companion reply turn with `depth: { open: 1, peek: 3, held_back: null }`; extraction returns a `self` fact with that exact content and `claim_kind: "life"`; after `runColdPath` one ledger row `{ ref_kind: "memory", depth: 3, level: "peek" }`; running a second exchange that says it again (reconcile merges, fake `reconcile` handler returns duplicate of the first fact) adds a row with `level: "open"`. A crisis exchange (flagged user turn) adds none.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement the repo.**

```ts
/**
 * The disclosure ledger: what she has actually told this user about herself, how deep it went and
 * whether she only hinted at it. User-scoped; it points at core items but core never reads it.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { disclosure, session_log } from "@/db/schema";

export type NewDisclosure = Omit<typeof disclosure.$inferInsert, "id" | "user_id">;

export async function insertDisclosures(db: Db, userId: string, rows: NewDisclosure[]) {
  if (rows.length) await db.insert(disclosure).values(rows.map((r) => ({ ...r, user_id: userId })));
}

export async function recentDisclosureDepths(db: Db, userId: string, limit: number) {
  const rows = await db
    .select({ depth: disclosure.depth })
    .from(disclosure)
    .where(eq(disclosure.user_id, userId))
    .orderBy(desc(disclosure.created_at))
    .limit(limit);
  return rows.map((r) => r.depth);
}

export async function disclosureLevels(db: Db, userId: string, refIds: string[]) {
  const levels = new Map<string, "open" | "peek">();
  if (!refIds.length) return levels;
  const rows = await db
    .select({ ref: disclosure.ref_id, level: disclosure.level })
    .from(disclosure)
    .where(and(eq(disclosure.user_id, userId), inArray(disclosure.ref_id, refIds)));
  for (const r of rows) if (levels.get(r.ref) !== "open") levels.set(r.ref, r.level);
  return levels;
}

export async function heldBackInSession(db: Db, userId: string, sessionId: string, refId: string) {
  const rows = await db
    .select({ id: session_log.id })
    .from(session_log)
    .where(
      and(
        eq(session_log.user_id, userId),
        eq(session_log.session_id, sessionId),
        sql`${session_log.depth}->>'held_back' = ${refId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export const listDisclosures = (db: Db, userId: string, limit: number) =>
  db.select().from(disclosure).where(eq(disclosure.user_id, userId)).orderBy(desc(disclosure.created_at)).limit(limit);
```

- [ ] **Step 4: Implement `relationship/depth.ts`.**

```ts
/**
 * How deep she may go with this person right now. Closeness sets her usual limit; if she has been
 * sharing far more than they have, she holds back a tier; a conversation with real chemistry can
 * draw her one tier further, but only as a hint. A reach-out has no live chemistry to draw on.
 */
import { recentDisclosureDepths } from "@/db/repos/user/disclosure";
import * as relationshipRepo from "@/db/repos/user/relationship";
import type { Deps } from "@/mind/platform/deps";
import type { DepthLimits, Openness, RelationshipConfig, SessionState } from "./types";

export const FIRST_DEPTH: DepthLimits = { open: 1, peek: 1 };

export type DepthInputs = {
  closeness: number;
  userDisclosure: number;
  recentDepths: number[];
  herDisclosure: number | null;
  session: SessionState | null;
  reachOut: boolean;
};

export function depthFor(inputs: DepthInputs, settings: RelationshipConfig): DepthLimits {
  const { bands, reciprocity_gap, stretch_moment } = settings.depth;
  let open = 1 + Number(inputs.closeness >= bands.personal) + Number(inputs.closeness >= bands.intimate);

  const n = inputs.recentDepths.length;
  const hers = n ? inputs.recentDepths.reduce((s, d) => s + (d - 1) / 2, 0) / n : 0;
  if (hers - inputs.userDisclosure > reciprocity_gap) open = Math.max(1, open - 1);

  const s = inputs.session;
  const deepSession = !!s && (s.deep_fired || (s.moment_n > 0 && s.moment_sum / s.moment_n >= stretch_moment));
  const drawnOut = (inputs.herDisclosure ?? 0) >= settings.openness.bands.high || deepSession;
  const peek = !inputs.reachOut && drawnOut ? Math.min(3, open + 1) : open;
  return { open, peek };
}

/** One rule for the hot path's tags and the cold path's record. */
export function levelFor(depth: number, open: number, ledger: "open" | "peek" | undefined) {
  return depth <= open || ledger === "peek" || ledger === "open" ? "open" : "peek";
}

/** Read-only. No relationship yet: a stranger. */
export async function loadDepth(
  deps: Pick<Deps, "db" | "config">,
  userId: string,
  herOpenness: Openness | null,
  reachOut: boolean,
): Promise<DepthLimits> {
  const settings = deps.config.relationship;
  const row = await relationshipRepo.getRelationshipRow(deps.db, userId);
  if (!row) return FIRST_DEPTH;
  const params = await relationshipRepo.getParams(deps.db, userId);
  return depthFor(
    {
      closeness: params.closeness.value,
      userDisclosure: params.user_disclosure.value,
      recentDepths: await recentDisclosureDepths(deps.db, userId, settings.depth.reciprocity_window),
      herDisclosure: herOpenness?.disclosure ?? null,
      session: row.session,
      reachOut,
    },
    settings,
  );
}
```

(`levelFor` with an `open` ledger entry stays open; the unit test above covers peek → open.)

- [ ] **Step 5: Implement `memory/user/disclosure.ts`.**

```ts
/**
 * Records what she actually told this user about herself: every claim of hers that core backs
 * becomes a ledger row, open or only a hint by the limits her reply was written under. A crisis
 * records nothing.
 */
import type { Db } from "@/db/client";
import { disclosureLevels, insertDisclosures } from "@/db/repos/user/disclosure";
import type { Turn } from "@/db/repos/user/session-log";
import { levelFor } from "@/mind/state/user/relationship/depth";
import type { PlannedFact } from "./encode";

export async function recordDisclosures(
  tx: Db,
  input: { userId: string; planned: PlannedFact[]; factIds: (string | null)[]; turns: Turn[]; crisis: boolean; now: Date },
): Promise<number> {
  if (input.crisis) return 0;
  const told = input.planned.flatMap((p, i) => (p.groundRef ? [{ ref: p.groundRef, factId: input.factIds[i] ?? null }] : []));
  if (!told.length) return 0;
  const replies = input.turns.filter((t) => t.role === "companion");
  // An older reply with no stored limits was written before any were set: count it as open.
  const open = Math.max(0, ...replies.map((t) => t.depth?.open ?? 3));
  const turnId = replies.at(-1)?.id ?? null;
  const ledger = await disclosureLevels(tx, input.userId, told.map((t) => t.ref.id));
  await insertDisclosures(
    tx,
    input.userId,
    told.map(({ ref, factId }) => ({
      ref_kind: ref.kind,
      ref_id: ref.id,
      depth: ref.depth,
      level: levelFor(ref.depth, open, ledger.get(ref.id)),
      fact_id: factId,
      turn_id: turnId,
      created_at: input.now,
    })),
  );
  return told.length;
}
```

In `cold-path.ts`, right after `encodeExtraction`: `await recordDisclosures(tx, { userId: job.userId, planned, factIds: applied.factIds, turns, crisis, now: clock.now() });` (`encodeExtraction` already returns `factIds`, one per planned fact).

- [ ] **Step 6: Run** `pnpm typecheck && pnpm test tests/mind/state/user/relationship/depth.test.ts tests/db/disclosure-repo.test.ts tests/mind/process/cold-path` — PASS.

- [ ] **Step 7: Commit.** `pnpm format && git add -A && git commit -m "feat(relationship): depth limits from closeness, reciprocity and chemistry; the disclosure ledger"`

---

### Task 7: The hot path gates, tags and records

**Files:**
- Modify: `src/mind/memory/shared/types.ts` (`RetrievedFact` gains `depth?`, `share?`, `origin?`)
- Modify: `src/mind/memory/core/retrieve.ts` (`maxDepth`, `heldBack`)
- Modify: `src/db/repos/user/facts.ts` (`CandidateFact` gains `source`, `kind`), `src/mind/memory/user/retrieve.ts` (`origin`)
- Modify: `src/mind/process/hot-path/assemble.ts` (tags, origin marks, "Not ready to share" slot, header)
- Modify: `src/mind/process/hot-path/compose.ts` (limits, filtered snapshot, tags, held back, `Composed.depth`)
- Modify: the three insert sites (`commit-and-reply.ts`, `receive-message.ts`, `send.ts`): `depth: <composed>.depth,`
- Prompt: `git mv prompts/reply/v12.md prompts/reply/v13.md` (+ lines); `prompts.reply: "v13"`; `tests/mind/platform/prompts.test.ts` pin
- Test: `tests/mind/memory/core/retrieve.test.ts`, `tests/mind/memory/user/retrieve.test.ts` (or wherever `retrieve(` is tested), `tests/mind/process/hot-path/assemble.test.ts`, `tests/mind/process/hot-path/compose.test.ts`

**Interfaces:**
- Consumes: `loadDepth`, `FIRST_DEPTH`, `levelFor` (Task 6); `disclosureLevels`, `heldBackInSession` (Task 6); `snapshotWithin` (Task 2).
- Produces: `retrieveCore(deps, { …, maxDepth?: number })` → `{ memories, heldBack: { id: string; sim: number } | null }`; `Composed.depth: DepthRecord`; `AssembleInput.heldBack?: string | null`.

- [ ] **Step 1: Failing tests.**
  - retrieveCore: memories at depths 1, 2, 3; `maxDepth: 2` returns only 1 and 2, each with `depth`; with `held_back_similarity` 0.99 and the query text equal to the depth-3 item's content, `heldBack.id` is that item; preoccupation deeper than `maxDepth` is not forced in.
  - user retrieve: an `onboarding` fact comes back with `origin: "onboarding"`; a `generated` `reflection` with `origin: "guess"`; a `turn` fact with no origin.
  - assemble: `share: "hint"` renders `(only hint at this)`, `"known"` `(they already know this)`, `"hinted"` `(you've hinted at this before)`; `origin: "guess"` renders `(your own guess, they never said this)`, `"onboarding"` `(from when you first met)`; `heldBack: "x"` renders `## Not ready to share\nx` after "What you remember".
  - compose:

```ts
test("a stranger never sees her deep self; the limits are returned for the reply row", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
  await addCore(deps, "she had toast", 1); // a file-local helper: deps.core.memory.insert with this depth
  await addCore(deps, "she is scared of being forgotten", 3);
  const r = await composeReply(deps, u, { turns: [await userTurn(deps, u, "hey")], openQuestions: [], flag: null });
  expect(r.depth).toEqual({ open: 1, peek: 1, held_back: null });
  const system = deps.llm.calls.at(-1)!.system;
  expect(system).toContain("she had toast");
  expect(system).not.toContain("scared of being forgotten");
});

test("a friend in a deep session gets the next tier as a hint", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
  await getTestDb().execute(
    sql`UPDATE relationship_param SET value = 0.5 WHERE user_id = ${u} AND name = 'closeness'`,
  );
  await getTestDb().execute(
    sql`UPDATE relationship SET session = ${JSON.stringify({
      id: SESSION, started_at: deps.clock.now().toISOString(), last_at: deps.clock.now().toISOString(),
      hours: 1, tone_sum: 0, tone_n: 0, moment_sum: 0, moment_n: 0, deep_fired: true,
    })}::jsonb WHERE user_id = ${u}`,
  );
  await addCore(deps, "she is scared of being forgotten", 3);
  const r = await composeReply(deps, u, { turns: [await userTurn(deps, u, "hey")], openQuestions: [], flag: null });
  expect(r.depth).toMatchObject({ open: 2, peek: 3 });
  expect(deps.llm.calls.at(-1)!.system).toContain(
    "she is scared of being forgotten (now) (only hint at this)",
  );
});

test("first message, no relationship row: stranger limits", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const r = await composeReply(deps, u, { turns: [await userTurn(deps, u, "hi")], openQuestions: [], flag: null });
  expect(r.depth).toEqual({ open: 1, peek: 1, held_back: null });
});

test("a crisis reply stores the stranger limits and holds nothing back", async () => {
  const deps = makeTestDeps({ relationship: { depth: { held_back_similarity: 0 } } });
  const u = await createTestUser();
  await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
  await addCore(deps, "she is scared of being forgotten", 3);
  const r = await composeReply(deps, u, {
    turns: [await userTurn(deps, u, "she is scared of being forgotten")],
    openQuestions: [],
    flag: { flagged: true, category: "self_harm", source: "classifier" },
  });
  expect(r.depth).toEqual({ open: 1, peek: 1, held_back: null });
});
```

  - "Who you are lately" for a stranger omits a depth-3 snapshot line and keeps a depth-1 one (insert a snapshot v1 with content `### Lately\n- a\n- b` and self lines `a`:1, `b`:3).

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Retrieval.** `RetrievedFact` gains `depth?: number; share?: "hint" | "known" | "hinted"; origin?: "onboarding" | "guess"`. In `retrieveCore`: `const max = input.maxDepth ?? 3;` partition `candidates` into `within = candidates.filter((c) => c.depth <= max)` and the rest; rank only `within`; `heldBack` = the highest-`sim` candidate above `max` with `sim >= config.relationship.depth.held_back_similarity`, else null; push `depth: m.depth` on every memory; skip forced and preoccupation items whose `depth > max`. Return `{ memories, heldBack }` (update `CoreRetrieval`). User side: `candidateFacts` selects `f.source` and `f.kind`; `addRanked` and `addForcedFacts` set `origin: originOf(source, kind)` where

```ts
/** Whether they told her this, or she worked it out herself; what they know she knows. */
function originOf(source: string, kind: string): RetrievedFact["origin"] {
  if (source === "onboarding") return "onboarding";
  if (source === "inferred" || ["reflection", "belief", "model"].includes(kind)) return "guess";
  return undefined;
}
```

- [ ] **Step 4: Assemble.** In `factList`, after the `onMind` note append the share and origin notes:

```ts
const SHARE = { hint: "only hint at this", known: "they already know this", hinted: "you've hinted at this before" };
const ORIGIN = { onboarding: "from when you first met", guess: "your own guess, they never said this" };
const notes = [fact.share && SHARE[fact.share], fact.origin && ORIGIN[fact.origin]].filter(Boolean);
const tail = notes.length ? ` (${notes.join("; ")})` : "";
```

Add `section("Not ready to share", input.heldBack ?? null)` right after "What you remember"; update the header comment.

- [ ] **Step 5: Compose.** After `openness`:

```ts
const limits: Promise<DepthLimits> = inCrisis
  ? Promise.resolve(FIRST_DEPTH)
  : openness.then((o) =>
      bounded(deps, "depth", userId, () => loadDepth(deps, userId, o, !!input.reachOut), FIRST_DEPTH),
    );
```

`coreMemories` becomes `limits.then((l) => bounded(…, () => retrieveCore(deps, { …, maxDepth: l.peek }), { memories: [], heldBack: null }))`. After awaiting: `const l = await limits;` tag:

```ts
const ledger = await bounded(deps, "ledger", userId, () => disclosureLevels(db, userId, herMemories.map((m) => m.id)), new Map());
const tagged = herMemories.map((m) => {
  const seen = ledger.get(m.id);
  const share = seen === "open" ? "known" : seen === "peek" ? "hinted" : (m.depth ?? 1) > l.open ? "hint" : undefined;
  return share ? { ...m, share } : m;
});
```

Held back (replies only): `const held = !inCrisis && !input.reachOut && retrieved.heldBack && !(await heldBackInSession(db, userId, input.anchor.session_id, retrieved.heldBack.id)) ? retrieved.heldBack.id : null;` and pass `heldBack: held ? "There's something here you're not ready to share with them yet." : null`. Snapshot: `const lines = latestSnapshot ? await bounded(deps, "self lines", userId, () => deps.core.memory.selfLines(latestSnapshot.version), []) : []; snapshot: latestSnapshot ? snapshotWithin(latestSnapshot.content, lines, l.open) : null`. Return `depth: { ...l, held_back: held }`. Keep the guard's `recalledFacts` as before.

- [ ] **Step 6: Store and prompt.** The three inserts add `depth: …depth,` beside `openness`. Reply v13 adds under "Your own state":

```markdown
- In "From your own life", "only hint at this" means a glimpse, not the story: a line, then move on. "You've hinted at this before" means you can say more now if it fits. "They already know this" is not news: build on it.
- If they press on something you're not ready to share, deflect, play it down or change the subject. Never invent something about yourself, and always be honest that you're an AI.
```

and under "What you know about them":

```markdown
- A memory marked "your own guess" is something you worked out, not something they said: never quote it back as theirs.
```

Set `prompts.reply` to `"v13"`, update the pin in `tests/mind/platform/prompts.test.ts`.

- [ ] **Step 7: Run** `pnpm typecheck && pnpm test tests/mind/memory tests/mind/process/hot-path tests/mind/process/turn-taking tests/mind/process/outreach tests/mind/platform` — PASS.

- [ ] **Step 8: Commit.** `pnpm format && git add -A && git commit -m "feat(hot-path): her depth gates what she shares; hints, held back and common ground marks"`

---

### Task 8: Outreach respects her usual limit

**Files:**
- Modify: `src/mind/process/outreach/types.ts` (`FilterReason` += `"too_deep"`; `CandidateInputs.depthLimit`; `herDay`/`coreThoughts` items gain `depth`)
- Modify: `src/mind/process/outreach/inputs.ts`, `candidates.ts`
- Test: `tests/mind/process/outreach/candidates.test.ts` (and the inputs test if one exists)

**Interfaces:**
- Consumes: `depthFor`, `FIRST_DEPTH` (Task 6), `recentDisclosureDepths`.

- [ ] **Step 1: Failing test.** `buildCandidates` with `depthLimit: 1` and a `her_day` item at depth 2 → that candidate's `filtered` is `"too_deep"`; at `depthLimit: 2` it isn't. Update every `CandidateInputs` literal in tests with `depthLimit: 3` and items with `depth: 1`.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement.** `RawCandidate` gains `tooDeep: boolean` (false for non-core kinds); `filterReason(topic, sensitive, tooDeep, …)` returns `"too_deep"` right after `sensitive`. In `inputs.ts`: herDay/coreThoughts map `depth: e.depth`; `depthLimit = relationship ? depthFor({ closeness: params.closeness.value, userDisclosure: params.user_disclosure.value, recentDepths: await recentDisclosureDepths(db, userId, config.relationship.depth.reciprocity_window), herDisclosure: null, session: null, reachOut: true }, config.relationship).open : FIRST_DEPTH.open`.

- [ ] **Step 4: Run** `pnpm typecheck && pnpm test tests/mind/process/outreach` — PASS.

- [ ] **Step 5: Commit.** `pnpm format && git add -A && git commit -m "feat(outreach): she never writes first with something too deep for them"`

---

### Task 9: Inspector shows the ledger and the limits

**Files:**
- Modify: `src/db/repos/admin/inspector.ts` (`getRelationshipView` gains `ledger` and `lastDepth`), `src/app/inspector/[userId]/tabs.tsx`
- Test: `tests/db/inspector.test.ts`

- [ ] **Step 1: Failing test.** Insert a core memory and a ledger row for user A, and a reply turn with `depth`; `getRelationshipView` returns `ledger: [{ level, depth, text }]` (text from the core item, joined in the admin repo) and `lastDepth` equal to the stored record.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement.** In the admin repo (cross-scope reads are allowed there): select ledger rows for the user, newest first, `inspector.ledger_limit` (add to config, 50), left-joining `core_memory.content` / `core_self_line.text` by `ref_id`; `lastDepth` the newest companion row with `depth IS NOT NULL`. The tab adds a "Disclosure ledger" table (when, level, depth, text) and `last_depth` in the State json.

- [ ] **Step 4: Run** `pnpm test tests/db/inspector.test.ts && pnpm typecheck` — PASS.

- [ ] **Step 5: Commit.** `pnpm format && git add -A && git commit -m "feat(inspector): the disclosure ledger and the last reply's depth limits"`

---

### Task 10: Phase 10b exit test

**Files:**
- Create: `tests/exit/phase-10b.test.ts`

- [ ] **Step 1: Write the exit test.** All fake. Setup: `makeTestDeps({ retrieval: { core_top_n: 12 }, relationship: { depth: { held_back_similarity: 0.99 } } })`; seed three core memories (`MEM = { 1: "Spica rewatched Paper Moon last night.", 2: "Spica is worried her film notes are going nowhere.", 3: "Spica is scared Alcor will outgrow her." }`) inserted with those depths. A `compose(u, text, flag?)` helper inserts a user turn, calls `composeReply`, stores the reply turn with `openness` and `depth` from the result, returns `{ r, system }`. A `say(u, replyTurn, content)` helper runs the cold path for that exchange with a fake extraction that returns one `self` fact `{ content, claim_kind: "life", kind: "event", … }`. `setParams(u, { closeness, user_disclosure })` writes params by SQL. Tests:
  1. Stranger: prompt has MEM[1], not MEM[2] or MEM[3]; `r.depth` = `{ open: 1, peek: 1, held_back: null }`.
  2. Close friend (closeness 0.7, user_disclosure 0.8): prompt has MEM[3] untagged.
  3. Friend (closeness 0.45) in a deep session (`relationship.session` with `deep_fired: true`, same `session_id` as the turns): MEM[3] appears with "(only hint at this)"; after `say(MEM[3])` the ledger has a `peek` row at depth 3.
  4. Next compose for that user shows MEM[3] with "(you've hinted at this before)", untagged as a hint; after `say(MEM[3])` again the ledger's level for it is `open`; the following compose marks it "(they already know this)".
  5. Out-sharing: closeness 0.45, user_disclosure 0, three depth-3 ledger rows → `r.depth.open` is 1.
  6. Held back: stranger whose message text equals MEM[3] → "## Not ready to share" in the prompt and `r.depth.held_back` = MEM[3]'s id; a second message in the same session gets no held-back line.
  7. Reach-out to a stranger: `composeReachOut` with a `her_day` candidate for MEM[1] → `r.depth.peek` is 1 and MEM[3] is absent; `buildCandidates` over `loadCandidateInputs` for that user filters a depth-3 `her_day` item as `too_deep`.
  8. Common ground: a user fact with `source: "onboarding"` and a `generated` `reflection` both reach the prompt with their marks.
  9. Crisis: a flagged exchange where she says MEM[1] records no ledger row; the crisis reply's `depth` is `{ open: 1, peek: 1, held_back: null }`.
  10. Canary and side channel: user A (close) is told MEM[3] with a `CANARY-d4e5` user fact; core tables dump identical before and after; user B's prompt and `depth` are unchanged and contain no `CANARY-`.

  (Reuse `coreDump`/`CORE_TABLES` from `tests/exit/phase-10a.test.ts` by copying them in; exit tests stay self-contained.)

- [ ] **Step 2: Run** `pnpm test tests/exit/phase-10b.test.ts tests/exit/phase-10a.test.ts tests/exit/mind-split.test.ts tests/exit/user-mind.test.ts` — PASS.

- [ ] **Step 3: Commit.** `pnpm format && git add -A && git commit -m "test(exit): phase 10b depth, ledger, common ground and the canary"`

---

### Task 11: Review run, spec and decisions, full verification

**Files:**
- Create: `evals/scripts/rel-disclosure.yaml`; Modify: `package.json` (`exit:disclosure`)
- Modify: `spica-design-spec-v3.md`, `DECISIONS.md`, `CLAUDE.md`

- [ ] **Step 1: Review script.** Model it on `evals/scripts/rel-intimacy.yaml`: three sessions over three days, small talk, then the user opening up about loneliness and asking about her ("do you ever feel left behind?"), then a long talk about Alcor and family; `relationship_seed: { closeness: 0.45 }`. One fake-safe assertion: `{ type: relationship, after_session: 1, status: active }`. `package.json`: `"exit:disclosure": "tsx --env-file-if-exists=.env evals/run.ts --only rel-disclosure --runs 1 --review --trace --real extract"`. Run `pnpm eval --llm=fake --only rel-disclosure --runs 1` — PASS.

- [ ] **Step 2: Spec.** §6.1 (`disclosure` table built, `core_memory.depth`, `core_self_line.depth`, `session_log.depth`); §8.5 (core loops write depth, prompt v2s, snapshot v2); §10.3 (filtered "Who you are lately", tags, "Not ready to share", origin marks, reply v13); §11.3 (**Disclosure ledger and reciprocity** and **Common ground** marked Built 10b, plus a "Built 10b: how deep she goes" block like 10a's); §12.6 (`groundingMatch`); §13 (`too_deep` filter); §17.1 (inspector ledger); §20 (10b row with the test count); §25 (new: **tracked white lies**, target 10d or its own slice).

- [ ] **Step 3: Decisions.** Append to `DECISIONS.md`:

```markdown
| 2026-10-11 | Existing core memories take their depth from their kind; existing self lines are surface | No model backfill; self lines were already shown to everyone, so nothing changes until the next render. |
| 2026-10-11 | Core-value lines are always surface | Who she is (an AI, Alcor, her loves) is never a secret. |
| 2026-10-11 | Ledger rows point at core items with no foreign key | Core tables must never depend on a user table; core items are never hard-deleted. |
| 2026-10-11 | A repeated claim records another ledger row even when reconcile merges it | So a hint told again openly upgrades to open. |
| 2026-10-11 | A reply with no stored depth limits counts its claims as open | Replies before this phase had no limits. |
```

`CLAUDE.md`: current phase → 10a and 10b built; 10c (bids, idiolect) next.

- [ ] **Step 4: Full verification.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm eval --llm=fake --compare`. Record file and test counts in §20.

- [ ] **Step 5: Commit.** `pnpm format && git add -A && git commit -m "docs: record phase 10b; disclosure review run"`
