# Phase 8c Core Nightly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a core-only nightly sequence that reflects on her day, consolidates memory, renders a new self snapshot, and logs drift.

**Architecture:** Add core repository contracts and one migration, then plain loop functions using the existing metered `runCoreLoop` and atomic `ctx.commit`. An hourly pg-boss job claims one local night under the core state lock and invokes the four loops independently. Model and embedding calls happen outside write transactions.

**Tech Stack:** Existing TypeScript ~6.0, Zod, Drizzle, PostgreSQL 16/pgvector, Vitest, pg-boss, pnpm. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-phase-8c-core-nightly-design.md`, grounded in the approved parent design and `spica-design-spec-v3.md`.

## Global Constraints

- Read `CLAUDE.md`, v3, `DECISIONS.md`, this plan and the design before coding. Do not edit Claude instruction files.
- Implement only 8c. B53, reply/extract changes, claim grounding, inspector expansion, full fourteen-day exit and canary extension belong to 8d.
- Core loops take `CoreDeps`; core repositories have no `user_id`, user imports, raw DB handle or user data.
- Use the injected clock, her local date/time, versioned prompts, config for numeric constants, and `apply_patch` for edits.
- Existing runner meters attempted model calls, traces every run, and atomically commits effects with its success trace. Do not call models or the embedder inside write transactions.
- Nightly order is reflect → consolidate → render → drift. A failed step is logged and does not stop the next. Claim `last_nightly_day` at the start under the core state lock; a crashed night is not retried.
- When the budget is exhausted, the nightly model loops trace `skipped_budget`; code-only decay and drift maths run before their runner calls. A snapshot does not advance without a successful render.
- No new behavior for v3 OPEN drift response: record findings, never block a snapshot.
- Finish with `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd test`, the 8c exit, leak canary and side-channel assertion. Update v3 for every field, job, config key and prompt.

## Review Focus

1. A slow nightly run crossing local midnight must claim the intended local date once; test the scheduler with a clock change during a run (Task 6).
2. A failed render must leave the previous snapshot and its self lines usable; test atomicity of version and lines (Task 4).
3. A malformed or stale model target must never supersede unrelated core memory or goals; test invalid IDs and concurrent status changes (Task 2).
4. A gist retry must not double-dampen its source episodes; test transaction rollback and an already-gisted group (Task 3).
5. Drift judge failure must not erase the new snapshot or manufacture an `ok` verdict; test the failed trace and retained code-only diff/trend (Task 5).

---

### Task 1: Core nightly storage contracts

**Files:** Modify `src/db/schema.ts`, `src/mind/memory/core/types.ts`, `src/mind/state/core/types.ts`, `src/mind/platform/core.ts`, `src/db/repos/core/{memory,state,index}.ts`; create the next migration and metadata under `src/db/migrations/`; test `tests/db/core-repos.test.ts` and `tests/db/schema.test.ts`.

**Interfaces:** Extend `CoreStateRow`/`CoreStatePatch` with `last_nightly_day: string | null`. `CoreSnapshot.embedding` is `number[] | null` on reads; `insertSnapshot` requires a nonnull vector. Add `CoreTraces.latestDone(loop: string, before: Date): Promise<Date | null>` (includes zero-call `done`, excludes fallback/failed/skipped). Add core-only repository operations for bounded recent reflect inputs, nearest active opinions/interests, latest narrative, eligible gist groups, atomic decay and gist source updates, superseding memory, snapshot history, and versioned self-line writes. Add `CoreDrift` to `CoreScope` for drift rows. Keep all write operations usable through `ctx.commit`'s `CoreScope`.

- [ ] Write DB tests for new columns and tables, local-week gist eligibility, inclusive stale threshold and exemptions (only direct world-event `goal_ref` episodes qualify), `latestDone` including zero-call success, deterministic ordering/limits, FK behavior, and core-only boundary. Make each fail for its missing contract.
- [ ] Run `pnpm.cmd exec vitest run tests/db/core-repos.test.ts tests/db/schema.test.ts`; expect the new tests to fail for missing storage/API.
- [ ] Add `core_state.last_nightly_day`, nullable `core_snapshot.embedding` (1024 dimensions for existing rows awaiting seed backfill), `core_self_line` (`id`, nullable `version`, `text`, 1024-dimension `embedding`) and `drift_log` (`id`, `version`, `check`, nullable `value`, `excerpt`, `verdict`, `score`, `created_at`). Backfill v0's embedding and lines through the idempotent seed path in Task 4, not a generated embedding in SQL. Make new writes transaction-scoped and preserve old snapshot reads during migration. `value`, `excerpt`, `verdict` and `score` are all nullable.
- [ ] Implement the repository methods needed by Tasks 2–5. Use the user decay formula `salience * (1 - rate * (1 - salience))`; exempt open intentions, preoccupation, latest narrative and memories linked to active goals. Mark stale at or below the configured floor. Never delete sources after gist.
- [ ] Run the focused tests and `pnpm.cmd typecheck`; inspect generated migration and metadata. Commit the storage change.

### Task 2: Reflection and goal changes

**Files:** Create `src/mind/process/core/reflect.ts`, `prompts/core/reflect/v1.md`, `tests/mind/process/core/reflect.test.ts`; modify config schema/defaults, prompt registry and fake LLM.

**Consumes:** Task 1 recent memory, supersede and goal repository contracts; `runCoreLoop`, `CoreDeps` and `ctx.commit`.
**Produces:** `coreReflect(deps: CoreDeps, now: Date): Promise<LoopStatus>` and trace outputs naming accepted memory and goal IDs.

- [ ] Write tests for zero new inputs (done, zero calls), input/context limits and multi-night overflow with equal-time ID ties, insight/opinion/interest/narrative output bounds, valid superseding and fading, unknown or stale targets ignored, `max_active` goal additions, drops, invalid output and model failure. Verify a concurrent target status change cannot redirect a supersede.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/process/core/reflect.test.ts`; expect missing-loop failures.
- [ ] Add `core.reflect` config (`max_inputs: 30`, `context_items: 6`, `max_insights: 2`, `max_opinions: 3`, `max_interests: 2`, `confidence: {low: 0.4, medium: 0.7, high: 0.9}`, `fade_factor: 0.5`, `max_tokens: 1024`) and `prompts.core_reflect: v1`; record the test-phase defaults in one dated `DECISIONS.md` line.
- [ ] Read episodes/thoughts/ideas after `traces.latestDone("core_reflect", now)`'s last-consumed `(created_at, id)` cursor, relevant active opinions/interests, goals, snapshot and fixed values. A successful capped run traces the last consumed input as its cursor; a zero-input success traces `(now, null)`; failures do not advance it. Validate the model response; embed proposed memories/goals outside the transaction. Within `ctx.commit`, recheck target status and active-goal count, write accepted changes and the trace atomically. Use model content only for memory and goal proposals; code owns statuses, confidence and limits. Use the spec's salience and source defaults.
- [ ] Run focused tests and `pnpm.cmd typecheck`; commit reflection, prompt, config and fake.

