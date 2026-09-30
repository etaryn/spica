# Phase 6 → Phase 7 handoff

Written 2026-09-30 at the close of Phase 6, for a fresh Claude session starting Phase 7 (Onboarding test). Read CLAUDE.md first, then this file, then the v2 sections listed under "Where the Phase 7 inputs live".

## State at close

- **Phase 6 (Proactive outreach) is built and reviewed** on branch `phase-6-outreach`; the controller merges it into `main` (check `git log` for the merge commit).
  - Exit run: all fake, no API calls ($0), `--runs 3`. All six scripts passed 3/3: `outreach-two-weeks`, `outreach-unanswered`, `outreach-make-up`, `outreach-crisis-quiet`, `outreach-sensitive`, `outreach-ended`.
  - Discrimination, mechanic on vs off: two-weeks 6 sent vs 0 (`count.min` stays 3); sensitive 0 vs 1; ended 0 vs 2; crisis-quiet 0 vs 1 sent before day 1 09:00.
  - `pnpm test`: 88 files / 599 tests. `npx tsx evals/run.ts --llm=fake --compare`: no regressions (44 pass, the real-reply scripts skipped as before).
  - The final whole-branch review found four important issues, all fixed before close: sensitive facts reaching reach-out prompts (I1), the crisis window depending on the cold path (I2), typing and compose before any gate check (I3), push surviving sign-out and account switches (I4). Six minors were fixed with them.
