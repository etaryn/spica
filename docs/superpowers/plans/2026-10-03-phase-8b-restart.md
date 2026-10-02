# Phase 8b Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (selected by Ethan) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Spica goal-driven events, retry-safe plan outcomes and bounded, core-only hourly thinking.

**Architecture:** Extend committed Phase 8a repositories and runner. Prepare model proposals outside transactions, recheck under the shared world lock, and apply atomically. Plain thinking functions run behind one coordinator; each task has an independent review gate.

**Tech Stack:** Existing TypeScript ~6.0, Zod, Drizzle, PostgreSQL 16/pgvector, Vitest, pg-boss and pnpm. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-phase-8b-world-and-thinking-design.md` (approved).

**Status:** Approved by Ethan on 2026-10-03. Task 1 setup in progress.

## Global Constraints

- Read CLAUDE.md first, then v3 and DECISIONS. Never edit Claude files.
- Baseline is `ae87bd06860af93d693a049980d71fdb1e4857e0`, not the dirty checkout.
- Preserve the existing checkout. Use an isolated worktree and new disposable databases.
- CoreDeps only; no user inputs, raw database or user imports in core loops.
- Model and embedding calls occur outside write transactions.
- The runner meters attempts, including failed requests, and retains its trace-and-rethrow contract.
- Budget remains the approved summed-trace read, not a global lock around model calls.
- Run anticipate, ruminate and wander in that order.
- Drop an item when its closest eligible dedupe neighbour has similarity **greater than** 0.92.
- Queue retries are zero; next-hour eligibility checks provide retry behavior.
- No nightly, claim-line, inspector or user-loop implementation.
- Use injected time, existing numeric bounds, versioned prompts, plain-English file headers and config for tuning constants.
- If baseline, spec or plan disagree, stop and report the exact conflict. Do not reinterpret it in a task.

## Review Focus

1. Corrupt legacy JSON payloads must not abort selection or fabricate historical emotion (Tasks 2, 7).
2. A slow model may return after its source lands; anticipation must lose eligibility without writes (Task 6).
3. A transaction/trace insertion failure must not leave uncounted successful thinking effects (Task 3).
4. Midnight resets daily caps, but must not reset the cross-day wander gap (Task 8).
5. A deleted B51 target or concurrent world tick must not clear unrelated preoccupation or duplicate outcomes (Task 5).

## Task map and ownership

Execute tasks serially, with a fresh implementer and independent spec/code-quality review per task.
Do not run simultaneous writers to config, repositories or the test database. Reviewers are read-only.
Task briefs include this plan, the spec, baseline and current commit, exact owned files, predecessor
interfaces and required commands. The driver maintains `docs/superpowers/phase-8b-restart-ledger.md`
with task commit, test evidence, review findings and resolutions. No nested subagent dispatch.

| Task | Deliverable | Main boundary |
|---|---|---|
| 1 | Isolated execution and green baseline | Driver setup |
| 2 | World/memory/trace repository contracts | Database and core interfaces |
| 3 | Atomic thinking completion and shared thought storage | Runner and thought helper |
| 4 | Goal event v4 | Event generation |
| 5 | Resolution and B51 | World landing |
| 6 | Anticipation | One thinking function |
| 7 | Rumination | One thinking function |
| 8 | Wandering | One thinking function |
| 9 | Coordinator, jobs and eval plumbing | Runtime integration |
| 10 | Isolation exit and handoff | Cross-cutting verification/docs |

Common task cycle: write the named failing tests, run the specified focused command and inspect
the failure, implement only that task, rerun focused tests and `pnpm.cmd typecheck`, then commit
only owned files. Resolve both review gates before handing the next task its interfaces.
Test snippets below pin assertions; build fixtures using existing test helpers, not invented APIs.

### Task 1: Preserve the attempt and establish restart execution

**Files:** create the ledger above; no product-file changes.
**Interfaces:** produces an isolated checkout with baseline plus approved spec/plan and applicable
AGENTS.md instructions; local `TEST_DATABASE_URL` and `EVAL_DATABASE_URL` for that checkout.

- [ ] Use using-git-worktrees. Inspect git status/worktrees; create branch `phase-8b-restart` from
  `ae87bd0` in an approved isolated location. Do not reset, stash, delete or copy dirty source files.
- [ ] Carry the approved spec/plan and current AGENTS.md instructions explicitly; record their origin.
  The old plan stays historical and is marked superseded in this worktree, not followed.
- [ ] Check Docker and the known compose service. If needed start Docker Desktop hidden and run
  `pnpm.cmd db:up`; do not infer a crash cause from a stopped service.
- [ ] Create new local databases `spica_8b_restart_test` and `spica_8b_restart_eval` using the existing
  local PostgreSQL service. Inspect existence first; reuse only if their ownership and migration
  history match this restart. Never truncate the current `spica`, `spica_test` or `spica_eval`.
- [ ] Set process environment URLs to those new databases. Install locked dependencies with
  `pnpm.cmd install --frozen-lockfile` if needed. Run baseline `pnpm.cmd typecheck`, `pnpm.cmd test`
  and `pnpm.cmd eval --llm=fake --compare` serially. Record existing failures and stop on blockers.
- [ ] Commit only carried docs/instructions and the initialized ledger. Review setup before Task 2.

### Task 2: Repository contracts and migration

**Files:** modify `src/db/schema.ts`, `src/mind/platform/core.ts`,
`src/mind/memory/core/types.ts`, `src/mind/world/types.ts`,
`src/db/repos/core/{memory,traces,world}.ts`; create migration `0019_world_resolution.sql`
and its generated metadata; tests `tests/db/core-repos.test.ts`.

**Interfaces produced:**

```ts
// World: existing NewWorldEvent gains optional nullable versions; row requires all fields.
plan_ref: string | null;
goal_ref: string | null;
outcome: "happened" | "fell_through" | null;
fallthrough: boolean | null;
resolves_memory_id: string | null;
// New World methods:
getEvent(id: string): Promise<WorldEventRow | null>;
setOutcome(id: string, outcome: "happened" | "fell_through"): Promise<void>;
// CoreMemoryItem gains entity_refs: string[]. New memory methods:
anticipationCandidate(now: Date, until: Date): Promise<CoreMemoryItem | null>;
ruminationCandidate(from: Date, to: Date, minValence: number, maxCount: number): Promise<CoreMemoryItem | null>;
recallable(from: Date, to: Date, limit: number): Promise<CoreMemoryItem[]>;
mergePayload(id: string, patch: Record<string, unknown>): Promise<void>;
reinforce(id: string, now: Date, bump: number, cap: number): Promise<void>;
dedupeNear(embedding: number[], k: number, minSimilarity: number): Promise<Neighbor[]>;
// CoreTraces:
appliedSummary(loop: string, from: Date, to: Date): Promise<{ count: number; latest: Date | null }>;
```

- [ ] Add tests `resolution metadata round trips and target deletion nulls FK`,
  `candidate filters precede limit`, `malformed payload is ineligible`, `recall keeps history but
  excludes unreal and resolved intentions`, `dedupe can see hypotheticals`, `payload merges preserve
  other keys`, `reinforcement caps`, `appliedSummary excludes failed and race-loser traces`.
  Pin `expect(reinforced.salience).toBe(0.95)` for bump 0.03 from 0.94; check recall count/time.
- [ ] Run `pnpm.cmd exec vitest run tests/db/core-repos.test.ts`; expect new contract failures.
- [ ] Implement contracts. Select anticipation by valid future `event_at`, no marker, then timestamp/ID;
  rumination by inclusive created_at interval, absolute valence threshold, valid nonnegative count
  (missing zero), oldest/ID. Safely reject malformed payload types without unsafe SQL casts.
  Recallable is inclusive [from,to], newest/ID. `near` excludes hypothetical but retains resolved
  intention history for reconciliation; `dedupeNear` excludes stale/superseded only. Stable sim/ID ties.
  `appliedSummary` counts done traces with outputs.applied true in [from,to); latest is maximum timestamp
  in that interval. Call it separately over all history for cross-day gap checks.
- [ ] Generate only the two new columns from migration 0018. Reuse existing outcome/plan/goal fields;
  no no-op helper migration. Apply new DB tests and typecheck; inspect generated SQL/snapshot/journal.
- [ ] Commit owned files as `feat: add core thinking and resolution repository contracts`.

### Task 3: Atomic runner completion and shared thought storage

**Files:** modify `src/mind/process/core/runner.ts`, `src/mind/platform/config.ts`,
`config/default.json`; create `src/mind/process/core/thoughts.ts`,
`tests/mind/process/core/thoughts.test.ts`; modify `tests/mind/process/core/runner.test.ts`.
**Consumes:** Task 2 repositories and existing `LoopResult<T>`, `CoreScope`.
**Produces:** `LoopContext.commit<T>(apply: (tx: CoreScope) => Promise<LoopResult<T>>): Promise<LoopResult<T>>`;
`ThoughtInput = {kind: "thought" | "idea" | "hypothetical"; content: string; salience: "low" | "medium"}`;
`PreparedThought = {item: ThoughtInput; embedding: number[]}`;
`prepareThoughts(deps: CoreDeps, items: ThoughtInput[]): Promise<PreparedThought[]>`;
`storeThoughts(tx: CoreScope, deps: Pick<CoreDeps,"config">, items: PreparedThought[], meta:
{loop: CoreLoopName; traceId: string; now: Date; valence: number; payload: Record<string,unknown>;
entityRefs: string[]}): Promise<{ids: string[]; dropped: string[]}>`.

- [ ] Add tests `commit and trace succeed together`, `trace insert failure rolls writes back`,
  `callback failure still rethrows and traces once`, `legacy runner path unchanged`,
  `duplicate completion rejected`, `0.92 survives but greater similarity drops`, `batch duplicates drop`,
  `invalid content or embedding writes nothing`. Pin one trace per successful run and no stored thought
  after a rejected commit. Keep existing reserve/metering tests.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/process/core/runner.test.ts tests/mind/process/core/thoughts.test.ts`.
