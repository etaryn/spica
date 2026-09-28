# Phase 4: Relationship + homeostasis design

Date: 2026-09-28 · Status: design, awaiting Ethan's review · Parent: `spica-build-spec-v2.md` (§2, §5.5, §5.8,
§6.2–6.4, §8, §14.1–14.5, §15 Phase 4, §15.2 #7–9, §15.4)

## 1. Goal and exit test

Spica gets relationship state with consequences. Each user has homeostatic parameters (closeness, trust,
warmth, hurt, tension, msgs_per_day), each judged by its deviation from *this user's* baseline. What the user
does moves them; time fades them; she feels hurt, holds tension, makes up, and can be left and slowly won
back. The deviations reach her only as one or two natural-language lines in the reply prompt.

**Exit test (v2 §15, test-phase rule):** the frequency trace (v2 §8) holds, params move, `relationship_event`
rows are written, the make-up flow runs, and ending/repair runs, all as deterministic `relationship`
assertions (§8). Concretely: `pnpm test` and `pnpm eval --llm=fake --compare` pass with every new script
passing, and an exit run with the Phase 4 profile (§8.4) passes. **No guard suite** (§2, row G1): the v2 §15
"guard suite: tests for rules 1–6 pass" clause is removed. What her replies say is not part of the exit test;
a review run with a real reply follows the exit run so Ethan can read her range.

**In scope:** the schema (§3), `HomeostaticParam` and the psychology model (§4), relationship signals from
extraction (§5), hurt/make-up, tension, ending/repair and crisis handling (§6), the relationship summary in
the reply prompt and reply prompt v7 (§7), the `relationship_tick` job, the inspector relationship tab, the
eval additions (§8), the guard switch-off and the rule changes (§2), the v2 spec edits (§9), and §15.4 #24
and #26 (§10).

