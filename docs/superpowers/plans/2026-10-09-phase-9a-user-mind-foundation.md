# Phase 9a: User Mind Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A big event in an exchange becomes exactly one durable, capped `user_mind_run` that runs `user_summarise`, whose summary she reads in her next reply.

**Architecture:** The cold path (and the relationship daily tick) detect big events with a pure function, insert a `user_mind_run` row in their own transaction, and enqueue the job after commit; `cold_path_sweep` re-enqueues lost `pending` rows. The worker claims the row atomically, runs `user_summarise` through a metered, traced `runUserLoop` (sharing the core runner's metering helpers), writes a `summary` fact that supersedes the previous one, and the reply assembly renders it as "Where things stand with them".

**Tech Stack:** TypeScript, Drizzle + Postgres 16 (pgvector), pg-boss, zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-09-phase-9a-user-mind-foundation-design.md` (read it first). Project rules: `CLAUDE.md`, `spica-design-spec-v3.md`.

## Global Constraints

- `src/mind` is framework-free: no Next imports, no `Date.now()` / `new Date()` with no args, no `process.env`; time comes from the injected `Clock`.
- Every numeric constant in `config/default.json`, validated in `src/mind/platform/config.ts`.
- Every prompt is a versioned file under `prompts/` with hyphenated paths; this phase adds `prompts/user-mind/summarise/v1.md`.
- Comments say why, never cite spec sections, phases or review items. Every new file starts with a short plain-English header.
- Timestamps are written from the clock, never `DEFAULT now()`.
- Drizzle property names for domain tables are snake_case.
- Prettier at 100 columns; `pnpm lint` must pass.
- User loops never get the `core` layer (they can't write core); no user-scoped row ever reaches a core loop.
- A crisis exchange records no run.
- Traces store ids and error classes only, never content.
- Tests need the test DB: `pnpm db:up` once; tests migrate their own DB.
- Commit after each task with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A summary fact leaking into ordinary memory paths.** Extraction makes `shared` facts; reconcile must never merge or supersede a new fact into a summary (and vice versa), retrieval must not list it under "Between you", decay must not stale it. Pinned in Task 2.
2. **A cold path retried after its run row committed.** The retry must not create a second run nor a second enqueue that runs twice. Pinned in Task 7 (retry test) and Task 6 (claim of a non-pending run is a no-op).
3. **A user with no valid timezone.** The cap's local date must fall back to UTC, not throw. Pinned in Task 1.
4. **The model returns malformed or overlong summary output.** Overlong parts are fitted; empty or wrongly shaped output fails the loop, writes nothing, keeps the old summary. Pinned in Task 5.
5. **The user deletes the live summary in the memory view.** The next run must still write a fresh summary (nothing to supersede) and replies must simply skip the slot meanwhile. Pinned in Task 5 and Task 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema.ts` (modify) | `fact_kind` + `summary`; `user_mind_run_status` enum; `user_mind_run`, `user_loop_trace` tables |
| `src/db/migrations/0024_user_mind.sql` (generated) | the migration |
| `src/db/repos/user/user-mind.ts` (create) | per-user run rows, loop traces, live summary read/write |
| `src/db/repos/admin/user-mind.ts` (create) | cross-user: stale `pending` runs for the sweep |
| `src/db/repos/user/facts.ts`, `src/db/repos/admin/decay.ts` (modify) | exclude `summary` |
| `src/mind/platform/config.ts`, `config/default.json` (modify) | `user_mind` section, `models.user_mind`, `prompts.user_summarise` |
| `src/mind/platform/llm/meter.ts` (create) | metering + cost helpers shared by both runners |
| `src/mind/platform/llm/types.ts`, `anthropic.ts`, `fake.ts` (modify) | `user_mind` model role; fake `user_summarise` |
| `src/mind/platform/jobs.ts` (modify) | `USER_MIND_RUN_QUEUE`, `UserMindRunJob` |
| `src/mind/process/user/big-events.ts` (create) | pure trigger detection |
| `src/mind/process/user/runner.ts` (create) | `runUserLoop` |
| `src/mind/process/user/summarise.ts` (create) | the `user_summarise` loop |
| `src/mind/process/user/run.ts` (create) | `recordBigEvents`, `runUserMind`, `sweepPendingUserMindRuns` |
| `src/mind/process/core/runner.ts` (modify) | use `meter.ts` |
| `src/mind/process/cold-path/cold-path.ts`, `sweep.ts` (modify) | detect, record, enqueue; sweep pending runs |
| `src/mind/state/user/relationship/update.ts`, `daily-tick.ts` (modify) | return before/after; tick records band crossings |
| `src/mind/memory/user/encode.ts` (modify) | report inserted saliences |
| `src/mind/process/hot-path/assemble.ts`, `compose.ts` (modify) | summary slot |
| `src/worker/user-mind-jobs.ts` (create), `src/worker/index.ts` (modify) | job registration |
| `evals/lib/scheduler.ts`, `evals/lib/profile.ts`, `evals/scripts/user-mind-week.yaml`, `package.json` (modify/create) | eval drain, real purpose, `exit:user` |
| `tests/...` | per task |
| `spica-design-spec-v3.md`, `DECISIONS.md`, `CLAUDE.md` (modify) | docs |

---

### Task 1: Schema, migration, config and the user-mind repo

**Files:**
- Modify: `src/db/schema.ts`, `config/default.json`, `src/mind/platform/config.ts`
- Create: `src/db/repos/user/user-mind.ts`, `src/db/repos/admin/user-mind.ts`
- Generated: `src/db/migrations/0024_user_mind.sql` (+ meta)
- Test: `tests/db/user-mind-repos.test.ts`

**Interfaces:**
- Produces:
  - Schema: `user_mind_run`, `user_loop_trace`, `userMindRunStatus` enum; `factKind` includes `"summary"`.
  - `Config["user_mind"]`: `{ max_triggers_per_day: number; sweep_after_minutes: number; triggers: { param_jump: number; bands: number[]; fact_salience: number }; summarise: { max_facts: number; max_threads: number; max_chars: number; max_tokens: number; salience: number } }`; `config.models.user_mind: string`; `config.prompts.user_summarise: string`.
  - `src/db/repos/user/user-mind.ts`:
    - `type UserMindRunRow = typeof user_mind_run.$inferSelect`
    - `type Trigger = { kind: "param_jump" | "param_band"; param: string; from: number; to: number } | { kind: "salient_fact"; salience: number } | { kind: "make_up_done" }`
    - `insertRun(db, userId, { sourceRef, triggers, localDate, now, cap }): Promise<UserMindRunRow | null>` — null when `(user_id, source_ref)` already exists; status `capped` when `cap` non-capped runs exist on `localDate`.
    - `claimRun(db, runId): Promise<UserMindRunRow | null>` — `pending → running`, null otherwise.
    - `finishRun(db, runId, status: "done" | "failed", now): Promise<void>`
    - `insertLoopTrace(db, row: NewUserLoopTrace): Promise<void>` where `NewUserLoopTrace = typeof user_loop_trace.$inferInsert`
    - `liveSummary(db, userId): Promise<FactRow | null>` — the newest `kind = 'summary'` fact not superseded/stale.
    - `userLocalDate(db, userId, now): Promise<string>` — the user's local date, UTC when the zone is missing or invalid.
  - `src/db/repos/admin/user-mind.ts`: `adminStalePendingRuns(db, olderThan: Date, limit: number): Promise<{ id: string; user_id: string }[]>`

- [ ] **Step 1: Schema.** In `src/db/schema.ts` add `"summary"` to the end of `factKind`'s values. Next to the other enums add:

```ts
export const userMindRunStatus = pgEnum("user_mind_run_status", [
  "pending",
  "running",
  "done",
  "failed",
  "capped",
]);
```

After `fact`'s definition (user tables section) add:

```ts
/**
 * One batch of her thinking about one user, recorded when a big event happens in their
 * relationship. The row makes the batch run exactly once: written with the exchange, claimed by
 * the worker, re-queued by the sweep if its job was lost. `capped` rows record a trigger past the
 * daily limit and never run.
 */
export const user_mind_run = pgTable(
  "user_mind_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: userRef(),
    source_ref: text("source_ref").notNull(),
    triggers: jsonb("triggers").notNull(),
    status: userMindRunStatus("status").notNull(),
    local_date: date("local_date", { mode: "string" }).notNull(),
    created_at: ts("created_at").notNull(),
    finished_at: ts("finished_at"),
  },
  (t) => [
    uniqueIndex("user_mind_run_source_idx").on(t.user_id, t.source_ref),
    index("user_mind_run_status_idx").on(t.status, t.created_at),
    index("user_mind_run_user_date_idx").on(t.user_id, t.local_date),
  ],
);

/** One row per user loop run: what it read and wrote (by id), its spend and its outcome. */
export const user_loop_trace = pgTable(
  "user_loop_trace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: userRef(),
    run_id: uuid("run_id")
      .notNull()
      .references(() => user_mind_run.id, { onDelete: "cascade" }),
    loop: text("loop").notNull(),
    inputs: jsonb("inputs").notNull(),
    outputs: jsonb("outputs").notNull(),
    model: text("model"),
    prompt_version: text("prompt_version"),
    tokens_in: integer("tokens_in"),
    tokens_out: integer("tokens_out"),
    cost: real("cost"),
    calls: integer("calls").notNull().default(0),
    status: text("status").notNull(),
    error: text("error"),
    created_at: ts("created_at").notNull(),
  },
  (t) => [index("user_loop_trace_user_created_idx").on(t.user_id, t.created_at)],
);
```

(Import `uniqueIndex` from `drizzle-orm/pg-core` if not already imported.)

- [ ] **Step 2: Generate the migration.** Run `pnpm db:generate --name user_mind`. Expected: `src/db/migrations/0024_user_mind.sql` containing `ALTER TYPE "public"."fact_kind" ADD VALUE 'summary';`, the new enum and both tables. Open it and check nothing else changed.

- [ ] **Step 3: Config.** In `config/default.json` add `"user_mind": "claude-haiku-4-5"` to `models`, `"user_summarise": "v1"` to `prompts`, and a new top-level section:

```json
"user_mind": {
  "max_triggers_per_day": 3,
  "sweep_after_minutes": 10,
  "triggers": { "param_jump": 0.15, "bands": [0.25, 0.5, 0.75], "fact_salience": 0.8 },
  "summarise": {
    "max_facts": 20,
    "max_threads": 5,
    "max_chars": 300,
    "max_tokens": 512,
    "salience": 0.6
  }
}
```

In `src/mind/platform/config.ts`: add `user_mind: text` to `models`, `user_summarise: promptVersion` to `prompts`, and:

```ts
const userMind = z.object({
  max_triggers_per_day: positiveInt,
  sweep_after_minutes: countFromZero,
  triggers: z.object({
    param_jump: unit,
    bands: z.array(unit).min(1),
    fact_salience: unit,
  }),
  summarise: z.object({
    max_facts: positiveInt,
    max_threads: countFromZero,
    max_chars: positiveInt,
    max_tokens: positiveInt,
    salience: unit,
  }),
});
```

and `user_mind: userMind,` in `ConfigSchema`.

- [ ] **Step 4: Write the failing repo tests** in `tests/db/user-mind-repos.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { insertFact } from "@/db/repos/user/facts";
import {
  claimRun,
  finishRun,
  insertRun,
  liveSummary,
  userLocalDate,
} from "@/db/repos/user/user-mind";
import { adminStalePendingRuns } from "@/db/repos/admin/user-mind";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T09:00:00Z");
const trig = [{ kind: "make_up_done" as const }];
const run = (userId: string, sourceRef: string, cap = 3) =>
  insertRun(getTestDb(), userId, { sourceRef, triggers: trig, localDate: "2026-01-05", now, cap });

test("a source_ref records one run; a repeat records nothing", async () => {
  const u = await createTestUser();
  expect((await run(u, "exchange:a"))?.status).toBe("pending");
  expect(await run(u, "exchange:a")).toBeNull();
});

test("past the daily cap a run is recorded capped", async () => {
  const u = await createTestUser();
  for (const ref of ["a", "b"]) await run(u, `exchange:${ref}`, 2);
  expect((await run(u, "exchange:c", 2))?.status).toBe("capped");
  // Capped rows don't count toward the cap.
  expect((await run(u, "exchange:d", 2))?.status).toBe("capped");
});

test("the cap is per user", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  await run(a, "exchange:a", 1);
  expect((await run(b, "exchange:b", 1))?.status).toBe("pending");
});

test("claim moves pending to running once", async () => {
  const u = await createTestUser();
  const row = (await run(u, "exchange:a"))!;
  expect((await claimRun(getTestDb(), row.id))?.status).toBe("running");
  expect(await claimRun(getTestDb(), row.id)).toBeNull();
  await finishRun(getTestDb(), row.id, "done", now);
  const res = await getTestDb().execute(sql`SELECT status, finished_at FROM user_mind_run`);
  expect(res.rows[0]).toMatchObject({ status: "done" });
  expect(res.rows[0]!.finished_at).not.toBeNull();
});

test("stale pending runs are found across users, newer ones are not", async () => {
  const u = await createTestUser();
  const row = (await run(u, "exchange:a"))!;
  expect(await adminStalePendingRuns(getTestDb(), new Date(now.getTime() + 1), 10)).toEqual([
    { id: row.id, user_id: u },
  ]);
  expect(await adminStalePendingRuns(getTestDb(), now, 10)).toEqual([]);
});

test("the live summary is the newest active summary fact", async () => {
  const u = await createTestUser();
  expect(await liveSummary(getTestDb(), u)).toBeNull();
  const base = {
    subject: "shared" as const,
    kind: "summary" as const,
    embedding: vec(),
    created_at: now,
    status: "open" as const,
    salience: 0.6,
    valence: 0,
    confidence: 0.7,
    source: "generated" as const,
  };
  await insertFact(getTestDb(), u, { ...base, content: "old", status: "superseded" });
  await insertFact(getTestDb(), u, { ...base, content: "live" });
  expect((await liveSummary(getTestDb(), u))?.content).toBe("live");
});

test("a missing or invalid timezone falls back to UTC for the local date", async () => {
  const u = await createTestUser();
  await getTestDb().execute(sql`UPDATE "user" SET timezone = 'Not/AZone' WHERE id = ${u}`);
  expect(await userLocalDate(getTestDb(), u, new Date("2026-01-05T23:30:00Z"))).toBe("2026-01-05");
  await getTestDb().execute(sql`UPDATE "user" SET timezone = 'Asia/Singapore' WHERE id = ${u}`);
  expect(await userLocalDate(getTestDb(), u, new Date("2026-01-05T23:30:00Z"))).toBe("2026-01-06");
});
```

(If the `user` table's timezone column has a different name, read `getTimezone` in `src/db/repos/user/users.ts` and match it. Remove `randomUUID` from the imports if unused.)

- [ ] **Step 5: Run to verify failure.** `pnpm vitest run tests/db/user-mind-repos.test.ts` → FAIL (module not found).

- [ ] **Step 6: Implement** `src/db/repos/user/user-mind.ts`:

```ts
/**
 * One user's mind runs: the durable row behind each batch of her thinking about them, the trace
 * of every loop in it, and the live summary she keeps of where things stand.
 */
import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { fact, user_loop_trace, user_mind_run } from "@/db/schema";
import { getTimezone } from "@/db/repos/user/users";
import { isValidTimeZone, localDateString } from "@/mind/platform/timezone";
import type { FactRow } from "./facts";

export type UserMindRunRow = typeof user_mind_run.$inferSelect;
export type NewUserLoopTrace = typeof user_loop_trace.$inferInsert;
export type Trigger =
  | { kind: "param_jump" | "param_band"; param: string; from: number; to: number }
  | { kind: "salient_fact"; salience: number }
  | { kind: "make_up_done" };

/**
 * Null when this source already recorded a run (a retried exchange). Runs past `cap` on the
 * user's local date are recorded `capped`; capped rows don't count toward the cap.
 */
export async function insertRun(
  db: Db,
  userId: string,
  input: { sourceRef: string; triggers: Trigger[]; localDate: string; now: Date; cap: number },
): Promise<UserMindRunRow | null> {
  const counted = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(user_mind_run)
    .where(
      and(
        eq(user_mind_run.user_id, userId),
        eq(user_mind_run.local_date, input.localDate),
        ne(user_mind_run.status, "capped"),
      ),
    );
  const rows = await db
    .insert(user_mind_run)
    .values({
      user_id: userId,
      source_ref: input.sourceRef,
      triggers: input.triggers,
      status: (counted[0]?.n ?? 0) >= input.cap ? "capped" : "pending",
      local_date: input.localDate,
      created_at: input.now,
    })
    .onConflictDoNothing({ target: [user_mind_run.user_id, user_mind_run.source_ref] })
    .returning();
  return rows[0] ?? null;
}

/** Atomically takes a pending run; null when it's already taken, finished or capped. */
export async function claimRun(db: Db, runId: string): Promise<UserMindRunRow | null> {
  const rows = await db
    .update(user_mind_run)
    .set({ status: "running" })
    .where(and(eq(user_mind_run.id, runId), eq(user_mind_run.status, "pending")))
    .returning();
  return rows[0] ?? null;
}

export async function finishRun(
  db: Db,
  runId: string,
  status: "done" | "failed",
  now: Date,
): Promise<void> {
  await db
    .update(user_mind_run)
    .set({ status, finished_at: now })
    .where(eq(user_mind_run.id, runId));
}

export async function insertLoopTrace(db: Db, row: NewUserLoopTrace): Promise<void> {
  await db.insert(user_loop_trace).values(row);
}

export async function liveSummary(db: Db, userId: string): Promise<FactRow | null> {
  const rows = await db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.kind, "summary"),
        notInArray(fact.status, ["superseded", "stale"]),
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(1);
  return rows[0] ?? null;
}

/** The user's local date; UTC when their zone is unset or invalid. */
export async function userLocalDate(db: Db, userId: string, now: Date): Promise<string> {
  const raw = await getTimezone(db, userId);
  return localDateString(now, raw && isValidTimeZone(raw) ? raw : "UTC");
}
```

`src/db/repos/admin/user-mind.ts`:

```ts
/** Cross-user: pending user mind runs whose job was lost, for the sweep. */
import { and, asc, eq, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { user_mind_run } from "@/db/schema";

export async function adminStalePendingRuns(
  db: Db,
  olderThan: Date,
  limit: number,
): Promise<{ id: string; user_id: string }[]> {
  return db
    .select({ id: user_mind_run.id, user_id: user_mind_run.user_id })
    .from(user_mind_run)
    .where(and(eq(user_mind_run.status, "pending"), lt(user_mind_run.created_at, olderThan)))
    .orderBy(asc(user_mind_run.created_at))
    .limit(limit);
}
```

- [ ] **Step 7: Run tests.** `pnpm vitest run tests/db/user-mind-repos.test.ts tests/db/schema.test.ts` → PASS. Then `pnpm typecheck`.

- [ ] **Step 8: Commit.**

```bash
git add src/db config src/mind/platform/config.ts tests/db/user-mind-repos.test.ts
git commit -m "feat(user-mind): run and loop trace tables, summary kind, user_mind config"
```

---

### Task 2: Keep summaries out of ordinary memory paths

**Files:**
- Modify: `src/db/repos/user/facts.ts` (`candidateFacts`, `nearFacts`), `src/db/repos/admin/decay.ts`
- Test: `tests/db/memory-repos.test.ts` (append)

**Interfaces:**
- Consumes: `fact_kind` `summary` (Task 1).
- Produces: no new names; `candidateFacts`, `nearFacts` and `adminDecayFacts` ignore `kind = 'summary'`.

- [ ] **Step 1: Write failing tests** (append to `tests/db/memory-repos.test.ts`, reusing its imports and helpers; add imports for `candidateFacts`, `nearFacts`, `insertFact`, `adminDecayFacts` if missing):

```ts
test("summary facts are invisible to retrieval, reconcile and decay", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const old = new Date("2025-01-01T00:00:00Z");
  const summary = await insertFact(db, u, {
    subject: "shared",
    kind: "summary",
    content: "Where things stand.",
    embedding: vec(0.02),
    created_at: old,
    status: "open",
    salience: 0.01,
    valence: 0,
    confidence: 0.7,
    source: "generated",
  });
  expect(await candidateFacts(db, u, vec(0.02), 10)).toEqual([]);
  expect(await nearFacts(db, u, "shared", vec(0.02), 5, 0)).toEqual([]);
  await adminDecayFacts(db, new Date("2026-01-05T00:00:00Z"), {
    grace_days: 0,
    rate: 0.5,
    stale_floor: 0.5,
    dormant_after_days: 30,
  });
  const after = await getFact(db, u, summary.id);
  expect(after).toMatchObject({ status: "open", salience: 0.01 });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/db/memory-repos.test.ts -t "summary facts"` → FAIL.

- [ ] **Step 3: Implement.** In `candidateFacts`'s SQL add `AND f.kind <> 'summary'` after the status clause, with the comment `-- The summary has its own slot in the reply.`; in `nearFacts` add `AND kind <> 'summary'` (comment: a summary is never a reconcile neighbour). In both statements of `adminDecayFacts` that touch `fact`, add `AND kind <> 'summary'` (a superseding summary replaces it; decay would stale the slot).

- [ ] **Step 4: Run** the memory repo tests and `pnpm vitest run tests/mind/memory` → PASS.

- [ ] **Step 5: Commit** `fix(memory): keep summary facts out of retrieval, reconcile and decay`.

---

### Task 3: Big-event detection (pure)

**Files:**
- Create: `src/mind/process/user/big-events.ts`
- Test: `tests/mind/process/user/big-events.test.ts`

**Interfaces:**
- Consumes: `Params`, `MakeUpState` from `src/mind/state/user/relationship/types.ts`; `Trigger` from `src/db/repos/user/user-mind.ts`; `Config["user_mind"]["triggers"]`.
- Produces:
  ```ts
  export type RelationshipSnapshot = { params: Params; makeUp: MakeUpState };
  export function detectBigEvents(input: {
    before: RelationshipSnapshot | null;
    after: RelationshipSnapshot | null;
    newFactSaliences: number[];
    settings: Config["user_mind"]["triggers"];
    /** The daily tick moves params by fade and absence only: no jumps, no facts, no make-up. */
    source: "exchange" | "tick";
  }): Trigger[];
  ```

- [ ] **Step 1: Write failing tests:**

```ts
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { detectBigEvents, type RelationshipSnapshot } from "@/mind/process/user/big-events";
import { PARAM_NAMES, type Params } from "@/mind/state/user/relationship/types";

const settings = loadConfig().user_mind.triggers;
const at = new Date("2026-01-05T09:00:00Z");

function snap(values: Partial<Record<keyof Params, number>>, makeUp = "none"): RelationshipSnapshot {
  const params = Object.fromEntries(
    PARAM_NAMES.map((p) => [p, { value: values[p] ?? 0.4, baseline: 0.4, variance: 0.01, updated_at: at }]),
  ) as Params;
  return { params, makeUp: makeUp as RelationshipSnapshot["makeUp"] };
}
const detect = (
  before: RelationshipSnapshot,
  after: RelationshipSnapshot,
  newFactSaliences: number[] = [],
  source: "exchange" | "tick" = "exchange",
) => detectBigEvents({ before, after, newFactSaliences, settings, source });

test("nothing moved: no trigger", () => {
  expect(detect(snap({}), snap({}))).toEqual([]);
});

test("a jump in trust triggers", () => {
  expect(detect(snap({ trust: 0.3 }), snap({ trust: 0.46 }))).toContainEqual({
    kind: "param_jump",
    param: "trust",
    from: 0.3,
    to: 0.46,
  });
});

test("a closeness jump alone never triggers; a closeness band crossing does", () => {
  expect(detect(snap({ closeness: 0.3 }), snap({ closeness: 0.45 }))).toEqual([]);
  expect(detect(snap({ closeness: 0.49 }), snap({ closeness: 0.51 }))).toEqual([
    { kind: "param_band", param: "closeness", from: 0.49, to: 0.51 },
  ]);
});

test("afterglow and msgs_per_day never trigger", () => {
  expect(detect(snap({ afterglow: 0 }), snap({ afterglow: 0.9 }))).toEqual([]);
  expect(detect(snap({ msgs_per_day: 1 }), snap({ msgs_per_day: 40 }))).toEqual([]);
});

test("bands cross downward too", () => {
  expect(detect(snap({ warmth: 0.26 }), snap({ warmth: 0.24 }))).toEqual([
    { kind: "param_band", param: "warmth", from: 0.26, to: 0.24 },
  ]);
});

test("a salient new fact triggers; a minor one doesn't", () => {
  expect(detect(snap({}), snap({}), [0.5, 0.85])).toEqual([{ kind: "salient_fact", salience: 0.85 }]);
  expect(detect(snap({}), snap({}), [0.79])).toEqual([]);
});

test("make-up done triggers from due or offered", () => {
  expect(detect(snap({}, "offered"), snap({}, "none"))).toEqual([{ kind: "make_up_done" }]);
  expect(detect(snap({}, "due"), snap({}, "none"))).toEqual([{ kind: "make_up_done" }]);
  expect(detect(snap({}, "none"), snap({}, "due"))).toEqual([]);
});

test("the tick only reports band crossings", () => {
  expect(detect(snap({ hurt: 0.6 }), snap({ hurt: 0.3 }), [], "tick")).toEqual([]);
  expect(detect(snap({ hurt: 0.3 }), snap({ hurt: 0.2 }), [], "tick")).toEqual([
    { kind: "param_band", param: "hurt", from: 0.3, to: 0.2 },
  ]);
});

test("no relationship before or after: no param or make-up trigger, facts still count", () => {
  expect(
    detectBigEvents({ before: null, after: null, newFactSaliences: [0.9], settings, source: "exchange" }),
  ).toEqual([{ kind: "salient_fact", salience: 0.9 }]);
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/mind/process/user/big-events.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/mind/process/user/big-events.ts`:

```ts
/**
 * Big events: the moments that make her think about a user. Pure. A param scored from the
 * user's behaviour jumping in one exchange, any watched param crossing a level band, a salient
 * new memory, or a make-up completed. Closeness grows a little with every warm exchange, so only
 * its band crossings count; afterglow and message rate never do, so a long session isn't a big
 * event by length alone.
 */
import type { Config } from "@/mind/platform/config";
import type { Trigger } from "@/db/repos/user/user-mind";
import type { MakeUpState, ParamName, Params } from "@/mind/state/user/relationship/types";

export type RelationshipSnapshot = { params: Params; makeUp: MakeUpState };

const JUMP_PARAMS: ParamName[] = ["trust", "warmth", "hurt", "tension", "affect_valence"];
const BAND_PARAMS: ParamName[] = ["closeness", ...JUMP_PARAMS];

export function detectBigEvents(input: {
  before: RelationshipSnapshot | null;
  after: RelationshipSnapshot | null;
  newFactSaliences: number[];
  settings: Config["user_mind"]["triggers"];
  source: "exchange" | "tick";
}): Trigger[] {
  const { before, after, settings, source } = input;
  const triggers: Trigger[] = [];

  if (before && after) {
    for (const param of BAND_PARAMS) {
      const from = before.params[param].value;
      const to = after.params[param].value;
      const jumped =
        source === "exchange" &&
        JUMP_PARAMS.includes(param) &&
        Math.abs(to - from) >= settings.param_jump;
      const crossed = settings.bands.some((b) => (from < b) !== (to < b));
      if (jumped) triggers.push({ kind: "param_jump", param, from, to });
      else if (crossed) triggers.push({ kind: "param_band", param, from, to });
    }
    if (source === "exchange" && before.makeUp !== "none" && after.makeUp === "none")
      triggers.push({ kind: "make_up_done" });
  }

  if (source === "exchange") {
    const top = Math.max(-Infinity, ...input.newFactSaliences);
    if (top >= settings.fact_salience) triggers.push({ kind: "salient_fact", salience: top });
  }
  return triggers;
}
```

- [ ] **Step 4: Run** → PASS. `pnpm lint` on the file.

- [ ] **Step 5: Commit** `feat(user-mind): detect big events`.

---

### Task 4: Shared metering and `runUserLoop`

**Files:**
- Create: `src/mind/platform/llm/meter.ts`, `src/mind/process/user/runner.ts`
- Modify: `src/mind/process/core/runner.ts`, `src/mind/platform/llm/types.ts` (`StructuredModel` + `"user_mind"`), `src/mind/platform/llm/anthropic.ts` (`modelIdFor` + `user_mind: this.models.user_mind`)
- Test: `tests/mind/process/user/runner.test.ts`; existing `tests/mind/process/core/runner.test.ts` must still pass unchanged.

**Interfaces:**
- Consumes: `insertLoopTrace`, `UserMindRunRow` (Task 1).
- Produces:
  - `meter.ts`: `meterLlm(llm: LLMProvider, opts: { reserve?: () => Promise<boolean>; onRefused?: (purpose: string) => Error; maxRetries?: number }): { llm: LLMProvider; usage: LlmUsage[]; calls(): number }` and `spend(usage: LlmUsage[], prices: Config["core"]["prices"]): { model: string | null; tokens_in: number | null; tokens_out: number | null; cost: number | null }`.
  - `runner.ts`:
    ```ts
    export type UserLoopName = "user_summarise";
    export type UserLoopDeps = Pick<Deps, "db" | "embedder" | "config" | "clock" | "log"> & {
      llm: LLMProvider;
      /** Her latest self snapshot, read once per run; null before one exists. */
      snapshot: string | null;
    };
    export type UserLoopResult = { inputs: unknown; outputs: unknown; promptVersion: string | null };
    export async function runUserLoop(
      deps: UserLoopDeps,
      run: { id: string; user_id: string },
      name: UserLoopName,
      fn: (ctx: { deps: UserLoopDeps; traceId: string }) => Promise<UserLoopResult>,
    ): Promise<"done" | "failed">;
    ```
    It never throws: a failure is traced (`failed`, error class) and logged, and `"failed"` is returned so the batch can finish its other loops.

- [ ] **Step 1: Extract the helpers.** Move `meterLlm` and `spend` from `src/mind/process/core/runner.ts` into `src/mind/platform/llm/meter.ts` with this shape (header: "Metering a background loop's model calls: counts, usage for cost, and an optional reservation before each call. Shared by her core loops and her user loops."):

```ts
export function meterLlm(
  llm: LLMProvider,
  opts: { reserve?: () => Promise<boolean>; onRefused?: (purpose: string) => Error; maxRetries?: number },
) {
  const usage: LlmUsage[] = [];
  let calls = 0;
  const metered: LLMProvider = {
    async generateReply() {
      throw new Error("background loops never call the reply model");
    },
    async classifyJson(request) {
      if (opts.reserve && !(await opts.reserve()))
        throw opts.onRefused?.(request.purpose) ?? new Error(`${request.purpose}: refused`);
      calls += 1;
      return llm.classifyJson({
        ...(opts.maxRetries === undefined ? {} : { maxRetries: opts.maxRetries }),
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

export function spend(usage: LlmUsage[], prices: Config["core"]["prices"]) {
  // body identical to the old `spend`, reading `prices[u.model]` instead of `config.core.prices[u.model]`
}
```

In the core runner replace the local definitions with:

```ts
const meter = meterLlm(deps.llm, {
  reserve: () => core.traces.reserveCall(day, limit),
  onRefused: (purpose) => new BudgetSpentError(`${purpose}: budget spent`),
  maxRetries: config.core.max_retries,
});
```

and `...spend(meter.usage, config)` with `...spend(meter.usage, config.core.prices)` (all three places). Keep the comment about a transient failure costing a night next to `maxRetries`.

- [ ] **Step 2: Run** `pnpm vitest run tests/mind/process/core` → PASS (pure refactor).

- [ ] **Step 3: Add the model role.** `StructuredModel` gains `"user_mind"`; `modelIdFor`'s map gains `user_mind: this.models.user_mind`. If `AnthropicProvider` receives a typed subset of `config.models`, add `user_mind` there. `pnpm typecheck`.

- [ ] **Step 4: Write failing runner tests** `tests/mind/process/user/runner.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { insertRun } from "@/db/repos/user/user-mind";
import { runUserLoop } from "@/mind/process/user/runner";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

async function setup() {
  const deps = makeTestDeps();
  const userId = await createTestUser();
  const run = (await insertRun(deps.db, userId, {
    sourceRef: "exchange:x",
    triggers: [{ kind: "make_up_done" }],
    localDate: "2026-01-05",
    now: deps.clock.now(),
    cap: 3,
  }))!;
  return { deps: { ...deps, snapshot: null }, run };
}

test("a successful loop writes one done trace with its calls", async () => {
  const { deps, run } = await setup();
  deps.llm.handlers.probe = () => ({ ok: true });
  const status = await runUserLoop(deps, run, "user_summarise", async (ctx) => {
    await ctx.deps.llm.classifyJson({
      purpose: "probe",
      model: "user_mind",
      system: "s",
      input: "i",
      schema: z.object({ ok: z.boolean() }),
      timeoutMs: 1000,
      maxTokens: 10,
    });
    return { inputs: { a: 1 }, outputs: { b: 2 }, promptVersion: "v1" };
  });
  expect(status).toBe("done");
  const rows = await getTestDb().execute(sql`SELECT * FROM user_loop_trace`);
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0]).toMatchObject({
    loop: "user_summarise",
    status: "done",
    calls: 1,
    prompt_version: "v1",
    run_id: run.id,
    user_id: run.user_id,
  });
});

test("a throwing loop is traced failed with its error class and does not throw", async () => {
  const { deps, run } = await setup();
  class Boom extends Error {}
  const status = await runUserLoop(deps, run, "user_summarise", async () => {
    throw new Boom("secret content");
  });
  expect(status).toBe("failed");
  const rows = await getTestDb().execute(sql`SELECT status, error FROM user_loop_trace`);
  expect(rows.rows[0]).toMatchObject({ status: "failed", error: "Boom" });
  expect(JSON.stringify(rows.rows)).not.toContain("secret content");
});
```

- [ ] **Step 5: Run** → FAIL.

- [ ] **Step 6: Implement** `src/mind/process/user/runner.ts`:

```ts
/**
 * How a user loop calls a model: metered and traced once per run, scoped to one user. User loops
 * have no call budget of their own: the daily cap on runs per user is their budget. They get no
 * core layer, only her latest snapshot as text, so a user loop cannot write her core self.
 */
import { randomUUID } from "node:crypto";
import { insertLoopTrace } from "@/db/repos/user/user-mind";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { meterLlm, spend } from "@/mind/platform/llm/meter";
import type { LLMProvider } from "@/mind/platform/llm/types";

export type UserLoopName = "user_summarise";
export type UserLoopDeps = Pick<Deps, "db" | "embedder" | "config" | "clock" | "log"> & {
  llm: LLMProvider;
  /** Her latest self snapshot, read once per run; null before one exists. */
  snapshot: string | null;
};
export type UserLoopResult = { inputs: unknown; outputs: unknown; promptVersion: string | null };

export async function runUserLoop(
  deps: UserLoopDeps,
  run: { id: string; user_id: string },
  name: UserLoopName,
  fn: (ctx: { deps: UserLoopDeps; traceId: string }) => Promise<UserLoopResult>,
): Promise<"done" | "failed"> {
  const meter = meterLlm(deps.llm, { maxRetries: deps.config.core.max_retries });
  const traceId = randomUUID();
  const base = {
    id: traceId,
    user_id: run.user_id,
    run_id: run.id,
    loop: name,
    created_at: deps.clock.now(),
  };
  try {
    const result = await fn({ deps: { ...deps, llm: meter.llm }, traceId });
    await insertLoopTrace(deps.db, {
      ...base,
      inputs: result.inputs,
      outputs: result.outputs,
      prompt_version: result.promptVersion,
      status: "done",
      error: null,
      calls: meter.calls(),
      ...spend(meter.usage, deps.config.core.prices),
    });
    return "done";
  } catch (error) {
    deps.log.error("user loop failed", { userId: run.user_id, loop: name, error: errorName(error) });
    await insertLoopTrace(deps.db, {
      ...base,
      inputs: {},
      outputs: {},
      prompt_version: null,
      status: "failed",
      error: errorName(error),
      calls: meter.calls(),
      ...spend(meter.usage, deps.config.core.prices),
    });
    return "failed";
  }
}
```

- [ ] **Step 7: Run** user and core runner tests → PASS; `pnpm typecheck`.

- [ ] **Step 8: Commit** `feat(user-mind): metered, traced user loop runner sharing core metering`.

---

### Task 5: The `user_summarise` loop

**Files:**
- Create: `src/mind/process/user/summarise.ts`, `prompts/user-mind/summarise/v1.md`
- Modify: `src/mind/platform/llm/fake.ts` (handler `user_summarise`), `src/db/repos/user/facts.ts` (add `listFactsForSummary`)
- Test: `tests/mind/process/user/summarise.test.ts`

**Interfaces:**
- Consumes: `runUserLoop`, `UserLoopDeps` (Task 4); `liveSummary`, `Trigger` (Task 1); `listOpenThreads` (`src/db/repos/user/threads.ts`); `loadRelationshipSummary(deps, userId, now)`; `fitText`; `loadPrompt`; `insertFact`, `setFactStatus`.
- Produces:
  - `listFactsForSummary(db, userId, since: Date | null, limit): Promise<{ id: string; subject: string; kind: string; content: string; salience: number }[]>` — active, non-summary, non-sensitive facts created after `since` (all when null), highest salience first.
  - `userSummarise(deps: UserLoopDeps, run: { id: string; user_id: string; triggers: unknown }): Promise<"done" | "failed">`
  - Summary fact: `kind "summary"`, `subject "shared"`, `source "generated"`, `source_ref "user_summarise:<traceId>"`, `payload { where_things_stand, whats_live, how_i_feel }`, `content` = the three joined with `" "`.

- [ ] **Step 1: Prompt** `prompts/user-mind/summarise/v1.md`:

```markdown
You are Spica, thinking privately about one person you talk to, after something important just
happened between you. Write where things stand with them, for your own memory.

Input is JSON: `who_you_are` (your latest sense of yourself), `previous` (your last summary of
them, or null), `what_happened` (what just made you think about them), `you_and_them` (how the
relationship feels right now), `new_memories` (what you've learned since your last summary), and
`open_threads` (ongoing things in their life or between you).

Return JSON with exactly three strings, each one or two short sentences, in your own voice, first
person, about them:
- `where_things_stand`: the state of the relationship and of their life as you see it now.
- `whats_live`: what's ongoing or unresolved that you'd want to keep in mind next time.
- `how_i_feel`: how you feel about them right now, honestly.

Use only what the input says. Don't invent events, people or details. Carry forward anything
from `previous` that still holds; drop what no longer does.
```

- [ ] **Step 2: Fake handler.** In `FakeLLMProvider.handlers` add a deterministic one that reflects its input (so the canary probe can see input in output):

```ts
user_summarise: (input: string) => {
  const ctx = JSON.parse(input) as { new_memories: { content: string }[]; what_happened: string[] };
  return {
    where_things_stand: `Things moved: ${ctx.what_happened.join("; ") || "nothing new"}.`,
    whats_live: ctx.new_memories.map((m) => m.content).join(" ").slice(0, 280) || "Nothing open.",
    how_i_feel: "I feel the same about them.",
  };
},
```

- [ ] **Step 3: Write failing tests** `tests/mind/process/user/summarise.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { forgetFact, insertFact } from "@/db/repos/user/facts";
import { insertRun, liveSummary } from "@/db/repos/user/user-mind";
import { userSummarise } from "@/mind/process/user/summarise";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

async function setup() {
  const base = makeTestDeps();
  const userId = await createTestUser();
  const deps = { ...base, snapshot: "She loves old films." };
  const fact = (content: string, salience: number, payload: object | null = null) =>
    insertFact(base.db, userId, {
      subject: "user",
      kind: "event",
      content,
      payload,
      embedding: vec(),
      created_at: base.clock.now(),
      status: "open",
      salience,
      valence: 0.2,
      confidence: 0.9,
      source: "turn",
    });
  const run = async (ref: string) =>
    (await insertRun(base.db, userId, {
      sourceRef: ref,
      triggers: [{ kind: "salient_fact", salience: 0.9 }],
      localDate: "2026-01-05",
      now: base.clock.now(),
      cap: 9,
    }))!;
  return { deps, userId, fact, run };
}

test("writes one live summary from the user's memories and her snapshot", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  await fact("Private crisis detail.", 0.95, { sensitive: true });
  expect(await userSummarise(deps, await run("exchange:a"))).toBe("done");
  const s = (await liveSummary(deps.db, userId))!;
  expect(s).toMatchObject({ kind: "summary", subject: "shared", source: "generated" });
  expect(s.content).toContain("Osaka");
  expect(s.content).not.toContain("Private crisis");
  expect(s.payload).toHaveProperty("how_i_feel");
  const prompt = deps.llm.structuredCalls.find((c) => c.purpose === "user_summarise")!;
  expect(prompt.input).toContain("She loves old films.");
});

test("a second run supersedes the first; one stays live", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  await userSummarise(deps, await run("exchange:a"));
  const first = (await liveSummary(deps.db, userId))!;
  deps.clock.advance(60_000);
  await fact("They moved to Osaka.", 0.9);
  await userSummarise(deps, await run("exchange:b"));
  const res = await getTestDb().execute(
    sql`SELECT id, status, superseded_by FROM fact WHERE kind = 'summary' ORDER BY created_at`,
  );
  expect(res.rows).toHaveLength(2);
  expect(res.rows[0]).toMatchObject({ id: first.id, status: "superseded" });
  expect(res.rows[0]!.superseded_by).toBe(res.rows[1]!.id);
  // The second prompt saw only the memory after the first summary, plus the previous summary.
  const second = deps.llm.structuredCalls.filter((c) => c.purpose === "user_summarise")[1]!;
  expect(second.input).toContain("They moved to Osaka.");
  expect(second.input).not.toContain("They got the job in Osaka.\"");
  expect(JSON.parse(second.input).previous).not.toBeNull();
});

test("after the user deletes the summary, the next run writes a fresh one", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  await userSummarise(deps, await run("exchange:a"));
  await forgetFact(deps.db, userId, (await liveSummary(deps.db, userId))!.id);
  expect(await liveSummary(deps.db, userId)).toBeNull();
  expect(await userSummarise(deps, await run("exchange:b"))).toBe("done");
  expect(await liveSummary(deps.db, userId)).not.toBeNull();
});

test("overlong parts are fitted; empty output fails and keeps the old summary", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  deps.llm.handlers.user_summarise = () => ({
    where_things_stand: "x".repeat(900),
    whats_live: "a",
    how_i_feel: "b",
  });
  expect(await userSummarise(deps, await run("exchange:a"))).toBe("done");
  const kept = (await liveSummary(deps.db, userId))!;
  expect((kept.payload as { where_things_stand: string }).where_things_stand.length).toBe(
    deps.config.user_mind.summarise.max_chars,
  );
  deps.llm.handlers.user_summarise = () => ({ where_things_stand: "", whats_live: "", how_i_feel: "" });
  expect(await userSummarise(deps, await run("exchange:b"))).toBe("failed");
  expect((await liveSummary(deps.db, userId))!.id).toBe(kept.id);
});
```

(Check `SimClock` for its advance method name — `advance(ms)` or `set(date)` — and use what exists.)

- [ ] **Step 4: Run** → FAIL.

- [ ] **Step 5: Implement `listFactsForSummary`** in `src/db/repos/user/facts.ts`:

```ts
/** What she has learned about a user since her last summary of them, most salient first. */
export async function listFactsForSummary(db: Db, userId: string, since: Date | null, limit: number) {
  return db
    .select({
      id: fact.id,
      subject: fact.subject,
      kind: fact.kind,
      content: fact.content,
      salience: fact.salience,
    })
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        notInArray(fact.status, [...INACTIVE]),
        sql`${fact.kind} <> 'summary'`,
        sql`COALESCE((${fact.payload}->>'sensitive')::boolean, false) = false`,
        since ? sql`${fact.created_at} > ${since.toISOString()}::timestamptz` : undefined,
      ),
    )
    .orderBy(desc(fact.salience))
    .limit(limit);
}
```

- [ ] **Step 6: Implement** `src/mind/process/user/summarise.ts`:

```ts
/**
 * Her summary of where things stand with one user: the relationship, what's live, and how she
 * feels about them. Written after a big event from this user's memories, the phrased relationship
 * and her latest self, and read in her next replies. A new summary supersedes the last; a failed
 * run writes nothing and the old one stays.
 */
import { z } from "zod";
import { insertFact, listFactsForSummary, setFactStatus } from "@/db/repos/user/facts";
import { listOpenThreads } from "@/db/repos/user/threads";
import { liveSummary, type Trigger } from "@/db/repos/user/user-mind";
import { fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { loadRelationshipSummary } from "@/mind/state/user/relationship/summary";
import { runUserLoop, type UserLoopDeps } from "./runner";

const TRIGGER_TEXT: Record<Trigger["kind"], (t: Trigger) => string> = {
  param_jump: (t) => `${"param" in t ? t.param : ""} between you just ${rose(t) ? "rose" : "fell"} sharply`,
  param_band: (t) => `${"param" in t ? t.param : ""} between you just ${rose(t) ? "rose" : "fell"}`,
  salient_fact: () => "they told you something important",
  make_up_done: () => "you two made up after a hurt",
};
function rose(t: Trigger): boolean {
  return "to" in t && t.to > t.from;
}

export async function userSummarise(
  deps: UserLoopDeps,
  run: { id: string; user_id: string; triggers: unknown },
): Promise<"done" | "failed"> {
  const { config, db } = deps;
  const settings = config.user_mind.summarise;
  const userId = run.user_id;
  return runUserLoop(deps, run, "user_summarise", async (ctx) => {
    const previous = await liveSummary(db, userId);
    const facts = await listFactsForSummary(db, userId, previous?.created_at ?? null, settings.max_facts);
    const threads = await listOpenThreads(db, userId, settings.max_threads);
    const now = deps.clock.now();
    const Output = z.object({
      where_things_stand: fitText(settings.max_chars),
      whats_live: fitText(settings.max_chars),
      how_i_feel: fitText(settings.max_chars),
    });
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_summarise",
      model: "user_mind",
      system: loadPrompt("user-mind/summarise", config.prompts.user_summarise),
      input: JSON.stringify({
        who_you_are: deps.snapshot,
        previous: previous?.payload ?? null,
        what_happened: (run.triggers as Trigger[]).map((t) => TRIGGER_TEXT[t.kind](t)),
        you_and_them: await loadRelationshipSummary(deps, userId, now),
        new_memories: facts.map(({ subject, kind, content }) => ({ subject, kind, content })),
        open_threads: threads.map((t) => t.title),
      }),
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    const content = [out.where_things_stand, out.whats_live, out.how_i_feel].join(" ");
    const [embedding] = await deps.embedder.embed([content], "document");
    const summaryId = await db.transaction(async (tx) => {
      // Re-read inside the write: a summary written meanwhile is the one to supersede.
      const current = await liveSummary(tx, userId);
      const row = await insertFact(tx, userId, {
        subject: "shared",
        kind: "summary",
        content,
        payload: out,
        embedding: embedding!,
        created_at: now,
        status: "open",
        salience: settings.salience,
        valence: 0,
        confidence: 0.7,
        source: "generated",
        source_ref: `user_summarise:${ctx.traceId}`,
      });
      if (current) await setFactStatus(tx, userId, current.id, "superseded", row.id);
      return row.id;
    });
    return {
      inputs: { previous_id: previous?.id ?? null, fact_ids: facts.map((f) => f.id) },
      outputs: { summary_id: summaryId },
      promptVersion: config.prompts.user_summarise,
    };
  });
}
```

Read `setFactStatus`'s signature in `facts.ts` first; if it doesn't take `superseded_by`, add an optional fifth parameter `supersededBy?: string` that sets `superseded_by` (keep existing callers working). Confidence 0.7 goes in config as `user_mind.summarise.confidence` (add to JSON and schema) rather than a literal.

- [ ] **Step 7: Run** the summarise tests → PASS; `pnpm typecheck && pnpm lint`.

- [ ] **Step 8: Commit** `feat(user-mind): user_summarise writes a superseding summary`.

---

### Task 6: Running a batch, the job and the sweep

**Files:**
- Create: `src/mind/process/user/run.ts`, `src/worker/user-mind-jobs.ts`
- Modify: `src/mind/platform/jobs.ts`, `src/mind/process/cold-path/sweep.ts`, `src/worker/index.ts`
- Test: `tests/mind/process/user/run.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 5.
- Produces:
  - `jobs.ts`: `export const USER_MIND_RUN_QUEUE = "user_mind_run"; export type UserMindRunJob = { runId: string };` and `[USER_MIND_RUN_QUEUE]: UserMindRunJob` in `JobMap`.
  - `run.ts`:
    - `recordBigEvents(deps: Pick<Deps, "db" | "config" | "clock">, db: Db, userId: string, sourceRef: string, triggers: Trigger[]): Promise<string | null>` — inserts the run (cap applied) and returns its id when it is `pending`, else null. `db` is the caller's transaction.
    - `enqueueUserMindRun(deps: Pick<Deps, "queue" | "log">, runId: string): Promise<void>` — logs, never throws.
    - `runUserMind(deps: Deps, job: UserMindRunJob): Promise<"done" | "failed" | "skipped">`
    - `sweepPendingUserMindRuns(deps: Pick<Deps, "db" | "queue" | "config" | "log">, now: Date): Promise<number>`

- [ ] **Step 1: Queue name.** Add `USER_MIND_RUN_QUEUE`, `UserMindRunJob` and the `JobMap` entry to `src/mind/platform/jobs.ts`.

- [ ] **Step 2: Write failing tests** `tests/mind/process/user/run.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { insertFact } from "@/db/repos/user/facts";
import { USER_MIND_RUN_QUEUE } from "@/mind/platform/jobs";
import {
  recordBigEvents,
  runUserMind,
  sweepPendingUserMindRuns,
} from "@/mind/process/user/run";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const trig = [{ kind: "salient_fact" as const, salience: 0.9 }];

test("a recorded run runs its batch once; a second job for it is skipped", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await insertFact(deps.db, u, {
    subject: "user", kind: "event", content: "They passed the exam.", embedding: vec(),
    created_at: deps.clock.now(), status: "open", salience: 0.9, valence: 0.5, confidence: 0.9,
    source: "turn",
  });
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", trig))!;
  expect(await runUserMind(deps, { runId })).toBe("done");
  expect(await runUserMind(deps, { runId })).toBe("skipped");
  const traces = await getTestDb().execute(sql`SELECT loop FROM user_loop_trace`);
  expect(traces.rows).toEqual([{ loop: "user_summarise" }]);
  const run = await getTestDb().execute(sql`SELECT status FROM user_mind_run`);
  expect(run.rows[0]).toMatchObject({ status: "done" });
});

test("a capped run returns no id and never runs", async () => {
  const deps = makeTestDeps({ user_mind: { max_triggers_per_day: 1 } });
  const u = await createTestUser();
  expect(await recordBigEvents(deps, deps.db, u, "exchange:a", trig)).not.toBeNull();
  expect(await recordBigEvents(deps, deps.db, u, "exchange:b", trig)).toBeNull();
});

test("a failed loop marks the run failed", async () => {
  const deps = makeTestDeps();
  deps.llm.handlers.user_summarise = () => {
    throw new Error("down");
  };
  const u = await createTestUser();
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", trig))!;
  expect(await runUserMind(deps, { runId })).toBe("failed");
  const run = await getTestDb().execute(sql`SELECT status FROM user_mind_run`);
  expect(run.rows[0]).toMatchObject({ status: "failed" });
});

test("the sweep re-enqueues stale pending runs only", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", trig))!;
  expect(await sweepPendingUserMindRuns(deps, deps.clock.now())).toBe(0);
  const later = new Date(deps.clock.now().getTime() + 11 * 60_000);
  expect(await sweepPendingUserMindRuns(deps, later)).toBe(1);
  expect(deps.queue.drain()).toEqual([{ name: USER_MIND_RUN_QUEUE, data: { runId } }]);
});
```

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement** `src/mind/process/user/run.ts`:

```ts
/**
 * Her user mind, run on a big event: recording the run with the exchange that caused it, running
 * its batch of loops once, and re-queueing runs whose job was lost. The batch reads this user's
 * memory and state and her latest snapshot, and writes this user's memory only.
 */
