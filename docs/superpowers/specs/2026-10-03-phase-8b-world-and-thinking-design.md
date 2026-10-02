# Phase 8b: World and hourly thinking — restart design

Date: 2026-10-03. Status: **Approved by Ethan's “continue” on 2026-10-03 after written-spec review was requested.**

## 1. Intent and authority

Give Spica goal-connected events, outcomes that can differ from her plans, and bounded
anticipation, rumination and wandering. Her life remains core-only, independent of any user's
conversation, and runs inside the existing call budget.

Ethan requested a fresh spec, then a fresh implementation plan, then task subagents using
Superpowers. He approved retaining the existing 8b scope. Scope approval is not approval of
this written spec or of an implementation plan.

Authority: `spica-design-spec-v3.md`, `CLAUDE.md`, `DECISIONS.md`, and the retained 8b portions of
`2026-10-02-phase-8-core-loops-design.md`. v3 wins. This draft supersedes neither v3 nor approved
decisions. Once approved, it replaces the old 8b plan's design assumptions for the restart;
a new plan must be written before implementation. Any remaining disagreement is reported,
not silently repaired during implementation.

Baseline: commit `ae87bd06860af93d693a049980d71fdb1e4857e0`, containing committed Phase 8a
implementation and the old 8b plan. Uncommitted 8b work is reference material, not the restart
baseline. Preserve it in the current checkout. Execute the new plan in an isolated worktree
from the committed baseline, carrying only approved restart documentation and project
instructions. Do not reset the current checkout or edit Claude files.

## 2. Scope and approach

Included: goal-driven event generation, plan resolution, B51 target-memory resolution,
`core_mind_tick` (anticipate → ruminate → wander), prompts, configuration, migrations,
deterministic fakes, scheduler/eval integration, budget/retry/concurrency/isolation coverage,
and corresponding v3 documentation.

Excluded: nightly reflection/consolidation/snapshots/drift (8c); recall bias, reply/extraction
claim rules, inspector expansion and full fourteen-day Phase 8 exits (8d); user loops,
real-content activities, other agents' arcs and calendar features.

Recommended approach: extend the committed core-only repositories and runner with the minimum
operations needed by these loops. Keep each loop a plain function behind one coordinator.
This preserves established scope boundaries and permits focused task ownership.

Alternatives considered: resume the dirty implementation (less initial work, but not the
requested fresh start); replace the runner and add separate loop jobs (larger migration and
unnecessary scope). Neither is selected.

## 3. Invariants and execution boundaries

- Core functions receive `CoreDeps`, never raw database access, a user ID or user repositories.
- Only appraisal creates an episode from a world event. Hypothetical memory is never factual
  retrieval or event-reconciliation evidence.
- Model and embedding calls occur outside write transactions. Code validates model output,
  clamps numbers and owns IDs, timestamps and state changes.
- Prepare proposals first; under the existing shared core/world lock, reread affected rows and
  apply only still-eligible work. World landing remains one atomic transaction per due batch.
- An already applied event, intention or episode cannot be applied twice by retry or overlap.
  A concurrency loser may have spent a model call; its trace records that no writes applied.
- Budget remains the approved summed-trace read, not a global lock around model calls. The
  previously accepted rare concurrent overshoot remains possible; no strict global reservation
  system is introduced. Calls within a run are sequential and checked before each attempt.
- The runner meters attempts, including failed requests, and retains its trace-and-rethrow
  contract. The coordinator catches individual loop failures and continues later loops.
- No model output is written partially. Invalid output or embedding failure leaves thought,
  source markers and state unchanged. Failed runs remain observable by error class only.

## 4. Goal-driven events

Retain the daily generation gate and all event rules/reconciliation. Prompt `life/event/v4`
adds current needs and the code-selected active goal to existing core context. It retains the
`life` model role; new thinking/resolution prompts use `core`.

The local-day seeded goal roll uses `${day}:goal`, with share 0.5. When selected, choose among
active goals with weight `1 - progress + 0.1`, using `${day}:goal-pick` and a stable ID ordering.
No active goals means ordinary generation. The model writes event content; code assigns
`goal_ref`. It cannot invent a goal ID. Injected events do not implicitly acquire a goal.

Planned events create intentions immediately; surprises create no memory, entity or state
changes until landing. Goal context does not weaken this boundary. Generation still follows
due-event landing: a newly generated already-due event lands on the next tick.

## 5. Resolution and B51

