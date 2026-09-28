# Phase 4 → Phase 5 handoff

Written 2026-09-29 at the close of Phase 4 and its wrap-up, for a fresh Claude session starting Phase 5 (Life sim + availability + ego). Read CLAUDE.md first, then this file, then the v2 sections listed under "Where the Phase 5 inputs live".

## State at close

- **Phase 4 (Relationship + homeostasis) is done and settled.** No Phase 4 leftovers need action before Phase 5; what remains is backlog (below).
  - Phase 4 merged 2026-09-29 at `21d8501`. The wrap-up that settled its backlog merged at `6be12e5`. Both are pushed to `origin/main`.
  - Exit run: only `extract` real, `--runs 3`, no guard suite. All 13 `rel-*` scripts passed 3/3 with `prompts.extract` v4 (~$0.58; ~$1.81 across all attempts). The wrap-up re-checked the five `signal_source: model` scripts 3/3 after the calibration change (~$0.16).
  - `pnpm test`: 62 files / 445 tests. `npx tsx evals/run.ts --llm=fake --compare`: no regressions. `evals/baseline.json` has all 62 scripts.
- **Design and plan:** `docs/superpowers/specs/2026-09-28-phase-4-relationship-design.md` and `docs/superpowers/plans/2026-09-28-phase-4-relationship.md`. The wrap-up had no spec. Its rulings are in `DECISIONS.md` (rows dated 2026-09-29) and in v2 §8.1, §8.2, §14 and §15.4.
- **Dev environment:**
  - The dev DB is migrated through 0008; the wrap-up needed no new migration.
  - The worker is running the merged code, with `relationship_tick` now hourly.
  - An empty, locked folder remains at `.claude/worktrees/phase-4-relationship`. Delete it once nothing holds it.
- **Ethan's uncommitted work in the main checkout:** a T6–T8 insert at the end of v2 §15.3, and an untracked `docs/debug-robotic-voice.md`. Both are untouched through both merges. Don't commit them without asking.

## Guard and behaviour rules (test phase)

- **The guard is off until Phase 9** (`guard.enabled: false`; each outgoing message logs a `guard_disabled` judge_log row).
- **Suspended:** rules 1, 6 and 8. **Removed:** rule 4.
- **Kept:**
  - rules 2, 3, 5 and 7;
  - every v2 §16.2 guardrail: the crisis classifier, the guaranteed card and the friction suspension; 18+; data scoping and deletion;
  - prompt-level honesty;
  - "don't encourage dependence instead of their people".
- **Rule 8 split** (Ethan, 2026-09-29). This matters for Phase 6 outreach:
  - build **no explicit engagement feature** beyond her replies: no streaks, badges, return rewards, or notifications designed to pull the user back;
  - engagement that arises from the replies themselves is fine in the test phase.
- **Phase 9 exit test** (accepted): the guard suite passes (`pnpm eval:guard --runs 3`), including rule 2–4 and reach-out cases, against the calibrated fixtures.

## Questions for Ethan at the start of Phase 5 (don't settle them yourself)

- **OPEN #6: shared vs per-user life** (v2 §16.1; a heavy decision). v2 §10's MVP is a shared canon in the persona doc plus a per-user daily life. Confirm before designing.
- **The Phase 5 exit profile:** which LLM processes are real and which are fake (CLAUDE.md: agreed per phase). Presumably the life-sim/event generator is real, and the reply is fake as always.
- **Event frequency:** v2 §15 says Phase 5 starts at the lowest event frequency; raising it is tuning.

## Where the Phase 5 inputs live

- v2 §10 (§10.1 life sim, §10.2 availability) and §9 (persona / ego; the ego reaches behaviour only through the one prompt line).
- The §15 Phase 5 row. Its exit: over a 2-week simulated run, schedules and events are stored as self facts, contradicting events are rejected, and busy blocks slow replies unless closeness is high.
- v2 §5: the `availability` trigger enum value is reserved for Phase 5 (added, unused). §6.3 cold path: "From Phase 5: nudge the ego toward the emotional tone of the exchange".
- v2 §15.4: open carry-forwards. v2 §15.3: the tuning backlog (quality only).
- `prompts/persona/v1.md`: the shared canon. A new persona version must not contradict existing self facts.

## Phase 4 facts that Phase 5 must fit