import type { Db } from "@/db/client";
import { adminStalePendingRuns } from "@/db/repos/admin/user-mind";
import {
  claimRun,
  finishRun,
  insertRun,
  userLocalDate,
  type Trigger,
} from "@/db/repos/user/user-mind";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { USER_MIND_RUN_QUEUE, type UserMindRunJob } from "@/mind/platform/jobs";
import { MINUTE } from "@/mind/platform/time";
import { userSummarise } from "./summarise";

export async function recordBigEvents(
  deps: Pick<Deps, "config" | "clock">,
  db: Db,
  userId: string,
  sourceRef: string,
  triggers: Trigger[],
): Promise<string | null> {
  if (triggers.length === 0) return null;
  const now = deps.clock.now();
  const row = await insertRun(db, userId, {
    sourceRef,
    triggers,
    localDate: await userLocalDate(db, userId, now),
    now,
    cap: deps.config.user_mind.max_triggers_per_day,
  });
  return row?.status === "pending" ? row.id : null;
}

/** After the run's row has committed. A lost enqueue is picked up by the sweep. */
export async function enqueueUserMindRun(
  deps: Pick<Deps, "queue" | "log">,
  runId: string,
): Promise<void> {
  try {
    await deps.queue.enqueue(USER_MIND_RUN_QUEUE, { runId });
  } catch (e) {
    deps.log.error("user_mind_run enqueue failed", { runId, error: errorName(e) });
  }
}