For a due, unappraised planned event with no outcome, honor nullable `fallthrough` when set;
otherwise roll `${event.id}:fallthrough` against probability 0.15. False records `happened`
and follows ordinary appraisal. Surprises and resolution events do not roll.

A true roll runs `core_resolve` with original event, intention, core values and snapshot.
Validated output describes what happened instead. Code supplies identity and relationships:
new event kind `resolution`, original time/day/people/goal/target, and `plan_ref` pointing to
the original. The model cannot redirect those references.

The original becomes `fell_through` and appraised without creating an episode. The replacement
is appraised **in the same tick**, with the original intention as expectation. Its episode,
state effects, original intention resolution and both event updates commit atomically.
There is no successful intermediate state with an unappraised replacement and open intention.

Over budget, resolution-model errors or invalid resolution output mean the original plan
happens. These are handled inside the runner callback and traced `fallback`; ordinary
appraisal still runs, with its existing code fallback when needed. Database/programming
failures are not interpreted as model failure and must roll back and propagate. If preparation
or commit fails, a later tick can retry the still-unappraised event.

B51 retains the reconcile verdict's target in `world_event.resolves_memory_id`. On landing,
resolve that target episode, not at generation. Carry it onto a replacement. A missing/deleted
target is harmless. Clear preoccupation only when it still points at that target; a new strong
landing may then establish a new preoccupation under ordinary appraisal rules. Do not clear
an unrelated or newly assigned preoccupation.

Reuse existing `plan_ref`, `goal_ref` and `outcome` schema fields. Add nullable `fallthrough`
and `resolves_memory_id` (memory foreign key, deletion sets null). Existing rows remain valid.
Generate migration history from committed migration 0018, not the dirty attempt's 0019/0020.

## 6. Shared thinking behavior

Run anticipate, ruminate and wander in that order. Eligibility is checked before entering the
runner: not due means no call and no trace. A due optional loop without budget produces
`skipped_budget`. One loop's failure must not prevent the next loop's eligibility check.

Each valid item is embedded and stored with `source: loop`, source reference
`<loop>:<trace-id>`, confidence 0.6, maximum content length 300, and salience low 0.25 or medium
0.4. Invalid shapes are rejected, not coerced into fabricated content. Anticipate and ruminate
produce one thought; wander produces at most two items.

Drop an item when its closest eligible dedupe neighbour has similarity **greater than** 0.92,
including items accepted earlier in the same output batch. Recheck dedupe under the application
lock. Dedupe can compare unreal items as text; factual recall/reconciliation cannot use them.
Dropped items and reasons appear in trace outputs.

Proposed clarification: if an anticipation/rumination thought is dropped, apply none of its
associated state/source-marker effects. It may be considered again on a later tick while due.
A valid wander invocation counts toward its daily cap and gap even if all items dedupe away.
A stale/concurrent proposal that loses its eligibility does not count as an applied wander.

Proposed concurrency mechanism: extend the runner to allow a successful thinking trace to be
inserted in the same transaction as its accepted writes and source markers. Exactly one trace
is written for the run; a failed transaction instead produces a failed trace after rollback.
Wander count/gap queries count only successful, applied wander traces. This avoids a window
where memory has committed but another invocation cannot yet see the completion marker.
Keep the existing runner path for callers that do not need atomic completion.

## 7. Loop contracts

### Anticipate

Choose the soonest open intention with `now < payload.event_at <= now + 12 hours` and no
`anticipated_at`; break ties by ID. Filter eligibility before limiting the query.
Read its event/people, related goal, state and snapshot. Return one thought plus bounded
emotion. Code binds it to the selected intention, not an arbitrary model-supplied memory.

On acceptance, write `payload.anticipates` on the thought and `anticipated_at` on the intention;
set emotion and move mood arousal by `0.3 * (proposed_arousal - current_arousal)`, with existing
state bounds. Mood valence does not move. Recheck that the intention is still open and future
before applying; landing wins over an in-flight anticipation.

### Ruminate

Choose an eligible episode that landed between 2 and 24 hours ago, inclusive, with absolute
valence at least 0.5 and `payload.ruminated < 1` (missing means zero). Use landing `created_at`,
not the world's potentially older `occurred_at`; choose oldest eligible, then ID. Exclude stale
and superseded episodes. A resolved episode remains history and can be eligible.

Read episode, its recorded appraisal emotion, people, current state and related goals.
New appraisals must retain their emotion in episode payload; older episodes lacking it are
explicitly presented without historical emotion rather than inventing one.