### Task 3: Core decay and gist

**Files:** Create `src/mind/process/core/consolidate.ts`, `prompts/core/consolidate/v1.md`, `tests/mind/process/core/consolidate.test.ts`; modify config/defaults, prompt registry and fake LLM.

**Consumes:** Task 1 decay and eligible group operations; runner and `ctx.commit`.
**Produces:** `coreConsolidate(deps: CoreDeps, now: Date): Promise<LoopStatus>`.

- [ ] Write tests for nightly decay and each exemption; no eligible group (zero model calls); exhausted budget still decays and traces `skipped_budget`; minimum group of 3 resolved episodes older than 7 days within one local week; one group per night; gist time/salience/payload; source damping exactly once; invalid model output, rollback and already-gisted retry.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/process/core/consolidate.test.ts`; expect missing-loop failures.
- [ ] Add `core.decay` (`grace_days: 3`, `rate: 0.08`, `stale_floor: 0.05`) and `core.consolidate` config (`gist_after_days: 7`, `min_group: 3`, `max_groups: 1`, `gist_source_factor: 0.5`, `max_tokens: 512`) and `prompts.core_consolidate: v1`. Record the test-phase defaults in `DECISIONS.md`.
- [ ] Apply decay before entering `runCoreLoop`; the coordinator's date claim prevents another run that night, even when the runner skips its callback for lack of budget. If no group is due and budget remains, finish with a zero-call `done` trace. When a group is due and budget permits, call Haiku once, embed the gist outside the transaction, then atomically recheck group eligibility, insert the gist, mark/dampen sources and trace. If the model response is invalid, keep decay with a `fallback` trace and no gist. An unexpected failure is traced `failed`; the nightly coordinator continues and completed decay remains.
- [ ] Run focused tests and `pnpm.cmd typecheck`; commit consolidation, prompt, config and fake.

### Task 4: Render snapshot and self lines

**Files:** Create `src/mind/process/core/render-snapshot.ts`, `prompts/core/snapshot/v1.md`, `tests/mind/process/core/render-snapshot.test.ts`; modify `src/mind/memory/core/seed.ts`, config/defaults, prompt registry and fake LLM.

**Consumes:** Task 1 snapshot and self-line repository contracts; runner and `ctx.commit`.
**Produces:** `coreRenderSnapshot(deps: CoreDeps, now: Date): Promise<LoopStatus>`; one new version and its lines only after successful rendering.

- [ ] Write tests for the six required sections, carried speech habits, bounded active sources, no transient mood/energy, N+1 version, embedding and per-bullet lines, idempotent v0 seed, concurrent version race, invalid output, and failed render preserving the old snapshot and lines.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/process/core/render-snapshot.test.ts`; expect missing-loop failures.
- [ ] Add `core.snapshot.max_items: 8` and `max_tokens: 1024`, `prompts.core_snapshot: v1`; record defaults in `DECISIONS.md`. Pass fixed values, latest snapshot/narrative, top opinions/interests, goals, recent insights and core people to Haiku. Build `content` from the six `### ` sections and embed it and its bullet lines before `ctx.commit`.
- [ ] Insert version and lines in the same transaction, checking that the previous version is still current. Record source IDs, model and prompt version. Extend seed to embed v0 and write fixed core-value lines plus v0 lines once, without replacing an existing snapshot.
- [ ] Run focused tests and `pnpm.cmd typecheck`; commit rendering, seed, prompt, config and fake.