export async function runUserMind(
  deps: Deps,
  job: UserMindRunJob,
): Promise<"done" | "failed" | "skipped"> {
  const run = await claimRun(deps.db, job.runId);
  if (!run) return "skipped";
  const snapshot = (await deps.core.memory.latestSnapshot())?.content ?? null;
  const { db, embedder, config, clock, log, llm } = deps;
  const status = await userSummarise({ db, embedder, config, clock, log, llm, snapshot }, run);
  await finishRun(deps.db, run.id, status, clock.now());
  return status;
}

export async function sweepPendingUserMindRuns(
  deps: Pick<Deps, "db" | "queue" | "config" | "log">,
  now: Date,
): Promise<number> {
  const olderThan = new Date(now.getTime() - deps.config.user_mind.sweep_after_minutes * MINUTE);
  const runs = await adminStalePendingRuns(deps.db, olderThan, deps.config.cold_path.sweep_batch);
  for (const run of runs) await enqueueUserMindRun(deps, run.id);
  if (runs.length > 0) deps.log.info("user_mind_run sweep enqueued", { count: runs.length });
  return runs.length;
}
```

(If `MINUTE` isn't exported from `src/mind/platform/time.ts`, add it next to `HOUR`. `UserLoopDeps` is satisfied structurally.) Add a `// ponytail: a run left 'running' by a crash is never retried; reclaim stale running rows if crashes matter` comment above `claimRun`'s use.

