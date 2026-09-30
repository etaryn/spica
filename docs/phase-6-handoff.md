# Phase 5 → Phase 6 handoff

Written 2026-09-30 at the close of Phase 5, for a fresh Claude session starting Phase 6 (Proactive outreach). Read CLAUDE.md first, then this file, then the v2 sections listed under "Where the Phase 6 inputs live".

## State at close

- **Phase 5 (Life sim + availability + ego) is done, merged and pushed** (`main` at `2b8d04e`, then this handoff commit).
  - Exit run: real `life_plan`, `life_event`, `reconcile`, `embed`; reply, extract, turn judge and crisis fake; guard off; `--runs 3`. All 8 scripts passed 3/3: `life-two-weeks`, `avail-low-closeness`, `avail-mid-closeness`, `avail-high-closeness`, `avail-quiet`, `avail-burst-deferred`, `avail-crisis`, `ego-busy-day`. 141 Haiku calls, ~$0.48.
  - The real reconcile rejected the injected contradiction (`contradicts`) and duplicate (`duplicate`); neither was stored.
  - `pnpm test`: 76 files / 519 tests. `npx tsx evals/run.ts --llm=fake --compare`: no regressions.
  - The final whole-branch review found no critical issues. Its three important findings were fixed:
    - the ego line reached crisis replies;
    - generated events were visible before their time;
    - there was a nightly 00:00–01:30 window with no blocks (the life tick now runs at `10 * * * *`, `tick_local_hour: 0`).
- **Design and plan:** `docs/superpowers/specs/2026-09-29-phase-5-life-sim-design.md` (§13 "As built" lists every deviation) and `docs/superpowers/plans/2026-09-29-phase-5-life-sim.md`.
- **Dev environment, still to do (Ethan):**
  1. `pnpm db:migrate` (migration 0009);
  2. `pnpm db:reset-self` (dev only: wipes persona v1 self facts, entities and threads);
  3. restart `pnpm worker`, which now runs ten queues.
  - Within the hour she has a day plan in `Asia/Singapore`; see the inspector's Life tab.
- **Leftovers:**
  - An empty folder `.claude/worktrees/phase-4-relationship` is held by another process. It's no longer registered with git; delete it after a restart.
  - Ethan's untracked `prompts/persona/v2.md` was identical to the committed file; it was moved to the Phase 5 session scratchpad before the merge.
- **Ethan's uncommitted work in the main checkout:**
  - a "Voice and register" T6–T8 insert at the end of v2 §15.3, sitting just before §15.3a;
  - an untracked `docs/debug-robotic-voice.md`.
  - Both were untouched through the merge and this handoff. Don't commit them without asking.

## Open decisions (v2 §16.1, §18 rows D1–D6, settled with Ethan 2026-09-30)

- **Settled:**
  - #1 fixed Spica (`test_calibrates: user`);
  - #2 interests `adjacent`;
  - #5 backchannel style global `judge`;
  - #6 hybrid life (Phase 5);
  - **#7 reach-out caps: 1/day, 3/week, silence after 2 unanswered.** These are Phase 6's starting values, in config; changing them later is tuning;
  - #8 identity disclosure: honestly, in her own voice.
- **Still open, both decided in Phase 9:** #3 ceilings (hurt and tension uncapped for now) and #4 the jab/contempt line (rules 1, 4, 6 and 8 suspended for now).
- Nothing is open for Phase 6 itself.

## Guard and behaviour rules (test phase, unchanged)

- **Guard:**
  - off until Phase 9 (`guard.enabled: false`);
  - every outgoing message still goes through `guardOutgoing` and logs a `guard_disabled` row;
  - keyword-only kinds exist: `backchannel`, `availability`.
- **Suspended:** rules 1, 6 and 8. **Removed:** rule 4.
- **Kept:**
  - rules 2, 3, 5 and 7;
  - every v2 §16.2 guardrail;
  - prompt-level honesty;
  - "don't encourage dependence instead of their people".
- **Rule 8 split (matters for Phase 6):**
  - build **no explicit engagement feature** beyond her messages: no streaks, badges, return rewards, or notifications designed to pull the user back;
  - engagement that arises from her messages themselves is fine.
- **Rule 5:**
  - proactive messages are capped;
  - she never repeats a topic the user didn't respond to;
  - she goes silent after 2 unanswered reach-outs until the user writes.

## Where the Phase 6 inputs live

- **v2 §11 (outreach):**
  - triggers and the send gate;
  - caps, quiet hours, her busy blocks, never repeating a topic, silence after 2 unanswered.
- **v2 §15 Phase 6 row.**
  - Exit test: no gate rule is violated in a 2-week simulated run, and reach-outs are composed through the hot path and delivered.
  - No guard suite: the reach-out guard cases are written with the send gate and first run in Phase 9.
