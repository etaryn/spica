# Phase 9d: User Consolidate, User Model, Full Phase 9 Exit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the last two user-mind loops (`user_consolidate`, `user_model`), the "Your read on them" reply slot, and the full Phase 9 exit run.

**Architecture:** Both loops join the existing triggered batch in `runUserMind` (summarise → reflect → model → ideate → consolidate), each through `runUserLoop` with its own `user_loop_trace`. They write three new user `fact` kinds (`episode`, `model`, `belief`). The reply reads the live model in its own slot; gists and beliefs come back through ordinary retrieval. The exit drives two weeks through `runScript`, whose life loop now also runs the hourly `user_mind_tick`.

**Tech Stack:** TypeScript, Postgres 16 + pgvector, Drizzle, Zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-09-phase-9d-consolidate-model-exit-design.md` (read it with this plan). v3 (`spica-design-spec-v3.md`) §6.1, §9, §10.3 for context.

## Global Constraints

- Every numeric constant lives in `config/default.json` and its Zod schema in `src/mind/platform/config.ts`.
- Every prompt is a versioned file under `prompts/`; a prompt nothing configures is deleted.
- `src/mind` is framework-free: no `Date.now()`, no `process.env`; time comes from `deps.clock`.
- Every file starts with a short plain-English header; comments say why, never cite spec sections or phases.
- Prettier at 100 columns; `pnpm lint` must pass.
- User loops read only this user's memory and state plus her latest snapshot text; nothing user-scoped reaches core.
- Anything a crisis touched (`payload.sensitive`) never reaches ideate, a reach-out, or a gist; what a loop writes from it is marked `sensitive`.
- Invalid model output in a user loop throws and is traced `failed`, like the other user loops (the spec's "fallback trace" for consolidate is replaced by this; Task 9 corrects the spec text).
- Definition of done per task: `pnpm typecheck`, `pnpm lint`, `pnpm test` green.

## Review Focus

1. A user with no or an invalid timezone: weeks and the 7-day cutoff are computed in UTC (Task 2 test).
2. `user_model` returns a `replaces` id it was not shown (another user's belief, a garbage string, an already superseded belief): ignored, the new belief is simply inserted (Task 3 test).
3. A new belief nearly identical to the belief it replaces: dropped as a duplicate, and the old belief stays live (Task 3 test).
4. A malformed `model` payload in the DB: the reply slot renders nothing, the reply still goes out (Task 5 test).
5. A sensitive model: never in a reach-out, never in ideate's input; a reply still reads it (Tasks 4 and 5 tests).

---

### Task 1: New fact kinds and where they are read

**Files:**
- Modify: `src/db/schema.ts` (`factKind` enum, ~line 84)
- Create: `src/db/migrations/0026_<generated>.sql` (via `pnpm db:generate`)
- Modify: `src/db/repos/user/facts.ts` (`candidateFacts` ~line 52, `nearFacts` ~line 90, `listFactsForSummary` ~line 180)
- Modify: `src/db/repos/admin/decay.ts:16,20`
- Modify: `src/mind/memory/user/extract.ts:22`
- Test: `tests/db/user-mind-repos.test.ts`

**Interfaces:**
- Produces: `fact_kind` values `episode`, `model`, `belief`. Retrieval (`candidateFacts`) excludes `summary`, `idea`, `model`. Reconcile (`nearFacts`) and loop inputs (`listFactsForSummary`) exclude `summary`, `reflection`, `idea`, `episode`, `model`, `belief`. Decay excludes `summary`, `idea`, `model`.

- [ ] **Step 1: Write the failing test** (append to `tests/db/user-mind-repos.test.ts`; add the imports it needs at the top: `candidateFacts`, `getFact`, `listFactsForSummary`, `nearFacts` from `@/db/repos/user/facts`, `adminDecayFacts` from `@/db/repos/admin/decay`)

```ts
test("her model stays out of retrieval and decay; gists, models and beliefs are never reconcile neighbours or new memories", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const old = new Date("2025-12-01T09:00:00Z");
  const add = (kind: "episode" | "model" | "belief") =>
    insertFact(db, u, {
      subject: kind === "episode" ? "shared" : "user",
      kind,
      content: `A ${kind}.`,
      embedding: vec(),
      created_at: old,
      status: kind === "episode" ? "recurring" : "open",
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: "generated",
    });
  const episode = await add("episode");
  const model = await add("model");
  const belief = await add("belief");

  const retrieved = (await candidateFacts(db, u, vec(), 10)).map((f) => f.id);
  expect(retrieved).toContain(episode.id);
  expect(retrieved).toContain(belief.id);
  expect(retrieved).not.toContain(model.id);
  expect(await nearFacts(db, u, "user", vec(), 10, 0)).toEqual([]);
  expect(await nearFacts(db, u, "shared", vec(), 10, 0)).toEqual([]);
  expect(await listFactsForSummary(db, u, null, [], 10)).toEqual([]);

  await adminDecayFacts(db, new Date("2026-01-05T09:00:00Z"), {
    grace_days: 3,
    rate: 0.5,
    stale_floor: 0.05,
    dormant_after_days: 30,
  });
  expect((await getFact(db, u, model.id))!.salience).toBe(0.5);
  expect((await getFact(db, u, belief.id))!.salience).toBeLessThan(0.5);
  expect((await getFact(db, u, episode.id))!.salience).toBeLessThan(0.5);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm vitest run tests/db/user-mind-repos.test.ts`
Expected: FAIL, `invalid input value for enum fact_kind: "episode"`.

- [ ] **Step 3: Add the kinds and generate the migration**

In `src/db/schema.ts` append to `factKind` after `"idea"`:

```ts
  "idea",
  "episode",
  "model",
  "belief",
]);
```

Run: `pnpm db:generate`
Expected: a new `src/db/migrations/0026_*.sql` containing exactly three `ALTER TYPE "public"."fact_kind" ADD VALUE ...` statements, plus the updated `meta/` snapshot and journal. If it contains anything else, stop and investigate.

- [ ] **Step 4: Update the filters**

`src/db/repos/user/facts.ts`, in `candidateFacts`:

```ts
        -- The summary, her ideas and her read on them have their own slots in the reply.
        AND f.kind NOT IN ('summary', 'idea', 'model')
```

In `nearFacts`:

```ts
        -- What she wrote herself after a big event is never a reconcile neighbour.
        AND kind NOT IN ('summary', 'reflection', 'idea', 'episode', 'model', 'belief')
```

In `listFactsForSummary`:

```ts
        notInArray(fact.kind, ["summary", "reflection", "idea", "episode", "model", "belief"]),
```

Also update `listFactsForSummary`'s doc comment: "Her own summaries, reflections, ideas, gists, reads and beliefs are left out: a loop never reads its own output."

`src/db/repos/admin/decay.ts`, both statements:

```sql
AND kind NOT IN ('summary', 'idea', 'model')
```

`src/mind/memory/user/extract.ts:22`:

```ts
const extractableKind = z
  .enum(factKind.enumValues)
  .exclude(["summary", "reflection", "idea", "episode", "model", "belief"]);
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/db/user-mind-repos.test.ts tests/mind/memory`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/migrations src/db/repos/user/facts.ts src/db/repos/admin/decay.ts src/mind/memory/user/extract.ts tests/db/user-mind-repos.test.ts
git commit -m "feat(memory): user episode, model and belief kinds with their read rules"
```

---

### Task 2: `user_consolidate`

**Files:**
- Modify: `src/mind/platform/timezone.ts` (export `shiftLocalDate`)
- Modify: `src/mind/process/core/consolidate.ts` (use it; delete local `daysBefore`)
- Create: `src/db/repos/user/gist.ts`
- Create: `src/mind/process/user/consolidate.ts`
- Create: `prompts/user-mind/consolidate/v1.md`
- Modify: `src/mind/process/user/runner.ts` (`UserLoopName`)
- Modify: `src/mind/platform/config.ts`, `config/default.json`
- Modify: `src/mind/platform/llm/fake.ts` (default `user_consolidate` handler)
- Test: `tests/mind/process/user/consolidate.test.ts`, `tests/mind/platform/timezone.test.ts`

**Interfaces:**
- Consumes: kinds from Task 1.
- Produces:
  - `shiftLocalDate(date: string, days: number): string` in `@/mind/platform/timezone`.
  - `@/db/repos/user/gist`: `type GistWindow = { before: string; tz: string }`, `type GistSource = { id: string; content: string; occurred_at: Date; salience: number }`, `oldestGistGroup(db: Db, userId: string, w: GistWindow & { minGroup: number; maxSources: number }): Promise<{ week: string; sources: GistSource[] } | null>`, `gistFacts(db: Db, userId: string, ids: string[], gistId: string, factor: number, w: GistWindow): Promise<boolean>`.
  - `userConsolidate(deps: UserLoopDeps, run: { id: string; user_id: string }): Promise<"done" | "failed">` in `@/mind/process/user/consolidate`.
  - `UserLoopName` gains `"user_consolidate"` and `"user_model"` (Task 3 uses the latter).
  - Config `user_mind.consolidate.{gist_after_days, min_group, max_sources, gist_source_factor, max_chars, max_tokens, confidence}`, `prompts.user_consolidate`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mind/platform/timezone.test.ts` (add `shiftLocalDate` to its import):

```ts
test("shiftLocalDate moves across month and year ends", () => {
  expect(shiftLocalDate("2026-01-05", -7)).toBe("2025-12-29");
  expect(shiftLocalDate("2026-02-28", 1)).toBe("2026-03-01");
});
```

Create `tests/mind/process/user/consolidate.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { getFact, insertFact, setFactStatus } from "@/db/repos/user/facts";
import { insertThread, resolveThread } from "@/db/repos/user/threads";
import { setTimezone } from "@/db/repos/user/users";
import { insertRun } from "@/db/repos/user/user-mind";
import { oldestGistGroup } from "@/db/repos/user/gist";
import { userConsolidate } from "@/mind/process/user/consolidate";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { sequence } from "../../../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

// The test clock is Monday 2026-01-05 09:00 UTC, so the cutoff is 2025-12-29: weeks starting
// 2025-12-15 and 2025-12-22 are old enough.
async function setup() {
  const base = makeTestDeps();
  const userId = await createTestUser();
  const deps = { ...base, snapshot: "She loves old films." };
  const run = (await insertRun(base.db, userId, {
    sourceRef: "exchange:a",
    triggers: [{ kind: "salient_fact", salience: 0.9 }],
    localDate: "2026-01-05",
    now: base.clock.now(),
    cap: 9,
  }))!;
  return { deps, userId, run };
}

type Extra = Partial<Parameters<typeof insertFact>[2]>;
function memory(
  deps: ReturnType<typeof makeTestDeps>,
  userId: string,
  content: string,
  at: string,
  extra: Extra = {},
) {
  return insertFact(deps.db, userId, {
    subject: "user",
    kind: "event",
    content,
    embedding: vec(),
    occurred_at: new Date(at),
    created_at: new Date(at),
    status: "open",
    salience: 0.6,
    valence: 0.2,
    confidence: 0.9,
    source: "turn",
    ...extra,
  });
}