- [ ] Implement `commit`: open core transaction, call apply, insert metered success trace within it,
  mark completion only after commit; outer runner must not insert a second success trace. It must
  reject a second commit before running its callback. On rollback use the existing failed trace/rethrow
  path. Callers return commit's result immediately and do no further work. No models inside apply.
- [ ] Add `core.loops` config: `max_chars:300`, `max_tokens:512`, `salience:{low:0.25,medium:0.4}`,
  `thought_confidence:0.6`, `dedupe_similarity:0.92`. Validate trimmed nonempty content, finite correctly
  sized nonzero embeddings; reject the whole malformed proposal before transaction. Shared storage
  rechecks dedupe including earlier inserts, uses status recurring, occurred_at/created_at now,
  source loop and `<loop>:<traceId>`. Caller owns side effects only for accepted IDs.
- [ ] Run focused tests and typecheck; commit as `feat: commit core thoughts and completion traces atomically`.

### Task 4: Goal-driven event generation

**Files:** modify `src/mind/world/events.ts`, `src/mind/process/core/world-tick.ts`,
`src/mind/platform/config.ts`, `config/default.json`, `src/mind/platform/llm/fake.ts`,
`tests/mind/world/events.test.ts`, `tests/mind/process/core/world-tick.test.ts`;
create `prompts/life/event/v4.md`, remove unreferenced v3.
**Produces:** AcceptedEvent gains `goalRef: string|null`, `resolvesMemoryId: string|null`,
`fallthrough: boolean|null`; InjectedEvent gains optional boolean `fallthrough`.
`selectEventGoal(goals: CoreGoal[], day: string, cfg: Config["core"]["world"]): CoreGoal|null`.
Replace the generator signature with `generateCoreEvents(deps:CoreDeps, day:string, now:Date,
canCall:()=>boolean, inject?:(day:string)=>InjectedEvent|null):Promise<{accepted:AcceptedEvent[];
attempts:EventAttempt[]; budgetExhausted:boolean}>`; update callers and tests in this task.

