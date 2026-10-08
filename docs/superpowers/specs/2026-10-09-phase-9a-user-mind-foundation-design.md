# Phase 9a: User mind foundation — design

Date: 2026-10-09. Status: approved in conversation, awaiting spec review.

Phase 9 (user mind, v3 §9) is built in three slices, each with its own design doc, plan and
build:

| Slice | Builds |
|---|---|
| **9a (this doc)** | Big-event triggers, the durable `user_mind_run`, the user loop runner and `user_loop_trace`, `user_summarise`, the reply's summary slot |
| 9b | `user_reflect`, `user_ideate`, the ideas slot, outreach `core_thought` and `user_idea` candidates (§21 #7 asked then), B26 |
| 9c | `user_consolidate`, `user_model`, inspector User mind tab, B2, full Phase 9 exit |

## Intent

User loops run **only on a big event** (v3 §9.4, DECIDED trigger-only), scoped to one user,
reading that user's memory and state plus her latest core snapshot, writing user scope only.
9a proves the whole pipe end to end with one loop: a big event in an exchange becomes exactly
one batch, which writes a summary she reads in her next reply. Idle users cost nothing.

Test phase: functionality over accuracy. Summary quality is for review runs.

## Decisions taken with Ethan (2026-10-09)

- Slicing as above.
- Triggers in 9a: **param shift** and **salient fact / make-up done**. A long session must not
  become a big event by length alone. Deferred (backlog): long conversation ends, crisis passed,
  stale summary before a reach-out.
- Ethan's idea, backlogged for Phase 10 next to closeness-by-hours and the intimacy loop: tone
  averaged per session rather than accumulated per exchange (afterglow today adds per positive
  exchange), and a "sustained deep conversation" signal that deepens params with a per-param rule
  (e.g. depth → closeness, consistency → trust).
- Exit profile: the deterministic exit is all fake with scripted extraction; a separate review run
  `pnpm exit:user` calls the real `user_summarise` and real extraction, everything else fake.
- Exactly-once via a durable run row (approach A), not a pg-boss singleton key.

## 1. Data

One migration.

- **`user_mind_run`**: `id` uuid pk, `user_id` → `user(id) ON DELETE CASCADE`, `source_ref` text
  (`exchange:<turnId>` or `tick:<localDate>`), `triggers` jsonb (every trigger that fired, e.g.
  `[{ "kind": "param_band", "param": "trust", "from": 0.48, "to": 0.53 }]`), `status`
  (`user_mind_run_status`: `pending | running | done | failed | capped`), `local_date` (the user's
  local date at creation, for the daily cap), `created_at`, `finished_at` (nullable). Unique
  `(user_id, source_ref)`. Index `(status, created_at)` for the sweep.
- **`user_loop_trace`**: `id`, `user_id` (cascade), `run_id` → `user_mind_run(id)` cascade,
  `loop`, `inputs` jsonb (ids only, never content), `outputs` jsonb (ids), `model`,
  `prompt_version`, `tokens_in`, `tokens_out`, `cost`, `calls`, `status`
  (`done | failed`), `error` (class only), `created_at`.
- **`fact_kind`** gains `summary`. (9b/9c add `reflection`, `thought`, `idea`, `episode` when
  they write them.)

All timestamps from the injected `Clock`.

## 2. Flow

1. **Detect.** The cold path's relationship step (`updateRelationship`) returns the params and
   relationship state before and after; `encodeExtraction` already reports inserted fact ids. A
   pure `detectBigEvents(before, after, newFacts, settings)` in
   `src/mind/process/user/big-events.ts` returns the triggers (§4).
2. **Record.** If any fired, the cold path inserts one `user_mind_run` row in its own transaction
   (`ON CONFLICT (user_id, source_ref) DO NOTHING`, so a retried cold path adds nothing). If the
   user already has `user_mind.max_triggers_per_day` runs that are not `capped` on that local
   date, the row is inserted `capped` and never runs. A crisis exchange records nothing (the
   crisis carve-out suspends every v3 mechanism).
3. **Enqueue.** After commit, `user_mind_run {runId}` is enqueued (failure logged, not thrown: the
   sweep covers it). The relationship daily tick does the same for band crossings caused by fade
   or absence, with `source_ref = tick:<localDate>`.
4. **Run.** The worker takes a per-user advisory lock (`user_mind:<userId>`), claims the row
   `pending → running` (any other status: skip), runs the batch (9a: `user_summarise`), and marks
   it `done` or `failed` with `finished_at`. No pg-boss retry in the test phase; a failed run stays
   `failed` and is visible in traces.
5. **Sweep.** `cold_path_sweep` also re-enqueues `pending` rows older than
   `user_mind.sweep_after_minutes`. A `running` row left by a crash is not retried (test phase;
   backlog).

New queue name `user_mind_run` in `src/mind/platform/jobs.ts`; worker registration in a new
`src/worker/user-mind-jobs.ts`.

## 3. Runner and scope

- `runUserLoop(deps, run, name, fn)` in `src/mind/process/user/runner.ts`: meters the model,
  writes one `user_loop_trace` per loop run with tokens, cost and calls; a thrown error is traced
  `failed` with its class and rethrown. The metering and cost helpers in
  `src/mind/process/core/runner.ts` move to `src/mind/platform/llm/meter.ts` and both runners use
  them. No per-call budget: the daily run cap is the user mind's budget (cost proportional to big
  events, v3 §15). Cost reads the existing `core.prices` table (one price list per model).