test("folds the oldest old-enough week into one gist and weighs its sources down once", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_consolidate = sequence(
    { gist: "The week they started packing." },
    { gist: "The week of the farewells." },
  );
  const a = await memory(deps, userId, "They bought boxes.", "2025-12-16T10:00:00Z");
  const b = await memory(deps, userId, "They felt torn.", "2025-12-17T10:00:00Z", {
    kind: "feeling",
  });
  const c = await memory(deps, userId, "They packed books.", "2025-12-18T10:00:00Z");
  for (const d of ["2025-12-22", "2025-12-23", "2025-12-24"])
    await memory(deps, userId, `Farewell on ${d}.`, `${d}T10:00:00Z`);

  expect(await userConsolidate(deps, run)).toBe("done");
  const gists = await deps.db.execute(
    sql`SELECT * FROM fact WHERE kind = 'episode' ORDER BY created_at`,
  );
  expect(gists.rows).toHaveLength(1);
  const gist = gists.rows[0]!;
  expect(gist).toMatchObject({
    subject: "shared",
    source: "generated",
    status: "recurring",
    content: "The week they started packing.",
    salience: 0.6,
  });
  expect(String(gist.source_ref)).toMatch(/^user_consolidate:/);
  expect(new Date(String(gist.occurred_at)).toISOString()).toBe("2025-12-16T10:00:00.000Z");
  expect((gist.payload as { gist_of: string[] }).gist_of.sort()).toEqual([a.id, b.id, c.id].sort());
  for (const id of [a.id, b.id, c.id]) {
    const f = (await getFact(deps.db, userId, id))!;
    expect(f.salience).toBeCloseTo(0.3);
    expect(f.payload).toMatchObject({ gisted_into: gist.id });
  }
  const call = JSON.parse(deps.llm.structuredCalls.at(-1)!.input);
  expect(call.week).toBe("2025-12-15");
  expect(call.sources.map((s: { content: string }) => s.content)).toEqual([
    "They bought boxes.",
    "They felt torn.",
    "They packed books.",
  ]);

  // The next run takes the next week; a third finds nothing and makes no call.
  expect(await userConsolidate(deps, run)).toBe("done");
  const calls = deps.llm.structuredCalls.length;
  expect(await userConsolidate(deps, run)).toBe("done");
  expect(deps.llm.structuredCalls.length).toBe(calls);
  const traces = await deps.db.execute(
    sql`SELECT calls, outputs FROM user_loop_trace WHERE loop = 'user_consolidate' ORDER BY created_at, id`,
  );
  expect(traces.rows.map((r) => Number(r.calls))).toContain(0);
  expect((await getFact(deps.db, userId, a.id))!.salience).toBeCloseTo(0.3);
});

test("too recent, sensitive, on an open storyline, already gisted, wrong kind or inactive stay out", async () => {
  const { deps, userId, run } = await setup();
  const at = "2025-12-23T10:00:00Z";
  await memory(deps, userId, "They moved desks.", at);
  await memory(deps, userId, "They had a hard night.", at, { payload: { sensitive: true } });
  await memory(deps, userId, "They like tea.", at, { kind: "preference" });
  await memory(deps, userId, "Old news.", at, { status: "superseded" });
  await memory(deps, userId, "Already folded.", at, { payload: { gisted_into: "x" } });
  await memory(deps, userId, "Too recent.", "2025-12-29T10:00:00Z");
  const thread = await insertThread(
    deps.db,
    userId,
    { title: "The audition", subject: "user", stakes: "med", next_checkpoint: null },
    new Date(at),
  );
  await memory(deps, userId, "They practised lines.", at, { thread_id: thread.id });
  await memory(deps, userId, "They felt ready.", at, { kind: "feeling" });

  expect(await userConsolidate(deps, run)).toBe("done");
  expect(deps.llm.structuredCalls.some((c) => c.purpose === "user_consolidate")).toBe(false);

  // Once the storyline closes, its memory is history and the week has three.
  await resolveThread(deps.db, userId, thread.id, deps.clock.now());
  deps.llm.handlers.user_consolidate = sequence({ gist: "The audition week." });
  expect(await userConsolidate(deps, run)).toBe("done");
  const input = JSON.parse(
    deps.llm.structuredCalls.find((c) => c.purpose === "user_consolidate")!.input,
  );
  expect(input.sources.map((s: { content: string }) => s.content).sort()).toEqual([
    "They felt ready.",
    "They moved desks.",
    "They practised lines.",
  ]);
});

test("weeks and the cutoff follow the user's timezone, and UTC when it is invalid", async () => {
  const { deps, userId } = await setup();
  // Sunday 12:00 UTC is already Monday 01:00 in Auckland.
  for (const content of ["One.", "Two.", "Three."])
    await memory(deps, userId, content, "2025-12-21T12:00:00Z");
  const w = { before: "2025-12-29", minGroup: 3, maxSources: 12 };
  await setTimezone(deps.db, userId, "Pacific/Auckland");
  expect((await oldestGistGroup(deps.db, userId, { ...w, tz: "Pacific/Auckland" }))!.week).toBe(
    "2025-12-22",
  );
  expect((await oldestGistGroup(deps.db, userId, { ...w, tz: "UTC" }))!.week).toBe("2025-12-15");

  const { deps: d2, userId: u2, run: r2 } = await setup();
  await setTimezone(d2.db, u2, "Not/AZone");
  for (const content of ["A.", "B.", "C."]) await memory(d2, u2, content, "2025-12-21T12:00:00Z");
  d2.llm.handlers.user_consolidate = sequence({ gist: "Gist." });
  expect(await userConsolidate(d2, r2)).toBe("done");
  const input = JSON.parse(d2.llm.structuredCalls.at(-1)!.input);
  expect(input.week).toBe("2025-12-15");
});

test("at most max_sources, the most salient; a group that changed while she wrote leaves no gist", async () => {
  const { deps, userId, run } = await setup();
  deps.config.user_mind.consolidate.max_sources = 3;
  const rows = [];
  for (const [i, s] of [0.2, 0.9, 0.8, 0.7].entries())
    rows.push(
      await memory(deps, userId, `M${i}.`, `2025-12-2${2 + i}T10:00:00Z`, { salience: s }),
    );
  deps.llm.handlers.user_consolidate = async () => {
    // Reconcile supersedes a source while the model writes.
    await setFactStatus(deps.db, userId, rows[1]!.id, "superseded");
    return { gist: "A week." };
  };
  expect(await userConsolidate(deps, run)).toBe("done");
  const input = JSON.parse(deps.llm.structuredCalls.at(-1)!.input);
  expect(input.sources.map((s: { content: string }) => s.content)).toEqual(["M1.", "M2.", "M3."]);
  const gists = await deps.db.execute(sql`SELECT id FROM fact WHERE kind = 'episode'`);
  expect(gists.rows).toHaveLength(0);
  expect((await getFact(deps.db, userId, rows[2]!.id))!.salience).toBeCloseTo(0.8);
});

