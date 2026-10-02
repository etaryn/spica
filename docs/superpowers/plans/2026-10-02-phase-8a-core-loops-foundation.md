# Phase 8a: Core loops foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the core mind a budgeted, traced way to call a model, and use it for the day plan, event generation and a real LLM appraisal that moves emotion, needs and goal progress.

**Architecture:** Every core model call goes through `runCoreLoop`, which meters the LLM (calls, tokens, cost), checks `core.daily_call_budget` against today's summed trace `calls`, and writes exactly one `core_loop_trace` row per run with a `status`. `life_plan` (now on `CoreDeps`, B50), `life_event` and the new `core_appraise` run through it. Appraisal splits into `proposeAppraisal` (model call, outside the transaction, bounded in code, code fallback) and `applyAppraisal` (inside the world tick's transaction). Goals live in a new `core_goal` table behind `core.goals`; needs and emotion live in `core_state`.

**Tech Stack:** TypeScript (~6.0), Postgres 16 + pgvector, Drizzle (drizzle-kit migrations), pg-boss, Vitest, pnpm, zod 4.

**Spec:** `docs/superpowers/specs/2026-10-02-phase-8-core-loops-design.md` §2, §3 (read it first), and `spica-design-spec-v3.md` §3.2, §4, §6.2, §8.2, §8.5, §15.

This is slice **8a** of four (spec §11). Slices 8b–8d get their own plan files, written against the code this slice leaves.

## Global Constraints

- `src/mind` is framework-free: no Next imports, no `Date.now()` / argument-less `new Date()`, no `process.env`. Time comes from the injected `Clock` or the `now` argument.
- Every timestamp column is written from the `Clock` / `now`; never `DEFAULT now()`.
- Every numeric constant goes in `config/default.json` with a zod schema in `src/mind/platform/config.ts`.
- Every prompt is a versioned file `prompts/<name>/v<N>.md`; delete prompt versions nothing configures.
- Drizzle property names for domain tables are snake_case.
- Every source file starts with a short plain-English header comment; comments say why, never cite spec sections, phases or review items.
- Prettier at 100 columns: run `pnpm format` before each commit.
- Replace from the ground up: no shims, no flags keeping old paths alive, no dead code.
- Core code (`src/mind/*/core/**`, `src/mind/world/**`, `src/db/repos/core/**`) never imports user code, user repos, admin repos, or non-core process code. Core loops take `CoreDeps` (no `db`).
- No user data in any core table, core prompt or core state.
- Tests run against `spica_test` (migrated by `tests/global-setup.ts`). Run `pnpm db:up` first if Postgres isn't running.
- Migrations: edit `src/db/schema.ts`, run `pnpm db:generate`, then append any data SQL to the generated file (statements separated by `--> statement-breakpoint`). If drizzle-kit asks a rename question (it needs a TTY), write the migration by hand as in `0015_mind_split.sql` and record it in `DECISIONS.md`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A model call that throws mid-appraisal** (timeout, invalid JSON): the event must still land with the code appraisal, the run's trace says `fallback`, and nothing throws out of the world tick (Task 7 test).
2. **Budget exhausted before her day's plan exists:** `life_plan` must still write the fallback plan, so availability and the "Your day" line keep working (Task 3 test).
3. **Budget exhausted at event-generation time:** the day is still marked done (`last_event_day`), so the next hourly run doesn't try again and spend calls past the budget (Task 4 test).
4. **The model names a goal id that doesn't exist or isn't active, or returns NaN / out-of-range numbers:** dropped or clamped, never written (Task 7 test).
5. **A core state row created before this phase** (needs `{0.5, 0.5}`, emotion `{label: "neutral", …}`): the migration nulls the placeholder emotion so the feeling line doesn't say "You're feeling neutral" (Task 1 migration SQL; tests run on a fresh database, so check the dev DB's `core_state.emotion` by hand after `pnpm db:migrate`).

---

## File map

**Create**
- `src/mind/process/core/runner.ts`: `runCoreLoop`, `meterLlm`, `budgetDayStart`.
- `src/db/repos/core/goals.ts`: the Postgres `CoreGoals`.
- `prompts/core/appraise/v1.md`, `prompts/persona/v5.md`, `prompts/core-state/line/v3.md`.
- Tests: `tests/mind/process/core/runner.test.ts`, `tests/db/core-goals.test.ts`, `tests/mind/process/core/appraise-propose.test.ts`.

**Modify**
- `src/db/schema.ts`, `src/db/admin.ts`, `src/db/reset-self.ts`, `src/db/reset-self-cli.ts`.
- `src/mind/platform/core.ts`, `config.ts`, `llm/types.ts`, `llm/anthropic.ts`, `llm/fake.ts`, `persona.ts`.
- `src/db/repos/core/index.ts`, `traces.ts`, `state.ts`, `world.ts`.
- `src/mind/state/core/types.ts`, `core-state.ts`, `tick.ts`, `line.ts`.
- `src/mind/world/types.ts`, `day-plan.ts`.
- `src/mind/memory/core/seed.ts`.
- `src/mind/process/core/appraise.ts`, `world-tick.ts`.
- `src/worker/world-jobs.ts`, `evals/lib/life-loop.ts`, `evals/lib/runner.ts`.
- `tests/helpers/llm.ts`, `tests/exit/mind-split.test.ts`, existing tests named per task.
- `config/default.json`, `spica-design-spec-v3.md`, `DECISIONS.md`.

**Delete**
- `prompts/persona/v4.md`, `prompts/core-state/line/v2.md`.

---

### Task 1: Migration — trace columns, `core_goal`, nullable emotion

**Files:**
- Modify: `src/db/schema.ts`, `src/db/admin.ts:21`, `src/db/reset-self.ts:31`
- Create: generated `src/db/migrations/0018_*.sql`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces: enums `core_loop_status`, `core_goal_status`, `core_goal_source`; table `core_goal`; columns `core_loop_trace.calls`, `.status`, `.error`; `core_state.emotion` nullable; `world_event.goal_ref` → FK `core_goal.id`.

- [ ] **Step 1: Write the failing test**

Append to `tests/db/schema.test.ts` (it already imports `getTestDb`, `resetDb`, `vec` and has `beforeEach(resetDb)`; follow its existing style):

```ts
test("core_goal stores a goal with progress in [0, 1]", async () => {
  const db = getTestDb();
  const now = new Date("2026-01-05T00:00:00Z");
  const [row] = await db
    .insert(core_goal)
    .values({
      title: "Learn the winter constellations",
      why: "She keeps pointing at Orion and getting it wrong.",
      status: "active",
      progress: 0.2,
      embedding: vec(),
      source: "seed",
      source_ref: null,
      started_at: now,
      target_at: null,
      updated_at: now,
    })
    .returning();
  expect(row).toMatchObject({ status: "active", progress: 0.2, source: "seed" });
  await expect(
    db.update(core_goal).set({ progress: 1.5 }).where(eq(core_goal.id, row!.id)),
  ).rejects.toThrow();
});

test("core_loop_trace records calls, status and error", async () => {
  const db = getTestDb();
  const [row] = await db
    .insert(core_loop_trace)
    .values({
      loop: "core_appraise",
      inputs: {},
      outputs: {},
      model: null,
      prompt_version: null,
      tokens_in: null,
      tokens_out: null,
      cost: null,
      calls: 2,
      status: "fallback",
      error: "TimeoutError",
      created_at: new Date("2026-01-05T00:00:00Z"),
    })
    .returning();
  expect(row).toMatchObject({ calls: 2, status: "fallback", error: "TimeoutError" });
});

test("core_state.emotion may be null", async () => {
  const db = getTestDb();
  await db.insert(core_state).values({
    id: 1,
    emotion: null,
    mood_valence: 0,
    mood_arousal: 0.4,
    energy: 0.6,
    needs: { autonomy: 0.6, competence: 0.6 },
    baseline: { mood_valence: 0, mood_arousal: 0.4, energy: 0.6 },
  });
  expect((await db.select().from(core_state))[0]!.emotion).toBeNull();
});
```

Add `core_goal` to the file's list of core tables (the array near line 279 that already lists `"core_loop_trace"`), and add `core_goal`, `core_state`, `core_loop_trace` and `eq` to its imports if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/db/schema.test.ts`
Expected: FAIL (`core_goal` is not exported from `@/db/schema`).

- [ ] **Step 3: Edit the schema**

In `src/db/schema.ts`, next to the other core enums (after `eventStakes`):

```ts
export const coreLoopStatus = pgEnum("core_loop_status", [
  "done",
  "fallback",
  "skipped_budget",
  "failed",
]);
export const coreGoalStatus = pgEnum("core_goal_status", ["active", "done", "dropped"]);
export const coreGoalSource = pgEnum("core_goal_source", ["seed", "reflect"]);
```

Before `world_event`, add:

```ts
/** Her goals: arcs lasting weeks. Progress moves only in code, from appraised events. */
export const core_goal = pgTable(
  "core_goal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    why: text("why").notNull(),
    status: coreGoalStatus("status").notNull(),
    progress: real("progress").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    source: coreGoalSource("source").notNull(),
    source_ref: text("source_ref"),
    started_at: ts("started_at").notNull(),
    target_at: ts("target_at"),
    updated_at: ts("updated_at").notNull(),
  },
  (t) => [
    index("core_goal_status_idx").on(t.status),
    check("core_goal_progress_range", sql`${t.progress} BETWEEN 0 AND 1`),
  ],
);
```

In `core_state`: change `emotion: jsonb("emotion").notNull(),` to `emotion: jsonb("emotion"),`.

In `world_event`: change `goal_ref: uuid("goal_ref"),` to

```ts
    goal_ref: uuid("goal_ref").references(() => core_goal.id, { onDelete: "set null" }),
```

In `core_loop_trace`, after `cost`:

```ts
    calls: integer("calls").notNull().default(0),
    status: coreLoopStatus("status").notNull().default("done"),
    error: text("error"),
```

Add `core_goal` to both TRUNCATE lists: `src/db/admin.ts:21` (after `core_state`) and `src/db/reset-self.ts:31` (after `core_state`).

- [ ] **Step 4: Generate the migration and append data SQL**

Run: `pnpm db:generate`
Then append to the generated `src/db/migrations/0018_*.sql`:

```sql
--> statement-breakpoint
UPDATE "core_loop_trace" SET "calls" = CASE WHEN "model" IS NULL THEN 0 ELSE 1 END;
--> statement-breakpoint
UPDATE "core_state" SET "emotion" = NULL WHERE "emotion"->>'label' = 'neutral';
```

The first backfills honestly: rows before metering made one model call when they recorded a model. The second clears the placeholder emotion the repo used to write, so no line says "feeling neutral".

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add src/db tests/db/schema.test.ts
git commit -m "feat(db): core_goal, trace calls/status/error, nullable core emotion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Metered model calls, the runner and the budget

**Files:**
- Create: `src/mind/process/core/runner.ts`
- Modify: `src/mind/platform/llm/types.ts`, `llm/anthropic.ts`, `llm/fake.ts`, `src/mind/platform/core.ts`, `src/mind/platform/config.ts`, `config/default.json`, `src/db/repos/core/traces.ts`, `src/mind/state/core/tick.ts:47-58`, `src/mind/process/core/world-tick.ts` (both `traces.insert` calls)
- Test: `tests/mind/process/core/runner.test.ts`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces:
  - `ClassifyRequest.onUsage?: UsageSink` (called once per completed call).
  - `StructuredModel` gains `"core"`; `config.models.core`.
  - `type LoopStatus = "done" | "fallback" | "skipped_budget" | "failed"` (in `src/mind/platform/core.ts`).
  - `NewCoreLoopTrace` gains `id?: string; calls: number; status: LoopStatus; error: string | null`.
  - `CoreTraces.callsSince(from: Date): Promise<number>`.
  - `CORE_LOOPS` / `type CoreLoopName` exported from `src/mind/platform/config.ts`.
  - In `runner.ts`:
    ```ts
    export type LoopContext = { deps: CoreDeps; traceId: string; canCall(): boolean };
    export type LoopResult<T> = {
      status?: "done" | "fallback";
      inputs: unknown;
      outputs: T;
      promptVersion?: string | null;
    };
    export function budgetDayStart(config: Config, now: Date): Date;
    export function meterLlm(llm: LLMProvider): { llm: LLMProvider; usage: LlmUsage[]; calls(): number };
    export async function runCoreLoop<T>(
      deps: CoreDeps,
      name: CoreLoopName,
      now: Date,
      fn: (ctx: LoopContext) => Promise<LoopResult<T>>,
    ): Promise<{ status: LoopStatus; outputs: T | null }>;
    ```

