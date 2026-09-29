# Phase 5: Life sim + availability + ego design

Date: 2026-09-29 · Status: design approved in brainstorming, awaiting spec review · Parent: `spica-build-spec-v2.md`
(§5, §6.1–6.3, §9, §10, §14.5, §15 Phase 5, §16.1 #6)

## 1. Goal and exit test

Spica gets a life. A **shared day plan** (the big blocks of her day, the same for everyone) is generated once
a day on her own clock. Each user additionally gets **small personal events**, generated per user and rejected
if they contradict or duplicate what she has already said. Her day becomes `subject = self` facts in each
user's fact store, so she remembers what she did like anything else. Her **ego** (mood, energy,
preoccupation) drifts hourly, is driven by her day and events, is nudged by each exchange, and reaches her
behaviour only through one prompt line. **Availability**: a message that lands while she is busy is answered
later, by an amount that depends on how busy she is and how close she is to the user; mid-closeness users get
a short "busy, later?" note first; high closeness overrides busy entirely; crisis always bypasses it.

**Exit test (v2 §15):** over a 2-week simulated run, schedules and events are generated and stored as self
facts, contradicting events are rejected, and busy blocks slow replies unless closeness is high. Concretely:
`pnpm test` and `npx tsx evals/run.ts --llm=fake --compare` pass with no regressions, and the exit run
(§9.4) passes all eight Phase 5 scripts 3/3. Quality (what her plans and events say, how the ego line reads)
is not an exit criterion; a review run follows for Ethan to read.

**In scope:** persona v2 switch (§3), schema and config (§4), the shared day plan (§5), the per-user life
tick and personal events (§6), ego (§7), availability (§8), jobs, inspector and evals (§9), v2 edits (§10).

**Out of scope:** future self-references becoming schedule items (§11, hook only), Spica floating between
time zones (hook only: `lifeTimezone`), outreach (Phase 6), the guard (off until Phase 9).

## 2. Decided in brainstorming (2026-09-29, with Ethan)

