# Phase 8c: Core nightly design

Date: 2026-10-03. Parent design: `docs/superpowers/specs/2026-10-02-phase-8-core-loops-design.md` §§2.3, 2.5, 6, 8.2, 10–11. Source of truth: `spica-design-spec-v3.md` §§3–4, 6.2, 7.3, 8.5, 12.3, 15.

Status: Phase 8c slice design for implementation. The parent design and its 8a–8d split were approved with Ethan; this document fixes the 8c interfaces and failure behavior against the built 8b code.

## 1. Goal and boundary

Spica's core mind runs one local night at a time. It reflects on new core experience, decays and condenses old core episodes, renders a versioned self snapshot, and records drift without blocking it. The work is core-only and bounded by the existing 24-call daily budget. A completed 8c slice compiles and passes its own deterministic exit, canary and side-channel tests.

Phase 8d owns mood- and goal-biased recall (B53), reply/extract claim changes, claim grounding through self lines, the inspector, the fourteen-day fake and real-core exits, and the expanded canary. Phase 8c creates `core_self_line` and tests its core-only storage, but no user pipeline reads it yet.

## 2. Scheduling and budget

`core_nightly` is one hourly pg-boss queue, scheduled after `core_mind_tick`. Its cron is configurable; the first eligible invocation is when her local hour is at least `core.nightly.local_hour` (3) and `core_state.last_nightly_day` is older than her local date. A transaction locks the single state row, rechecks the date, and writes today's local date before any loop starts. Concurrent jobs lose eligibility. If the process crashes after the claim, that night is not retried; the next local night runs normally. A long call crossing midnight still belongs to its claimed date and uses the captured `now` throughout.

Order is reflect → consolidate → render → drift. Each uses the existing `runCoreLoop` meter and gets a separate trace; an error is logged by class and the coordinator continues. Drift runs only if render created a new version. The existing `core.loop_priority.essential` entries and `daily_call_budget` apply. A due model loop without budget traces `skipped_budget`. No render means no new snapshot or drift run. Code-only decay runs before entering its budgeted loop. Code-only drift diff/trend runs before entering its budgeted judge loop, so a render that spends the last call still gets diagnostic rows.

## 3. Core storage

Add `last_nightly_day` (nullable local date) to `core_state`, an embedding (vector 1024) to `core_snapshot`, and two core-only tables:

- `core_self_line`: `id`, nullable `version` (null for fixed core values), `text`, `embedding`. Lines from version 0 and each new snapshot are stored once. Snapshot and its versioned lines commit together.
- `drift_log`: `id`, `version`, `check` (`values | diff | trend`), nullable `value`, `excerpt`, `verdict` (`ok | contradicts | strains`), `score`, and `created_at`. A rendered version can have code-only diff/trend rows even if the values judge fails.

Existing v0 rows have no embedding at migration time. Keep the column and read type nullable for those rows; the snapshot insert type requires an embedding. The idempotent seed routine fills v0's embedding and seed self lines, and inserts fixed core-value lines. Every newly rendered snapshot has an embedding. A drift check encountering a null historical embedding records no invented distance and keeps the snapshot. Repeated seeding changes no existing snapshot content, version or lines. All methods are exposed through the core data layer, including its transaction scope; no core loop gets a raw database or `user_id`.

Migration `0021_core_reflected` adds nullable `core_memory.reflected_at` after the nightly storage migration. Existing rows start unreflected; the field has no default timestamp.

## 4. Reflection

`core_reflect` reads active episodes, thoughts and ideas with `reflected_at IS NULL` and `created_at <= now`, capped at `core.reflect.max_inputs` and ordered by `(created_at, id)`; nearest active opinions/interests with IDs, capped at `context_items`; active goals, the latest snapshot and fixed core values. A successful nonempty run marks exactly its selected input IDs `reflected_at = now` in the same transaction as memory, goals and the `done` trace. If a selected input changed before commit, the transaction rolls back rather than marking a partial batch. An unsuccessful or budget-skipped night leaves inputs unmarked. With no eligible inputs it makes no model call and traces `done` with zero calls, without marking anything. A memory inserted after the read or after the success trace remains eligible even if its `created_at` is earlier than the run.

The `prompts/core/reflect/v1.md` response may contain at most two insights, three opinions (`subject`, `stance`, confidence word, optional superseded ID), two interests (`new` or `fading` with target ID), goal adds/drops, and one narrative paragraph. Code validates lengths and counts, embeds proposals outside transactions and rechecks targets in the write transaction. Unknown or no-longer-active IDs are ignored. Opinion confidence words map through config; a valid replacement marks its old opinion `superseded` with `superseded_by`. Fading multiplies target salience by the configured factor. The narrative supersedes the previous narrative. Goal adds stop at the configured active-goal cap; drops mark matching active goals `dropped`. Model content never directly moves progress or core state. Memory, goals and the success trace commit atomically.