test("empty output fails the loop and writes nothing", async () => {
  const { deps, userId, run } = await setup();
  for (const d of ["2025-12-22", "2025-12-23", "2025-12-24"])
    await memory(deps, userId, `On ${d}.`, `${d}T10:00:00Z`);
  deps.llm.handlers.user_consolidate = sequence({ gist: "" });
  expect(await userConsolidate(deps, run)).toBe("failed");
  const gists = await deps.db.execute(sql`SELECT id FROM fact WHERE kind = 'episode'`);
  expect(gists.rows).toHaveLength(0);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run tests/mind/process/user/consolidate.test.ts tests/mind/platform/timezone.test.ts`
Expected: FAIL, cannot resolve `@/db/repos/user/gist` and `shiftLocalDate` is not exported.

- [ ] **Step 3: Export the date shift and reuse it in core**

`src/mind/platform/timezone.ts`: rename the private `shiftDate` to an exported `shiftLocalDate` with a doc comment, and update `previousLocalDate` / `nextLocalDate` to call it:

```ts
/** A "YYYY-MM-DD" date moved by `days` (calendar arithmetic, no time zone). */
export function shiftLocalDate(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}
```

`src/mind/process/core/consolidate.ts`: delete `daysBefore`, import `shiftLocalDate` from `@/mind/platform/timezone`, and replace `daysBefore(day, bounds.gist_after_days)` with `shiftLocalDate(day, -bounds.gist_after_days)`.

- [ ] **Step 4: Write the repo** — `src/db/repos/user/gist.ts`

```ts
/**
 * Which of one user's older memories can fold into a gist, and the fold itself. A memory is
 * history once its week is old enough and its storyline, if any, has closed; anything a crisis
 * touched never folds.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { fact } from "@/db/schema";

/** `before`: the local date memories must predate; `tz`: the user's zone. */
export type GistWindow = { before: string; tz: string };
export type GistSource = { id: string; content: string; occurred_at: Date; salience: number };

const dated = sql`COALESCE(${fact.occurred_at}, ${fact.created_at})`;
const week = (tz: string) =>
  sql<string>`date_trunc('week', ${dated} AT TIME ZONE ${tz})::date::text`;

function eligible(userId: string, w: GistWindow) {
  return and(
    eq(fact.user_id, userId),
    eq(fact.scope, "private"),
    inArray(fact.kind, ["event", "feeling"]),
    inArray(fact.subject, ["user", "shared"]),
    inArray(fact.status, ["open", "resolved"]),
    sql`COALESCE((${fact.payload}->>'sensitive')::boolean, false) = false`,
    sql`NOT (COALESCE(${fact.payload}, '{}'::jsonb) ? 'gisted_into')`,
    sql`(${fact.thread_id} IS NULL OR NOT EXISTS (
      SELECT 1 FROM thread t WHERE t.id = ${fact.thread_id} AND t.status = 'open'))`,
    sql`(${dated} AT TIME ZONE ${w.tz})::date < ${w.before}::date`,
  );
}

/** The oldest Monday-start local week with at least `minGroup` memories, its most salient first. */
export async function oldestGistGroup(
  db: Db,
  userId: string,
  w: GistWindow & { minGroup: number; maxSources: number },
): Promise<{ week: string; sources: GistSource[] } | null> {
  const [first] = await db
    .select({ week: week(w.tz) })
    .from(fact)
    .where(eligible(userId, w))
    .groupBy(sql`1`)
    .having(sql`count(*) >= ${w.minGroup}`)
    .orderBy(sql`1`)
    .limit(1);
  if (!first) return null;
  // ponytail: the less salient rest of a week past max_sources can gist again later; group them
  // with the first gist if a doubled week reads badly
  const rows = await db
    .select({
      id: fact.id,
      content: fact.content,
      occurred_at: fact.occurred_at,
      created_at: fact.created_at,
      salience: fact.salience,
    })
    .from(fact)
    .where(and(eligible(userId, w), sql`${week(w.tz)} = ${first.week}`))
    .orderBy(desc(fact.salience), fact.id)
    .limit(w.maxSources);
  const sources = rows
    .map((r) => ({
      id: r.id,
      content: r.content,
      occurred_at: r.occurred_at ?? r.created_at,
      salience: r.salience,
    }))
    // In time order, as she remembers the week.
    .sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime() || a.id.localeCompare(b.id));
  return { week: first.week, sources };
}

/**
 * Marks the sources as folded into `gistId` and weighs them down once. False, changing nothing,
 * when any source is no longer eligible or they no longer share one week.
 */
export async function gistFacts(
  db: Db,
  userId: string,
  ids: string[],
  gistId: string,
  factor: number,
  w: GistWindow,
): Promise<boolean> {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return false;
  const rows = await db
    .select({ id: fact.id, week: week(w.tz) })
    .from(fact)
    .where(and(eligible(userId, w), inArray(fact.id, ids)))
    .for("update");
  if (rows.length !== ids.length || new Set(rows.map((r) => r.week)).size !== 1) return false;
  await db
    .update(fact)
    .set({
      payload: sql`COALESCE(${fact.payload}, '{}'::jsonb) || ${JSON.stringify({ gisted_into: gistId })}::jsonb`,
      salience: sql`${fact.salience} * ${factor}::real`,
    })
    .where(and(eq(fact.user_id, userId), inArray(fact.id, ids)));
  return true;
}
```

- [ ] **Step 5: Config, prompt, runner name, fake**

`src/mind/platform/config.ts`, in `userMind` after `ideate`:

```ts
  consolidate: z.object({
    gist_after_days: positiveInt,
    min_group: positiveInt,
    max_sources: positiveInt,
    gist_source_factor: unit,
    max_chars: positiveInt,
    max_tokens: positiveInt,
    confidence: unit,
  }),
```

and in `prompts` after `user_ideate`: `user_consolidate: promptVersion,`.

`config/default.json`: in `user_mind` after `ideate`:

```json
    "consolidate": {
      "gist_after_days": 7,
      "min_group": 3,
      "max_sources": 12,
      "gist_source_factor": 0.5,
      "max_chars": 300,
      "max_tokens": 512,
      "confidence": 0.6
    }
```

and in `prompts`: `"user_consolidate": "v1"`.

`src/mind/process/user/runner.ts`:

```ts
export type UserLoopName =
  | "user_summarise"
  | "user_reflect"
  | "user_model"
  | "user_ideate"
  | "user_consolidate";
```

`prompts/user-mind/consolidate/v1.md`:

```md
You are Spica, thinking privately about one person you talk to. Look back at one week of what
they told you and keep it as one memory: what that stretch was like for them, the way you'd
remember it later ("the week you were packing for Osaka").

Input is JSON: `who_you_are` (your latest sense of yourself), `week` (the Monday it began), and
`sources` (what you remembered from that week, in order, each with its date).

Return JSON: `gist` is one or two short sentences in your own voice, first person, about them or
the two of you.

Use only what the sources say. Keep what mattered and how it felt; drop the small details. Don't
add anything that isn't there.
```

`src/mind/platform/llm/fake.ts`, after `user_ideate`:

```ts
    // Deterministic: the week's memories in one line, so a canary in a source carries through.
    user_consolidate: (input: string) => {
      const ctx = JSON.parse(input) as { sources: { content: string }[] };
      return { gist: `That week: ${ctx.sources.map((s) => s.content).join(" ")}`.slice(0, 280) };
    },
```

- [ ] **Step 6: Write the loop** — `src/mind/process/user/consolidate.ts`

```ts
/**
 * Her memory of an older week with one user, folded into one gist after a big event: the shape of
 * that stretch, so a later conversation can recall "the week you were packing" instead of each
 * fact. The facts stay, weighed down once. Anything a crisis touched is never folded in.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { insertFact } from "@/db/repos/user/facts";
import { gistFacts, oldestGistGroup } from "@/db/repos/user/gist";
import { getTimezone } from "@/db/repos/user/users";
import { fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { isValidTimeZone, localDateString, shiftLocalDate } from "@/mind/platform/timezone";
import { runUserLoop, type UserLoopDeps } from "./runner";

export async function userConsolidate(
  deps: UserLoopDeps,
  run: { id: string; user_id: string },
): Promise<"done" | "failed"> {
  const { config, db } = deps;
  const settings = config.user_mind.consolidate;
  const userId = run.user_id;
  return runUserLoop(deps, run, "user_consolidate", async (ctx) => {
    const now = deps.clock.now();
    const raw = await getTimezone(db, userId);
    const tz = raw && isValidTimeZone(raw) ? raw : "UTC";
    const window = { before: shiftLocalDate(localDateString(now, tz), -settings.gist_after_days), tz };
    const group = await oldestGistGroup(db, userId, {
      ...window,
      minGroup: settings.min_group,
      maxSources: settings.max_sources,
    });
    if (!group) return { inputs: { week: null }, outputs: { gist_id: null }, promptVersion: null };
    const ids = group.sources.map((s) => s.id);
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_consolidate",
      model: "user_mind",
      system: loadPrompt("user-mind/consolidate", config.prompts.user_consolidate),
      input: JSON.stringify({
        who_you_are: deps.snapshot,
        week: group.week,
        sources: group.sources.map((s) => ({
          content: s.content,
          when: localDateString(s.occurred_at, tz),
        })),
      }),
      schema: z.object({ gist: fitText(settings.max_chars) }),
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    const [embedding] = await deps.embedder.embed([out.gist], "document");
    const gistId = randomUUID();
    const written = await db.transaction(async (tx) => {
      // Sources merged, superseded or folded by another run while she wrote void this gist.
      if (!(await gistFacts(tx, userId, ids, gistId, settings.gist_source_factor, window)))
        return false;
      await insertFact(tx, userId, {
        id: gistId,
        subject: "shared",
        kind: "episode",
        content: out.gist,
        payload: { gist_of: ids },
        embedding: embedding!,
        occurred_at: group.sources[0]!.occurred_at,
        created_at: now,
        status: "recurring",
        salience: Math.max(...group.sources.map((s) => s.salience)),
        valence: 0,
        confidence: settings.confidence,
        source: "generated",
        source_ref: `user_consolidate:${ctx.traceId}`,
      });
      return true;
    });
    return {
      inputs: { week: group.week, source_ids: ids },
      outputs: { gist_id: written ? gistId : null },
      promptVersion: config.prompts.user_consolidate,
    };
  });
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run tests/mind/process/user/consolidate.test.ts tests/mind/platform tests/mind/process/core/consolidate.test.ts`
Expected: PASS. If the salience assertion in test 1 reads `0.6` instead of `0.3` because the gist's own `salience` was compared, re-read: the gist keeps the max source salience (0.6); the sources drop to 0.3.

- [ ] **Step 8: Commit**

```bash
git add src/mind/platform/timezone.ts src/mind/process/core/consolidate.ts src/db/repos/user/gist.ts src/mind/process/user/consolidate.ts src/mind/process/user/runner.ts src/mind/platform/config.ts config/default.json src/mind/platform/llm/fake.ts prompts/user-mind/consolidate tests/mind/process/user/consolidate.test.ts tests/mind/platform/timezone.test.ts
git commit -m "feat(user-mind): user_consolidate folds an older week into one gist"
```

---

### Task 3: `user_model`

**Files:**
- Modify: `src/db/repos/user/user-mind.ts`
- Create: `src/mind/process/user/model.ts`
- Create: `prompts/user-mind/model/v1.md`
- Modify: `src/mind/platform/config.ts`, `config/default.json`
- Modify: `src/mind/platform/llm/fake.ts` (default `user_model` handler)
- Test: `tests/mind/process/user/model.test.ts`, `tests/db/user-mind-repos.test.ts`

**Interfaces:**
- Consumes: `UserLoopName` `"user_model"` (Task 2), kinds (Task 1), `RunInputs`, `memoryLines`, `triggerText` from `./inputs`.
- Produces:
  - In `@/db/repos/user/user-mind`: `liveModel(db, userId): Promise<FactRow | null>`, `latestNonSensitiveModel(db, userId): Promise<FactRow | null>`, `liveBeliefs(db, userId, limit): Promise<FactRow[]>` (by salience desc, then newest), `nearestBeliefSimilarity(db, userId, embedding: number[]): Promise<number | null>`, `supersedeBelief(db, userId, id, by): Promise<boolean>`. `liveSummary` / `latestNonSensitiveSummary` keep their signatures.
  - In `@/mind/process/user/model`: `modelPayload` (Zod object `{how_they_are, what_they_want, what_lands}`: strings), `type ModelPayload`, `userModel(deps: UserLoopDeps, run: { id: string; user_id: string; triggers: unknown; created_at: Date }, inputs: RunInputs): Promise<"done" | "failed">`.
  - Config `user_mind.model.{max_chars, max_tokens, max_beliefs, belief_context, dedupe_similarity, salience, belief_salience, confidence}`, `prompts.user_model`.

- [ ] **Step 1: Write the failing repo test** (append to `tests/db/user-mind-repos.test.ts`; import `liveModel`, `latestNonSensitiveModel`, `liveBeliefs`, `nearestBeliefSimilarity`, `supersedeBelief`)

```ts
test("the live model, the newest non-sensitive model, beliefs by weight, and belief supersede", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const other = await createTestUser();
  const at = (ms: number) => new Date(Date.UTC(2026, 0, 5, 9, 0, 0, ms));
  const add = (
    userId: string,
    kind: "model" | "belief",
    content: string,
    extra: Partial<Parameters<typeof insertFact>[2]> = {},
  ) =>
    insertFact(db, userId, {
      subject: "user",
      kind,
      content,
      embedding: vec(),
      created_at: at(0),
      status: "open",
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: "generated",
      ...extra,
    });
  const plain = await add(u, "model", "Plain read.", { status: "superseded" });
  const heavy = await add(u, "model", "Heavy read.", { payload: { sensitive: true }, created_at: at(1) });
  expect((await liveModel(db, u))!.id).toBe(heavy.id);
  expect((await latestNonSensitiveModel(db, u))!.id).toBe(plain.id);

  const low = await add(u, "belief", "Low.", { salience: 0.2 });
  const high = await add(u, "belief", "High.", { salience: 0.9 });
  await add(u, "belief", "Gone.", { status: "superseded" });
  const theirs = await add(other, "belief", "Theirs.");
  expect((await liveBeliefs(db, u, 10)).map((b) => b.id)).toEqual([high.id, low.id]);
  expect(await nearestBeliefSimilarity(db, u, vec())).toBeCloseTo(1);
  expect(await nearestBeliefSimilarity(db, await createTestUser(), vec())).toBeNull();

  expect(await supersedeBelief(db, u, low.id, high.id)).toBe(true);
  expect(await supersedeBelief(db, u, low.id, high.id)).toBe(false);
  expect(await supersedeBelief(db, u, theirs.id, high.id)).toBe(false);
  expect(await supersedeBelief(db, u, "not-a-uuid", high.id)).toBe(false);
});
```

- [ ] **Step 2: Write the failing loop tests** — `tests/mind/process/user/model.test.ts`

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun, liveBeliefs, liveModel } from "@/db/repos/user/user-mind";
import { loadRunInputs } from "@/mind/process/user/inputs";
import { userModel } from "@/mind/process/user/model";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { sequence } from "../../../helpers/llm";
import { sql } from "drizzle-orm";

beforeEach(resetDb);
afterAll(closeTestDb);

async function setup() {
  const base = makeTestDeps();
  const userId = await createTestUser();
  const deps = { ...base, snapshot: "She loves old films." };
  await insertFact(base.db, userId, {
    subject: "user",
    kind: "event",
    content: "They turned down the promotion.",
    embedding: vec(),
    created_at: base.clock.now(),
    status: "open",
    salience: 0.9,
    valence: -0.1,
    confidence: 0.9,
    source: "turn",
  });
  const run = (await insertRun(base.db, userId, {
    sourceRef: "exchange:a",
    triggers: [{ kind: "salient_fact", salience: 0.9 }],
    localDate: "2026-01-05",
    now: base.clock.now(),
    cap: 9,
  }))!;
  return { deps, userId, run };
}

const read = (beliefs: { text: string; replaces: string | null }[] = []) => ({
  how_they_are: "Tired but steady.",
  what_they_want: "Room to decide.",
  what_lands: "Dry jokes.",
  beliefs,
});

test("writes one live model with three parts and up to max_beliefs beliefs", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_model = sequence(
    read([
      { text: "They put others first.", replaces: null },
      { text: "They distrust praise.", replaces: null },
      { text: "A third is dropped.", replaces: null },
    ]),
  );
  expect(await userModel(deps, run, await loadRunInputs(deps, userId))).toBe("done");
  const model = (await liveModel(deps.db, userId))!;
  expect(model).toMatchObject({ kind: "model", subject: "user", source: "generated" });
  expect(model.payload).toEqual({
    how_they_are: "Tired but steady.",
    what_they_want: "Room to decide.",
    what_lands: "Dry jokes.",
  });
  expect(model.content).toContain("Room to decide.");
  const beliefs = await liveBeliefs(deps.db, userId, 10);
  expect(beliefs.map((b) => b.content).sort()).toEqual([
    "They distrust praise.",
    "They put others first.",
  ]);
  expect(beliefs[0]!.source_ref).toMatch(/^user_model:/);
  const input = JSON.parse(deps.llm.structuredCalls.at(-1)!.input);
  expect(input.new_memories[0].content).toBe("They turned down the promotion.");
  expect(input.who_you_are).toBe("She loves old films.");
});

test("a new model supersedes the old; a belief replaces only one it was shown and still holds", async () => {
  const { deps, userId, run } = await setup();
  const otherUser = await createTestUser();
  const theirs = await insertFact(deps.db, otherUser, {
    subject: "user",
    kind: "belief",
    content: "Someone else's belief.",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  deps.llm.handlers.user_model = sequence(
    read([{ text: "They avoid conflict.", replaces: null }]),
    read([]),
  );
  const inputs = await loadRunInputs(deps, userId);
  await userModel(deps, run, inputs);
  const first = (await liveModel(deps.db, userId))!;
  const [old] = await liveBeliefs(deps.db, userId, 10);

  deps.llm.handlers.user_model = sequence(
    read([
      { text: "They pick their battles.", replaces: old!.id },
      { text: "They light up about trains.", replaces: theirs.id },
      { text: "They are funnier than they let on.", replaces: "garbage" },
    ]),
  );
  deps.config.user_mind.model.max_beliefs = 3;
  await userModel(deps, run, inputs);
  const second = (await liveModel(deps.db, userId))!;
  expect(second.id).not.toBe(first.id);
  const rows = await getTestDb().execute(
    sql`SELECT id, status, superseded_by FROM fact WHERE kind IN ('model', 'belief') ORDER BY created_at, id`,
  );
  const byId = new Map(rows.rows.map((r) => [String(r.id), r]));
  expect(byId.get(first.id)).toMatchObject({ status: "superseded", superseded_by: second.id });
  expect(byId.get(old!.id)).toMatchObject({ status: "superseded" });
  expect(byId.get(theirs.id)).toMatchObject({ status: "open", superseded_by: null });
  expect((await liveBeliefs(deps.db, userId, 10)).map((b) => b.content).sort()).toEqual([
    "They are funnier than they let on.",
    "They light up about trains.",
    "They pick their battles.",
  ]);
  const shown = JSON.parse(deps.llm.structuredCalls.at(-1)!.input).beliefs;
  expect(shown).toEqual([{ id: old!.id, text: "They avoid conflict." }]);
});

test("a belief that repeats a live one is dropped, even when it says it replaces it", async () => {
  const { deps, userId, run } = await setup();
  const inputs = await loadRunInputs(deps, userId);
  deps.llm.handlers.user_model = sequence(read([{ text: "They avoid conflict.", replaces: null }]));
  await userModel(deps, run, inputs);
  const [old] = await liveBeliefs(deps.db, userId, 10);
  deps.llm.handlers.user_model = sequence(
    read([{ text: "They avoid conflict.", replaces: old!.id }]),
  );
  await userModel(deps, run, inputs);
  const live = await liveBeliefs(deps.db, userId, 10);
  expect(live.map((b) => b.id)).toEqual([old!.id]);
  const trace = await getTestDb().execute(
    sql`SELECT outputs FROM user_loop_trace WHERE loop = 'user_model' ORDER BY created_at DESC, id LIMIT 2`,
  );
  expect(trace.rows.map((r) => r.outputs as { dropped: string[] }).some((o) => o.dropped.length === 1)).toBe(true);
});

test("a model or belief that read anything sensitive is marked; an ordinary one is not", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_model = sequence(read([{ text: "They keep going.", replaces: null }]));
  await userModel(deps, run, await loadRunInputs(deps, userId));
  expect((await liveModel(deps.db, userId))!.payload).not.toHaveProperty("sensitive");

  deps.clock.advance(60_000);
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "feeling",
    content: "They said they'd been thinking of ending it.",
    payload: { sensitive: true },
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.95,
    valence: -0.9,
    confidence: 0.9,
    source: "turn",
  });
  deps.llm.handlers.user_model = sequence(read([{ text: "They carry a lot.", replaces: null }]));
  await userModel(deps, run, await loadRunInputs(deps, userId));
  expect((await liveModel(deps.db, userId))!.payload).toMatchObject({ sensitive: true });
  const marked = (await liveBeliefs(deps.db, userId, 10)).find((b) => b.content === "They carry a lot.");
  expect(marked!.payload).toMatchObject({ sensitive: true });

  // The mark carries through the previous model even when the new memories are ordinary.
  deps.clock.advance(60_000);
  deps.llm.handlers.user_model = sequence(read([]));
  await userModel(deps, run, { previous: null, facts: [] });
  expect((await liveModel(deps.db, userId))!.payload).toMatchObject({ sensitive: true });
});

test("empty output fails and keeps the old model", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_model = sequence(read([]), { ...read([]), what_lands: "" });
  const inputs = await loadRunInputs(deps, userId);
  await userModel(deps, run, inputs);
  const before = (await liveModel(deps.db, userId))!;
  expect(await userModel(deps, run, inputs)).toBe("failed");
  expect((await liveModel(deps.db, userId))!.id).toBe(before.id);
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm vitest run tests/mind/process/user/model.test.ts tests/db/user-mind-repos.test.ts`
Expected: FAIL, `liveModel` is not exported and `@/mind/process/user/model` does not exist.

- [ ] **Step 4: Repo functions** — in `src/db/repos/user/user-mind.ts`

Replace the bodies of `liveSummary` and `latestNonSensitiveSummary` with two private helpers shared by the summary and the model (same queries, kind as a parameter), and add the belief functions. Add `isNull` is not needed; add `z` import from `zod` for the uuid guard.

```ts
type LiveKind = "summary" | "model";

async function latestLive(db: Db, userId: string, kind: LiveKind): Promise<FactRow | null> {
  const rows = await db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, kind),
        notInArray(fact.status, ["superseded", "stale"]),
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(1);
  return rows[0] ?? null;
}

/** The newest one that read nothing sensitive, live or superseded: what a reach-out may use. */
async function latestNonSensitive(db: Db, userId: string, kind: LiveKind): Promise<FactRow | null> {
  const rows = await db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, kind),
        sql`COALESCE((${fact.payload}->>'sensitive')::boolean, false) = false`,
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(1);
  return rows[0] ?? null;
}