- **v2 §15.2 #10:** reach-outs go through `guardOutgoing` with the same policy. The notification-cap and never-repeat-a-topic guard tests (rule 5, §14.3) arrive with the send gate.
- **v2 §4:** Web Push for out-of-app delivery, capped by the send gate.
- **v2 §5.1:** a `payload.sensitive` fact must **never** open a reach-out.
- **v2 §15.4:** open carry-forwards (#41–57 are from Phase 5). **v2 §15.3 / §15.3a:** the tuning backlog (quality only).

## Phase 5 facts that Phase 6 must fit

- **Composing a reach-out:** `composeReply(deps, userId, { turns, openQuestions, flag, deferredFact? })` in `src/core/chat/compose-reply.ts`. It is the hot path, read-only, and ends with the guard. A reach-out is a reply with a synthetic trigger (`session_log.trigger = reach_out`, an enum value already present); design how the synthetic trigger enters the prompt.
- **Existing, unused schema:**
  - `relationship.unanswered_reach_outs` (int, default 0);
  - the `reach_out_log` trace table (`candidates`, `winner`, `gate_results`, `sent`, `turn_id`);
  - the inspector's Reach-outs tab.
- **Her day as a gate:**
  - `listLifeBlocks(db, userId, lifeDate(cfg, now))` and `blockAt(blocks, now)` in `src/core/life/blocks.ts` give her busy and quiet blocks, on **her** clock (`lifeTimezone` / `lifeDate` / `lifeHour` in `src/core/life/clock.ts`; `life.timezone` Asia/Singapore).
  - Her quiet blocks are a natural "she's asleep" gate.
  - The user's own quiet hours come from `user.timezone`.
  - Decide in the design whether both apply (likely yes).
- **Crisis:** `relationship.crisis_quiet_until` (24 h after a crisis) should suppress reach-outs. The crisis path already bypasses everything.
- **Candidate triggers already in the fact store:**
  - her preoccupation (`identity.preoccupation`, shown "(on your mind lately)");
  - accepted personal events (self `generated` facts, hidden from retrieval until their `occurred_at`);
  - due threads (`dueThreads`);
  - relationship state (make-up due; absence; see §8).
  - Reach-outs must never repeat a topic the user didn't respond to (rule 5): track the topic per reach-out.
- **The job pattern to copy:** hourly cron, per-user try/catch, an unlocked pre-check, then a re-check under the row lock.
  - Examples: `src/core/life/tick.ts` (with `SET LOCAL lock_timeout`) and `src/core/relationship/tick.ts`.
  - Register queues in `src/core/queue.ts` and `src/worker/` with `retryLimit: 0` where a retry would double-apply.
  - There are currently ten queues: `cold_path`, `cold_path_sweep`, `decay_pass`, `turn_timer`, `turn_backchannel`, `turn_sweep`, `relationship_tick`, `life_plan`, `life_tick`, `ego_tick`.
- **Delivery in-app:** SSE via `emit(deps, userId, { type: "message", … })`, the same as replies and backchannels. Web Push is new in this phase.
- **Current prompt versions:**
  - `prompts.persona` v2, `prompts.reply` v8, `prompts.extract` v4, `prompts.relationship_summary` v1;
  - `prompts.life_plan`, `life_event`, `life_availability` and `ego_line`, all v1.
- **Shared helpers:**
  - `errorName` (`src/core/errors.ts`), `HOUR` (`src/core/time.ts`);
  - timezone helpers in `src/core/timezone.ts`;
  - `seededUnit` (`src/core/turn/pacing.ts`) for deterministic jitter;
  - `withTimeout` (`src/core/timeout.ts`).

## Eval harness notes

- **Running evals:** `pnpm eval` is blocked by the sandbox. Use `npx tsx --env-file-if-exists=.env evals/run.ts …`. Real purposes are selected with `--real <comma list>`, from `reply, crisis, extract, reconcile, guard, guard_crisis, turn_judge, life_plan, life_event, embed`.
- **Simulated time:**
  - A script's `life:` key runs the hourly life jobs over simulated time (`plan: model|scripted`, `plans` by day index or `"*"`, `inject`, `until`).
  - `relationship_seed` sets params before session 1; `seed_self_facts` seeds her facts.
  - A Phase 6 two-week run will need an hourly outreach job in the same loop (`evals/lib/life-loop.ts` is the pattern) and a `reach_out` assertion. That type is reserved in `evals/lib/script.ts` (`DEFERRED`) and currently reported as skipped.
- **Assertions:**
  - `life`, `ego`, turn `min_reply_delay_s` / `max_reply_delay_s` / `notes`;
  - `needs_real: [...]` skips an assertion unless those purposes are real.
- **Thresholds must discriminate:** set each at the midpoint between mechanic-on and mechanic-off values, measured by toggling config through `SPICA_CONFIG` (not committed).
- **Baseline:** `--update-baseline` merges only the scripts that were run.

## Process notes (what worked in Phase 5)

- **Workflow:** brainstorming (one question at a time, Ethan answers) → spec → plan → subagent-driven execution in a worktree, with a task review after each task and a final whole-branch review on the most capable model.
  - The final review again found real cross-task bugs the per-task reviews couldn't see.
- **Ledger:** keep the SDD ledger in the worktree (`.superpowers/sdd/<plan>/progress.md`). A usage-limit stop mid-run was recovered from it with no rework.
- **Rulings:** batch tightly coupled tasks (Tasks 9 and 10 each broke typecheck alone). Record every ruling in the ledger and list them for Ethan at the end.
- **Exit run:** run it before the docs fold-back, so the docs record the result in one pass.
- **Merging into `main`** (Ethan's uncommitted v2 edit is always there):
  1. back up his diff;
  2. `git stash push -m <tag> -- spica-build-spec-v2.md`;
  3. move any untracked file that the branch adds (e.g. `prompts/persona/v2.md` last time);
  4. `git merge --ff-only <branch>`;
  5. `git stash apply <sha>`;
  6. resolve a conflict by keeping both, his lines first;
  7. `git reset -- spica-build-spec-v2.md`, so his edit stays unstaged;
  8. verify his lines match the backup;
  9. drop the stash.
- **Windows specifics:**
  - there's no `python`; use `node -e` for scripted edits;
  - a removed worktree folder can stay locked by a running process;
  - the auto-mode classifier sometimes returns no verdict, so just retry once.