- The loop function receives `UserLoopDeps`: `db`, the metered `llm`, `embedder`, `config`,
  `clock`, `log`, and `snapshot: string | null` (the latest core snapshot, read once by the
  runner). It gets no `core` layer, so a user loop cannot write core even by mistake.
- Model role `models.user_mind` (Haiku).

## 4. Triggers

Settings under `user_mind.triggers`:

- **`param_jump`**: `trust`, `warmth`, `hurt`, `tension` or `affect_valence` moves by at least
  `param_jump` (0.15) in one exchange. These are scored from the user's behaviour (or averaged
  toward the exchange's tone), so length alone can't produce a jump.
- **`param_band`**: any of those five, or `closeness`, crosses a value in `bands`
  ([0.25, 0.5, 0.75]) in either direction, comparing value before and after. Closeness only
  counts here, never as a jump, since it grows per warm exchange. `afterglow` and `msgs_per_day`
  never trigger. Checked in the cold path and in the relationship daily tick.
- **`salient_fact`**: a newly inserted fact (not a merge) with salience ≥ `fact_salience` (0.8).
- **`make_up_done`**: `make_up_state` moves from `due` or `offered` to `none`.

One exchange records at most one run, carrying every trigger that fired.

## 5. `user_summarise`

**Inputs** (this user only, plus core read-only):
- the live summary, if any;
- facts created since it (all, if none), excluding `summary` and `payload.sensitive`, top
  `user_mind.summarise.max_facts` (20) by salience;
- open threads (top `user_mind.summarise.max_threads`, 5);
- the phrased relationship summary line ("You and them"), never raw numbers;
- the run's triggers, phrased plainly ("trust between you just rose");
- `snapshot` (who she is lately), so it reads in her voice.

Recent turns are not included: the summary is where things stand, and the live conversation
already leads in a reply (V9).

**Prompt** `prompts/user-mind/summarise/v1.md`; strict JSON
`{ where_things_stand, whats_live, how_i_feel }`, each fitted to `user_mind.summarise.max_chars`
(300) with the existing `fit` helper; `max_tokens` 512.

**Writes**, in one transaction: one fact `kind = summary`, `subject = shared`,
`source = generated`, `source_ref = user_summarise:<traceId>`, the three parts in `payload` and
joined in `content`, embedded, `salience = user_mind.summarise.salience` (0.6); the previous live
summary becomes `superseded` with `superseded_by`. A model or parse failure writes nothing and the
old summary stays.

## 6. Where the summary is read

- **Reply slot 5**: a section "Where things stand with them" between "You and them" and "What you
  remember", the three parts as short lines. Skipped with no summary and for crisis replies.
  Reach-outs read it like replies. The reply prompt version does not change (the section is
  assembled by code with its own heading).
- **Excluded** from user retrieval and outreach user-event inputs (`kind <> 'summary'`) so it
  never appears twice, and from the decay pass (superseding manages it).
- **Memory view**: listed and hard-deletable like any fact; deleting empties the slot until the
  next run.

## 7. Config (`user_mind.*`)

`max_triggers_per_day` 3, `sweep_after_minutes` 10, `triggers.param_jump` 0.15,
`triggers.bands` [0.25, 0.5, 0.75], `triggers.fact_salience` 0.8, `summarise.max_facts` 20,
`summarise.max_threads` 5, `summarise.max_chars` 300, `summarise.max_tokens` 512,
`summarise.salience` 0.6; `models.user_mind`; `prompts.user_summarise: "v1"`. Each value gets a
`DECISIONS.md` line (test-phase default).

## 8. Testing

**Unit:** `detectBigEvents` (each trigger, closeness jump ignored, afterglow ignored, band in both
directions, crisis records nothing); the cap; `runUserLoop` traces done/failed; summarise
supersedes; assembly renders and skips the slot; retrieval excludes summaries.

**Exit** `tests/exit/phase-9a.test.ts`, all fake, scripted extraction:
1. A scripted trust jump → exactly one run, one `user_summarise` trace, one summary fact; the
   next reply's captured prompt contains the slot.
2. The same cold path job retried → still one run.
3. An idle user over 7 days of relationship ticks with no band crossing → no run, no trace.
4. The fourth trigger on one local day → `capped`, no trace.
5. A lost enqueue → the sweep enqueues it; it runs once.
6. A second triggered run → the first summary `superseded`, one live.
7. Core tables identical before and after every run (scope).

**Canary** `tests/exit/mind-split.test.ts`: `CapturingLLM` echoes into `user_summarise`; users A
and B each get a triggered run. A's token never appears in B's summarise prompt or output, B's
reply prompt, or anywhere in core.

**Review run** `pnpm exit:user`: a scripted multi-day conversation with real extraction and real
`user_summarise`, everything else fake; every input and output written to `evals/results/`.

Definition of done: typecheck, lint, `pnpm test`, the 9a exit, the canary.

## 9. Spec and doc updates (same work)

v3 §6.1 (`user_mind_run`, `user_loop_trace`, `summary` kind), §9.4 (the 9a triggers and the
deferred ones), §9.5 (runner, cap, scope), §10.3 slot 5, §10.4 step 5, §15 (user
cost), §17.4 (`user_mind_run` job, sweep), §20 (9a row), §25 (new backlog: session-averaged tone
and deep-conversation deepening → Phase 10; deferred triggers → tuning; crashed `running` runs
→ later; B26 → 9b; B2 → 9c), `CLAUDE.md` phase line, `DECISIONS.md`.

## Out of scope for 9a

Reflect, ideate, consolidate, model, the ideas slot, new outreach candidates, the inspector tab,
B2, B26, and any change to how params move.