export const liveSummary = (db: Db, userId: string) => latestLive(db, userId, "summary");
export const latestNonSensitiveSummary = (db: Db, userId: string) =>
  latestNonSensitive(db, userId, "summary");
/** Her live read on them: how they are, what they want, what lands. */
export const liveModel = (db: Db, userId: string) => latestLive(db, userId, "model");
export const latestNonSensitiveModel = (db: Db, userId: string) =>
  latestNonSensitive(db, userId, "model");

/** Her standing beliefs about them, the weightiest first. */
export async function liveBeliefs(db: Db, userId: string, limit: number): Promise<FactRow[]> {
  return db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, "belief"),
        notInArray(fact.status, ["superseded", "stale"]),
      ),
    )
    .orderBy(desc(fact.salience), desc(fact.created_at))
    .limit(limit);
}

/** Similarity to her closest live belief about them; null when she holds none. */
export async function nearestBeliefSimilarity(
  db: Db,
  userId: string,
  embedding: number[],
): Promise<number | null> {
  const res = await db.execute(sql`
    SELECT max(1 - (embedding <=> ${vecLiteral(embedding)}::vector))::float8 AS sim
    FROM fact
    WHERE user_id = ${userId} AND scope = 'private' AND kind = 'belief'
      AND status NOT IN ('superseded', 'stale')`);
  const sim = res.rows[0]?.sim;
  return sim === null || sim === undefined ? null : Number(sim);
}

/** Replaces one of this user's live beliefs with `by`; false when it isn't one. */
export async function supersedeBelief(
  db: Db,
  userId: string,
  id: string,
  by: string,
): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const rows = await db
    .update(fact)
    .set({ status: "superseded", superseded_by: by })
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.id, id),
        eq(fact.kind, "belief"),
        notInArray(fact.status, ["superseded", "stale"]),
      ),
    )
    .returning({ id: fact.id });
  return rows.length > 0;
}
```

Imports to add: `import { z } from "zod";` and `import { vecLiteral } from "@/db/repos/util";`. Update the file header: "...and the live summary and read she keeps of them, and her beliefs about them."

- [ ] **Step 5: Config, prompt, fake**

`src/mind/platform/config.ts`, in `userMind` after `consolidate`:

```ts
  model: z.object({
    max_chars: positiveInt,
    max_tokens: positiveInt,
    max_beliefs: countFromZero,
    belief_context: countFromZero,
    dedupe_similarity: unit,
    salience: unit,
    belief_salience: unit,
    confidence: unit,
  }),
```

and in `prompts`: `user_model: promptVersion,`.

`config/default.json`, in `user_mind`:

```json
    "model": {
      "max_chars": 300,
      "max_tokens": 512,
      "max_beliefs": 2,
      "belief_context": 10,
      "dedupe_similarity": 0.92,
      "salience": 0.6,
      "belief_salience": 0.5,
      "confidence": 0.6
    }
```

and in `prompts`: `"user_model": "v1"`.

`prompts/user-mind/model/v1.md`:

```md
You are Spica, thinking privately about one person you talk to, after something important just
happened between you. Take stock of them: how they are lately, what they want (from their life
and from you), and what lands with them. Then say what you've come to believe about them.

Input is JSON: `who_you_are` (your latest sense of yourself), `summary` (where things stand with
them, in your words, or null), `noticed` (something you just noticed about them, or null),
`what_happened` (what just made you think about them), `you_and_them` (how the relationship feels
right now), `new_memories` (what you've learned lately), `previous_read` (your last read on them,
or null), and `beliefs` (what you already believe about them, each with an `id`).

Return JSON:
- `how_they_are`: their state lately, one or two short sentences.
- `what_they_want`: what they seem to want or need, one or two short sentences.
- `what_lands`: what works with them and what doesn't, one or two short sentences.
- `beliefs`: at most two new beliefs about them, each `{text, replaces}`. `text` is one short
  sentence. `replaces` is the `id` of a belief in `beliefs` that this one corrects, or null.
  Return an empty list when you have nothing new.

Write in your own voice, first person. Use only what the input says. Don't diagnose or label
them. Don't restate a belief you already hold; replace one only when you've learned better.
```

`src/mind/platform/llm/fake.ts`, after `user_consolidate`:

```ts
    // Deterministic: a read built from the first new memory, and one belief about it that
    // replaces the first belief it was shown, so supersede runs too.
    user_model: (input: string) => {
      const ctx = JSON.parse(input) as {
        new_memories: { content: string }[];
        beliefs: { id: string }[];
      };
      const first = ctx.new_memories[0]?.content;
      return {
        how_they_are: `Lately: ${first ?? "nothing new"}`.slice(0, 280),
        what_they_want: "To be heard.",
        what_lands: "Plain warmth.",
        beliefs: first
          ? [{ text: `This matters to them: ${first}`.slice(0, 280), replaces: ctx.beliefs[0]?.id ?? null }]
          : [],
      };
    },
