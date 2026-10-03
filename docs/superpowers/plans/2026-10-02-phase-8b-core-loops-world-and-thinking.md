# Phase 8b Core Loops: World and Thinking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add goal-directed world events, deterministic plan-vs-reality resolution, B51 landing closure, and hourly anticipate/ruminate/wander core loops on the 8a foundation.

**Architecture:** World generation and resolution remain in `src/mind/process/core/world-tick.ts`; all model work runs through `runCoreLoop`. Thinking is split into `anticipate.ts`, `ruminate.ts`, `wander.ts`, with `thoughts.ts` owning bounded embedding/dedupe/write behavior and `mind-tick.ts` coordinating idempotent hourly execution.

**Tech Stack:** TypeScript, Zod, Drizzle/Postgres 16 + pgvector, pg-boss, Vitest, deterministic fake LLM/Clock/Embedder, YAML eval runner.

**Spec:** `docs/superpowers/specs/2026-10-02-phase-8-core-loops-design.md`

## Global Constraints

- Core code receives `CoreDeps` with no `db` and no `user_id`; core loops read only core memory, core state, and world data.
- Every numeric constant is present in `config/default.json` and the matching Zod schema in `src/mind/platform/config.ts`.
- Every prompt is a versioned file under `prompts/`; removed prompt versions have no config reference.
- All rolls use `seededUnit(seed)` from `src/mind/platform/seeded-random.ts` with the exact seeds in the request.
- Timestamps come from injected `Clock`; migrations contain no `DEFAULT now()`.
- Every model call is through `runCoreLoop`; optional invalid output writes nothing and traces `failed`.
- The executor cannot run Node/pnpm; verification commands and expected output are written for Claude.

## Review Focus

- Forced and seeded fall-through must create one resolution and preserve retry idempotence (Task 2 tests).
- B51 target closure occurs only in the landing transaction and only for matching preoccupation (Task 2 tests).
- Optional loops respect reserve/due gates and continue after a sibling failure (Task 4 tests).
- Duplicate and invalid thought outputs are side-effect free but fully traced (Task 4 tests).
- Core canary and side-channel isolation hold for all new purposes (Task 6 tests).

## File map

Create: `docs/superpowers/plans/8b-parts/task-01.md` through `task-06.md`, `src/mind/process/core/anticipate.ts`, `ruminate.ts`, `wander.ts`, `thoughts.ts`, `mind-tick.ts`, `src/worker/core-jobs.ts`, and prompts `prompts/life/event/v4.md`, `prompts/core/{resolve,anticipate,ruminate,wander}/v1.md`.

Modify: `src/db/schema.ts`, `src/db/repos/core/world.ts`, `src/db/repos/core/memory.ts`, `src/db/repos/core/traces.ts`, `src/mind/memory/core/types.ts`, `src/mind/world/types.ts`, `src/mind/world/events.ts`, `src/mind/process/core/appraise.ts`, `src/mind/process/core/world-tick.ts`, `src/mind/platform/config.ts`, `config/default.json`, worker/job files, eval harness files, fake/canary helpers, `spica-design-spec-v3.md`, and `DECISIONS.md`.

## Shared interfaces (binding)

- Existing `world_event.plan_ref: text`, `goal_ref: uuid`, `outcome: text`, and enum member `resolution` remain; do not re-add them. Add only `resolves_memory_id: uuid | null` referencing `core_memory.id` with `onDelete: set null`, and `fallthrough: boolean | null` (null means roll; injected eval value wins). Type `WorldEventRow.outcome` as `"happened" | "fell_through" | null` while DB column remains text; add a DECISIONS row for this narrowing.
- `CoreMemory.mergePayload(id: string, patch: Record<string, unknown>): Promise<void>` performs JSONB merge. `CoreMemory.reinforce(id: string, now: Date, opts: { bump: number; cap: number }): Promise<void>` increments recall count, sets last-recalled, and caps salience using the same rules as `user/facts.ts` `applyRecall`. Both are user-free and covered by `tests/db/core-repos.test.ts`.
- `CoreTraces.countSince(loop: string, from: Date): Promise<number>` counts `status = 'done'` traces for the loop.
- `World.setOutcome(id: string, outcome: "happened" | "fell_through", appraisedAt: Date | null): Promise<void>` updates only an unappraised row; `World.resolutionForPlan(planId: string): Promise<WorldEventRow | null>` returns the resolution row, if any. `WorldEventRow` includes `plan_ref`, `outcome`, `fallthrough`, and `resolves_memory_id`.
- `LandingEvent` gains `expected: string | null`; `applyAppraisal(core, deps, event, appraisal, embedding, now)` resolves intention through `eventRef(event.planRef ?? event.worldEventId)` without duplicating lookup. `event.planRef` is `string | null`.
- Exported signatures: `coreMindTick(deps: CoreDeps, now: Date): Promise<{ anticipate: LoopStatus; ruminate: LoopStatus; wander: LoopStatus }>`; `anticipateDue(...)`, `ruminateDue(...)`, `wanderDue(...)` are pure exported predicates; `writeLoopThoughts(core, deps, loop, traceId, outputs, relatedValence, now)` owns dedupe/write.
- Config paths/values: `core.world.goal_event_share = 0.5`, `goal_weight_floor = 0.1`, `fallthrough_probability = 0.15`; `core.loops.content_max_chars = 300`, `dedupe_similarity = 0.92`, `thought_confidence = 0.6`, `salience.low = 0.25`, `salience.medium = 0.4`; `core.wander.max_per_day = 2`, `min_gap_hours = 3`, `seed_days = 7`, `mood_bias = 0.5`, `chain = 3`, `chain_min_similarity = 0.3`, `max_items = 2`; `core.anticipate.lead_hours = 12`, `arousal_gain = 0.3`; `core.ruminate.min_valence = 0.5`, `delay_hours = 2`, `window_hours = 24`, `max_per_episode = 1`, `gain = 0.1`; each loop has `max_tokens`; `core.mind.tick_cron` must be the verified minute after both existing core crons and is recorded exactly in DECISIONS (do not assume an impossible ordering).
- Prompt purpose/config keys: `core_resolve`, `core_anticipate`, `core_ruminate`, `core_wander`; model role `core`; files exactly `prompts/core/resolve/v1.md`, `anticipate/v1.md`, `ruminate/v1.md`, `wander/v1.md`; event prompt is `prompts/life/event/v4.md` registered as `prompts.life_event = "v4"` and v3 is deleted.
- Goal seeds: `${day}:goal` for hit, `${day}:goal-pick` for weighted pick. Fall-through seed `${eventId}:fallthrough`; wander seed `${day}:wander:${n}` where `n` is today's completed wander count.


## Executor corrections (binding; override anything below that disagrees)

Reviewed by Claude against the code. Where a task's sketch code conflicts with the real APIs, the real APIs and these notes win; write real code, never the sketch.