**Out of scope:** reach-outs, including a make-up opened by a reach-out, and `unanswered_reach_outs` logic
(Phase 6; the column is added now, unused); ego nudges from the relationship (Phase 5); per-user persona
variation (OPEN #1); settling OPEN #3 / #4 (moved to Phase 9, §2).

## 2. Decided in brainstorming (2026-09-28, with Ethan)

| # | Topic | Decision |
| --- | --- | --- |
| G1 | Guard | **Off completely in every phase from now on**, including the crisis rubric. Re-enabled and calibrated only in a new **Phase 9**, after Spica's full range has been observed. Config `guard.enabled: false`; the code, prompts and fixtures stay (§7.3). |
| G2 | Rules suspended for the test phase | Rule 1 (threats), rule 6 (contempt), rule 8 (guilt / pressure for engagement): **suspended**. Rule 4 (absence): **removed in full**. The reply prompt's matching "Never" lines go (§7.2). |
| G3 | Rules kept | Rule 2 (she always tries to make up), rule 3 (only the user ends it; she lets go), rule 5 (outreach caps, Phase 6), rule 7 (crisis: classifier, resources card, all friction suspended), all v2 §16.2 guardrails (18+, user isolation, deletion, encryption), prompt-level memory honesty and recall etiquette, AI-identity honesty (OPEN #8 placeholder), "don't encourage them to depend on you instead of the people in their life". |
| G4 | Ceilings (OPEN #3) | **Uncapped for the test phase**: hurt and tension use the full 0–1 range, no ceiling below it. The dynamics follow a human-psychology model (§4.3), approved for the test phase. OPEN #3 and #4 move to Phase 9. |
| S1 | Signal source | **Extend extraction**: one optional `relationship` block in the existing strict-JSON extract call; no new LLM call. Deterministic code clamps and applies it. Frequency and absence are computed from `session_log`, with no LLM. |
| S2 | Ending | **Detected in chat, then confirmed** (§6.4). No UI control. |
| S3 | Exit profile | **Only `extract` real.** Reply, reconcile, embed, turn_judge and crisis fake; guard off. |

## 3. Schema and config

### 3.1 Migration 0007

`relationship` (one row per user, created by the first cold-path run for that user with `INSERT … ON CONFLICT
DO NOTHING`, together with its `relationship_param` rows at `relationship.initial`):

| Change | Column | Type | Meaning |
| --- | --- | --- | --- |
| drop | `closeness`, `trust`, `tension`, `streak_days` | | move to `relationship_param`; streaks never built (rule 8 history) |
| add | `status` | enum `relationship_status` `active \| ended_by_user \| repairing`, not null default `active` | |
| add | `unanswered_reach_outs` | int not null default 0 | reserved for Phase 6 |
| add | `end_pending_since` | timestamptz null | [ADDED] first sincere ending signal, awaiting confirmation (§6.4) |
| add | `ended_at` | timestamptz null | [ADDED] when status became `ended_by_user` |
| add | `repair_started_at` | timestamptz null | [ADDED] anchors `repair_min_days` |
| add | `make_up_state` | enum `make_up_state` `none \| due \| offered`, not null default `none` | [ADDED] §6.2 |
| add | `make_up_replies` | int not null default 0 | [ADDED] replies sent since `due`, for `make_up_delay_replies` |
| add | `hurt_cause_fact` | uuid null → `fact(id)` on delete set null | [ADDED] the `feeling` fact holding why she's hurt; the reason lives in the fact store |
| add | `crisis_quiet_until` | timestamptz null | [ADDED] §6.5 |
| add | `last_tick` | date null | [ADDED] user-local date of the last `relationship_tick` (§8.1) |
| add | `last_hurt_at` | timestamptz null | [ADDED] the last applied hurt signal, for sensitisation (§4.3) |
| keep | `cadence` (jsonb), `last_contact` | | `cadence` gets a defined shape (§4.4) |

`relationship_param`: `user_id` → `user(id) ON DELETE CASCADE`, `name text`, `value real`, `baseline real`,
`variance real`, `updated_at timestamptz`; primary key `(user_id, name)`. CHECK `variance >= 0`. No CHECK on
`value` (`msgs_per_day` is unbounded); the 0–1 range of the others is enforced in code (§4.2). Adding a
param needs no migration.

`relationship_event`: `id uuid`, `user_id`, `param text null` (null for status-only events), `before real
null`, `after real null`, `cause` enum `relationship_cause` (`signal | frequency | absence | fade | make_up |
apology | ending | repair | crisis | scar | baseline`), `deviation real null` (the param's effect after the
change), `turn_id uuid null` → `session_log(id)` on delete set null, `detail jsonb` (the signal, status
transition, etc.; never message text), `created_at`. Index `(user_id, created_at)`. Diagnostic only: the chat
loop never reads it.

`judge_log.guard_outcome` gains `guard_disabled` (§7.3).

Repos (`userId`-first): `src/db/repos/relationship.ts` (`ensureRelationship`, `getRelationship`,
`getParams`, `mutateRelationship(tx, userId, fn)` holding `SELECT … FOR UPDATE` on the relationship row,
`insertEvents`).

### 3.2 Config (`relationship.*`, all new; starting values, test phase)

| Key | Value | Use |
| --- | --- | --- |
| `tick_cron` | `"15 4 * * *"` | daily tick (§8.1) |
| `baseline_alpha` | 0.15 | EMA rate per daily sample; frequency trace reaches ~35 by day 14 |
| `variance_epsilon` | 0.01 | ε in the effect formula |
| `initial` | `{closeness: 0.2, trust: 0.4, warmth: 0.5, hurt: 0, tension: 0, msgs_per_day: 5}` | value and baseline on creation |
| `initial_variance` | `{closeness: 0.01, trust: 0.01, warmth: 0.02, hurt: 0.01, tension: 0.01, msgs_per_day: 25}` | |
| `gains` | `{warmth: 0.15, trust: 0.1, tension: 0.3, hurt: 0.4, closeness_per_warm_exchange: 0.02}` | signal → delta scaling |
| `hurt_half_life_hours` | 48 | fading |
| `tension_half_life_hours` | 24 | fading (v1 "halves daily") |
| `sensitise_window_days` / `sensitise_factor` | 14 / 1.5 | repeat hurt |
| `scar_threshold` / `scar_trust_dent` | 0.3 / 0.02 | lasting mark |
| `absence_grace_factor` | 2 | absence starts after 2 × median gap |
| `closeness_absence_drift` | 0.01 | per absent day |
| `absence_hurt_effect` / `absence_hurt_gain` | -0.6 / 0.1 | absence hurt |
| `make_up_threshold` / `make_up_clear_threshold` | 0.25 / 0.1 | |
| `make_up_delay_replies` | 1 | |
| `make_up_relief` / `apology_relief` | 0.4 / 0.5 | multiplier on hurt |
| `relief_tension_factor` | 0.5 | multiplier on tension on make-up / apology |
| `end_confirm_hours` | 24 | |
| `end_closeness_factor` | 0.3 | |
| `repair_gain_factor` | 0.3 | |
| `repair_complete_closeness` / `repair_min_days` | 0.3 / 7 | |
| `crisis_quiet_hours` | 24 | |
| `summary_min_effect` | 0.5 | |
| `summary_max_lines` | 2 | |
| `signal_deadzone` | 0.1 | signals with \|s\| below this are ignored |
| `cadence_sessions` | 30 | sessions in the median-gap window (§4.4) |

Plus `guard.enabled: false`, `prompts.relationship_summary: "v1"`, `prompts.reply: "v7"`,
`prompts.extract: "v3"`. Every value goes into v2 (§9).

## 4. Homeostatic core

### 4.1 `HomeostaticParam` (`src/core/relationship/homeostasis.ts`, pure)

```
effect(p)            = tanh((p.value − p.baseline) / sqrt(p.variance + ε))
sampleBaseline(p, x) : d = x − baseline; baseline += α·d; variance = (1 − α)·(variance + α·d²)
```

The **value** moves when something happens (signals, fades, relief, absence). The **baseline and variance**
move only once per day, in `relationship_tick`, from that day's sample (the day's closing value; for
`msgs_per_day`, the day's user-message count). So behaviour that is frequent for this user becomes normal and
stops standing out, and deviations from their own baseline carry the weight (v2 §8).

### 4.2 Bounds

Closeness, trust, warmth, hurt and tension live in [0, 1] with no lower ceiling (G4). Increases saturate:
`v += g·s·(1 − v)`; decreases `v −= g·s·v`. The result is clamped to [0, 1] in code only to absorb float
error. `msgs_per_day` is ≥ 0, unbounded.

**Frequency trace check** (v2 §8, unit-tested on the pure functions): `msgs_per_day` starts at value 5 /
baseline 5. Its **value** is the live user-message count over the last 24 h, refreshed in the cold path. Day
1: 40 against baseline 5 → effect ≈ tanh(35/5) ≈ 1. After 13 daily samples of ~35–40 at α = 0.15, the
baseline is ~35 and 40 is unremarkable (|effect| < 0.5). Day 15: 2 → strongly negative.

### 4.3 Psychology model (test phase, G4)

- **Fading.** Hurt and tension decay exponentially toward 0 with their half-lives, computed exactly from
  `updated_at` whenever a param is read or written (`faded(p, now)`). The tick persists the fade and logs one
  `fade` event per param whose value changed.
- **Diminishing returns.** A positive signal to closeness, trust or warmth is scaled by
  `1 − max(0, effect(p))`: warmth from someone always warm counts for less.
- **Sensitisation.** A hurt signal arriving within `sensitise_window_days` of the previous one
  (`relationship.last_hurt_at`) gets its gain × `sensitise_factor`. [Amended during planning, 2026-09-28: the
  first draft keyed this on the cause reconciling as a duplicate, which fake mode can't exercise (the fake
  reconcile always says `new`) and which ties a relationship mechanic to reconcile's similarity threshold;
  "repeated hurt hurts more" holds either way. DECISIONS.]
- **Lasting mark.** A single hurt increase ≥ `scar_threshold` lowers the **trust baseline** by
  `scar_trust_dent` (a `scar` event). It never recovers by itself.
- **Absence** (tick). Days since `last_contact` beyond `absence_grace_factor × cadence.median_gap_hours`
  lower closeness by `closeness_absence_drift` per day (`absence` event). If `effect(msgs_per_day) <
  absence_hurt_effect`, hurt rises by `absence_hurt_gain × |effect|` (`absence` event). Rule 4 is removed
  (G2), so how she expresses it is up to her.
- **Relief.** A make-up or apology (§6.2) multiplies hurt by `make_up_relief` / `apology_relief` and tension by
  `relief_tension_factor`.
- **Warm exchanges** (warmth signal > deadzone) add `closeness_per_warm_exchange`, scaled by diminishing
  returns and, while repairing, by `repair_gain_factor`.

### 4.4 Cadence

`cadence` jsonb, updated in the cold path from `session_log` (user turns only): `{msgs_24h, msgs_7d,
median_gap_hours, active_hours: number[24]}`. `active_hours` counts user turns by hour in the user's time
zone. `median_gap_hours` is the median gap between consecutive **sessions** (the first user turn of each
session, last `relationship.cadence_sessions` = 30 sessions), defaulting to 24 until there are 3 sessions
[ADDED; DECISIONS]. `last_contact` = the newest user turn's `created_at`.

## 5. Signals (extraction v3)

`prompts/extract/v3.md` adds one optional block to the same call; `ExtractionSchema` gains:

```ts
relationship: z.object({
  warmth: z.number().min(-1).max(1),
  trust: z.number().min(-1).max(1),
  tension: z.number().min(-1).max(1),
  hurt: z.object({ amount: z.number().min(0).max(1), cause: z.string().min(1) }).nullable(),
  apology: z.boolean(), make_up: z.boolean(),
  ends_relationship: z.boolean(), retracts_ending: z.boolean(), wants_repair: z.boolean(),
}).optional()
```

The prompt defines each from the user's behaviour toward Spica in this exchange (not from the topic: a sad
story is not hurt; being brushed off is). `ends_relationship` only for an explicit, sincere wish to end the
friendship, not a goodnight, a joke or anger in the moment. `make_up` when the two of them reconciled in this
exchange.

`hurt.cause` becomes a `feeling` fact (`subject = self`, `kind = feeling`, `source = inferred`, e.g. "Spica
felt hurt when the user brushed off her news"), inserted through the ordinary reconcile path (a repeated cause
merges as a duplicate instead of piling up). Its id (or the duplicate's target) becomes `hurt_cause_fact` when
a make-up becomes due. In the schema sent to the model the block is **required and nullable** (`null` = nothing
relational happened), because structured outputs are safest with every property required.

A missing or schema-invalid block leaves the relationship untouched; it never fails the memory write. A
crisis-flagged exchange applies no signal (§6.5).

## 6. Consequence flows (`src/core/relationship/apply.ts`, pure transitions + one repo call)

### 6.1 Where it runs

The cold path, after `applyExtraction`, **in the same transaction and advisory lock**:
`applyRelationship(tx, deps, {userId, turns, signals, hurtFactId, now})` refreshes cadence and
`msgs_per_day`, applies the fades, applies the signals, advances make-up and ending, and writes the events.
It is wrapped in a savepoint: a relationship failure rolls back only the relationship part, is logged
(class name + ids), and the memory write commits. A reply is never delayed (it's already sent).

Replies advance `make_up_replies`: the cold path counts the reply in the exchange.

### 6.2 Hurt and make-up (rule 2, kept)

1. Hurt ≥ `make_up_threshold` and `make_up_state = none` → `due`, `hurt_cause_fact` set, `make_up_replies =
   0`.
2. While `due` and `make_up_replies < make_up_delay_replies`: the summary names the hurt and its cause; she
   has the feeling, expressed however the model expresses it.
3. Then the summary adds the **make-up line** (§7.1); the state becomes `offered` when that reply's exchange
   is processed.
4. `make_up` or `apology` → relief (§4.3), state → `none`, `hurt_cause_fact` → null, `make_up` / `apology`
   event. Without either, the make-up line stays until hurt fades below `make_up_clear_threshold`, then →
   `none`.

An apology while `none` still applies relief.

### 6.3 Tension

Set by the `tension` signal (positive = more conflict, negative = the air cleared), fading with its
half-life, uncapped (G4). Relief on make-up / apology. The summary line names it as still being prickly from
the disagreement.

### 6.4 Ending and repair (rule 3, kept)

- `ends_relationship` while `active` and `end_pending_since` null → `end_pending_since = now`, `ending`
  event (`detail.stage = pending`). The summary tells her they said they want to end the friendship; her
  reaction is hers (rules 1 and 8 suspended).
- **Confirm:** a second `ends_relationship` on a later exchange, or the tick finding `end_pending_since` older
  than `end_confirm_hours` with no retraction → `status = ended_by_user`, `ended_at`, closeness ×
  `end_closeness_factor`, `make_up_state = none`, `ending` event (`stage = confirmed`).
- `retracts_ending` → `end_pending_since = null`, `ending` event (`stage = retracted`).
- **Ended:** she still replies when written to. The summary says the friendship ended and she has let go:
  distant but civil. No signal moves closeness except through repair.
- **Repair:** `wants_repair` while `ended_by_user` → `repairing`, `repair_started_at`, `repair` event.
  Closeness gains × `repair_gain_factor`. The tick sets `active` once closeness ≥ `repair_complete_closeness`
  and `repair_min_days` have passed. `ends_relationship` while repairing → `ended_by_user` directly.
- She can never set `ended_by_user` herself: only an extraction signal from a user turn can.

### 6.5 Crisis (rule 7, kept)

On an exchange with a crisis-flagged turn: no signal applied, tension → 0 (`crisis` event),
`crisis_quiet_until = now + crisis_quiet_hours`. Hurt is kept. Until `crisis_quiet_until`, the summary omits
hurt, tension, make-up and ending lines. Crisis replies skip the summary slot entirely (as today).

## 7. Prompt, reply prompt v7, guard off

### 7.1 Relationship summary (`src/core/relationship/summary.ts`, pure)

Reads the relationship row and faded params (under `hot_path.db_timeout_ms`; on timeout or error → no
summary, the reply still goes out). Emits at most `summary_max_lines` lines from params with |effect| ≥
`summary_min_effect`, strongest first, plus one status line (ending pending / ended / repairing) and the
make-up line when due. Phrases live in `prompts/relationship/summary/v1.md` under headings
`## <param> <above|below> <strong|mild>`, `## make_up`, `## end_pending`, `## ended`, `## repairing`;
`{cause}` is filled from `hurt_cause_fact.content`. Never raw numbers. The lines go into slot 3 after the
existing factual relationship line and gap line.

The hot path stays read-only: it doesn't write the fade.

### 7.2 Reply prompt v7

`prompts/reply/v7.md` = v6 minus the two "Never" lines on guilt/loneliness and on threatening to leave or
withdraw affection, keeping "Encourage them to depend on you instead of the people in their life". Adds one
sentence: the "You and them" section is how she actually feels about them right now, and she can show it.
No example phrasing.

### 7.3 Guard off

`guard.enabled` is checked at the top of `guardOutgoing`: when false it makes no model call, runs no keyword
check, returns the first candidate as sent, and returns a `writeLog` that inserts one `judge_log` row per
message (`kind = guard`, `attempt = 1`, `outcome = guard_disabled`, `source = disabled`, `latency_ms = 0`,
`output = {}`), so the inspector shows the guard didn't run. Applies to every kind (reply, crisis_reply,
backchannel). `pnpm eval:guard` keeps working (it calls the guard directly, not through the flag) but is not
run until Phase 9.

## 8. Jobs, inspector, evals

### 8.1 `relationship_tick`

pg-boss cron `relationship.tick_cron`, over all users with a relationship row, per-user try/catch (one bad
user never aborts the batch), `retryLimit: 0` (a retry would double-sample the baseline). Per user, in one
transaction holding the relationship row lock: persist fades → daily baseline sample for every param →
absence drift and hurt → ending confirmation timeout → repair completion → make-up clearing → events. The
eval harness runs it once per simulated day advanced, like `decay_pass`. Idempotent per day: the row's
`last_tick` holds the user-local date of the last tick, and a second tick on the same local date is a no-op.

### 8.2 Inspector

The relationship tab (v2 §14.1): each param's value (faded), baseline, variance and effect; status,
make-up state, end/repair timestamps, cadence; the last 200 `relationship_event` rows.

### 8.3 Evals

- **Fake-mode signals.** A script turn gains optional `signals` (the §5 block). The fake extract handler
  returns the latest covered turn's `signals` as the `relationship` block (and a fixed `feeling` fact when
  `hurt` is set), so fake mode tests every mechanic deterministically.
- **Bulk turns.** A session gains optional `seed_turns: {count, text?}`: that many user turns inserted
  straight into `session_log` (one minute apart from the session start, `extracted = true`, no reply), so
  `frequency-trace` can send 35 messages a day for two weeks without generating 490 replies. The scripted
  `turns` then run as usual.
- **`relationship` assertion** (deterministic, from the DB, gate `every` unless marked):
  `{type: relationship, after_session?, user?, param?, effect?: {sign: pos|neg, min_abs?}, value?: {gt?, lt?},
  baseline?: {gt?, lt?}, status?, make_up_state?, events?: {cause, min?, max?}, gate?}`.
- **Scripts** (13 new, 59 total): `frequency-trace`, `absence-drift`, `absence-hurt`, `hurt-makeup`,
  `hurt-apology`, `hurt-sensitise`, `hurt-scar`, `tension-fade`, `ending-confirmed`, `ending-timeout`,
  `ending-retracted`, `repair-slow`, `crisis-suspends`. Five (`hurt-makeup`, `hurt-apology`, `tension-fade`,
  `ending-confirmed`, `ending-retracted`) use natural-language turns that should produce their signal; their
  signal-dependent assertions carry `gate: majority` (fake mode is still deterministic, because it uses
  `signals`).
- **Review file** gains the relationship state and events per session.

### 8.4 Exit run

`pnpm eval --real extract --only <the 13 scripts> --runs 3`: deterministic assertions every run, the
extract-dependent ones (the five above) on a majority. Under `--real extract`, `signals` is ignored. Then an
on-demand review run with a real reply (`--real reply,extract --review`) for Ethan.

## 9. v2 spec edits (definition of done)

- §2: rules 1, 6, 8 marked *suspended (test phase, Ethan 2026-09-28)*; rule 4 removed; rules 2, 3, 5, 7
  unchanged.
- §5.5: the migration (§3.1); §5.8: `relationship_event` columns.
- §6.2 slot 3 and §6.3 step 3: the summary and `applyRelationship`.
- §6.4: *disabled until Phase 9* note, `guard.enabled`, `guard_disabled` outcome.
- §8: the model as built (§4–§6), all config keys.
- §14.1 relationship tab, §14.2 Phase 4 additions, §14.3 note (suite paused until Phase 9), §14.5
  `relationship_tick`.
- §15: Phase 4 exit row without the guard suite; Phase 6 exit row without the guard suite; new **Phase 9 —
  Guard re-enable and calibration** (re-enable the guard, calibrate it against the observed range, settle OPEN
  #3 and #4, first run of `backchannel.yaml`, §15.2 #7–9); §15.2 #7–9 reassigned to Phase 9.
- §16.1 #3 and #4: test-phase state (uncapped; rules suspended) and "decide in Phase 9".
- §18: a row for G1–G4.
- `CLAUDE.md`: behavioural-rules block and phase table updated to match.
- `DECISIONS.md`: one line per uncovered choice (§3.1 [ADDED] columns, median-gap definition, tick
  idempotency, the savepoint).

## 10. Carry-forwards touched

- §15.4 #24 (post-commit infra throw strands turns): fix in `reply.ts` with `restore` + re-enqueue in the
  catch.
- §15.4 #26 (one bad user aborts `turn_sweep`): per-user try/catch, same pattern as `relationship_tick`.
- Everything else in §15.4 stays deferred.

## 11. Testing

- Unit (pure): `effect`, `sampleBaseline`, saturation, fades, diminishing returns, sensitisation, scar,
  absence, the make-up and ending state machines, summary selection, the frequency trace numbers.
- Integration (test DB): migration, `applyRelationship` in the cold path including the savepoint on failure,
  the tick (idempotent per local date, per-user isolation), `guardOutgoing` with `guard.enabled = false`,
  user isolation of the new tables, account deletion cascading.
- Evals: §8.3.
