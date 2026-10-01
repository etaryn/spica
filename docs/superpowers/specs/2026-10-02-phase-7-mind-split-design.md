# Phase 7: Mind split — design

Date: 2026-10-02. Source of truth: `spica-design-spec-v3.md` (§3–4, §6, §7, §8, §10, §17.3, §20).
Status: design approved in conversation; this file is for Ethan's review before the plan.

## 1. Goal

Split her mind into the **core mind** (one Spica, no `user_id`) and the **user mind** (per user),
with the one-way flow enforced in code: core may be read by replies and user code; user data never
reaches core input, output or state.

Phase 7 builds (v3 §20): the core scope and core data layer (V6); `core_state` (the per-user ego
moved to core); world reads (the per-user life tick retired; the day plan read directly); core
events (generated once, reconciled against core memory); user affect params (V4); "what she told
this user" (V5); the persona split into core values and seed self; `core_snapshot` v0; the reply
assembly order (§10.3); the leak canary and side-channel test.

Out of scope (later phases): every LLM core loop (appraise, wander, anticipate, ruminate, reflect,
consolidate, render snapshot, drift watch, budget: Phase 8); goals and needs that move; world
resolution and surprises; user loops and the summary slot (Phase 9); mood-congruent recall.

### Decisions taken with Ethan (2026-10-01 / 2026-10-02)

