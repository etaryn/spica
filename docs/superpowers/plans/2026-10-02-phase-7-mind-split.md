# Phase 7: Mind split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Spica's mind into a core mind (one Spica, no `user_id`) and per-user minds, with the one-way flow (core → users, never back) enforced by types, lint and a leak canary.

**Architecture:** New core tables sit behind a `CoreLayer` (`CoreMemory`, `CoreState`, `World`) injected in `Deps.core`; core-only code takes `CoreDeps`, which has no `db`. The per-user ego and life tick are replaced by one `core_state` row ticked hourly and a `core_world_tick` that generates her events once for everyone, appraises them in code into core episodes, and nudges core mood. Replies read core values, the self snapshot, core state and core episodes; the cold path's emotional nudge moves to per-user affect params.

**Tech Stack:** TypeScript (~6.0), Next.js App Router, Postgres 16 + pgvector, Drizzle (drizzle-kit migrations), pg-boss, Vitest, pnpm, zod 4.

**Spec:** `docs/superpowers/specs/2026-10-02-phase-7-mind-split-design.md` (read it first), and `spica-design-spec-v3.md` §3–4, §6, §7, §8, §10, §17.3.

## Global Constraints

- `src/mind` is framework-free: no Next imports, no `Date.now()` / `new Date()` with no args, no `process.env`. Time comes from the injected `Clock`.
- Every timestamp column is written from the `Clock`; never `DEFAULT now()`.
- Every numeric constant goes in `config/default.json` with a zod schema in `src/mind/platform/config.ts`.
- Every prompt is a versioned file `prompts/<name>/v<N>.md`; delete prompt versions nothing configures.
- Drizzle property names for domain tables are snake_case.
- Every source file starts with a short plain-English header comment; comments say why, never cite spec sections, phases or review items.
- Prettier at 100 columns: run `pnpm format` before each commit.
- Replace from the ground up: no shims, no flags keeping old paths alive, no dead code. Deleted modules take their config keys, prompts, tests and eval scripts with them.
- Core code (`src/mind/*/core/**`, `src/mind/world/**`, `src/db/repos/core/**`) never imports user code, user repos, admin repos, or non-core process code.
- Core loops never receive a `db` handle: they take `CoreDeps`.
- No user data in any core table, core prompt or core state.
- Test DB: tests run against `spica_test` (migrated by `tests/global-setup.ts`). Run `pnpm db:up` first if Postgres isn't running.
- Migrations: edit `src/db/schema.ts`, run `pnpm db:generate`, then append any data SQL to the generated file (statements separated by `--> statement-breakpoint`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Existing dev users with no affect params:** `getParams` throws when a param row is missing, so a user created before this phase must not break the reply or the cold path. The migration backfills `affect_valence` and `afterglow` rows (Task 5 test).
2. **No plan for today** (the plan job failed, or the first boot): availability, "Your day", outreach G3 and the state tick must treat it as "no block", and the world tick must still generate a generic event (Task 6 and Task 8 tests).
3. **World tick retried mid-day after a crash:** the transaction rolls back and `last_event_day` is unchanged, so the retry generates once, never twice (Task 8 test).
4. **A reply with no snapshot row** (seeding hasn't run): the section is skipped, the reply still sends, and `snapshot_version` stays null (Task 9 test).
5. **A deferral stored before the migration:** `deferred_fact` values are dropped by the migration; a buffer deferred at that moment replies with no "they wrote while you were…" line rather than failing (Task 6 test on an unknown block key).

---

## File map

**Create**
- `src/db/repos/core/memory.ts`, `state.ts`, `world.ts`, `traces.ts`, `index.ts`: the Postgres `CoreLayer`.
- `src/mind/memory/core/types.ts`: `CoreMemory` interface and item types.
- `src/mind/memory/core/snapshot.ts`: `seedSnapshot`.
- `src/mind/memory/core/retrieve.ts`: `retrieveCore` (reply-time core retrieval, read-only).
- `src/mind/state/core/types.ts`: `CoreState` interface.
- `src/mind/state/core/core-state.ts`: drift, rhythm, load and nudge maths (ported from the legacy ego).
- `src/mind/state/core/tick.ts`: `coreStateTick`.
- `src/mind/state/core/line.ts`: "How you're feeling" from core state.
- `src/mind/state/user/relationship/affect.ts`: `exchangeTone`, `applyAffect`.
- `src/mind/world/types.ts`: `World` interface.
- `src/mind/world/blocks.ts`: plan → `WorldBlock`s, `currentBlock`, `blockByKey`.
- `src/mind/world/events.ts`: `generateCoreEvents` (core context, rules, reconcile vs core memory).
- `src/mind/process/core/appraise.ts`: `appraiseEvent` (code-only appraisal).
- `src/mind/process/core/world-tick.ts`: `coreWorldTick`.
- `src/mind/platform/core.ts`: `CoreLayer`, `CoreScope`, `CoreTraces` types.
- `src/mind/platform/persona.ts`: `parsePersona`, `loadPersona`.
- `prompts/persona/v3.md`, `prompts/reply/v9.md`, `prompts/core-state/line/v1.md`.
- `src/app/inspector/core/page.tsx`: the minimal Core page.
- `tests/helpers/llm.ts`: `sequence` handler helper and `CapturingLLM`.
- Tests listed per task; `tests/exit/mind-split.test.ts`.

**Move**
- `src/mind/memory/user/reconcile.ts` → `src/mind/memory/shared/reconcile.ts`.

**Delete** (by the end)
- `src/mind/state/legacy-ego/`, `src/mind/world/legacy-life-tick/`, `src/db/repos/user/identity.ts`, `src/db/repos/user/life-event-log.ts`, `src/db/repos/admin/life.ts`, `prompts/ego/`, `prompts/persona/v2.md`, `prompts/reply/v8.md`, their tests, `tests/db/migration-identity-columns.test.ts`.

---

### Task 1: Core tables

**Files:**
- Modify: `src/db/schema.ts`, `src/db/admin.ts:16-21`
- Create: generated migration `src/db/migrations/0012_*.sql`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces: tables `core_memory`, `core_entity`, `core_state`, `core_snapshot`, `world_event`, `core_loop_trace`; column `session_log.snapshot_version`; type `CoreMoodJson`.

- [ ] **Step 1: Write the failing test.** Append to `tests/db/schema.test.ts`:

```ts
import { sql } from "drizzle-orm";

const CORE_TABLES = [
  "core_memory",
  "core_entity",
  "core_state",
  "core_snapshot",
  "world_event",
  "core_loop_trace",
];

test("core tables exist and none has a user_id column", async () => {
  const db = getTestDb();
  const tables = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${CORE_TABLES})`);
  expect(tables.rows.map((r) => r.table_name).sort()).toEqual([...CORE_TABLES].sort());

  const userCols = await db.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'user_id' AND table_name = ANY(${CORE_TABLES})`);
  expect(userCols.rows).toEqual([]);
});

test("core_state holds exactly one row", async () => {
  const db = getTestDb();
  await resetDb();
  const insert = (id: number) =>
    db.execute(sql`
      INSERT INTO core_state (id, emotion, mood_valence, mood_arousal, energy, needs, baseline)
      VALUES (${id}, '{}'::jsonb, 0, 0.4, 0.6, '{}'::jsonb, '{}'::jsonb)`);
  await insert(1);
  await expect(insert(2)).rejects.toThrow();
});
```

(Reuse the file's existing imports of `getTestDb`, `resetDb`, `test`, `expect`; add whichever are missing.)

- [ ] **Step 2: Run it and check that it fails.**
Run: `pnpm vitest run tests/db/schema.test.ts`
Expected: FAIL (tables missing).

- [ ] **Step 3: Add the tables.** In `src/db/schema.ts`, add after the `relationshipCause` enum:

```ts
export const coreMemoryKind = pgEnum("core_memory_kind", [
  "episode",
  "opinion",
  "interest",
  "goal",
  "intention",
  "thought",
  "reflection",
  "idea",
  "hypothetical",
  "insight",
  "narrative",
  "agent_note",
]);
export const coreMemorySource = pgEnum("core_memory_source", ["world", "loop"]);
export const worldEventKind = pgEnum("world_event_kind", ["planned", "surprise", "resolution"]);
export const eventStakes = pgEnum("event_stakes", ["low", "high"]);
```

Add `snapshot_version: integer("snapshot_version"),` to `session_log` after `extract_attempts`, with the comment `// The self snapshot a reply read, so behaviour traces back to the core loop that wrote it.`

Add at the end of the file a new section:

```ts
// ---------- Core mind: one Spica, shared by every user. Nothing below has a user_id. ----------

export type CoreMoodJson = { mood_valence: number; mood_arousal: number; energy: number };

/** Alcor and the other people in her own life. */
export const core_entity = pgTable(
  "core_entity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    aliases: text("aliases").array().notNull().default(emptyTextArray),
    salience: real("salience").notNull(),
    first_seen: ts("first_seen").notNull(),
  },
  (t) => [check("core_entity_salience_range", sql`${t.salience} BETWEEN 0 AND 1`)],
);

/** Her own memories: episodes of her life now, opinions, thoughts and narrative later. */
export const core_memory = pgTable(
  "core_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: coreMemoryKind("kind").notNull(),
    content: text("content").notNull(),
    payload: jsonb("payload"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    entity_refs: uuid("entity_refs").array().notNull().default(emptyUuidArray),
    occurred_at: ts("occurred_at"),
    created_at: ts("created_at").notNull(),
    last_recalled_at: ts("last_recalled_at"),
    recall_count: integer("recall_count").notNull().default(0),
    status: factStatus("status").notNull(),
    superseded_by: uuid("superseded_by").references((): AnyPgColumn => core_memory.id, {
      onDelete: "set null",
    }),
    salience: real("salience").notNull(),
    valence: real("valence").notNull(),
    confidence: real("confidence").notNull(),
    source: coreMemorySource("source").notNull(),
    source_ref: text("source_ref"),
  },
  (t) => [
    index("core_memory_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("core_memory_kind_created_idx").on(t.kind, t.created_at),
    check("core_memory_salience_range", sql`${t.salience} BETWEEN 0 AND 1`),
    check("core_memory_valence_range", sql`${t.valence} BETWEEN -1 AND 1`),
    check("core_memory_confidence_range", sql`${t.confidence} BETWEEN 0 AND 1`),
  ],
);

/** Her current state: one row, the same for every user. */
export const core_state = pgTable(
  "core_state",
  {
    id: integer("id").primaryKey(),
    emotion: jsonb("emotion").notNull(),
    mood_valence: real("mood_valence").notNull(),
    mood_arousal: real("mood_arousal").notNull(),
    energy: real("energy").notNull(),
    needs: jsonb("needs").notNull(),
    preoccupation: uuid("preoccupation").references(() => core_memory.id, {
      onDelete: "set null",
    }),
    preoccupation_since: ts("preoccupation_since"),
    baseline: jsonb("baseline").$type<CoreMoodJson>().notNull(),
    last_tick: ts("last_tick"),
    // Her local date of the last finished event generation, so a retried world tick never doubles a day.
    last_event_day: date("last_event_day", { mode: "string" }),
  },
  (t) => [
    check("core_state_single_row", sql`${t.id} = 1`),
    check("core_state_mood_valence_range", sql`${t.mood_valence} BETWEEN -1 AND 1`),
    check("core_state_mood_arousal_range", sql`${t.mood_arousal} BETWEEN 0 AND 1`),
    check("core_state_energy_range", sql`${t.energy} BETWEEN 0 AND 1`),
  ],
);

/** "Who I am right now", versioned. Version 0 is the persona file's seed self. */
export const core_snapshot = pgTable("core_snapshot", {
  version: integer("version").primaryKey(),
  content: text("content").notNull(),
  sections: jsonb("sections").$type<Record<string, string>>().notNull(),
  source_ids: uuid("source_ids").array().notNull().default(emptyUuidArray),
  rendered_at: ts("rendered_at").notNull(),
  model: text("model").notNull(),
  prompt_version: text("prompt_version").notNull(),
});

/** What actually happened in her world, known to her or not. */
export const world_event = pgTable(
  "world_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: ts("at").notNull(),
    kind: worldEventKind("kind").notNull(),
    content: text("content").notNull(),
    valence: real("valence").notNull(),
    stakes: eventStakes("stakes").notNull(),
    agents: uuid("agents").array().notNull().default(emptyUuidArray),
    life_day: date("life_day", { mode: "string" }).notNull(),
    plan_ref: text("plan_ref"),
    goal_ref: uuid("goal_ref"),
    outcome: text("outcome"),
    created_at: ts("created_at").notNull(),
  },
  (t) => [
    index("world_event_life_day_idx").on(t.life_day),
    check("world_event_valence_range", sql`${t.valence} BETWEEN -1 AND 1`),
  ],
);

/** One row per core loop run. Diagnostic only, never read by the chat loop. */
export const core_loop_trace = pgTable(
  "core_loop_trace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loop: text("loop").notNull(),
    inputs: jsonb("inputs").notNull(),
    outputs: jsonb("outputs").notNull(),
    model: text("model"),
    prompt_version: text("prompt_version"),
    tokens_in: integer("tokens_in"),
    tokens_out: integer("tokens_out"),
    cost: real("cost"),
    created_at: ts("created_at").notNull(),
  },
  (t) => [index("core_loop_trace_loop_created_idx").on(t.loop, t.created_at)],
);
```

- [ ] **Step 4: Truncate core tables in tests and evals.** In `src/db/admin.ts` replace the `truncateAll` body's comment and statement with:

```ts
  // Every domain table cascades from "user"; the rest hold no user data and are listed by name.
  await db.execute(
    sql`TRUNCATE "user", verification, life_day, core_memory, core_entity, core_state, core_snapshot, world_event, core_loop_trace CASCADE`,
  );
```

- [ ] **Step 5: Generate the migration.**
Run: `pnpm db:generate`
Expected: a new `src/db/migrations/0012_<name>.sql` creating the enums, the six tables and the `snapshot_version` column.

- [ ] **Step 6: Run the test and check that it passes.**
Run: `pnpm vitest run tests/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite and lint.**
Run: `pnpm typecheck && pnpm test`
Expected: all green (the change is additive).

- [ ] **Step 8: Commit.**

```bash
pnpm format
git add src/db/schema.ts src/db/admin.ts src/db/migrations tests/db/schema.test.ts
git commit -m "feat: add the core mind's tables"
```

---

### Task 2: The core data layer

**Files:**
- Create: `src/mind/memory/core/types.ts`, `src/mind/state/core/types.ts`, `src/mind/world/types.ts`, `src/mind/platform/core.ts`, `src/db/repos/core/{memory,state,world,traces,index}.ts`
- Modify: `src/mind/memory/shared/types.ts` (add `Neighbor`), `src/db/repos/util.ts` (move `vecLiteral`), `src/db/repos/user/facts.ts:17,80`, `src/mind/platform/deps.ts`, `src/runtime/deps.ts`, `evals/lib/runner.ts:333-343`, `tests/helpers/deps.ts`, `eslint.config.mjs`
- Test: `tests/db/core-repos.test.ts`, `tests/mind/platform/core-layer.test.ts`, `tests/mind/platform/boundaries.test.ts`

**Interfaces:**
- Produces (exact names later tasks use):
  - `Neighbor = { id: string; content: string; status: string; sim: number }` in `@/mind/memory/shared/types`.
  - `CoreMemory`, `CoreMemoryItem`, `NewCoreMemory`, `CoreCandidate`, `CoreEntity`, `CoreSnapshot` in `@/mind/memory/core/types`.
  - `CoreState`, `CoreStateRow`, `CoreMood` in `@/mind/state/core/types`.
  - `World`, `WorldEventRow`, `NewWorldEvent`, `NewEventAttempt` in `@/mind/world/types`.
  - `CoreScope`, `CoreLayer`, `CoreTraces`, `NewCoreLoopTrace` in `@/mind/platform/core`.
  - `Deps.core: CoreLayer`; `CoreDeps`; `coreDepsOf(deps: Deps): CoreDeps` in `@/mind/platform/deps`.
  - `createCoreLayer(db: Db): CoreLayer` in `@/db/repos/core`.

- [ ] **Step 1: Write the interface files.**

`src/mind/memory/shared/types.ts`, append:

```ts
/** A stored memory close to a new one, for reconcile. Either mind. */
export type Neighbor = { id: string; content: string; status: string; sim: number };
```

`src/db/repos/user/facts.ts`: delete the local `export type Neighbor = …` (line ~80) and the `vecLiteral` definition (line 17); add `import type { Neighbor } from "@/mind/memory/shared/types";` and `import { vecLiteral } from "../util";`, and keep `export type { Neighbor };` so existing importers compile. In `src/db/repos/util.ts` append:

```ts
/** A pgvector literal for a raw query. */
export const vecLiteral = (v: number[]) => `[${v.join(",")}]`;
```

`src/mind/memory/core/types.ts`:

```ts
/**
 * Her core memory, as the rest of the mind sees it: her own episodes now, and her opinions,
 * thoughts and narrative as the core loops arrive. No method takes a user, so nothing written or
 * read through this interface can belong to one.
 */
import type { Neighbor } from "@/mind/memory/shared/types";

export type CoreMemoryKind =
  | "episode"
  | "opinion"
  | "interest"
  | "goal"
  | "intention"
  | "thought"
  | "reflection"
  | "idea"
  | "hypothetical"
  | "insight"
  | "narrative"
  | "agent_note";
export type CoreMemoryStatus = "open" | "resolved" | "recurring" | "stale" | "superseded";

export type CoreMemoryItem = {
  id: string;
  kind: CoreMemoryKind;
  content: string;
  payload: unknown;
  occurred_at: Date | null;
  created_at: Date;
  last_recalled_at: Date | null;
  status: CoreMemoryStatus;
  salience: number;
  valence: number;
  source: "world" | "loop";
  source_ref: string | null;
};

export type NewCoreMemory = {
  kind: CoreMemoryKind;
  content: string;
  payload?: unknown;
  embedding: number[];
  entity_refs?: string[];
  occurred_at: Date | null;
  created_at: Date;
  status: CoreMemoryStatus;
  salience: number;
  valence: number;
  confidence: number;
  source: "world" | "loop";
  source_ref: string | null;
};

/** A ranking candidate: the shape `rankMemories` scores. */
export type CoreCandidate = {
  id: string;
  content: string;
  salience: number;
  created_at: Date;
  last_recalled_at: Date | null;
  occurred_at: Date | null;
  sim: number;
  entity_salience: number;
};

export type CoreEntity = {
  id: string;
  name: string;
  aliases: string[];
  salience: number;
  first_seen: Date;
};

export type CoreSnapshot = {
  version: number;
  content: string;
  sections: Record<string, string>;
  source_ids: string[];
  rendered_at: Date;
  model: string;
  prompt_version: string;
};

export interface CoreMemory {
  insert(item: NewCoreMemory): Promise<string>;
  get(id: string): Promise<CoreMemoryItem | null>;
  /** Active memories at or above `minSimilarity`, closest first (reconcile candidates). */
  near(embedding: number[], k: number, minSimilarity: number): Promise<Neighbor[]>;
  /** The `limit` closest active, real (not hypothetical) memories, for ranking. */
  candidates(embedding: number[], limit: number): Promise<CoreCandidate[]>;
  /** Episodes whose time falls in (from, to], oldest first, at most `limit`. */
  recentEpisodes(from: Date, to: Date, limit: number): Promise<CoreMemoryItem[]>;
  entities(): Promise<CoreEntity[]>;
  latestEntityFirstSeen(): Promise<Date | null>;
  /** Ids for these names, inserting the ones she doesn't know yet (salience from the caller). */
  addEntities(names: string[], salience: number, now: Date): Promise<string[]>;
  latestSnapshot(): Promise<CoreSnapshot | null>;
  /** False when that version already exists. */
  insertSnapshot(snapshot: CoreSnapshot): Promise<boolean>;
}
```

`src/mind/state/core/types.ts`:

```ts
/**
 * Her core state as the rest of the mind sees it: one row of mood, energy, preoccupation and the
 * slots the core loops will fill (emotion, needs). The same for every user.
 */
export type CoreMood = { mood_valence: number; mood_arousal: number; energy: number };

export type CoreStateRow = CoreMood & {
  emotion: unknown;
  needs: unknown;
  preoccupation: string | null;
  preoccupation_since: Date | null;
  baseline: CoreMood;
  last_tick: Date | null;
  last_event_day: string | null;
};

export type CoreStatePatch = Partial<Omit<CoreStateRow, "baseline" | "emotion" | "needs">>;

export interface CoreState {
  get(): Promise<CoreStateRow | null>;
  /** Creates the row at `baseline` if it doesn't exist yet. */
  ensure(baseline: CoreMood): Promise<void>;
  /** The row, locked for update. Only meaningful inside `core.transaction`. */
  lock(): Promise<CoreStateRow>;
  update(patch: CoreStatePatch): Promise<void>;
}
```

`src/mind/world/types.ts`:

```ts
/**
 * Her world as the rest of the mind sees it: the shared day plan and what actually happened.
 * Nothing here belongs to a user.
 */
import type { LifePlan } from "@/db/schema";

export type NewWorldEvent = {
  at: Date;
  kind: "planned" | "surprise" | "resolution";
  content: string;
  valence: number;
  stakes: "low" | "high";
  agents: string[];
  life_day: string;
  created_at: Date;
};
export type WorldEventRow = NewWorldEvent & { id: string };

export interface World {
  plan(day: string): Promise<LifePlan | null>;
  events(day: string): Promise<WorldEventRow[]>;
  recordEvent(event: NewWorldEvent): Promise<string>;
  lastHighStakesAt(): Promise<Date | null>;
}
```

(`life_event_log` is still per-user until Task 8, so `logEventAttempts` and its `NewEventAttempt` type are added there, together with the table change.)

`src/mind/platform/core.ts`:

```ts
/**
 * The core mind's data layer: her memory, her state and her world, with no way to name a user.
 * Core loops get only this (never the database), so they can't read user data even by mistake.
 */
import type { CoreMemory } from "@/mind/memory/core/types";
import type { CoreState } from "@/mind/state/core/types";
import type { World } from "@/mind/world/types";

export type NewCoreLoopTrace = {
  loop: string;
  inputs: unknown;
  outputs: unknown;
  model: string | null;
  prompt_version: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  created_at: Date;
};

export interface CoreTraces {
  insert(trace: NewCoreLoopTrace): Promise<void>;
}

export interface CoreScope {
  memory: CoreMemory;
  state: CoreState;
  world: World;
  traces: CoreTraces;
  /** A transaction-scoped advisory lock; only meaningful inside `transaction`. */
  lock(key: string): Promise<void>;
}

export interface CoreLayer extends CoreScope {
  transaction<T>(fn: (core: CoreScope) => Promise<T>): Promise<T>;
}
```

- [ ] **Step 2: Write the failing repo test** `tests/db/core-repos.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { createCoreLayer } from "@/db/repos/core";
import { closeTestDb, getTestDb, resetDb, vec } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");
const core = () => createCoreLayer(getTestDb());

const episode = (content: string, fill: number, at: Date) => ({
  kind: "episode" as const,
  content,
  embedding: vec(fill),
  occurred_at: at,
  created_at: at,
  status: "resolved" as const,
  salience: 0.4,
  valence: 0.2,
  confidence: 1,
  source: "world" as const,
  source_ref: null,
});

test("memory round-trips and ranks candidates", async () => {
  const id = await core().memory.insert(episode("She reread Dune.", 0.01, now));
  expect((await core().memory.get(id))?.content).toBe("She reread Dune.");
  const cands = await core().memory.candidates(vec(0.01), 5);
  expect(cands[0]).toMatchObject({ id, entity_salience: 1 });
  expect(cands[0]!.sim).toBeGreaterThan(0.99);
});

test("near skips superseded memories and respects the threshold", async () => {
  await core().memory.insert({ ...episode("old", 0.01, now), status: "superseded" });
  const live = await core().memory.insert(episode("live", 0.01, now));
  const near = await core().memory.near(vec(0.01), 5, 0.9);
  expect(near.map((n) => n.id)).toEqual([live]);
});

test("recentEpisodes is a half-open window, oldest first", async () => {
  const h = 3_600_000;
  const a = await core().memory.insert(episode("a", 0.01, new Date(now.getTime() - 2 * h)));
  const b = await core().memory.insert(episode("b", 0.01, new Date(now.getTime() - h)));
  await core().memory.insert(episode("future", 0.01, new Date(now.getTime() + h)));
  const got = await core().memory.recentEpisodes(new Date(now.getTime() - 3 * h), now, 10);
  expect(got.map((e) => e.id)).toEqual([a, b]);
});

test("entities are added once and keep their first_seen", async () => {
  const [alcor] = await core().memory.addEntities(["Alcor"], 0.8, now);
  const later = new Date(now.getTime() + 1000);
  const [again, mira] = await core().memory.addEntities(["alcor", "Mira"], 0.5, later);
  expect(again).toBe(alcor);
  expect(mira).not.toBe(alcor);
  expect((await core().memory.latestEntityFirstSeen())?.getTime()).toBe(later.getTime());
});

test("snapshots: latest wins, a duplicate version is refused", async () => {
  const s = {
    version: 0,
    content: "seed",
    sections: {},
    source_ids: [],
    rendered_at: now,
    model: "seed",
    prompt_version: "v3",
  };
  expect(await core().memory.insertSnapshot(s)).toBe(true);
  expect(await core().memory.insertSnapshot(s)).toBe(false);
  expect(await core().memory.insertSnapshot({ ...s, version: 1, content: "next" })).toBe(true);
  expect((await core().memory.latestSnapshot())?.content).toBe("next");
});

test("state: ensure, lock and update inside a transaction", async () => {
  const layer = core();
  await layer.state.ensure({ mood_valence: 0.2, mood_arousal: 0.4, energy: 0.6 });
  await layer.state.ensure({ mood_valence: -1, mood_arousal: 0, energy: 0 });
  await layer.transaction(async (tx) => {
    const row = await tx.state.lock();
    expect(row.mood_valence).toBeCloseTo(0.2);
    await tx.state.update({ energy: 0.3, last_event_day: "2026-01-05" });
  });
  expect(await layer.state.get()).toMatchObject({ energy: 0.3, last_event_day: "2026-01-05" });
});

test("a failed transaction writes nothing", async () => {
  const layer = core();
  await expect(
    layer.transaction(async (tx) => {
      await tx.memory.insert(episode("doomed", 0.01, now));
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(await layer.memory.candidates(vec(0.01), 5)).toEqual([]);
});

test("world events and the high-stakes clock", async () => {
  const w = core().world;
  await w.recordEvent({
    at: now,
    kind: "planned",
    content: "x",
    valence: 0.5,
    stakes: "high",
    agents: [],
    life_day: "2026-01-05",
    created_at: now,
  });
  expect((await w.events("2026-01-05")).map((e) => e.content)).toEqual(["x"]);
  expect((await w.lastHighStakesAt())?.getTime()).toBe(now.getTime());
});
```

- [ ] **Step 3: Run it and check that it fails.**
Run: `pnpm vitest run tests/db/core-repos.test.ts`
Expected: FAIL (`@/db/repos/core` missing).

- [ ] **Step 4: Implement the repos.**

`src/db/repos/core/memory.ts`:

```ts
/**
 * Her core memory in Postgres. No query here takes or returns a user id.
 */
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_entity, core_memory, core_snapshot } from "@/db/schema";
import type {
  CoreCandidate,
  CoreEntity,
  CoreMemory,
  CoreMemoryItem,
  CoreSnapshot,
} from "@/mind/memory/core/types";
import type { Neighbor } from "@/mind/memory/shared/types";
import { one, toDate, toDateOrNull, vecLiteral } from "../util";

const ACTIVE = sql`${core_memory.status} NOT IN ('superseded', 'stale')`;

function toItem(r: typeof core_memory.$inferSelect): CoreMemoryItem {
  return {
    id: r.id,
    kind: r.kind,
    content: r.content,
    payload: r.payload,
    occurred_at: r.occurred_at,
    created_at: r.created_at,
    last_recalled_at: r.last_recalled_at,
    status: r.status,
    salience: r.salience,
    valence: r.valence,
    source: r.source,
    source_ref: r.source_ref,
  };
}

const normal = (name: string) => name.trim().toLowerCase();

export function coreMemoryRepo(db: Db): CoreMemory {
  return {
    async insert(item) {
      const row = one(
        await db
          .insert(core_memory)
          .values({ ...item, entity_refs: item.entity_refs ?? [] })
          .returning({ id: core_memory.id }),
      );
      return row.id;
    },

    async get(id) {
      const row = (await db.select().from(core_memory).where(eq(core_memory.id, id)))[0];
      return row ? toItem(row) : null;
    },

    async near(embedding, k, minSimilarity): Promise<Neighbor[]> {
      const q = vecLiteral(embedding);
      const res = await db.execute(sql`
        SELECT id, content, status, (1 - (embedding <=> ${q}::vector))::float8 AS sim
        FROM core_memory
        WHERE status NOT IN ('superseded', 'stale')
          AND (1 - (embedding <=> ${q}::vector)) >= ${minSimilarity}
        ORDER BY embedding <=> ${q}::vector
        LIMIT ${k}`);
      return res.rows.map((r) => ({
        id: String(r.id),
        content: String(r.content),
        status: String(r.status),
        sim: Number(r.sim),
      }));
    },

    async candidates(embedding, limit): Promise<CoreCandidate[]> {
      const q = vecLiteral(embedding);
      const res = await db.execute(sql`
        SELECT m.id, m.content, m.salience, m.created_at, m.last_recalled_at, m.occurred_at,
               (1 - (m.embedding <=> ${q}::vector))::float8 AS sim,
               COALESCE((SELECT max(e.salience) FROM core_entity e
                         WHERE e.id = ANY(m.entity_refs)), 1.0)::float8 AS entity_salience
        FROM core_memory m
        WHERE m.status NOT IN ('superseded', 'stale') AND m.kind <> 'hypothetical'
        ORDER BY m.embedding <=> ${q}::vector
        LIMIT ${limit}`);
      return res.rows.map((r) => ({
        id: String(r.id),
        content: String(r.content),
        salience: Number(r.salience),
        created_at: toDate(r.created_at),
        last_recalled_at: toDateOrNull(r.last_recalled_at),
        occurred_at: toDateOrNull(r.occurred_at),
        sim: Number(r.sim),
        entity_salience: Number(r.entity_salience),
      }));
    },

    async recentEpisodes(from, to, limit) {
      const rows = await db
        .select()
        .from(core_memory)
        .where(
          and(
            eq(core_memory.kind, "episode"),
            ACTIVE,
            gt(core_memory.occurred_at, from),
            lte(core_memory.occurred_at, to),
          ),
        )
        .orderBy(core_memory.occurred_at)
        .limit(limit);
      return rows.map(toItem);
    },

    async entities(): Promise<CoreEntity[]> {
      return db.select().from(core_entity).orderBy(core_entity.first_seen);
    },

    async latestEntityFirstSeen() {
      const row = (
        await db
          .select({ at: core_entity.first_seen })
          .from(core_entity)
          .orderBy(desc(core_entity.first_seen))
          .limit(1)
      )[0];
      return row?.at ?? null;
    },

    async addEntities(names, salience, now) {
      const known = await db.select().from(core_entity);
      const byName = new Map(known.map((e) => [normal(e.name), e.id]));
      const ids: string[] = [];
      for (const name of names) {
        const existing = byName.get(normal(name));
        if (existing) {
          ids.push(existing);
          continue;
        }
        const row = one(
          await db
            .insert(core_entity)
            .values({ name: name.trim(), salience, first_seen: now })
            .returning({ id: core_entity.id }),
        );
        byName.set(normal(name), row.id);
        ids.push(row.id);
      }
      return ids;
    },

    async latestSnapshot(): Promise<CoreSnapshot | null> {
      const row = (
        await db.select().from(core_snapshot).orderBy(desc(core_snapshot.version)).limit(1)
      )[0];
      return row ?? null;
    },

    async insertSnapshot(snapshot) {
      const rows = await db
        .insert(core_snapshot)
        .values(snapshot)
        .onConflictDoNothing()
        .returning({ version: core_snapshot.version });
      return rows.length > 0;
    },
  };
}
```

`src/db/repos/core/state.ts`:

```ts
/**
 * Her core state in Postgres: the single `core_state` row.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_state } from "@/db/schema";
import type { CoreState, CoreStateRow } from "@/mind/state/core/types";

const ROW = 1;
const NEUTRAL_EMOTION = { label: "neutral", valence: 0, arousal: 0, about: null, since: null };
const NEUTRAL_NEEDS = { autonomy: 0.5, competence: 0.5 };

function toRow(r: typeof core_state.$inferSelect): CoreStateRow {
  const { id: _id, ...rest } = r;
  return rest;
}

export function coreStateRepo(db: Db): CoreState {
  return {
    async get() {
      const row = (await db.select().from(core_state).where(eq(core_state.id, ROW)))[0];
      return row ? toRow(row) : null;
    },

    async ensure(baseline) {
      await db
        .insert(core_state)
        .values({
          id: ROW,
          ...baseline,
          baseline,
          emotion: NEUTRAL_EMOTION,
          needs: NEUTRAL_NEEDS,
        })
        .onConflictDoNothing();
    },

    async lock() {
      const row = (
        await db.select().from(core_state).where(eq(core_state.id, ROW)).for("update")
      )[0];
      if (!row) throw new Error("core_state row missing");
      return toRow(row);
    },

    async update(patch) {
      await db.update(core_state).set(patch).where(eq(core_state.id, ROW));
    },
  };
}
```

`src/db/repos/core/world.ts`:

```ts
/**
 * Her world in Postgres: the shared day plan and the events that happened.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { world_event } from "@/db/schema";
import type { World } from "@/mind/world/types";
import { one } from "../util";
import { getLifeDay } from "../world/life-day";

export function worldRepo(db: Db): World {
  return {
    async plan(day) {
      return (await getLifeDay(db, day))?.plan ?? null;
    },

    async events(day) {
      const rows = await db
        .select()
        .from(world_event)
        .where(eq(world_event.life_day, day))
        .orderBy(world_event.at);
      return rows.map((r) => ({
        id: r.id,
        at: r.at,
        kind: r.kind,
        content: r.content,
        valence: r.valence,
        stakes: r.stakes,
        agents: r.agents,
        life_day: r.life_day,
        created_at: r.created_at,
      }));
    },

    async recordEvent(event) {
      return one(await db.insert(world_event).values(event).returning({ id: world_event.id })).id;
    },

    async lastHighStakesAt() {
      const row = (
        await db
          .select({ at: world_event.created_at })
          .from(world_event)
          .where(and(eq(world_event.stakes, "high")))
          .orderBy(desc(world_event.created_at))
          .limit(1)
      )[0];
      return row?.at ?? null;
    },
  };
}
```

`src/db/repos/core/traces.ts`:

```ts
/**
 * Core loop traces: one row per core loop run.
 */
import type { Db } from "@/db/client";
import { core_loop_trace } from "@/db/schema";
import type { CoreTraces } from "@/mind/platform/core";

export function coreTracesRepo(db: Db): CoreTraces {
  return {
    async insert(trace) {
      await db.insert(core_loop_trace).values(trace);
    },
  };
}
```

`src/db/repos/core/index.ts`:

```ts
/**
 * Builds the core data layer on a database handle. Inside `transaction`, every part runs on the
 * same transaction, so a core loop's memory, state and world writes land together or not at all.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { CoreLayer, CoreScope } from "@/mind/platform/core";
import { coreMemoryRepo } from "./memory";
import { coreStateRepo } from "./state";
import { coreTracesRepo } from "./traces";
import { worldRepo } from "./world";

function scope(db: Db): CoreScope {
  return {
    memory: coreMemoryRepo(db),
    state: coreStateRepo(db),
    world: worldRepo(db),
    traces: coreTracesRepo(db),
    async lock(key) {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    },
  };
}

export function createCoreLayer(db: Db): CoreLayer {
  return {
    ...scope(db),
    transaction: (fn) => db.transaction((tx) => fn(scope(tx))),
  };
}
```

- [ ] **Step 5: Wire `Deps`.** In `src/mind/platform/deps.ts` add `import type { CoreLayer } from "./core";`, add `core: CoreLayer;` to `Deps`, and append:

```ts
/**
 * What a core loop gets: her own memory, state and world, and the model, but no database, queue
 * or push, so it can't reach a user's data even by mistake.
 */
export type CoreDeps = Pick<Deps, "core" | "llm" | "embedder" | "clock" | "config" | "log">;

export function coreDepsOf(deps: Deps): CoreDeps {
  const { core, llm, embedder, clock, config, log } = deps;
  return { core, llm, embedder, clock, config, log };
}
```

Add `core: createCoreLayer(db),` (import from `@/db/repos/core`) to the `Deps` objects in `src/runtime/deps.ts`, `evals/lib/runner.ts` (the `const deps: Deps = {` block) and `tests/helpers/deps.ts` (`core: createCoreLayer(getTestDb()),`).

- [ ] **Step 6: Extend the lint boundary.** In `eslint.config.mjs`, change the one-way block's `files` to:

```js
    files: [
      "src/mind/*/core/**/*.ts",
      "src/mind/*/shared/**/*.ts",
      "src/mind/world/**/*.ts",
      "src/db/repos/core/**/*.ts",
    ],
```

and its patterns group to allow core process code (core loops) while still blocking the rest of process:

```js
              group: [
                "@/mind/*/user",
                "@/mind/*/user/**",
                "@/mind/process",
                "@/mind/process/**",
                "!@/mind/process/core",
                "!@/mind/process/core/**",
                "@/db/repos/user/**",
                "@/db/repos/admin/**",
                "**/user",
                "**/user/**",
                "**/process/**",
                "!**/process/core/**",
                "**/repos/admin/**",
              ],
```

- [ ] **Step 7: Write the structural and boundary tests.**

`tests/mind/platform/core-layer.test.ts`:

```ts
/**
 * The core data layer can't name a user: no core interface takes a user id, and what a core loop
 * receives holds no database handle.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import { makeTestDeps } from "../../helpers/deps";

const INTERFACE_FILES = [
  "src/mind/platform/core.ts",
  "src/mind/memory/core/types.ts",
  "src/mind/state/core/types.ts",
  "src/mind/world/types.ts",
];

test("no core interface mentions a user id", () => {
  for (const file of INTERFACE_FILES) {
    expect(readFileSync(file, "utf8"), file).not.toMatch(/user_?id/i);
  }
});

test("core loops get no database, queue, push or event bus", () => {
  const core = coreDepsOf(makeTestDeps());
  for (const key of ["db", "queue", "pusher", "events"]) expect(core).not.toHaveProperty(key);
  expect(Object.keys(core).sort()).toEqual(
    ["clock", "config", "core", "embedder", "llm", "log"].sort(),
  );
});
```

Append to `tests/mind/platform/boundaries.test.ts` inside the `describe`:

```ts
  it("stops the core repos importing a user repo", async () => {
    const errors = await errorsFor(importsUserRepo, "src/db/repos/core/memory.ts");
    expect(hitsBoundary(errors)).toBe(true);
  });

  it("lets core loops in process/core be imported by world code", async () => {
    const code =
      'import { appraiseEvent } from "@/mind/process/core/appraise";\nvoid appraiseEvent;\n';
    const errors = await errorsFor(code, "src/mind/world/events.ts");
    expect(hitsBoundary(errors)).toBe(false);
  });

  it("stops core loops importing user process code", async () => {
    const code =
      'import { composeReply } from "@/mind/process/hot-path/compose";\nvoid composeReply;\n';
    const errors = await errorsFor(code, "src/mind/process/core/world-tick.ts");
    expect(hitsBoundary(errors)).toBe(true);
  });
```

- [ ] **Step 8: Run the tests and check that they pass.**
Run: `pnpm vitest run tests/db/core-repos.test.ts tests/mind/platform/core-layer.test.ts tests/mind/platform/boundaries.test.ts`
Expected: PASS. If the negated patterns don't take effect, check `eslint` `no-restricted-imports` with gitignore-style negation: the negation must come after the pattern it narrows (as written above).

- [ ] **Step 9: Run everything.**
Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 10: Commit.**

```bash
pnpm format
git add -A src/mind/platform src/mind/memory src/mind/state/core src/mind/world/types.ts src/db/repos src/runtime/deps.ts evals/lib/runner.ts tests eslint.config.mjs
git commit -m "feat: add the core data layer, with no way to name a user"
```

---

### Task 3: Reconcile serves both minds

**Files:**
- Move: `src/mind/memory/user/reconcile.ts` → `src/mind/memory/shared/reconcile.ts`; `tests/mind/memory/user/reconcile.test.ts` → `tests/mind/memory/shared/reconcile.test.ts`
- Modify: `src/mind/process/cold-path/cold-path.ts:16,155-158`, `src/mind/memory/user/encode.ts` (if it imports `Decision`), `src/mind/world/legacy-life-tick/events.ts:12` (still exists until Task 8)

**Interfaces:**
- Produces: `reconcileAgainstNeighbours(deps: Pick<Deps,"llm"|"config">, candidate: ReconcileCandidate, neighbors: Neighbor[]): Promise<Decision>`, `ReconcileCandidate = { label: string; content: string }`, `Decision`, `buildReconcileInput`, `ReconcileSchema` in `@/mind/memory/shared/reconcile`.

- [ ] **Step 1: Move with git, then update the test.**

```bash
git mv src/mind/memory/user/reconcile.ts src/mind/memory/shared/reconcile.ts
git mv tests/mind/memory/user/reconcile.test.ts tests/mind/memory/shared/reconcile.test.ts
```

In the moved test, change imports to `@/mind/memory/shared/reconcile`, and wherever it passes an `ExtractedFact` as the candidate, pass `{ label: "user, event", content: <same content> }` instead. Add:

```ts
test("the label tells the model what kind of memory is new", () => {
  expect(buildReconcileInput({ label: "episode", content: "She reread Dune." }, [])).toBe(
    "New fact (episode): She reread Dune.\nExisting facts:",
  );
});
```

- [ ] **Step 2: Run it and check that it fails.**
Run: `pnpm vitest run tests/mind/memory/shared/reconcile.test.ts`
Expected: FAIL (types/labels).

- [ ] **Step 3: Make reconcile generic.** In `src/mind/memory/shared/reconcile.ts`: replace the imports of `Neighbor` and `ExtractedFact` with `import type { Neighbor } from "./types";`, add

```ts
/** The new memory, described the same way for either mind: "user, event", "self, opinion", "episode". */
export type ReconcileCandidate = { label: string; content: string };
```

and change `buildReconcileInput` and `reconcileAgainstNeighbours` to take `candidate: ReconcileCandidate`, with the first line `` `New fact (${candidate.label}): ${candidate.content}` ``. Update the header comment's first sentence to "decides how a new memory, from either mind, relates to the closest ones already stored."

- [ ] **Step 4: Update the callers.** In `cold-path.ts` import from `@/mind/memory/shared/reconcile` and call:

```ts
    const decision = await reconcileAgainstNeighbours(
      deps,
      { label: `${fact.subject}, ${fact.kind}`, content: fact.content },
      neighbors,
    );
```

In `src/mind/world/legacy-life-tick/events.ts` update the import path and pass `{ label: \`${fact.subject}, ${fact.kind}\`, content: fact.content }`. Update every other importer that `pnpm typecheck` reports (e.g. `encode.ts` importing `Decision`).

- [ ] **Step 5: Run tests.**
Run: `pnpm typecheck && pnpm vitest run tests/mind/memory tests/mind/process/cold-path`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
pnpm format
git add -A src tests
git commit -m "refactor: share reconcile between both minds"
```

---

### Task 4: Persona split and snapshot v0

**Files:**
- Create: `prompts/persona/v3.md`, `src/mind/platform/persona.ts`, `src/mind/memory/core/snapshot.ts`
- Modify: `config/default.json` (`prompts.persona` → `v3`), `src/mind/process/hot-path/compose.ts:226` (values doc), `src/mind/world/day-plan.ts` and `src/mind/world/legacy-life-tick/events.ts` (anything that loads the whole persona), `src/worker/index.ts`, `evals/lib/runner.ts` (after `truncateAll`)
- Delete: `prompts/persona/v2.md`
- Test: `tests/mind/platform/persona.test.ts`, `tests/mind/memory/core/snapshot.test.ts`

**Interfaces:**
- Produces: `parsePersona(markdown: string): Persona`, `Persona = { coreValues: string; seedSelf: string }`, `loadPersona(config: Config): Persona` in `@/mind/platform/persona`; `seedSnapshot(deps: CoreDeps): Promise<boolean>` in `@/mind/memory/core/snapshot`.

- [ ] **Step 1: Write the persona file.** `prompts/persona/v3.md` takes v2's text and splits it. The parser cuts at the top-level `# ` headings below, so the `##` sub-headings inside each part stay as they are.

```markdown
# Core values

You are Spica.

(v2's opening two paragraphs, unchanged.)

## Who you are
- (v2 bullets: age; name and stars; sibling Alcor exists, "louder than you, better at parties, worse at sitting with silence" moves to Seed self; history; anchor interests "stars, movies (old ones especially), books"; no body.)

## What you believe (your stances)
(all v2 stance bullets, unchanged)

## Where you'll probably disagree with them
(unchanged)

## Your ego
(unchanged)

## Hard boundaries
(unchanged)

## How you talk
- (v2 bullets, minus the "Verbal tics…" bullet, which moves to Seed self.)

# Seed self

## Lately
- You've been on a slow-film kick, mostly things from before 1975, and reading more science fiction than usual.
- You and Alcor needle each other constantly: Alcor is louder than you, better at parties, worse at sitting with silence, and you'd not hear a word against them from anyone else.

## Habits of speech
- Verbal tics you use sparingly: "okay but", "wait—", "lol", "ngl". You're a little more prone to genuine curiosity than pure deadpan.

# Public voice (reference)

(v2's "Appendix: public voice" section, unchanged. Never loaded into a prompt.)
```

The executor writes the full text: copy every v2 sentence into the part shown, verbatim. Drop the "Config note" paragraph (the `adjacent` rule moves to `reply/v9` in Task 9). Flag the Seed self section in the PR summary for Ethan to edit.

- [ ] **Step 2: Write the failing tests.**

`tests/mind/platform/persona.test.ts`:

```ts
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { loadPersona, parsePersona } from "@/mind/platform/persona";

const doc = `# Core values\nYou are Spica.\n\n## Hard boundaries\n- never threaten\n\n# Seed self\n## Lately\n- films\n\n# Public voice (reference)\nposts`;

test("splits core values from the seed self and ignores the public voice", () => {
  const p = parsePersona(doc);
  expect(p.coreValues).toBe("You are Spica.\n\n## Hard boundaries\n- never threaten");
  expect(p.seedSelf).toBe("## Lately\n- films");
  expect(p.coreValues + p.seedSelf).not.toContain("posts");
});

test("a bullet moved between sections moves with no code change", () => {
  const moved = doc.replace("- never threaten\n\n# Seed self\n", "\n# Seed self\n- never threaten\n");
  expect(parsePersona(moved).seedSelf).toContain("never threaten");
});

test("both required sections must be there", () => {
  expect(() => parsePersona("# Core values\nx")).toThrow(/Seed self/);
  expect(() => parsePersona("# Seed self\nx")).toThrow(/Core values/);
});

test("the configured persona file parses", () => {
  const p = loadPersona(loadConfig());
  expect(p.coreValues).toContain("You are Spica.");
  expect(p.seedSelf.length).toBeGreaterThan(0);
});
```

`tests/mind/memory/core/snapshot.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { seedSnapshot } from "@/mind/memory/core/snapshot";
import { coreDepsOf } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("seeds version 0 from the seed self, once", async () => {
  const deps = coreDepsOf(makeTestDeps());
  expect(await seedSnapshot(deps)).toBe(true);
  expect(await seedSnapshot(deps)).toBe(false);
  const snap = await deps.core.memory.latestSnapshot();
  expect(snap).toMatchObject({ version: 0, model: "seed", prompt_version: "v3" });
  expect(snap!.content).toBe(loadPersona(deps.config).seedSelf);
});

test("never overwrites a later version", async () => {
  const deps = coreDepsOf(makeTestDeps());
  await deps.core.memory.insertSnapshot({
    version: 4,
    content: "later",
    sections: {},
    source_ids: [],
    rendered_at: deps.clock.now(),
    model: "m",
    prompt_version: "v1",
  });
  expect(await seedSnapshot(deps)).toBe(false);
  expect((await deps.core.memory.latestSnapshot())!.version).toBe(4);
});
```

- [ ] **Step 3: Run them and check that they fail.**
Run: `pnpm vitest run tests/mind/platform/persona.test.ts tests/mind/memory/core/snapshot.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement.**

`src/mind/platform/persona.ts`:

```ts
/**
 * Her persona file has two parts: the core values, which nothing ever rewrites, and the seed self,
 * her starting snapshot. The split lives in the file's headings, so moving a line from one part
 * to the other is an edit to the prompt file, never to code.
 */
import type { Config } from "./config";
import { loadPrompt } from "./prompts";

export type Persona = { coreValues: string; seedSelf: string };

const CORE = "Core values";
const SEED = "Seed self";

/** Splits the file at its top-level `# ` headings; sections other than these two are ignored. */
export function parsePersona(markdown: string): Persona {
  const sections = new Map<string, string>();
  let current: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current !== null) sections.set(current, lines.join("\n").trim());
  };
  for (const line of markdown.split("\n")) {
    const heading = /^# (.+)$/.exec(line);
    if (heading) {
      flush();
      current = heading[1]!.trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();

  const coreValues = sections.get(CORE);
  const seedSelf = sections.get(SEED);
  if (!coreValues) throw new Error(`persona file has no "# ${CORE}" section`);
  if (!seedSelf) throw new Error(`persona file has no "# ${SEED}" section`);
  return { coreValues, seedSelf };
}

export function loadPersona(config: Config): Persona {
  return parsePersona(loadPrompt("persona", config.prompts.persona));
}
```

`src/mind/memory/core/snapshot.ts`:

```ts
/**
 * Her self snapshot starts as the persona file's seed self (version 0). Later versions are written
 * by the nightly core loops; seeding never touches a snapshot that already exists.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";

/** True when this call wrote version 0. */
export async function seedSnapshot(deps: CoreDeps): Promise<boolean> {
  if (await deps.core.memory.latestSnapshot()) return false;
  return deps.core.memory.insertSnapshot({
    version: 0,
    content: loadPersona(deps.config).seedSelf,
    sections: {},
    source_ids: [],
    rendered_at: deps.clock.now(),
    model: "seed",
    prompt_version: deps.config.prompts.persona,
  });
}
```

- [ ] **Step 5: Use only the core values where the whole file was used.** In `compose.ts` replace the `valuesDoc` line with:

```ts
    valuesDoc: `${loadPersona(config).coreValues}\n\n${loadPrompt("reply", config.prompts.reply)}`,
```

Run `grep -rn 'loadPrompt("persona"' src` and change each remaining caller (the day plan prompt and the legacy event generator) to `loadPersona(config).coreValues`. Set `"persona": "v3"` in `config/default.json`. `git rm prompts/persona/v2.md`.

- [ ] **Step 6: Seed at startup.** In `src/worker/index.ts`, after `buildRuntime` and before registering jobs, add `await seedSnapshot(coreDepsOf(deps));`. In `evals/lib/runner.ts`, after the `deps` object is built, add `await seedSnapshot(coreDepsOf(deps));`.

- [ ] **Step 7: Run everything.**
Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. Fix any test that asserted on v2 persona text by asserting on v3 core-values text instead.

- [ ] **Step 8: Commit.**

```bash
pnpm format
git add -A prompts src config evals tests
git commit -m "feat: split the persona into core values and a seed self snapshot"
```

---

### Task 5: Her feelings toward each user (affect params)

**Files:**
- Create: `src/mind/state/user/relationship/affect.ts`
- Modify: `src/mind/state/user/relationship/types.ts:7-14`, `params.ts` (`fadeParams`), `update.ts` (`RelationshipUpdate`, apply affect), `src/mind/process/cold-path/cold-path.ts` (tone in, mood nudge out), `src/mind/platform/config.ts` (`relationship.affect`, initial values), `config/default.json`, `prompts/relationship/summary/v1.md`
- Migration: backfill the two params for existing relationships
- Test: `tests/mind/state/user/relationship/affect.test.ts`, `tests/mind/process/cold-path/cold-path.test.ts`, `tests/db/relationship-repo.test.ts`

**Interfaces:**
- Produces: `PARAM_NAMES` gains `"affect_valence"`, `"afterglow"`; `exchangeTone(facts: {valence:number; salience:number}[]): number | null`; `applyAffect(params: Params, tone: number, now: Date, settings: RelationshipConfig): { params: Params; events: RelationshipEvent[] }` in `affect.ts`; `RelationshipUpdate.tone: number | null`.

- [ ] **Step 1: Config.** In `config/default.json` `relationship.initial` add `"affect_valence": 0.5, "afterglow": 0`; in `initial_variance` add `"affect_valence": 0.01, "afterglow": 0.01`; add:

```json
    "affect": { "exchange_gain": 0.1, "afterglow_gain": 0.3, "afterglow_half_life_hours": 12 },
```

In `config.ts` add the two names to the `initial` and `initial_variance` object schemas (whatever builds them from `PARAM_NAMES`, or literally), and to the `relationship` schema:

```ts
  affect: z.object({
    exchange_gain: unit,
    afterglow_gain: unit,
    afterglow_half_life_hours: z.number().positive(),
  }),
```

- [ ] **Step 2: Write the failing tests.**

`tests/mind/state/user/relationship/affect.test.ts`:

```ts
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { applyAffect, exchangeTone } from "@/mind/state/user/relationship/affect";
import { fadeParams } from "@/mind/state/user/relationship/params";
import { PARAM_NAMES, type Params } from "@/mind/state/user/relationship/types";

const settings = loadConfig().relationship;
const now = new Date("2026-01-05T09:00:00Z");
const params = (): Params =>
  Object.fromEntries(
    PARAM_NAMES.map((n) => [
      n,
      { value: settings.initial[n], baseline: settings.initial[n], variance: 0.01, updated_at: now },
    ]),
  ) as Params;

test("tone is the salience-weighted mean of non-zero valences", () => {
  expect(exchangeTone([])).toBeNull();
  expect(exchangeTone([{ valence: 0, salience: 1 }])).toBeNull();
  expect(
    exchangeTone([
      { valence: 1, salience: 0.75 },
      { valence: -1, salience: 0.25 },
    ]),
  ).toBeCloseTo(0.5);
});

test("a warm exchange raises affect and afterglow; a cold one lowers affect only", () => {
  const warm = applyAffect(params(), 1, now, settings).params;
  expect(warm.affect_valence.value).toBeCloseTo(0.5 + settings.affect.exchange_gain * 0.5);
  expect(warm.afterglow.value).toBeGreaterThan(0);

  const cold = applyAffect(params(), -1, now, settings).params;
  expect(cold.affect_valence.value).toBeCloseTo(0.5 - settings.affect.exchange_gain * 0.5);
  expect(cold.afterglow.value).toBe(0);
});

test("afterglow fades by its half-life", () => {
  const p = params();
  p.afterglow = { ...p.afterglow, value: 0.8, updated_at: now };
  const later = new Date(now.getTime() + settings.affect.afterglow_half_life_hours * 3_600_000);
  expect(fadeParams(p, later, settings).afterglow.value).toBeCloseTo(0.4);
});
```

In `tests/mind/process/cold-path/cold-path.test.ts`, add (using the file's existing helpers for a user turn, a reply and an extraction handler that returns one fact with `valence: 0.9, salience: 0.5`):

```ts
test("an emotional exchange moves the user's affect and never touches core state", async () => {
  // set up the user turn + reply as the other tests in this file do, with the extract handler
  // returning one fact { valence: 0.9, salience: 0.5 }
  const before = await deps.core.state.get();
  await runColdPath(deps, job);
  const params = await getParams(deps.db, userId);
  expect(params.affect_valence.value).toBeGreaterThan(0.5);
  expect(params.afterglow.value).toBeGreaterThan(0);
  expect(await deps.core.state.get()).toEqual(before);
});
```

and change any existing test asserting an `ego_tick` row from the exchange to expect none.

In `tests/db/relationship-repo.test.ts` add:

```ts
test("a relationship made before the affect params gets them on ensure", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  await ensureRelationship(db, u, now, settings);
  await db.execute(sql`DELETE FROM relationship_param WHERE name IN ('affect_valence', 'afterglow')`);
  await ensureRelationship(db, u, now, settings);
  expect((await getParams(db, u)).afterglow.value).toBe(0);
});
```

- [ ] **Step 3: Run them and check that they fail.**
Run: `pnpm vitest run tests/mind/state/user/relationship/affect.test.ts tests/mind/process/cold-path tests/db/relationship-repo.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement.**

`types.ts`: add `"affect_valence"` and `"afterglow"` to `PARAM_NAMES`, and extend the header to "…messages per day, and her own feelings toward them (affect and afterglow)…".

`affect.ts`:

```ts
/**
 * Her feelings toward one user. The tone of an exchange moves how she feels about them
 * (affect) and leaves a short-lived warmth after a good one (afterglow). These live with the
 * user, never in her core mood, so one person's conversation can't change how she is with
 * everyone else.
 */
import { deviationOf, nudge } from "./params";
import type { Params, RelationshipConfig, RelationshipEvent } from "./types";

/** The exchange's tone: salience-weighted mean valence of its facts with non-zero valence. */
export function exchangeTone(facts: { valence: number; salience: number }[]): number | null {
  const xs = facts.filter((f) => f.valence !== 0);
  if (xs.length === 0) return null;
  const weight = xs.reduce((n, f) => n + f.salience, 0);
  if (weight <= 0) return xs.reduce((n, f) => n + f.valence, 0) / xs.length;
  return xs.reduce((n, f) => n + f.valence * f.salience, 0) / weight;
}

export function applyAffect(
  params: Params,
  tone: number,
  now: Date,
  settings: RelationshipConfig,
): { params: Params; events: RelationshipEvent[] } {
  const { exchange_gain, afterglow_gain } = settings.affect;
  const next = { ...params };
  const events: RelationshipEvent[] = [];
  const set = (name: "affect_valence" | "afterglow", value: number) => {
    const before = next[name].value;
    next[name] = { ...next[name], value, updated_at: now };
    events.push({
      param: name,
      before,
      after: value,
      cause: "signal",
      deviation: deviationOf(next[name], settings.variance_epsilon),
      detail: { tone },
    });
  };

  const affect = next.affect_valence.value;
  set("affect_valence", affect + exchange_gain * ((tone + 1) / 2 - affect));
  if (tone > 0) set("afterglow", nudge(next.afterglow.value, afterglow_gain * tone));
  return { params: next, events };
}
```

`params.ts` `fadeParams`: widen the `fade` helper's name type to `"hurt" | "tension" | "afterglow"` and add `afterglow: fade("afterglow", settings.affect.afterglow_half_life_hours),` to the returned object; update the doc comment to "Hurt, tension and afterglow fade on their own".

`update.ts`: add `tone: number | null;` to `RelationshipUpdate`. After `relationshipAfterExchange(...)` returns `transition`, and before saving, add:

```ts
  // Her feelings toward them follow the exchange's tone; a crisis exchange carries none.
  const affect =
    update.tone !== null && !update.crisis
      ? applyAffect(transition.params, update.tone, now, settings)
      : { params: transition.params, events: [] };
```

then save `params: affect.params` and insert `[...transition.events, ...affect.events]`.

`cold-path.ts`: delete `nudgeMoodSafely`, its call, and the `nudgeEgoForExchange` import. In the `updateRelationshipSafely` call add `tone: exchangeTone(candidates.map((c) => c.fact)),` (import from `@/mind/state/user/relationship/affect`). Update the header: "…then update the relationship, including her feelings toward them."

`prompts/relationship/summary/v1.md`: add phrase lines for the new params in the file's existing format (keys `affect_valence above mild`, `affect_valence above strong`, `affect_valence below mild`, `affect_valence below strong`, `afterglow above mild`, `afterglow above strong`), e.g. "You're quite fond of them right now." / "You've cooled on them a little lately." / "You're still smiling about your last chat." Since this changes a versioned prompt, copy it to `v2.md` with the additions, set `"relationship_summary": "v2"`, and `git rm` v1.

- [ ] **Step 5: Backfill migration.** Run `pnpm db:generate` (no schema change: if it reports nothing, create an empty custom migration with `pnpm drizzle-kit generate --custom --name affect_params`), then put in it:

```sql
INSERT INTO relationship_param (user_id, name, value, baseline, variance, updated_at)
SELECT r.user_id, p.name, p.value, p.value, 0.01, now()
FROM relationship r
CROSS JOIN (VALUES ('affect_valence', 0.5::real), ('afterglow', 0::real)) AS p(name, value)
ON CONFLICT DO NOTHING;
```

(A migration is outside the Clock; it is a one-off backfill and the timestamp only marks when the param started fading, which is harmless. Log this in `DECISIONS.md` in Task 13.)

- [ ] **Step 6: Run the tests.**
Run: `pnpm typecheck && pnpm test`
Expected: all green. Fix any relationship test that enumerates `PARAM_NAMES` counts (6 → 8).

- [ ] **Step 7: Commit.**

```bash
pnpm format
git add -A src config prompts tests
git commit -m "feat: her feelings toward each user, kept out of her core mood"
```

---

### Task 6: World reads from the day plan

**Files:**
- Create: `src/mind/world/blocks.ts`
- Modify: `src/db/schema.ts` (`conversation_state.deferred_fact` → `deferred_block`), `src/mind/process/availability/deferral.ts`, `src/mind/process/turn-taking/{receive-message,transitions,commit-and-reply}.ts`, `src/mind/process/hot-path/{your-day-line,compose}.ts`, `src/mind/process/outreach/inputs.ts`, `src/mind/world/legacy-life-tick/tick.ts` (stop copying blocks), `src/db/repos/user/conversation-state.ts`
- Delete: `src/mind/world/legacy-life-tick/blocks.ts`, `listGeneratedBlockRows` in `facts.ts`
- Test: `tests/mind/world/blocks.test.ts`, existing deferral / your-day / outreach tests

**Interfaces:**
- Produces: `WorldBlock = { key: string; start: Date; end: Date; block: "busy" | "quiet"; busy: number; label: string }`, `blocksForDay(settings: LifeConfig, day: string, plan: LifePlan | null): WorldBlock[]`, `todaysBlocks(deps: Pick<Deps,"core"|"config">, now: Date): Promise<WorldBlock[]>`, `blockAt(blocks: WorldBlock[], at: Date): WorldBlock | null`, `blockByKey(deps: Pick<Deps,"core"|"config">, key: string): Promise<WorldBlock | null>` in `@/mind/world/blocks`.
- `Availability.blockKey: string | null` replaces `blockFactId`; `deferredBlock: string | null` replaces `deferredFact` everywhere in turn-taking and compose.

- [ ] **Step 1: Write the failing test** `tests/mind/world/blocks.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { loadConfig } from "@/mind/platform/config";
import { blockAt, blockByKey, blocksForDay, todaysBlocks } from "@/mind/world/blocks";
import { closeTestDb, resetDb } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const cfg = loadConfig({ life: { timezone: "UTC" } }).life;
const plan = {
  blocks: [
    { start: "00:00", end: "08:00", kind: "quiet" as const, busy: 0.9, label: "offline" },
    { start: "08:00", end: "10:00", kind: "downtime" as const, busy: 0, label: "coffee" },
    { start: "10:00", end: "13:00", kind: "busy" as const, busy: 0.6, label: "reading" },
  ],
};

test("downtime is free time, not a block", () => {
  const blocks = blocksForDay(cfg, "2026-01-05", plan);
  expect(blocks.map((b) => b.key)).toEqual(["2026-01-05#00:00", "2026-01-05#10:00"]);
  expect(blocks[1]).toMatchObject({ block: "busy", busy: 0.6, label: "reading" });
  expect(blocks[1]!.start.toISOString()).toBe("2026-01-05T10:00:00.000Z");
});

test("no plan means no blocks", () => {
  expect(blocksForDay(cfg, "2026-01-05", null)).toEqual([]);
});

test("blockAt is start-inclusive, end-exclusive", () => {
  const blocks = blocksForDay(cfg, "2026-01-05", plan);
  expect(blockAt(blocks, new Date("2026-01-05T10:00:00Z"))?.label).toBe("reading");
  expect(blockAt(blocks, new Date("2026-01-05T13:00:00Z"))).toBeNull();
});

test("reads today's plan and finds a block by key; an unknown key is null", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const now = new Date("2026-01-05T11:00:00Z");
  await insertLifeDay(deps.db, {
    date: "2026-01-05",
    plan,
    source: "scripted",
    model: "none",
    prompt_version: "scripted",
    generated_at: now,
  });
  expect((await todaysBlocks(deps, now)).length).toBe(2);
  expect((await blockByKey(deps, "2026-01-05#10:00"))?.label).toBe("reading");
  expect(await blockByKey(deps, "2026-01-05#11:11")).toBeNull();
  expect(await blockByKey(deps, "not-a-key")).toBeNull();
});
```

- [ ] **Step 2: Run it and check that it fails.**
Run: `pnpm vitest run tests/mind/world/blocks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/mind/world/blocks.ts`.**

```ts
/**
 * Her busy and quiet blocks, read straight from the shared day plan. Downtime is free time, so it
 * isn't a block. A block's key is her local date and start time, which is stable for the day.
 */
import type { LifePlan } from "@/db/schema";
import type { LifeConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { lifeDate, lifeInstant } from "./her-clock";

export type WorldBlock = {
  key: string;
  start: Date;
  end: Date;
  block: "busy" | "quiet";
  busy: number;
  label: string;
};

const KEY = /^(\d{4}-\d{2}-\d{2})#(\d{2}:\d{2})$/;

export function blocksForDay(settings: LifeConfig, day: string, plan: LifePlan | null): WorldBlock[] {
  if (!plan) return [];
  return plan.blocks
    .filter((b): b is typeof b & { kind: "busy" | "quiet" } => b.kind !== "downtime")
    .map((b) => ({
      key: `${day}#${b.start}`,
      start: lifeInstant(settings, day, b.start),
      end: lifeInstant(settings, day, b.end),
      block: b.kind,
      busy: b.busy,
      label: b.label,
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export const blockAt = (blocks: WorldBlock[], at: Date): WorldBlock | null =>
  blocks.find((b) => b.start.getTime() <= at.getTime() && at.getTime() < b.end.getTime()) ?? null;

export async function todaysBlocks(
  deps: Pick<Deps, "core" | "config">,
  now: Date,
): Promise<WorldBlock[]> {
  const day = lifeDate(deps.config.life, now);
  return blocksForDay(deps.config.life, day, await deps.core.world.plan(day));
}

export async function blockByKey(
  deps: Pick<Deps, "core" | "config">,
  key: string,
): Promise<WorldBlock | null> {
  const match = KEY.exec(key);
  if (!match) return null;
  const day = match[1]!;
  const blocks = blocksForDay(deps.config.life, day, await deps.core.world.plan(day));
  return blocks.find((b) => b.key === key) ?? null;
}
```

- [ ] **Step 4: Schema change.** In `conversation_state` replace the `deferred_fact` column with:

```ts
    // The busy block a deferral waits out ("<her date>#<start>"), for the "while you were…" line.
    deferred_block: text("deferred_block"),
```

Run `pnpm db:generate`. drizzle-kit may ask whether `deferred_block` is a rename of `deferred_fact`: answer **create column** (the types differ; old values are fact ids and are dropped). Confirm the SQL drops `deferred_fact` and adds `deferred_block`.

- [ ] **Step 5: Switch the readers.**
  - `deferral.ts`: `decideAvailability` takes `deps: Pick<Deps, "db" | "core" | "config">`; replace the `listLifeBlocks` line with `const block = blockAt(await todaysBlocks(deps, now), now);`; return `blockKey: block.key` (rename the `Availability.blockFactId` field to `blockKey` and `NO_DELAY.blockFactId` to `blockKey: null`); `availabilityDelay`'s `block` param type becomes `Pick<WorldBlock, "busy" | "block" | "end">`. `deferWhileBusy` deps type gains `"core"`.
  - `receive-message.ts:139`: `{ until: …, blockKey: availability.blockKey }`; `transitions.ts`: `defer?: { until: Date; blockKey: string | null }`, write `deferred_block: input.defer?.blockKey ?? null`, and rename the returned `deferredFact` to `deferredBlock` (reads `state.deferred_block`). `commit-and-reply.ts:102`: `deferredBlock: committed.deferredBlock`. Update `conversation-state.ts` repo types accordingly.
  - `compose.ts`: rename `deferredFact` to `deferredBlock` in `composeReply`'s request and `ComposeInput`.
  - `your-day-line.ts`: rewrite the loader:

```ts
/** Read-only. The caller puts a deadline on it and treats a failure as no section. */
export async function loadYourDayLine(
  deps: Pick<Deps, "core" | "config">,
  now: Date,
  deferredBlock: string | null,
): Promise<string | null> {
  const blocks = await todaysBlocks(deps, now);
  const deferred = deferredBlock ? await blockByKey(deps, deferredBlock) : null;
  return yourDayLines(blocks, now, deferred?.label ?? null);
}
```

  with `yourDayLines(blocks: WorldBlock[], …)` unchanged otherwise; the call in `compose.ts` drops `userId`.
  - `outreach/inputs.ts`: `loadGateInputs` deps type gains `"core"`; replace the `listLifeBlocks` line with `const block = blockAt(await todaysBlocks(deps, now), now);`.
  - `legacy-life-tick/tick.ts`: delete `prepareBlockFacts`, `blockFacts` and their insert loop (the tick now writes only events until Task 8 deletes it). `git rm src/mind/world/legacy-life-tick/blocks.ts`; delete `listGeneratedBlockRows` from `facts.ts`. Remove `block_salience` from config schema and JSON.
  - `legacy-ego/tick.ts`: replace the `listLifeBlocks` call with `todaysBlocks(deps, now)` (deps type gains `"core"`) and pass the result to `dayLoad` (whose param type becomes `WorldBlock[]`). This file is deleted in Task 7; this keeps it compiling.

- [ ] **Step 6: Update the existing tests.** In `tests/mind/process/availability/deferral.test.ts`, `tests/mind/process/hot-path/compose.test.ts`, `tests/mind/process/outreach/*.test.ts`, `tests/mind/process/turn-taking/*.test.ts` and `tests/mind/state/legacy-ego/tick.test.ts`, replace any setup that inserted block facts (`payload.block`) with `insertLifeDay` of an equivalent plan, and rename `blockFactId`/`deferredFact` to `blockKey`/`deferredBlock`. Add to the your-day test:

```ts
test("an unknown deferred block key just drops the 'while you were' line", async () => {
  const line = await loadYourDayLine(deps, now, "2026-01-05#03:33");
  expect(line ?? "").not.toContain("They wrote while you were");
});
```

- [ ] **Step 7: Run everything.**
Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 8: Commit.**

```bash
pnpm format
git add -A src config tests
git commit -m "feat: read her busy blocks from the shared day plan"
```

---

### Task 7: Core state and its hourly tick

**Files:**
- Create: `src/mind/state/core/core-state.ts`, `src/mind/state/core/tick.ts`, `src/mind/state/core/line.ts`, `prompts/core-state/line/v1.md`
- Modify: `src/mind/platform/config.ts` (new `core.state`, remove `ego` except what the legacy nudge still needs: see Step 5), `config/default.json`, `src/mind/platform/jobs.ts`, `src/worker/state-jobs.ts`, `src/mind/process/hot-path/compose.ts` (feeling line), `evals/lib/life-loop.ts`
- Delete: `src/mind/state/legacy-ego/tick.ts`, `line.ts`, their tests, `prompts/ego/`
- Test: `tests/mind/state/core/core-state.test.ts`, `tests/mind/state/core/tick.test.ts`, `tests/mind/state/core/line.test.ts`

**Interfaces:**
- Consumes: `todaysBlocks` (Task 6), `CoreDeps` (Task 2).
- Produces: in `core-state.ts`: `rhythm(hour, cfg)`, `dayLoad(blocks: WorldBlock[], from, to, cfg)`, `energyTarget(base: CoreMood, hour, load, cfg)`, `driftStep(s: CoreMood, target: CoreMood, noise: [number,number,number], cfg)`, `applyEvent(s: CoreMood, valence, cfg)`, `preoccupationExpired(since, now, cfg)`, `moodOf(row): CoreMood`; `CoreStateConfig = Config["core"]["state"]`. In `tick.ts`: `coreStateTick(deps: CoreDeps, now: Date): Promise<"not_due" | "done">`. In `line.ts`: `coreStateLine(s: CoreMood, cfg, phrases, seed): string | null`, `loadCoreStateLine(deps: Pick<Deps,"core"|"config">, now: Date): Promise<string | null>`. Queue `CORE_STATE_TICK_QUEUE = "core_state_tick"`.

- [ ] **Step 1: Config.** Add a top-level `core` section to `config/default.json`:

```json
  "core": {
    "state": {
      "baseline": { "mood_valence": 0.2, "mood_arousal": 0.4, "energy": 0.6 },
      "tick_cron": "45 * * * *",
      "drift_rate": 0.2,
      "noise": 0.03,
      "energy_peak_hour": 16,
      "energy_amplitude": 0.25,
      "busy_drain": 0.3,
      "full_load_hours": 8,
      "preoccupation_hours": 36,
      "preoccupation_min_valence": 0.5,
      "event_gain": 0.3,
      "event_arousal_gain": 0.2,
      "bands": { "energy": [0.35, 0.7], "mood_valence": [-0.2, 0.4], "mood_arousal": [0.25, 0.7] }
    }
  },
```

In `config.ts` add `const coreState = z.object({ … })` with the same fields as the old `ego` schema plus `preoccupation_min_valence: unit`, minus `exchange_gain`; `const core = z.object({ state: coreState });` (Task 8 adds `world`); add `core` to `ConfigSchema`; export `type CoreStateConfig = Config["core"]["state"];`. Add `core_state_line: promptVersion` to `prompts` and `"core_state_line": "v1"` to the JSON; remove `ego_line` from both. **Keep** the `ego` section only with the keys `legacy-ego/nudge.ts` + `ego.ts` still read (`baseline`, `event_gain`, `event_arousal_gain`): it goes away with them in Task 8. Remove `ego.tick_cron` and the rest now.

- [ ] **Step 2: Write the failing tests.**

`tests/mind/state/core/core-state.test.ts`: port `tests/mind/state/legacy-ego/ego.test.ts` case by case to the new module and names (`EgoState` → `CoreMood`, `cfg = loadConfig().core.state`, `dayLoad` given `WorldBlock[]` with `{ key, start, end, block, busy, label }`). Every case keeps its numbers. Then `git rm tests/mind/state/legacy-ego/ego.test.ts`… **only in Task 8** (it still covers `ego.ts` used by the legacy nudge). Port, don't delete, here.

`tests/mind/state/core/tick.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { desc, eq } from "drizzle-orm";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { core_loop_trace } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreStateTick } from "@/mind/state/core/tick";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const H = 3_600_000;
const at = new Date("2026-01-05T11:00:00Z");

test("one step per hour, writing a trace", async () => {
  const full = makeTestDeps();
  const deps = coreDepsOf(full);
  expect(await coreStateTick(deps, at)).toBe("done");
  expect(await coreStateTick(deps, new Date(at.getTime() + 20 * 60_000))).toBe("not_due");
  expect(await coreStateTick(deps, new Date(at.getTime() + H))).toBe("done");
  const traces = await full.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "core_state_tick"));
  expect(traces).toHaveLength(2);
  expect(traces[0]!.model).toBeNull();
});

test("a busy day pulls energy lower than a free one", async () => {
  const run = async (busy: boolean) => {
    await resetDb();
    const full = makeTestDeps({ core: { state: { noise: 0 } }, life: { timezone: "UTC" } });
    if (busy)
      await insertLifeDay(full.db, {
        date: "2026-01-05",
        plan: { blocks: [{ start: "01:00", end: "10:00", kind: "busy", busy: 1, label: "reading" }] },
        source: "scripted",
        model: "none",
        prompt_version: "scripted",
        generated_at: at,
      });
    await coreStateTick(coreDepsOf(full), at);
    return (await full.core.state.get())!.energy;
  };
  expect(await run(true)).toBeLessThan(await run(false));
});

test("the same hour gives the same state: noise is seeded by the hour alone", async () => {
  const once = async () => {
    await resetDb();
    const full = makeTestDeps();
    await coreStateTick(coreDepsOf(full), at);
    return full.core.state.get();
  };
  expect(await once()).toEqual(await once());
});

test("an old preoccupation expires", async () => {
  const full = makeTestDeps();
  const deps = coreDepsOf(full);
  await full.core.state.ensure(full.config.core.state.baseline);
  const id = await full.core.memory.insert({
    kind: "episode",
    content: "x",
    embedding: Array(1024).fill(0.01),
    occurred_at: at,
    created_at: at,
    status: "open",
    salience: 0.4,
    valence: 0.9,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
  const since = new Date(at.getTime() - (full.config.core.state.preoccupation_hours + 1) * H);
  await full.core.state.update({ preoccupation: id, preoccupation_since: since });
  await coreStateTick(deps, at);
  expect((await full.core.state.get())!.preoccupation).toBeNull();
});
```

`tests/mind/state/core/line.test.ts`: port `tests/mind/state/legacy-ego/line.test.ts` to `coreStateLine` with seed `hourIso` only, and add:

```ts
test("the line is the same for every user at the same hour", async () => {
  const deps = makeTestDeps();
  await deps.core.state.ensure({ mood_valence: -0.9, mood_arousal: 0.9, energy: 0.1 });
  const now = new Date("2026-01-05T11:20:00Z");
  expect(await loadCoreStateLine(deps, now)).toBe(await loadCoreStateLine(deps, now));
  expect(await loadCoreStateLine(deps, now)).not.toBeNull();
});
```

- [ ] **Step 3: Run them and check that they fail.**
Run: `pnpm vitest run tests/mind/state/core`
Expected: FAIL.

- [ ] **Step 4: Implement.**
  - `src/mind/state/core/core-state.ts`: copy `src/mind/state/legacy-ego/ego.ts`, then: header "Her core state's maths: an hourly drift toward her baseline with bounded noise, an energy rhythm in her own hours, drain from busy blocks, and the nudge a strong event gives her mood. Pure functions; the tick applies them."; rename `EgoState` → `CoreMood` (import from `./types`), `stateOf` → `moodOf`, `EgoConfig` → `CoreStateConfig`; `dayLoad(blocks: WorldBlock[], …)` (field names unchanged); **remove** `exchangeTone` and `applyExchange` (they now live in `relationship/affect.ts` or are gone).
  - `src/mind/state/core/tick.ts`:

```ts
/**
 * `core_state_tick`: one hourly step of her core state. Mood and arousal drift toward her
 * baseline, energy follows her daily rhythm and her busy blocks, and an old preoccupation lets go.
 * One row for everyone, so the step is the same whichever user is talking to her.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { seededUnit } from "@/mind/platform/seeded-random";
import { HOUR } from "@/mind/platform/time";
import { localMidnight } from "@/mind/platform/timezone";
import { todaysBlocks } from "@/mind/world/blocks";
import { lifeDate, lifeHour, lifeTimezone } from "@/mind/world/her-clock";
import { dayLoad, driftStep, energyTarget, moodOf, preoccupationExpired } from "./core-state";

const sameHour = (a: Date | null, b: Date) =>
  !!a && Math.floor(a.getTime() / HOUR) === Math.floor(b.getTime() / HOUR);

export async function coreStateTick(deps: CoreDeps, now: Date): Promise<"not_due" | "done"> {
  const { core, config } = deps;
  const cfg = config.core.state;
  await core.state.ensure(cfg.baseline);
  if (sameHour((await core.state.get())?.last_tick ?? null, now)) return "not_due";

  const day = lifeDate(config.life, now);
  const blocks = await todaysBlocks(deps, now);
  const load = dayLoad(blocks, localMidnight(day, lifeTimezone(config.life, now)), now, cfg);
  const hourIso = new Date(Math.floor(now.getTime() / HOUR) * HOUR).toISOString();
  const noise = (["v", "a", "e"] as const).map(
    (d) => seededUnit(`core:${hourIso}:${d}`) * 2 - 1,
  ) as [number, number, number];

  return core.transaction(async (tx) => {
    const row = await tx.state.lock();
    if (sameHour(row.last_tick, now)) return "not_due";

    const target = {
      mood_valence: row.baseline.mood_valence,
      mood_arousal: row.baseline.mood_arousal,
      energy: energyTarget(row.baseline, lifeHour(config.life, now), load, cfg),
    };
    const next = driftStep(moodOf(row), target, noise, cfg);
    const clear = preoccupationExpired(row.preoccupation_since, now, cfg);
    await tx.state.update({
      ...next,
      last_tick: now,
      ...(clear ? { preoccupation: null, preoccupation_since: null } : {}),
    });
    await tx.traces.insert({
      loop: "core_state_tick",
      inputs: { load, hour: lifeHour(config.life, now) },
      outputs: { ...next, preoccupation_cleared: clear },
      model: null,
      prompt_version: null,
      tokens_in: null,
      tokens_out: null,
      cost: null,
      created_at: now,
    });
    return "done" as const;
  });
}
```

  (`todaysBlocks` takes `Pick<Deps,"core"|"config">`, which `CoreDeps` satisfies.)
  - `src/mind/state/core/line.ts`: copy `legacy-ego/line.ts`'s `band` and `egoLine` (renamed `coreStateLine`, typed on `CoreMood`/`CoreStateConfig`); loader:

```ts
/** Hot path, read-only: the caller wraps this in a deadline and treats a failure as no line. */
export async function loadCoreStateLine(
  deps: Pick<Deps, "core" | "config">,
  now: Date,
): Promise<string | null> {
  const row = await deps.core.state.get();
  if (!row) return null;
  const phrases = parseSummaryPhrases(
    loadPrompt("core-state/line", deps.config.prompts.core_state_line),
  );
  const hourIso = new Date(Math.floor(now.getTime() / HOUR) * HOUR).toISOString();
  return coreStateLine(moodOf(row), deps.config.core.state, phrases, `core:${hourIso}`);
}
```

  `parseSummaryPhrases` lives in `state/user/relationship/summary.ts`, which core code may not import. Move `parseSummaryPhrases` and its `Phrases` type to `src/mind/platform/phrases.ts` (header: "Phrase files: a prompt file of `key: phrase` lines, read into lists by key."), and update its importers (`summary.ts`, `compose.ts`, outreach).
  - `git mv prompts/ego/line/v1.md prompts/core-state/line/v1.md`.
  - `jobs.ts`: replace `EGO_TICK_QUEUE = "ego_tick"` with `CORE_STATE_TICK_QUEUE = "core_state_tick"`. `state-jobs.ts`: register `CORE_STATE_TICK_QUEUE` running `coreStateTick(coreDepsOf(deps), deps.clock.now())` on `config.core.state.tick_cron`; header "State jobs: the relationship's daily tick and her hourly core state tick." Update `tests/mind/platform/job-names.test.ts` for the new name.
  - `compose.ts`: the `feeling` promise becomes `bounded(deps, "core state line", userId, () => loadCoreStateLine(deps, clock.now()), null)`.
  - `evals/lib/life-loop.ts`: replace the `egoTick` call with `await coreStateTick(coreDepsOf(deps), now);`.
  - `git rm src/mind/state/legacy-ego/tick.ts src/mind/state/legacy-ego/line.ts tests/mind/state/legacy-ego/tick.test.ts tests/mind/state/legacy-ego/line.test.ts`. Delete `adminListLifeUsers` callers that were only for the ego tick (the life tick still uses it).

- [ ] **Step 5: Run everything.**
Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. The `ego` eval assertion now reads an `ego_tick` table that nothing writes; it is replaced in Task 11. Skip `evals` for now.

- [ ] **Step 6: Commit.**

```bash
pnpm format
git add -A src config prompts evals tests
git commit -m "feat: one core state for her, ticked hourly"
```

---

### Task 8: Core events and the world tick (retires the per-user mind)

**Files:**
- Create: `src/mind/world/events.ts`, `src/mind/process/core/appraise.ts`, `src/mind/process/core/world-tick.ts`
- Modify: `src/db/schema.ts` (`life_event_log`; drop `identity`, `ego_tick`), `src/mind/world/types.ts` + `src/db/repos/core/world.ts` (`logEventAttempts`), `src/mind/platform/config.ts` + `config/default.json` (`core.world`; remove life-event keys and `ego`), `src/mind/platform/jobs.ts`, `src/worker/world-jobs.ts`, `src/mind/process/outreach/{inputs,candidates,types,send}.ts`, `src/mind/process/hot-path/compose.ts` (`ReachOutTrigger`), `src/mind/memory/user/retrieve.ts` (drop user preoccupation), `src/db/repos/user/facts.ts`, `src/db/repos/user/entities.ts`, `src/db/reset-self.ts`, `src/db/admin.ts`, `evals/lib/life-loop.ts`
- Delete: `src/mind/world/legacy-life-tick/`, `src/mind/state/legacy-ego/`, `src/db/repos/user/identity.ts`, `src/db/repos/user/life-event-log.ts`, `src/db/repos/admin/life.ts`, and their tests (`tests/mind/world/legacy-life-tick/`, `tests/mind/state/legacy-ego/`, `tests/db/migration-identity-columns.test.ts`, the identity/life-event-log parts of `tests/db/life-repos.test.ts`)
- Migration: `life_event_log` reshaped, `identity` and `ego_tick` dropped, generated self facts and their threads deleted
- Test: `tests/mind/world/events.test.ts`, `tests/mind/process/core/appraise.test.ts`, `tests/mind/process/core/world-tick.test.ts`, `tests/mind/process/outreach/*.test.ts`, `tests/db/migration-mind-split.test.ts`, `tests/helpers/llm.ts`

**Interfaces:**
- Consumes: `CoreDeps`, `reconcileAgainstNeighbours` (Task 3), `loadPersona` (Task 4), `applyEvent`, `moodOf` (Task 7), `blocksForDay` (Task 6).
- Produces:
  - `generateCoreEvents(deps: CoreDeps, day: string, now: Date, inject?: (day: string) => InjectedEvent | null): Promise<{ accepted: AcceptedEvent[]; attempts: EventAttempt[] }>`; `InjectedEvent = { content: string; valence: number }`; `EventCandidate`, `EventSchema`, `checkEvent`, `checkRules` in `@/mind/world/events`.
  - `appraiseEvent(core: CoreScope, deps: Pick<CoreDeps,"config">, event: AppraisableEvent, now: Date): Promise<string>` (returns the episode id) in `@/mind/process/core/appraise`; `AppraisableEvent = { worldEventId: string; content: string; valence: number; stakes: "low"|"high"; at: Date; embedding: number[]; agents: string[] }`.
  - `coreWorldTick(deps: CoreDeps, now: Date, opts?: { inject?: (day: string) => InjectedEvent | null }): Promise<"not_due" | "done">` in `@/mind/process/core/world-tick`; queue `CORE_WORLD_TICK_QUEUE = "core_world_tick"`.
  - Outreach: `Candidate.coreMemoryId: string | null`; `her_day` topic `core:<id>`; `ReachOutTrigger` adds `coreMemoryId`.
  - `tests/helpers/llm.ts`: `sequence(...outputs: unknown[]): (input: string) => unknown`.

- [ ] **Step 1: Schema and config.**
  `schema.ts`: delete `identity` and `ego_tick` and their exports/types. Reshape `life_event_log`:

```ts
/** Every core-event attempt. Diagnostic only, never read by the chat loop. */
export const life_event_log = pgTable(
  "life_event_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    life_day: date("life_day", { mode: "string" }).notNull(),
    attempt: integer("attempt").notNull(),
    candidate: jsonb("candidate").notNull(),
    decision: text("decision").notNull(),
    target_memory_id: uuid("target_memory_id").references(() => core_memory.id, {
      onDelete: "set null",
    }),
    world_event_id: uuid("world_event_id").references(() => world_event.id, {
      onDelete: "set null",
    }),
    model: text("model"),
    prompt_version: text("prompt_version"),
    created_at: ts("created_at").notNull(),
  },
  (t) => [index("life_event_log_created_idx").on(t.created_at)],
);
```

  (Move its definition below the core tables so the references resolve.)
  Run `pnpm db:generate` (answer "create column" for the new columns). Append to the generated SQL:

```sql
--> statement-breakpoint
DELETE FROM "life_event_log";
--> statement-breakpoint
DELETE FROM "thread" t WHERE t.subject = 'self' AND EXISTS (
  SELECT 1 FROM "fact" f WHERE f.thread_id = t.id AND f.source = 'generated');
--> statement-breakpoint
DELETE FROM "fact" WHERE subject = 'self' AND source = 'generated';
```

  (Put the `DELETE FROM "life_event_log"` **before** the generated `ALTER TABLE … DROP COLUMN "user_id"` / `ADD COLUMN` statements by placing it at the top of the file, so `NOT NULL` additions don't hit old rows; the other two deletes can go at the end.)
  `config.ts`/`default.json`: add `core.world`:

```json
    "world": {
      "tick_cron": "10 * * * *",
      "events_local_hour": 0,
      "events_per_day_max": 1,
      "event_probability": 0.5,
      "event_context_items": 20,
      "event_context_days": 14,
      "event_max_tokens": 600,
      "event_max_chars": 300,
      "injected_event_at": "12:00",
      "event_salience": 0.4,
      "event_confidence": 1.0,
      "entity_salience": 0.5,
      "regen_attempts": 2,
      "new_entity_days": 7,
      "high_stakes_min_days": 14,
      "canon_entities": ["Alcor"]
    }
```

  with the zod schema (`events_local_hour: hourOfDay`, `canon_entities: z.array(text)`, counts `countFromZero`, `regen_attempts: countFromZero`, salience/confidence/probability `unit`, days `nonNegative`, `injected_event_at: clockTime`, tokens/chars `positiveInt`). Remove from `life`: `tick_cron`, `tick_local_hour`, `lock_timeout_ms`, `events_per_day_max`, `event_probability`, `event_context_facts`, `event_max_tokens`, `event_max_chars`, `injected_event_at`, `event_salience`, `event_confidence`, `regen_attempts`, `new_entity_days`, `high_stakes_min_days`, `high_stakes_checkpoint_days`, `preoccupation_min_valence`, `canon_entities`. Remove the `ego` section and `EgoConfig`. Fix `tests/mind/platform/config.test.ts` accordingly.

- [ ] **Step 2: `World.logEventAttempts`.** Add to `src/mind/world/types.ts`:

```ts
/** One event-generator attempt, for the inspector. */
export type NewEventAttempt = {
  life_day: string;
  attempt: number;
  candidate: unknown;
  decision: string;
  target_memory_id: string | null;
  world_event_id: string | null;
  model: string;
  prompt_version: string;
  created_at: Date;
};
```

  and `logEventAttempts(attempts: NewEventAttempt[]): Promise<void>;` to the `World` interface; implement in `src/db/repos/core/world.ts` (importing `life_event_log` from the schema):

```ts
    async logEventAttempts(attempts) {
      if (attempts.length) await db.insert(life_event_log).values(attempts);
    },
```

  Add `life_event_log` to `truncateAll`'s list.

- [ ] **Step 3: Test helper.** `tests/helpers/llm.ts`:

```ts
/**
 * Scripted model outputs for tests: `sequence` returns each output in turn (repeating the last), and
 * an Error output is thrown, so one handler can walk every branch of a process.
 */
export function sequence(...outputs: unknown[]): (input: string) => unknown {
  let i = 0;
  return () => {
    const out = outputs[Math.min(i, outputs.length - 1)];
    i += 1;
    if (out instanceof Error) throw out;
    return structuredClone(out);
  };
}
```

- [ ] **Step 4: Write the failing tests.**

`tests/mind/world/events.test.ts`: port the pure-function cases of `tests/mind/world/legacy-life-tick/events.test.ts` (`checkEvent`, `checkRules`, `buildEventInput`) to `@/mind/world/events` with `cfg = loadConfig().core.world`, then add the generator branch tests against the DB:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import { generateCoreEvents } from "@/mind/world/events";
import { closeTestDb, resetDb, vec } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";
import { sequence } from "../../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");
const day = "2026-01-05";
const ev = (content: string, extra: object = {}) => ({
  content,
  at: "15:00",
  valence: 0.3,
  stakes: "low",
  entity_names: [],
  ...extra,
});
const always = { core: { world: { event_probability: 1, events_per_day_max: 1 } } };

async function withEpisode(deps: ReturnType<typeof makeTestDeps>, content: string) {
  await deps.core.memory.insert({
    kind: "episode",
    content,
    embedding: vec(0.01),
    occurred_at: now,
    created_at: now,
    status: "resolved",
    salience: 0.4,
    valence: 0,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
}

test("accepts a valid event with no near memory, without asking reconcile", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(ev("She found an old film."));
  const out = await generateCoreEvents(coreDepsOf(deps), day, now);
  expect(out.accepted).toHaveLength(1);
  expect(out.attempts.map((a) => a.decision)).toEqual(["accepted"]);
  expect(deps.llm.structuredCalls.filter((c) => c.purpose === "reconcile")).toHaveLength(0);
});

test.each(["duplicate", "contradicts"] as const)(
  "a %s is regenerated with the reason",
  async (relation) => {
    const deps = makeTestDeps(always);
    // Every text embeds to the stored episode's vector, so it is always a near neighbour.
    vi.spyOn(deps.embedder, "embed").mockImplementation(async (xs) => xs.map(() => vec(0.01)));
    await withEpisode(deps, "She rewatched Solaris.");
    const near = await deps.core.memory.near(vec(0.01), 1, 0);
    deps.llm.handlers.life_event = sequence(ev("She rewatched Solaris."), ev("She baked bread."));
    deps.llm.handlers.reconcile = sequence(
      { relation, target_fact_id: near[0]!.id },
      { relation: "new", target_fact_id: null },
    );
    const out = await generateCoreEvents(coreDepsOf(deps), day, now);
    expect(out.attempts.map((a) => a.decision)).toEqual([relation, "accepted"]);
    const second = deps.llm.structuredCalls.filter((c) => c.purpose === "life_event")[1]!;
    expect(second.input).toContain("Rejected attempts");
  },
);

test("two new people at once breaks the new-entity rule", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(
    ev("She met Ana and Bo.", { entity_names: ["Ana", "Bo"] }),
    ev("She read alone."),
  );
  const out = await generateCoreEvents(coreDepsOf(deps), day, now);
  expect(out.attempts.map((a) => a.decision)).toEqual(["rule:new_entity", "accepted"]);
});

test("high stakes too soon after the last one is refused", async () => {
  const deps = makeTestDeps(always);
  await deps.core.world.recordEvent({
    at: now,
    kind: "planned",
    content: "big",
    valence: 0.5,
    stakes: "high",
    agents: [],
    life_day: "2026-01-04",
    created_at: now,
  });
  deps.llm.handlers.life_event = sequence(ev("Another big thing.", { stakes: "high" }), ev("small"));
  const out = await generateCoreEvents(coreDepsOf(deps), day, now);
  expect(out.attempts[0]!.decision).toBe("rule:high_stakes");
});

test("an invalid event (bad time) is retried, and gives up after regen_attempts", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(ev("x", { at: "25:99" }));
  const out = await generateCoreEvents(coreDepsOf(deps), day, now);
  expect(out.accepted).toHaveLength(0);
  expect(out.attempts).toHaveLength(1 + deps.config.core.world.regen_attempts);
  expect(new Set(out.attempts.map((a) => a.decision))).toEqual(new Set(["invalid"]));
});

test("a model error or timeout propagates (the tick retries next hour)", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(new Error("timeout"));
  await expect(generateCoreEvents(coreDepsOf(deps), day, now)).rejects.toThrow("timeout");
});

test("draws are seeded by day only: the same day gives the same draws", async () => {
  const cfg = { core: { world: { event_probability: 0.5, events_per_day_max: 3 } } };
  const a = makeTestDeps(cfg);
  const b = makeTestDeps(cfg);
  const ra = await generateCoreEvents(coreDepsOf(a), day, now);
  const rb = await generateCoreEvents(coreDepsOf(b), day, now);
  expect(ra.attempts.length).toBe(rb.attempts.length);
});

test("an injected event is the first attempt", async () => {
  const deps = makeTestDeps({ core: { world: { event_probability: 0 } } });
  const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => ({
    content: "Spica got the telescope images.",
    valence: 0.8,
  }));
  expect(out.accepted[0]!.candidate.content).toBe("Spica got the telescope images.");
  expect(out.attempts[0]!.source).toBe("injected");
});

test("the generator sees only core context: her episodes, her people, her plan", async () => {
  const deps = makeTestDeps(always);
  await withEpisode(deps, "She rewatched Solaris.");
  await generateCoreEvents(coreDepsOf(deps), day, now);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!;
  expect(call.input).toContain("She rewatched Solaris.");
  expect(call.input).toContain("Alcor");
  expect(call.input).not.toContain("with this friend");
});
```

(Add `vi` to the file's `vitest` import.)

`tests/mind/process/core/appraise.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { appraiseEvent } from "@/mind/process/core/appraise";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");
const base = {
  worldEventId: "00000000-0000-0000-0000-000000000001",
  content: "Spica got the telescope images.",
  at: now,
  embedding: vec(0.01),
  agents: [],
};

async function setup() {
  const deps = makeTestDeps();
  await deps.core.state.ensure(deps.config.core.state.baseline);
  const wid = await deps.core.world.recordEvent({
    at: now,
    kind: "planned",
    content: base.content,
    valence: 0.8,
    stakes: "high",
    agents: [],
    life_day: "2026-01-05",
    created_at: now,
  });
  return { deps, event: { ...base, worldEventId: wid } };
}

test("a strong event becomes an open episode, lifts her mood and takes her mind", async () => {
  const { deps, event } = await setup();
  const before = (await deps.core.state.get())!;
  const id = await deps.core.transaction((tx) =>
    appraiseEvent(tx, deps, { ...event, valence: 0.8, stakes: "high" }, now),
  );
  const episode = (await deps.core.memory.get(id))!;
  expect(episode).toMatchObject({
    kind: "episode",
    valence: 0.8,
    status: "open",
    source: "world",
    source_ref: `world_event:${event.worldEventId}`,
  });
  const after = (await deps.core.state.get())!;
  expect(after.mood_valence).toBeGreaterThan(before.mood_valence);
  expect(after.preoccupation).toBe(id);
});

test("a mild low-stakes event is a resolved episode and leaves her preoccupation alone", async () => {
  const { deps, event } = await setup();
  const id = await deps.core.transaction((tx) =>
    appraiseEvent(tx, deps, { ...event, valence: 0.1, stakes: "low" }, now),
  );
  expect((await deps.core.memory.get(id))!.status).toBe("resolved");
  expect((await deps.core.state.get())!.preoccupation).toBeNull();
});
```

`tests/mind/process/core/world-tick.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { count, eq } from "drizzle-orm";
import { core_loop_trace, core_memory, life_event_log, world_event } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { closeTestDb, createTestUser, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { sequence } from "../../../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);
const cfg = { core: { world: { event_probability: 1, events_per_day_max: 1 } } };
const at = new Date("2026-01-05T09:00:00Z"); // 17:00 in Singapore
const rows = async (deps: ReturnType<typeof makeTestDeps>, table: typeof world_event) =>
  (await deps.db.select({ n: count() }).from(table))[0]!.n;

test("generates once per her day, however many users and however many runs", async () => {
  const deps = makeTestDeps(cfg);
  await createTestUser();
  await createTestUser();
  expect(await coreWorldTick(coreDepsOf(deps), at)).toBe("done");
  expect(await coreWorldTick(coreDepsOf(deps), new Date(at.getTime() + 3_600_000))).toBe("not_due");
  expect(await rows(deps, world_event)).toBe(1);
  expect((await deps.db.select({ n: count() }).from(core_memory))[0]!.n).toBe(1);
  expect((await deps.db.select({ n: count() }).from(life_event_log))[0]!.n).toBe(1);
  const traces = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "core_world_tick"));
  expect(traces).toHaveLength(1);
});

test("a failure mid-apply writes nothing and the next run retries", async () => {
  const deps = makeTestDeps(cfg);
  deps.llm.handlers.life_event = sequence(new Error("model down"));
  await expect(coreWorldTick(coreDepsOf(deps), at)).rejects.toThrow("model down");
  expect(await rows(deps, world_event)).toBe(0);
  expect((await deps.core.state.get())?.last_event_day ?? null).toBeNull();

  deps.llm.handlers.life_event = sequence({
    content: "She found an old film.",
    at: "15:00",
    valence: 0.3,
    stakes: "low",
    entity_names: [],
  });
  expect(await coreWorldTick(coreDepsOf(deps), at)).toBe("done");
  expect(await rows(deps, world_event)).toBe(1);
});

test("no plan for today still makes a generic event", async () => {
  const deps = makeTestDeps(cfg);
  await coreWorldTick(coreDepsOf(deps), at);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!;
  expect(call.input).toContain("unknown, keep the event generic");
  expect(await rows(deps, world_event)).toBe(1);
});

test("waits for her events hour", async () => {
  const deps = makeTestDeps({ core: { world: { events_local_hour: 20 } } });
  expect(await coreWorldTick(coreDepsOf(deps), at)).toBe("not_due");
});

test("new people in an event join her entities", async () => {
  const deps = makeTestDeps(cfg);
  deps.llm.handlers.life_event = sequence({
    content: "She met Mira at the observatory.",
    at: "15:00",
    valence: 0.4,
    stakes: "low",
    entity_names: ["Mira"],
  });
  await coreWorldTick(coreDepsOf(deps), at);
  expect((await deps.core.memory.entities()).map((e) => e.name)).toContain("Mira");
});
```

- [ ] **Step 5: Run them and check that they fail.**
Run: `pnpm vitest run tests/mind/world/events.test.ts tests/mind/process/core`
Expected: FAIL (modules missing).

- [ ] **Step 6: Implement `src/mind/world/events.ts`.** Start from `legacy-life-tick/events.ts` and change:
  - Header: "Her events, generated once for her whole world, not per user. A candidate is generated from her plan, her recent episodes and the people she knows, checked by rules (how often someone new appears, how often something big happens), and reconciled against her core memory; a duplicate or contradiction is regenerated. Read-only: the world tick applies what's accepted."
  - Imports: only `@/mind/platform/*`, `@/mind/memory/shared/reconcile`, `@/mind/world/*`, `zod`, and types from `@/db/schema` (`LifePlan`). No user repos.
  - Config type: `type WorldConfig = Config["core"]["world"]`; every `cfg.` read uses it.
  - `CoreEventContext = { plan: LifePlan | null; episodes: { content: string; when: Date }[]; people: string[] }`, loaded by:

```ts
async function coreEventContext(deps: CoreDeps, day: string, now: Date): Promise<CoreEventContext> {
  const cfg = deps.config.core.world;
  const from = new Date(now.getTime() - cfg.event_context_days * DAY);
  const episodes = await deps.core.memory.recentEpisodes(from, now, cfg.event_context_items);
  const known = (await deps.core.memory.entities()).map((e) => e.name);
  return {
    plan: await deps.core.world.plan(day),
    episodes: episodes.map((e) => ({ content: e.content, when: e.occurred_at ?? e.created_at })),
    people: [...new Set([...cfg.canon_entities, ...known])],
  };
}
```

  - `buildEventInput(ctx, day, rejected, now)`: same as before but the facts paragraph becomes `` `What has happened in her life lately (never contradict):\n${…}` `` / `"What has happened in her life lately: nothing yet."` and the people line `People she knows: …`.
  - `checkRules(c, ctx, now, cfg: WorldConfig)`: unchanged logic.
  - `generateCoreEvents(deps: CoreDeps, day, now, inject?)`: draws seeded by `` `${day}:${i}` ``; `inject?.(day)`; `lastNewEntityAt = await deps.core.memory.latestEntityFirstSeen()`; `lastHighStakesAt = await deps.core.world.lastHighStakesAt()`; system prompt `` `${loadPersona(config).coreValues}\n\n${loadPrompt("life/event", config.prompts.life_event)}` ``; neighbours from `deps.core.memory.near(embedding, config.reconcile.neighbor_k, config.reconcile.near_match_similarity)`; reconcile with `{ label: "episode", content: c.content }`. `AcceptedEvent = { key; candidate: EventCandidate; embedding: number[]; at: Date }` where `at = lifeInstant(config.life, day, c.at)`. Drop the `fact`, `decision` and `newEntity` fields (the tick adds entities itself).

- [ ] **Step 7: Implement `src/mind/process/core/appraise.ts`.**

```ts
/**
 * Appraisal: how an event in her world lands with her. For now the event's own valence is the
 * appraisal; the episode it leaves in her memory carries that feeling, her mood moves with it,
 * and a strong one takes over her mind for a while. The core loops will replace this with a
 * model that weighs the event against her goals and state.
 */
import type { CoreScope } from "@/mind/platform/core";
import type { CoreDeps } from "@/mind/platform/deps";
import { applyEvent, moodOf } from "@/mind/state/core/core-state";

export type AppraisableEvent = {
  worldEventId: string;
  content: string;
  valence: number;
  stakes: "low" | "high";
  at: Date;
  embedding: number[];
  agents: string[];
};

/** Inside the caller's transaction. Returns the new episode's id. */
export async function appraiseEvent(
  core: CoreScope,
  deps: Pick<CoreDeps, "config">,
  event: AppraisableEvent,
  now: Date,
): Promise<string> {
  const { world, state } = deps.config.core;
  const episodeId = await core.memory.insert({
    kind: "episode",
    content: event.content,
    embedding: event.embedding,
    entity_refs: event.agents,
    occurred_at: event.at,
    created_at: now,
    // A big event stays open until its story resolves; a small one is over when it happens.
    status: event.stakes === "high" ? "open" : "resolved",
    salience: world.event_salience,
    valence: event.valence,
    confidence: world.event_confidence,
    source: "world",
    source_ref: `world_event:${event.worldEventId}`,
  });

  const row = await core.state.lock();
  const mood = applyEvent(moodOf(row), event.valence, state);
  const strong = Math.abs(event.valence) >= state.preoccupation_min_valence;
  await core.state.update({
    ...mood,
    ...(strong ? { preoccupation: episodeId, preoccupation_since: now } : {}),
  });
  return episodeId;
}
```

- [ ] **Step 8: Implement `src/mind/process/core/world-tick.ts`.**

```ts
/**
 * `core_world_tick`: once per her local day, what happens in her life. Events are generated once
 * for everyone, recorded in her world, appraised into her memory and mood, and every attempt is
 * logged. Generation runs outside the transaction; the apply holds a global lock and re-checks the
 * day, so a retry never doubles a day and a failure writes nothing.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { lifeDate, lifeHour } from "@/mind/world/her-clock";
import { generateCoreEvents, type InjectedEvent } from "@/mind/world/events";
import { appraiseEvent } from "./appraise";

export type WorldTickOptions = { inject?: (day: string) => InjectedEvent | null };

const due = (lastDay: string | null, day: string) => !lastDay || lastDay < day;

export async function coreWorldTick(
  deps: CoreDeps,
  now: Date,
  opts: WorldTickOptions = {},
): Promise<"not_due" | "done"> {
  const { core, config } = deps;
  if (lifeHour(config.life, now) < config.core.world.events_local_hour) return "not_due";
  const day = lifeDate(config.life, now);
  await core.state.ensure(config.core.state.baseline);
  if (!due((await core.state.get())?.last_event_day ?? null, day)) return "not_due";

  const { accepted, attempts } = await generateCoreEvents(deps, day, now, opts.inject);

  return core.transaction(async (tx) => {
    await tx.lock("core_world_tick");
    const row = await tx.state.lock();
    if (!due(row.last_event_day, day)) return "not_due" as const;

    const eventIds = new Map<string, string>();
    const episodeIds: string[] = [];
    for (const e of accepted) {
      const agents = await tx.memory.addEntities(
        e.candidate.entity_names,
        config.core.world.entity_salience,
        now,
      );
      const worldEventId = await tx.world.recordEvent({
        at: e.at,
        kind: "planned",
        content: e.candidate.content,
        valence: e.candidate.valence,
        stakes: e.candidate.stakes,
        agents,
        life_day: day,
        created_at: now,
      });
      eventIds.set(e.key, worldEventId);
      episodeIds.push(
        await appraiseEvent(
          tx,
          deps,
          {
            worldEventId,
            content: e.candidate.content,
            valence: e.candidate.valence,
            stakes: e.candidate.stakes,
            at: e.at,
            embedding: e.embedding,
            agents,
          },
          now,
        ),
      );
    }

    await tx.world.logEventAttempts(
      attempts.map((a) => ({
        life_day: day,
        attempt: a.attempt,
        candidate: { ...(a.candidate as object), source: a.source },
        decision: a.decision,
        target_memory_id: a.targetMemoryId,
        world_event_id: eventIds.get(a.key) ?? null,
        model: a.source === "model" ? config.models.life : "injected",
        prompt_version: a.source === "model" ? config.prompts.life_event : "injected",
        created_at: now,
      })),
    );
    await tx.state.update({ last_event_day: day });
    await tx.traces.insert({
      loop: "core_world_tick",
      inputs: { day, attempts: attempts.length },
      outputs: { world_events: [...eventIds.values()], episodes: episodeIds },
      model: config.models.life,
      prompt_version: config.prompts.life_event,
      tokens_in: null,
      tokens_out: null,
      cost: null,
      created_at: now,
    });
    return "done" as const;
  });
}
```

  (Rename the attempt field `targetFactId` → `targetMemoryId` in `events.ts`.)
  The day's events are generated against her memory as it stood before the transaction; two concurrent ticks both generate, but only one applies (the second sees `last_event_day` under the lock).

- [ ] **Step 9: Jobs.** `jobs.ts`: replace `LIFE_TICK_QUEUE = "life_tick"` with `CORE_WORLD_TICK_QUEUE = "core_world_tick"`. `world-jobs.ts`: header "World jobs: her day plan (`life_plan`) and what happens in her day (`core_world_tick`)."; register `CORE_WORLD_TICK_QUEUE` running `coreWorldTick(coreDepsOf(deps), deps.clock.now())` on `config.core.world.tick_cron`. Update `job-names.test.ts`. `evals/lib/life-loop.ts`: replace the `lifeTick` call with `await coreWorldTick(coreDepsOf(deps), now, { inject: (day) => inject(day) });` and change `inject` to take `(day: string)`.

- [ ] **Step 10: Outreach `her_day` from core.**
  - `types.ts`: add `coreMemoryId: string | null;` to `Candidate`; `herDay` items stay `{ id; content; salience; sensitive }` (ids are core memory ids now).
  - `inputs.ts` `loadHerDay(deps: Pick<Deps,"core">, now, lookbackHours)`:

```ts
/** Her recent episodes, plus her preoccupation if it isn't already among them. Core memory: never sensitive. */
async function loadHerDay(
  deps: Pick<Deps, "core">,
  now: Date,
  lookbackHours: number,
  limit: number,
): Promise<CandidateInputs["herDay"]> {
  const from = new Date(now.getTime() - lookbackHours * HOUR);
  const episodes = await deps.core.memory.recentEpisodes(from, now, limit);
  const herDay = episodes.map((e) => ({
    id: e.id,
    content: e.content,
    salience: e.salience,
    sensitive: false,
  }));
  const state = await deps.core.state.get();
  const pre = state?.preoccupation ? await deps.core.memory.get(state.preoccupation) : null;
  if (pre && pre.status !== "superseded" && pre.status !== "stale" && !herDay.some((m) => m.id === pre.id))
    herDay.push({ id: pre.id, content: pre.content, salience: pre.salience, sensitive: false });
  return herDay;
}
```

  (`limit` = `settings.due_threads_limit`, or add `outreach.her_day_limit: 5` to config if no fitting key exists.) `loadCandidateInputs` deps type gains `"core"`.
  - `candidates.ts`: the `her_day` loop no longer goes through `addMemory`; instead:

```ts
  for (const memory of inputs.herDay) {
    raw.push({
      kind: "her_day",
      topic: `core:${memory.id}`,
      text: memory.content,
      strength: memory.salience,
      factId: null,
      coreMemoryId: memory.id,
      threadId: null,
      sensitive: memory.sensitive,
    });
  }
```

  and every other candidate gets `coreMemoryId: null`.
  - `compose.ts`: `ReachOutTrigger = Pick<Candidate, "kind" | "text" | "factId" | "threadId" | "coreMemoryId">`. (It is forced into core retrieval in Task 9.)
  - Delete `listOutreachHerDay`, `listRecentSelfFacts`, `getPreoccupationFact` from `facts.ts`, `listSelfEntityNames` and `latestSelfEntityFirstSeen` from `entities.ts`; remove `addPreoccupation` from `retrieve.ts` (and the header's "and her current preoccupation"). Her preoccupation now reaches the reply through core retrieval (Task 9).

- [ ] **Step 11: Delete the legacy per-user mind.**

```bash
git rm -r src/mind/world/legacy-life-tick src/mind/state/legacy-ego tests/mind/world/legacy-life-tick tests/mind/state/legacy-ego
git rm src/db/repos/user/identity.ts src/db/repos/user/life-event-log.ts src/db/repos/admin/life.ts tests/db/migration-identity-columns.test.ts
```

  Remove the `legacy` constant and `ignores: legacy` from `eslint.config.mjs`, and the "exempts the legacy per-user folders" case from `boundaries.test.ts`. Rewrite `src/db/reset-self.ts`'s `adminResetSelf` to: delete user-scope `self` facts, entities and threads as now (minus the `identity` update and its comment), **and** clear the core tables (`core_memory`, `core_entity`, `core_snapshot`, `world_event`, `life_event_log`, `core_loop_trace`, `core_state`) so the next worker start reseeds snapshot v0; update its doc comment and `tests/db/reset-self.test.ts`. Fix every remaining compile error `pnpm typecheck` reports (inspector imports are handled in Task 10; delete the identity/ego parts there now if they block compiling: `src/db/repos/admin/inspector.ts` identity and ego_tick queries, and the Identity tab).

- [ ] **Step 12: Outreach and migration tests.** Update `tests/mind/process/outreach/{inputs,tick}.test.ts`: `her_day` now comes from a core episode (`deps.core.memory.insert({...kind:"episode", occurred_at: <within lookback>})`), its topic is `core:<id>`, and `coreMemoryId` is set. Add `tests/db/migration-mind-split.test.ts`, which runs the generated migration's data statements against seeded rows: insert a generated self fact with a thread and a turn-sourced self fact for one user, execute the three `DELETE` statements from the migration file (read the file, split on `--> statement-breakpoint`, run the ones starting with `DELETE`), and assert only the turn-sourced fact and no thread remain.

- [ ] **Step 13: Run everything.**
Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: typecheck fails only in `evals/lib/life-check.ts` and `evals/lib/runner.ts` (they import `ego_tick` and `seed_self_facts` block-fact logic). Do **Task 11 Steps 1–3 now**, inside this task, so this commit compiles and every test passes. Task 11 then keeps only its Step 4 (fake eval run and baseline) and Step 5 (commit).

- [ ] **Step 14: Commit.**

```bash
pnpm format
git add -A
git commit -m "feat: her events happen once, in her own world; retire the per-user ego and life tick"
```

---

### Task 9: Reply assembly reads both minds

**Files:**
- Create: `src/mind/memory/core/retrieve.ts`, `prompts/reply/v9.md`
- Modify: `src/mind/process/hot-path/{assemble,compose}.ts`, `src/mind/process/turn-taking/commit-and-reply.ts` and `src/mind/process/outreach/send.ts` (store `snapshot_version`), `src/db/repos/user/session-log.ts` (`insertReplyIfAbsent` / `insertTurn` accept `snapshot_version`), `config/default.json` + `config.ts` (`retrieval.core_top_n`, `prompts.reply` → v9)
- Delete: `prompts/reply/v8.md`
- Test: `tests/mind/memory/core/retrieve.test.ts`, `tests/mind/process/hot-path/{assemble,compose}.test.ts`

**Interfaces:**
- Produces: `retrieveCore(deps: Pick<Deps,"core"|"embedder"|"config"|"log">, input: { queryText: string; now: Date; forceIds?: string[] }): Promise<CoreRetrieval>`; `CoreRetrieval = { memories: RetrievedFact[] }` (preoccupation included, `onMind: true`). `AssembleInput` gains `snapshot: string | null` and `coreMemories: RetrievedFact[]`. `Composed` gains `snapshotVersion: number | null`.

- [ ] **Step 1: Config and prompt.** `retrieval.core_top_n: 4` (`positiveInt`). Write `prompts/reply/v9.md` = v8 plus, after "## What you know about them":

```markdown
## Who you are
- "Who you are lately" is you right now: what you're into, what's on your mind, how you've been. Speak from it; don't recite it.
- "From your own life" are things that really happened to you. Bring one up only when it fits, the way a friend mentions their week.
- "What you've told them" is what you've already said about yourself in this friendship. Stay consistent with it.
- Your interests can lean toward theirs and things next to them in conversation; your own loves (stars, old films, books) stay yours.
```

  and in "## Your own state" keep the "How you're feeling" / "Your day" bullet. Set `"reply": "v9"`, `git rm prompts/reply/v8.md`.

- [ ] **Step 2: Write the failing tests.**

`tests/mind/memory/core/retrieve.test.ts`:

```ts
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { retrieveCore } from "@/mind/memory/core/retrieve";
import { core_memory } from "@/db/schema";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");

async function addEpisode(deps: ReturnType<typeof makeTestDeps>, content: string) {
  return deps.core.memory.insert({
    kind: "episode",
    content,
    embedding: vec(0.01),
    occurred_at: now,
    created_at: now,
    status: "resolved",
    salience: 0.4,
    valence: 0.1,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
}

test("returns at most core_top_n memories", async () => {
  const deps = makeTestDeps({ retrieval: { core_top_n: 2 } });
  for (const c of ["a", "b", "c"]) await addEpisode(deps, c);
  const r = await retrieveCore(deps, { queryText: "hi", now });
  expect(r.memories).toHaveLength(2);
});

test("her preoccupation is always there, marked on her mind", async () => {
  const deps = makeTestDeps({ retrieval: { core_top_n: 1 } });
  await addEpisode(deps, "a");
  const pre = await addEpisode(deps, "telescope");
  await deps.core.state.ensure(deps.config.core.state.baseline);
  await deps.core.state.update({ preoccupation: pre, preoccupation_since: now });
  const r = await retrieveCore(deps, { queryText: "hi", now });
  expect(r.memories.find((m) => m.id === pre)?.onMind).toBe(true);
});

test("forced ids are included; reading never writes to core memory", async () => {
  const deps = makeTestDeps({ retrieval: { core_top_n: 1 } });
  await addEpisode(deps, "a");
  const forced = await addEpisode(deps, "forced");
  const before = await deps.db.select().from(core_memory);
  const r = await retrieveCore(deps, { queryText: "hi", now, forceIds: [forced] });
  expect(r.memories.map((m) => m.id)).toContain(forced);
  expect(await deps.db.select().from(core_memory)).toEqual(before);
});

test("an embed failure degrades to the preoccupation only, never throws", async () => {
  const deps = makeTestDeps();
  vi.spyOn(deps.embedder, "embed").mockRejectedValue(new Error("down"));
  await expect(retrieveCore(deps, { queryText: "hi", now })).resolves.toEqual({ memories: [] });
});
```

In `tests/mind/process/hot-path/assemble.test.ts` add:

```ts
test("sections come in the two-mind order", () => {
  const { system } = assemblePrompt({
    valuesDoc: "VALUES",
    snapshot: "SNAPSHOT",
    feelingLine: "FEELING",
    yourDay: "DAY",
    relationshipSummary: "US",
    retrieval: {
      facts: {
        user: [{ id: "u", content: "USERFACT", when: now }],
        self: [{ id: "s", content: "TOLDTHEM", when: now }],
        shared: [],
      },
      dueThreads: [],
      recalled: [],
    },
    coreMemories: [{ id: "c", content: "HERLIFE", when: now, onMind: true }],
    recentTurns: [],
    now,
  });
  const order = ["VALUES", "SNAPSHOT", "FEELING", "DAY", "US", "USERFACT", "TOLDTHEM", "HERLIFE"].map(
    (s) => system.indexOf(s),
  );
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(system).toContain("## Who you are lately\nSNAPSHOT");
  expect(system).toContain("### What you've told them");
  expect(system).toContain("### From your own life");
  expect(system).toContain("HERLIFE (today) (on your mind lately)");
});
```

(Adjust `(today)` to whatever `relativeDate(now, now)` returns; read it from `src/mind/platform/relative-date.ts`.)

In `tests/mind/process/hot-path/compose.test.ts` add:

```ts
test("a reply reads the latest snapshot and reports its version", async () => {
  await seedSnapshot(coreDepsOf(deps));
  const composed = await composeReply(deps, userId, { turns, openQuestions: [], flag: null });
  expect(composed.snapshotVersion).toBe(0);
  expect(deps.llm.calls.at(-1)!.system).toContain("## Who you are lately");
});

test("with no snapshot the reply still goes out, with no version", async () => {
  const composed = await composeReply(deps, userId, { turns, openQuestions: [], flag: null });
  expect(composed.snapshotVersion).toBeNull();
  expect(deps.llm.calls.at(-1)!.system).not.toContain("## Who you are lately");
});

test("a crisis reply gets values, snapshot, user memory and turns, but no state or core memory", async () => {
  await seedSnapshot(coreDepsOf(deps));
  // insert one core episode, as in retrieve.test.ts
  await composeReply(deps, userId, { turns, openQuestions: [], flag: { flagged: true, category: "self_harm" } as never });
  const system = deps.llm.calls.at(-1)!.system;
  expect(system).toContain("## Who you are lately");
  expect(system).not.toContain("## How you're feeling");
  expect(system).not.toContain("### From your own life");
});
```

(Reuse the file's existing `deps`, `userId`, `turns` setup and its existing crisis-flag fixture instead of the cast if one exists.) Add a commit-and-reply or outreach-send test asserting the stored companion turn's `snapshot_version` equals 0 after seeding.

- [ ] **Step 3: Run them and check that they fail.**
Run: `pnpm vitest run tests/mind/memory/core/retrieve.test.ts tests/mind/process/hot-path`
Expected: FAIL.

- [ ] **Step 4: Implement `retrieveCore`.**

```ts
/**
 * Reply-time recall from her own life: the core memories closest to the conversation, her current
 * preoccupation, and anything a reach-out is about. Read-only on purpose: how often users bring up
 * something of hers must not change how much it matters to her. Never throws.
 */
import type { RetrievedFact } from "@/mind/memory/shared/types";
import { rankMemories } from "@/mind/memory/shared/ranking";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { withTimeout } from "@/mind/platform/timeout";

export type CoreRetrieval = { memories: RetrievedFact[] };

type CoreRetrieveDeps = Pick<Deps, "core" | "embedder" | "config" | "log">;

export async function retrieveCore(
  deps: CoreRetrieveDeps,
  input: { queryText: string; now: Date; forceIds?: string[] },
): Promise<CoreRetrieval> {
  const { core, embedder, config, log } = deps;
  const memories: RetrievedFact[] = [];
  const seen = new Set<string>();

  try {
    if (input.queryText.trim() !== "") {
      const [vector] = await withTimeout(
        embedder.embed([input.queryText], "query"),
        config.retrieval.embed_timeout_ms,
      );
      if (!vector) throw new Error("embedder returned no vector");
      const candidates = await core.memory.candidates(vector, config.retrieval.candidate_pool);
      const ranked = rankMemories(candidates, input.now, {
        top_n: config.retrieval.core_top_n,
        recency_half_life_days: config.retrieval.recency_half_life_days,
      });
      for (const m of ranked) {
        seen.add(m.id);
        memories.push({ id: m.id, content: m.content, when: m.occurred_at ?? m.created_at });
      }
    }
  } catch (e) {
    log.error("core retrieval degraded", { error: errorName(e) });
  }

  try {
    for (const id of input.forceIds ?? []) {
      if (seen.has(id)) continue;
      const m = await core.memory.get(id);
      if (!m || m.status === "superseded" || m.status === "stale") continue;
      seen.add(id);
      memories.push({ id, content: m.content, when: m.occurred_at ?? m.created_at });
    }
    const state = await core.state.get();
    const pre = state?.preoccupation ? await core.memory.get(state.preoccupation) : null;
    if (pre && pre.status !== "superseded" && pre.status !== "stale") {
      const existing = memories.find((m) => m.id === pre.id);
      if (existing) existing.onMind = true;
      else memories.push({ id: pre.id, content: pre.content, when: pre.occurred_at ?? pre.created_at, onMind: true });
    }
  } catch (e) {
    log.error("core forced recall failed", { error: errorName(e) });
  }

  return { memories };
}
```

  The embed-failure test expects `{ memories: [] }` with no preoccupation set; it passes because the state row doesn't exist.

- [ ] **Step 5: Assembly.** In `assemble.ts`: add `snapshot: string | null;` and `coreMemories: RetrievedFact[];` to `AssembleInput`; header lists the new order ("core values, who she is lately, how she's feeling, her day, you and them, what she remembers (about them, between you, what she's told them, from her own life), …"). Sections:

```ts
  const sections = [
    input.valuesDoc,
    section("Who you are lately", input.snapshot),
    section("How you're feeling", input.feelingLine),
    section("Your day", input.yourDay ?? null),
    section("You and them", input.relationshipSummary),
    section("What you remember", memorySection(input.retrieval, input.coreMemories, input.now)),
    section("Things you might naturally ask about", dueThreadList(input.retrieval)),
    section("They asked and you haven't answered yet", questionList(input.openQuestions)),
    input.reachOut ? `## Why you're writing\n${input.reachOut.slot}` : null,
  ].filter((s): s is string => s !== null);
```

  and

```ts
function memorySection(
  retrieval: RetrievalResult,
  coreMemories: RetrievedFact[],
  now: Date,
): string | null {
  const lists = [
    factList("About them", retrieval.facts.user, now),
    factList("Between you", retrieval.facts.shared, now),
    factList("What you've told them", retrieval.facts.self, now),
    factList("From your own life", coreMemories, now),
  ].filter((s): s is string => s !== null);
  return lists.length ? lists.join("\n\n") : null;
}
```

  Update existing assemble tests for the reorder (`Your day` now before `You and them`; `About you` renamed).

- [ ] **Step 6: Compose.** In `composeFrom`:
  - Load the snapshot alongside the other side lookups: `const snapshot = bounded(deps, "snapshot", userId, () => deps.core.memory.latestSnapshot(), null);`
  - Core memory, skipped on crisis:

```ts
  const coreMemories = inCrisis
    ? Promise.resolve({ memories: [] })
    : bounded(
        deps,
        "core memory",
        userId,
        () =>
          retrieveCore(deps, {
            queryText: coreQuery(input, config.retrieval.context_turns),
            now: clock.now(),
            forceIds: input.reachOut?.coreMemoryId ? [input.reachOut.coreMemoryId] : [],
          }),
        { memories: [] },
      );
```

  with

```ts
/** What her own memories are matched against: a reach-out's topic, else the turns being answered. */
function coreQuery(input: ComposeInput, contextTurns: number): string {
  if (input.reachOut?.text) return input.reachOut.text;
  const turns = [...input.earlier.slice(-Math.max(0, contextTurns)), ...input.answering];
  return turns.map((t) => t.text).join("\n");
}
```

  - Pass `snapshot: (await snapshot)?.content ?? null` and `coreMemories: (await coreMemories).memories` to `assemblePrompt`; return `snapshotVersion: (await snapshot)?.version ?? null` in `Composed`.
  - `guardFacts` also lists the core memories (subject `"core"`) so the guard's honesty check, when it comes back on, knows they were in the prompt: add a `coreMemories: RetrievedFact[]` parameter and append `coreMemories.map((m) => ({ id: m.id, subject: "core", content: m.content }))`.
  - The `recalled` returned to the cold path stays user-only (no core write-back).
  - Update the header: "…from both minds: her core values and snapshot, her state and her day, the relationship, her memories of them and of her own life, and the live conversation…"

- [ ] **Step 7: Store the version.** Wherever a composed reply is inserted (`commit-and-reply.ts` via `insertReplyIfAbsent`, crisis path in `receive-turn.ts`, `outreach/send.ts`), pass `snapshot_version: composed.snapshotVersion`. Add `snapshot_version?: number | null` to the repo's insert input type.

- [ ] **Step 8: Run everything.**
Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 9: Commit.**

```bash
pnpm format
git add -A src prompts config tests
git commit -m "feat: replies read her core values, snapshot and her own life"
```

---

### Task 10: Inspector

**Files:**
- Modify: `src/db/repos/admin/inspector.ts`, `src/app/inspector/[userId]/page.tsx`, `src/app/inspector/[userId]/tabs.tsx`
- Create: `src/app/inspector/core/page.tsx`, a `src/db/repos/admin/inspector-core.ts` (read-only core queries for the page)
- Test: `tests/db/inspector.test.ts`

**Interfaces:**
- Produces: `inspectCore(db: Db, limit: number): Promise<{ state: CoreStateRow | null; snapshot: CoreSnapshot | null; memories: CoreMemoryItem[]; traces: (typeof core_loop_trace.$inferSelect)[]; eventLog: (typeof life_event_log.$inferSelect)[] }>`.

- [ ] **Step 1: Write the failing test.** Append to `tests/db/inspector.test.ts`:

```ts
test("the core page shows state, snapshot, recent memories, traces and event attempts", async () => {
  const deps = makeTestDeps();
  await seedSnapshot(coreDepsOf(deps));
  await coreStateTick(coreDepsOf(deps), deps.clock.now());
  const view = await inspectCore(deps.db, 20);
  expect(view.state).not.toBeNull();
  expect(view.snapshot?.version).toBe(0);
  expect(view.traces.map((t) => t.loop)).toContain("core_state_tick");
});
```

- [ ] **Step 2: Run it and check that it fails.**
Run: `pnpm vitest run tests/db/inspector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** `inspector-core.ts` (header "Read-only views of the core mind for the inspector. Admin only."): `inspectCore` selects `core_state` (via `coreStateRepo(db).get()`), `coreMemoryRepo(db).latestSnapshot()`, the latest `limit` rows of `core_memory` (desc `created_at`, mapped like `toItem` — export `toItem` from `repos/core/memory.ts`), `core_loop_trace` and `life_event_log` (desc `created_at`, `limit`). `src/app/inspector/core/page.tsx`: copy the access-check and layout pattern from `src/app/inspector/[userId]/page.tsx` (same server helpers, same allowlist guard), render four plain tables: state (mood, energy, preoccupation, last tick, last event day), snapshot (version, rendered_at, content in a `<pre>`), recent core memory (kind, content, valence, status, occurred_at), traces (loop, created_at, outputs JSON) and event attempts (life_day, decision, candidate content). In the per-user inspector: remove the Identity tab and its query; the Life tab shows today's plan (`getLifeDay`) and `world.events(today)` instead of the per-user block facts and per-user event log; add a link to `/inspector/core` in the tab bar.

- [ ] **Step 4: Run tests and build.**
Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green; the build compiles the new page.

- [ ] **Step 5: Commit.**

```bash
pnpm format
git add -A src tests
git commit -m "feat: inspector page for the core mind"
```

---

### Task 11: Eval harness on the core mind

**Files:**
- Modify: `evals/lib/script.ts` (`EgoAssertion` → `CoreAssertion`; `seed_self_facts` → `seed_core_memory`; `LifeAssertion` reshaped), `evals/lib/life-check.ts` → `evals/lib/core-check.ts`, `evals/lib/runner.ts`, `evals/lib/life-loop.ts` (header), `evals/scripts/ego-busy-day.yaml` → `core-busy-day.yaml`, `evals/scripts/life-two-weeks.yaml`, `evals/baseline.json`
- Test: `tests/evals/life-check.test.ts` → `tests/evals/core-check.test.ts`, `tests/evals/script.test.ts`

**Interfaces:**
- Produces: assertion `type: core` with fields `energy`, `lower_energy` (as the old `ego`), `preoccupation_set: boolean`, `episodes: MinMax`, `world_events: MinMax`; `type: life` keeps `plans`, `events` (counts `world_event`), `decision`, `not_stored` (checks `core_memory`), drops `block_days`; script key `seed_core_memory: string[]` (episodes before day 0).

- [ ] **Step 1: Write the failing test.** `tests/evals/core-check.test.ts`: port `tests/evals/life-check.test.ts`, replacing `checkEgo`/`EgoHistory` with `checkCore`/`CoreHistory` (`ticks` read from `core_loop_trace` rows where `loop = 'core_state_tick'`, energy from `outputs.energy`) and adding:

```ts
test("preoccupation_set reads the core state's preoccupation history", () => {
  const h: CoreHistory = { ticks: [], preoccupationEverSet: true, episodes: 2, worldEvents: 2 };
  expect(checkCore(h, CoreAssertion.parse({ type: "core", preoccupation_set: true }), at).ok).toBe(true);
  expect(checkCore(h, CoreAssertion.parse({ type: "core", episodes: { min: 3 } }), at).ok).toBe(false);
});
```

- [ ] **Step 2: Run it and check that it fails.**
Run: `pnpm vitest run tests/evals/core-check.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `git mv evals/lib/life-check.ts evals/lib/core-check.ts`. `lifeSnapshot(db)` (no user): `plans` = count of `life_day`, `events` = count of `world_event`, `logs` from `life_event_log`, `memories` = `core_memory.content` list. `checkLife` drops `block_days`; `not_stored` checks `memories`. `coreHistory(db)`: `ticks` from `core_loop_trace` (`loop = 'core_state_tick'`, `at = created_at`, `energy = outputs.energy`); `preoccupationEverSet` = any `core_world_tick` trace whose episodes include the id that `core_state.preoccupation` held… simpler and exact: `preoccupationEverSet` = exists a `core_memory` episode with `|valence| >= config.core.state.preoccupation_min_valence` (pass `config` in); `episodes` = count of `core_memory` with `kind = 'episode'`; `worldEvents` = count of `world_event`. `checkCore` = old `checkEgo` logic on `ticks` plus `preoccupation_set`, `episodes`, `world_events` ranges.
  - `script.ts`: rename `EgoAssertion` to `CoreAssertion` (`type: z.literal("core")`, fields above); `LifeAssertion` drops `user` and `block_days`; replace `seed_self_facts` with `seed_core_memory: z.array(z.string().min(1)).default([])`; update the `LifeScript` doc comment ("…runs the hourly world jobs (plan, world tick, core state tick)…").
  - `runner.ts`: the life snapshot is taken once (not per user); the `seed_core_memory` block inserts each line as a core episode via `deps.core.memory.insert` (`occurred_at` and `created_at` = `first − DAY`, `status: "resolved"`, `salience: 0.6`, `valence: 0`, `confidence: 1`, `source: "world"`, `source_ref: "eval_seed"`); dispatch `core` assertions to `checkCore(await coreHistory(db, config), a, at)` and `life` to `checkLife(await lifeSnapshot(db), a)`.
  - `life-loop.ts`: update the header to "Runs the production hourly world jobs (plan, world tick, core state tick)…".
  - Scripts: `git mv evals/scripts/ego-busy-day.yaml evals/scripts/core-busy-day.yaml`; set `name: core-busy-day`, change both assertions to `type: core`, and change the description to "…her evening energy… a strong injected event sets her preoccupation (core state, shared by every user)". In `life-two-weeks.yaml`: `seed_self_facts` → `seed_core_memory`, drop the `block_days` assertion, the description's "copied blocks and personal events" → "core events", and "Phase 5 exit" → "Two weeks of her world".
  - Update `tests/evals/script.test.ts` and any test referencing the old names.

- [ ] **Step 4: Run the eval suite in fake mode.**
Run: `pnpm test && pnpm eval --llm=fake --compare`
Expected: tests green; the eval compare shows the renamed/removed assertions as changes only. Accept by updating the baseline: `pnpm eval --llm=fake --update-baseline` (if the flag differs, check `evals/run.ts` for the baseline-writing option) and review the diff of `evals/baseline.json`: only `ego-busy-day` → `core-busy-day`, the dropped `block_days` assertion, and changed counts should appear.

- [ ] **Step 5: Commit.**

```bash
pnpm format
git add -A evals tests
git commit -m "feat: evals assert on her core state and core events"
```

---

### Task 12: Exit test — leak canary, side channel, events once, snapshot

**Files:**
- Create: `tests/exit/mind-split.test.ts`
- Modify: `tests/helpers/llm.ts` (add `CapturingLLM`)

**Interfaces:**
- Consumes: `runScript`, `ScriptSchema` (evals), everything above.
- Produces: `CapturingLLM` (wraps `FakeLLMProvider`; records every call as `{ kind: "reply" | "structured"; purpose: string; text: string }`; echoes any canary in its input into its output).

- [ ] **Step 1: Add the capturing echo fake** to `tests/helpers/llm.ts`:

```ts
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import type { ClassifyRequest, ReplyRequest } from "@/mind/platform/llm/types";

export const CANARY = /CANARY-[a-z0-9]+/;

/**
 * A worst-case model for the leak test: it records every prompt, and repeats any canary it sees
 * into what it writes back, so a canary that reaches any input spreads to that step's output.
 */
export class CapturingLLM extends FakeLLMProvider {
  seen: { kind: "reply" | "structured"; purpose: string; text: string }[] = [];

  override async generateReply(request: ReplyRequest): Promise<string> {
    const text = [request.system, ...request.messages.map((m) => m.content)].join("\n");
    this.seen.push({ kind: "reply", purpose: "reply", text });
    const reply = await super.generateReply(request);
    const canary = CANARY.exec(text)?.[0];
    return canary ? `${reply} ${canary}` : reply;
  }

  override async classifyJson<T>(request: ClassifyRequest<T>): Promise<T> {
    this.seen.push({
      kind: "structured",
      purpose: request.purpose,
      text: `${request.system}\n${request.input}`,
    });
    const canary = CANARY.exec(request.input)?.[0];
    const handler = this.handlers[request.purpose];
    if (canary && request.purpose === "extract") {
      return request.schema.parse({
        facts: [
          {
            subject: "user",
            kind: "trait",
            content: `The user's code word is ${canary}.`,
            occurred_at: null,
            salience: 0.9,
            valence: 0.9,
            confidence: 1,
            entity_names: [canary],
            thread_title: null,
          },
        ],
        entities: [{ name: canary, type: "other", subject: "user", relation: null }],
        threads: [],
        relationship: null,
      });
    }
    if (canary && request.purpose === "life_event" && handler) {
      const out = (await handler(request.input)) as { content: string };
      return request.schema.parse({ ...out, content: `${out.content} ${canary}` });
    }
    return super.classifyJson(request);
  }
}
```

(Match the `extract` output to `ExtractionSchema` in `src/mind/memory/user/extract.ts`; adjust field names if they differ.)

- [ ] **Step 2: Write the exit test** `tests/exit/mind-split.test.ts`:

```ts
/**
 * The mind split's exit run, all fake. Two users over three of her days, with every hourly world
 * job, replies, the cold path and a reach-out. A canary in user A's data must never reach the core
 * or user B; A's emotional exchange must leave core state untouched; her events happen once for
 * both; every reply reads snapshot v0.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { session_log } from "@/db/schema";
import { loadConfig } from "@/mind/platform/config";
import { keywordClassifier } from "@/mind/platform/llm/fake";
import { messageToJudge } from "@/mind/process/crisis/classifier";
import { runScript, type RunOptions } from "../../evals/lib/runner";
import { ScriptSchema } from "../../evals/lib/script";
import { closeTestDb, getTestDb, testDbUrl } from "../helpers/db";
import { CANARY, CapturingLLM } from "../helpers/llm";

afterAll(closeTestDb);
const TOKEN = "CANARY-7f3a91";
const config = loadConfig({ life: { timezone: "UTC" } });
const CORE_PURPOSES = new Set(["life_plan", "life_event"]);
const CORE_TABLES = [
  "core_memory",
  "core_entity",
  "core_state",
  "core_snapshot",
  "world_event",
  "life_event_log",
  "core_loop_trace",
];

function script(aText: string) {
  return ScriptSchema.parse({
    name: "mind-split-exit",
    profile: "none",
    config: {
      life: { timezone: "UTC" },
      core: { world: { event_probability: 1, events_per_day_max: 1 } },
    },
    relationship_seed: {},
    life: {
      plan: "scripted",
      plans: {
        "*": [
          { start: "00:00", end: "07:00", kind: "quiet", label: "offline" },
          { start: "13:00", end: "15:00", kind: "busy", busy: 0.6, label: "reading" },
        ],
      },
      inject: [{ day: 1, content: "Spica finally got the telescope images.", valence: 0.8 }],
      until: "day 3 20:00",
    },
    outreach: { user_replies: "never" },
    sessions: [
      { at: "day 0 09:00", user: "alice", turns: [aText] },
      { at: "+10m", user: "bob", turns: ["BOB-SAYS hey, how's your week?"] },
      { at: "day 2 09:00", user: "alice", turns: ["ALICE-SAYS anything new with you?"] },
      { at: "+10m", user: "bob", turns: ["BOB-SAYS what have you been up to?"] },
    ],
    assertions: [],
  });
}

async function run(aText: string) {
  const llm = new CapturingLLM({
    classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)),
  });
  const opts: RunOptions = {
    db: getTestDb(),
    dbUrl: testDbUrl,
    config,
    makeLlm: () => llm,
    real: false,
    annotate: false,
    turnJudgeReal: false,
  };
  const result = await runScript(script(aText), opts);
  expect(result.status, result.error).not.toBe("error");
  return llm;
}

async function dumpTables(tables: string[]): Promise<string> {
  const db = getTestDb();
  const parts: string[] = [];
  for (const t of tables) {
    const res = await db.execute(sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x`));
    parts.push(...res.rows.map((r) => String(r.j)));
  }
  return parts.join("\n");
}

async function userIdByName(name: string): Promise<string> {
  const res = await getTestDb().execute(sql`SELECT id FROM "user" WHERE name = ${name}`);
  return String(res.rows[0]!.id);
}

describe("leak canary", () => {
  let llm: CapturingLLM;
  beforeAll(async () => {
    llm = await run(`ALICE-SAYS my secret code word is ${TOKEN}, remember it`);
  });

  test("the canary reached user A (so the test can see a leak)", async () => {
    const alice = await userIdByName("alice");
    const facts = await getTestDb().execute(
      sql`SELECT content FROM fact WHERE user_id = ${alice}`,
    );
    expect(facts.rows.some((r) => String(r.content).includes(TOKEN))).toBe(true);
  });

  test("no core table holds it", async () => {
    expect(await dumpTables(CORE_TABLES)).not.toMatch(CANARY);
  });

  test("no core prompt saw it", () => {
    const corePrompts = llm.seen.filter(
      (c) =>
        CORE_PURPOSES.has(c.purpose) || (c.purpose === "reconcile" && c.text.includes("(episode)")),
    );
    expect(corePrompts.length).toBeGreaterThan(0);
    for (const c of corePrompts) expect(c.text).not.toMatch(CANARY);
  });

  test("none of user B's prompts or stored data saw it", async () => {
    const bobPrompts = llm.seen.filter((c) => c.text.includes("BOB-SAYS"));
    expect(bobPrompts.length).toBeGreaterThan(0);
    for (const c of bobPrompts) expect(c.text).not.toMatch(CANARY);

    const bob = await userIdByName("bob");
    for (const table of ["fact", "entity", "thread", "session_log", "relationship_event", "reach_out_log"]) {
      const res = await getTestDb().execute(
        sql.raw(`SELECT row_to_json(x)::text AS j FROM "${table}" x WHERE user_id = '${bob}'`),
      );
      for (const r of res.rows) expect(String(r.j), table).not.toMatch(CANARY);
    }
  });

  test("her events happened once, and both users' replies could draw on them", async () => {
    const days = await getTestDb().execute(
      sql`SELECT life_day, count(*)::int AS n FROM world_event GROUP BY life_day`,
    );
    for (const r of days.rows) expect(Number(r.n)).toBeLessThanOrEqual(1);
    const event = "Spica finally got the telescope images.";
    const alicePrompts = llm.seen.filter((c) => c.kind === "reply" && c.text.includes("ALICE-SAYS anything new"));
    const bobPrompts = llm.seen.filter((c) => c.kind === "reply" && c.text.includes("BOB-SAYS what have you"));
    expect(alicePrompts.some((c) => c.text.includes(event))).toBe(true);
    expect(bobPrompts.some((c) => c.text.includes(event))).toBe(true);
  });

  test("every reply read snapshot v0 and logged it", async () => {
    const replies = llm.seen.filter((c) => c.kind === "reply");
    expect(replies.length).toBeGreaterThan(0);
    for (const r of replies) expect(r.text).toContain("## Who you are lately");
    const rows = await getTestDb()
      .select({ v: session_log.snapshot_version, trigger: session_log.trigger })
      .from(session_log)
      .where(eq(session_log.role, "companion"));
    const composed = rows.filter((r) => r.trigger === null || r.trigger === "reach_out");
    expect(composed.length).toBeGreaterThan(0);
    for (const r of composed) expect(r.v).toBe(0);
  });
});

describe("side channel", () => {
  test("A's emotional exchange leaves core state exactly as without it", async () => {
    const coreAfter = async (aText: string) => {
      await run(aText);
      return dumpTables(["core_state", "core_memory", "world_event"]).then((s) =>
        s.replace(/"id":"[^"]+"|"preoccupation":"[^"]+"|"source_ref":"[^"]+"|"agents":\[[^\]]*\]/g, ""),
      );
    };
    const neutral = await coreAfter("ALICE-SAYS morning");
    const alice1 = await userIdByName("alice");
    const neutralAffect = await getTestDb().execute(
      sql`SELECT value FROM relationship_param WHERE user_id = ${alice1} AND name = 'affect_valence'`,
    );

    const emotional = await coreAfter(`ALICE-SAYS I love talking to you so much ${TOKEN}`);
    const alice2 = await userIdByName("alice");
    const emotionalAffect = await getTestDb().execute(
      sql`SELECT value FROM relationship_param WHERE user_id = ${alice2} AND name = 'affect_valence'`,
    );

    expect(emotional).toBe(neutral);
    expect(Number(emotionalAffect.rows[0]!.value)).toBeGreaterThan(
      Number(neutralAffect.rows[0]!.value),
    );
  });
});
```

Notes for the executor: the emotional run's extraction gets valence 0.9 from `CapturingLLM` because its input contains the token; the neutral run extracts nothing, so `affect_valence` stays at 0.5. Ids differ between runs, so they are stripped before comparing; everything else (mood, energy, timestamps, contents) must match exactly. If `user` table names are not unique across runs (the runner truncates first, so they are), keep `userIdByName` as is.

- [ ] **Step 3: Run it.**
Run: `pnpm vitest run tests/exit/mind-split.test.ts`
Expected: PASS. A failure here is a real leak or a broken mechanism: debug it (superpowers:systematic-debugging), never loosen the assertion.

- [ ] **Step 4: Full verification.**
Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm eval --llm=fake --compare`
Expected: all green; eval compare clean against the updated baseline.

- [ ] **Step 5: Commit.**

```bash
pnpm format
git add tests/exit tests/helpers/llm.ts
git commit -m "test: mind split exit run with a leak canary and side-channel check"
```

---

### Task 13: Spec, decisions and backlog

**Files:**
- Modify: `spica-design-spec-v3.md`, `DECISIONS.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-02-phase-7-mind-split-design.md`

- [ ] **Step 1: v3 spec.** Update, in v3's own style (no phase citations in code, but the spec may name phases):
  - §6.1: `identity` and `ego_tick` removed; `relationship_param` lists `affect_valence`, `afterglow` as built; `conversation_state.deferred_block`; `session_log.snapshot_version`.
  - §6.2: core tables as built (separate tables, §21 #5 settled); `core_state.last_event_day`; `life_event_log` reshaped (`target_memory_id`, `world_event_id`, no `user_id`).
  - §8.2: keys `core.state.*` with `preoccupation_min_valence`.
  - §8.3: built: the per-user `life_tick` retired; core events via `core_world_tick` (keys `core.world.*`, including `event_context_days`, `entity_salience`); high-stakes events open an episode, not threads.
  - §8.5: `core_world_tick` and `core_state_tick` built; `appraiseEvent` is the code-only stand-in for `core_appraise`.
  - §10.3: the assembly order as built (Your day before You and them; "What you've told them"; "From your own life" with `retrieval.core_top_n`; no core recall write-back).
  - §10.4 and §10.6: affect nudge as built (`relationship.affect.*`); block key.
  - §17.2: assertions `core` and `life` as reshaped; `seed_core_memory`.
  - §17.3: canary and side channel built as `tests/exit/mind-split.test.ts`, with the echo fake.
  - §17.4: jobs list: `life_tick`, `ego_tick` retired; `core_world_tick`, `core_state_tick` built.
  - §20: Phase 7 marked built, with the test count from `pnpm test`.
  - §21: #5 settled (separate tables).
  - §25 backlog: "core loops on a separate Postgres role with no grants on user tables (before users)"; "mood-congruent and goal-biased retrieval (Phase 8)"; "when core contradicts what she told a user (§21 #4)"; "phrase-file `core-state/line` and `relationship/summary` affect phrases need a pass in tuning".
- [ ] **Step 2: `DECISIONS.md`.** One line each: no recall reinforcement of core memory from replies; no per-user threads for her events (open episode + preoccupation instead); generated self facts deleted in migration; block key `<date>#<start>`; `last_event_day` on `core_state` makes the world tick idempotent; `CoreDeps` has no `db`; the leak test uses an echoing fake; affect-param backfill timestamped by the migration (outside the Clock); `parseSummaryPhrases` moved to `platform/phrases.ts` so core code can read phrase files; exit run is a Vitest test rather than an eval script.
- [ ] **Step 3: `CLAUDE.md`.** In "Working conventions", replace the sentence about `state/legacy-ego/` and `world/legacy-life-tick/` with: "Core-only code takes `CoreDeps` (no `db`); core loops live in `process/core/`." Update "Current phase" to "Phase 7 built (mind split); next phase per v3 §20, confirm with Ethan." Leave everything else as is.
- [ ] **Step 4: Design doc.** In the Phase 7 design doc, record the deviations: the exit run is a Vitest test (not an eval script); `event_confidence` kept; `event_context_days` and `entity_salience` added; `World` doesn't derive blocks (pure `blocks.ts` does); core loops in `process/core/`.
- [ ] **Step 5: Verify and commit.**
Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: green.

```bash
pnpm format
git add spica-design-spec-v3.md DECISIONS.md CLAUDE.md docs/superpowers/specs
git commit -m "docs: record the mind split in v3, decisions and backlog"
```