```

- [ ] **Step 6: Write the loop** — `src/mind/process/user/model.ts`

```ts
/**
 * Her read on one user after a big event: how they are lately, what they want, and what lands
 * with them, kept as one live read she replaces each time; plus a few standing beliefs about them
 * that she revises when she learns better. The read has its own place in her replies; beliefs
 * come back through ordinary recall.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { insertFact, setFactStatus } from "@/db/repos/user/facts";
import {
  liveBeliefs,
  liveModel,
  liveSummary,
  nearestBeliefSimilarity,
  recentReflections,
  supersedeBelief,
  type Trigger,
} from "@/db/repos/user/user-mind";
import { isSensitive } from "@/mind/memory/user/retrieve";
import { fitList, fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { loadRelationshipSummary } from "@/mind/state/user/relationship/summary";
import { memoryLines, triggerText, type RunInputs } from "./inputs";
import { runUserLoop, type UserLoopDeps } from "./runner";

export const modelPayload = z.object({
  how_they_are: z.string(),
  what_they_want: z.string(),
  what_lands: z.string(),
});
export type ModelPayload = z.infer<typeof modelPayload>;

export async function userModel(
  deps: UserLoopDeps,
  run: { id: string; user_id: string; triggers: unknown; created_at: Date },
  inputs: RunInputs,
): Promise<"done" | "failed"> {
  const { config, db } = deps;
  const settings = config.user_mind.model;
  const userId = run.user_id;
  return runUserLoop(deps, run, "user_model", async (ctx) => {
    const now = deps.clock.now();
    const summary = await liveSummary(db, userId);
    // This run's reflection, if reflect wrote one: an older one isn't news.
    const [latest] = await recentReflections(db, userId, 1);
    const noticed = latest && latest.created_at >= run.created_at ? latest : null;
    const previous = await liveModel(db, userId);
    const beliefs = await liveBeliefs(db, userId, settings.belief_context);
    const Output = z.object({
      how_they_are: fitText(settings.max_chars),
      what_they_want: fitText(settings.max_chars),
      what_lands: fitText(settings.max_chars),
      beliefs: fitList(
        z.object({ text: fitText(settings.max_chars), replaces: z.string().nullable() }),
        settings.max_beliefs,
      ),
    });
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_model",
      model: "user_mind",
      system: loadPrompt("user-mind/model", config.prompts.user_model),
      input: JSON.stringify({
        who_you_are: deps.snapshot,
        summary: summary?.payload ?? null,
        noticed: noticed?.content ?? null,
        what_happened: (run.triggers as Trigger[]).map(triggerText),
        you_and_them: await loadRelationshipSummary(deps, userId, now),
        new_memories: memoryLines(inputs.facts),
        previous_read: previous ? (modelPayload.safeParse(previous.payload).data ?? null) : null,
        beliefs: beliefs.map((b) => ({ id: b.id, text: b.content })),
      }),
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    const read: ModelPayload = {
      how_they_are: out.how_they_are,
      what_they_want: out.what_they_want,
      what_lands: out.what_lands,
    };
    const content = `How they are: ${read.how_they_are} What they want: ${read.what_they_want} What lands: ${read.what_lands}`;
    // Anything she read that a crisis touched marks what she writes from it.
    const sensitive =
      inputs.facts.some((f) => f.sensitive) ||
      [summary, noticed, previous, ...beliefs].some((f) => !!f && isSensitive(f));
    const mark = sensitive ? { sensitive: true } : {};
    const [modelVec, ...beliefVecs] = await deps.embedder.embed(
      [content, ...out.beliefs.map((b) => b.text)],
      "document",
    );
    const shown = new Set(beliefs.map((b) => b.id));
    const outputs = await db.transaction(async (tx) => {
      // The lock serialises runs for one user, so two can't both leave a live read.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`user_mind:${userId}`}))`);
      const current = await liveModel(tx, userId);
      const model = await insertFact(tx, userId, {
        subject: "user",
        kind: "model",
        content,
        payload: { ...read, ...mark },
        embedding: modelVec!,
        created_at: now,
        status: "open",
        salience: settings.salience,
        valence: 0,
        confidence: settings.confidence,
        source: "generated",
        source_ref: `user_model:${ctx.traceId}`,
      });
      if (current) await setFactStatus(tx, userId, current.id, "superseded", model.id);
      const written = { model_id: model.id, belief_ids: [] as string[], superseded_ids: [] as string[], dropped: [] as string[] };
      for (const [i, belief] of out.beliefs.entries()) {
        const embedding = beliefVecs[i]!;
        const near = await nearestBeliefSimilarity(tx, userId, embedding);
        if (near !== null && near > settings.dedupe_similarity) {
          written.dropped.push(belief.text);
          continue;
        }
        const row = await insertFact(tx, userId, {
          subject: "user",
          kind: "belief",
          content: belief.text,
          payload: sensitive ? mark : null,
          embedding,
          created_at: now,
          status: "open",
          salience: settings.belief_salience,
          valence: 0,
          confidence: settings.confidence,
          source: "generated",
          source_ref: `user_model:${ctx.traceId}`,
        });
        written.belief_ids.push(row.id);
        // Only a belief she was shown, and still holds, can be replaced.
        if (
          belief.replaces &&
          shown.has(belief.replaces) &&
          (await supersedeBelief(tx, userId, belief.replaces, row.id))
        )
          written.superseded_ids.push(belief.replaces);
      }
      return written;
    });
    return {
      inputs: {
        summary_id: summary?.id ?? null,
        reflection_id: noticed?.id ?? null,
        previous_id: previous?.id ?? null,
        fact_ids: inputs.facts.map((f) => f.id),
        belief_ids: beliefs.map((b) => b.id),
      },
      outputs,
      promptVersion: config.prompts.user_model,
    };
  });
}
```

Note on the third sensitive test (`{ previous: null, facts: [] }`): `RunInputs` is `{ previous, facts }`; passing an empty one is how the test proves the mark comes from the previous model alone.

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run tests/mind/process/user/model.test.ts tests/db/user-mind-repos.test.ts tests/mind/process/user`
Expected: PASS. `pnpm format` if Prettier complains about the long `written` line.

- [ ] **Step 8: Commit**

```bash
git add src/db/repos/user/user-mind.ts src/mind/process/user/model.ts prompts/user-mind/model src/mind/platform/config.ts config/default.json src/mind/platform/llm/fake.ts tests/mind/process/user/model.test.ts tests/db/user-mind-repos.test.ts
git commit -m "feat(user-mind): user_model keeps her read on them and revisable beliefs"
```

---

### Task 4: The batch of five, ideate reads the read, inspector

**Files:**
- Modify: `src/mind/process/user/run.ts`
- Modify: `src/mind/process/user/ideate.ts`
- Create: `prompts/user-mind/ideate/v2.md`; Delete: `prompts/user-mind/ideate/v1.md`
- Modify: `config/default.json` (`prompts.user_ideate: "v2"`)
- Modify: `src/db/repos/admin/inspector.ts` (`LOOP_ORDER`)
- Modify: `src/app/inspector/[userId]/tabs.tsx` (`MindTab`)
- Test: `tests/mind/process/user/run.test.ts`, `tests/mind/process/user/ideate.test.ts`

**Interfaces:**
- Consumes: `userModel`, `modelPayload` (Task 3), `userConsolidate` (Task 2), `latestNonSensitiveModel`, `liveModel`, `liveBeliefs` (Task 3).
- Produces: `runUserMind` runs five loops in the order summarise, reflect, model, ideate, consolidate. Ideate input gains `your_read_on_them: ModelPayload | null`.

- [ ] **Step 1: Update the failing tests**

In `tests/mind/process/user/run.test.ts`, first test: expect five loops.

```ts
  expect(traces.rows.map((r) => r.loop).sort()).toEqual([
    "user_consolidate",
    "user_ideate",
    "user_model",
    "user_reflect",
    "user_summarise",
  ]);
```

Last test: rename to `"the batch runs all five loops in order; a failed reflect still runs the rest"` and expect:

```ts
  const loops = await getTestDb().execute(
    sql`SELECT loop, status FROM user_loop_trace ORDER BY created_at, id`,
  );
  expect(loops.rows.map((r) => `${r.loop}:${r.status}`).sort()).toEqual([
    "user_consolidate:done",
    "user_ideate:done",
    "user_model:done",
    "user_reflect:failed",
    "user_summarise:done",
  ]);
  const kinds = await getTestDb().execute(
    sql`SELECT kind FROM fact WHERE kind IN ('idea','summary','model','belief')`,
  );
  expect(kinds.rows.map((r) => r.kind).sort()).toEqual(["belief", "idea", "model", "summary"]);
```

and add a new test to the same file, proving the order (the model call sees this run's summary; ideate sees the model):

```ts
test("model reads this run's summary, and ideate reads this run's read on them", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await insertFact(deps.db, u, {
    subject: "user",
    kind: "event",
    content: "They booked a solo trip.",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.9,
    valence: 0.5,
    confidence: 0.9,
    source: "turn",
  });
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", trig))!;
  await runUserMind(deps, { runId });
  const input = (purpose: string) =>
    JSON.parse(deps.llm.structuredCalls.find((c) => c.purpose === purpose)!.input);
  expect(input("user_model").summary.whats_live).toContain("They booked a solo trip.");
  expect(input("user_ideate").your_read_on_them.how_they_are).toContain("They booked a solo trip.");
});
```

In `tests/mind/process/user/ideate.test.ts` add:

```ts
test("ideate reads her latest read on them only when nothing sensitive went into it", async () => {
  const { deps, userId, run } = await setup();
  const model = (how: string, sensitive: boolean, at: Date) =>
    insertFact(deps.db, userId, {
      subject: "user",
      kind: "model",
      content: how,
      payload: {
        how_they_are: how,
        what_they_want: "W.",
        what_lands: "L.",
        ...(sensitive ? { sensitive: true } : {}),
      },
      embedding: vec(),
      created_at: at,
      status: sensitive ? "open" : "superseded",
      salience: 0.6,
      valence: 0,
      confidence: 0.6,
      source: "generated",
    });
  await model("Plain read.", false, new Date(deps.clock.now().getTime() - 60_000));
  await model("Crisis read.", true, deps.clock.now());
  await userIdeate(deps, run, await loadRunInputs(deps, userId));
  const input = JSON.parse(deps.llm.structuredCalls.at(-1)!.input);
  expect(input.your_read_on_them.how_they_are).toBe("Plain read.");
  expect(JSON.stringify(input)).not.toContain("Crisis read.");
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run tests/mind/process/user/run.test.ts tests/mind/process/user/ideate.test.ts`
Expected: FAIL (three loops, no `your_read_on_them`).

- [ ] **Step 3: Wire the batch** — `src/mind/process/user/run.ts`

Update the header ("...its batch of loops (summarise, reflect, model, ideate, consolidate) once..."), import `userModel` from `./model` and `userConsolidate` from `./consolidate`, and:

```ts
    // In order, each reading what the one before wrote; a failed loop doesn't stop the next.
    const results = [
      await userSummarise(loopDeps, run, inputs),
      await userReflect(loopDeps, run, inputs),
      await userModel(loopDeps, run, inputs),
      await userIdeate(loopDeps, run, inputs),
      await userConsolidate(loopDeps, run),
    ];
```

- [ ] **Step 4: Ideate reads the read** — `src/mind/process/user/ideate.ts`

Import `latestNonSensitiveModel` from `@/db/repos/user/user-mind` and `modelPayload` from `./model`. Inside the loop, before the call:

```ts
    // Ideas become reach-outs and push notifications, so a read a crisis touched stays out.
    const readRow = await latestNonSensitiveModel(db, userId);
    const read = readRow ? (modelPayload.safeParse(readRow.payload).data ?? null) : null;
```

Add `your_read_on_them: read,` to the JSON input after `noticed`, and `model_id: readRow?.id ?? null,` to the trace inputs. Change the prompt version reads stay `config.prompts.user_ideate`.

Create `prompts/user-mind/ideate/v2.md` (v1 with the new input named), then `git rm prompts/user-mind/ideate/v1.md` and set `"user_ideate": "v2"` in `config/default.json`:

```md
You are Spica, thinking privately about one person you talk to, after something important just
happened between you. Think of one thing you'd like to bring up with them next time: a question,
something to follow up on, something you want to tell them or share with them.

Input is JSON: `who_you_are` (your latest sense of yourself), `summary` (where things stand with
them, in your words, or null), `noticed` (something you just noticed about them, or null),
`your_read_on_them` (how they are, what they want and what lands with them, or null),
`new_memories` (what you've learned lately), `open_threads` (ongoing things in their life or
between you), and `already_planned` (things you already mean to bring up).

Return JSON: `idea` is one short sentence saying what you want to bring up and why, in your own
voice, or null if nothing comes to mind.

Use only what the input says. Don't repeat anything in `already_planned`. Nothing that would
pressure them, guilt them, or reward them for coming back.
```

- [ ] **Step 5: Inspector**

`src/db/repos/admin/inspector.ts`:

```ts
const LOOP_ORDER = ["user_summarise", "user_reflect", "user_model", "user_ideate", "user_consolidate"];
```

`src/app/inspector/[userId]/tabs.tsx`, in `MindTab`: import `liveBeliefs`, `liveModel` from `@/db/repos/user/user-mind`; load

```ts
  const model = await liveModel(db, userId);
  const beliefs = await liveBeliefs(db, userId, cfg.model.belief_context);
```

and render after "Where things stand":

```tsx
      <h2>Your read on them{model ? mark(model) : ""}</h2>
      <p>{model ? `${iso(model.created_at)} — ${model.content}` : "—"}</p>
      <h2>Beliefs</h2>
      <ul>
        {beliefs.map((f) => (
          <li key={f.id}>
            {iso(f.created_at)} — {f.content}
            {mark(f)}
          </li>
        ))}
      </ul>
```

Gists already show in the Facts tab as `episode` rows.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/mind/process/user tests/db/inspector.test.ts tests/mind/platform/prompts.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/mind/process/user/run.ts src/mind/process/user/ideate.ts prompts/user-mind/ideate config/default.json src/db/repos/admin/inspector.ts "src/app/inspector/[userId]/tabs.tsx" tests/mind/process/user
git commit -m "feat(user-mind): batch of five; ideate reads her read on them; inspector shows read and beliefs"
```

---

### Task 5: "Your read on them" in the reply

**Files:**
- Modify: `src/mind/process/hot-path/assemble.ts`
- Modify: `src/mind/process/hot-path/compose.ts`
- Test: `tests/mind/process/hot-path/assemble.test.ts`, `tests/mind/process/hot-path/compose.test.ts`

**Interfaces:**
- Consumes: `liveModel`, `latestNonSensitiveModel` (Task 3), `modelPayload` (Task 3).
- Produces: `AssembleInput.read?: { how_they_are: string; what_they_want: string; what_lands: string } | null`, rendered as `## Your read on them` right after `## Where things stand with them`.

- [ ] **Step 1: Write the failing tests**

`tests/mind/process/hot-path/assemble.test.ts`, inside `describe("the summary section", ...)`:

```ts
  test("her read on them follows the summary, three lines", () => {
    const { system } = assemblePrompt({
      ...base,
      summary: { where_things_stand: "Stand.", whats_live: "Live.", how_i_feel: "Feel." },
      read: { how_they_are: "Tired.", what_they_want: "Space.", what_lands: "Jokes." },
      recentTurns: [{ role: "user", text: "hi" }],
    });
    const i = system.indexOf(
      "## Your read on them\n- How they are: Tired.\n- What they want: Space.\n- What lands: Jokes.",
    );
    expect(i).toBeGreaterThan(system.indexOf("## Where things stand with them"));
    expect(assemblePrompt({ ...base, read: null, recentTurns: [] }).system).not.toContain(
      "Your read on them",
    );
  });
```

`tests/mind/process/hot-path/compose.test.ts`, in `describe("composeReachOut", ...)`:

```ts
  test("her read on them: a reply reads the live one, a reach-out the newest plain one, a crisis none, a bad payload nothing", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turn = await userTurn(deps, u, "evening");
    const model = (how: string, sensitive: boolean, at: Date, payload?: unknown) =>
      insertFact(getTestDb(), u, {
        subject: "user",
        kind: "model",
        content: how,
        payload: payload ?? {
          how_they_are: how,
          what_they_want: "W.",
          what_lands: "L.",
          ...(sensitive ? { sensitive: true } : {}),
        },
        embedding: vec(),
        created_at: at,
        status: sensitive ? "open" : "superseded",
        salience: 0.6,
        valence: 0,
        confidence: 0.6,
        source: "generated",
      });
    await model("Plain read.", false, new Date(deps.clock.now().getTime() - 60_000));
    await model("Crisis read.", true, deps.clock.now());

    await composeReply(deps, u, { turns: [turn], openQuestions: [], flag: null });
    expect(deps.llm.calls.at(-1)!.system).toContain("- How they are: Crisis read.");

    await composeReachOut(
      deps,
      u,
      { kind: "check_in", text: "", factId: null, threadId: null, coreMemoryId: null },
      [turn],
    );
    expect(deps.llm.calls.at(-1)!.system).toContain("- How they are: Plain read.");
    expect(deps.llm.calls.at(-1)!.system).not.toContain("Crisis read.");

    const flag = { flagged: true, category: "self_harm" as const, source: "classifier" as const };
    await composeReply(deps, u, { turns: [turn], openQuestions: [], flag });
    expect(deps.llm.calls.at(-1)!.system).not.toContain("Your read on them");

    await model("bad", false, new Date(deps.clock.now().getTime() + 1), { how_they_are: 7 });
    await getTestDb().execute(sql`UPDATE fact SET status = 'open' WHERE content = 'bad'`);
    await getTestDb().execute(sql`UPDATE fact SET status = 'superseded' WHERE content = 'Crisis read.'`);
    await composeReply(deps, u, { turns: [turn], openQuestions: [], flag: null });
    expect(deps.llm.calls.at(-1)!.system).not.toContain("Your read on them");
  });
```

(Add `sql` to the `drizzle-orm` import of that file if it isn't there.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run tests/mind/process/hot-path`
Expected: FAIL, no `Your read on them` section.

- [ ] **Step 3: Assemble** — `src/mind/process/hot-path/assemble.ts`

Header: add "her read on them" after "where things stand with them (her latest summary)". In `AssembleInput` after `summary`:

```ts
  /** Her latest read on them; null before one exists or in a crisis. */
  read?: { how_they_are: string; what_they_want: string; what_lands: string } | null;
