# Phase 8: Core loops — design

Date: 2026-10-02. Source of truth: `spica-design-spec-v3.md` (§3.2, §4, §6.2, §7.3, §8, §10.3,
§12, §15, §17, §20, §21 #4, §25).
Status: design approved in conversation section by section; this file is for Ethan's review before
the plan.

## 1. Goal

Give the core mind its own thinking. Phase 7 left her with events that land through a code-only
appraisal and a state that only drifts; Phase 8 adds the loops that turn her life into feelings,
thoughts, opinions, goals and a self that changes night to night, all inside a fixed daily call
budget and all reading only core memory, core state and the world (V2, V3, V6).

Phase 8 builds (v3 §20): LLM appraisal; goals and needs; world resolution (plan vs reality) and
goal-driven events; `core_wander`, `core_anticipate`, `core_ruminate`; nightly `core_reflect`,
`core_consolidate`, `core_render_snapshot`; the drift watch; `core.daily_call_budget`; the
inspector Core tab extended. Backlog folded in: B50 (`generatePlan` on `CoreDeps`), B51 (`resolves`
verdicts close the target episode), B53 (mood-congruent and goal-biased core recall), B54 (§21 #4,
settled below as the claim line).

Out of scope (later phases or future work): real-content activities (real books and films across
days), other agents' own arcs, the calendar (v3 §8.3 New, not in Phase 8's list); user loops
(Phase 9); enforcing the claim line in the guard (guard phase); per-loop jobs (later).

### Decisions taken with Ethan (2026-10-02)