- [ ] **Step 1: Write the failing test**

Create `tests/mind/process/core/runner.test.ts`:

```ts
/**
 * The core loop runner: one trace per run with the calls actually made, a daily budget that resets
 * at her midnight, a reserve the optional loops can't touch, and failures traced then rethrown.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { asc } from "drizzle-orm";
import { core_loop_trace } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { budgetDayStart, runCoreLoop } from "@/mind/process/core/runner";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T09:00:00Z"); // 17:00 in Singapore
const cfg = { core: { daily_call_budget: 3, budget_reserve: 1 } };

function setup(overrides: unknown = cfg) {
  const all = makeTestDeps(overrides);
  all.llm.handlers.probe = () => ({ ok: true });
  return { all, deps: coreDepsOf(all) };
}

const probe = (ctx: { deps: { llm: { classifyJson: Function } } }) =>
  ctx.deps.llm.classifyJson({
    purpose: "probe",
    model: "core",
    system: "s",
    input: "i",
    schema: z.object({ ok: z.boolean() }),
    timeoutMs: 1000,
    maxTokens: 10,
  });

async function traces(all: ReturnType<typeof makeTestDeps>) {
  return all.db.select().from(core_loop_trace).orderBy(asc(core_loop_trace.created_at));
}

test("a run writes one trace with the calls it made", async () => {
  const { all, deps } = setup();
  const out = await runCoreLoop(deps, "core_reflect", now, async (ctx) => {
    await probe(ctx);
    await probe(ctx);
    return { inputs: { a: 1 }, outputs: { b: 2 }, promptVersion: "v1" };
  });
  expect(out).toEqual({ status: "done", outputs: { b: 2 } });
  const [t] = await traces(all);
  expect(t).toMatchObject({
    loop: "core_reflect",
    calls: 2,
    status: "done",
    error: null,
    inputs: { a: 1 },
    outputs: { b: 2 },
    prompt_version: "v1",
    model: "fake",
  });
  expect(t!.created_at.getTime()).toBe(now.getTime());
});

test("an optional loop is skipped once only the reserve is left", async () => {
  const { all, deps } = setup();
  await runCoreLoop(deps, "core_reflect", now, async (ctx) => {
    await probe(ctx);
    await probe(ctx);
    return { inputs: {}, outputs: {} };
  });
  let ran = false;
  const out = await runCoreLoop(deps, "core_wander", now, async () => {
    ran = true;
    return { inputs: {}, outputs: {} };
  });
  expect(out).toEqual({ status: "skipped_budget", outputs: null });
  expect(ran).toBe(false);
  expect((await traces(all)).map((t) => t.status)).toEqual(["done", "skipped_budget"]);
});

test("a fallback loop still runs over budget, told it can't call", async () => {
  const { deps } = setup({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  const out = await runCoreLoop(deps, "core_appraise", now, async (ctx) => ({
    status: ctx.canCall() ? "done" : "fallback",
    inputs: {},
    outputs: { canCall: ctx.canCall() },
  }));
  expect(out).toEqual({ status: "fallback", outputs: { canCall: false } });
});

test("a skip loop over budget is skipped", async () => {
  const { deps } = setup({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  const out = await runCoreLoop(deps, "core_reflect", now, async () => ({
    inputs: {},
    outputs: {},
  }));
  expect(out.status).toBe("skipped_budget");
});

test("canCall counts calls made inside the run", async () => {
  const { deps } = setup({ core: { daily_call_budget: 1, budget_reserve: 0 } });
  const seen: boolean[] = [];
  await runCoreLoop(deps, "core_appraise", now, async (ctx) => {
    seen.push(ctx.canCall());
    await probe(ctx);
    seen.push(ctx.canCall());
    return { inputs: {}, outputs: {} };
  });
  expect(seen).toEqual([true, false]);
});

test("the budget resets at her local midnight", async () => {
  const { deps } = setup({ core: { daily_call_budget: 1, budget_reserve: 0 } });
  await runCoreLoop(deps, "core_reflect", now, async (ctx) => {
    await probe(ctx);
    return { inputs: {}, outputs: {} };
  });
  // 16:00 UTC is 00:00 the next day in Singapore.
  const tomorrow = new Date("2026-01-05T16:00:00Z");
  expect(budgetDayStart(deps.config, tomorrow).toISOString()).toBe("2026-01-05T16:00:00.000Z");
  const out = await runCoreLoop(deps, "core_reflect", tomorrow, async () => ({
    inputs: {},
    outputs: {},
  }));
  expect(out.status).toBe("done");
});

test("a failure is traced with its class and calls, then rethrown", async () => {
  const { all, deps } = setup();
  class BoomError extends Error {}
  await expect(
    runCoreLoop(deps, "core_reflect", now, async (ctx) => {
      await probe(ctx);
      throw new BoomError("secret content");
    }),
  ).rejects.toThrow("secret content");
  const [t] = await traces(all);
  expect(t).toMatchObject({ status: "failed", error: "BoomError", calls: 1 });
  expect(JSON.stringify(t)).not.toContain("secret content");
});

test("core loops can't call the reply model", async () => {
  const { deps } = setup();
  await expect(
    runCoreLoop(deps, "core_reflect", now, async (ctx) => {
      await ctx.deps.llm.generateReply({ system: "s", messages: [] });
      return { inputs: {}, outputs: {} };
    }),
  ).rejects.toThrow("reply model");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/mind/process/core/runner.test.ts`
Expected: FAIL (cannot resolve `@/mind/process/core/runner`).

- [ ] **Step 3: Report usage per call**