- [ ] **Step 5: Sweep hook.** At the end of `sweepUnfinishedColdPaths` in `src/mind/process/cold-path/sweep.ts`, call `await sweepPendingUserMindRuns(deps, now);` (the cold path sweep is where lost post-commit work is recovered). Update its header comment: "…and re-queues user mind runs whose job was lost."

- [ ] **Step 6: Worker.** `src/worker/user-mind-jobs.ts`:

```ts
/** User mind jobs: one batch of her thinking about a user, after a big event. */
import type { PgBoss } from "pg-boss";
import type { Deps } from "@/mind/platform/deps";
import { USER_MIND_RUN_QUEUE, type UserMindRunJob } from "@/mind/platform/jobs";
import { runUserMind } from "@/mind/process/user/run";
import { scrubErrors } from "./jobs";

export const USER_MIND_QUEUES = [USER_MIND_RUN_QUEUE];

export async function registerUserMindJobs(boss: PgBoss, deps: Deps): Promise<void> {
  await boss.work<UserMindRunJob>(
    USER_MIND_RUN_QUEUE,
    scrubErrors(USER_MIND_RUN_QUEUE, deps.log, async (jobs) => {
      for (const job of jobs) await runUserMind(deps, job.data);
    }),
  );
}
```

Register it in `src/worker/index.ts` after `registerStateJobs`, and add `...USER_MIND_QUEUES` to the logged queue list. Check `ensureSystemQueues` in `src/worker/jobs.ts`: if queues must be created there (pg-boss 12 needs `createQueue`), add `USER_MIND_RUN_QUEUE` with retry limit 0 the same way the other queues are created.