| Question | Decision |
|---|---|
| Scope | One spec for the whole phase; the build is sliced 8a–8d, each merged green (§11) |
| Goals | **Seed + reflect**: 1–2 goals in the persona's Seed self (`### Goals`); nightly reflect adds and drops; code moves progress and marks done; separate `core_goal` table |
| Exit profile | **Fake + real core**: a deterministic all-fake Vitest exit run in `pnpm test`, plus an on-demand run where only the Phase 8 core loops call Haiku (reply, extract, `life_plan`, `life_event` faked; guard off), logging every input and output. Budget starts at 24 |
| Core vs what she told a user (§21 #4, B54) | **The claim line** (§8): claims are drawn by who owns them, not by vagueness. Life facts and ranking opinions come only from core; first impressions are held lightly; reactions to the user are free. When core later disagrees, core wins and she may say she changed her mind. Phase 8 builds the prompt rule and measurement; enforcement is a guard-phase item |
| Scheduling | **A: one hourly `core_mind_tick` plus `core_nightly`** for the test phase. Per-loop pg-boss jobs (v3 §17.4's earlier proposal) stay a future option, recorded in the backlog: the switch only touches the scheduler, since every loop is a plain function |

## 2. Runner, budget and traces

### 2.1 Runner

Every core loop is a plain function `(deps: CoreDeps, now) → outputs`. One wrapper,
`runCoreLoop(deps, name, now, fn)` in `src/mind/process/core/runner.ts`:

1. Checks the budget (§2.3) under the `core_budget` advisory lock.
2. Runs the loop: core reads; model and embedder calls outside any transaction; one transaction
   that re-checks and applies the results.
3. Writes exactly one `core_loop_trace` row per run, whatever happened.

A loop failure is caught, traced as `failed` with the error class, and never thrown past the
orchestrating job (one loop's failure must not stop the next).

### 2.2 Trace changes (migration)

`core_loop_trace` gains:
- `calls` (int, not null, default 0): model calls actually made, retries included; embeddings
  are not counted.
- `status` (`done | fallback | skipped_budget | failed`).
- `error` (text, nullable): the error class only, never content.

`tokens_in` / `tokens_out` are filled from the provider's usage; `cost` is computed from
`core.prices` (per model, per million input / output tokens). Existing rows are backfilled
`status = done`, `calls = 1` where `model` is not null, else 0.

### 2.3 Budget

- `core.daily_call_budget` = 24: the summed `calls` of core traces whose `created_at` falls in
  her current local date (resets at her midnight, `lifeTimezone`).
- It covers every core model call: `life_plan`, `life_event`, `core_resolve`, `core_appraise` and
  every thinking loop.
- `core.loop_priority` (the run order and tier):
  - **Essential:** `life_plan`, `life_event`, `core_resolve`, `core_appraise`, `core_reflect`,
    `core_render_snapshot`, `core_drift_watch`, `core_consolidate`.
  - **Optional:** `core_anticipate`, `core_ruminate`, `core_wander`.
- An optional loop runs only while `spent < budget − core.budget_reserve` (8), so daytime
  thinking can't starve the nightly loops. An essential loop runs while `spent < budget`.
- Over budget, an essential loop falls back and is traced `fallback`: appraisal → code appraisal;
  resolution → the plan happens; `life_plan` → the existing fallback plan; `life_event` → no
  event that day (the day is still marked done); nightly loops → skipped (`skipped_budget`), so
  the snapshot does not advance that night. An optional loop over budget is `skipped_budget`.
- `CoreTraces` gains `callsSince(from: Date): Promise<number>`.

Expected spend: plan 1, event 1, appraisal ~1, resolution ~0.15, anticipate ≤1, ruminate ≤1,
wander ≤2, reflect 1, render 1, drift 1, gist 0–1: about 10–13 a day.

### 2.4 B50

`generatePlan` / `ensurePlans` (`src/mind/world/day-plan.ts`) move to `CoreDeps`: the day plan is
read and written through `core.world` (`World` gains `plansBefore(day, n)` and `insertPlan`,
replacing the direct `listLifeDaysBefore` / `insertLifeDay` calls), and the plan
loop runs through `runCoreLoop` as `life_plan`, so it is fenced and counted. Event generation
(`generateCoreEvents`) is also counted, traced under `life_event`.

### 2.5 Scheduling

- **`core_mind_tick`** (new queue, cron `core.mind.tick_cron`, hourly after the world and state
  ticks): runs the optional loops that are due (§5), in priority order.
- **`core_nightly`** (new queue, cron `core.nightly.tick_cron`, hourly; acts only when her local
  hour ≥ `core.nightly.local_hour` = 3 and `core_state.last_nightly_day` < her local date): runs
  reflect → consolidate → render → drift watch, then sets `last_nightly_day`. Each step traces
  separately; a failed step doesn't stop the next (render uses whatever reflect managed).
  `last_nightly_day` is set under a lock at the start (claimed), so a retry never runs a night
  twice; a crashed night is not retried (the next night runs normally).
- The eval harness's hourly loop calls `coreWorldTick`, `coreStateTick`, `coreMindTick`,
  `coreNightly` in that order.

## 3. Goals, needs and emotion

### 3.1 Goals (`core_goal`, new table, no `user_id`)

Columns: `id`, `title`, `why`, `status` (`active | done | dropped`), `progress` (real 0–1),
`embedding` (vector 1024), `source` (`seed | reflect`), `source_ref`, `started_at`, `target_at`
(nullable), `updated_at`.

- Repo `CoreGoals` on the core layer (`core.goals`): `active()`, `get(id)`, `insert`,
  `setProgress(id, progress, now)`, `setStatus(id, status, now)`. No method takes a user.
- **Seed:** the persona's Seed self gains `### Goals`, one goal per line `- title: why` (Ethan
  writes them; two placeholders ship). Parsed and seeded, if no goal exists yet, with snapshot v0
  at the same three places as the canon entities (worker start, eval runner, `db:reset-self`).
- At most `core.goals.max_active` = 3 active. Progress moves only in code (§3.3); code marks a goal
  `done` when progress reaches 1. Reflect adds and drops goals (§6.1).

### 3.2 Needs and emotion (`core_state`)

- `needs` = `{autonomy, competence}`, each 0–1, initialised at `core.state.needs_baseline` = 0.6.
  `core_state_tick` depletes each by `core.state.need_decay_per_day / 24` per hour (clamped ≥ 0).
- `emotion` = `{label, valence, arousal, about, since}` or null. `core_state_tick` clears it once
  `since` is older than `core.state.emotion_hours` = 6. Rumination refreshes `since` (§5.3).
- `CoreStatePatch` admits `needs` and `emotion`; `core_state.last_nightly_day` is new (migration).
- The "How you're feeling" line (`prompts/core-state/line/v3.md`) adds her emotion when set ("a
  bit giddy about tonight": label plus a short `about` phrase from the appraisal) and one phrase
  per need below `core.state.bands.needs`. Needs also go to the event generator and the thinking
  loops' prompts.

### 3.3 Appraisal (`core_appraise`, Haiku, `prompts/core/appraise/v1.md`)

Replaces the code-only stand-in, which remains only as the named fallback.

- **Inputs:** the event (content, kind, stakes); the intention it fulfils, if any ("what she
  expected"); core values; the latest snapshot; core state (mood, energy, needs, emotion); active
  goals (id, title, progress).
- **Output (zod):** `episode` (the memory, third person, coloured by how it felt: E1),
  `emotion` `{label, valence, arousal, about}`, `salience` (`low | medium | high`),
  `goal_effects` `[{goal_id, effect: advance | block, size: small | medium | large}]`,
  `need_effects` `{autonomy, competence}` each `−1 | 0 | +1`.
- **Code applies and bounds every number (E2):** valence clamped to [−1, 1], arousal to [0, 1];
  salience from `core.appraise.salience`; unknown goal ids dropped; progress `±
  core.goals.step[size]` (negative for `block`), clamped; needs `+ core.appraise.need_gain ×
  effect`, clamped; mood nudged by the **appraised** valence (`applyEvent`); preoccupation by
  today's rule on the appraised valence; `core_state.emotion` set (`about` = the episode id,
  `since` = now; the `about` phrase is kept in the emotion for the line); the world event's
  `goal_ref` set to the first goal affected (if not already set).
- **Fallback** (over budget, model error, invalid output): today's code appraisal (episode = event
  content, emotion from valence bands with a label from `core.appraise.fallback_labels`, no goal or
  need effects); trace `fallback`. An event always lands.
- The model call runs before the world tick's transaction; inside the lock, an event already
  landed by another run discards its result. The trace loop name is `core_appraise` (one row per
  run that landed something; `core_appraise_due` is retired).

## 4. World: goal-driven events and resolution

### 4.1 Goal-driven events

At daily generation, code rolls (seeded by her local date) against
`core.world.goal_event_share` = 0.5. On a hit it picks an active goal (seeded, weighted toward
lower progress: weight `1 − progress + ε`) and passes it to the generator as a directive (this
event touches this goal, for better or worse). On a miss, or with no active goal, the event is
free. The generator (`prompts/life/event/v4.md`) also sees her needs. The chosen goal is stored as
`world_event.goal_ref`; appraisal decides whether it advanced or blocked it.

### 4.2 Plan vs reality (`core_resolve`, Haiku, `prompts/core/resolve/v1.md`)

When a **planned** event's time comes, before its appraisal, in the world tick's appraisal step:

1. Code rolls (seeded by the event id) against `core.world.fallthrough_probability` = 0.15. An
   injected event may force it (`fallthrough: true | false` in the eval script).
2. **Happens:** `world_event.outcome = happened`; appraised as usual.
3. **Falls through:** one call writes what happened instead (`content`, `valence`, `stakes`) from
   the plan, her intention, core values and the snapshot. It is recorded as a new `world_event`
   (`kind: resolution`, `plan_ref` = the original, the original's people, `at` = the original's
   `at`, `life_day` its day). The original gets `outcome = fell_through` and `appraised_at`; it
   never becomes an episode. The resolution lands in the same run and is appraised with the
   original's intention as "what she expected"; the intention resolves (E3).
4. **Fallback** (over budget, error, invalid output): the plan happens (`fallback`).

Surprises need no new mechanism: spontaneous events are the "surprise happens" half.

### 4.3 B51

The event generator's reconcile already returns `resolves` with a target memory. The target is
kept on the event (new column `world_event.resolves_memory_id`). When that event **lands**, the
target episode's status becomes `resolved`, and her preoccupation is cleared if it pointed at it.
Nothing changes at generation, so a surprise still leaves no trace before it happens.

## 5. Hourly thinking (`core_mind_tick`, optional tier)

Checked each hour in priority order (anticipate → ruminate → wander); whatever is due runs, each
through the runner. Each is one Haiku call with its own prompt (`prompts/core/<loop>/v1.md`).
Outputs are core memory with `source: loop`, `source_ref` `<loop>:<trace id>` (the runner
allocates the trace id up front), embedded, salience from `core.loops.salience` (`low | medium`),
confidence `core.loops.thought_confidence`.

**Dedupe (all three):** an output whose closest core memory is above
`core.loops.dedupe_similarity` = 0.92 is dropped and listed in the trace. Code-only.

### 5.1 `core_wander`

- **Due:** her current block in today's plan is downtime; fewer than `core.wander.max_per_day` = 2
  wanders today; at least `core.wander.min_gap_hours` = 3 since the last.
- **Inputs:** a seed memory chosen in code (seeded random among her recallable core memories from
  the last `core.wander.seed_days`, weighted by salience × mood congruence:
  `1 + core.wander.mood_bias × valence × mood_valence`); its `near()` neighbours (up to
  `core.wander.chain`) as the associative chain; mood, energy, needs; the snapshot; active goals.
- **Outputs:** 1–2 items, each `thought | idea | hypothetical` (at most `core.wander.max_items`).
  A `hypothetical` is stored marked unreal; core retrieval and reconcile neighbours already treat
  it as not real (E4).
- **State:** none.

### 5.2 `core_anticipate`

- **Due:** an open intention whose `payload.event_at` is within `core.anticipate.lead_hours` = 12
  and in the future, without `payload.anticipated_at`. One intention per run (the soonest).
- **Inputs:** the intention, the event's people, core state, the related goal (via the event's
  `goal_ref`) if any.
- **Outputs:** a `thought` (`payload.anticipates` = the intention id) and an emotion
  `{label, valence, arousal, about}`.
- **State:** emotion set (bounded as in appraisal); `mood_arousal` moves by
  `core.anticipate.arousal_gain` toward the proposed arousal. Mood valence waits for the outcome.
  The intention's `payload.anticipated_at` is set.

### 5.3 `core_ruminate`

- **Due:** an episode with |valence| ≥ `core.ruminate.min_valence` = 0.5 that landed between
  `core.ruminate.delay_hours` = 2 and `core.ruminate.window_hours` = 24 ago, ruminated fewer than
  `core.ruminate.max_per_episode` = 1 times (`payload.ruminated` count). One episode per run.
- **Inputs:** the episode, the emotion it was appraised with, its people, core state, related goals.
- **Outputs:** a `thought` (`payload.ruminates` = the episode id).
- **State:** the emotion's `since` is refreshed if it is about this episode; mood valence moves
  by `core.ruminate.gain` in the direction of the episode's valence; the episode gets recall
  reinforcement (`last_recalled_at`, `recall_count`, the user-memory bump rules), so a dwelt-on
  memory decays more slowly.

Thoughts and ideas surface through ordinary core retrieval and are in place for Phase 9's
`core_thought` outreach candidate.

## 6. Nightly (`core_nightly`)

### 6.1 `core_reflect` (Haiku, `prompts/core/reflect/v1.md`)

- **Inputs:** episodes, thoughts and ideas created since the previous nightly run (capped at
  `core.reflect.max_inputs`); her active opinions and interests nearest to them (top
  `core.reflect.context_items`, with ids); active goals with progress; the current snapshot; core
  values.
- **Output:** `insights` (≤ `max_insights` = 2), `opinions` (≤ `max_opinions` = 3: `subject`,
  `stance`, `confidence` `low | medium | high`, `supersedes` an opinion id or null), `interests`
  (≤ `max_interests` = 2: `content`, `change: new | fading`, `target` an interest id for
  `fading`), `goals` (`add {title, why}` | `drop {goal_id}`), `narrative` (one paragraph: who
  she's been lately).
- **Code applies:** opinions stored with confidence from `core.reflect.confidence`; a `supersedes`
  marks the old opinion `superseded` with `superseded_by` (unknown ids ignored); `fading` lowers
  the target interest's salience by `core.reflect.fade_factor`; the narrative supersedes the
  previous narrative; goal adds honoured only under `max_active` (embedded, `source: reflect`),
  drops set `dropped`. With nothing new since the last run, reflect makes no call and traces `done`
  with `calls = 0`.

### 6.2 `core_consolidate`

- **Decay (code, every night):** the user decay mechanics applied to core memory: after
  `core.decay.grace_days` without recall, salience falls by `core.decay.rate` per night; at or
  below `core.decay.stale_floor` the memory becomes `stale`, never deleted. Open intentions, the
  current preoccupation, the latest narrative and active goals' memories are exempt.
- **Gist (Haiku, `prompts/core/consolidate/v1.md`, only when needed):** resolved episodes older than
  `core.consolidate.gist_after_days` = 7, not yet gisted, grouped by her local week (groups of at
  least `min_group` = 3), at most `max_groups` = 1 per night. One call per group writes the gist,
  stored as an `episode` with `payload.gist_of` (source ids), `occurred_at` the group's first,
  salience the group's maximum. Sources keep their content; their salience is multiplied by
  `core.consolidate.gist_source_factor` = 0.5 and they get `payload.gisted_into`. No group: 0
  calls.

### 6.3 `core_render_snapshot` (Haiku, `prompts/core/snapshot/v1.md`)

- **Inputs:** core values; the previous snapshot; the latest narrative; top active opinions and
  interests (by salience, `core.snapshot.max_items` each); active goals with progress; insights
  since the last render; her people (core entities and `agent_note`s).
- **Output:** sections `Lately`, `Opinions`, `Interests`, `Goals`, `People`, `Habits of speech`
  (carried forward unless visibly changed). No transient state (mood, energy).
- **Stored:** version N+1 with `sections`, `content` (the sections joined as `### ` headings, the
  same shape the reply's "Who you are lately" already reads), `source_ids`, `model`,
  `prompt_version`, and a new `embedding` column (migration; v0 is embedded at seed). Each bullet
  line of the new snapshot is written to `core_self_line` (§8.2).
- **Failure:** no new version; replies and the event generator keep reading the last one.

### 6.4 `core_drift_watch` (`drift_log`, new table)

`drift_log`: `id`, `version`, `check` (`values | diff | trend`), `value` (nullable), `excerpt`
(nullable), `verdict` (`ok | contradicts | strains`, nullable), `score` (nullable), `created_at`.

Runs only after a new version:
1. **Values** (Haiku judge, `prompts/core/drift/v1.md`): core values against the new snapshot;
   one row per contradiction (`contradicts | strains`, with the value and the excerpt), or one
   `ok` row.
2. **Diff** (code): cosine distance between the new and previous snapshot embeddings as `score`,
   and the share of sections whose text changed in `excerpt` as a short summary.
3. **Trend** (code): cosine distance from v0.

Logged and shown in the inspector; nothing is blocked (§21 #6 stays OPEN).

## 7. Reply side

- "Who you are lately" already reads the latest snapshot; it now advances nightly.
- "How you're feeling" gains emotion and needs (§3.2).
- **B53:** `core.memory.candidates` also returns each candidate's `valence` and `goal_sim` (its
  highest cosine similarity to an active goal's embedding, in SQL; 0 with no goals).
  `retrieveCore` gives each candidate a `boost` = `(1 + retrieval.core_mood_bias × valence ×
  mood_valence) × (1 + retrieval.core_goal_bias × goal_sim)`, both biases 0.3, and the shared
  `rankMemories` multiplies a candidate's score by its optional `boost` (default 1). Core
  retrieval only.
- Superseded, stale and hypothetical items stay out of core retrieval, as now.

## 8. The claim line (§21 #4)

### 8.1 Reply v11 (`prompts/reply/v11.md`)

Adds the rule, in her terms:
1. **Your life** (what you did, are doing or plan to do; who you know) comes only from the
   sections about you in front of you. If they don't cover it, you haven't done it: say something
   true instead. Never promise something about your own life.
2. **Opinions:** your own at full strength; on things you have no view of yet, a first impression,
   held lightly. "Favourite", "the best", "I hate" only for things that are yours.
3. **Reactions to them** are yours to give freely.

And: if something you told them earlier no longer matches who you are now, who you are now is
true; you can say you changed your mind.

### 8.2 Measuring it (`prompts/extract/v5.md` + cold path)

- Extraction: `self` facts gain `claim_kind` (`life | opinion | reaction`); null for `user` and
  `shared` facts.
- Cold path: for `life` and `opinion` claims, `grounded` = the claim embedding's best similarity
  to core memory or to `core_self_line` (core values, `version` null, plus the latest snapshot's
  version) ≥ `claims.grounded_similarity`. One vector query per claim, no LLM call. Reading core
  from the user pipeline is allowed (V2 is one-way); the result is written only to the user's fact.
- `fact` gains nullable `claim_kind` and `grounded` (migration).
- **`core_self_line`** (new table, no `user_id`): `id`, `version` (int, null for core values),
  `text`, `embedding`. Written at seed (core values lines and the seed self as version 0) and at
  each render. Reached through `core.memory` (`selfLines`, `nearSelfLine`).
- Shown as ungrounded-claim counts per conversation in review-run files and the inspector's facts
  tab. Nothing blocks.
- Backlog (guard phase): `invented_self` honesty category using the same check.

## 9. Inspector

The Core tab gains: today's budget (spent / budget, by loop and status); core state with emotion
and needs; goals with progress and source; core memory by kind (superseded links, gists with
sources); snapshot versions with a per-section diff against the previous; the drift log; traces
with calls, tokens, cost and error class. The facts tab shows `claim_kind` and `grounded` on self
facts.

## 10. Testing

### 10.1 Unit and DB tests

Due checks for each loop (pure); budget tiers and reserve; runner trace on every status;
appraisal bounds every number, drops unknown goals, falls back; goal progress, `done` at 1,
`max_active`; need depletion; emotion expiry and refresh; resolution roll, forced flags,
`fell_through` path and its fallback; B51 closes the right episode at landing only; goal-driven
event roll and weighting; core decay and its exemptions; gist grouping and source damping; opinion
and narrative superseding; reflect with nothing new makes no call; snapshot version increment and
no version on failure; drift diff and trend maths; retrieval boost; grounding check; persona
`### Goals` parsing; `life_plan` on `CoreDeps`.

Structural: `core.goals` and the self-line methods take no user and touch no user table (the
existing core-layer test extended).

### 10.2 Fakes

Every new purpose (`core_appraise`, `core_resolve`, `core_wander`, `core_anticipate`,
`core_ruminate`, `core_reflect`, `core_consolidate`, `core_snapshot`, `core_drift`) has a
deterministic fake in the fake LLM, able to produce invalid output on demand for fallback tests.
The canary's `CapturingLLM` echoes any canary in its input into each of their text outputs.

### 10.3 Canary

`tests/exit/mind-split.test.ts` also runs `coreMindTick` and `coreNightly`, and scans the new
tables (`core_goal`, `drift_log`, `core_self_line`, the new trace columns) and every new core
prompt. The side-channel assertion (user A's exchange leaves core state unchanged) stays.

### 10.4 Exit run 1 (`tests/exit/core-loops.test.ts`, all fake, in `pnpm test`)

Fourteen simulated days through the eval runner, with injected events: a planned event inside the
anticipation window, a strong event (rumination), and a planned event forced to fall through.
Asserts: every loop has at least one `done` trace; each local day's summed calls ≤ budget; 14
snapshot versions after v0, each with values, diff and trend drift rows; seeded goals exist and a
progress moved; needs moved; a `resolution` event exists and its plan is `fell_through`; a
gist exists by day 14. A second case with budget 6 asserts optional loops `skipped_budget` and
essentials `fallback`.

### 10.5 Exit run 2 (`pnpm exit:core --real`, on demand)

The same fourteen days and structural assertions with only the Phase 8 core loops on real Haiku
(reply, extract, `life_plan`, `life_event` faked; guard off). Every core prompt and output is
written to a review file under `evals/out/`. Counts that depend on content (gists, ruminations)
are reported, not asserted.

### 10.6 Evals

The YAML `core` assertion gains memory-kind counts, snapshot versions, drift rows and goals;
scripts may set `fallthrough` on injected events.

## 11. Slices

Each slice is merged with `pnpm typecheck`, `pnpm lint`, `pnpm test` and the canary green.

- **8a:** runner, trace migration, budget; B50; `core_goal` and the seed; needs and emotion
  (state tick, line v3); LLM appraisal.
- **8b:** goal-driven events (event v4); resolution; B51; `core_mind_tick` with anticipate,
  ruminate, wander.
- **8c:** `core_nightly` with reflect, consolidate (decay and gist), render; `core_self_line`;
  drift watch.
- **8d:** B53; reply v11 and extract v5 with grounding; the inspector; exit runs 1 and 2; the
  canary extension.

## 12. Deleted or replaced

- Prompt versions replaced and deleted once nothing configures them: `life/event` v3 → v4,
  `reply` v10 → v11, `extract` v4 → v5, `core-state/line` v2 → v3.
- The `core_appraise_due` trace name → `core_appraise`.
- `appraiseEvent`'s code path is kept only as the named appraisal fallback.

## 13. Paperwork

Per slice: v3 updated (§6.2 tables and columns; §8.2–8.5; §15; §17.1, §17.2, §17.4 with A as
built and B in the backlog; §20 Phase 8 built; §21 #4 settled as the claim line; §25 B50, B51,
B53, B54 done, new items for per-loop jobs (later) and `invented_self` (guard phase)); every new
config key, prompt and job added to v3; `DECISIONS.md` entries for uncovered choices; CLAUDE.md's
current phase at the end.