`src/mind/platform/llm/types.ts`:
- `StructuredModel` becomes `"cheap" | "extract" | "judge" | "guard" | "turn_judge" | "life" | "core"`.
- `ClassifyRequest<T>` gains, after `maxTokens`:
  ```ts
    /** Receives this call's usage once it completes; the core runner meters with it. */
    onUsage?: UsageSink;
  ```
  (Move the `UsageSink` type above `ClassifyRequest` so it's declared first.)

`src/mind/platform/llm/anthropic.ts`: in `classifyJson`, after `this.report(purpose, modelId, response.usage);`, call the per-request sink too. Change `report` to take an optional extra sink:

```ts
  private report(
    purpose: string,
    model: string,
    usage: Anthropic.Usage,
    extra?: UsageSink,
  ): void {
    const u = {
      purpose,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    };
    this.onUsage?.(u);
    extra?.(u);
  }
```

and pass `request.onUsage` (destructure `onUsage` alongside the other request fields) in the `classifyJson` call: `this.report(purpose, modelId, response.usage, onUsage);`. Make sure the role → model id lookup covers `"core"` (it reads `this.models[model]`; `config.models.core` is added below).

`src/mind/platform/llm/fake.ts`: in `classifyJson`, destructure `onUsage` and, after the handler returns successfully, report a zero-token usage:

```ts
  async classifyJson<T>({ purpose, system, input, schema, onUsage }: ClassifyRequest<T>): Promise<T> {
    this.structuredCalls.push({ purpose, system, input });

    const handler = this.handlers[purpose] ?? (purpose === "crisis" ? this.classify : undefined);
    if (!handler) throw new Error(`FakeLLMProvider: no handler for purpose "${purpose}"`);

    const out = schema.parse(await handler(input));
    onUsage?.({
      purpose,
      model: "fake",
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    return out;
  }
```

- [ ] **Step 4: Config**

`config/default.json`:
- `models`: add `"core": "claude-haiku-4-5"`.
- `core`: add, before `"state"`:
  ```json
  "daily_call_budget": 24,
  "budget_reserve": 8,
  "loop_priority": {
    "essential": [
      "life_plan",
      "life_event",
      "core_resolve",
      "core_appraise",
      "core_reflect",
      "core_render_snapshot",
      "core_drift_watch",
      "core_consolidate"
    ],
    "optional": ["core_anticipate", "core_ruminate", "core_wander"]
  },
  "prices": { "claude-haiku-4-5": { "input": 1, "output": 5 } },
  ```

`src/mind/platform/config.ts`:
- `models` schema: add `core: text,`.
- Above the `core` section:
  ```ts
  /** Every core loop that may call a model, so the budget can name it. */
  export const CORE_LOOPS = [
    "life_plan",
    "life_event",
    "core_resolve",
    "core_appraise",
    "core_reflect",
    "core_render_snapshot",
    "core_drift_watch",
    "core_consolidate",
    "core_anticipate",
    "core_ruminate",
    "core_wander",
  ] as const;
  export type CoreLoopName = (typeof CORE_LOOPS)[number];
  const coreLoop = z.enum(CORE_LOOPS);
  ```
- Replace `const core = z.object({ state: coreState, world: coreWorld });` with:
  ```ts
  const core = z
    .object({
      daily_call_budget: countFromZero,
      budget_reserve: countFromZero,
      loop_priority: z.object({ essential: z.array(coreLoop), optional: z.array(coreLoop) }),
      // US dollars per million tokens, by model id.
      prices: z.record(z.string(), z.object({ input: nonNegative, output: nonNegative })),
      state: coreState,
      world: coreWorld,
    })
    .refine(
      (c) => c.budget_reserve <= c.daily_call_budget,
      "core.budget_reserve must be <= daily_call_budget",
    );
  ```

- [ ] **Step 5: Trace type and repo**

`src/mind/platform/core.ts`:

```ts
export type LoopStatus = "done" | "fallback" | "skipped_budget" | "failed";

export type NewCoreLoopTrace = {
  /** Set when a loop needs to cite its own run (a memory's `source_ref`) before the row exists. */
  id?: string;
  loop: string;
  inputs: unknown;
  outputs: unknown;
  model: string | null;
  prompt_version: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  /** Model calls actually made, retries included; embeddings don't count. */
  calls: number;
  status: LoopStatus;
  /** The error class only, never content. */
  error: string | null;
  created_at: Date;
};

export interface CoreTraces {
  insert(trace: NewCoreLoopTrace): Promise<void>;
  /** Model calls traced at or after `from`: what today's budget has spent. */
  callsSince(from: Date): Promise<number>;
}
```

`src/db/repos/core/traces.ts`:

```ts
/**
 * Core loop traces: one row per core loop run, and what today's budget has spent.
 */
import { gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_loop_trace } from "@/db/schema";
import type { CoreTraces } from "@/mind/platform/core";

export function coreTracesRepo(db: Db): CoreTraces {
  return {
    async insert(trace) {
      await db.insert(core_loop_trace).values(trace);
    },

    async callsSince(from) {
      const [row] = await db
        .select({ n: sql<number>`COALESCE(sum(${core_loop_trace.calls}), 0)::int` })
        .from(core_loop_trace)
        .where(gte(core_loop_trace.created_at, from));
      return Number(row?.n ?? 0);
    },
  };
}
```

Existing code-only traces gain the new fields. In `src/mind/state/core/tick.ts` and in both `tx.traces.insert` calls of `src/mind/process/core/world-tick.ts`, add `calls: 0, status: "done", error: null,` (Tasks 4 and 7 replace the world tick's two calls with the runner; for now they just compile).

- [ ] **Step 6: Write the runner**

Create `src/mind/process/core/runner.ts`:

```ts
/**
 * How a core loop calls a model: within her daily call budget, metered, and traced once per run.
 * The budget is summed from today's traces (her local day), so it holds across jobs and restarts.
 * Optional loops stop while a reserve is left for the essential ones; essential loops that can
 * fall back (appraisal, resolution, plan, events) always run and are told whether they may still
 * call; the rest are skipped. A failure is traced with its class and rethrown.
 */
import { randomUUID } from "node:crypto";
import type { CoreLoopName, Config } from "@/mind/platform/config";
import type { LoopStatus, NewCoreLoopTrace } from "@/mind/platform/core";
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import type { LLMProvider, LlmUsage } from "@/mind/platform/llm/types";
import { localMidnight } from "@/mind/platform/timezone";
import { lifeDate, lifeTimezone } from "@/mind/world/her-clock";

export type LoopContext = {
  /** The loop's deps, with the model metered. */
  deps: CoreDeps;
  /** This run's trace id, for `source_ref`s written before the trace row exists. */
  traceId: string;
  /** Whether one more model call fits today's budget for this loop's tier. */
  canCall(): boolean;
};

export type LoopResult<T> = {
  status?: "done" | "fallback";
  inputs: unknown;
  outputs: T;
  promptVersion?: string | null;
};

/** Loops that have a code fallback, so they run even over budget. */
const FALLS_BACK: ReadonlySet<CoreLoopName> = new Set([
  "life_plan",
  "life_event",
  "core_resolve",
  "core_appraise",
]);

export function budgetDayStart(config: Config, now: Date): Date {
  return localMidnight(lifeDate(config.life, now), lifeTimezone(config.life, now));
}

export function meterLlm(llm: LLMProvider) {
  const usage: LlmUsage[] = [];
  let calls = 0;
  const metered: LLMProvider = {
    async generateReply() {
      throw new Error("core loops never call the reply model");
    },
    classifyJson(request) {
      calls += 1;
      return llm.classifyJson({
        ...request,
        onUsage: (u) => {
          request.onUsage?.(u);
          usage.push(u);
        },
      });
    },
  };
  return { llm: metered, usage, calls: () => calls };
}

function spend(usage: LlmUsage[], config: Config) {
  if (!usage.length) return { model: null, tokens_in: null, tokens_out: null, cost: null };
  const tokensIn = usage.reduce((s, u) => s + u.input_tokens, 0);
  const tokensOut = usage.reduce((s, u) => s + u.output_tokens, 0);
  let cost: number | null = 0;
  for (const u of usage) {
    const price = config.core.prices[u.model];
    if (!price || cost === null) {
      cost = null;
      continue;
    }
    cost += (u.input_tokens * price.input + u.output_tokens * price.output) / 1_000_000;
  }
  return { model: usage.at(-1)!.model, tokens_in: tokensIn, tokens_out: tokensOut, cost };
}

export async function runCoreLoop<T>(
  deps: CoreDeps,
  name: CoreLoopName,
  now: Date,
  fn: (ctx: LoopContext) => Promise<LoopResult<T>>,
): Promise<{ status: LoopStatus; outputs: T | null }> {
  const { config, core } = deps;
  const optional = config.core.loop_priority.optional.includes(name);
  const limit = config.core.daily_call_budget - (optional ? config.core.budget_reserve : 0);
  const spent = await core.traces.callsSince(budgetDayStart(config, now));
  const meter = meterLlm(deps.llm);
  const canCall = () => spent + meter.calls() < limit;
  const traceId = randomUUID();
  const trace = (fields: Partial<NewCoreLoopTrace> & Pick<NewCoreLoopTrace, "status">) =>
    core.traces.insert({
      id: traceId,
      loop: name,
      inputs: {},
      outputs: {},
      prompt_version: null,
      error: null,
      created_at: now,
      calls: meter.calls(),
      ...spend(meter.usage, config),
      ...fields,
    });

  if (!canCall() && !FALLS_BACK.has(name)) {
    await trace({ status: "skipped_budget", inputs: { spent, limit } });
    return { status: "skipped_budget", outputs: null };
  }

  let result: LoopResult<T>;
  try {
    result = await fn({ deps: { ...deps, llm: meter.llm }, traceId, canCall });
  } catch (error) {
    await trace({ status: "failed", error: errorName(error) });
    throw error;
  }
  const status = result.status ?? "done";
  await trace({
    status,
    inputs: result.inputs,
    outputs: result.outputs,
    prompt_version: result.promptVersion ?? null,
  });
  return { status, outputs: result.outputs };
}
```

`errorName` must return the class name (`BoomError`) — check `src/mind/platform/errors.ts`; it already returns the innermost cause's constructor name.

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run tests/mind/process/core/runner.test.ts tests/mind/platform tests/mind/state/core tests/mind/process/core`
Expected: PASS. Then `pnpm typecheck` — PASS.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add src config tests/mind/process/core/runner.test.ts
git commit -m "feat(core): budgeted, metered core loop runner with one trace per run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The day plan on `CoreDeps` (B50)

**Files:**
- Modify: `src/mind/world/types.ts`, `src/db/repos/core/world.ts`, `src/mind/world/day-plan.ts`, `src/worker/world-jobs.ts:17`, `evals/lib/life-loop.ts:111`
- Test: `tests/mind/world/day-plan.test.ts`, `tests/mind/platform/boundaries.test.ts` (if it lists core-fenced files)

**Interfaces:**
- Consumes: `runCoreLoop` (Task 2).
- Produces:
  - `World.plansBefore(day: string, limit: number): Promise<{ date: string; plan: LifePlan }[]>` (oldest first).
  - `World.insertPlan(row: NewLifeDay): Promise<boolean>` with `type NewLifeDay = { date: string; plan: LifePlan; source: "model" | "fallback" | "scripted"; model: string; prompt_version: string; generated_at: Date }`.
  - `ensurePlans(deps: CoreDeps, now: Date): Promise<{ created: string[] }>`.
  - `buildPlanInput(date: string, previous: { date: string; plan: LifePlan }[]): string`.

- [ ] **Step 1: Write the failing tests**

In `tests/mind/world/day-plan.test.ts`, change every `ensurePlans(deps, …)` to `ensurePlans(coreDepsOf(deps), …)` (import `coreDepsOf` from `@/mind/platform/deps`), and append:

```ts
test("each generated plan writes a life_plan trace with its calls", async () => {
  const deps = makeTestDeps();
  await ensurePlans(coreDepsOf(deps), new Date("2026-01-05T02:00:00Z"));
  const rows = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "life_plan"));
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.calls === 1 && r.status === "done")).toBe(true);
});