- [ ] Test `goal selection is seeded and independent of repository order`, `no active goal is ordinary`,
  `injected events have no implicit goal`, `resolves target survives acceptance`, `surprise does not
  create memory entity or state before landing`. Assert selected ID is code-assigned, not model-provided.
  Add `remaining single call cannot fund generation plus reconciliation`: assert only one request,
  no unchecked candidate accepted when neighbours require reconciliation, and day marked done.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/world/events.test.ts tests/mind/process/core/world-tick.test.ts`.
- [ ] Add world keys `goal_driven_share:0.5`, `goal_weight_floor:0.1`; use approved seeded weighting.
  Extend event context with selected goal and needs; retain core values/snapshot and life role.
  Persist accepted metadata directly in recordEvent, including false overrides; do not lose B51 target
  when mapping attempts. Preserve existing appraisal-before-generation order and fallback gates.
- [ ] Close the identified baseline budget gap: pass ctx.canCall into generation, check before each
  generation/regeneration and before reconciliation when neighbours are nonempty. On exhaustion stop,
  retain previously accepted events only, report budgetExhausted true and trace life_event fallback.
  Do not accept a candidate whose required reconciliation could not run. Empty neighbours need no call.
  This implements the approved spec's per-attempt budget rule; it is not present in baseline code.
- [ ] Switch configured event prompt to v4, update deterministic fake, search for old prompt uses before
  deletion. Run focused tests/typecheck; commit as `feat: connect world events to active core goals`.

### Task 5: Same-tick resolution and B51 landing

**Files:** create `src/mind/process/core/resolve.ts`, `prompts/core/resolve/v1.md`,
`tests/mind/process/core/resolution.test.ts`; modify world-tick/appraise, config/default,
platform/config, platform/llm/fake and existing appraisal tests.
**Produces:** `ResolutionProposal = {content:string; valence:number; stakes:"low"|"high"}`;
`proposeResolution(ctx: LoopContext, event: WorldEventRow): Promise<ResolutionProposal|null>`.
Null means original happens. `LandingEvent` gains optional `intentionEventId: string` and
`resolvesMemoryId: string|null`; appraisal looks up intention by intentionEventId when supplied.

- [ ] Test happened, forced true/false, deterministic roll, invalid/model-error/no-budget fallback,
  same-tick replacement, rollback/retry, overlapping ticks, deleted target and preoccupation precedence.
  For true fallthrough assert `replacement.appraised_at !== null`, original outcome fell_through,
  original episode absent and original intention resolved. A second run creates no second episode.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/process/core/resolution.test.ts tests/mind/process/core/appraise.test.ts tests/mind/process/core/appraise-propose.test.ts`.