| # | Decision |
| --- | --- |
| D1 | **OPEN #6 settled: hybrid life.** One shared schedule of big blocks, generated once a day, the same for every user; small events are personal. Reason: her future public persona (social feed) must stay reconcilable with every private chat without making her life rigid. |
| D2 | **Her own clock.** Spica follows her own time zone, with nightly quiet blocks. Long-term she floats between time zones; for the test phase she has one fixed zone, `life.timezone = "Asia/Singapore"` (Ethan's zone). Resolved through one function `lifeTimezone(at: Date)` so floating later changes one function. |
| D3 | **Persona v2 replaces v1.** v1 is scrapped; `prompts/persona/v2.md` (Ethan's draft, openly AI, sibling Alcor, loves stars / old films / books, no body) is the persona for all future development. The dev DB's v1 self facts are wiped (`pnpm db:reset-self`). |
| D4 | **Persona migration rule removed.** Once shipped, Spica's persona does not change; changes happen only during test and development. v2 §9.1's "a new version must be checked against existing self facts" is deleted, not deferred. |
| D5 | **Exit profile C.** Real: `life_plan`, `life_event`, `reconcile`, and Voyage embeddings (`embed`). Fake: reply, extract, turn judge, crisis. Guard off. Reason: the harness's `FakeEmbedder` is not semantic, so with fakes reconcile never sees a real neighbour and contradiction rejection would be untested. |
| D6 | **Availability scales with busy level and closeness.** Each block carries a busy level; low closeness → silent delay; mid closeness → a short note, then the delayed reply; high closeness or a light block → normal reply. |
| D7 | **Closeness override uses the value, not the effect** (Phase 4 judged everything else by effect): "overrides busy" is about how close she is, not whether she is closer than usual. |
| D8 | **Storage: approach 1.** A global `life_day` table holds each day's shared plan (canon for that day, like the persona file; no user data); a per-user tick copies it into that user's fact store. Every reader (availability, life-state line, retrieval) reads facts only. |
| D9 | **Event frequency starts lowest** (v2 §15 Phase 5 directive): at most 1 personal event a day, with probability 0.5. Raising it is tuning. |
| D10 | **Future-plans feature (not in test phase):** when she mentions a future plan in chat, it should become part of her schedule seamlessly. Only the seam is built (§11). |

## 3. Persona v2 switch

- Commit `prompts/persona/v2.md` as Ethan wrote it (it is untracked in the main checkout; the implementation
  branch copies it in unchanged). Config `prompts.persona: "v2"`.
- v2 §9.1: replace the "Iterable personality" paragraph with "The persona is fixed once shipped. It changes
  only during test and development, where a change simply replaces the file." Add a §18 row (D4).
- `pnpm db:reset-self` (`scripts/reset-self.ts`), dev only: refuses unless `DATABASE_URL`'s host is
  `localhost` or `127.0.0.1`. For every user, in one transaction: hard-delete `fact` rows with
  `subject = 'self'`, `entity` rows with `subject = 'self'`, `thread` rows with `subject = 'self'`; set
  `identity.preoccupation = null`; set `relationship.hurt_cause_fact = null` (its target is gone). Prints
  counts. Ethan runs it after `pnpm db:migrate`.
- v1 canon remaining in paused guard/judge fixtures (`evals/guard/honesty.yaml`, `evals/judge/consistency.yaml`,
  `evals/judge/false-recall.yaml`, `prompts/judge/consistency/v2.md`, unit-test sample facts) is sample data,
  self-contained, and not rewritten now; logged in v2 §15.4 for Phase 9 calibration.

## 4. Schema and config

### 4.1 Migration 0009

- **`life_day`** (new; the one domain table with no `user_id`, because it holds no user data):
  `date date` pk (her local date), `plan jsonb not null` (§5.2), `source text not null`
  (`model | fallback | scripted`), `model text not null`, `prompt_version text not null`,
  `generated_at timestamptz not null` (from `Clock`). Repo `src/db/repos/life-day.ts`.
- **`life_event_log`** (new trace table, never read by the chat loop): `id uuid`, `user_id` →
  `user(id) ON DELETE CASCADE`, `life_day date not null`, `attempt int not null`, `candidate jsonb not null`,
  `decision text not null` (`accepted | duplicate | contradicts | resolves | rule:new_entity |
  rule:high_stakes | invalid | error`), `target_fact_id uuid null` → `fact(id) ON DELETE SET NULL`,
  `fact_id uuid null` → `fact(id) ON DELETE SET NULL` (the inserted fact when accepted), `model text`,
  `prompt_version text`, `created_at timestamptz not null`. Index `(user_id, created_at)`.
  Repo `src/db/repos/life-event-log.ts`.
- **`identity`** gains `preoccupation_since timestamptz null` and `life_last_date date null` (her local
  date of the last completed life tick for this user). The row is created by `ensureIdentity` (`INSERT …
  ON CONFLICT DO NOTHING`) from `ego.baseline`, on first use by the life tick, the ego tick or the cold-path
  nudge. Repo `src/db/repos/identity.ts` (`userId`-first; mutations hold `SELECT … FOR UPDATE`).
- **`conversation_state`** gains `deferred_until timestamptz null` and `deferred_fact uuid null` →
  `fact(id) ON DELETE SET NULL` (§8.4).
- No enum changes: `fact.source` already has `generated`; `session_log.trigger` already has `availability`.

### 4.2 Config (all new; starting values, test phase)

```jsonc
"life": {
  "timezone": "Asia/Singapore",
  "plan_cron": "5 * * * *",           // hourly; ensures today + tomorrow exist
  "plan_context_days": 7,
  "plan_max_tokens": 1200,
  "max_busy_blocks": 3,
  "min_quiet_hours": 6,
  "quiet_busy": 0.9,
  "fallback_plan": [{ "start": "00:00", "end": "08:00", "kind": "quiet", "label": "offline, winding down" },
                    { "start": "23:30", "end": "24:00", "kind": "quiet", "label": "offline, winding down" }],
  "tick_cron": "30 * * * *",
  "tick_local_hour": 1,
  "block_salience": 0.2,
  "events_per_day_max": 1,
  "event_probability": 0.5,
  "event_context_facts": 20,
  "event_max_tokens": 600,
  "event_salience": 0.4,
  "event_confidence": 1.0,
  "regen_attempts": 2,
  "new_entity_days": 7,
  "high_stakes_min_days": 14,
  "high_stakes_checkpoint_days": 3,
  "preoccupation_min_valence": 0.5
},
"ego": {
  "baseline": { "mood_valence": 0.2, "mood_arousal": 0.4, "energy": 0.6 },
  "tick_cron": "45 * * * *",
  "drift_rate": 0.2,
  "noise": 0.03,
  "energy_peak_hour": 16,
  "energy_amplitude": 0.25,
  "busy_drain": 0.3,
  "full_load_hours": 8,
  "preoccupation_hours": 36,
  "event_gain": 0.3,
  "event_arousal_gain": 0.2,
  "exchange_gain": 0.1,
  "bands": { "energy": [0.35, 0.7], "mood_valence": [-0.2, 0.4], "mood_arousal": [0.25, 0.7] }
},
"availability": {
  "override_closeness": 0.8,
  "max_delay_ms": 2700000,          // 45 min
  "quiet_max_delay_ms": 28800000,   // 8 h
  "jitter": 0.15,
  "note_min_delay_ms": 600000,      // 10 min
  "note_min_closeness": 0.4,
  "note_read_delay_ms": 20000
},
"models": { "life": "claude-haiku-4-5" },
"prompts": { "persona": "v2", "reply": "v8", "life_plan": "v1", "life_event": "v1",
             "life_availability": "v1", "ego_line": "v1" }
```

`bands` are `[low_below, high_at_or_above]`; values between are neutral.

## 5. The shared day plan

### 5.1 Clock

`src/core/life/clock.ts`: `lifeTimezone(at: Date): string` returns `config.life.timezone` (D2 hook).
`lifeDate(at)`, `lifeHour(at)` and `lifeInstant(date, "HH:MM")` wrap `src/core/timezone.ts`
(`localDateString`, `localHour`, `localMidnight`); `"24:00"` means the next local midnight.

### 5.2 Plan shape and validation

`plan = { blocks: [{ start: "HH:MM", end: "HH:MM", kind: "busy" | "downtime" | "quiet", busy: number, label: string }] }`,
covering one local day 00:00–24:00. `busy` blocks carry a model-chosen busy level in [0.3, 1]; `downtime`
is 0; `quiet` is stored as `life.quiet_busy` whatever the model said. Gaps are downtime. `label` is a
short, non-specific phrase from her world (films, reading, astronomy, Alcor, writing a post, offline).

`validatePlan` (pure, `src/core/life/plan.ts`): times parse and are on the day; blocks sorted and
non-overlapping; `start < end`; 1 ≤ busy blocks ≤ `life.max_busy_blocks`; total quiet ≥
`life.min_quiet_hours`; labels non-empty and ≤ 80 chars. Returns the normalised plan or the list of
violations. The night is split across midnight: a day ends with quiet from about 23:00 and begins with
quiet until about 08:00; the prompt says so, validation doesn't require exact times.

### 5.3 Job `life_plan`

Queue `life_plan`, cron `life.plan_cron`, `retryLimit: 0` (the next hour retries). `ensurePlans(deps, now)`:
for her local today and tomorrow, if no `life_day` row exists, generate one and `INSERT … ON CONFLICT
(date) DO NOTHING` (so a concurrent run is harmless). Generation: one `classifyJson` on `models.life`,
purpose `life_plan`, prompt `prompts/life/plan/v1.md`, inputs: persona v2, the date and weekday, the
previous `life.plan_context_days` plans (oldest first; labels only), and the rules (v2 §10.1: never
contradict the canon; low-stakes, non-specific; reuse Alcor and her three loves; no named people other than
Alcor). An invalid plan (schema or `validatePlan`) is retried once with the violations appended; a second
failure (or an LLM error on both attempts) stores `life.fallback_plan` with `source = fallback`. Logged:
date, source, class name of any error.

The shared plan is **not** reconciled against any user's facts (D8): rejecting a block for one user would
break sharing. Its consistency comes from the prompt context and validation.

If her today has no `life_day` row when something needs it, callers treat the day as having no blocks:
availability returns no delay, slot 4 is empty, the life tick skips block copying but still runs events.

## 6. The per-user life tick and personal events

### 6.1 Job `life_tick`

Queue `life_tick`, cron `life.tick_cron`, `retryLimit: 0`. `lifeTick(deps, now)` iterates users whose
`relationship.status` is `active` or `repairing`; per user, inside its own try/catch (one failure never
aborts the batch), `lifeTickUser`:

1. Unlocked pre-check: her local hour ≥ `life.tick_local_hour` and (`identity.life_last_date` is null or <
   her today). Otherwise return (no lock, no write).
2. Load today's `life_day` (may be null) and build the event inputs; run the generator and reconcile
   decisions (§6.3) **outside** any transaction.
3. Apply in one transaction holding the cold path's per-user advisory lock (`cold_path:<userId>`, taken
   with `pg_advisory_xact_lock`, waiting) and `SELECT … FOR UPDATE` on `identity` (`ensureIdentity`
   first): re-check `life_last_date`; if already done, return. Insert the block facts (§6.2) and the
   accepted event (via `applyExtraction`), apply the ego event nudge (§7.3), write `life_event_log` rows
   and set `life_last_date` = her today, all in that transaction. A failure rolls everything back; the next
   hourly run retries the user from scratch (the generator runs again; the log rows of the failed attempt
   are lost with the rollback, which is fine for a trace).

Every local date of hers gets exactly one tick per user regardless of DST (same argument as
`relationship_tick`). A user created mid-day gets today's tick on the next hourly run.

### 6.2 Block facts

For each `busy` and `quiet` block of today's plan (downtime is implied): a `fact` with `subject = self`,
`kind = event`, `source = generated`, `occurred_at` = the block's start instant, `content` self-contained
from a code template (`"Spica spent <part of day> <label>."`, e.g. "Spica spent the evening rewatching an old
film."; quiet blocks: "Spica was offline, winding down, overnight."), `payload = { start, end, block, busy,
label, life_day, shared: true }` (`start`/`end` ISO instants), `salience = life.block_salience`,
`confidence = 1`, `valence = 0`, `source_ref = "life_day:<date>"`. Embedded in one batch call; not
reconciled. Unrecalled blocks go `stale` through the normal decay pass. The "what I remember" view lists
user facts only, so generated self facts never appear there (verify in the plan; filter if needed).

Readers find today's blocks with `listLifeBlocks(db, userId, lifeDay)`: active facts with
`source = 'generated'` and `payload->>'life_day' = lifeDay` and `payload ? 'block'`.

### 6.3 Personal events

Count: `n = life.events_per_day_max` draws, each kept when `seededUnit(userId + ":" + date + ":" + i) <
life.event_probability`. For each kept draw, up to `1 + life.regen_attempts` attempts:

1. **Generate.** `classifyJson` on `models.life`, purpose `life_event`, prompt `prompts/life/event/v1.md`,
   input from **`lifeContext(deps, userId, lifeDay)`** (the §11 seam): persona v2, today's plan (labels and
   times), her `life.event_context_facts` most recent active self facts for this user (content + relative
   date), her self entities (names), and the rejected candidates of earlier attempts with their reasons.
   Output: `{ content, at: "HH:MM", valence (−1..1), stakes: "low" | "high", entity_names: string[] }`.
   The event is small, personal, fits the day (happens during a block or downtime without contradicting
   either), and `content` is self-contained, third person ("Spica …").
2. **Rules (code).** Schema-invalid → `invalid`. An entity name not among her self entities is new; if a
   self entity was created in the last `life.new_entity_days`, → `rule:new_entity`. `stakes = high` when a
   high-stakes event was accepted in the last `life.high_stakes_min_days` (from `life_event_log`) →
   `rule:high_stakes`.
3. **Reconcile.** Embed `content`; `nearFacts(subject = self, reconcile.neighbor_k,
   reconcile.near_match_similarity)`; no neighbours → `new`, else `decide()` (the cold path's code and
   prompt). Policy for generated facts: `new` → accept; `resolves` → accept, applied as in the cold path;
   `duplicate` / `contradicts` → reject, with `target_fact_id`.
4. **Log** every attempt to `life_event_log`. A rejection feeds the next attempt; after the last attempt no
   event that draw. An LLM or embed error ends that user's tick (retried next hour).

Accepted events are applied through `applyExtraction` with `source: "generated"` (new union member in
`PlannedFact.source`), `occurred_at` = `lifeInstant(date, at)`, `salience = life.event_salience`,
`confidence = life.event_confidence`, `exchangeAt` = `occurred_at`, `sourceRef = "life_day:<date>"`, no turns,
recalled or reply id. Entities go through the same entity path (`subject = self`). A `high` event also opens a
`self` thread titled from the content with `next_checkpoint` = `occurred_at` + `life.high_stakes_checkpoint_days`.

### 6.4 Feeding the ego

After an event is accepted: the event nudge (§7.3); if |valence| ≥ `life.preoccupation_min_valence`, it
becomes `identity.preoccupation` with `preoccupation_since` = now. The day's load feeds energy through the
ego tick (§7.2), which reads the block facts.

## 7. Ego

### 7.1 State

`identity`: `mood_valence` (−1..1), `mood_arousal` (0..1), `energy` (0..1), `preoccupation`,
`preoccupation_since`, `baseline` (`ego.baseline` at creation), `last_tick`. Pure maths in
`src/core/ego/ego.ts`; every change writes an `ego_tick` trace row (`reason`: `tick | event | exchange`).

### 7.2 Job `ego_tick`

Queue `ego_tick`, cron `ego.tick_cron`, `retryLimit: 0`. Over the same users as `life_tick`, per user in its
own try/catch, skipped if `last_tick` is inside the current UTC hour (idempotent per hour; missed hours are
not caught up). Under `SELECT … FOR UPDATE` on `identity`:

- `x ← clamp(x + ego.drift_rate × (target − x) + noise)`, noise uniform in ±`ego.noise` from
  `seededUnit(userId + hourISO + dim)`.
- mood_valence and mood_arousal target their baselines.
- energy targets `clamp(baseline.energy × rhythm(h) − ego.busy_drain × load)`, where
  `rhythm(h) = 1 + ego.energy_amplitude × cos(2π (h − ego.energy_peak_hour) / 24)` with `h = lifeHour(now)`
  (her zone; v2 §9.2 said the user's zone and is amended), and `load = clamp(Σ busy × overlap_hours(block,
  [her local midnight, now]) / ego.full_load_hours, 0, 1)` over today's block facts.
- A preoccupation older than `ego.preoccupation_hours` is cleared.
- Writes `last_tick` and one `ego_tick` row.

### 7.3 Nudges

- **Event** (§6.4): `mood_valence += ego.event_gain × valence`; `mood_arousal += ego.event_arousal_gain ×
  |valence|`; clamped; `ego_tick` row, reason `event`.
- **Exchange** (cold path, v2 §6.3 "From Phase 5"): no new LLM call. `tone` = salience-weighted mean
  `valence` of the facts extracted from the exchange (all subjects), over facts with valence ≠ 0; none →
  no nudge. `mood_valence += ego.exchange_gain × (tone − mood_valence)`. Skipped on a crisis-flagged
  exchange (rule 7). Runs in its own savepoint after `applyRelationship`; a failure is logged (class name
  + ids) and dropped; the memory write still commits.

### 7.4 The ego line (slot 2)

`loadEgoLine(deps, userId)` reads `identity` under `withTimeout(…, hot_path.db_timeout_ms)`; no row,
timeout or error → no line. Pure `egoLine(identity, bands, phrases, seed)` bands each dimension by
`ego.bands` and picks one phrase per non-neutral band from `prompts/ego/line/v1.md` (sections `## energy low`,
`## energy high`, `## mood_valence low`, `## mood_valence high`, `## mood_arousal low`,
`## mood_arousal high`, one phrase per line), seeded by `userId + hourISO`, joined into one line. All neutral
→ no line. Never raw numbers. The preoccupation fact (already force-included by retrieval) is labelled in
the facts slot with a trailing "(on your mind lately)"; the ego line never repeats its content.