### Task 5: Drift watch

**Files:** Create `src/mind/process/core/drift-watch.ts`, `prompts/core/drift/v1.md`, `tests/mind/process/core/drift-watch.test.ts`; modify config/defaults, prompt registry and fake LLM.

**Consumes:** Task 1 drift rows and snapshot history; Task 4 snapshot embedding.
**Produces:** `coreDriftWatch(deps: CoreDeps, now: Date, version: number): Promise<LoopStatus>`.

- [ ] Write tests for one `ok` row or per-finding `contradicts`/`strains` rows, cosine diff to previous and trend to v0, changed-section share, null historical embedding, code-only rows when render spent the last budgeted call, no block on a finding, no run without a new version, invalid judge output and judge failure retaining the new snapshot without a fabricated verdict.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/process/core/drift-watch.test.ts`; expect missing-loop failures.
- [ ] Add `prompts.core_drift: v1` and `core.drift.max_tokens: 512`; record the default in `DECISIONS.md`. Use an existing vector/cosine helper if present. Persist code-only diff/trend before entering `runCoreLoop`, including when the runner skips its callback for lack of budget. A null historical embedding produces no distance row. Write successful values results with the loop's success trace. Judge failures follow the runner's failed-trace path and leave code-only rows intact. Never reject or roll back a rendered snapshot because of drift.
- [ ] Run focused tests and `pnpm.cmd typecheck`; commit drift watch, prompt, config and fake.

### Task 6: Nightly coordinator and job

**Files:** Create `src/mind/process/core/nightly.ts`, `tests/mind/process/core/nightly.test.ts`; modify `src/worker/core-jobs.ts`, `src/worker/index.ts`, `src/mind/platform/jobs.ts`, config/defaults and relevant worker tests.

**Consumes:** Tasks 2–5 loop functions and Task 1 `last_nightly_day`.
**Produces:** `coreNightly(deps: CoreDeps, now: Date)`; hourly `core_nightly` job.

- [ ] Write tests for before/after local hour 3, one claim per local date across concurrent invocations, clock change during a run, step order, independent failure, no same-night retry after crash, and next-night eligibility.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/process/core/nightly.test.ts tests/worker/jobs.test.ts`; expect missing-coordinator failures.
- [ ] Add `core.nightly.local_hour: 3` and hourly `tick_cron`, queue constant and worker registration. Under the core state row lock, claim the date before any loop begins; release the transaction, then call each loop in order with individual error logging. Drift runs only when render produced a new version. Use the passed `now` throughout the claimed run.
- [ ] Run focused tests and `pnpm.cmd typecheck`; commit coordinator, job and config.

### Task 7: Slice exit and documentation

**Files:** Create `tests/exit/phase-8c.test.ts`; modify `spica-design-spec-v3.md` and any 8c test fixtures needed for deterministic fake outputs. Do not edit `CLAUDE.md`.

- [ ] Write a deterministic fake 8c exit: two local nights produce two additional snapshots and their self lines; each successful version has values/diff/trend drift rows; a qualifying resolved group yields one gist; decay respects exemptions; trace calls stay within the 24-call daily budget. Assert core-only data and user A/B separation with the existing leak canary and side-channel test.
- [ ] Run `pnpm.cmd exec vitest run tests/exit/phase-8c.test.ts tests/exit/mind-split.test.ts`; expect a deterministic pass if Tasks 1–6 are complete; otherwise use the failing assertion to locate the missing integration.
- [ ] Complete only the necessary fixture or runtime wiring; update v3 §§6.2, 7.3, 8.5, 15, 17 and 20 with built 8c fields, jobs, config and prompts. Record any uncovered low-impact choices in `DECISIONS.md`.
- [ ] Run `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd test`, and the focused 8c exit/canary. Read all output, resolve failures, review the whole diff for scope and leakage, then commit documentation and exit evidence.

## Handoff

This plan implements only the approved 8c slice. Review the task interfaces and the noted test-phase defaults before implementation. The existing 8b branch is clean at `97c712c`; execution should use an isolated branch/worktree and preserve this checkout.