- **Tests use the real DB harness.** Follow `tests/mind/process/core/world-tick.test.ts`: `resetDb` / `closeTestDb` from `tests/helpers/db`, `makeTestDeps` from `tests/helpers/deps`, `coreDepsOf`, `sequence` from `tests/helpers/llm`. There is no `fixture()` helper; don't invent one. Due predicates take plain data (rows already read) so their unit tests need no DB; the loops are tested against the DB.
- **Embedder:** `embed(texts: string[], inputType: "query" | "document"): Promise<number[][]>`. Embed all of a run's outputs in one call (`"document"`), outside the transaction, like `appraiseDue`.
- **Downtime:** downtime is not a block. Her current block is downtime when today has a plan and `blockAt(await todaysBlocks(deps, now), now)` is `null` (`src/mind/world/blocks.ts`). No plan for today: not due.
- **Wander seed pool:** don't use `candidates()` (it needs a query vector and ranks by similarity). Add `CoreMemory.recallable(since: Date, limit: number): Promise<(CoreMemoryItem & { embedding: number[] })[]>`: kind not `hypothetical`, status not `stale`/`superseded`, `created_at > since`, newest first, at most `limit` (config `core.wander.pool_limit` = 50). Weighted pick with `seededUnit`, then `near(seed.embedding, chain + 1, chain_min_similarity)` minus the seed.
- **thoughts.ts:** `max_items` is wander's cap; anticipate and ruminate write exactly one thought. The writer takes the cap from its caller, not from `core.wander`.
- **Cron:** world tick is `10 * * * *`, state tick `45 * * * *`; `core.mind.tick_cron` = `"50 * * * *"`. Its DECISIONS row says why (after both, so it sees the hour's events and state).
- **Not-due loops** are reported as `"not_due"` in `coreMindTick`'s result (type `LoopStatus | "not_due"`), not `"done"`: no runner call, no trace.
- **Invalid output:** if the fake has no invalid switch already, add one used by every core purpose in tests (including `core_appraise`); otherwise reuse what 8a built. Check `src/mind/platform/llm/fake.ts` first.
- **Prompt files** are full text written in the style of `prompts/core/appraise/v1.md`; the plan's prompt sketches are content requirements, not final text.
- Keep the project's slips in check: every new file starts with a plain-English why-header; "why" comments where a choice isn't obvious; both the JSON and the zod schema for every config key; no plan-given test is shortened without reporting it.

## Task list

1. Data/config/prompt contracts and goal-directed event generation.
2. Resolution, appraise expectation, and B51 landing closure.
3. Core memory/traces repository extensions and structural tests.
4. Anticipate, ruminate, wander, dedupe, and idempotent thought writes.
5. Worker registration and eval hourly ordering.
6. Fakes, canary, spec/DECISIONS paperwork, and final verification.

# Task 1: Data, configuration, prompts, and goal-directed event generation

**Files:**
- Modify: `src/db/schema.ts` (add only the two new `world_event` columns; do not add existing `plan_ref`, `goal_ref`, `outcome`, or `resolution`).
- Modify: `src/mind/platform/config.ts`, `config/default.json` (world goal/roll settings and prompt registrations).
- Modify: `src/mind/world/types.ts`, `src/mind/world/events.ts`, `src/mind/process/core/world-tick.ts`.
- Create: `prompts/life/event/v4.md`, `prompts/core/resolve/v1.md`.
- Modify: `tests/mind/world/events.test.ts`, `tests/db/schema.test.ts`.

**Interfaces:**
- Consumes the existing `CoreDeps`, `CoreGoals.active(): Promise<CoreGoal[]>`, `seededUnit(seed: string): number`, and `reconcileAgainstNeighbours`.
- Produces `EventCandidate.goal_ref: string | null`, `AcceptedEvent.goalRef: string | null`, and `NewWorldEvent.goal_ref?: string | null`; Task 2 consumes the latter when recording and uses `prompts.core_resolve`.
- Existing DB fields remain untouched: `world_event.plan_ref`, `world_event.goal_ref`, `world_event.outcome`, and enum value `resolution` already exist.

## Steps

- [ ] **Step 1: Add failing tests for the new schema and goal selection.** Append these tests to `tests/mind/world/events.test.ts` (retain the existing helpers/imports and update the old v3 assertion to v4):

```ts
test("goal-driven generation records the selected active goal and sends the directive", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(ev("Spica finished the chapter."));
  const goal = await deps.core.goals.insert({
    title: "finish the book",
    why: "she wants to understand it",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    embedding: vec(0.2),
  });
  vi.spyOn(deps.core.goals, "active").mockResolvedValue([
    { id: goal, title: "finish the book", why: "she wants to understand it", status: "active", progress: 0.2, source: "seed", source_ref: null, started_at: now, target_at: null, updated_at: now },
  ]);
  const out = await generateCoreEvents(coreDepsOf(deps), day, now);
  expect(out.accepted[0]!.goalRef).toBe(goal);
  expect(deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!.system).toContain(
    "This event touches this goal, for better or worse",
  );
});

test("injected events never receive an implicit goal", async () => {
  const deps = makeTestDeps({ core: { world: { event_probability: 0 } } });
  vi.spyOn(deps.core.goals, "active").mockResolvedValue([
    { id: "11111111-1111-1111-1111-111111111111", title: "goal", why: "why", status: "active", progress: 0, source: "seed", source_ref: null, started_at: now, target_at: null, updated_at: now },
  ]);
  const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => ({ content: "Spica found a note.", valence: 0 }));
  expect(out.accepted[0]!.goalRef).toBeNull();
});

test("goal choice is deterministic for a day", async () => {
  const a = makeTestDeps(always);
  const b = makeTestDeps(always);
  const goals = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"].map((id, i) => ({ id, title: `g${i}`, why: "why", status: "active" as const, progress: i / 10, source: "seed" as const, source_ref: null, started_at: now, target_at: null, updated_at: now }));
  vi.spyOn(a.core.goals, "active").mockResolvedValue(goals);
  vi.spyOn(b.core.goals, "active").mockResolvedValue(goals);
  a.llm.handlers.life_event = sequence(ev("Spica read."));
  b.llm.handlers.life_event = sequence(ev("Spica read."));
  expect((await generateCoreEvents(coreDepsOf(a), day, now)).accepted[0]!.goalRef).toBe(
    (await generateCoreEvents(coreDepsOf(b), day, now)).accepted[0]!.goalRef,
  );
});
```

- [ ] **Step 2: Run the focused tests and verify the expected failure.**

Run: `pnpm vitest run tests/mind/world/events.test.ts tests/db/schema.test.ts`

Expected: FAIL because `goalRef` is not present on `AcceptedEvent`, the v3 prompt assertion still expects v3, and the new columns/config keys are absent.

- [ ] **Step 3: Add the migration/schema columns with the exact existing style.** In `src/db/schema.ts`, in the existing `world_event` table object immediately after the existing `goal_ref`/`outcome` fields, add exactly:

```ts
resolves_memory_id: uuid("resolves_memory_id").references(() => core_memory.id, {
  onDelete: "set null",
}),
fallthrough: boolean("fallthrough"),
```

The existing table currently has `plan_ref: text("plan_ref")`, `goal_ref: uuid("goal_ref")`, and `outcome: text("outcome")`; leave those lines in place. The existing enum declaration is `pgEnum("world_event_kind", ["planned", "surprise", "resolution"])`; leave it in place. The generated migration must be the repository's next timestamped SQL file and must include only these two additions for this task.

Do not alter `plan_ref`, `goal_ref`, `outcome`, or `worldEventKind`. Generate the migration with the repository's normal migration command and inspect it to ensure it contains `ALTER TABLE "world_event" ADD COLUMN "resolves_memory_id" uuid ... ON DELETE set null` and nullable `boolean`, with no `DEFAULT now()`.

- [ ] **Step 4: Extend the config schema and JSON exactly.** Replace `coreWorld` with the same existing fields plus:

```ts
goal_event_share: unit,
goal_weight_floor: unit,
fallthrough_probability: unit,
```

Add to the `core` schema after `world: coreWorld,`:

```ts
loops: z.object({
  content_max_chars: positiveInt,
  dedupe_similarity: unit,
  thought_confidence: unit,
  salience: z.object({ low: unit, medium: unit }),
}),
anticipate: z.object({ lead_hours: z.number().positive(), arousal_gain: unit, max_tokens: positiveInt }),
ruminate: z.object({ min_valence: unit, delay_hours: z.number().positive(), window_hours: z.number().positive(), max_per_episode: countFromZero, gain: unit, max_tokens: positiveInt }),
wander: z.object({ max_per_day: countFromZero, min_gap_hours: z.number().positive(), seed_days: positiveInt, mood_bias: z.number().min(-1).max(1), chain: positiveInt, chain_min_similarity: unit, max_items: positiveInt, max_tokens: positiveInt }),
```

In `config/default.json`, add these exact values under `core.world`, and add the three loop objects under `core`:

```json
"goal_event_share": 0.5,
"goal_weight_floor": 0.1,
"fallthrough_probability": 0.15
```

```json
"loops": { "content_max_chars": 300, "dedupe_similarity": 0.92, "thought_confidence": 0.6, "salience": { "low": 0.25, "medium": 0.4 } },
"anticipate": { "lead_hours": 12, "arousal_gain": 0.3, "max_tokens": 500 },
"ruminate": { "min_valence": 0.5, "delay_hours": 2, "window_hours": 24, "max_per_episode": 1, "gain": 0.1, "max_tokens": 300 },
"wander": { "max_per_day": 2, "min_gap_hours": 3, "seed_days": 7, "mood_bias": 0.5, "chain": 3, "chain_min_similarity": 0.3, "max_items": 2, "max_tokens": 500 }
```

Register prompts by changing `"life_event": "v3"` to `"life_event": "v4"` and adding exact keys to `prompts` schema/object:

```ts
core_resolve: promptVersion,
core_anticipate: promptVersion,
core_ruminate: promptVersion,
core_wander: promptVersion,
```

```json
"core_resolve": "v1",
"core_anticipate": "v1",
"core_ruminate": "v1",
"core_wander": "v1"
```

- [ ] **Step 5: Replace the event prompt with this complete v4 text.** Create `prompts/life/event/v4.md`:

```md
# Something in her day (v4)

You are writing one thing in Spica's day. It happens once, in her own life, whoever she talks to. The persona above is who she is; her plan for today, what has happened in her life lately and the people she knows are in the input. Never contradict any of it.

Every event is planned or spontaneous. A planned event is something she means to do or knows is coming and includes a present-tense thought; a spontaneous event is a surprise and has `thought: null`.

When the input includes a goal directive, this event touches this goal, for better or worse. Use that goal naturally; do not mention the directive or invent a goal id. Injected events have no goal directive and must not be assigned one.

The event is small and personal, fits a day's block or free time, and uses an HH:MM time in her zone. Content is one past-tense third-person sentence beginning â€œSpica â€¦â€. A planned thought is one present-tense third-person sentence beginning â€œSpica â€¦â€ and never says how the event turns out. `entity_names` lists people in it. `valence` is between -1 and 1; most events are between -0.4 and 0.6. `stakes` is low unless it would stay with her for days.

Return only the requested JSON object. If rejected attempts are supplied, write something different that avoids their stated problem.
```

- [ ] **Step 6: Implement goal selection and thread the goal through generation.** In `src/mind/world/events.ts`, make these exact type edits:

```ts
export type EventCandidate = z.infer<typeof EventSchema> & { goal_ref: string | null };
export type AcceptedEvent = { key: string; candidate: EventCandidate; embedding: number[]; thoughtEmbedding: number[] | null; at: Date; goalRef: string | null };
```

Extend `EventSchema` with `goal_ref: z.string().uuid().nullable().default(null)`. Add this helper before `generateCoreEvents`:

```ts
function chooseGoal(goals: Awaited<ReturnType<CoreDeps["core"]["goals"]["active"]>>, day: string, cfg: WorldConfig): string | null {
  if (!goals.length || seededUnit(`${day}:goal`) >= cfg.goal_event_share) return null;
  const weights = goals.map((g) => Math.max(0, 1 - g.progress + cfg.goal_weight_floor));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let pick = seededUnit(`${day}:goal-pick`) * total;
  for (let i = 0; i < goals.length; i++) { pick -= weights[i]!; if (pick < 0) return goals[i]!.id; }
  return goals.at(-1)!.id;
}
```

Immediately after `ctx` is loaded, set `const goalRef = chooseGoal(await deps.core.goals.active(), day, cfg);`. For every model candidate, pass the goal directive in `buildEventInput` (add an optional `goal` argument and append `This event touches this goal, for better or worse: ${goal.title} — ${goal.why}.`); for injected candidates set `goal_ref: null`; for model candidates set the selected id in the normalized candidate. The `goal_ref` is metadata, not model output: strip any model-supplied value and overwrite it with `goalRef`. Store `goalRef` on each accepted record. Do not assign a goal to injected events.

Change the call from `model: "life"` to `model: "life"` only for `life_event` (the event model role is unchanged); change no other purpose names in this task.

- [ ] **Step 7: Pass goal_ref into the world record.** In `src/mind/world/types.ts`, extend `NewWorldEvent` with `goal_ref?: string | null`, extend `WorldEventRow` with `outcome: "happened" | "fell_through" | null`, and ensure `AcceptedEvent.goalRef` is used by `src/mind/process/core/world-tick.ts` when calling `tx.world.recordEvent({ ..., goal_ref: e.goalRef })`. This task does not set outcomes or resolution columns; Task 2 owns those writes.

- [ ] **Step 8: Add the resolution prompt now so Task 2 has a complete contract.** Create `prompts/core/resolve/v1.md` with this exact text:

```md
# Plan resolution

You are Spica's core mind deciding what happens when a planned intention falls through. The plan, her intention, core values, and current snapshot are supplied. Write one bounded replacement event that actually happened, in the past tense and third person, beginning â€œSpica â€¦â€. Do not claim the original plan happened. Keep it personal and specific; do not invent users or conversations. Return JSON with `content`, `valence`, and `stakes` only. `valence` must be between -1 and 1 and `stakes` must be `low` or `high`.
```

- [ ] **Step 9: Update the existing prompt test and run verification.** Replace the old test name/body with:

```ts
test("the generator's prompt is life/event v4 and includes the goal directive when selected", async () => {
  const deps = makeTestDeps(always);
  expect(deps.config.prompts.life_event).toBe("v4");
  deps.llm.handlers.life_event = sequence(ev("Spica read."));
  await generateCoreEvents(coreDepsOf(deps), day, now);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!;
  expect(call.system).toContain("planned");
  expect(call.system).toContain("spontaneous");
});
```

Run: `pnpm vitest run tests/mind/world/events.test.ts tests/db/schema.test.ts`

Expected: `PASS` for the focused suites, including the deterministic goal, injected-event, v4 prompt, and nullable-column assertions.

- [ ] **Step 10: Commit the task.**

```bash
git add src/db/schema.ts src/mind/platform/config.ts config/default.json src/mind/world/events.ts src/mind/world/types.ts src/mind/process/core/world-tick.ts prompts/life/event/v4.md prompts/core/resolve/v1.md tests/mind/world/events.test.ts tests/db/schema.test.ts
git commit -m "feat: add goal-directed core event contracts"
```

The executor must not run this command in the planning phase; it is included as the implementation hand-off only.

## Review focus tests owned by this task

- A goal roll at exactly the seeded boundary produces no goal, while a below-boundary roll picks by `1 - progress + 0.1`; the first and third tests above pin this behavior.
- An injected event never receives a goal even when active goals exist; the second test above pins this behavior.
- Existing world-event columns and `resolution` are not duplicated; the schema test must assert the table has exactly one `plan_ref`, `goal_ref`, `outcome`, and `resolution` definition and only the two new columns are introduced.

## Paperwork required by Task 6

Task 6 must add the DECISIONS row: `2026-10-02 | world_event.outcome remains text in Postgres but WorldEventRow narrows it to "happened" | "fell_through" | null in TypeScript | Existing rows and resolution writes are compatible while callers cannot invent arbitrary outcomes.`

# Task 2: Resolve planned events before appraisal and close B51 targets

**Files:**
- Modify: `src/mind/process/core/world-tick.ts`
- Modify: `src/mind/process/core/appraise.ts`
- Modify: `src/mind/world/types.ts`
- Modify: `src/db/repos/core/world.ts` (only the methods named in the shared header)
- Test: `tests/mind/process/core/world-tick.test.ts`
- Test: `tests/mind/process/core/appraise.test.ts`

**Interfaces:**
- Consumes the Task 1 `WorldEventRow` fields `plan_ref`, `outcome`, `fallthrough`, `resolves_memory_id`, and the Task 1 `World` methods `dueUnappraised`, `setOutcome`, and `recordEvent` accepting those fields. Do not add a second plan-reference or outcome column.
- Produces `LandingEvent.expected: string | null`; `landing(e)` sets it from the intention whose source is `eventRef(e.plan_ref)` (the original plan for a resolution), and `proposeAppraisal` prints it as â€œWhat she expectedâ€.
- Produces resolution handling inside `coreWorldTick`: it runs before `appraiseDue`; it uses `runCoreLoop(deps, "core_resolve", ...)`, performs model calls outside the transaction, and commits only after the locked re-check.

## Resolution tests

- [ ] **Step 1: Add the failing resolution tests.** Append these imports and tests to `tests/mind/process/core/world-tick.test.ts`; use the existing `makeTestDeps`, `resetDb`, and helper conventions already present in that file.

```ts
import { world_event } from "@/db/schema";
import { eq } from "drizzle-orm";

test("coreWorldTick resolves a forced fall-through plan before appraisal", async () => {
  const deps = makeTestDeps();
  const at = new Date("2026-01-05T12:00:00Z");
  const original = await deps.core.world.recordEvent({
    at, kind: "planned", content: "She plans to call Mira.", valence: 0.2,
    stakes: "low", agents: [], life_day: "2026-01-05", created_at: at,
    fallthrough: true,
  });
  const intention = await deps.core.memory.insert({
    kind: "intention", content: "She will call Mira.", payload: { event_at: at.toISOString() },
    embedding: vec(0.1), entity_refs: [], occurred_at: at, created_at: at,
    status: "open", salience: 0.5, valence: 0.2, confidence: 1,
    source: "world", source_ref: `world_event:${original}`,
  });
  deps.llm.handlers.core_resolve = async (input) => ({
    content: `She does not call Mira; ${input.slice(0, 10)}`,
    valence: -0.4, stakes: "low",
  });
  const result = await coreWorldTick(deps, at);
  expect(result.appraised).toBe(0);
  const rows = await deps.core.world.events("2026-01-05");
  const resolution = rows.find((row) => row.kind === "resolution");
  expect(resolution).toMatchObject({ plan_ref: original, outcome: null, valence: -0.4 });
  expect(resolution!.at.getTime()).toBe(at.getTime());
  expect((await deps.db.select().from(world_event).where(eq(world_event.id, original)))[0]!.outcome)
    .toBe("fell_through");
  expect((await deps.core.memory.get(intention))!.status).toBe("open");
});

test("a planned event that does not fall through is appraised normally and is not resolved", async () => {
  const deps = makeTestDeps();
  const at = new Date("2026-01-05T12:00:00Z");
  const id = await deps.core.world.recordEvent({
    at, kind: "planned", content: "She sends the message.", valence: 0.3,
    stakes: "low", agents: [], life_day: "2026-01-05", created_at: at,
    fallthrough: false,
  });
  await coreWorldTick(deps, at);
  const row = (await deps.core.world.events("2026-01-05")).find((e) => e.id === id)!;
  expect(row.outcome).toBe("happened");
  expect((await deps.core.world.events("2026-01-05")).filter((e) => e.kind === "resolution")).toHaveLength(0);
});

test("resolution fallback leaves the plan unappraised for ordinary appraisal", async () => {
  const deps = makeTestDeps();
  const at = new Date("2026-01-05T12:00:00Z");
  const id = await deps.core.world.recordEvent({
    at, kind: "planned", content: "She loses the key.", valence: -0.5,
    stakes: "low", agents: [], life_day: "2026-01-05", created_at: at,
    fallthrough: true,
  });
  deps.llm.handlers.core_resolve = sequence(new Error("model down"));
  await coreWorldTick(deps, at);
  expect((await deps.core.world.events("2026-01-05")).find((e) => e.id === id)!.outcome).toBeNull();
  expect((await deps.core.traces.list("core_resolve"))[0]!.status).toBe("fallback");
});
```

- [ ] **Step 2: Run the focused tests and verify failure.** Run `pnpm vitest tests/mind/process/core/world-tick.test.ts -t "fall-through|fall through|resolution fallback"`. Expected: FAIL because `NewWorldEvent` and `LandingEvent` do not yet expose the new fields and `core_resolve` is not called.

## Resolution implementation

- [ ] **Step 3: Extend world types with the existing columns and new event input.** Replace the `NewWorldEvent` and `WorldEventRow` declarations in `src/mind/world/types.ts` with the following exact declarations; the repository maps all fields without renaming them.

```ts
export type NewWorldEvent = {
  at: Date;
  kind: "planned" | "surprise" | "resolution";
  content: string;
  valence: number;
  stakes: "low" | "high";
  agents: string[];
  agent_names?: string[];
  life_day: string;
  created_at: Date;
  plan_ref?: string | null;
  goal_ref?: string | null;
  outcome?: "happened" | "fell_through" | null;
  resolves_memory_id?: string | null;
  fallthrough?: boolean | null;
};
export type WorldEventRow = NewWorldEvent & {
  id: string;
  agent_names: string[];
  appraised_at: Date | null;
  plan_ref: string | null;
  goal_ref: string | null;
  outcome: "happened" | "fell_through" | null;
  resolves_memory_id: string | null;
  fallthrough: boolean | null;
};
```

- [ ] **Step 4: Update the repository mapping and outcome methods.** In `src/db/repos/core/world.ts`, add the four fields to `toRow` immediately after `goal_ref`, and add these interface-backed methods to the returned object (the shared Task 1 interface must expose the same signatures):

```ts
plan_ref: r.plan_ref,
goal_ref: r.goal_ref,
outcome: (r.outcome as WorldEventRow["outcome"]) ?? null,
resolves_memory_id: r.resolves_memory_id,
fallthrough: r.fallthrough,
```

```ts
async setOutcome(id, outcome) {
  await db.update(world_event).set({ outcome }).where(eq(world_event.id, id));
},
async resolutionForPlan(planRef) {
  const row = await db.select().from(world_event)
    .where(and(eq(world_event.kind, "resolution"), eq(world_event.plan_ref, planRef))).limit(1);
  return row[0] ? toRow(row[0]) : null;
},
```

`recordEvent` must continue to be the existing single insert body, now receiving the optional fields through `NewWorldEvent`; do not add a duplicate insert path.

- [ ] **Step 5: Add `resolveDue` and call it before appraisal.** Insert this function into `src/mind/process/core/world-tick.ts` immediately before `appraiseDue`, and change the first body of `coreWorldTick` from `appraiseDue(deps, now)` to `resolveDue(deps, now); appraiseDue(deps, now)`.

```ts
async function resolveDue(deps: CoreDeps, now: Date): Promise<void> {
  const pending = (await deps.core.world.dueUnappraised(now)).filter(
    (e) => e.kind === "planned" && e.outcome === null,
  );
  const falling = pending.filter((e) =>
    e.fallthrough ?? seededUnit(`${e.id}:fallthrough`) < deps.config.core.world.fallthrough_probability,
  );
  if (!falling.length) return;
  await runCoreLoop(deps, "core_resolve", now, async (ctx) => {
    if (!ctx.canCall()) return { status: "fallback", inputs: { plans: falling.map((e) => e.id) }, outputs: { resolved: [] } };
    const { config } = ctx.deps;
    const proposals = await Promise.all(falling.map(async (plan) => ({
      plan,
      raw: await ctx.deps.llm.classifyJson({
        purpose: "core_resolve", model: "core", system: loadPrompt("core/resolve", config.prompts.core_resolve),
        input: `Plan ${plan.content}\nIntention: ${(await ctx.deps.core.memory.bySourceRef("intention", eventRef(plan.id)))?.content ?? "none"}`,
        schema: ResolveSchema, timeoutMs: config.models.structured_timeout_ms,
        maxTokens: config.core.resolve.max_tokens,
      }),
    })));
    const out = await deps.core.transaction(async (tx) => {
      await tx.lock(LOCK);
      const made: string[] = [];
      for (const { plan, raw } of proposals) {
        const current = (await tx.world.dueUnappraised(now)).find((e) => e.id === plan.id);
        if (!current || current.outcome !== null) continue;
        const id = await tx.world.recordEvent({ at: current.at, kind: "resolution", plan_ref: current.id,
          goal_ref: current.goal_ref, content: raw.content.slice(0, config.core.world.resolution_content_max_chars),
          valence: clamp(raw.valence, -1, 1), stakes: raw.stakes, agents: current.agents,
          agent_names: current.agent_names, life_day: current.life_day, created_at: now });
        await tx.world.setOutcome(current.id, "fell_through");
        await tx.world.markAppraised(current.id, now);
        made.push(id);
      }
      return { resolved: made };
    });
    return { status: "done", inputs: { plans: falling.map((e) => e.id) }, outputs: out };
  });
}
```

The implementation must import `seededUnit`, `loadPrompt`, and the shared `ResolveSchema`; invalid output or an exception is caught by `runCoreLoop`, returns `fallback`, and performs no transaction writes. A resolution's `resolves_memory_id` is copied from the original attempt only when the generation decision is `resolves`; this task does not invent a new generation decision.

## Appraisal expected text and B51 closure

- [ ] **Step 6: Add the expected-field regression tests.** In `tests/mind/process/core/appraise.test.ts`, change `base` to include `expected: null`, and append:

```ts
test("resolution appraisal shows the original intention as expected and resolves B51 target only when it is preoccupied", async () => {
  const { deps, event } = await setup();
  const planId = event.worldEventId;
  const intention = await addIntention(deps, planId);
  const target = await deps.core.memory.insert({ kind: "episode", content: "An unresolved worry", payload: {},
    embedding: vec(0.03), entity_refs: [], occurred_at: earlier, created_at: earlier, status: "open",
    salience: 0.5, valence: -0.4, confidence: 1, source: "world", source_ref: "old" });
  await deps.core.state.update({ preoccupation: target, preoccupation_since: earlier });
  const resolution = { ...event, kind: "resolution" as const, planRef: planId, expected: intention ? "She will call Mira." : null,
    resolvesMemoryId: target, content: "She does not call Mira." };
  const out = await deps.core.transaction((tx) => applyAppraisal(tx, deps, resolution,
    codeAppraisal(resolution, deps.config.core), vec(0.04), now));
  expect((await deps.core.memory.get(target))!.status).toBe("resolved");
  expect((await deps.core.state.get())!.preoccupation).toBeNull();
  expect(out.intentionId).toBe(intention);
});
```

- [ ] **Step 7: Implement `expected`, plan-ref lookup, and B51 closure.** Replace `LandingEvent` with the shared-header shape, adding `planRef: string | null`, `expected: string | null`, and `resolvesMemoryId: string | null`. In `proposeAppraisal`, replace the existing lookup line:

```ts
const expected = await core.memory.bySourceRef("intention", eventRef(event.worldEventId));
```

with:

```ts
const expected = event.expected;
```

and keep the existing prompt line, which now prints `expected ?? "nothing; she didn't see it coming"`.

In `applyAppraisal`, replace `const ref = eventRef(event.worldEventId);` with `const ref = eventRef(event.planRef ?? event.worldEventId);`. Replace the intention lookup with `const intention = await core.memory.bySourceRef("intention", ref);`. Immediately after the existing preoccupation branch, add:

```ts
if (event.resolvesMemoryId) {
  await core.memory.setStatus(event.resolvesMemoryId, "resolved");
  if (row.preoccupation === event.resolvesMemoryId)
    preoccupation = { preoccupation: null, preoccupation_since: null };
}
```

`landing(e)` must set `planRef: e.plan_ref`, `expected` by lookup in `proposeAppraisal` (the lookup is `eventRef(e.plan_ref ?? e.id)`), and `resolvesMemoryId: e.resolves_memory_id`; callers must pass the same landing object to `proposeAppraisal` and `applyAppraisal` so the value is not re-derived inside the transaction.

- [ ] **Step 8: Run focused tests and typecheck.** Run `pnpm vitest tests/mind/process/core/world-tick.test.ts tests/mind/process/core/appraise.test.ts -v`. Expected: all existing tests plus the new resolution and B51 tests PASS. Run `pnpm typecheck`. Expected: PASS with no unused import; if an expected-field test needs a captured prompt assertion, use the existing `deps.llm.structuredCalls` list and assert its `input` contains `What she expected: She will call Mira.`.

- [ ] **Step 9: Commit this reviewable unit.**

```bash
git add src/mind/process/core/world-tick.ts src/mind/process/core/appraise.ts src/mind/world/types.ts src/db/repos/core/world.ts tests/mind/process/core/world-tick.test.ts tests/mind/process/core/appraise.test.ts
git commit -m "feat: resolve planned fall-throughs and close landing targets"
```

### Task 3: Core memory and trace repository extensions

**Files:**
- Modify: `src/mind/memory/core/types.ts`
- Modify: `src/db/repos/core/memory.ts`
- Modify: `src/mind/platform/core.ts`
- Modify: `src/db/repos/core/traces.ts`
- Create: `src/db/migrations/0019_core_loop_memory_helpers.sql`
- Modify: `tests/db/core-repos.test.ts`
- Test: `tests/db/core-repos.test.ts`

**Interfaces:**
- Consumes: the existing `core_memory` table (including `recall_count`, `last_recalled_at`, `salience`, and JSONB `payload`) and `core_loop_trace` table.
- Produces: `CoreMemory.mergePayload(id: string, patch: Record<string, unknown>): Promise<void>`, `CoreMemory.reinforce(id: string, now: Date, opts: { bump: number; cap: number }): Promise<void>`, and `CoreTraces.countSince(loop: string, from: Date): Promise<number>`; all are user-free and therefore safe for core loops.

- [ ] **Step 1: Add failing structural and behavioral tests**

Append these tests to `tests/db/core-repos.test.ts`; the imports remain the existing `afterAll, beforeEach, expect, test` import and the existing `core()`/`episode()` helpers are reused.

```ts
test("core memory merges payload without replacing existing keys", async () => {
  const id = await core().memory.insert({
    ...episode("plan", 0.01, now),
    kind: "intention",
    payload: { anticipated_at: null, count: 1 },
    status: "open",
  });

  await core().memory.mergePayload(id, { count: 2, ruminated: 1 });

  expect((await core().memory.get(id))?.payload).toEqual({
    anticipated_at: null,
    count: 2,
    ruminated: 1,
  });
});

test("core memory reinforce bumps salience with a cap and records recall", async () => {
  const id = await core().memory.insert({
    ...episode("recalled", 0.01, now),
    salience: 0.8,
  });
  const recalledAt = new Date(now.getTime() + 1_000);

  await core().memory.reinforce(id, recalledAt, { bump: 0.3, cap: 0.95 });

  const item = await core().memory.get(id);
  expect(item?.salience).toBeCloseTo(0.95);
  expect(item?.last_recalled_at?.getTime()).toBe(recalledAt.getTime());
  const { core_memory } = await import("@/db/schema");
  const [row] = await getTestDb().select({ recall_count: core_memory.recall_count }).from(core_memory);
  expect(row?.recall_count).toBe(1);
});

test("reinforce does not update a missing core memory", async () => {
  await core().memory.reinforce("00000000-0000-0000-0000-000000000000", now, {
    bump: 0.2,
    cap: 1,
  });
  expect(await core().memory.candidates(vec(0.01), 5)).toEqual([]);
});

test("countSince counts only done traces for the requested loop", async () => {
  const traces = core().traces;
  await traces.insert({
    loop: "core_wander",
    inputs: {},
    outputs: {},
    model: null,
    prompt_version: null,
    tokens_in: null,
    tokens_out: null,
    cost: null,
    calls: 0,
    status: "done",
    error: null,
    created_at: new Date(now.getTime() - 1_000),
  });
  await traces.insert({
    loop: "core_wander",
    inputs: {},
    outputs: {},
    model: null,
    prompt_version: null,
    tokens_in: null,
    tokens_out: null,
    cost: null,
    calls: 1,
    status: "failed",
    error: "invalid_output",
    created_at: now,
  });
  await traces.insert({
    loop: "core_anticipate",
    inputs: {},
    outputs: {},
    model: null,
    prompt_version: null,
    tokens_in: null,
    tokens_out: null,
    cost: null,
    calls: 0,
    status: "done",
    error: null,
    created_at: now,
  });

  expect(await traces.countSince("core_wander", new Date(now.getTime() - 2_000))).toBe(1);
  expect(await traces.countSince("core_wander", now)).toBe(0);
});

test("core repository methods accept no user id", async () => {
  const memory = core().memory;
  const traces = core().traces;
  const merge: (id: string, patch: Record<string, unknown>) => Promise<void> =
    memory.mergePayload;
  const reinforce: (
    id: string,
    at: Date,
    opts: { bump: number; cap: number },
  ) => Promise<void> = memory.reinforce;
  const count: (loop: string, from: Date) => Promise<number> = traces.countSince;
  expect(merge).toBeTypeOf("function");
  expect(reinforce).toBeTypeOf("function");
  expect(count).toBeTypeOf("function");
});
```

Run: `pnpm vitest run tests/db/core-repos.test.ts -t "core memory merges payload"`

Expected: FAIL because `mergePayload` is not a member of `CoreMemory`.

- [ ] **Step 2: Extend the core interfaces with the exact signatures**

In `src/mind/memory/core/types.ts`, insert the following two members immediately after `setStatus` in `CoreMemory`:

```ts
  mergePayload(id: string, patch: Record<string, unknown>): Promise<void>;
  reinforce(id: string, now: Date, opts: { bump: number; cap: number }): Promise<void>;
```

In `src/mind/platform/core.ts`, replace the existing `CoreTraces` interface:

```ts
export interface CoreTraces {
  insert(trace: NewCoreLoopTrace): Promise<void>;
  /** Model calls traced at or after `from`: what today's budget has spent. */
  callsSince(from: Date): Promise<number>;
}
```

with:

```ts
export interface CoreTraces {
  insert(trace: NewCoreLoopTrace): Promise<void>;
  /** Model calls traced at or after `from`: what today's budget has spent. */
  callsSince(from: Date): Promise<number>;
  /** Completed runs of one loop at or after `from`; failed/fallback runs do not count. */
  countSince(loop: string, from: Date): Promise<number>;
}
```

- [ ] **Step 3: Implement JSONB merge and recall reinforcement**

In `src/db/repos/core/memory.ts`, replace the existing `setStatus` method block:

```ts
    async setStatus(id, status) {
      await db.update(core_memory).set({ status }).where(eq(core_memory.id, id));
    },
```

with:

```ts
    async setStatus(id, status) {
      await db.update(core_memory).set({ status }).where(eq(core_memory.id, id));
    },

    async mergePayload(id, patch) {
      await db
        .update(core_memory)
        .set({ payload: sql`COALESCE(${core_memory.payload}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` })
        .where(eq(core_memory.id, id));
    },

    async reinforce(id, now, opts) {
      await db
        .update(core_memory)
        .set({
          last_recalled_at: now,
          recall_count: sql`${core_memory.recall_count} + 1`,
          salience: sql`LEAST(${opts.cap}::real, ${core_memory.salience} + ${opts.bump}::real)`,
        })
        .where(eq(core_memory.id, id));
    },
```

This is the core equivalent of `src/db/repos/user/facts.ts:applyRecall`: salience is capped, `recall_count` increments, and `last_recalled_at` is set in one UPDATE. It intentionally does not accept a user id and does not write a retrieval trace.

- [ ] **Step 4: Implement trace counting**

In `src/db/repos/core/traces.ts`, replace the import and returned object with this exact implementation (the existing `gte` and `sql` imports are retained and `and`, `eq` are added):

```ts
import { and, eq, gte, sql } from "drizzle-orm";
```

Replace the existing `callsSince` method block:

```ts
    async callsSince(from) {
      const [row] = await db
        .select({ n: sql<number>`COALESCE(sum(${core_loop_trace.calls}), 0)::int` })
        .from(core_loop_trace)
        .where(gte(core_loop_trace.created_at, from));
      return Number(row?.n ?? 0);
    },
```

with:

```ts
    async callsSince(from) {
      const [row] = await db
        .select({ n: sql<number>`COALESCE(sum(${core_loop_trace.calls}), 0)::int` })
        .from(core_loop_trace)
        .where(gte(core_loop_trace.created_at, from));
      return Number(row?.n ?? 0);
    },

    async countSince(loop, from) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(core_loop_trace)
        .where(
          and(
            eq(core_loop_trace.loop, loop),
            eq(core_loop_trace.status, "done"),
            gte(core_loop_trace.created_at, from),
          ),
        );
      return Number(row?.n ?? 0);
    },
```

- [ ] **Step 5: Add the migration for the JSONB default safety**

No new columns are required for this task: `core_memory.payload`, `recall_count`, `last_recalled_at`, and all trace columns already exist. Create `src/db/migrations/0019_core_loop_memory_helpers.sql` with exactly:

```sql
-- Core loop repository helpers use NULL payloads as empty JSON objects.
-- Existing rows remain valid; no timestamp default is introduced.
SELECT 1;
```

Do not add a fake schema change or re-add existing world-event columns. Run `pnpm drizzle-kit check` and expect `No schema changes detected` (or the repository's normal successful check output); the migration is a migration journal marker only because the repository behavior needs no database alteration.

- [ ] **Step 6: Run the focused tests and type checks**

Run: `pnpm vitest run tests/db/core-repos.test.ts`

Expected: PASS, including the merge, capped reinforcement, missing-id no-op, loop/status/time filtering, and no-user-parameter tests.

Run: `pnpm typecheck`

Expected: PASS with no `CoreMemory` or `CoreTraces` implementation missing-member errors.

Run: `pnpm lint`

Expected: PASS with no formatting or import errors.

- [ ] **Step 7: Commit the independently reviewable repository change**

```bash
git add src/mind/memory/core/types.ts src/db/repos/core/memory.ts src/mind/platform/core.ts src/db/repos/core/traces.ts src/db/migrations/0019_core_loop_memory_helpers.sql tests/db/core-repos.test.ts
git commit -m "feat: extend core memory and trace repositories"
```

Expected: one commit containing only this task's interfaces, repository methods, tests, and migration marker.

### Task 4: Anticipate, ruminate, wander, dedupe, and mind tick

**Files:**
- Create: `src/mind/process/core/anticipate.ts`, `ruminate.ts`, `wander.ts`, `thoughts.ts`, `mind-tick.ts`
- Modify: `src/mind/process/core/appraise.ts`, `src/mind/platform/config.ts`
- Test: `tests/mind/process/core/mind-tick.test.ts`

**Interfaces:** Consume `CoreDeps`, `runCoreLoop`, `CoreMemory.mergePayload/reinforce`, `CoreTraces.countSince`, `todaysBlocks`, and seededUnit. Produce pure due predicates and `coreMindTick` exactly as fixed in `00-header.md`.

- [ ] **Step 1: Write due-gate tests.** Add this complete fixture/test to `tests/mind/process/core/mind-tick.test.ts`:

```ts
const at = new Date("2026-01-05T12:00:00Z");
test("anticipateDue chooses soonest open intention and ignores anticipated rows", async () => {
  const deps = fixture({ intentions: [intention({ event_at: "2026-01-05T18:00:00Z" }), intention({ event_at: "2026-01-05T19:00:00Z", anticipated_at: at.toISOString() })] });
  expect(await anticipateDue(deps, at)).toMatchObject({ eventAt: new Date("2026-01-05T18:00:00Z") });
});
test("ruminateDue enforces delay, window, valence and count", async () => {
  const deps = fixture({ episodes: [episode({ occurred_at: "2026-01-05T09:00:00Z", valence: 0.7, payload: {} })] });
  expect(await ruminateDue(deps, at)).toMatchObject({ id: expect.any(String) });
});
test("wanderDue requires downtime, gap, and daily cap", async () => {
  const deps = fixture({ block: { kind: "downtime" }, wanderDone: 1, lastWander: new Date("2026-01-05T08:00:00Z") });
  expect(await wanderDue(deps, at)).toBe(true);
  expect(await wanderDue({ ...deps, wanderDone: 2 }, at)).toBe(false);
});
```

- [ ] **Step 2: Write application/dedupe tests.** Configure `FakeLLMProvider.handlers.core_anticipate`, `.core_ruminate`, `.core_wander`; assert anticipate merges `anticipated_at`, updates only arousal toward proposed value by `0.3`, and writes `{ anticipates: id }`; ruminate increments payload `ruminated`, reinforces episode, adjusts mood valence by `0.1 * sign(valence)` and writes `{ ruminates: id }`; wander writes no state. Stub `embedder.embed` and assert similarity `0.93` drops output and records `outputs.dropped`, while `0.91` inserts. Assert malformed optional output leaves zero memories and trace status `failed`.

- [ ] **Step 3: Run focused tests.** `pnpm vitest run tests/mind/process/core/mind-tick.test.ts`; expected FAIL with missing exports.

- [ ] **Step 4: Implement shared thought writer.** Create `thoughts.ts`:

```ts
export async function writeLoopThoughts(core: CoreScope, deps: Pick<CoreDeps,"config"|"embedder">, loop: string, traceId: string, outputs: { kind: "thought"|"idea"|"hypothetical"; content: string; salience: "low"|"medium" }[], relatedValence: number, now: Date) {
  const dropped: string[] = [];
  for (const output of outputs.slice(0, deps.config.core.wander.max_items)) {
    const content = output.content.trim().slice(0, deps.config.core.loops.content_max_chars);
    if (!content) continue;
    const embedding = await deps.embedder.embed(content);
    if ((await core.memory.near(embedding, 1, deps.config.core.loops.dedupe_similarity)).length) { dropped.push(content); continue; }
    await core.memory.insert({ kind: output.kind, content, payload: {}, embedding, occurred_at: null, created_at: now, status: "open", salience: deps.config.core.loops.salience[output.salience], valence: relatedValence, confidence: deps.config.core.loops.thought_confidence, source: "loop", source_ref: `${loop}:${traceId}` });
  }
  return { dropped };
}
```

- [ ] **Step 5: Implement anticipate and ruminate.** Use Zod schemas:

```ts
export const AnticipateSchema = z.object({ thought: z.string(), emotion: z.object({ label: z.string(), valence: z.number(), arousal: z.number() }) });
export const RuminateSchema = z.object({ thought: z.string() });
```

Each function loads `prompts/core/{anticipate,ruminate}/v1`, calls `ctx.deps.llm.classifyJson({ purpose: "core_anticipate"|"core_ruminate", model: "core", ... })`, bounds text to config, then performs all payload/state writes inside `core.transaction` under lock `core_mind_tick`. Reuse `boundAppraisal`'s clamp helper by exporting it from `appraise.ts`; do not copy numeric logic.

- [ ] **Step 6: Implement wander.** Export `wanderDue`; use `todaysBlocks` and `block.kind === "downtime"`, `countSince("core_wander", localMidnight)`, and last trace time. Select candidate memories from `core.memory.candidates(seedEmbedding, limit)` with `weight = salience * Math.max(0, 1 + cfg.mood_bias * valence * mood_valence)` and `seededUnit(`${day}:wander:${n}`)`. Exclude hypothetical, chain up to `cfg.chain` neighbors at `cfg.chain_min_similarity`. Parse `{ items: z.array(z.object({ kind: z.enum(["thought","idea","hypothetical"]), content: z.string(), salience: z.enum(["low","medium"]) })) }`; write hypothetical kind exactly as returned.

- [ ] **Step 7: Implement coordinator.** `coreMindTick` runs anticipate, ruminate, wander in order. Each checks due before calling `runCoreLoop`; not-due returns `"done"` with no runner call/trace, due loops catch failures so later loops run, and optional parse failures return `"failed"` with no writes. Every apply re-checks due under `core_mind_tick` lock to make retries idempotent.

- [ ] **Step 8: Run checks.** `pnpm typecheck` (0 errors), `pnpm lint` (exit 0), and `pnpm vitest run tests/mind/process/core/mind-tick.test.ts tests/db/core-repos.test.ts` (all PASS).


### Task 5: Register the core mind worker and hourly eval order

**Files:**
- Modify: `src/mind/platform/jobs.ts`, `src/worker/jobs.ts`, `src/worker/index.ts`, `evals/lib/life-loop.ts`, `evals/lib/script.ts`, `evals/lib/core-check.ts`
- Create: `src/worker/core-jobs.ts`
- Test: `tests/worker/jobs.test.ts`, `tests/evals/profile.test.ts`, `tests/evals/core-check.test.ts`

**Interfaces:** Consumes `coreMindTick(deps, now)`, `coreDepsOf`, and existing world/state registration. Produces `CORE_MIND_TICK_QUEUE = "core_mind_tick"`, `CORE_QUEUES`, and deterministic world→state→mind eval ordering.

- [ ] **Step 1: Write failing queue/order tests.** Add to `tests/worker/jobs.test.ts`:

```ts
test("system queues include core mind with no retries", async () => {
  const boss = fakeBoss();
  await ensureSystemQueues(boss as never);
  expect(boss.created).toContainEqual(["core_mind_tick", { retryLimit: 0 }]);
  expect(boss.updated).toContainEqual(["core_mind_tick", { retryLimit: 0 }]);
});
```

Add an eval test that injects spies for `coreWorldTick`, `coreStateTick`, and `coreMindTick`, calls `loop.start()`, and asserts `['world','state','mind']`.

- [ ] **Step 2: Run focused tests.** `pnpm vitest run tests/worker/jobs.test.ts tests/evals/profile.test.ts`; expected FAIL because the queue and call are absent.

- [ ] **Step 3: Add queue constant and registration.** Replace the queue constant block in `src/mind/platform/jobs.ts` by adding:

```ts
export const CORE_MIND_TICK_QUEUE = "core_mind_tick";
```

Create `src/worker/core-jobs.ts`:

```ts
/** The hourly optional core thinking worker. */
import type { PgBoss } from "pg-boss";
import { coreDepsOf, type Deps } from "@/mind/platform/deps";
import { CORE_MIND_TICK_QUEUE } from "@/mind/platform/jobs";
import { coreMindTick } from "@/mind/process/core/mind-tick";
import { scrubErrors } from "./jobs";

export const CORE_QUEUES = [CORE_MIND_TICK_QUEUE];
export async function registerCoreJobs(boss: PgBoss, deps: Deps): Promise<void> {
  await boss.work(CORE_MIND_TICK_QUEUE, scrubErrors(CORE_MIND_TICK_QUEUE, deps.log, async () => {
    await coreMindTick(coreDepsOf(deps), deps.clock.now());
  }));
  await boss.schedule(CORE_MIND_TICK_QUEUE, deps.config.core.mind.tick_cron);
}
```

Import `CORE_MIND_TICK_QUEUE` into `src/worker/jobs.ts` and add it to the hourly queue loop. Import/register `registerCoreJobs` in `src/worker/index.ts` and include `CORE_QUEUES` in the startup log.

- [ ] **Step 4: Add strict config.** Add `core.mind.tick_cron` to `config/default.json` and the `core` Zod schema as `mind: z.object({ tick_cron: cron })`; use `"30 * * * *"` only after checking the existing worker crons, otherwise record the verified minute in DECISIONS and use that exact value.

- [ ] **Step 5: Wire eval loop.** In `evals/lib/life-loop.ts`, import `coreMindTick` and call it immediately after `coreStateTick` in `runAt`. Extend injection typing in `evals/lib/script.ts` with `fallthrough?: boolean`; pass it through to `coreWorldTick`. Extend `evals/lib/core-check.ts` to expose `outcome`, `plan_ref`, and loop trace rows for assertions.

- [ ] **Step 6: Run checks.** `pnpm typecheck`; expected `Found 0 errors`. `pnpm lint`; expected exit 0. `pnpm vitest run tests/worker/jobs.test.ts tests/evals/profile.test.ts tests/evals/core-check.test.ts`; expected all PASS.

### Task 6: Fakes, canary, spec and decisions paperwork

**Files:** `src/mind/platform/llm/fake.ts`, `tests/helpers/llm.ts`, `tests/exit/mind-split.test.ts`, `spica-design-spec-v3.md`, `DECISIONS.md`; tests above plus full suite.

- [ ] **Step 1: Add fake purposes and invalid switch.** Extend `FakeLLMProvider.handlers` with `core_resolve`, `core_anticipate`, `core_ruminate`, `core_wander` returning schema-valid values. Add `invalidPurposes = new Set<string>()` and before parsing in `classifyJson` return `{ invalid: true } as T` when the purpose is enabled, so Zod raises. Preserve existing `sequence` behavior.

- [ ] **Step 2: Extend CapturingLLM canary echo.** In `tests/helpers/llm.ts`, before `return super.classifyJson(request)`, add purpose branches that parse the handler output and append the canary to every text field: resolution `content`; anticipate `thought` and `emotion.label`; ruminate `thought`; wander each `items[].content`. Parse through `request.schema` so malformed output fails exactly like production.

- [ ] **Step 3: Extend exit canary.** Add the four purposes to `CORE_PURPOSES` in `tests/exit/mind-split.test.ts`; ensure the scenario's day plan has a downtime block and an open intention/episode so at least one optional loop is due. After `coreMindTick`, scan `core_memory`, `core_state`, `world_event`, `core_goal`, and `core_loop_trace` JSON for `CANARY`; assert none contain it and assert `llm.seen` contains each core purpose prompt. Keep the existing user-A/user-B side-channel equality assertion.

- [ ] **Step 4: Update design and decisions.** Add exact v3 text for world-event `resolves_memory_id` and nullable `fallthrough`, narrowed TS outcome, goal-driven events, resolution ordering/fallback, B51 landing closure, loop files/statuses, config keys, prompts, queue/cron, and Phase 8 progress. Add one-line DECISIONS rows: (1) DB `outcome` remains text while domain type is narrowed; (2) resolution roll seed is `${eventId}:fallthrough`; (3) goal weighted-pick seed is `${day}:goal-pick`; (4) core mind cron minute is the verified minute after both existing core crons; (5) optional invalid output is traced `failed` and writes nothing.

- [ ] **Step 5: Run final verification.** `pnpm typecheck` (0 errors), `pnpm lint` (exit 0), `pnpm test` (all tests pass), and `pnpm eval --llm=fake --compare` (all scenarios pass, including leak canary). Do not alter baselines; if an expected count changes, document the exact assertion and reason in the plan.


# Superseded for the restart

Use `2026-10-03-phase-8b-restart.md` and its approved spec. This document remains historical.