- [ ] **Step 7: Run** `pnpm vitest run tests/mind/process/user tests/mind/process/cold-path/sweep.test.ts tests/runtime` → PASS.

- [ ] **Step 8: Commit** `feat(user-mind): durable user_mind_run job, batch runner and sweep`.

---

### Task 7: Detect and record in the cold path and the relationship tick

**Files:**
- Modify: `src/mind/memory/user/encode.ts`, `src/mind/state/user/relationship/update.ts`, `src/mind/process/cold-path/cold-path.ts`, `src/mind/state/user/relationship/daily-tick.ts`, `src/worker/state-jobs.ts` (if `relationshipDailyTick`'s deps widen)
- Test: `tests/mind/process/cold-path/cold-path.test.ts` (append), `tests/mind/state/...daily-tick` test file (append; find it with `ls tests/mind/state/user/relationship`)

**Interfaces:**
- Consumes: `detectBigEvents`, `RelationshipSnapshot` (Task 3); `recordBigEvents`, `enqueueUserMindRun` (Task 6).
- Produces:
  - `EncodeOutcome.insertedSaliences: number[]` — the salience of every fact row inserted (not merged).
  - `updateRelationship(...)` returns `Promise<{ before: RelationshipSnapshot; after: RelationshipSnapshot }>`.
  - `ColdPathOutcome` gains `userMindRunId?: string | null`.
  - `tickUser(deps: Pick<Deps, "db" | "config" | "clock" | "queue" | "log">, userId, now)`; `relationshipDailyTick` deps widen the same way.

- [ ] **Step 1: Write failing cold path tests** (append to `cold-path.test.ts`, using its `exchange` and `depsWith` helpers; the Biscuit fact there has salience 0.8, which meets `fact_salience` 0.8):

```ts
test("a salient new fact records one user mind run and enqueues it after commit", async () => {
  const deps = depsWith();
  const userId = await createTestUser();
  const { job, ct } = await exchange(userId, "my dog is called Biscuit", "cute!", 1);
  const out = await runColdPath(deps, job);
  expect(out.userMindRunId).toBeTruthy();
  const runs = await getTestDb().execute(sql`SELECT source_ref, status, triggers FROM user_mind_run`);
  expect(runs.rows).toEqual([
    expect.objectContaining({ source_ref: `exchange:${ct.id}`, status: "pending" }),
  ]);
  expect(deps.queue.jobs.filter((j) => j.name === "user_mind_run")).toHaveLength(1);
});

test("a retried cold path for the same exchange records no second run", async () => {
  const deps = depsWith();
  const userId = await createTestUser();
  const { job } = await exchange(userId, "my dog is called Biscuit", "cute!", 1);
  await runColdPath(deps, job);
  await getTestDb().execute(sql`UPDATE session_log SET extracted = false`);
  await runColdPath(deps, job);
  const runs = await getTestDb().execute(sql`SELECT count(*)::int AS n FROM user_mind_run`);
  expect(runs.rows[0]!.n).toBe(1);
  expect(deps.queue.jobs.filter((j) => j.name === "user_mind_run")).toHaveLength(1);
});

test("a crisis exchange records no run", async () => {
  const deps = depsWith();
  const userId = await createTestUser();
  const { job } = await exchange(userId, "my dog is called Biscuit", "here for you", 1, true);
  await runColdPath(deps, job);
  const runs = await getTestDb().execute(sql`SELECT count(*)::int AS n FROM user_mind_run`);
  expect(runs.rows[0]!.n).toBe(0);
});

test("an ordinary exchange records no run", async () => {
  const deps = depsWith();
  const userId = await createTestUser();
  const { job } = await exchange(userId, "hey", "hey you", 1);
  await runColdPath(deps, job);
  const runs = await getTestDb().execute(sql`SELECT count(*)::int AS n FROM user_mind_run`);
  expect(runs.rows[0]!.n).toBe(0);
});
```

(If the existing test file's `extracted` column or flagging mechanics differ, follow what its other retry/crisis tests do.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Encode.** Add `insertedSaliences: []` to the outcome initialiser and the type (doc: "Salience of each fact row inserted, for the big-event check."); at each of the three `outcome.inserted += 1;` sites also `outcome.insertedSaliences.push(fact.salience);`.

- [ ] **Step 4: `updateRelationship` returns before/after.** Change its return type and end with:

```ts
return {
  before: { params, makeUp: row.make_up_state },
  after: { params: affect.params, makeUp: transition.state.make_up_state },
};
```

(`row` comes from `lockRelationship`; if `make_up_state` lives on `toRelationshipState(row)` instead, read it from there.)

- [ ] **Step 5: Cold path.** In `runColdPath`:
  - `updateRelationshipSafely` returns the update's result or `null` on failure (change its return type, `return await tx.transaction(...)`, `return null` in the catch).
  - After it (inside the outer transaction, still under the per-user lock), when `!crisis`:

```ts
// A big event makes her think about them; recorded with the exchange so it runs exactly once.
const triggers = crisis
  ? []
  : detectBigEvents({
      before: relationship?.before ?? null,
      after: relationship?.after ?? null,
      newFactSaliences: applied.insertedSaliences,
      settings: config.user_mind.triggers,
      source: "exchange",
    });
const userMindRunId = await recordBigEvents(deps, tx, job.userId, `exchange:${job.replyTurnId ?? turns.at(-1)!.id}`, triggers);
return { status: "done", applied, userMindRunId };
```

  where `relationship` is the result of `updateRelationshipSafely` (null for a reach-out-only exchange).
  - Wrap: `const outcome = await db.transaction(...)`; after it, `if (outcome.userMindRunId) await enqueueUserMindRun(deps, outcome.userMindRunId); return outcome;`.

- [ ] **Step 6: Run** cold path tests → PASS (all, including the existing ones).

- [ ] **Step 7: Tick test (failing first).** Append to the daily tick test file:

```ts
test("a band crossing from fade records a tick run; a quiet tick records none", async () => {
  const deps = makeTestDeps();
  const db = getTestDb();
  const seeded = new Date("2026-01-04T10:00:00Z");
  const now = new Date("2026-01-06T10:00:00Z"); // 48 h later: one hurt half-life
  async function withHurt(value: number) {
    const u = await createTestUser();
    await rel.ensureRelationship(db, u, seeded, deps.config.relationship);
    const row = await rel.getRelationshipRow(db, u);
    const params = await rel.getParams(db, u);
    await rel.saveRelationship(db, u, {
      state: rel.toRelationshipState(row!),
      params: { ...params, hurt: { ...params.hurt, value, updated_at: seeded } },
    });
    return u;
  }
  const crossing = await withHurt(0.3); // fades to ~0.15, under the 0.25 band
  const quiet = await withHurt(0.1); // fades to ~0.05, crosses nothing
  await tickUser(deps, crossing, now);
  await tickUser(deps, quiet, now);
  const runs = await db.execute(sql`SELECT user_id, source_ref, triggers FROM user_mind_run`);
  expect(runs.rows).toHaveLength(1);
  expect(runs.rows[0]).toMatchObject({ user_id: crossing, source_ref: "tick:2026-01-06" });
  expect(runs.rows[0]!.triggers).toEqual([
    expect.objectContaining({ kind: "param_band", param: "hurt" }),
  ]);
  expect(deps.queue.jobs.filter((j) => j.name === "user_mind_run")).toHaveLength(1);
});
```

(Add `import { sql } from "drizzle-orm";`. If the tick reads fade from a different timestamp than `hurt.updated_at`, or `tick_local_hour` 4 in UTC means 10:00 UTC already passes, check `relationshipAfterDailyTick` and adjust only the seeded values, not the assertions.)

- [ ] **Step 8: Tick.** In `tickUser`, widen deps to `Pick<Deps, "db" | "config" | "clock" | "queue" | "log">`, capture the run id from inside the transaction:

```ts
const runId = await deps.db.transaction(async (tx) => {
  // ... existing body up to insertRelationshipEvents ...
  return recordBigEvents(
    deps,
    tx,
    userId,
    `tick:${localDate}`,
    detectBigEvents({
      before: { params, makeUp: row.make_up_state },
      after: { params: transition.params, makeUp: transition.state.make_up_state },
      newFactSaliences: [],
      settings: deps.config.user_mind.triggers,
      source: "tick",
    }),
  );
});
if (runId) await enqueueUserMindRun(deps, runId);
```

(The early `return` inside the transaction for "already ticked" becomes `return null`.) Widen `relationshipDailyTick`'s deps to match; `src/worker/state-jobs.ts` already passes full `deps`. Fix any other caller `pnpm typecheck` flags (the eval runner passes full deps).

- [ ] **Step 9: Run** `pnpm vitest run tests/mind/state tests/mind/process/cold-path tests/mind/memory` and `pnpm typecheck` → PASS.

- [ ] **Step 10: Commit** `feat(user-mind): record big events from the cold path and the relationship tick`.

---

### Task 8: The summary slot in replies

**Files:**
- Modify: `src/mind/process/hot-path/assemble.ts`, `src/mind/process/hot-path/compose.ts`
- Test: `tests/mind/process/hot-path/assemble.test.ts`, `tests/mind/process/hot-path/compose.test.ts` (append)

**Interfaces:**
- Consumes: `liveSummary` (Task 1).
- Produces: `AssembleInput.summary?: { where_things_stand: string; whats_live: string; how_i_feel: string } | null`.

- [ ] **Step 1: Failing assemble tests** (append; reuse the file's base input builder):

```ts
test("the summary sits between you-and-them and what you remember", () => {
  const { system } = assemblePrompt({
    ...baseInput(),
    relationshipSummary: "You're close.",
    summary: { where_things_stand: "Stand.", whats_live: "Live.", how_i_feel: "Feel." },
  });
  const i = system.indexOf("## Where things stand with them\n- Stand.\n- Live.\n- Feel.");
  expect(i).toBeGreaterThan(system.indexOf("## You and them"));
  const memory = system.indexOf("## What you remember");
  if (memory !== -1) expect(i).toBeLessThan(memory);
});

test("no summary, no section", () => {
  expect(assemblePrompt({ ...baseInput(), summary: null }).system).not.toContain(
    "Where things stand",
  );
});
```

(Use whatever the file calls its base input factory.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** in `assemble.ts`: add the field to `AssembleInput` (doc: "Her latest summary of where things stand with them; null before one exists or in a crisis."), and after the "You and them" section:

```ts
section(
  "Where things stand with them",
  input.summary
    ? [input.summary.where_things_stand, input.summary.whats_live, input.summary.how_i_feel]
        .map((line) => `- ${line}`)
        .join("\n")
    : null,
),
```

Update the file header's section list to include it.

- [ ] **Step 4: Compose.** In `compose.ts`, next to the snapshot read:

```ts
const summary = inCrisis
  ? Promise.resolve(null)
  : bounded(deps, "summary", userId, () => liveSummary(deps.db, userId), null);
```

and pass `summary: ((await summary)?.payload as AssembleInput["summary"]) ?? null` to `assemblePrompt`. Import `AssembleInput` as a type.

- [ ] **Step 5: Failing-then-passing compose test** (append to `compose.test.ts` using its existing reply setup): insert a summary fact for the user (as in Task 5's tests, with a payload), compose a reply, assert the captured `deps.llm.calls.at(-1)!.system` contains `## Where things stand with them`; then `forgetFact` it, compose again, assert the section is absent; and a crisis reply (use the file's crisis helper) never contains it.

- [ ] **Step 6: Run** `pnpm vitest run tests/mind/process/hot-path` → PASS.

- [ ] **Step 7: Commit** `feat(reply): read her summary of where things stand`.

---

### Task 9: Eval harness and the `exit:user` review run

**Files:**
- Modify: `evals/lib/scheduler.ts`, `evals/lib/profile.ts`, `package.json`, `tests/helpers/llm.ts`
- Create: `evals/scripts/user-mind-week.yaml`
- Test: `tests/evals/profile.test.ts` (existing must pass), `pnpm eval --llm=fake --compare`

**Interfaces:**
- Consumes: `runUserMind`, `USER_MIND_RUN_QUEUE` (Task 6).
- Produces: eval runs drain user mind runs right after the cold path; `user_summarise` is a known real purpose; `CapturingLLM` echoes a canary into `user_summarise` output.

- [ ] **Step 1: Scheduler.** In `drainColdPath`, after the cold path loop, drain user mind runs (a cold path enqueues them; runs never re-enqueue):

```ts
for (const job of queue.drain((j) => j.name === USER_MIND_RUN_QUEUE)) {
  if (job.name === USER_MIND_RUN_QUEUE) await runUserMind(deps, job.data);
}
```

Also drain them after the relationship tick in `evals/lib/runner.ts` (find the `relationshipDailyTick` call near line 570 and call the same drain right after; export a small `drainUserMind(deps, queue)` from `scheduler.ts` and use it in both places).

- [ ] **Step 2: Profile.** Add `"user_summarise"` to `ALL_PURPOSES` in `evals/lib/profile.ts`, after `core_drift_watch`.

- [ ] **Step 3: Canary echo.** In `CapturingLLM.classifyJson` add before the final `return`:

```ts
if (canary && request.purpose === "user_summarise" && handler) {
  const out = (await handler(request.input)) as { how_i_feel: string };
  return request.schema.parse({ ...out, how_i_feel: `${out.how_i_feel} ${canary}` });
}
```

and mention "a user summary" in the class comment's list.

- [ ] **Step 4: Review script** `evals/scripts/user-mind-week.yaml`. Copy the structure of an existing multi-day script (read `evals/scripts/exit-three-sessions.yaml` and `evals/lib/script.ts` for the schema), with one user over a week: day 0 small talk; day 1 a big disclosure ("I got the job in Osaka, I start next month"); day 2 a warm thank-you that should raise trust; day 4 a light hurt and day 5 an apology (make-up); day 6 casual. Assertions: one structural assertion the script schema supports that holds in fake mode (e.g. a `relationship` or `core` assertion already used by other scripts); the review output is what matters.

- [ ] **Step 5: package.json.**

```json
"exit:user": "tsx --env-file-if-exists=.env evals/run.ts --only user-mind-week --runs 1 --review --trace --real extract,user_summarise",
```

- [ ] **Step 6: Run** `pnpm vitest run tests/evals` and `pnpm eval --llm=fake --compare` → PASS / no regressions (a new script has no baseline: follow how earlier phases added scripts to `evals/baseline.json`).

- [ ] **Step 7: Commit** `feat(evals): drain user mind runs, user_summarise real purpose, exit:user review run`.

---

### Task 10: Phase 9a exit test and the canary

**Files:**
- Create: `tests/exit/phase-9a.test.ts`
- Modify: `tests/exit/mind-split.test.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write** `tests/exit/phase-9a.test.ts` (all fake, scripted extraction, direct calls like `cold-path.test.ts` rather than the eval runner, so each assertion is exact):

```ts
/**
 * Phase 9a exit, all fake: a big event becomes exactly one user mind batch, whose summary she
 * reads in her next reply; retries, idle days and the daily cap add nothing; a lost job is swept;
 * a second summary supersedes the first; core is untouched throughout.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { insertTurn } from "@/db/repos/user/session-log";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { USER_MIND_RUN_QUEUE } from "@/mind/platform/jobs";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { runUserMind, sweepPendingUserMindRuns } from "@/mind/process/user/run";
import { tickUser } from "@/mind/state/user/relationship/daily-tick";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const CORE_TABLES = ["core_memory", "core_state", "core_goal", "core_snapshot", "core_loop_trace", "core_budget_day"];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`));
    parts.push(...res.rows.map((r) => String(r.j)));
  }
  return parts.join("\n");
}
async function count(table: string, where = "true"): Promise<number> {
  const res = await getTestDb().execute(sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`));
  return Number(res.rows[0]!.n);
}

/** Scripted extraction: "TRUST" raises trust sharply; "BIG" stores a salient fact. */
function deps() {
  const d = makeTestDeps();
  d.llm.handlers.extract = (input: string) => {
    const latest = input.split("New exchange").at(-1) ?? "";
    return {
      facts: latest.includes("BIG")
        ? [{ subject: "user", kind: "event", content: `Big news ${randomUUID()}.`, occurred_at: null,
             salience: 0.9, valence: 0.6, confidence: 0.9, entity_names: [], thread_title: null,
             claim_kind: null }]
        : [],
      entities: [],
      threads: [],
      relationship: latest.includes("TRUST")
        ? { warmth: 0, trust: 1, tension: 0, hurt: null, apology: false, make_up: false,
            ends_relationship: false, retracts_ending: false, wants_repair: false }
        : null,
    };
  };
  return d;
}

async function exchange(d: ReturnType<typeof deps>, userId: string, text: string) {
  d.clock.advance(60_000);
  const session = randomUUID();
  const ut = await insertTurn(d.db, userId, { id: randomUUID(), session_id: session, role: "user", text, created_at: d.clock.now() });
  const ct = await insertTurn(d.db, userId, { id: randomUUID(), session_id: session, role: "companion", text: "ok", created_at: d.clock.now(), reply_to: ut.id });
  return { userId, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] };
}

async function drainRuns(d: ReturnType<typeof deps>) {
  for (const job of d.queue.drain((j) => j.name === USER_MIND_RUN_QUEUE))
    if (job.name === USER_MIND_RUN_QUEUE) await runUserMind(d, job.data);
}

test("one big event, one batch, one summary; a retry adds nothing", async () => {
  const d = deps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  const before = await coreDump();
  const job = await exchange(d, u, "TRUST you were right");
  await runColdPath(d, job);
  await getTestDb().execute(sql`UPDATE session_log SET extracted = false`);
  await runColdPath(d, job);
  await drainRuns(d);
  expect(await count("user_mind_run")).toBe(1);
  expect(await count("user_loop_trace", "loop = 'user_summarise' AND status = 'done'")).toBe(1);
  expect(await count("fact", "kind = 'summary'")).toBe(1);
  expect(await coreDump()).toBe(before);
});

test("an idle user over seven days of ticks runs nothing", async () => {
  const d = deps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  for (let day = 0; day < 7; day++) {
    d.clock.advance(24 * 3_600_000);
    await tickUser(d, u, d.clock.now());
    await drainRuns(d);
  }
  expect(await count("user_mind_run")).toBe(0);
  expect(await count("user_loop_trace")).toBe(0);
});

test("the fourth big event of a day is capped and runs nothing", async () => {
  const d = deps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  for (let i = 0; i < 4; i++) await runColdPath(d, await exchange(d, u, `BIG ${i}`));
  await drainRuns(d);
  expect(await count("user_mind_run", "status = 'done'")).toBe(3);
  expect(await count("user_mind_run", "status = 'capped'")).toBe(1);
  expect(await count("user_loop_trace")).toBe(3);
});

test("a lost enqueue is swept and runs once; the second summary supersedes the first", async () => {
  const d = deps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  await runColdPath(d, await exchange(d, u, "BIG first"));
  await drainRuns(d);
  await runColdPath(d, await exchange(d, u, "BIG second"));
  d.queue.drain((j) => j.name === USER_MIND_RUN_QUEUE); // the job is lost
  d.clock.advance(11 * 60_000);
  expect(await sweepPendingUserMindRuns(d, d.clock.now())).toBe(1);
  await drainRuns(d);
  expect(await sweepPendingUserMindRuns(d, d.clock.now())).toBe(0);
  expect(await count("user_loop_trace")).toBe(2);
  expect(await count("fact", "kind = 'summary' AND status = 'superseded'")).toBe(1);
  expect(await count("fact", "kind = 'summary' AND status NOT IN ('superseded','stale')")).toBe(1);
});
```

Then add the reply-reads-summary check: after the first test's drain, call the hot path the way `tests/mind/process/hot-path/compose.test.ts` does for a normal reply and assert `d.llm.calls.at(-1)!.system` contains `## Where things stand with them`. Adjust the extraction handler's object to match the `extract` zod schema exactly (read `src/mind/memory/user/extract.ts`; e.g. whether `hurt` is `null` or `{ amount: 0, cause: null }`, and whether `claim_kind` is required).

- [ ] **Step 2: Run** `pnpm vitest run tests/exit/phase-9a.test.ts` → PASS (fix the implementation, not the assertions, if something fails).

- [ ] **Step 3: Canary.** In `tests/exit/mind-split.test.ts`:
  - Make sure each user's first session produces a big event in fake mode: the canary extraction already stores a fact with salience 0.9, so Alice's run fires. For Bob, add a scripted extraction in the `run` function only if needed so Bob also gets one run (e.g. when input contains `BOB-SAYS hey`, return one fact with salience 0.9 and no canary).
  - Add `"user_mind_run"` and `"user_loop_trace"` to `BOB_TABLES`.
  - Add a test:

```ts
test("user mind runs stay in their own user's scope", async () => {
  const summarise = llm.seen.filter((c) => c.purpose === "user_summarise");
  const alice = summarise.filter((c) => c.text.includes(TOKEN));
  const bob = summarise.filter((c) => !c.text.includes(TOKEN));
  expect(alice.length).toBeGreaterThan(0);
  expect(bob.length).toBeGreaterThan(0);
  for (const c of bob) expect(c.text).not.toMatch(CANARY);
  // Alice's summary carries the canary (the echo works), and it is hers alone.
  const aliceId = await userIdByName("alice");
  const res = await getTestDb().execute(
    sql`SELECT user_id, content FROM fact WHERE kind = 'summary'`,
  );
  const leaked = res.rows.filter((r) => String(r.content).includes(TOKEN));
  expect(leaked.length).toBeGreaterThan(0);
  for (const r of leaked) expect(String(r.user_id)).toBe(aliceId);
});
```

  - Add `user_summarise` to the probe test's `purposes` with a JSON input `JSON.stringify({ new_memories: [{ content: TOKEN }], what_happened: [] })` and assert its `how_i_feel` contains `TOKEN`.

- [ ] **Step 4: Run** `pnpm vitest run tests/exit` → PASS.

- [ ] **Step 5: Full suite.** `pnpm typecheck && pnpm lint && pnpm test` → all PASS. Record the file/test counts for the docs.

- [ ] **Step 6: Commit** `test(exit): phase 9a exit and user mind canary`.

---

### Task 11: Docs

**Files:**
- Modify: `spica-design-spec-v3.md`, `DECISIONS.md`, `CLAUDE.md`

- [ ] **Step 1: v3 spec.** Update, in v3's voice, with **Built 9a** markers:
  - §6.1: `user_mind_run` (columns, statuses, unique source), `user_loop_trace` (now Built), `summary` kind Built; summaries excluded from retrieval, reconcile and decay.
  - §9.4: the 9a triggers with config keys (`user_mind.triggers.param_jump`, `bands`, `fact_salience`), closeness only on bands, afterglow and `msgs_per_day` never, crisis records nothing; deferred triggers listed as backlog.
  - §9.5: runner (`runUserLoop`, metered, traced, no per-call budget; `max_triggers_per_day` 3 per local date, capped rows), `UserLoopDeps` gets no core layer; the batch is `user_summarise` in 9a; `prompts/user-mind/summarise/v1.md`; `models.user_mind`.
  - §10.3 slot 5: "Where things stand with them", crisis skips.
  - §10.4 step 5: Built.
  - §15 User: cost proportional to big events, cap 3/day, traces with cost from `core.prices`.
  - §17.4: `user_mind_run` job built, sweep inside `cold_path_sweep` (`user_mind.sweep_after_minutes`), no retry.
  - §17.3: the canary covers `user_summarise`.
  - §20: a 9a row in the built table with the `pnpm test` counts; the 9b/9c slicing in the Phase 9 row.
  - §25: new items — **B62** session-averaged tone instead of per-exchange afterglow accumulation, and a sustained-deep-conversation signal that deepens params per param (Ethan, 2026-10-09) *Phase 10*; **B63** deferred triggers (long conversation ends, crisis passed, stale summary before a reach-out) *Tuning*; **B64** a run left `running` by a crash is never retried *Later*; **B65** the cap's count-then-insert can race between the cold path and the tick for one user *Later*. Retarget B26 → *Phase 9b*, B2 → *Phase 9c*.
- [ ] **Step 2: DECISIONS.md.** One line each: durable run row over a singleton key; trigger thresholds 0.15 / [0.25, 0.5, 0.75] / 0.8 and cap 3 as test-phase defaults; summarise bounds (20 facts, 5 threads, 300 chars, 512 tokens, salience 0.6, confidence 0.7); summary stored as a `shared` fact superseded per run; summaries excluded from retrieval, reconcile and decay; failed runs not retried; user loops reuse `core.prices` and `core.max_retries`; the sweep rides on `cold_path_sweep`.
- [ ] **Step 3: CLAUDE.md.** Current phase line: "Phase 9a (user mind foundation) built; 9b (reflect, ideate, outreach candidates) next, needs a design doc."
- [ ] **Step 4: Delete this plan and the 9a spec?** No — they are deleted once the whole slice is merged and Ethan confirms (the project prunes finished plans in a `chore:` commit). Leave them.
- [ ] **Step 5:** `pnpm lint` (Prettier covers markdown), then commit `docs: record phase 9a user mind foundation`.