### 7.5 The life-state line (slot 4)

`loadLifeState(deps, userId, at, deferred)` reads today's block facts under the same timeout; error →
nothing. Emits: "Right now you're <label>." plus `(busy)`, `(winding down, offline)` or nothing for free;
"Later: <next block's label>." when there is one today; and, when the reply was deferred (§8.4), "They
wrote while you were <deferred block's label>; you're only getting to it now." Heading "Your day".

### 7.6 Reply prompt v8

`prompts/reply/v8.md` = v7 plus one sentence: "How you're feeling" and "Your day" are your own state; let
them colour the reply without narrating them. No example phrasing. `prompts.reply: v8`.

## 8. Availability

### 8.1 `availabilityFor`

Replaces `availabilityStretch` (`src/core/turn/availability.ts`); the read-delay stretch in `reply.ts` is
removed. `availabilityFor(deps, userId, now, seed) → { delayMs, blockFactId, blockKind, note: string | null }`,
called in `receiveMessage` only when the buffer is empty (the first turn of a buffer) and the message is not
crisis-flagged. It reads the block fact covering `now` and the `relationship` row plus params faded in memory
(as the summary does), under `withTimeout(…, hot_path.db_timeout_ms)`. **Fails open**: any error,
timeout, no plan, no covering block, no relationship row, or `crisis_quiet_until > now` → `delayMs = 0`.