- [ ] Add `core.world.fallthrough_probability:0.15`, `core.resolve.max_tokens:512`, prompt key
  `core_resolve:"v1"`. Schema content/valence/stakes only; validate content with event_max_chars,
  finite valence clamped [-1,1]. Read core context outside the model-error catch; catch request/invalid
  response only. No DB failure becomes a fallback. Resolution proposal never writes a world event.
- [ ] Before entering the appraisal runner, sequentially resolve each due planned null-outcome event
  through its own core_resolve runner only when its roll is true. Then prepare appraisals sequentially
  through the existing appraisal runner, using replacement surface content and original expectation.
  In the shared `core_world_tick` transaction recheck original pending IDs, insert replacement and
  apply its appraisal immediately; set original fell_through/appraised. Ordinary planned events get
  happened. Preserve day/time/people/goal/target. Count a replaced plan as one landed outcome.
- [ ] Extend applyAppraisal to resolve only the valid target episode, clear matching old preoccupation
  before new-episode precedence, and save `payload.appraisal_emotion` from the bounded appraisal.
  Intention lookup uses original ID while episode source_ref uses actual replacement ID.
- [ ] Run focused tests plus world-tick and runner tests/typecheck; commit as `feat: resolve plans and close landed memory targets`.

### Task 6: Anticipation

**Files:** create `src/mind/process/core/anticipate.ts`, `prompts/core/anticipate/v1.md`,
`tests/mind/process/core/anticipate.test.ts`; modify config/default, platform/config and fake.
**Produces:** shared `ThinkingResult = {status: LoopStatus|"not_due"; applied:boolean; ids:string[]}`
in thoughts.ts; `coreAnticipate(deps:CoreDeps, now:Date):Promise<ThinkingResult>`.
**Consumes:** Tasks 2–3; get event through intention source_ref; ignore malformed/missing event links.