- **Closeness overrides busy.** Read closeness through the relationship module:
  - `src/core/relationship/homeostasis.ts` has `effect` (deviation from the user's own baseline) and `fadeParams`;
  - `src/db/repos/relationship.ts` has `getParams` and `toRelState`.
  - Decide in the design whether the override uses the value or the effect. Everything else in Phase 4 is judged by effect.
- **Crisis (rule 7):** no busy delays or availability friction on a crisis turn, or during `crisis_quiet_until` (24 h). Pacing already skips waits on crisis; keep that true for availability.
- **One substrate:** life events and schedules are `fact` rows with `subject = self`. Contradiction rejection should reuse reconcile. The hurt `feeling` fact (`source = inferred`) is a working example of an inferred self fact going through reconcile.
- **The hot path is read-only.** The relationship summary fades in memory under `withTimeout` and degrades to nothing on error. Do the same for the life-state line (slot 4).
- **The daily job pattern to copy** (`src/core/relationship/tick.ts`):
  - an **hourly** cron (`relationship.tick_cron` `15 * * * *`);
  - a per-user gate: local hour ≥ `relationship.tick_local_hour` (4) and `last_tick` < today's local date;
  - an unlocked pre-check, then a re-check under the row lock;
  - `last_tick` written in the same transaction, so a failed user is simply retried next hour.
  - Every local date gets exactly one tick, across DST.
  - Time helpers in `src/core/timezone.ts`: `localDateString`, `previousLocalDate`, `nextLocalDate`, `localHour`, `localMidnight` (the start of a local date by binary search; property-checked on 418 zones × 731 days).
- **Shared helpers:** `errorName` (unwraps `.cause`) in `src/core/errors.ts`; `HOUR` in `src/core/time.ts`.
- **Bounded history:** relationship scans of `session_log` use `relationship.history_days` (90) and index-friendly `created_at` ranges. Do the same for any new per-exchange scan.
- **Seven pg-boss queues:** `cold_path`, `cold_path_sweep`, `decay_pass`, `turn_timer`, `turn_backchannel`, `turn_sweep`, `relationship_tick`. Register new ones in `src/core/queue.ts` and `src/worker/`.
- **Current prompt versions:** `prompts.extract` v4 (memory + relationship signals in one call), `prompts.reply` v7, `prompts.relationship_summary` v1.
- **Relationship config changed in the wrap-up:**
  - `gains.hurt` 0.5 (was 0.4);
  - `scar_threshold` 0.375 (was 0.3; the scar point stays at a hurt signal ≥ 0.75);
  - `end_reconfirm_min_minutes` 30;
  - `tick_local_hour` 4;
  - `history_days` 90.

## Eval harness notes

- **Running evals:** `pnpm eval` is blocked by the sandbox heuristic. Run `npx tsx --env-file-if-exists=.env evals/run.ts …` instead; without the env flag, real calls fail with "needs ANTHROPIC_API_KEY".
- **`--update-baseline` now merges:** it replaces only the scripts that were run. Use it for new scripts instead of editing by hand.
- **Script features:**
  - `seed_turns` (bulk user turns before a session);
  - per-turn `signals`;
  - `signal_source: scripted|model`;
  - `relationship` assertions (including `detail` matching and `end_pending`);
  - a daily tick in the day loop, after the decay pass.
- **Timing rules** (the runner raises script errors):
  - a new-day session must start at or after `tick_local_hour` (04:00);
  - seed turns must not overlap the previous session;
  - scripted-signal texts must be unique per script.
  - The harness counts calendar days (UTC) between sessions.
- **Assertions must discriminate:** set each threshold at the midpoint between mechanic-on and mechanic-off values, measured by toggling the config (without committing that toggle). Phase 4 caught two vacuous thresholds and two near-miss ones this way.
- **Traces:** `--trace` writes per-run state to `evals/results/traces/<stamp>/`. The `relationship` key holds per-session snapshots with events (newest first). Quality review runs use `--review`.

## Open backlog from Phase 4 (details in v2 §15.4)

- **#31, relationship signal calibration** (tuning). The real extractor scores hurt 0.5–0.6 and tension 0.3–0.5, against 0.8 scripted, and reads light-topic arguments as banter. The model-signal exit thresholds check presence, not magnitude.
- **#37:** `errorName` now records the innermost cause in logs and `judge_log.output.error` (e.g. `TypeError` instead of `APIConnectionError`). Consider recording outer<inner.
- **#38:** leftover `errorName` copies: `src/worker/jobs.ts`, plus inline copies in `cold-path.ts`, `events.ts` and `turn/receive-message.ts`.
- **#39:** residual ending risk. If the extractor re-scores an ending on the user's *last* warm exchange, the reconfirm window restarts at that turn, and the timeout confirms instead of retracting. This is still safer than the old immediate confirm.
- **#40:** the hourly tick does 2 reads per user per run. Add a SQL `last_tick` pre-filter when the user count grows; it needs `user.timezone` validated at write time first.
- **Fixed in Phase 4 or its wrap-up:** #24, #26, #30, #32–36.
- **Earlier phases' items:** §15.4 #2–29 are still listed there with their target phases.

## Process notes (what worked)

- **Workflow:** brainstorming → spec → plan → subagent-driven execution in a worktree, with a task review after each piece and a whole-branch review on the most capable model at the end.
  - The final reviews found real bugs no per-task review saw: a pending ending confirmed through a crisis, and a gain change that made ordinary insults scar.
- **Recovery:** keep a ledger. Usage limits and auto-mode "no safety verdict" outages killed agents mid-task several times. Their edits were left uncommitted in the worktree, and resuming the same agent (SendMessage) kept its context.
- **Merging into `main`:** the main checkout usually holds Ethan's uncommitted v2 edit. The sequence that worked:
  1. back up his diff;
  2. `git stash push -m <tag> -- spica-build-spec-v2.md`;
  3. `git merge --ff-only`;
  4. `git stash apply <sha>`;
  5. verify it's identical to the backup;
  6. drop the stash.
- **Worktree-isolated sessions:** compound shell commands that compute a program at runtime are refused; use plain single commands. Subagents may be blocked from writing report files, so ask for the report in the final message.