test("over budget the fallback plan is written without calling the model", async () => {
  const deps = makeTestDeps({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  await ensurePlans(coreDepsOf(deps), new Date("2026-01-05T02:00:00Z"));
  expect((await getLifeDay(getTestDb(), "2026-01-05"))?.source).toBe("fallback");
  expect(deps.llm.structuredCalls.filter((c) => c.purpose === "life_plan")).toEqual([]);
  const rows = await deps.db.select().from(core_loop_trace);
  expect(rows.map((r) => r.status)).toEqual(["fallback", "fallback"]);
});
```

(Import `core_loop_trace` from `@/db/schema` and `eq` from `drizzle-orm`.)

In `tests/db/core-repos.test.ts` append:

```ts
test("the world stores plans and reads the ones before a day, oldest first", async () => {
  const deps = makeTestDeps();
  const plan = { blocks: [] };
  const row = (date: string) => ({
    date,
    plan,
    source: "model" as const,
    model: "m",
    prompt_version: "v1",
    generated_at: new Date("2026-01-01T00:00:00Z"),
  });
  expect(await deps.core.world.insertPlan(row("2026-01-04"))).toBe(true);
  expect(await deps.core.world.insertPlan(row("2026-01-04"))).toBe(false);
  await deps.core.world.insertPlan(row("2026-01-02"));
  await deps.core.world.insertPlan(row("2026-01-03"));
  expect((await deps.core.world.plansBefore("2026-01-04", 2)).map((p) => p.date)).toEqual([
    "2026-01-02",
    "2026-01-03",
  ]);
  expect(await deps.core.world.plansBefore("2026-01-04", 0)).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/mind/world/day-plan.test.ts tests/db/core-repos.test.ts`
Expected: FAIL (`insertPlan` not a function; type errors on `ensurePlans`).

- [ ] **Step 3: Extend `World`**

`src/mind/world/types.ts`, add:

```ts
export type NewLifeDay = {
  date: string;
  plan: LifePlan;
  source: "model" | "fallback" | "scripted";
  model: string;
  prompt_version: string;
  generated_at: Date;
};
```

and in `interface World`:

```ts
  /** The `limit` plans before `day`, oldest first (the plan generator's continuity context). */
  plansBefore(day: string, limit: number): Promise<{ date: string; plan: LifePlan }[]>;
  /** False when that day already has a plan (a concurrent generator's row wins). */
  insertPlan(row: NewLifeDay): Promise<boolean>;
```

`src/db/repos/core/world.ts`: import `insertLifeDay, listLifeDaysBefore` from `../world/life-day` and add:

```ts
    async plansBefore(day, limit) {
      return (await listLifeDaysBefore(db, day, limit)).map((r) => ({
        date: r.date,
        plan: r.plan,
      }));
    },

    async insertPlan(row) {
      return insertLifeDay(db, row);
    },
```

- [ ] **Step 4: Move the day plan onto `CoreDeps`**

In `src/mind/world/day-plan.ts`:
- Remove the `@/db/repos/world/life-day` import and the `Deps` import; import `type CoreDeps` from `@/mind/platform/deps` and `runCoreLoop` from `@/mind/process/core/runner`.
- `buildPlanInput(date: string, previous: { date: string; plan: LifePlan }[])` (body unchanged).
- Replace `generatePlan` and `ensurePlans` with:

```ts
type Generated = { plan: LifePlan; source: "model" | "fallback" };

async function generatePlan(
  deps: CoreDeps,
  date: string,
  canCall: () => boolean,
): Promise<Generated> {
  const { config, llm, log } = deps;
  const previous = await deps.core.world.plansBefore(date, config.life.plan_context_days);
  const persona = loadPersona(config).coreValues;
  const instructions = loadPrompt("life/plan", config.prompts.life_plan);
  const system = `${persona}\n\n${instructions}`;

  let input = buildPlanInput(date, previous);

  for (let attempt = 1; attempt <= GENERATION_ATTEMPTS && canCall(); attempt++) {
    try {
      const raw = await llm.classifyJson({
        purpose: "life_plan",
        model: "life",
        system,
        input,
        schema: PlanSchema,
        timeoutMs: config.models.structured_timeout_ms,
        maxTokens: config.life.plan_max_tokens,
      });

      const checked = validatePlan(raw, config.life);
      if (checked.ok) return { plan: checked.plan, source: "model" };

      input = `${buildPlanInput(date, previous)}\n\nYour previous plan was rejected: ${checked.violations.join("; ")}. Fix these.`;
    } catch (e) {
      log.error("life plan generation failed", { date, attempt, error: errorName(e) });
    }
  }

  return { plan: fallbackPlan(config.life), source: "fallback" };
}

/**
 * The `life_plan` job: makes sure her today and tomorrow have a plan. Safe to run repeatedly. Each
 * missing day is one budgeted run; over budget, or after two failed attempts, she gets the
 * fallback plan, so she always has a day.
 */
export async function ensurePlans(deps: CoreDeps, now: Date): Promise<{ created: string[] }> {
  const { config, clock, log } = deps;
  const today = lifeDate(config.life, now);
  const created: string[] = [];

  for (const date of [today, nextLocalDate(today)]) {
    if (await deps.core.world.plan(date)) continue;

    const run = await runCoreLoop(deps, "life_plan", now, async (ctx) => {
      const { plan, source } = await generatePlan(ctx.deps, date, ctx.canCall);
      const fromModel = source === "model";
      const inserted = await ctx.deps.core.world.insertPlan({
        date,
        plan,
        source,
        model: fromModel ? config.models.life : "none",
        prompt_version: fromModel ? config.prompts.life_plan : "fallback",
        generated_at: clock.now(),
      });
      return {
        status: fromModel ? "done" : "fallback",
        inputs: { date },
        outputs: { source, inserted },
        promptVersion: config.prompts.life_plan,
      };
    });

    if (run.outputs?.inserted) created.push(date);
    log.info("life plan", { date, source: run.outputs?.source, inserted: run.outputs?.inserted });
  }

  return { created };
}
```

- [ ] **Step 5: Update the callers**

- `src/worker/world-jobs.ts`: `await ensurePlans(coreDepsOf(deps), deps.clock.now());`
- `evals/lib/life-loop.ts:111`: `else await ensurePlans(coreDepsOf(deps), now);`

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run tests/mind/world tests/db/core-repos.test.ts tests/evals && pnpm typecheck && pnpm lint`
Expected: PASS. `pnpm lint` proves `day-plan.ts` no longer imports a db repo.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add src evals tests
git commit -m "refactor(world): the day plan runs on CoreDeps through the budgeted runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Event generation through the runner

**Files:**
- Modify: `src/mind/process/core/world-tick.ts`
- Test: `tests/mind/process/core/world-tick.test.ts`

**Interfaces:**
- Consumes: `runCoreLoop` (Task 2).
- Produces: the generation step's trace is now loop `life_event` (the in-transaction `core_world_tick` trace is removed). `coreWorldTick`'s signature and result are unchanged.

- [ ] **Step 1: Update and add tests**

In `tests/mind/process/core/world-tick.test.ts`:
- In "generates once per her day…": the trace query becomes `eq(core_loop_trace.loop, "life_event")` and still expects one row; add `expect(traces[0]).toMatchObject({ status: "done", calls: 1 });`.
- In "a failure inside the apply rolls back every write…": the transaction's last write is now `tx.state.update`, so spy on that instead:
  ```ts
      vi.spyOn(tx.state, "update").mockRejectedValue(new Error("disk full"));
  ```
- Append:

```ts
test("over budget the day is marked done with no event and no model call", async () => {
  const deps = makeTestDeps({ ...cfg, core: { ...cfg.core, daily_call_budget: 0, budget_reserve: 0 } });
  expect(await coreWorldTick(coreDepsOf(deps), at)).toEqual(done);
  expect(await rows(deps, world_event)).toBe(0);
  expect((await deps.core.state.get())!.last_event_day).toBe("2026-01-05");
  expect(deps.llm.structuredCalls.filter((c) => c.purpose === "life_event")).toEqual([]);
  const [trace] = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "life_event"));
  expect(trace).toMatchObject({ status: "fallback", calls: 0 });
  // The next run doesn't try again.
  expect(await coreWorldTick(coreDepsOf(deps), new Date(at.getTime() + H))).toEqual({
    generated: false,
    appraised: 0,
  });
});

test("a generation failure is traced as failed", async () => {
  const deps = makeTestDeps(cfg);
  deps.llm.handlers.life_event = sequence(new Error("model down"));
  await expect(coreWorldTick(coreDepsOf(deps), at)).rejects.toThrow("model down");
  const [trace] = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "life_event"));
  expect(trace).toMatchObject({ status: "failed", error: "Error" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/mind/process/core/world-tick.test.ts`
Expected: FAIL (no `life_event` trace; over-budget test generates an event).

- [ ] **Step 3: Implement**

In `src/mind/process/core/world-tick.ts`, import `runCoreLoop` from `./runner` and `type AcceptedEvent, type EventAttempt` from `@/mind/world/events`. Replace `generateIfDue` with a runner call around a separate apply:

```ts
async function generateIfDue(deps: CoreDeps, now: Date, opts: WorldTickOptions): Promise<boolean> {
  const { core, config } = deps;
  if (lifeHour(config.life, now) < config.core.world.events_local_hour) return false;
  const day = lifeDate(config.life, now);
  await core.state.ensure(config.core.state.baseline);
  if (!due((await core.state.get())?.last_event_day ?? null, day)) return false;

  const run = await runCoreLoop(deps, "life_event", now, async (ctx) => {
    // Over budget the day still counts as done, so later runs don't spend past the budget.
    if (!ctx.canCall()) {
      const out = await applyDay(ctx.deps, day, now, [], []);
      return { status: "fallback", inputs: { day }, outputs: out };
    }
    const { accepted, attempts } = await generateCoreEvents(ctx.deps, day, now, opts.inject);
    const out = await applyDay(ctx.deps, day, now, accepted, attempts);
    return {
      inputs: { day, attempts: attempts.length },
      outputs: out,
      promptVersion: config.prompts.life_event,
    };
  });
  return run.outputs?.applied ?? false;
}

type DayApplied = { applied: boolean; world_events: string[]; intentions: string[] };

async function applyDay(
  deps: CoreDeps,
  day: string,
  now: Date,
  accepted: AcceptedEvent[],
  attempts: EventAttempt[],
): Promise<DayApplied> {
  const { core, config } = deps;
  return core.transaction(async (tx) => {
    await tx.lock(LOCK);
    const row = await tx.state.lock();
    if (!due(row.last_event_day, day)) return { applied: false, world_events: [], intentions: [] };
    // … the existing loop over `accepted`, `logEventAttempts` and `state.update`, unchanged,
    //   minus the `tx.traces.insert({ loop: "core_world_tick", … })` call …
    return { applied: true, world_events: [...eventIds.values()], intentions: intentionIds };
  });
}
```

Move the existing body (from `const eventIds = new Map…` through `await tx.state.update({...})`) into `applyDay` verbatim; it references `config`, `now`, `day`, `accepted` and `attempts`, all now parameters. Delete the old `core_world_tick` trace insert. Update the file header's last paragraph: "Event generation is one budgeted `life_event` run; over budget the day passes with no event."

The `state.ensure` call keeps its current signature in this task; Task 6 changes it.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/mind/process/core tests/mind/world tests/exit tests/evals`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add src tests
git commit -m "feat(core): event generation is a budgeted life_event run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Goals — repo, persona `### Goals`, seeding

**Files:**
- Create: `src/db/repos/core/goals.ts`, `prompts/persona/v5.md`
- Delete: `prompts/persona/v4.md`
- Modify: `src/mind/state/core/types.ts`, `src/mind/platform/core.ts`, `src/db/repos/core/index.ts`, `src/mind/platform/persona.ts`, `src/mind/memory/core/seed.ts`, `src/db/reset-self-cli.ts`, `config/default.json` (`prompts.persona` → `v5`, new `core.goals`), `src/mind/platform/config.ts`
- Test: `tests/db/core-goals.test.ts`, `tests/mind/platform/persona.test.ts`, `tests/mind/memory/core/seed.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/mind/state/core/types.ts
  export type CoreGoalStatus = "active" | "done" | "dropped";
  export type CoreGoal = {
    id: string; title: string; why: string; status: CoreGoalStatus; progress: number;
    source: "seed" | "reflect"; source_ref: string | null;
    started_at: Date; target_at: Date | null; updated_at: Date;
  };
  export type NewCoreGoal = Omit<CoreGoal, "id" | "updated_at"> & { embedding: number[] };
  export interface CoreGoals {
    active(): Promise<CoreGoal[]>;
    get(id: string): Promise<CoreGoal | null>;
    count(): Promise<number>;
    insert(goal: NewCoreGoal): Promise<string>;
    setProgress(id: string, progress: number, now: Date): Promise<void>;
    setStatus(id: string, status: CoreGoalStatus, now: Date): Promise<void>;
  }
  ```
  - `CoreScope.goals: CoreGoals`.
  - `parseSeedGoals(seedSelf: string): { title: string; why: string }[]` in `persona.ts`.
  - `seedGoals(deps: SeedDeps): Promise<number>`; `SeedDeps` becomes `Pick<CoreDeps, "core" | "clock" | "config" | "embedder">`.
  - Config `core.goals = { max_active: 3, step: { small: 0.05, medium: 0.1, large: 0.2 } }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/db/core-goals.test.ts`:

```ts
/**
 * Her goals in Postgres: active ones listed oldest first, progress and status stamped by the caller.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { closeTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const t0 = new Date("2026-01-05T00:00:00Z");
const t1 = new Date("2026-01-06T00:00:00Z");
const goal = (title: string) => ({
  title,
  why: "because",
  status: "active" as const,
  progress: 0,
  source: "seed" as const,
  source_ref: null,
  started_at: t0,
  target_at: null,
  embedding: vec(),
});

test("insert, read, progress and status", async () => {
  const { core } = makeTestDeps();
  const a = await core.goals.insert(goal("A"));
  const b = await core.goals.insert({ ...goal("B"), started_at: t1 });
  expect((await core.goals.active()).map((g) => g.title)).toEqual(["A", "B"]);
  await core.goals.setProgress(a, 0.4, t1);
  await core.goals.setStatus(b, "dropped", t1);
  expect(await core.goals.get(a)).toMatchObject({ progress: 0.4, status: "active" });
  expect((await core.goals.get(a))!.updated_at.getTime()).toBe(t1.getTime());
  expect((await core.goals.active()).map((g) => g.title)).toEqual(["A"]);
  expect(await core.goals.count()).toBe(2);
  expect(await core.goals.get("00000000-0000-0000-0000-000000000000")).toBeNull();
});
```

In `tests/mind/platform/persona.test.ts` append:

```ts
test("seed goals are the `- title: why` lines under ### Goals", () => {
  const seed = [
    "### Lately",
    "- not a goal: no",
    "### Goals",
    "- Learn the winter constellations: she keeps getting Orion wrong",
    "- Finish the Le Guin shelf: started in spring",
    "not a bullet",
    "### Habits of speech",
    "- also not: a goal",
  ].join("\n");
  expect(parseSeedGoals(seed)).toEqual([
    { title: "Learn the winter constellations", why: "she keeps getting Orion wrong" },
    { title: "Finish the Le Guin shelf", why: "started in spring" },
  ]);
  expect(parseSeedGoals("### Lately\n- x: y")).toEqual([]);
});

test("the shipped persona has at least one seed goal", () => {
  expect(parseSeedGoals(loadPersona(loadConfig()).seedSelf).length).toBeGreaterThan(0);
});
```

(Import `parseSeedGoals`, `loadPersona` and `loadConfig` as needed.)

In `tests/mind/memory/core/seed.test.ts`: change the expected `prompt_version: "v4"` to `"v5"`, and append:

```ts
test("seedCore seeds her goals once, active, from the persona", async () => {
  const deps = coreDepsOf(makeTestDeps());
  await seedCore(deps);
  await seedCore(deps);
  const goals = await deps.core.goals.active();
  expect(goals.map((g) => g.title)).toEqual(
    parseSeedGoals(loadPersona(deps.config).seedSelf).map((g) => g.title),
  );
  expect(goals.every((g) => g.source === "seed" && g.progress === 0)).toBe(true);
});

test("seeding never adds goals when she already has some", async () => {
  const deps = coreDepsOf(makeTestDeps());
  await deps.core.goals.insert({
    title: "Her own",
    why: "reflect made it",
    status: "dropped",
    progress: 0,
    source: "reflect",
    source_ref: null,
    started_at: deps.clock.now(),
    target_at: null,
    embedding: vec(),
  });
  await seedCore(deps);
  expect(await deps.core.goals.count()).toBe(1);
});
```

(Import `parseSeedGoals` from `@/mind/platform/persona` and `vec` from the db helper.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/db/core-goals.test.ts tests/mind/platform/persona.test.ts tests/mind/memory/core/seed.test.ts`
Expected: FAIL (`core.goals` undefined; `parseSeedGoals` not exported).

- [ ] **Step 3: Types, repo, wiring**

Add the `CoreGoal*` types and `CoreGoals` interface above to `src/mind/state/core/types.ts`; in `src/mind/platform/core.ts` import `CoreGoals` and add `goals: CoreGoals;` to `CoreScope`.

Create `src/db/repos/core/goals.ts`:

```ts
/**
 * Her goals in Postgres: the `core_goal` table. No query here takes or returns a user id.
 */
import { asc, count, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_goal } from "@/db/schema";
import type { CoreGoal, CoreGoals } from "@/mind/state/core/types";
import { one } from "../util";

function toGoal(r: typeof core_goal.$inferSelect): CoreGoal {
  const { embedding: _embedding, ...goal } = r;
  return goal;
}

export function coreGoalsRepo(db: Db): CoreGoals {
  return {
    async active() {
      const rows = await db
        .select()
        .from(core_goal)
        .where(eq(core_goal.status, "active"))
        .orderBy(asc(core_goal.started_at));
      return rows.map(toGoal);
    },

    async get(id) {
      const row = (await db.select().from(core_goal).where(eq(core_goal.id, id)))[0];
      return row ? toGoal(row) : null;
    },

    async count() {
      return one(await db.select({ n: count() }).from(core_goal)).n;
    },

    async insert(goal) {
      return one(
        await db
          .insert(core_goal)
          .values({ ...goal, updated_at: goal.started_at })
          .returning({ id: core_goal.id }),
      ).id;
    },

    async setProgress(id, progress, now) {
      await db.update(core_goal).set({ progress, updated_at: now }).where(eq(core_goal.id, id));
    },

    async setStatus(id, status, now) {
      await db.update(core_goal).set({ status, updated_at: now }).where(eq(core_goal.id, id));
    },
  };
}
```

`get` with a non-uuid string would throw in Postgres; callers pass ids from the model, so Task 7 filters ids against `active()` before calling `get`.

In `src/db/repos/core/index.ts`, import `coreGoalsRepo` and add `goals: coreGoalsRepo(db),` to `scope`.

- [ ] **Step 4: Persona v5 and parsing**

Copy `prompts/persona/v4.md` to `prompts/persona/v5.md` and insert, at the end of `# Seed self` (after `### Habits of speech` and its bullet, before `# Public voice (reference)`):

```markdown
### Goals
- Learn the winter constellations by sight: she keeps pointing at Orion's belt and calling it something else, and it bothers her more than it should.
- Finish the slow-film list she started this year: forty films from before 1975, and she's somewhere in the twenties.
```

(These are placeholders for Ethan to rewrite; say so in the summary.)

Delete `prompts/persona/v4.md`. Set `prompts.persona` to `"v5"` in `config/default.json`.

In `src/mind/platform/persona.ts` add:

```ts
const GOALS = "### Goals";
const GOAL_LINE = /^- (.+?): (.+)$/;

/** Her starting goals: the `- title: why` bullets under the seed self's `### Goals` heading. */
export function parseSeedGoals(seedSelf: string): { title: string; why: string }[] {
  const goals: { title: string; why: string }[] = [];
  let inGoals = false;
  for (const line of seedSelf.split("\n")) {
    if (line.startsWith("### ")) {
      inGoals = line.trim() === GOALS;
      continue;
    }
    const m = inGoals ? GOAL_LINE.exec(line.trim()) : null;
    if (m) goals.push({ title: m[1]!.trim(), why: m[2]!.trim() });
  }
  return goals;
}
```

- [ ] **Step 5: Config `core.goals`**

`config/default.json` `core`: add `"goals": { "max_active": 3, "step": { "small": 0.05, "medium": 0.1, "large": 0.2 } }`.
`config.ts`: add `goals: z.object({ max_active: positiveInt, step: z.object({ small: unit, medium: unit, large: unit }) }),` inside the `core` object.

- [ ] **Step 6: Seed goals**

In `src/mind/memory/core/seed.ts`:
- `type SeedDeps = Pick<CoreDeps, "core" | "clock" | "config" | "embedder">;` and update the comment: "Seeding needs no reply model; goals are embedded, so the embedder comes along."
- Add:

```ts
/** Her persona's goals, the first time only: once she has any goal, reflect owns them. */
export async function seedGoals(deps: SeedDeps): Promise<number> {
  if ((await deps.core.goals.count()) > 0) return 0;
  const goals = parseSeedGoals(loadPersona(deps.config).seedSelf).slice(
    0,
    deps.config.core.goals.max_active,
  );
  if (!goals.length) return 0;
  const vectors = await deps.embedder.embed(
    goals.map((g) => `${g.title}: ${g.why}`),
    "document",
  );
  const now = deps.clock.now();
  for (const [i, g] of goals.entries()) {
    await deps.core.goals.insert({
      ...g,
      status: "active",
      progress: 0,
      source: "seed",
      source_ref: `persona:${deps.config.prompts.persona}`,
      started_at: now,
      target_at: null,
      embedding: vectors[i]!,
    });
  }
  return goals.length;
}
```

and call `await seedGoals(deps);` at the end of `seedCore`. Update the file header to mention goals.

`src/db/reset-self-cli.ts`: build a `VoyageEmbedder` like `src/runtime/deps.ts:45-50` (`apiKey: env.VOYAGE_API_KEY`, the config's model and dimensions) and pass `embedder` to `seedCore`; update its closing log line to "reseeded snapshot v0, her canon people and her goals".

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run tests/db tests/mind/platform tests/mind/memory/core && pnpm typecheck`
Expected: PASS. Any other test asserting persona `v4` gets updated to `v5` (find with `grep -rn '"v4"' tests | grep -i persona`).

- [ ] **Step 8: Commit**

```bash
pnpm format
git add prompts src config tests
git commit -m "feat(core): her goals, seeded from the persona's ### Goals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Needs and emotion in core state; feeling line v3

**Files:**
- Modify: `src/mind/state/core/types.ts`, `src/db/repos/core/state.ts`, `src/mind/state/core/core-state.ts`, `src/mind/state/core/tick.ts`, `src/mind/state/core/line.ts`, `src/mind/process/core/world-tick.ts` (the `ensure` calls), `config/default.json`, `src/mind/platform/config.ts`
- Create: `prompts/core-state/line/v3.md`; Delete: `prompts/core-state/line/v2.md`
- Test: `tests/mind/state/core/core-state.test.ts`, `tick.test.ts`, `line.test.ts`, and every test that calls `core.state.ensure(`

**Interfaces:**
- Produces:
  ```ts
  export type CoreNeeds = { autonomy: number; competence: number };
  export type CoreEmotion = {
    label: string; valence: number; arousal: number;
    /** A short phrase for what it's about ("the telescope images"), or null. */
    phrase: string | null;
    /** The core memory it's about, or null. */
    about: string | null;
    /** ISO time it was felt. */
    since: string;
  };
  // CoreStateRow: emotion: CoreEmotion | null; needs: CoreNeeds
  // CoreStatePatch = Partial<Omit<CoreStateRow, "baseline">>
  // CoreState.ensure(baseline: CoreMood, needs: CoreNeeds): Promise<void>
  export function baselineNeeds(cfg: CoreStateConfig): CoreNeeds;       // core-state.ts
  export function depleteNeeds(n: CoreNeeds, cfg: CoreStateConfig): CoreNeeds; // one hour
  export function emotionExpired(e: CoreEmotion | null, now: Date, cfg: CoreStateConfig): boolean;
  export type FeelingInput = CoreMood & Pick<CoreStateRow, "emotion" | "needs">;
  export function coreStateLine(s: FeelingInput, cfg, phrases, seed): string | null;
  ```
- Config `core.state`: `needs_baseline: 0.6`, `need_decay_per_day: 0.1`, `emotion_hours: 6`, `bands.needs: [0.3, 0.8]`; `prompts.core_state_line: "v3"`.

- [ ] **Step 1: Write the failing tests**

`tests/mind/state/core/core-state.test.ts` append:

```ts
test("needs deplete by a day's rate over 24 hours and never go below 0", () => {
  const cfg = loadConfig().core.state;
  const after = depleteNeeds({ autonomy: 0.5, competence: 0.001 }, cfg);
  expect(after.autonomy).toBeCloseTo(0.5 - cfg.need_decay_per_day / 24);
  expect(after.competence).toBe(0);
});

test("an emotion expires after emotion_hours", () => {
  const cfg = loadConfig().core.state;
  const since = new Date("2026-01-05T00:00:00Z");
  const e = { label: "giddy", valence: 0.6, arousal: 0.7, phrase: null, about: null, since: since.toISOString() };
  const at = (h: number) => new Date(since.getTime() + h * 3_600_000);
  expect(emotionExpired(e, at(cfg.emotion_hours - 1), cfg)).toBe(false);
  expect(emotionExpired(e, at(cfg.emotion_hours), cfg)).toBe(true);
  expect(emotionExpired(null, at(100), cfg)).toBe(false);
});
```

`tests/mind/state/core/tick.test.ts` append (follow the file's existing setup helpers):

```ts
test("the tick depletes needs and lets an old emotion go", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  const cfg = deps.config.core.state;
  await deps.core.state.ensure(cfg.baseline, baselineNeeds(cfg));
  const now = new Date("2026-01-05T09:00:00Z");
  const old = new Date(now.getTime() - (cfg.emotion_hours + 1) * 3_600_000);
  await deps.core.state.update({
    emotion: { label: "giddy", valence: 0.6, arousal: 0.7, phrase: null, about: null, since: old.toISOString() },
  });
  await coreStateTick(deps, now);
  const row = (await deps.core.state.get())!;
  expect(row.emotion).toBeNull();
  expect(row.needs.autonomy).toBeCloseTo(cfg.needs_baseline - cfg.need_decay_per_day / 24);
});
```

`tests/mind/state/core/line.test.ts`: every `coreStateLine({...})` call gains `emotion: null, needs: { autonomy: 0.6, competence: 0.6 }`; the `ensure` call becomes `ensure({ … }, { autonomy: 0.6, competence: 0.6 })`. Append:

```ts
const calm = { mood_valence: 0.1, mood_arousal: 0.4, energy: 0.5 };

test("a current emotion is in the line, with what it's about", () => {
  const line = coreStateLine(
    {
      ...calm,
      needs: { autonomy: 0.6, competence: 0.6 },
      emotion: { label: "giddy", valence: 0.6, arousal: 0.7, phrase: "the telescope images", about: null, since: "2026-01-05T00:00:00Z" },
    },
    c.core.state,
    phrases,
    "s",
  )!;
  expect(line).toContain("giddy");
  expect(line).toContain("the telescope images");
});

test("a low need gets its phrase", () => {
  const line = coreStateLine(
    { ...calm, emotion: null, needs: { autonomy: 0.1, competence: 0.6 } },
    c.core.state,
    phrases,
    "s",
  )!;
  expect(phrases["autonomy low"]!.some((p) => line.includes(p))).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/mind/state/core`
Expected: FAIL (missing exports and config keys).

- [ ] **Step 3: Types and repo**

`src/mind/state/core/types.ts`: add `CoreNeeds` and `CoreEmotion` as above; in `CoreStateRow` set `emotion: CoreEmotion | null;` and `needs: CoreNeeds;`; set `export type CoreStatePatch = Partial<Omit<CoreStateRow, "baseline">>;`; change `ensure` to `ensure(baseline: CoreMood, needs: CoreNeeds): Promise<void>;` with the comment "Creates the row at `baseline` with `needs` if it doesn't exist yet." Update the header: "Her core state as the rest of the mind sees it: one row of mood, energy, needs, her current emotion and preoccupation."

`src/db/repos/core/state.ts`: delete `NEUTRAL_EMOTION` and `NEUTRAL_NEEDS`; `toRow` casts the jsonb columns:

```ts
function toRow(r: typeof core_state.$inferSelect): CoreStateRow {
  const { id: _id, emotion, needs, ...rest } = r;
  return { ...rest, emotion: (emotion as CoreEmotion | null) ?? null, needs: needs as CoreNeeds };
}
```

and `ensure(baseline, needs)` inserts `{ id: ROW, ...baseline, baseline, emotion: null, needs }`.

- [ ] **Step 4: Maths and tick**

`src/mind/state/core/core-state.ts` add:

```ts
export const baselineNeeds = (cfg: CoreStateConfig): CoreNeeds => ({
  autonomy: cfg.needs_baseline,
  competence: cfg.needs_baseline,
});

/** One hour of a need going unmet. */
export function depleteNeeds(n: CoreNeeds, cfg: CoreStateConfig): CoreNeeds {
  const step = cfg.need_decay_per_day / 24;
  return { autonomy: clamp(n.autonomy - step, 0, 1), competence: clamp(n.competence - step, 0, 1) };
}

export function emotionExpired(
  e: CoreEmotion | null,
  now: Date,
  cfg: CoreStateConfig,
): boolean {
  return !!e && now.getTime() - Date.parse(e.since) >= cfg.emotion_hours * HOUR;
}
```

`src/mind/state/core/tick.ts`: `await core.state.ensure(cfg.baseline, baselineNeeds(cfg));`; inside the transaction, add to the `update`:

```ts
      needs: depleteNeeds(row.needs, cfg),
      ...(emotionExpired(row.emotion, now, cfg) ? { emotion: null } : {}),
```

and add `needs` and `emotion_cleared` to the trace outputs. Update the header: "…an old preoccupation lets go, unmet needs slowly deplete, and a feeling fades after a few hours."

`src/mind/process/core/world-tick.ts`: both `core.state.ensure(config.core.state.baseline)` become `core.state.ensure(config.core.state.baseline, baselineNeeds(config.core.state))`.

Fix every other `state.ensure(` call (list: `grep -rn "state.ensure(" src evals tests`) by passing `baselineNeeds(deps.config.core.state)` (or a literal `{ autonomy: 0.6, competence: 0.6 }` in tests that pass a literal baseline).

- [ ] **Step 5: Config**

`config/default.json` `core.state`: add `"needs_baseline": 0.6, "need_decay_per_day": 0.1, "emotion_hours": 6,` and `"needs": [0.3, 0.8]` inside `bands`. `prompts.core_state_line` → `"v3"`.
`config.ts` `coreState`: add `needs_baseline: unit, need_decay_per_day: unit, emotion_hours: z.number().positive(),` and `needs: band` inside `bands`.

- [ ] **Step 6: Line v3**

Create `prompts/core-state/line/v3.md`:

```markdown
# Feeling line phrases (v3)

Lines for the "How you're feeling" section. One line is picked per non-neutral key and joined. In the emotion lines, {label} is the feeling and {about} what it's about.

## emotion
- You're feeling {label}.
## emotion about
- You're feeling {label} about {about}.
- Right now you're {label}, mostly about {about}.
## energy low
- You're low on energy right now.
- You're a bit worn out.
## energy high
- You've got plenty of energy right now.
- You feel awake and sharp.
## mood_valence low
- You're in a bit of a low mood.
- Your mood's a little flat today.
## mood_valence high
- You're in a good mood.
- Things feel good today.
## mood_arousal low
- You feel slow and quiet.
## mood_arousal high
- You feel restless and wired.
## autonomy low
- You're restless, wanting something that's just yours to do.
## competence low
- You've been feeling a bit useless lately, like nothing's landing.
```

Delete `prompts/core-state/line/v2.md`.

In `src/mind/state/core/line.ts`:

```ts
export type FeelingInput = CoreMood & Pick<CoreStateRow, "emotion" | "needs">;
const NEEDS = ["autonomy", "competence"] as const;

const pick = (list: string[] | undefined, seed: string) =>
  list?.length ? list[Math.floor(seededUnit(seed) * list.length)]! : null;

/** Her feeling, then one phrase per non-neutral dimension and per low need; never raw numbers. */
export function coreStateLine(
  s: FeelingInput,
  cfg: CoreStateConfig,
  phrases: Phrases,
  seed: string,
): string | null {
  const parts: string[] = [];
  if (s.emotion) {
    const t = pick(phrases[s.emotion.phrase ? "emotion about" : "emotion"], `${seed}:emotion`);
    if (t) parts.push(t.replace("{label}", s.emotion.label).replace("{about}", s.emotion.phrase ?? ""));
  }
  for (const dim of DIMS) {
    const b = band(s[dim], cfg.bands[dim]);
    if (b === "neutral") continue;
    const p = pick(phrases[`${dim} ${b}`], `${seed}:${dim}`);
    if (p) parts.push(p);
  }
  for (const need of NEEDS) {
    if (band(s.needs[need], cfg.bands.needs) !== "low") continue;
    const p = pick(phrases[`${need} low`], `${seed}:${need}`);
    if (p) parts.push(p);
  }
  return parts.length ? parts.join(" ") : null;
}
```

`loadCoreStateLine` passes `{ ...moodOf(row), emotion: row.emotion, needs: row.needs }`. Update the header to mention the feeling and needs.

- [ ] **Step 7: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: PASS (all files).

- [ ] **Step 8: Commit**

```bash
pnpm format
git add prompts src config tests evals
git commit -m "feat(core): needs deplete, feelings fade, and both reach the feeling line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: LLM appraisal (`core_appraise`)

**Files:**
- Modify: `src/mind/process/core/appraise.ts` (rewrite), `src/mind/process/core/world-tick.ts` (`appraiseDue`), `src/mind/world/types.ts`, `src/db/repos/core/world.ts`, `src/mind/state/core/core-state.ts` (`applyEvent` arousal), `src/mind/platform/llm/fake.ts`, `config/default.json`, `src/mind/platform/config.ts`
- Create: `prompts/core/appraise/v1.md`
- Test: `tests/mind/process/core/appraise-propose.test.ts` (new), `tests/mind/process/core/appraise.test.ts` (rewritten for `applyAppraisal`), `tests/mind/process/core/world-tick.test.ts`

**Interfaces:**
- Consumes: runner (Task 2), goals (Task 5), needs/emotion (Task 6).
- Produces (in `appraise.ts`):
  ```ts
  export const AppraisalSchema: z.ZodType<RawAppraisal>;
  export type Appraisal = {
    source: "model" | "fallback";
    episode: string;
    emotion: { label: string; valence: number; arousal: number; phrase: string | null };
    salience: number;
    goalEffects: { goalId: string; delta: number }[];
    needEffects: CoreNeeds; // deltas
  };
  export type LandingEvent = {
    worldEventId: string; kind: "planned" | "surprise" | "resolution"; content: string;
    valence: number; stakes: "low" | "high"; at: Date; agents: string[]; goalRef: string | null;
  };
  export function boundAppraisal(raw: RawAppraisal, goalIds: Set<string>, cfg: Config["core"]): Appraisal | null;
  export function codeAppraisal(event: LandingEvent, cfg: Config["core"]): Appraisal;
  export async function proposeAppraisal(ctx: LoopContext, event: LandingEvent): Promise<Appraisal>;
  export async function applyAppraisal(core: CoreScope, deps: Pick<CoreDeps, "config">, event: LandingEvent, a: Appraisal, embedding: number[], now: Date): Promise<{ episodeId: string; intentionId: string | null }>;
  export const eventRef: (worldEventId: string) => string; // unchanged
  ```
  - `WorldEventRow` gains `goal_ref: string | null`; `World.setGoalRef(id: string, goalId: string): Promise<void>`.
  - `applyEvent(s, valence, cfg, arousal = Math.abs(valence))`.
  - Fake purpose `core_appraise` (default: the event's own content and valence).
  - Trace loop `core_appraise` (replaces `core_appraise_due`).
  - Config `core.appraise` (below); `prompts.core_appraise: "v1"`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mind/process/core/appraise-propose.test.ts`:

```ts
/**
 * Proposing an appraisal: the model's reading of an event, bounded in code. Bad numbers are
 * clamped, unknown goals dropped, an unusable answer or a failed call falls back to the code
 * appraisal, and over budget the model isn't called at all.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { coreDepsOf } from "@/mind/platform/deps";
import {
  boundAppraisal,
  codeAppraisal,
  proposeAppraisal,
  type LandingEvent,
} from "@/mind/process/core/appraise";
import { runCoreLoop } from "@/mind/process/core/runner";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { sequence } from "../../../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

const cfg = loadConfig().core;
const now = new Date("2026-01-05T09:00:00Z");
const event: LandingEvent = {
  worldEventId: "00000000-0000-0000-0000-000000000001",
  kind: "planned",
  content: "Spica got the telescope images.",
  valence: 0.6,
  stakes: "low",
  at: now,
  agents: [],
  goalRef: null,
};
const raw = (over: object = {}) => ({
  episode: "Spica finally got the telescope images and grinned at them for an hour.",
  emotion: { label: "giddy", valence: 0.7, arousal: 0.8, about: "the images" },
  salience: "high",
  goal_effects: [],
  need_effects: { autonomy: 1, competence: 0 },
  ...over,
});

test("bounds every number and maps words to config values", () => {
  const goal = "11111111-1111-1111-1111-111111111111";
  const a = boundAppraisal(
    raw({
      emotion: { label: "  Giddy ", valence: 3, arousal: -2, about: "" },
      goal_effects: [
        { goal_id: goal, effect: "block", size: "large" },
        { goal_id: goal, effect: "advance", size: "small" },
        { goal_id: "not-a-goal", effect: "advance", size: "small" },
      ],
      need_effects: { autonomy: 5, competence: -0.2 },
    }),
    new Set([goal]),
    cfg,
  )!;
  expect(a.source).toBe("model");
  expect(a.emotion).toEqual({ label: "giddy", valence: 1, arousal: 0, phrase: null });
  expect(a.salience).toBe(cfg.appraise.salience.high);
  expect(a.goalEffects).toEqual([{ goalId: goal, delta: -cfg.goals.step.large }]);
  expect(a.needEffects).toEqual({
    autonomy: cfg.appraise.need_gain,
    competence: -cfg.appraise.need_gain,
  });
});

test("an empty or overlong episode, or a NaN valence, is unusable", () => {
  expect(boundAppraisal(raw({ episode: "  " }), new Set(), cfg)).toBeNull();
  expect(
    boundAppraisal(raw({ episode: "x".repeat(cfg.appraise.episode_max_chars + 1) }), new Set(), cfg),
  ).toBeNull();
  expect(
    boundAppraisal(
      raw({ emotion: { label: "x", valence: Number.NaN, arousal: 0.5, about: "" } }),
      new Set(),
      cfg,
    ),
  ).toBeNull();
});

test("the code appraisal keeps the event's own words and valence", () => {
  const a = codeAppraisal({ ...event, valence: -0.5 }, cfg);
  expect(a).toMatchObject({
    source: "fallback",
    episode: event.content,
    emotion: { label: cfg.appraise.fallback_labels.negative, valence: -0.5, arousal: 0.5, phrase: null },
    salience: cfg.world.event_salience,
    goalEffects: [],
    needEffects: { autonomy: 0, competence: 0 },
  });
});

async function propose(deps: ReturnType<typeof makeTestDeps>) {
  let out: Awaited<ReturnType<typeof proposeAppraisal>> | null = null;
  await runCoreLoop(coreDepsOf(deps), "core_appraise", now, async (ctx) => {
    out = await proposeAppraisal(ctx, event);
    return { inputs: {}, outputs: {} };
  });
  return out!;
}

test("the model's appraisal is used; its prompt holds her goals and what she expected", async () => {
  const deps = makeTestDeps();
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  const goal = await deps.core.goals.insert({
    title: "Learn the winter constellations",
    why: "Orion",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    embedding: vec(),
  });
  await deps.core.memory.insert({
    kind: "intention",
    content: "Spica is counting the hours until the telescope images.",
    embedding: vec(),
    occurred_at: now,
    created_at: now,
    status: "open",
    salience: 0.4,
    valence: 0.6,
    confidence: 1,
    source: "world",
    source_ref: `world_event:${event.worldEventId}`,
  });
  deps.llm.handlers.core_appraise = sequence(
    raw({ goal_effects: [{ goal_id: goal, effect: "advance", size: "medium" }] }),
  );
  const a = await propose(deps);
  expect(a.source).toBe("model");
  expect(a.goalEffects).toEqual([{ goalId: goal, delta: deps.config.core.goals.step.medium }]);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "core_appraise")!;
  expect(call.input).toContain(goal);
  expect(call.input).toContain("Learn the winter constellations");
  expect(call.input).toContain("counting the hours until the telescope images");
});

test("a failed or unusable model answer falls back to the code appraisal", async () => {
  const deps = makeTestDeps();
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  deps.llm.handlers.core_appraise = sequence(new Error("timeout"));
  expect((await propose(deps)).source).toBe("fallback");
  deps.llm.handlers.core_appraise = sequence(raw({ episode: "" }));
  expect((await propose(deps)).source).toBe("fallback");
});

test("over budget the model isn't called", async () => {
  const deps = makeTestDeps({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  expect((await propose(deps)).source).toBe("fallback");
  expect(deps.llm.structuredCalls.filter((c) => c.purpose === "core_appraise")).toEqual([]);
});
```

Rewrite `tests/mind/process/core/appraise.test.ts` for `applyAppraisal`. Keep its six existing tests, changing each call from

```ts
appraiseEvent(tx, deps, { ...event, valence: V, stakes: S }, now)
```
to
```ts
applyAppraisal(tx, deps, { ...event, valence: V, stakes: S }, codeAppraisal({ ...event, valence: V, stakes: S }, deps.config.core), vec(0.01), now)
```

where `event` is now a `LandingEvent` (`base` gains `kind: "planned"`, `valence: 0.8`, `stakes: "high"`, `goalRef: null` and loses `embedding`), and `setup` ensures state with `baselineNeeds(deps.config.core.state)`. Then append:

```ts
test("the appraised feeling, needs and goal progress are applied, and a goal at 1 is done", async () => {
  const { deps, event } = await setup();
  const goal = await deps.core.goals.insert({
    title: "Finish the list",
    why: "w",
    status: "active",
    progress: 0.95,
    source: "seed",
    source_ref: null,
    started_at: earlier,
    target_at: null,
    embedding: vec(),
  });
  const appraisal = {
    source: "model" as const,
    episode: "Spica finished the last film on her list and sat with the credits.",
    emotion: { label: "proud", valence: 0.7, arousal: 0.4, phrase: "the list" },
    salience: 0.6,
    goalEffects: [{ goalId: goal, delta: 0.1 }],
    needEffects: { autonomy: 0, competence: 0.15 },
  };
  const before = (await deps.core.state.get())!;
  const out = await deps.core.transaction((tx) =>
    applyAppraisal(tx, deps, { ...event, valence: 0.1, stakes: "low" }, appraisal, vec(0.01), now),
  );
  const episode = (await deps.core.memory.get(out.episodeId))!;
  expect(episode).toMatchObject({ content: appraisal.episode, valence: 0.7, salience: 0.6 });
  const state = (await deps.core.state.get())!;
  expect(state.emotion).toEqual({
    label: "proud",
    valence: 0.7,
    arousal: 0.4,
    phrase: "the list",
    about: out.episodeId,
    since: now.toISOString(),
  });
  expect(state.needs.competence).toBeCloseTo(before.needs.competence + 0.15);
  // The appraised valence (0.7), not the event's (0.1), moves her mind.
  expect(state.preoccupation).toBe(out.episodeId);
  expect(await deps.core.goals.get(goal)).toMatchObject({ progress: 1, status: "done" });
  const [stored] = await deps.core.world.events("2026-01-05");
  expect(stored!.goal_ref).toBe(goal);
});
```

In `tests/mind/process/core/world-tick.test.ts`, the trace check in "at its time a later hourly run…" becomes `eq(core_loop_trace.loop, "core_appraise")`, and also expects `traces[0]).toMatchObject({ status: "done", calls: 1 })`. Append:

```ts
test("an appraisal call that fails still lands the event, traced as fallback", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence(planned(0.3));
  deps.llm.handlers.core_appraise = sequence(new Error("model down"));
  await coreWorldTick(coreDepsOf(deps), morning);
  const landed = new Date(eventTime.getTime() + 10 * 60_000);
  expect((await coreWorldTick(coreDepsOf(deps), landed)).appraised).toBe(1);
  const episode = (await memories(deps)).find((m) => m.kind === "episode")!;
  expect(episode.content).toBe("Spica rewatched Solaris with Alcor.");
  const [trace] = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "core_appraise"));
  expect(trace).toMatchObject({ status: "fallback", calls: 1 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/mind/process/core`
Expected: FAIL (missing exports).

- [ ] **Step 3: Config and prompt**

`config/default.json`: `prompts.core_appraise: "v1"`; `core.appraise`:

```json
"appraise": {
  "max_tokens": 800,
  "episode_max_chars": 400,
  "label_max_chars": 40,
  "about_max_chars": 80,
  "salience": { "low": 0.3, "medium": 0.4, "high": 0.6 },
  "need_gain": 0.15,
  "fallback_band": [-0.2, 0.3],
  "fallback_labels": { "negative": "upset", "neutral": "calm", "positive": "pleased" }
}
```

`config.ts`: `prompts` gains `core_appraise: promptVersion`; `core` gains

```ts
      appraise: z.object({
        max_tokens: positiveInt,
        episode_max_chars: positiveInt,
        label_max_chars: positiveInt,
        about_max_chars: positiveInt,
        salience: z.object({ low: unit, medium: unit, high: unit }),
        need_gain: unit,
        fallback_band: band,
        fallback_labels: z.object({ negative: text, neutral: text, positive: text }),
      }),
```

(`band` is declared above `coreState`; move the `core` object below it if needed.)

Create `prompts/core/appraise/v1.md`:

```markdown
# How it landed (v1)

Something just happened in Spica's life. The persona above is who she is and who she's been lately. The input has the event, what she expected (if she'd planned it), how she is right now, and her goals with their ids.

Write how it landed with her, as she'll remember it. The same event lands differently depending on her state and what she hoped for: a plan that went fine can still disappoint if she wanted more from it; a small surprise can matter a lot on a flat day.

Return:
- episode: the memory, one or two sentences in the third person and the past tense, starting "Spica …". Keep the facts of the event; add how it felt to her. Never contradict the event.
- emotion: her feeling right now. `label` is one or two plain words ("giddy", "let down", "quietly pleased"). `valence` from -1 (bad) to 1 (good). `arousal` from 0 (calm) to 1 (stirred up). `about` is a short phrase for what it's about ("the telescope images"), or "" if it's just a mood.
- salience: "low" (she'll forget it in a week), "medium", or "high" (she'll think about it for days). Most things are low.
- goal_effects: for each of her goals this event clearly moved, its `goal_id` exactly as given, `effect` "advance" or "block", and `size` "small", "medium" or "large". Usually none; never invent a goal.
- need_effects: `autonomy` (did she get to do something of her own choosing?) and `competence` (did she get better at or finish something?): 1 if the event fed that need, -1 if it thwarted it, 0 otherwise.
```

- [ ] **Step 4: World row `goal_ref` and `setGoalRef`**

`src/mind/world/types.ts`: `WorldEventRow` gains `goal_ref: string | null;`; `World` gains `setGoalRef(id: string, goalId: string): Promise<void>;`.
`src/db/repos/core/world.ts`: `toRow` adds `goal_ref: r.goal_ref,`; add

```ts
    async setGoalRef(id, goalId) {
      await db.update(world_event).set({ goal_ref: goalId }).where(eq(world_event.id, id));
    },
```

`src/mind/state/core/core-state.ts`: `applyEvent(s, valence, cfg, arousal = Math.abs(valence))` uses `cfg.event_arousal_gain * arousal`.

- [ ] **Step 5: Rewrite `appraise.ts`**

```ts
/**
 * Appraisal: how an event in her world lands with her, at the moment it happens. A model reads the
 * event against what she expected, how she is and what she's working towards, and says how it
 * felt, how much it matters, and which goals and needs it touched. Code bounds every number before
 * anything moves; a failed or unusable answer, or no budget left, falls back to the event's own
 * valence, so an event always lands. The same event can be remembered differently on a different
 * day: the episode is written in her appraisal's words.
 */
import { z } from "zod";
import type { Config } from "@/mind/platform/config";
import type { CoreScope } from "@/mind/platform/core";
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { applyEvent, moodOf } from "@/mind/state/core/core-state";
import type { CoreNeeds, CoreStatePatch } from "@/mind/state/core/types";
import type { LoopContext } from "./runner";

/** Sent to the model. No numeric bounds (unsupported); `boundAppraisal` clamps. */
export const AppraisalSchema = z.object({
  episode: z.string(),
  emotion: z.object({
    label: z.string(),
    valence: z.number(),
    arousal: z.number(),
    about: z.string(),
  }),
  salience: z.enum(["low", "medium", "high"]),
  goal_effects: z.array(
    z.object({
      goal_id: z.string(),
      effect: z.enum(["advance", "block"]),
      size: z.enum(["small", "medium", "large"]),
    }),
  ),
  need_effects: z.object({ autonomy: z.number(), competence: z.number() }),
});
export type RawAppraisal = z.infer<typeof AppraisalSchema>;

export type Appraisal = {
  source: "model" | "fallback";
  episode: string;
  emotion: { label: string; valence: number; arousal: number; phrase: string | null };
  salience: number;
  goalEffects: { goalId: string; delta: number }[];
  /** Deltas, already scaled. */
  needEffects: CoreNeeds;
};

export type LandingEvent = {
  worldEventId: string;
  kind: "planned" | "surprise" | "resolution";
  content: string;
  valence: number;
  stakes: "low" | "high";
  at: Date;
  agents: string[];
  goalRef: string | null;
};

export const eventRef = (worldEventId: string) => `world_event:${worldEventId}`;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
const NO_NEEDS: CoreNeeds = { autonomy: 0, competence: 0 };

export function boundAppraisal(
  raw: RawAppraisal,
  goalIds: Set<string>,
  cfg: Config["core"],
): Appraisal | null {
  const a = cfg.appraise;
  const episode = tidy(raw.episode);
  const label = tidy(raw.emotion.label).toLowerCase();
  const phrase = tidy(raw.emotion.about);
  const { valence, arousal } = raw.emotion;
  if (!episode || episode.length > a.episode_max_chars) return null;
  if (!label || label.length > a.label_max_chars) return null;
  if (!Number.isFinite(valence) || !Number.isFinite(arousal)) return null;

  const seen = new Set<string>();
  const goalEffects: Appraisal["goalEffects"] = [];
  for (const g of raw.goal_effects) {
    if (!goalIds.has(g.goal_id) || seen.has(g.goal_id)) continue;
    seen.add(g.goal_id);
    const step = cfg.goals.step[g.size];
    goalEffects.push({ goalId: g.goal_id, delta: g.effect === "block" ? -step : step });
  }
  const need = (x: number) => (Number.isFinite(x) ? Math.sign(x) * a.need_gain : 0);
  return {
    source: "model",
    episode,
    emotion: {
      label,
      valence: clamp(valence, -1, 1),
      arousal: clamp(arousal, 0, 1),
      phrase: phrase && phrase.length <= a.about_max_chars ? phrase : null,
    },
    salience: a.salience[raw.salience],
    goalEffects,
    needEffects: {
      autonomy: need(raw.need_effects.autonomy),
      competence: need(raw.need_effects.competence),
    },
  };
}

/** The event's own valence is the appraisal: what she had before the model, kept as the fallback. */
export function codeAppraisal(event: LandingEvent, cfg: Config["core"]): Appraisal {
  const [lo, hi] = cfg.appraise.fallback_band;
  const labels = cfg.appraise.fallback_labels;
  const label =
    event.valence <= lo ? labels.negative : event.valence >= hi ? labels.positive : labels.neutral;
  return {
    source: "fallback",
    episode: event.content,
    emotion: { label, valence: event.valence, arousal: Math.abs(event.valence), phrase: null },
    salience: cfg.world.event_salience,
    goalEffects: [],
    needEffects: NO_NEEDS,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Outside any transaction: one model call, bounded, or the code appraisal. Never throws. */
export async function proposeAppraisal(ctx: LoopContext, event: LandingEvent): Promise<Appraisal> {
  const { deps } = ctx;
  const { config, core, log } = deps;
  if (!ctx.canCall()) return codeAppraisal(event, config.core);
  try {
    const persona = loadPersona(config);
    const self = (await core.memory.latestSnapshot())?.content ?? persona.seedSelf;
    const expected = await core.memory.bySourceRef("intention", eventRef(event.worldEventId));
    const state = await core.state.get();
    const goals = await core.goals.active();
    const input = [
      `Event (${event.kind}, ${event.stakes} stakes): ${event.content}`,
      `How it went on the surface: valence ${event.valence.toFixed(2)}`,
      `What she expected: ${expected ? expected.content : "nothing; she didn't see it coming"}`,
      state
        ? `How she is right now: mood ${state.mood_valence.toFixed(2)}, energy ${state.energy.toFixed(2)}, ` +
          `autonomy ${state.needs.autonomy.toFixed(2)}, competence ${state.needs.competence.toFixed(2)}` +
          (state.emotion ? `, feeling ${state.emotion.label}` : "")
        : "How she is right now: unknown",
      goals.length
        ? `Her goals:\n${goals.map((g) => `- [${g.id}] ${g.title} (${pct(g.progress)} there): ${g.why}`).join("\n")}`
        : "Her goals: none right now.",
    ].join("\n\n");
    const raw = await deps.llm.classifyJson({
      purpose: "core_appraise",
      model: "core",
      system: [persona.coreValues, self, loadPrompt("core/appraise", config.prompts.core_appraise)].join("\n\n"),
      input,
      schema: AppraisalSchema,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: config.core.appraise.max_tokens,
    });
    const bounded = boundAppraisal(raw, new Set(goals.map((g) => g.id)), config.core);
    if (bounded) return bounded;
    log.error("core appraisal unusable", { worldEventId: event.worldEventId });
  } catch (error) {
    log.error("core appraisal failed", { worldEventId: event.worldEventId, error: errorName(error) });
  }
  return codeAppraisal(event, config.core);
}

/** Inside the caller's transaction, which holds the world tick's lock. */
export async function applyAppraisal(
  core: CoreScope,
  deps: Pick<CoreDeps, "config">,
  event: LandingEvent,
  a: Appraisal,
  embedding: number[],
  now: Date,
): Promise<{ episodeId: string; intentionId: string | null }> {
  const { world, state } = deps.config.core;
  const ref = eventRef(event.worldEventId);
  const episodeId = await core.memory.insert({
    kind: "episode",
    content: a.episode,
    embedding,
    entity_refs: event.agents,
    occurred_at: event.at,
    created_at: now,
    // A big event stays open until its story resolves; a small one is over when it happens.
    status: event.stakes === "high" ? "open" : "resolved",
    salience: a.salience,
    valence: a.emotion.valence,
    confidence: world.event_confidence,
    source: "world",
    source_ref: ref,
  });

  // Once it has happened the episode speaks for it; the plan stays only as history.
  const intention = await core.memory.bySourceRef("intention", ref);
  if (intention) await core.memory.setStatus(intention.id, "resolved");

  for (const g of a.goalEffects) {
    const goal = await core.goals.get(g.goalId);
    if (!goal || goal.status !== "active") continue;
    const progress = clamp(goal.progress + g.delta, 0, 1);
    await core.goals.setProgress(goal.id, progress, now);
    if (progress >= 1) await core.goals.setStatus(goal.id, "done", now);
  }
  const firstGoal = a.goalEffects[0];
  if (firstGoal && !event.goalRef) await core.world.setGoalRef(event.worldEventId, firstGoal.goalId);

  const row = await core.state.lock();
  const mood = applyEvent(moodOf(row), a.emotion.valence, state, a.emotion.arousal);
  const strong = Math.abs(a.emotion.valence) >= state.preoccupation_min_valence;
  let preoccupation: CoreStatePatch = {};
  if (strong) preoccupation = { preoccupation: episodeId, preoccupation_since: now };
  else if (intention && row.preoccupation === intention.id)
    preoccupation = { preoccupation: null, preoccupation_since: null };
  await core.state.update({
    ...mood,
    ...preoccupation,
    needs: {
      autonomy: clamp(row.needs.autonomy + a.needEffects.autonomy, 0, 1),
      competence: clamp(row.needs.competence + a.needEffects.competence, 0, 1),
    },
    emotion: { ...a.emotion, about: episodeId, since: now.toISOString() },
  });

  await core.world.markAppraised(event.worldEventId, now);
  return { episodeId, intentionId: intention?.id ?? null };
}
```

- [ ] **Step 6: `appraiseDue` through the runner**

In `world-tick.ts` replace `appraiseDue`:

```ts
/** Lands every event whose time has come. Returns how many landed in this run. */
async function appraiseDue(deps: CoreDeps, now: Date): Promise<number> {
  const { core, config } = deps;
  const pending = await core.world.dueUnappraised(now);
  if (!pending.length) return 0;
  await core.state.ensure(config.core.state.baseline, baselineNeeds(config.core.state));

  const run = await runCoreLoop(deps, "core_appraise", now, async (ctx) => {
    // Model and embedder calls run before the transaction; the apply re-checks under the lock.
    const proposals = new Map<string, Appraisal>();
    for (const e of pending) proposals.set(e.id, await proposeAppraisal(ctx, landing(e)));
    const vectors = await ctx.deps.embedder.embed(
      pending.map((e) => proposals.get(e.id)!.episode),
      "document",
    );
    const embeddings = new Map(pending.map((e, i) => [e.id, vectors[i]]));

    const out = await core.transaction(async (tx) => {
      await tx.lock(LOCK);
      const episodes: string[] = [];
      const resolved: string[] = [];
      const landed: string[] = [];
      // Re-read under the lock: another run may have landed some of these already.
      for (const event of await tx.world.dueUnappraised(now)) {
        const embedding = embeddings.get(event.id);
        const appraisal = proposals.get(event.id);
        // Became due after the proposals (a concurrent generation); the next run takes it.
        if (!embedding || !appraisal) continue;
        const agents = event.agent_names.length
          ? await tx.memory.addEntities(event.agent_names, config.core.world.entity_salience, now)
          : event.agents;
        await tx.world.setAgents(event.id, agents);
        const r = await applyAppraisal(tx, deps, { ...landing(event), agents }, appraisal, embedding, now);
        landed.push(event.id);
        episodes.push(r.episodeId);
        if (r.intentionId) resolved.push(r.intentionId);
      }
      return { landed, episodes, resolved_intentions: resolved };
    });
    const fellBack = [...proposals.values()].some((p) => p.source === "fallback");
    return {
      status: fellBack ? "fallback" : "done",
      inputs: { world_events: pending.map((e) => e.id) },
      outputs: out,
      promptVersion: config.prompts.core_appraise,
    };
  });
  return run.outputs?.landed.length ?? 0;
}

const landing = (e: WorldEventRow): LandingEvent => ({
  worldEventId: e.id,
  kind: e.kind,
  content: e.content,
  valence: e.valence,
  stakes: e.stakes,
  at: e.at,
  agents: e.agents,
  goalRef: e.goal_ref,
});
```

Imports: `applyAppraisal, eventRef, proposeAppraisal, type Appraisal, type LandingEvent` from `./appraise`; `type WorldEventRow` from `@/mind/world/types`; `baselineNeeds` from `@/mind/state/core/core-state`. Remove the old `appraiseEvent` import and the `core_appraise_due` trace. In the file header, change "appraisal writes the episode" to "appraisal (a budgeted model call, with a code fallback) writes the episode in its own words".

- [ ] **Step 7: Fake model**

In `src/mind/platform/llm/fake.ts` handlers, add a default that keeps fake mode's episodes the event's own words:

```ts
    // Echoes the event, so fake-mode episodes keep the generator's words and valence.
    core_appraise: (input: string) => {
      const content = /^Event \([^)]*\): (.*)$/m.exec(input)?.[1] ?? "Spica had an ordinary day.";
      const valence = Number(/valence (-?\d+(?:\.\d+)?)/.exec(input)?.[1] ?? 0);
      return {
        episode: content,
        emotion: { label: valence < 0 ? "upset" : "pleased", valence, arousal: Math.abs(valence), about: "" },
        salience: "medium",
        goal_effects: [],
        need_effects: { autonomy: 0, competence: 0 },
      };
    },
```

The event's valence is printed with two decimals, so the fake round-trips it exactly for the values the tests use (0.3, 0.8, 0.9, -0.5).

- [ ] **Step 8: Run tests**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. If a test elsewhere checks episode salience equal to `event_salience` (0.4), it still passes: the fake says `medium` (0.4).

- [ ] **Step 9: Commit**

```bash
pnpm format
git add prompts src config tests
git commit -m "feat(core): appraisal is a budgeted model call bounded in code, with the code fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Canary, evals, paperwork

**Files:**
- Modify: `tests/helpers/llm.ts`, `tests/exit/mind-split.test.ts`, `evals/lib/runner.ts` (if it builds `SeedDeps` without an embedder), `spica-design-spec-v3.md`, `DECISIONS.md`
- Test: `tests/exit/mind-split.test.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Extend the canary**

In `tests/helpers/llm.ts` `CapturingLLM.classifyJson`, before the final `return super.classifyJson(request)`:

```ts
    if (canary && request.purpose === "core_appraise" && handler) {
      const out = (await handler(request.input)) as { episode: string; emotion: { label: string } };
      return request.schema.parse({
        ...out,
        episode: `${out.episode} ${canary}`,
        emotion: { ...out.emotion, label: `${out.emotion.label} ${canary}` },
      });
    }
```

Update the class doc comment's list ("…a plan label, an event and its thought, an appraisal's episode and feeling…").

In `tests/exit/mind-split.test.ts`: add `"core_goal"` to the scanned core tables list (near line 32), and add `"core_appraise"` to the list of core prompt purposes whose captured text must not contain the canary (the same list that holds `life_plan` and `life_event`). If the test asserts on `core_appraise_due`, rename it to `core_appraise`.

- [ ] **Step 2: Run the canary and the whole suite**

Run: `pnpm test`
Expected: PASS, including `tests/exit/mind-split.test.ts`.

Run: `pnpm eval --llm=fake --compare`
Expected: no regressions against `evals/baseline.json`. If a `core` assertion's numbers moved only because `life_event` and appraisal now trace under new loop names, update the check in `evals/lib/core-check.ts`, not the baseline.

- [ ] **Step 3: v3 and DECISIONS**

`spica-design-spec-v3.md`:
- §6.2: `core_goal` (Built) with its columns; `core_state.emotion` nullable `{label, valence, arousal, phrase, about, since}`, `needs` `{autonomy, competence}`; `core_loop_trace` gains `calls`, `status` (`done | fallback | skipped_budget | failed`), `error`; `world_event.goal_ref` → `core_goal`.
- §7.2 / §7.1: the persona is `prompts/persona/v5.md`; the seed self has `### Goals` (`- title: why`), seeded into `core_goal`.
- §8.2: needs deplete (`need_decay_per_day`), `needs_baseline`, `emotion_hours`, `bands.needs`, the line `prompts/core-state/line/v3.md` with emotion and need phrases. Remove "Needs and goal progress are not built yet."
- §8.3: the appraisal paragraph: `core_appraise` (Haiku, `prompts/core/appraise/v1.md`) replaces the code stand-in; code bounds (`core.appraise.*`); fallback; trace `core_appraise`. `life_plan` on `CoreDeps` (`World.plansBefore`, `insertPlan`). Event generation is a budgeted `life_event` run; over budget, no event that day.
- §8.5 table: `core_appraise` row → Built (LLM, fallback).
- §15: `core.daily_call_budget` 24, `core.budget_reserve` 8, `core.loop_priority` `{essential, optional}`, `core.prices`; how the budget is counted (her local day, summed trace `calls`).
- §25: B50 done.

`DECISIONS.md` rows (date 2026-10-02):
- "The budget check is a plain read of today's summed trace `calls`, without a lock across the run | Core jobs run at different minutes of the hour, and a rare one-call overshoot costs cents; holding a lock across a model call would serialise every core job."
- "Core model calls are metered by wrapping the LLM in the runner (`ClassifyRequest.onUsage`) | Loops stay unaware of the budget except through `canCall()`, and the count includes retries and reconcile calls."
- "Event generation over budget marks the day done with no event | Otherwise every hourly run would try again and overshoot."
- "Appraisal's input prints the event's surface valence; the fake echoes it | Fake mode keeps the generator's words and mood maths, so earlier evals hold."
- "Placeholder seed goals ship in persona v5 | Ethan writes the real ones."
- "The migration nulls the old placeholder emotion (`label = neutral`) | A neutral placeholder would read as a feeling in the line."

- [ ] **Step 4: Final verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS. Record the file and test counts for the summary.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add tests spica-design-spec-v3.md DECISIONS.md evals
git commit -m "docs: record the budgeted runner, goals, needs and LLM appraisal in v3; canary covers appraisal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