- [ ] Test future boundary at now (excluded), now+12h (included), already anticipated, same-time tie,
  missing event, invalid emotion, embedding failure, dedupe, reserve and `landing beats slow anticipation`.
  Assert `mood_arousal === before + 0.3*(proposed-before)`, unchanged mood_valence, one source marker
  and one thought; no state/marker writes on dedupe. Delay fake model, land source, release fake and
  assert `applied === false`.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/process/core/anticipate.test.ts`.
- [ ] Add `core.anticipate:{lead_hours:12,arousal_gain:0.3}`, prompt key `core_anticipate:"v1"`.
  Output `{thought:ThoughtInput, emotion:{label:string,valence:number,arousal:number,about:string}}`;
  require thought kind thought. Use appraisal label/about limits and numeric bounds. Bind emotion.about
  to source intention ID and phrase to bounded text. Read state under lock when applying arithmetic.
  Use runner commit/shared world lock; recheck candidate and store thought with anticipates/source
  entities/emotion valence; apply marker/emotion only when accepted. No eligible source returns not_due.
- [ ] Add deterministic purpose fake; run focused tests/typecheck; commit as `feat: anticipate upcoming core intentions`.

### Task 7: Rumination

**Files:** create `src/mind/process/core/ruminate.ts`, `prompts/core/ruminate/v1.md`,
`tests/mind/process/core/ruminate.test.ts`; modify config/default, platform/config and fake.
**Produces:** `coreRuminate(deps:CoreDeps, now:Date):Promise<ThinkingResult>`.

- [ ] Test inclusive age 2/24 hours using created_at, |valence| 0.5, missing/corrupt historical emotion,
  max count, resolved history, dedupe, concurrent runs, matching versus unrelated emotion.
  Assert reinforcement uses config.retrieval.recall_bump/cap, marker increments once,
  `mood_valence === clamp(before + 0.1*Math.sign(episode.valence), -1, 1)` and unrelated emotion survives.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/process/core/ruminate.test.ts`.
- [ ] Add `core.ruminate:{delay_hours:2,window_hours:24,min_valence:0.5,max_per_episode:1,gain:0.1}`
  and prompt key `core_ruminate:"v1"`. Output one ThoughtInput with kind thought. Read people by
  episode entity_refs and related goal through episode's world event. Missing emotion is explicitly
  absent context. Under shared lock recheck eligibility; accepted thought gets ruminates, source entities
  and episode valence; marker, recall reinforcement and state update use runner commit atomically.
- [ ] Add purpose fake; run focused tests/typecheck; commit as `feat: ruminate on strong landed episodes`.

### Task 8: Wandering

**Files:** create `src/mind/process/core/wander.ts`, `prompts/core/wander/v1.md`,
`tests/mind/process/core/wander.test.ts`; modify config/default, platform/config and fake.
**Produces:** `coreWander(deps:CoreDeps, now:Date):Promise<ThinkingResult>`.