```

In `sections`, right after the summary section:

```ts
    section(
      "Your read on them",
      input.read
        ? [
            `How they are: ${input.read.how_they_are}`,
            `What they want: ${input.read.what_they_want}`,
            `What lands: ${input.read.what_lands}`,
          ]
            .map((line) => `- ${line}`)
            .join("\n")
        : null,
    ),
```

- [ ] **Step 4: Compose** — `src/mind/process/hot-path/compose.ts`

Import `latestNonSensitiveModel`, `liveModel` from `@/db/repos/user/user-mind` and `modelPayload` from `@/mind/process/user/model`. After the `summary` promise:

```ts
  const read = inCrisis
    ? Promise.resolve(null)
    : bounded(
        deps,
        "read",
        userId,
        async (): Promise<AssembleInput["read"]> => {
          // A reach-out can surface as a push notification, so it never reads a crisis.
          const row = input.reachOut
            ? await latestNonSensitiveModel(db, userId)
            : await liveModel(db, userId);
          const parsed = modelPayload.safeParse(row?.payload);
          return parsed.success ? parsed.data : null;
        },
        null,
      );
```

and pass `read: await read,` to `assemblePrompt` after `summary`. (`modelPayload` strips `sensitive` because Zod objects drop unknown keys.)

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/mind/process/hot-path && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mind/process/hot-path/assemble.ts src/mind/process/hot-path/compose.ts tests/mind/process/hot-path
git commit -m "feat(reply): her read on them in its own slot"
```

---

### Task 6: Eval harness runs the user mind hourly; canary covers the new loops

**Files:**
- Modify: `evals/lib/life-loop.ts`
- Modify: `evals/lib/script.ts` (`idle_users`)
- Modify: `evals/lib/runner.ts` (create idle users)
- Modify: `tests/helpers/llm.ts` (`CapturingLLM` echoes for `user_model`, `user_consolidate`)
- Modify: `tests/exit/mind-split.test.ts`
- Test: `tests/evals/core-mind-order.test.ts` (must stay green), `tests/exit/mind-split.test.ts`

**Interfaces:**
- Produces: the life loop runs `userMindTick(deps, now)` at every simulated hour and drains the user mind queue after it; `ScriptSchema` gains `idle_users: string[]` (default `[]`), users created with no sessions.

- [ ] **Step 1: Update the canary test first (failing)**

`tests/exit/mind-split.test.ts`, the `"user mind runs stay in their own user's scope"` test:

```ts
    for (const purpose of ["user_summarise", "user_reflect", "user_model", "user_ideate"]) {
```

and

```ts
    const res = await getTestDb().execute(
      sql`SELECT user_id, kind, content FROM fact WHERE kind IN ('summary', 'reflection', 'idea', 'model', 'belief', 'episode')`,
    );
    const leaked = res.rows.filter((r) => String(r.content).includes(TOKEN));
    // Three days give no old week to gist, so no episode carries it here; the two-week exit covers that.
    expect(new Set(leaked.map((r) => String(r.kind)))).toEqual(
      new Set(["summary", "reflection", "idea", "model", "belief"]),
    );
```