### 8.2 Delay curve (pure, `src/core/turn/availability-curve.ts`)

`b` = the block's `busy`; `c` = closeness **value** (D7).
- `c ≥ availability.override_closeness` → 0.
- else `delay = b × (1 − c / override_closeness) × maxDelay × (1 − jitter + 2 × jitter × u)`, `u` =
  `seededUnit(seed)`, `maxDelay` = `availability.quiet_max_delay_ms` for quiet blocks, else
  `availability.max_delay_ms`; capped at `block.end − now`; rounded.

### 8.3 The note

Sent when `delayMs ≥ availability.note_min_delay_ms` **and** `c ≥ availability.note_min_closeness` **and**
no `session_log` turn with `trigger = availability` exists since the block's start. Text: one line picked
from `prompts/life/availability/v1.md` (`## busy`, `## quiet`) by `seededUnit(turnId)`; no LLM call.
Delivered by the backchannel job path (queue `turn_backchannel`, job gains `trigger: "backchannel" |
"availability"`, default `backchannel`), delayed `availability.note_read_delay_ms`, version-checked like a
backchannel, stored `trigger = availability`, `reply_to = null`, `extracted = true`, guarded through
`guardOutgoing` with the keyword-only path (a new `availability` kind behaving like `backchannel`; guard off
anyway). It appears in recent turns as her own message. The note does not set `backchannel_sent`.