For this test slice, config bounds reflect to 30 new inputs, 6 context items and 1024 output tokens. Opinion confidence maps low/medium/high to 0.4/0.7/0.9; fading factor is 0.5. New insight, opinion, interest and narrative salience is 0.5, 0.5, 0.4 and 0.6 respectively. They have neutral valence, status `recurring`, source `loop`, `source_ref` `core_reflect:<trace-id>`, and `created_at`/`occurred_at` from the injected clock. Goal add embeddings use `"<title>: <why>"`, source `reflect` and the same trace reference. These low-impact defaults are recorded in `DECISIONS.md`.

## 5. Consolidation

`core_consolidate` applies the existing user-memory decay formula to core memory once per claimed night, using core-specific config. After the grace period without recall, `salience *= 1 - rate * (1 - salience)`; at or below the stale floor, status becomes `stale`, never deleted. Open intentions, the current preoccupation, latest narrative and memories linked to active goals are exempt. A goal-linked memory is an episode whose `source_ref` points to a world event with `goal_ref` naming an active goal; indirect thought links do not qualify. Config starts with the user decay defaults (`grace_days: 3`, `rate: 0.08`, `stale_floor: 0.05`). A night with no gist due has a zero-call `done` trace when budget remains; with exhausted budget its trace is `skipped_budget` but decay still runs.

Gist candidates are resolved, not-yet-gisted episodes older than seven local days. Group by her local calendar week; groups need at least three source episodes and at most one group is processed per night. The `prompts/core/consolidate/v1.md` call writes one gist as an `episode` with `payload.gist_of` source IDs, `occurred_at` from the first source and salience from the maximum source. Sources retain content, get `payload.gisted_into`, and salience is multiplied once by `gist_source_factor` (0.5). Run decay before requesting a gist so model failure cannot suppress nightly decay; the coordinator's once-per-date claim prevents a second application that night. Recheck gist eligibility in the transaction so a retry or concurrent run cannot double-dampen. Model/embedding work occurs outside it. Invalid model output keeps decay and gets a `fallback` trace; an unexpected failure gets a `failed` trace while completed decay remains.

A gist is a recurring episode with neutral valence, confidence 0.6, source `loop`, `source_ref` `core_consolidate:<trace-id>`, and `created_at` at the injected time. Its model response is bounded to 512 tokens. Rechecking the sources and marking them in the same transaction as the gist prevents duplicate damping.

## 6. Snapshot and drift

`core_render_snapshot` reads fixed values, previous snapshot, latest narrative, top active opinions/interests (bounded by `core.snapshot.max_items`), goals and progress, recent insights, and core entities/agent notes. The Haiku response has exactly `Lately`, `Opinions`, `Interests`, `Goals`, `People`, `Habits of speech` sections. Speech habits are carried forward unless a visible source change justifies a rewrite. Transient mood and energy are excluded. Code joins sections under `### ` headings and embeds the full content and each bullet line. A transaction rechecks the latest version, writes N+1 and its lines, and records its successful trace; failure leaves the old version usable.

Snapshot context has at most 8 items per active kind and a 1024-token model cap. The drift judge has a 512-token cap. These are test-phase config defaults recorded with the other uncovered constants.

After a new snapshot, `core_drift_watch` compares it to fixed core values with a Haiku judge (`prompts/core/drift/v1.md`). It writes one `ok` row or one row per `contradicts`/`strains` finding. Code writes cosine distance from the previous embedding as `diff`, with changed-section share in the excerpt, and distance from v0 as `trend`. Code-only rows survive a judge error; the judge error gets a failed loop trace and never fabricates an `ok` row. Drift is diagnostic: no verdict blocks or rolls back a snapshot. The v3 OPEN question about a future response to drift remains open.

## 7. Verification and documentation

Repository tests cover core-only structure, migration, seed idempotence, query bounds, decay exemptions, local-week grouping and transactional effects. Loop tests use deterministic fake outputs and invalid outputs. Scheduler tests cover local-time eligibility, concurrent claims and step isolation. The 8c fake exit advances at least two local nights and asserts snapshot versions, self lines, drift rows, gist and decay behavior, budget traces, and no user-to-core or cross-user leakage; the existing side-channel test stays. Run typecheck, lint, full tests and focused exit/canary. Update v3 with every 8c field, table, job, config key and prompt. Do not edit `CLAUDE.md`.

Test-phase constants not specified by the parent design (model token caps and context limits) are configuration defaults chosen for bounded cost, recorded in one dated `DECISIONS.md` entry during implementation. Prompt outputs and structural assertions are deterministic in fake mode; quality is reviewed by hand later.