| Question | Decision |
|---|---|
| Phase order | 7 mind split first |
| Core memory storage (§21 #5) | Separate core tables, no `user_id` |
| Core values split (§21 #2) | §7.2 confirmed, but dev-editable: the infra supports moving items between the two sections without code changes |
| Exit-run profile | **All fake.** Fakes are scripted to hit every branch the code takes on a model's output (reconcile verdicts, rule rejects, invalid JSON, timeouts) |
| Core layer enforcement | **Interfaces in `Deps`; core code gets no raw `db`** (test phase). A separate Postgres role for core is the end goal (backlog, before users) |
| Events before appraisal exists | **Code-only `appraiseEvent`** (generator valence passes through) that Phase 8 replaces with `core_appraise` |
| Leak test | Deterministic; the fake LLM **echoes its input** in the canary run (a worst-case model) |

## 2. Data model

### 2.1 New core tables (no `user_id`; every timestamp from `Clock`)

- **`core_memory`**: `id`, `kind` (`episode | opinion | interest | goal | intention | thought |
  reflection | idea | hypothetical | insight | narrative | agent_note`), `content`, `payload`
  (jsonb), `embedding` (vector 1024), `entity_refs` (uuid[] → `core_entity`), `occurred_at`,
  `created_at`, `last_recalled_at`, `recall_count`, `status` (`open | resolved | recurring |
  stale | superseded`), `superseded_by`, `salience`, `valence`, `confidence`, `source`
  (`world | loop`), `source_ref`. Phase 7 writes only `episode`.
- **`core_entity`**: `id`, `name`, `aliases`, `salience`, `first_seen`. Seeded from
  `core.world.canon_entities` (Alcor).
- **`core_state`** (one row, `id = 1` with a check): `emotion` (jsonb `{label, valence, arousal,
  about, since}`, neutral default), `mood_valence`, `mood_arousal`, `energy`, `needs` (jsonb
  `{autonomy, competence}`, neutral default; Phase 8 moves them), `preoccupation` →
  `core_memory`, `preoccupation_since`, `baseline` (jsonb), `last_tick`, `last_event_day`
  (her local date of the last completed event generation). Range checks as on the old `identity`.
- **`core_snapshot`**: `version` (int pk), `content`, `sections` (jsonb), `source_ids` (uuid[]),
  `rendered_at`, `model`, `prompt_version`.
- **`world_event`**: `id`, `at`, `kind` (`planned | surprise | resolution`; Phase 7 writes
  `planned`), `content`, `valence`, `stakes` (`low | high`), `agents` (uuid[] → `core_entity`),
  `life_day`, `plan_ref`, `goal_ref`, `outcome`, `created_at`.
- **`core_loop_trace`**: `id`, `loop`, `inputs` (jsonb ids), `outputs` (jsonb ids), `model`,
  `prompt_version`, `tokens_in`, `tokens_out`, `cost`, `created_at`. Code-only loops leave the
  model, token and cost columns null.

### 2.2 Changed

- **`life_event_log`**: drops `user_id`; `fact_id` becomes `world_event_id`; `target_fact_id`
  becomes `target_memory_id` (→ `core_memory`).
- **`conversation_state.deferred_fact`** (uuid → `fact`) becomes **`deferred_block`** (text block
  key `<her local date>#<start HH:MM>`).
- **`session_log`**: new nullable `snapshot_version` (int) on companion turns.
- **`relationship_param`**: two new params per user, created on first use like the others:
  `affect_valence` (0–1, neutral 0.5) and `afterglow` (0–1, rests at 0).

### 2.3 Dropped

- `identity` and `ego_tick` tables.
- Per-user `self` facts the life tick generated: a migration deletes `fact` rows with
  `subject = 'self' AND source = 'generated'` (day-block copies and generated events) and the
  threads it opened for them (`subject = 'self'` threads whose source fact was generated). Dev data
  only. `self` facts from conversation (`source = 'turn'`) stay: they are "what she told this user".

## 3. Core data layer (V6)

Interfaces in `src/mind/{memory,state,world}/core/`; Postgres implementations in
`src/db/repos/core/`. None takes a `userId`.

```ts
interface CoreMemory {
  insert(items: NewCoreMemory[]): Promise<string[]>;
  near(embedding: number[], k: number, minSimilarity: number): Promise<CoreNeighbour[]>;
  retrieve(query: { embedding: number[]; now: Date; topN: number }): Promise<RankedCoreMemory[]>;
  recentEpisodes(since: Date, limit: number): Promise<CoreMemoryRow[]>;
  get(id: string): Promise<CoreMemoryRow | null>;
  entities(): Promise<CoreEntityRow[]>;
  upsertEntities(names: string[], now: Date): Promise<Map<string, string>>;
  latestSnapshot(): Promise<CoreSnapshotRow | null>;
  insertSnapshot(s: NewCoreSnapshot): Promise<void>;
}
interface CoreState {
  get(): Promise<CoreStateRow>;
  update(fn: (s: CoreStateRow) => Partial<CoreStateRow>): Promise<CoreStateRow>; // row lock
}
interface World {
  plan(day: string): Promise<LifePlan | null>;
  blockAt(at: Date): Promise<WorldBlock | null>; // reads life_day for her local date
  blocks(day: string): Promise<WorldBlock[]>;
  events(day: string): Promise<WorldEventRow[]>;
  recordEvent(e: NewWorldEvent): Promise<string>;
  lastHighStakesAt(): Promise<Date | null>;
}
interface CoreLayer {
  memory: CoreMemory;
  state: CoreState;
  world: World;
  traces: { insert(t: NewCoreLoopTrace): Promise<void> };
  transaction<T>(fn: (core: Omit<CoreLayer, "transaction">) => Promise<T>): Promise<T>;
}
```

- `Deps` gains `core: CoreLayer`, built in the app, the worker, tests and evals from the same `db`.
- **`CoreDeps`** = `Pick<Deps, "core" | "llm" | "embedder" | "clock" | "config" | "log">`. Every
  core-only function (the world tick, the state tick, `appraiseEvent`, event generation, snapshot
  seeding) takes `CoreDeps`, so it has no `db`, queue, push or event bus to reach user data with.
- Replies and user code read core through `deps.core` (read methods only, by convention; the
  write methods are used only by core-only code).
- The ESLint one-way rule extends to `src/mind/*/core/**` and `src/db/repos/core/**`: no imports
  from `user/`, `process/`, `db/repos/user`, `db/repos/admin`.
- `reconcileAgainstNeighbours` and `prompts/reconcile` move to `src/mind/memory/shared/`; both
  scopes call it with their own neighbours.

## 4. Persona and snapshot

- **`prompts/persona/v3.md`** has three top-level sections:
  - `## Core values`: fixed (v3 §7.2 list).
  - `## Seed self`: snapshot v0 (driftable: current interests within and around stars, films and
    books; specific opinions; the Alcor dynamic; minor voice tics; a short "lately" narrative).
    Drafted from v2 by Claude, edited by Ethan.
  - `## Public voice (reference)`: the v2 appendix; never loaded into any prompt.
- `parsePersona(markdown)` returns `{ coreValues, seedSelf }` by heading. It throws when either
  required heading is missing. Moving a bullet between sections is a prompt-file edit only.
- The `adjacent` interest note moves from the persona file into the reply rules.
- **Snapshot v0:** `seedSnapshot(core, config)` inserts version 0 from `seedSelf` when no snapshot
  exists (`model = 'seed'`, `prompt_version = config.prompts.persona`). It's idempotent and runs at
  worker start and in test/eval setup. `pnpm db:reset-self` also clears core tables and reseeds.

## 5. Core jobs

### 5.1 `core_world_tick` (replaces `life_tick`)

Hourly (`core.world.tick_cron`). Does work once per her local date, at or after
`core.world.events_local_hour`, when `core_state.last_event_day < today`.

1. **Context (core only):** today's plan, recent core episodes (`core.world.event_context_items`),
   core entity names.
2. **Draws:** `events_per_day_max` draws seeded by `${day}:${i}` (no user), each kept with
   `event_probability`; the eval `inject` hook keys by day only.
3. **Per draw, up to `1 + regen_attempts`:** generate (`life_event`, persona core values + seed
   self as system), `checkEvent`, `checkRules` (new-entity spacing from `core_entity.first_seen`,
   high-stakes spacing from `world.lastHighStakesAt`), embed, `core.memory.near`,
   `reconcileAgainstNeighbours`; `duplicate`/`contradicts` → regenerate with the reason. Every
   attempt is logged.
4. **Apply** in one `core.transaction` under a global advisory lock `core_world_tick`; re-check
   `last_event_day`; for each accepted event: `world.recordEvent` → `appraiseEvent` → upsert
   entities; insert `life_event_log` rows; set `last_event_day`; write one `core_loop_trace`.
   Any failure rolls back; the next hourly run retries.

**`appraiseEvent(core, event, now)`** (code only; Phase 8 replaces the body with `core_appraise`):
writes a core `episode` (`content`, `valence` = the event's, `salience` =
`core.world.event_salience`, `status` = `open` if high-stakes else `resolved`, `source = 'world'`,
`source_ref = world_event:<id>`), applies the mood nudge (`applyEvent`, `core.state.event_gain`,
`event_arousal_gain`), and sets the preoccupation when `|valence| ≥ core.state.preoccupation_min_valence`.

High-stakes events no longer open threads (per-user threads about her life were a by-product of
per-user events). The open episode plus preoccupation carries it until Phase 8's goals.

### 5.2 `core_state_tick` (replaces `ego_tick`)

Hourly (`core.state.tick_cron`). One drift step per UTC hour on the single row: the ported maths
(drift toward baseline, energy rhythm in her local hour, busy drain from `world.blocks(today)`,
seeded noise keyed by hour, preoccupation expiry). Missed hours aren't caught up. Writes a
`core_loop_trace` (`loop = 'core_state_tick'`, outputs: the new values).

### 5.3 Jobs and config

- Retired: `life_tick`, `ego_tick`. New: `core_world_tick`, `core_state_tick`
  (in `src/worker/world-jobs.ts` and `state-jobs.ts`). `life_plan` unchanged.
- Config: `ego.*` → `core.state.*` (minus `exchange_gain`); life-event keys
  (`events_per_day_max`, `event_probability`, `event_*`, `regen_attempts`, `new_entity_days`,
  `high_stakes_min_days`, `canon_entities`, `injected_event_at`, `lock_timeout_ms`) →
  `core.world.*`, plus `core.world.tick_cron`, `events_local_hour`, `event_context_items`.
  `life.*` keeps the plan and timezone keys. Deleted: `life.tick_cron`, `tick_local_hour`,
  `block_salience`, `event_context_facts`, `high_stakes_checkpoint_days`, `event_confidence`.
  New: `retrieval.core_top_n`, `relationship.affect.*` (§7).

## 6. World reads

- **`World.blockAt` / `blocks`** derive `WorldBlock { key, start, end, kind, busy, label }` from
  `life_day.plan` (the block-to-instant code from the old `blocks.ts` moves to `world/core/`).
- **Availability** (`deferWhileBusy`): `world.blockAt(now)`; stores the block key in
  `deferred_block`; the busy note checks `hasTriggerSince(block.start)` as now.
- **"Your day" line:** `world.blocks(today)`; the deferred label comes from the block key.
- **Outreach:** `G3` uses `world.blockAt`; **`her_day`** candidates come from
  `core.memory.recentEpisodes(now − her_day_lookback_hours)`, topic key `her_day:<memory id>`
  (per user, so each user hears an event at most once). `factId` on the candidate becomes a
  `coreMemoryId`, forced into the reach-out's core retrieval.

## 7. Reply and cold path

### 7.1 Assembly (`prompts/reply/v9.md`, `assemblePrompt`)

System prompt sections in this order, each skipped when empty:

1. Core values (`parsePersona`) then the reply rules (`reply/v9`)
2. `## Who you are lately`: latest snapshot content
3. `## How you're feeling` (core state bands → `prompts/core-state/line/v1.md`, the old ego phrases)
   and `## Your day`
4. `## You and them`: relationship line, gap line, relationship summary (now including affect
   phrases)
5. *(latest big-event summary: Phase 9; no section yet)*
6. `## What you remember`: `### About them`, `### Between you`, `### What you've told them`
   (user-scope `self` facts, V5), `### From your own life` (core retrieval, top
   `retrieval.core_top_n`, her preoccupation forced in and marked "on your mind lately")
7. Things to ask about, unanswered questions, why you're writing
8. Recent turns (the messages)

- Core retrieval uses the same ranking (`memory/shared/ranking.ts`) on core rows. User retrieval
  no longer forces a preoccupation.
- **No recall write-back to core memory from a reply** (V2: user conversations must not shape
  core salience). User recall reinforcement is unchanged.
- **Crisis:** core values, snapshot, user memory, recent turns; no state lines, no core memory.
- The reply stores the snapshot version it read in `session_log.snapshot_version`.
- `reply/v9` explains the new sections (who you are lately, from your own life, what you've told
  them: stay consistent with it).

### 7.2 Cold path (V4, V5)

- `nudgeEgoForExchange` is replaced by **`nudgeAffect`** in `state/user/relationship/`, inside
  the existing relationship savepoint: `tone = exchangeTone(facts)`;
  `affect_valence ← value + relationship.affect.exchange_gain × ((tone+1)/2 − value)`;
  if `tone > 0`, `afterglow ← nudge(afterglow, relationship.affect.afterglow_gain × tone)`.
  `afterglow` fades with `relationship.affect.afterglow_half_life_hours` in `fadeParams`.
  Skipped on crisis and on reach-out exchanges.
- Summary phrases (`prompts/relationship/summary`) gain `affect_valence high/low` and
  `afterglow high` entries.
- **Nothing in the cold path reads or writes `deps.core`.**
- `self` facts from extraction stay user-scoped ("what she told this user"); her hurt `feeling`
  facts too. Contradictions between those and core (§21 #4) are not handled in Phase 7.

## 8. Deleted in this phase

`src/mind/state/legacy-ego/`, `src/mind/world/legacy-life-tick/`, `src/db/repos/user/identity.ts`,
`src/db/repos/user/life-event-log.ts` (moves to core), `src/db/repos/admin/life.ts`
(`adminListLifeUsers`), the fact-repo helpers only they used (`listGeneratedBlockRows`,
`listRecentSelfFacts`, `getPreoccupationFact`, the self-entity helpers for the generator, the
`her_day` fact query), `prompts/ego/line`, `prompts/persona/v2.md`, `prompts/reply/v8.md`, the
`ego.*` config block, the jobs `life_tick` and `ego_tick`, their tests, and the eval assertions
`ego` and the life-tick parts of `life`. `ego-busy-day.yaml` and `life-two-weeks.yaml` are
rewritten against core (`core` assertions).

## 9. Inspector

- Per-user **Life** tab: shows the shared plan and today's world events (no per-user blocks).
- New minimal **Core** page (`/inspector/core`): core state, recent core memory, current snapshot,
  recent `core_loop_trace` and `life_event_log`. The full Core tab is Phase 8.

## 10. Testing

### 10.1 Unit and DB tests

Ported core state maths; `appraiseEvent`; world tick (once per day, idempotent on retry, one
global set for any number of users, rollback on failure); every generator branch against core
memory; `parsePersona` (both headings, missing heading, moved bullet); snapshot v0 seeding
(idempotent); assembly order and crisis sections; core retrieval and preoccupation forcing;
no core write-back on reply; `nudgeAffect` and afterglow fade; block-key deferral; `her_day` from
core episodes; migrations (generated self facts and their threads removed, turn-sourced self facts
kept, `deferred_fact` → `deferred_block`).

**Structural (§17.3):** `CoreDeps` has no `db` key (type test); no `CoreLayer` method has a
parameter named `userId`/`user_id` (checked over the interface source); core tables have no
`user_id` column (schema test); the ESLint boundary test covers the new paths.

### 10.2 Fakes

- **Scripted fake** for `life_event` and `reconcile`, configurable per attempt: valid event,
  `duplicate`, `contradicts`, `resolves`, two new entities, high stakes too soon, invalid JSON,
  timeout. Every generator path runs without the API.
- **Echo fake** (canary run): every LLM purpose returns output that contains its full input
  (structured purposes put it in their text fields), so any token that reaches an input is
  carried into whatever that step writes.
- **Recording LLM** wraps both and keeps every `(purpose, system, messages)` call.

### 10.3 Exit run (all fake; `evals/scripts/mind-split-exit.yaml` plus a Vitest exit test)

Two users, A and B, three simulated days, hourly jobs between sessions.

1. **Leak canary:** plant `CANARY-<random>` in A's turns, a fact, an entity and a relationship
   event. Run every core job each day, A's and B's conversations, and a B reach-out, with the
   echo fake. Assert the token is absent from `core_memory`, `core_entity`, `core_state`,
   `core_snapshot`, `world_event`, `life_event_log`, `core_loop_trace`, every core-purpose prompt,
   and every prompt and stored output for user B.
2. **Side channel:** run the same three days twice from the same seed, once with a strongly
   emotional exchange from A (fake extraction at max |valence|) and once without; `core_state`
   rows are identical after every tick. A's `affect_valence` and `afterglow` differ between runs.
3. **Events once:** each day has exactly one set of `world_event` rows and episodes regardless of
   user count; both A's and B's reply prompts can contain the same episode under "From your own
   life".
4. **Snapshot:** every reply prompt contains snapshot v0's content and every companion turn has
   `snapshot_version = 0`.

Definition of done: `pnpm typecheck`, `pnpm lint`, `pnpm test`, the exit run and
`pnpm eval --llm=fake --compare` pass (baseline updated for the retired assertions).

## 11. Paperwork

- **v3 updated:** the tables, columns, jobs, config keys and prompts above (§5, §6, §8, §10.3,
  §10.4, §17.2–17.4, §20 marks Phase 7 built); `core.world.*`/`core.state.*` names; the
  `deferred_block` key.
- **`DECISIONS.md`:** no core recall reinforcement from replies; no per-user threads for her
  events; generated self facts deleted in migration; block key format; `last_event_day` on
  `core_state`; `CoreDeps` without `db`; echo fake for the canary.
- **v3 §25 backlog:** core loops on a separate Postgres role with no grants on user tables
  (before users); mood-congruent recall and goal-biased retrieval (Phase 8); handling a reply's
  "what she told this user" when core contradicts it (§21 #4).