- [ ] Test missing plan, quiet/busy/downtime boundaries, empty seed pool, zero-weight fallback,
  deterministic tie ordering, cap two/day, exactly-three-hour gap and midnight gap continuity,
  two concurrent invocations, all-deduped completion and hypothetical exclusion from factual recall.
  Assert at most one overlapping invocation has applied true, all-deduped valid run counts once,
  and deep core state is unchanged by wandering.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/process/core/wander.test.ts`.
- [ ] Add `core.wander:{max_per_day:2,min_gap_hours:3,seed_days:7,seed_limit:50,mood_bias:0.5,
  chain:3,min_similarity:0.3,max_items:2}` and prompt key `core_wander:"v1"`. Use blockAt/todaysBlocks,
  not raw plan kind checks. Use appliedSummary for today's count and all-history latest (epoch to now
  inclusive via an exclusive bound just beyond now); no new ledger table.
- [ ] Read real seed pool; use approved seed/weights, embed seed content as query and near neighbours,
  remove seed and resolved intentions before taking three (fetch enough to filter without starvation).
  Output `{items:ThoughtInput[]}` with one or two items, stored with seed valence and entity_refs,
  payload `{seed:seed.id,chain:neighborIds}`; hypothetical also has `unreal:true`. Validate whole batch.
  Recheck plan/cap/gap under shared lock in commit. Accepted invocation outputs applied true even if
  IDs are empty from dedupe; stale/race loser false. No source mutation or state updates.
- [ ] Add fake; run focused tests/typecheck; commit as `feat: wander through core memories during downtime`.

### Task 9: Coordinator, scheduler and eval integration

**Files:** create `src/mind/process/core/mind-tick.ts`, `src/worker/core-jobs.ts`,
`tests/mind/process/core/mind-tick.test.ts`; modify `src/mind/platform/jobs.ts`,
`src/worker/{index,jobs}.ts`, `tests/worker/jobs.test.ts`, config/default, platform/config,
`evals/lib/{life-loop,script,profile}.ts`; create `tests/evals/core-mind-order.test.ts`.
**Produces:** `coreMindTick(deps:CoreDeps, now:Date):Promise<Record<"anticipate"|"ruminate"|"wander",ThinkingResult>>`;
`CORE_MIND_TICK_QUEUE = "core_mind_tick"`;
`registerCoreMindJob(boss:PgBoss, deps:CoreDeps):Promise<void>`.

- [ ] Test order anticipate→ruminate→wander; throwing first/second loop still runs remaining loops;
  all not_due produces no trace; reserve prevents model calls. Coordinator catches errors as
  `{status:"failed",applied:false,ids:[]}` and logs class only; runner owns failed trace.
- [ ] Test queue create/update retryLimit 0, work handler, cron `50 * * * *`, injected false survives
  script parsing, and eval order world→state→mind→outreach. Use existing module mocking conventions.
- [ ] Run `pnpm.cmd exec vitest run tests/mind/process/core/mind-tick.test.ts tests/worker/jobs.test.ts tests/evals/core-mind-order.test.ts`.
- [ ] Add `core.mind.tick_cron`; register queue through ensureSystemQueues and schedule/work through
  registerCoreMindJob using scrubErrors/injected clock. Carry fallthrough in eval script and inject mapper;
  add new purposes to profile selection without introducing the 8d real-core exit. No nightly calls.
- [ ] Run focused tests/typecheck; commit as `feat: schedule and simulate hourly core thinking`.

### Task 10: Isolation exit, documentation and final review

**Files:** modify `tests/exit/mind-split.test.ts`, `tests/helpers/llm.ts`,
`spica-design-spec-v3.md`, `DECISIONS.md`, restart ledger; add
`tests/exit/phase-8b.test.ts`. Only if assertion plumbing is needed, modify `evals/lib/core-check.ts`
with an accompanying focused test; do not add future-phase metrics.
**Consumes:** all preceding tasks. No new product behavior in this task.

- [ ] Add non-vacuous canary fixtures exercising each new model purpose; CapturingLLM echoes planted
  tokens in the appropriate text field. Assert all four purposes were called and scan core memory,
  state, world, goals, entities, snapshots and trace inputs/outputs for the user token. Keep user-B scan.
- [ ] Add paired side-channel scenarios with the same fixed world IDs/seeds, one with user-A exchange
  and one without; compare semantic core state/results, normalizing incidental trace/memory IDs only.
  Add a deterministic short 8b scenario with planned anticipation, forced fallthrough, strong rumination,
  downtime wander and budget exhaustion. Pin one applied trace per source and same-tick resolution.
- [ ] Run `pnpm.cmd exec vitest run tests/exit/mind-split.test.ts tests/exit/phase-8b.test.ts`; investigate
  failures with systematic-debugging, not by weakening assertions or silently updating baselines.
- [ ] Update v3 with fields, repository-visible payloads, every config key/prompt/job above, B51 done
  and 8b built only after verification. Record uncovered choices: atomic thinking completion,
  dedupe side-effect behavior, safe malformed-payload handling, shared 512-token thought cap and
  resolution cap, source-derived thought valence, and deterministic candidate tie ordering.
- [ ] Format only owned files with `pnpm.cmd exec prettier --write <explicit-owned-paths>`.
  Run serially `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd test`,
  `pnpm.cmd eval --llm=fake --compare`. Require successful exits; report regressions without replacing
  baseline expectations. Verify git diff contains no Claude-file changes or unrelated source edits.
- [ ] Commit verified owned files as `test: verify phase 8b isolation and document restart`.
  Dispatch whole-branch review against baseline; fix and reverify findings through the owning task.
  Use finishing-a-development-branch only after all checks/reviews pass. Offer integration options;
  do not overwrite the original dirty checkout, push or claim full Phase 8 completion.

## Plan review and execution handoff

Coverage: spec §§1–3 → Tasks 1–3; §4 → Task 4; §5 → Task 5; §6 → Tasks 2–3;
§7 → Tasks 6–8; §8 → Tasks 9–10; §9 → all test cycles plus Task 10.

The selected execution method remains task subagents. Ethan reviews this written plan before
Task 1 begins. Reviewer corrections that change approved behavior return to Ethan; corrections
to implementation that restore this plan are handled in the task's review loop.