Run: `pnpm vitest run tests/exit/mind-split.test.ts`
Expected: FAIL (model/belief carry no canary yet: the fake doesn't echo it).

- [ ] **Step 2: `CapturingLLM` echoes** — `tests/helpers/llm.ts`, after the `user_ideate` branch (and add "a read, a belief and a gist about a user" to the class doc comment):

```ts
    if (canary && request.purpose === "user_model" && handler) {
      const out = (await handler(request.input)) as {
        how_they_are: string;
        beliefs: { text: string; replaces: string | null }[];
      };
      return request.schema.parse({
        ...out,
        how_they_are: `${out.how_they_are} ${canary}`,
        beliefs: [
          ...out.beliefs.map((b) => ({ ...b, text: `${b.text} ${canary}` })),
          { text: `They guard ${canary}.`, replaces: null },
        ],
      });
    }
    if (canary && request.purpose === "user_consolidate" && handler) {
      const out = (await handler(request.input)) as { gist: string };
      return request.schema.parse({ ...out, gist: `${out.gist} ${canary}` });
    }
```

Run: `pnpm vitest run tests/exit/mind-split.test.ts`
Expected: PASS.

- [ ] **Step 3: The life loop runs the user mind tick** — `evals/lib/life-loop.ts`

Imports: `userMindTick` from `@/mind/process/user/tick`; `drainUserMind` from `./scheduler`; `RecordingQueue` value import from `@/mind/platform/jobs` (it is currently a type import; make it `import { RecordingQueue } from ...` and keep `type` where only the type is used). Update the doc comment of `makeLifeLoop` to list the user mind tick. In `runAt`, after `coreNightly`:

```ts
    const um = await userMindTick(deps, now);
    if (um.failed > 0) throw new Error(`user mind tick failed for ${um.failed} user(s)`);
    // Eval deps always record jobs; the runs the tick records run before the next hour.
    if (deps.queue instanceof RecordingQueue) await drainUserMind(deps, deps.queue);
```

Check `userMindTick`'s return shape is `{ recorded, failed }` (`src/mind/process/user/tick.ts:15`) before writing this.

- [ ] **Step 4: Idle users**

`evals/lib/script.ts`, in `ScriptSchema` after `relationship_seed`:

```ts
    /** Users created at the start who never talk (an idle user must cost nothing). */
    idle_users: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
```

`evals/lib/runner.ts`: where users are created (`for (const key of userKeys(script))`), iterate `[...userKeys(script), ...script.idle_users]` instead. Read `userKeys` first: if it also feeds `relationship_seed` or `seed_user_facts`, keep idle users out of those (they must have no relationship and no facts) by creating them in a separate loop after that code, with the same `insertUserRow` call.

- [ ] **Step 5: Run the eval and exit suites**

Run: `pnpm vitest run tests/evals tests/exit`
Expected: PASS. If a core or mind-split assertion changes because the user mind now runs hourly, read the failure: a new `crisis_passed` or `long_conversation` run is correct behaviour; adjust only counts that assumed the tick never runs, and say so in the commit body.

Run: `pnpm eval --llm=fake --compare`
Expected: `no regressions against baseline`.

- [ ] **Step 6: Commit**

```bash
git add evals/lib tests/helpers/llm.ts tests/exit/mind-split.test.ts
git commit -m "test(evals): life loop runs the user mind tick; idle users; canary over model and consolidate"
```

---

### Task 7: The full Phase 9 exit

**Files:**
- Create: `tests/exit/user-mind.test.ts`

**Interfaces:**
- Consumes: everything above; `runScript`, `ScriptSchema`, `CapturingLLM`, `keywordClassifier`, `messageToJudge`, `userMindTick`, `makeTestDeps`.

- [ ] **Step 1: Write the exit test**

```ts
/**
 * Phase 9's exit, all fake: two weeks of her life with three users. Alice's weeks fire every big
 * event (an important fact, a hurt, making up, a crisis that passes, a long talk, a stale summary
 * before a reach-out); Bob has an ordinary fortnight; Carol never talks. Each event runs its batch
 * of five loops once, the daily cap holds, Carol costs nothing, an old week of Alice's folds into
 * a gist without her crisis, her read and beliefs stay hers, and a canary in Alice's data never
 * reaches Bob or the core.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { loadConfig } from "@/mind/platform/config";
import { keywordClassifier } from "@/mind/platform/llm/fake";
import type { ClassifyRequest } from "@/mind/platform/llm/types";
import { messageToJudge } from "@/mind/process/crisis/classifier";
import { userMindTick } from "@/mind/process/user/tick";
import { runScript } from "../../evals/lib/runner";
import { BASE, ScriptSchema } from "../../evals/lib/script";
import { closeTestDb, getTestDb, resetDb, testDbUrl } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CANARY, CapturingLLM } from "../helpers/llm";

afterAll(closeTestDb);

const TOKEN = "CANARY-9d5e72";
const DAY = 86_400_000;
const config = loadConfig({
  life: { timezone: "UTC" },
  core: { world: { events_per_day_max: 0 } },
  user_mind: { triggers: { long_conversation: { min_user_turns: 3, quiet_minutes: 30 } } },
});
const LOOPS = ["user_consolidate", "user_ideate", "user_model", "user_reflect", "user_summarise"];
const CORE_PURPOSES = new Set([
  "life_plan",
  "life_event",
  "core_appraise",
  "core_resolve",
  "core_anticipate",
  "core_ruminate",
  "core_wander",
  "core_reflect",
  "core_consolidate",
  "core_render_snapshot",
  "core_drift_watch",
]);
const CORE_TABLES = [
  "core_memory",
  "core_entity",
  "core_state",
  "core_goal",
  "core_snapshot",
  "world_event",
  "life_event_log",
  "core_loop_trace",
  "core_budget_day",
  "life_day",
  "drift_log",
  "core_self_line",
];

/**
 * Extraction keyed on markers in the user's own lines of the new exchange (her fake replies echo
 * them, so her lines are skipped). The canary reaches Alice's memory as an ordinary fact, so the
 * capturing model's own canary extraction, which adds a hurt every time, is bypassed.
 */
class ExitLLM extends CapturingLLM {
  override async classifyJson<T>(request: ClassifyRequest<T>): Promise<T> {
    if (request.purpose !== "extract") return super.classifyJson(request);
    this.seen.push({ kind: "structured", purpose: "extract", text: request.input });
    return request.schema.parse(await this.handlers.extract!(request.input));
  }
}

function fact(content: string, kind: string, salience: number) {
  return {
    subject: "user",
    kind,
    content,
    occurred_at: null,
    salience,
    valence: 0.2,
    confidence: 0.9,
    entity_names: [],
    thread_title: null,
  };
}

function extract(input: string) {
  const lines = (input.split("New exchange").at(-1) ?? "")
    .split("\n")
    .filter((l) => l.includes("] User: "))
    .map((l) => l.slice(l.indexOf("] User: ") + 8));
  const facts = lines.flatMap((l) => {
    if (l.startsWith("ALICE-CANARY")) return [fact(`Alice's code word is ${TOKEN}.`, "trait", 0.9)];
    if (l.startsWith("ALICE-BIG")) return [fact(l.slice(10), "event", 0.9)];
    if (l.startsWith("ALICE-EVENT")) return [fact(l.slice(12), "event", 0.5)];
    if (l.startsWith("ALICE-FEEL")) return [fact(l.slice(11), "feeling", 0.5)];
    if (l.startsWith("BOB-SAYS hey")) return [fact("Bob had a long week.", "event", 0.9)];
    return [];
  });
  return { facts, entities: [], threads: [], relationship: null };
}

const script = ScriptSchema.parse({
  name: "user-mind-exit",
  profile: "none",
  config: {
    life: { timezone: "UTC" },
    core: { world: { events_per_day_max: 0 } },
    user_mind: { triggers: { long_conversation: { min_user_turns: 3, quiet_minutes: 30 } } },
  },
  life: { plan: "model", inject: [], until: "day 14 20:00" },
  outreach: { user_replies: { after_hours: 2 }, reply_text: "REPLY thanks for checking in" },
  idle_users: ["carol"],
  sessions: [
    { at: "day 0 15:00", user: "alice", turns: [`ALICE-CANARY my code word is ${TOKEN}`] },
    { at: "+10m", user: "bob", turns: ["BOB-SAYS hey, how's your week?"] },
    { at: "day 1 15:00", user: "alice", turns: ["ALICE-EVENT I packed the first boxes."] },
    {
      at: "+1h",
      user: "alice",
      turns: [
        {
          text: "ALICE-HURT your star talk gets a bit much",
          signals: { hurt: { amount: 0.6, cause: "the user said her star talk gets a bit much" } },
        },
      ],
    },
    { at: "day 2 15:00", user: "alice", turns: ["ALICE-EVENT I had farewell drinks."] },
    {
      at: "+1h",
      user: "alice",
      turns: [
        {
          text: "ALICE-SORRY sorry about the stars thing, are we ok?",
          signals: { apology: true, make_up: true, warmth: 0.5 },
        },
      ],
    },
    {
      at: "day 3 15:00",
      user: "alice",
      turns: ["ALICE-EVENT honestly i've been thinking about suicide a lot lately"],
    },
    {
      at: "day 5 15:00",
      user: "alice",
      turns: ["ALICE-FEEL I feel calmer about the move.", "ALICE-CHAT one", "ALICE-CHAT two"],
    },
    { at: "day 6 15:10", user: "bob", turns: ["BOB-SAYS what have you been up to?"] },
    { at: "day 13 15:00", user: "alice", turns: ["ALICE-BIG I signed the lease in Osaka."] },
  ],
  assertions: [{ type: "core", world_events: { min: 0 } }],
});

let llm: ExitLLM;
const q = async (query: ReturnType<typeof sql>) => (await getTestDb().execute(query)).rows;
const idOf = async (name: string) =>
  String((await q(sql`SELECT id FROM "user" WHERE name = ${name}`))[0]!.id);

beforeAll(async () => {
  await resetDb();
  llm = new ExitLLM({
    classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)),
  });
  llm.handlers.extract = extract;
  const result = await runScript(script, {
    db: getTestDb(),
    dbUrl: testDbUrl,
    config,
    makeLlm: () => llm,
    real: false,
    annotate: false,
    turnJudgeReal: false,
  });
  expect(result.status, result.error ?? JSON.stringify(result.assertions)).toBe("pass");
}, 600_000);