On acceptance, write thought `payload.ruminates`, increment the episode marker, reinforce recall
using the existing memory bump/cap rules, and move mood valence by `0.1 * sign(episode.valence)`
within existing bounds. Refresh current emotion's timestamp only when it refers to that episode.
No unrelated emotion is replaced. Marker, reinforcement, thought and state commit together.

### Wander

Require today's plan and downtime: no current busy/quiet block according to existing block
helpers. Do not invent a `downtime` block kind. Missing plan is not due. Permit at most two
applied wanders per local day and a minimum three-hour gap, including across midnight.

Read at most 50 recallable memories from the last seven days, deterministically ordered by
newest creation time then ID. Exclude unreal, stale, superseded and resolved intentions.
Choose a seed weighted by `salience * max(0, 1 + 0.5 * valence * mood_valence)`, seeded with
`${day}:wander:${completedToday}`. If all weights are zero, use a uniform seeded choice.
No seed means not due. Add up to three factual neighbours with similarity at least 0.3,
excluding the seed; stable ordering resolves ties.

Read this chain, mood/energy/needs, snapshot and active goals. Output thought, idea or
explicitly unreal hypothetical. Wander changes no core state. Recheck downtime, cap and gap
under the application lock; two overlapping invocations cannot both consume the same slot.

## 8. Configuration, integration and documentation

All defaults above become named config values, not scattered literals. Reuse existing bounds,
reinforcement and budget configuration. New prompts are versioned files under `prompts/core/`
(`resolve`, `anticipate`, `ruminate`, `wander`, v1). Remove event v3 only when v4 replaces its
last configured use; do not retain compatibility flags or dead code.

Add one `core_mind_tick` queue, hourly at configurable `core.mind.tick_cron = "50 * * * *"`,
after world minute 10 and state minute 45. Queue retries are zero; next-hour eligibility checks
provide retry behavior. Eval hourly ordering is world → state → mind → existing outreach.
No nightly job is added. Injected events support explicit true/false fallthrough overrides.

Update v3 with every implemented field, config key, job and prompt, B51 completion and actual
8b status. Record approved uncovered choices in DECISIONS. Do not edit CLAUDE.md even where
the older phase-wide design requests it; Ethan explicitly prohibited Claude-file edits.

## 9. Verification and handoff

Use TDD against the committed baseline, with repository tests for real transaction semantics.
Required coverage includes:

- Goal roll/weighting, no-goal path, injected-event behavior and prompt scope.
- Happened/fell-through/forced outcomes; same-tick replacement appraisal; no original episode;
  model-invalid/error/budget fallback; DB rollback and retry; competing world ticks.
- B51 at landing only; replacement propagation; missing target; preoccupation precedence.
- Every due boundary, deterministic selection, mood bounds, source markers, dedupe threshold,
  all-deduped runs, invalid output, embedding failure and replay/concurrency behavior.
- Optional reserve, sequential metering, local-midnight reset and observable failure traces.
- Factual retrieval/reconciliation excludes hypothetical memory; resolved intentions do not
  return as current plans. New purposes have deterministic fakes and invalid-output cases.
- Worker queue/schedule registration and eval ordering.
- Non-vacuous leak canary: actually exercise every new core purpose and scan resulting core
  tables/traces; paired side-channel test proves user exchanges do not change core outcomes.
  Fix event IDs/seeds where needed so random UUIDs do not confound comparisons.

Exit checks: typecheck, lint, full tests including canary, and fake eval comparison without
silently replacing baselines. Run DB-mutating suites serially. Use an isolated test database
for the restart rather than deleting or rewriting the current dev/test database's dirty-attempt
migration history. Full fourteen-day Phase 8 real-core exit remains 8d, not an 8b completion claim.

The implementation plan will define exact files, repository signatures, config names, fixtures,
commands and dependency order from the clean baseline. Task subagents receive bounded briefs,
explicit file ownership and the approved spec/plan; implementation tasks receive independent
spec-compliance and code-quality review. The driver integrates and verifies; no subagent can
resolve a spec/plan conflict by improvising. Preserve a task/review ledger for Claude handoff.

## 10. Approval checkpoint

Review this written spec before a new plan is produced. In particular, approve the explicit
dedupe side-effect behavior and atomic thinking-completion mechanism in section 6. After spec
approval, write and review the task plan; only then begin implementation with subagents.