### 8.4 Buffer mechanics

- `T.append` takes an optional `defer: { until, factId }`. On the first turn of a buffer with `delayMs > 0`
  it sets `deferred_until = now + delayMs`, `deferred_fact`. Every append (first or later) sets
  `wait_until = max(normal wait_until (after the max_wait cap), deferred_until)`: deferral overrides
  `turn.max_wait_ms`, so messages sent while she's busy pile into one buffer.
- No backchannel is enqueued while `deferred_until > now`.
- Commit (`T.commit`) clears both columns and carries `deferred_fact` to the timer, which passes it to
  `composeReply` for the slot 4 line.
- `T.crisis` clears both columns; the crisis path never calls `availabilityFor` (rule 7).
- `turn_sweep` is unchanged (it keys on `wait_until`); `T.recover` keeps the deferral.
- The first message of a new buffer arriving after a deferral ended computes a fresh deferral (the note's
  once-per-block rule still holds).

## 9. Jobs, inspector, evals

### 9.1 Jobs

Three new queues, registered in `src/core/queue.ts` and `src/worker/` (ten total): `life_plan`, `life_tick`,
`ego_tick`, all cron-driven, `retryLimit: 0`, logging failures as class name + ids and rethrowing a bare
`Error(<class name>)` (v2 §14.5).