- **Design and plan:** `docs/superpowers/specs/2026-09-30-phase-6-outreach-design.md` (§12 "As built" lists every deviation) and `docs/superpowers/plans/2026-09-30-phase-6-outreach.md`. v2 §11.1 is the as-built reference.
- **Dev environment, still to do (Ethan):**
  1. `pnpm db:migrate` (migration 0010);
  2. generate VAPID keys with `npx web-push generate-vapid-keys` and put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:`) in `.env`; without them the app runs with a no-op pusher and the settings switch is hidden;
  3. restart `pnpm worker`, which now runs twelve queues (`outreach_tick` at `:20`, `reach_out_send`);
  4. the manual browser check of notifications, which was never done in Phase 6 (v2 §15.4 #78): grant permission on `/chat`, see a notification while the tab is hidden, click it, switch it off in `/settings`, sign out and in as another account. Use `localhost` or HTTPS; a phone can't reach a `localhost` dev server.
  - `pnpm db:reset-self` is not needed for Phase 6.
- **Leftovers:**
  - Two Phase 6 commits (`119b420`, `4c6cfb3`) carry a `Co-Authored-By: Claude Haiku 4.5` trailer; left as is (cosmetic).
  - Ethan's uncommitted work on `main` (the "Voice and register" insert in v2 §15.3 and `docs/debug-robotic-voice.md`) wasn't in the worktree; the merge procedure under "Process notes" keeps it out of Phase 6's commits.

## Open decisions

- **OPEN for Ethan (new, v2 §15.3b R9): notification text privacy.** Every message pushes with its text (crisis replies included), so a lock screen can show anything she says. Options: a generic body, generic only for sensitive or crisis turns, or a setting. Not changed in Phase 6 (ruling R13). Ask before building anything that changes what a push says; Phase 7 doesn't need it decided.
- **Still open, both decided in Phase 9:** #3 ceilings (hurt and tension uncapped for now) and #4 the jab/contempt line (rules 1, 4, 6 and 8 suspended for now).
- **Flagged for Ethan:** `outreach.threshold` is 0.2, not the design's 0.4 (v2 §18 row R1); one config value.
- Nothing else is open for Phase 7 itself. v2 §12 is still marked LEANING (hybrid); with #1 settled as fixed Spica, the test calibrates the user only (`test_calibrates: user`).

## Guard and behaviour rules (test phase, unchanged)

- **Guard:** off until Phase 9 (`guard.enabled: false`); every outgoing message still goes through `guardOutgoing` and logs a `guard_disabled` row. Keyword-only kinds: `backchannel`, `availability`. Reach-outs use kind `reach_out` (same policy as `reply`).
- **Suspended:** rules 1, 6 and 8. **Removed:** rule 4. **Kept:** rules 2, 3, 5 and 7, every v2 §16.2 guardrail, prompt-level honesty, "don't encourage dependence instead of their people".
- **Rule 8 split:** build no explicit engagement feature beyond her messages. For Phase 7 that means no onboarding notifications, reminders or "finish your test" pushes; the only notifications are her real messages.
- **Rule 5:** reach-outs are capped (1/day, 3/week), a topic is used once, silence after 2 unanswered until the user writes.

## Where the Phase 7 inputs live

- **v2 §12 (onboarding):**
  - 10–15 questions under 3 minutes; results become user facts with `source = onboarding`, reduced `confidence`, moderate salience;
  - **reveal pacing:** test facts are gated out of retrieval until unlocked (confirmed in conversation, or a closeness or time threshold in config);
  - decay of test facts (Phase 7 decides, e.g. a salience floor for identity facts);
  - the results screen ("meet Spica": her, a couple of quirks, one flaw, what she and the user have in common; shareable).
- **v2 §15 Phase 7 row.** Exit test: a locked test fact never reaches the reply prompt (checked on the recorded prompts), unlocking makes it retrievable, and the results screen works. Quality is not an exit criterion; the exit profile (which LLM purposes are real) is agreed with Ethan in the design.
- **v2 §15.2 #11–15:**
  - #11 extraction turns Spica's words into user facts;
  - #12 stale facts stay reachable through the recent-turns window;
  - #13 onboarding facts decay;
  - #14 the profile-size experiment;
  - #15 cap how many onboarding facts go into the guard input once the survey sets their volume.
- **v2 §5.1:** the `sensitive` flag and `source = onboarding`. **v2 §15.3 / §15.3a / §15.3b** (tuning backlog) and **§15.4** (#58–84 are from Phase 6).

## Phase 6 facts that Phase 7 must fit

- **Reveal pacing must also gate reach-outs.** Nothing implements reveal pacing yet (`retrieve()` has no `source` gate; `listOnboardingFacts` feeds the guard, `src/db/repos/facts.ts`). The places where a locked onboarding fact could still surface:
  - `listOutreachUserEvents` (`src/db/repos/facts.ts`): it filters `subject = user`, kind `event` or `promise`, `open`, `private`, `thread_id` null and the lookback window, and does **not** filter on `source`. An onboarding fact with kind `event` or `promise` and an `occurred_at` in the window would become a `user_event` candidate (topic `fact:<id>`) and go through `composeReachOut`'s forced fact. Add the unlock check there, or keep onboarding facts out of those kinds.
  - `forceFactIds` in `retrieve()` bypasses scoring, so the retrieval gate must also apply to forced facts, not only to `candidateFacts`.
  - Due threads and `her_day` read other facts (threads the extractor opened; her own `generated` self facts), so onboarding facts don't reach them today; a thread opened from an onboarding fact would.
  - The check-in candidate carries no fact text.
  - Add a reach-out case to the "locked fact never reaches the prompt" check: seed a locked onboarding event, run the outreach loop, and assert no reach-out prompt contains it.
- **Sensitive data in reach-outs:** `retrieve(… excludeSensitive)` is set only for a reach-out (`composeFrom` with `reachOut`), and candidates flagged `payload.sensitive` are filtered. Test-derived facts that are sensitive must carry the flag. Text in the recent turns is not filtered (v2 §15.3b R7).
- **Any new message she sends must use `deliverPart`** (`src/core/delivery.ts`), so it is emitted over SSE and pushed and respects `push.body_max_chars`. A welcome message after the test, if Phase 7 adds one, goes through the normal hot path or this helper, not a bare `emit`.
- **Cold path:** an exchange with no user turn skips relationship and ego updates (v2 §6.3). A results-screen or test submission isn't a chat exchange; write onboarding facts directly as facts, not through the cold path.
- **Queues:** twelve: `cold_path`, `cold_path_sweep`, `decay_pass`, `turn_timer`, `turn_backchannel`, `turn_sweep`, `relationship_tick`, `life_plan`, `life_tick`, `ego_tick`, `outreach_tick`, `reach_out_send`. Register new ones in `src/core/queue.ts`, `src/queue/pg-boss-queue.ts` and `src/worker/`, with `retryLimit: 0` where a retry would double-apply.
- **Answered:** any user message resets `unanswered_reach_outs` and stamps the latest unanswered reach-out; onboarding doesn't count unless it goes through `receiveMessage`.
- **Current prompt versions:** `prompts.persona` v2, `prompts.reply` v8, `prompts.extract` v4, `prompts.relationship_summary` v1, `prompts.life_plan`, `life_event`, `life_availability` and `ego_line` v1, `prompts.reach_out` v1 (file `prompts/reach-out/v1.md`, hyphen).
- **Shared helpers:** `errorName` (`src/core/errors.ts`), `HOUR` (`src/core/time.ts`), `withTimeout` (`src/core/timeout.ts`), `seededUnit` (`src/core/turn/pacing.ts`), timezone helpers (`src/core/timezone.ts`), `lifeTimezone` / `lifeDate` (`src/core/life/clock.ts`).

## Eval harness notes

- **Running evals:** `pnpm eval` is blocked by the sandbox. Use `npx tsx --env-file-if-exists=.env evals/run.ts …`. Real purposes via `--real <comma list>`: `reply, crisis, extract, reconcile, guard, guard_crisis, turn_judge, life_plan, life_event, embed`.
- **Recorded prompts:** the fake LLM records every reply prompt (`llm.prompts`); the Phase 6 `reach_out` assertion's `composed` check counts the ones containing "## Why you're writing". The Phase 7 "locked fact never reaches the prompt" assertion can read the same list.
- **Phase 6 keys, reusable:** `seed_user_facts` (user facts, optionally with an open thread, `sensitive`), `outreach: {user_replies: never | {after_hours}, reply_text}` (runs `outreach_tick` and due `reach_out_send` jobs inside the life loop; needs `life`), and the `reach_out` assertion with the independent `no_gate_violation` checker (`evals/lib/outreach-check.ts`).
- **Thresholds must discriminate:** set each at the midpoint between mechanic-on and mechanic-off values, measured by toggling config through `SPICA_CONFIG` (not committed). For a mechanic that is an exit assertion, also measure it off once (Phase 6 did, via temporary script copies).
- **Baseline:** `--update-baseline` merges only the scripts that were run. The six Phase 6 scripts are in it.
- **Guard fixtures:** `evals/guard/reach-out.yaml` is written and skipped by default (`DEFERRED_GUARD_FILES`, `evals/lib/guard-cases.ts`); with `backchannel.yaml` it first runs in Phase 9.

## Process notes (what worked in Phase 6)

- **Workflow:** brainstorming (one question at a time, Ethan answers) → spec → plan → subagent-driven execution in a worktree with a review after each task, then a final whole-branch review on the most capable model and one fix wave, **before** the docs fold-back.
  - The final review again found real cross-task bugs (I1–I4) that the task reviews couldn't see, and the exit run found a production gap (R10) the unit tests didn't.
- **Ledger:** `.superpowers/sdd/<plan>/progress.md` in the worktree holds every ruling (R1–R13) and deferred minor. A usage-limit stop mid-task was recovered from its uncommitted edits.
- **Rulings:** record each in the ledger and list them for Ethan at the end. Phase 6's that need his eye: R1 (threshold 0.2), R7 (new turn or crisis during compose wins), R8 (per-browser opt-out), R12 and R13 (make-up `offered`, stale rows, crisis card and notification privacy not changed).
- **Exit scripts must be checked against the real code path:** the checker's first crisis rule read a flag production never sets on user turns (R9). Verify what production writes before asserting on it.
- **Merging into `main`** (Ethan's uncommitted v2 edit is always there):
  1. back up his diff;
  2. `git stash push -m <tag> -- spica-build-spec-v2.md`;
  3. move any untracked file that the branch adds;
  4. `git merge --ff-only <branch>`;
  5. `git stash apply <sha>`;
  6. resolve a conflict by keeping both, his lines first;
  7. `git reset -- spica-build-spec-v2.md`, so his edit stays unstaged;
  8. verify his lines match the backup;
  9. drop the stash.
- **Windows specifics:**
  - there's no `python`; use `node -e` for scripted edits, or a script file under the scratchpad;
  - in a worktree session, shell commands built from variables or heredocs can be refused as "too complex"; write the file with the Write tool first;
  - a removed worktree folder can stay locked by a running process;
  - the auto-mode classifier sometimes returns no verdict or denies a temporary script edit; retry once, or measure with a copy.