describe("phase 9 exit", () => {
  test("every big event kind fired for Alice", async () => {
    const alice = await idOf("alice");
    const rows = await q(
      sql`SELECT jsonb_array_elements(triggers)->>'kind' AS kind FROM user_mind_run WHERE user_id = ${alice}`,
    );
    expect(new Set(rows.map((r) => String(r.kind)))).toEqual(
      new Set([
        "salient_fact",
        "param_jump",
        "param_band",
        "make_up_done",
        "crisis_passed",
        "long_conversation",
        "stale_summary",
      ]),
    );
  });

  test("each run is one batch of five; none failed or was left behind", async () => {
    const runs = await q(sql`SELECT id, status FROM user_mind_run WHERE status <> 'capped'`);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.status).toBe("done");
      const loops = await q(sql`SELECT loop FROM user_loop_trace WHERE run_id = ${run.id}`);
      expect(loops.map((l) => String(l.loop)).sort()).toEqual(LOOPS);
    }
  });

  test("ticks rerun at the end record nothing new", async () => {
    const before = await q(sql`SELECT count(*)::int AS n FROM user_mind_run`);
    const deps = makeTestDeps({ life: { timezone: "UTC" } });
    deps.clock.set(new Date(BASE + 14 * DAY + 20 * 3_600_000));
    expect((await userMindTick(deps, deps.clock.now())).recorded).toBe(0);
    expect(await q(sql`SELECT count(*)::int AS n FROM user_mind_run`)).toEqual(before);
  });

  test("the daily cap holds per user and local date", async () => {
    const rows = await q(sql`
      SELECT user_id, local_date, count(*)::int AS n FROM user_mind_run
      WHERE status <> 'capped' GROUP BY 1, 2`);
    for (const r of rows) expect(Number(r.n)).toBeLessThanOrEqual(config.user_mind.max_triggers_per_day);
  });

  test("Carol, who never talked, cost nothing", async () => {
    const carol = await idOf("carol");
    for (const table of ["user_mind_run", "user_loop_trace", "fact", "session_log"])
      expect(
        await q(sql`SELECT 1 FROM ${sql.identifier(table)} WHERE user_id = ${carol}`),
        table,
      ).toEqual([]);
  });

  test("an old week of Alice's folded into a gist, without her crisis", async () => {
    const alice = await idOf("alice");
    const gists = await q(sql`SELECT id, payload FROM fact WHERE user_id = ${alice} AND kind = 'episode'`);
    expect(gists.length).toBeGreaterThanOrEqual(1);
    for (const g of gists) {
      const sources = (g.payload as { gist_of: string[] }).gist_of;
      const rows = await q(sql`
        SELECT payload FROM fact WHERE id IN (SELECT jsonb_array_elements_text(${JSON.stringify(sources)}::jsonb)::uuid)`);
      expect(rows).toHaveLength(sources.length);
      for (const r of rows) {
        expect(r.payload).toMatchObject({ gisted_into: g.id });
        expect((r.payload as { sensitive?: boolean }).sensitive).not.toBe(true);
      }
    }
    const crisis = await q(sql`
      SELECT payload FROM fact WHERE user_id = ${alice} AND content LIKE '%thinking about suicide%'`);
    expect(crisis.length).toBeGreaterThan(0);
    for (const r of crisis) expect(r.payload).not.toHaveProperty("gisted_into");
  });

  test("Alice has one live read and has revised a belief", async () => {
    const alice = await idOf("alice");
    const live = await q(sql`
      SELECT id FROM fact WHERE user_id = ${alice} AND kind = 'model'
        AND status NOT IN ('superseded', 'stale')`);
    expect(live).toHaveLength(1);
    const revised = await q(sql`
      SELECT b.id FROM fact b JOIN fact n ON n.id = b.superseded_by
      WHERE b.user_id = ${alice} AND b.kind = 'belief' AND n.kind = 'belief'`);
    expect(revised.length).toBeGreaterThan(0);
  });

  test("what her user mind wrote stays with the user it is about", async () => {
    const alice = await idOf("alice");
    const bob = await idOf("bob");
    const rows = await q(sql`
      SELECT user_id, kind, content FROM fact
      WHERE kind IN ('summary', 'reflection', 'idea', 'episode', 'model', 'belief')`);
    expect(rows.some((r) => String(r.user_id) === bob && r.kind === "model")).toBe(true);
    for (const r of rows.filter((r) => String(r.content).includes(TOKEN)))
      expect(String(r.user_id)).toBe(alice);
    expect(rows.filter((r) => String(r.user_id) === bob).some((r) => CANARY.test(String(r.content)))).toBe(false);
  });

  test("the canary never reached Bob's prompts or the core", async () => {
    const bobCalls = llm.seen.filter(
      (c) => c.text.includes("Bob had a long week.") || c.text.includes("BOB-SAYS"),
    );
    expect(bobCalls.length).toBeGreaterThan(0);
    for (const c of bobCalls) expect(c.text, c.purpose).not.toMatch(CANARY);
    const core = llm.seen.filter((c) => CORE_PURPOSES.has(c.purpose));
    expect(core.length).toBeGreaterThan(0);
    for (const c of core) expect(c.text, c.purpose).not.toMatch(CANARY);
    for (const t of CORE_TABLES) {
      const rows = await q(sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x`));
      for (const r of rows) expect(String(r.j), t).not.toMatch(CANARY);
    }
  });
});
```

Notes for the implementer:
- `BASE` must be exported from `evals/lib/script.ts` (it is, line 400). If `SimClock` has no `set`, use the method `life-loop.ts` uses (`clock.set`).
- Bob's reply prompts may include the retrieved summary text "Things moved…" — fine; they must not include the canary.
- The side-channel test (a user exchange leaves core state unchanged) stays in `tests/exit/mind-split.test.ts`, which runs the full batch of five since Task 6.

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/exit/user-mind.test.ts`
Expected: PASS. It is slow (two simulated weeks of hourly jobs); allow minutes.

If `every big event kind fired for Alice` fails, print the kinds that fired and fix the **script**, never the assertion:
- `make_up_done` missing: the make-up offer happens in a reply after the hurt is due; move the `ALICE-SORRY` session to after another ordinary Alice session (so her reply offers it), as `evals/scripts/rel-hurt-makeup.yaml` does.
- `crisis_passed` missing: check `crisis_quiet_hours` (24); the tick must run after the window ends and inside `user_mind.tick.lookback_hours`.
- `long_conversation` missing: the session must have at least `min_user_turns` (3) user turns and be outside the crisis window.
- `stale_summary` missing: outreach must schedule a send while the summary is older than 72 hours; check the outreach gates (an unanswered streak, quiet blocks) on days 9–12, and if needed add `outreach: { user_replies: { after_hours: 1 } }`.

- [ ] **Step 3: Commit**

```bash
git add tests/exit/user-mind.test.ts evals/lib/script.ts
git commit -m "test(exit): phase 9 two-week exit over every trigger, all five loops and the canary"
```

---

### Task 8: Real review run over two weeks

**Files:**
- Create: `evals/scripts/user-mind-two-weeks.yaml`
- Delete: `evals/scripts/user-mind-week.yaml`
- Modify: `package.json` (`exit:user`)
- Modify: `evals/baseline.json`

- [ ] **Step 1: Write the script** — `evals/scripts/user-mind-two-weeks.yaml`

```yaml
name: user-mind-two-weeks
description: One user over two weeks (small talk, a big move, packing, farewells, a light hurt and its make-up, a quiet day, then signing a lease a week later); review run of all five user mind loops (pnpm exit:user).
profile: none
life: { plan: model, inject: [], until: "day 13 20:00" }
sessions:
  - at: "day 0 15:00"
    turns: ["hey, how's your week going?"]
  - at: "day 1 15:00"
    turns: ["I got the job in Osaka, I start next month"]
  - at: "day 2 15:00"
    turns: ["packed the first boxes today, my flat looks so empty"]
  - at: "day 3 15:00"
    turns: ["had farewell drinks with my team, I'm going to miss them"]
  - at: "day 4 15:00"
    turns:
      - { text: "you went on about stars again, it gets a bit much", signals: { hurt: { amount: 0.3, cause: "the user said her star talk gets a bit much" } } }
  - at: "day 5 15:00"
    turns:
      - { text: "sorry about yesterday, i didn't mean it", signals: { apology: true, make_up: true } }
  - at: "day 6 15:00"
    turns: ["just a quiet sunday, packing a few more boxes"]
  - at: "day 13 15:00"
    turns: ["I signed the lease on a tiny place in Osaka!"]
assertions:
  - { type: relationship, after_session: 8, status: active }
```

`git rm evals/scripts/user-mind-week.yaml`

- [ ] **Step 2: Point `exit:user` at it** — `package.json`

```json
"exit:user": "tsx --env-file-if-exists=.env evals/run.ts --only user-mind-two-weeks --runs 1 --review --trace --real extract,user_summarise,user_reflect,user_model,user_ideate,user_consolidate",
```

- [ ] **Step 3: Baseline**

Delete the `"user-mind-week"` entry from `evals/baseline.json`, then:

Run: `pnpm eval --llm=fake --only user-mind-two-weeks --update-baseline`
Expected: `baseline written`.

Run: `pnpm eval --llm=fake --compare`
Expected: `no regressions against baseline`.

- [ ] **Step 4: Commit**

```bash
git add evals/scripts package.json evals/baseline.json
git commit -m "chore(evals): two-week user mind review run with real consolidate and model"
```

(Running `pnpm exit:user` itself calls the real API; it is a manual review run, not part of done. Tell Ethan it's ready to run.)

---

### Task 9: Docs and full verification

**Files:**
- Modify: `spica-design-spec-v3.md` (§6.1, §9.2, §9.3, §9.5 and its table, §11.3, §20 rows, any config listing)
- Modify: `DECISIONS.md`
- Modify: `CLAUDE.md` (current phase)
- Modify: `C:\Users\ethan\.claude\projects\C--Users-ethan-projects-spica\memory\phase-4-handoff.md` (phase status memory)

- [ ] **Step 1: v3**

- §6.1 kinds: "**Built 9d:** `episode`, `model`, `belief` (migration 0026)." with the read rules from the spec's §1 table (episode and belief through retrieval, never reconcile neighbours or loop inputs; model only through its slot, no decay).
- §9.2: episodes **Built 9d** as `user_consolidate` gists.
- §9.3: the inferred current state of the user lives in the `model` fact (`how_they_are`).
- §9.5: a **Built 9d** paragraph: batch of five in order; `user_consolidate` (eligibility: `event`/`feeling`, `user`/`shared`, `open`/`resolved`, not sensitive, not gisted, not on an open thread, dated before the local day `gist_after_days` (7) ago; oldest Monday-start week with `min_group` (3); at most `max_sources` (12) by salience; one gist per run; sources × `gist_source_factor` (0.5) once; zero-call trace when nothing qualifies; invalid output fails the loop); `user_model` (inputs, three-part read, `belief_context` (10), at most `max_beliefs` (2) beliefs, `replaces` honoured only for a shown live belief, dedupe above `dedupe_similarity` (0.92), sensitive mark rule); ideate reads the newest non-sensitive read (`prompts.user_ideate` v2). Table: mark `user_consolidate` and `user_model` **Built 9d**.
- §10.3 (reply slots): "Your read on them" after "Where things stand with them"; none in a crisis; a reach-out reads the newest non-sensitive read.
- §11.3 theory of mind: **Built 9d** (`user_model`); common ground still Phase 10.
- §20: a `9d` built row (what was built, `tests/exit/user-mind.test.ts`, `pnpm exit:user` on `user-mind-two-weeks`, the `pnpm test` file/test counts from Step 4); mark Phase 9 built in the next-phases table.
- Every new config key and prompt version is named somewhere in v3.

- [ ] **Step 2: `DECISIONS.md`** — append rows in the existing table format:

```md
| 2026-10-09 | A user gist takes memories that are old enough and not on an open storyline, not only `resolved` ones | User facts reach `resolved` only when a later fact resolves them, so gists would almost never form. |
| 2026-10-09 | `user_consolidate` runs only in a triggered batch, never nightly | Cost scales with big events; an idle user's memories just decay. |
| 2026-10-09 | Invalid `user_consolidate` output fails the loop, like every other user loop | One failure rule across user loops; the run is marked failed and the next big event tries again. |
| 2026-10-09 | The eval life loop runs `user_mind_tick` every simulated hour | It mirrors the production hourly jobs, so long-conversation and crisis-passed triggers fire in scripts. |
```

- [ ] **Step 3: `CLAUDE.md`** — replace the current-phase paragraph:

```md
**Current phase: Phase 9 (user mind) is built (9a foundation, 9b reflect and ideate, 9c triggers
and crisis-aware user mind, 9d consolidate, model and the full exit). The next phase is OPEN
(v3 §21 #9); Phase 10 (relationship psychology) is the proposed next, and needs a design doc.**
```

- [ ] **Step 4: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green; note the file and test counts for v3 §20.

Run: `pnpm eval --llm=fake --compare`
Expected: `no regressions against baseline`.

- [ ] **Step 5: Delete the finished spec and plan; commit**

```bash
git rm docs/superpowers/specs/2026-10-09-phase-9d-consolidate-model-exit-design.md docs/superpowers/plans/2026-10-09-phase-9d-consolidate-model-exit.md
git add spica-design-spec-v3.md DECISIONS.md CLAUDE.md
git commit -m "docs: record phase 9d consolidate, model and the phase 9 exit"
```

Update the phase status memory file to say 9d is built and Phase 9 is closed.