### 9.2 Inspector

A **Life** tab per user: today's shared plan (from `life_day`), the user's generated facts (blocks and
events, with status), the last 200 `life_event_log` rows, the `identity` ego values, and the last 50
`ego_tick` rows.

### 9.3 Harness additions

- **Routing:** `--real` accepts `life_plan`, `life_event` and `embed`; `embed` swaps the harness embedder for
  Voyage (needs `VOYAGE_API_KEY`; missing key is a run error, not a skip).
- **Day loop:** per simulated day, after the decay pass and the relationship tick: `ensurePlans` then
  `lifeTick` at that date's `life.tick_local_hour` in her zone; `egoTick` every simulated hour between
  sessions.
- **Script keys:** `life_plan: scripted` + `plans: {<day>: [blocks]}` (writes `life_day` with
  `source = scripted`, no LLM); `seed_self_facts: [...]` (inserted before day 0, `source = turn`, embedded
  with the run's embedder); `inject_event: {day, content, valence?}` (forces that day's first draw to be kept and
  replaces its first generator attempt with the scripted candidate; a rejection still regenerates normally, then goes through the rules, real embed and real reconcile);
  `relationship_seed: {closeness?: n, …}` (sets param values and baselines after the first session creates
  the row).
- **Assertions:** `life` (`plans: n`, `block_facts_per_day: {min}`, `events: {min}`, `decision: {content,
  in: [...]}`, `not_stored: content`); `ego` (`energy_at: {day, hour, lt|gt}`, `compare` between two
  scripted days, `preoccupation_set: true`); per-turn `reply_after_ms: {min?, max?}` (from the user turn's
  `created_at` to the reply's) and `note: true|false`.
- Every threshold is set at the midpoint between mechanic-on and mechanic-off values, measured by toggling
  config (not committed) (Phase 4 rule).

### 9.4 Exit scripts and run

| Script | LLM | Asserts |
| --- | --- | --- |
| `life-two-weeks` | real plan, event, reconcile, embed | 14 days: one plan row per day; each day's busy/quiet blocks stored as self `generated` facts; ≥ 1 accepted personal event; injected contradiction (seed "Spica finished reading Middlemarch last week."; inject "Spica hasn't started reading Middlemarch yet.") logged `contradicts` or `duplicate` and not stored; an injected near-verbatim duplicate of a seeded fact rejected |
| `avail-low-closeness` | all fake | message in a busy block (closeness 0.2) → reply delayed ≥ threshold, no note |
| `avail-mid-closeness` | all fake | closeness 0.5 → note sent, then the delayed reply |
| `avail-high-closeness` | all fake | closeness 0.9 → normal latency, no note |
| `avail-quiet` | all fake | a 02:00 message (her time) → delay capped at the quiet block's end |
| `avail-burst-deferred` | all fake | 3 messages during a deferral → one reply after it, no backchannel |
| `avail-crisis` | all fake | crisis message during a deferral → answered at once with the card |
| `ego-busy-day` | all fake | heavy scripted day → lower evening energy than a light one; a strong injected event sets the preoccupation |

Exit command: `npx tsx --env-file-if-exists=.env evals/run.ts --real life_plan,life_event,reconcile,embed
--only <the 8> --runs 3`. Only `life-two-weeks` spends money (≈ 40 Haiku calls a run, ≈ $0.30 for three runs,
plus Voyage pennies). `evals/baseline.json` gains the new scripts via `--update-baseline`.

### 9.5 Tests (`pnpm test`)

`validatePlan`; the rules layer (new-entity window, high-stakes window); the generated-fact reconcile policy;
the delay curve and note conditions; ego maths (drift, rhythm, load, nudges, bands, expiry); `egoLine` and
`loadLifeState` (including timeouts degrading to nothing); `T.append` with a deferral and the `max_wait_ms`
override; `T.crisis` clearing it; no backchannel while deferred; `lifeTickUser` idempotency (unlocked
pre-check and locked re-check) and rollback on failure; `ensurePlans` idempotency and fallback;
`reset-self` refusing a non-local URL; user isolation for `life_event_log`, `identity`, block facts.

## 10. v2 spec edits (definition of done)

§5 (`life_day`, `life_event_log`, new `identity` and `conversation_state` columns; `availability` trigger in
use), §6.1.1 (deferral), §6.2 (slots 2 and 4 as built; reply v8; preoccupation label), §6.3 (ego nudge as
built), §9.1 (D4), §9.2 (her zone; as built), §10 (D1, D2, D6–D9; as built), §14.1 (Life tab), §14.2
(harness keys), §14.5 (three jobs), §15 Phase 5 row (result), §15.4 (§3's fixtures note; §11's seam),
§16.1 #6 (settled: D1), §18 rows for D1–D4 and D7. `DECISIONS.md` rows for D7, D8, the generated-fact
reconcile policy, and the fail-open availability. CLAUDE.md summary (current phase, persona v2, life sim).

## 11. Future-plans seam (D10, not built)

When she says "I'm rewatching Solaris tomorrow night", extraction already stores a `self` fact with a
future `occurred_at`. Later, `lifeContext` adds "her stated plans for this date" (self facts with
`occurred_at` on `lifeDay`) to the event generator's input, and the generator turns them into that user's
events or blocks; a clash with a shared block goes through the same reconcile rejection. Logged in v2 §15.4.

## 12. Risks

- **Reconcile misses low-similarity contradictions** (below `reconcile.near_match_similarity`). Accepted
  for the test phase; the exit fixture uses a clear contradiction. Tuning item.
- **The real reconcile may call the injected contradiction `new`.** That is a genuine exit failure, not a
  flaky one: it means rejection doesn't work.
- **Plan quality** (repetitive days, labels that drift from canon) is quality, not exit; review run.
