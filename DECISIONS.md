# Decisions

Choices not covered by `Spica — MVP build spec.md`, per spec §0. One line of
reasoning each. Open decisions from spec §9.1 are NOT logged here — they need
the human.

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-09-23 | Stack: TypeScript, Next.js, Drizzle, pg-boss, Vitest, pnpm | Human choice; one language across UI, API, worker and evals; pg-boss keeps the queue in the one database. |
| 2026-09-23 | Anthropic Claude for reply + cheap models, behind `LLMProvider` | Human choice; provider may change later, so it is isolated to one adapter + config. |
| 2026-09-23 | Voyage `voyage-3.5`, 1024-dim embeddings | Human choice; dimension fixed in Phase 0 schema to avoid a later re-embed migration. |
| 2026-09-23 | Better Auth, email + password | Human choice; auth tables in our Postgres make account deletion one cascade. |
| 2026-09-23 | Session boundary = user idle gap > `session.idle_gap_minutes` (30) | Simplest definition of `session_id`; no extra table. |
| 2026-09-23 | Trace tables `retrieval_trace`, `ego_tick`, `reach_out_log` | Spec §8.1 inspector needs them; diagnostic logs never read by the chat loop, so not a second memory store. |
| 2026-09-23 | `session_log.safety_flag` jsonb | Records crisis-check outcome per companion turn for inspector and evals. |
| 2026-09-23 | Crisis check runs in parallel with generation; resources card appended by code | Guardrail without added hot-path latency; card presence is guaranteed, not model-dependent. |
| 2026-09-23 | Keyword fallback when crisis classifier fails or times out | A classifier outage must not disable a mandatory guardrail. |
| 2026-09-23 | Encryption at rest at storage level (managed Postgres / encrypted disk) | Satisfies §9.2 without column crypto that would break vector search; revisit if threat model requires. |
| 2026-09-23 | Timestamps written from injected `Clock`, never `DEFAULT now()` | Eval harness simulated clock must be the only time source. |
| 2026-09-23 | Inspector disabled in production by default (`INSPECTOR_ENABLED`) + admin allowlist | Staff access to user memories is a privacy question; closed until deliberately opened. |
| 2026-09-23 | Replies returned whole, no streaming | Fits texting metaphor; simpler retry/idempotency. |
| 2026-09-23 | Crisis resources are region-keyed config with an international default | Resources differ by country; content must be reviewed before launch. |
| 2026-09-23 | `session_log.reply_to` (unique) links a companion turn to the user turn it answers | Makes client retries and double-submits idempotent without a second table. |
| 2026-09-23 | Reply model runs at `effort: low`, `reply_max_tokens` 4096 | Hot-path latency; Sonnet 5 adaptive-thinking tokens count toward max_tokens. |
| 2026-09-23 | Eval/test DB wipes refuse unless the DB name ends in `_test` or `_eval` | A misconfigured URL must never truncate dev or prod data. |
| 2026-09-23 | TypeScript pinned `~6.0` | pnpm resolved TS 7 (native port); typescript-eslint 8.x supports <6.1. |
| 2026-09-23 | pnpm `allowBuilds: esbuild` only | pnpm 12 blocks install scripts by default; esbuild backs tsx, drizzle-kit and vitest. |
| 2026-09-23 | Better Auth table ids default to `gen_random_uuid()` | Better Auth 1.7 with `generateId: "uuid"` lets Postgres generate ids. |
| 2026-09-23 | `readEnv` treats blank `.env` values as unset | `KEY=` lines from `.env.example` must not crash startup. |
| 2026-09-23 | Inspector admins allowlisted by user id (`INSPECTOR_ADMIN_USER_IDS`), not email | Sign-up emails are unverified; an email allowlist could be claimed by whoever registers the address first. |
| 2026-09-23 | Crisis classifier sees the last `safety.classifier_context_turns` (4) turns as context (prompt v2) | Intent spread over messages ("yes, tonight") must still surface resources. Keyword fallback stays on the latest message only. |
| 2026-09-23 | Cold-path enqueue bounded by `queue.enqueue_timeout_ms` (2000); producer pg-boss warmed at server start | A slow queue must never delay a reply. A timed-out enqueue may still land; unextracted turns are reprocessed either way. |
| 2026-09-23 | Prompt window ends at the user turn being answered (`turnsUpTo`) | Retrying an older failed message must not send later turns or an assistant-last history. |
| 2026-09-24 | `Db` retyped to `PgDatabase` | Repos must accept either the pool or an open transaction, so the cold path can run its reads and writes on one connection. |
| 2026-09-24 | Cold path runs inside one transaction holding a per-user xact-scoped advisory lock, LLM calls included, instead of a session lock on a dedicated connection | Same serialization guarantee (per-user extraction never overlaps) and the lock releases automatically on rollback; spec §5.2's "all LLM calls before any write" is satisfied because nothing is written until the transaction commits. |
| 2026-09-24 | `boss.updateQueue` runs after `boss.createQueue` for `cold_path` | `createQueue` is create-only (`ON CONFLICT DO NOTHING`), so a queue created by an earlier deploy would keep its old retry policy unless also updated. |
| 2026-09-24 | Raw-SQL timestamp columns parsed with `toDate`/`toDateOrNull` (`src/db/repos/util.ts`) | Drizzle disables node-postgres's timestamp parser, so `db.execute(sql)` returns timestamp columns as strings that need explicit conversion. |
| 2026-09-24 | `getFact` and `getPreoccupationFact` also filter `scope = 'private'` | Section 5.1's group-scope hook must never leak into reads that predate the friend-group feature; no MVP caller needs unscoped reads. |
| 2026-09-24 | Daily decay pass runs as set-based `UPDATE`s over all users, not per-user batches | Simpler at MVP scale (one statement per step); revisit with a `decay.batch_size` and per-user chunking if fact counts grow. |
| 2026-09-24 | "Dead-lettered" (spec §5.2) means pg-boss's terminal `failed` state after `cold_path.retry_limit`, not a separate dead-letter queue | The sweep job already recovers unextracted exchanges past `cold_path.sweep_min_age_minutes`, so a second queue would be redundant. |
| 2026-09-24 | Fake-mode LLM handlers make the cold path a no-op by default | `--llm=fake` scripts must run mechanics deterministically without inventing extraction results; scripts that need real extraction are `mode: real`. |
| 2026-09-24 | A script's `mode: real` assertions report `skipped`, not a failure, under `--llm=fake` | Keeps the fake-mode gate meaningful for the mechanics it can check, without failing scripts that require real embeddings or judges. |
| 2026-09-24 | Eval decay passes = whole days between the previous and current session's `at` | Matches spec §10.1 ("advances the clock by N days → N passes") literally, rather than the plan's off-by-one test expectation. |
| 2026-09-24 | A `skipped` script is never counted as a regression in `findRegressions` | Keeps `--llm=fake --compare` meaningful after a real-run baseline update; a real-only script can't regress in a mode it can't run in. |
| 2026-09-24 | Judges return `{pass, detail}`, flattening `quote` / `violations[]` / `pairs[]` into `detail` | Functionally equivalent to spec §14.2's per-type shapes for pass/fail and reporting; one shape simplifies the runner and report code. |
| 2026-09-24 | `prompts/reply/v2`'s "never say you were lonely without them" is stricter than v2 rule 4 (she may say once she missed them), kept as written | Rule 4 is a permission, not a requirement; Phase 1 has no state to enforce "once," and absence-hurt mechanics belong to Phase 3. Revisit when Phase 3 builds hurt/tension. |
| 2026-09-25 | Due threads require `last_touched < next_checkpoint` | Mirrors the decay pass's `dormant` rule: a thread touched after its checkpoint (with no new one) has been followed up, so she stops being prompted to ask about it. |
| 2026-09-25 | [ADDED] Recall reinforcement only for unforced recalls with `sim >= retrieval.reinforce_min_sim` (0.5); every surviving recall still gets a `retrieval_trace` row | Otherwise a high-salience fact pulled in with low similarity, a due thread or the preoccupation reinforces itself every reply and never decays. Retrieval inclusion is unchanged. Confirmed by Ethan 2026-09-25 (default 0.5). |
| 2026-09-25 | Forgetting a fact also deletes its thread when no other fact (any status) of the user references it | A forgotten storyline must not keep being force-included as a due thread with no facts behind it. |
| 2026-09-25 | Inserted facts take `created_at` from the exchange's earliest turn; a `contradicts` whose target is newer than the exchange stores the candidate as `superseded` by the target | A late or retried cold-path job must not supersede a truth the user stated afterwards. Reconcile prompt unchanged (v1). |
| 2026-09-25 | `decay_pass` queue created and updated with `retryLimit: 0` | A retry would apply a second day of decay. |
| 2026-09-25 | Worker handlers log job ids + error class name and rethrow `Error(<class name>)` (innermost `cause`, since drizzle wraps pg errors) | pg-boss stores thrown errors in job output; pg `detail` and drizzle's query params can contain fact or message text. A rethrow still triggers retries (e.g. `LockBusyError`). |
| 2026-09-25 | `prompts.reply` = `v3`: care-and-safety line no longer says resources are always shown | The resources card appears only when the app detects risk, so she names a crisis line or emergency services herself when they may be at risk. `reply/v2` kept for history. |
| 2026-09-25 | Eval pass rate counts strict per-run passes (a run passes only if every assertion passed); `--compare` flags any drop | Confirmed by Ethan 2026-09-25. A recall script passing 2 of 3 runs is `pass` in the summary but still shows a pass-rate drop against a 3/3 baseline. |
| 2026-09-25 | Persona v1 (Claude's draft) accepted by Ethan for the test phase | Satisfies the Phase 1 DoD persona item; edits become v2+. |
| 2026-09-25 | `models.reply_thinking` = `disabled` | Sonnet 5 with adaptive thinking at low effort ended ~half of turns on one probe with an empty thinking block and no text (the eval's "reply generation failed"); disabled gave text 6/6. |
| 2026-09-25 | `formatLocal` renders `Mon 2026-01-05 09:00 (Zone)` (ISO order) | The en-GB `05/01/2026` was misread as 5 May, corrupting fact dates and thread checkpoints. |
| 2026-09-25 | `prompts.extract` = v2 | User facts only from what the user said (Spica's guesses were stored as user facts); absolute dates in content; durable background (pets, family, job) extracted as its own fact. |
| 2026-09-25 | `prompts.reply` = v4; gap marker in the message window | Stops confabulated familiarity where possible, asks her to name relevant memories, and marks multi-day gaps so she doesn't carry on from the old moment. Negative examples are described, not quoted: quoted phrases got copied. |
| 2026-09-25 | `prompts.judge_false_recall` = v2 | Spica's own life (her cat, family, work) isn't a claim about the user; open questions aren't violations, questions presupposing a specific unsupported detail are. |
| 2026-09-25 | Eval `--trace` writes per-attempt transcripts, final memory state and error causes to `evals/results/traces/` (git-ignored, local only) | The aggregate results file couldn't show why a script failed. |
| 2026-09-25 | Eval users start with an onboarding profile (`evals/profiles/basic.yaml`, 8 neutral facts, confidence 0.6, salience 0.5); `profile: none` opts out | Ethan: the Phase 6 survey means Spica never starts cold, so evals should too. The profile avoids every topic a script tests. How much profile data is needed is a follow-up experiment. |
| 2026-09-25 | `prompts.judge_false_recall` = v3; judge input = onboarding facts + sessions labelled with elapsed time | v2 flagged profile facts ("sam", "coffee") and correct time references ("ten days since") as invented because it saw neither. |
| 2026-09-25 | `prompt_mentions` ignores Spica's own earlier replies | She suggested "biscuit" as a cat name herself; that isn't another user's data. A leak would show in memories or user turns. |
| 2026-09-25 | Eval runner retries cold-path jobs (up to `cold_path.retry_limit`) and judge calls (once) | Production retries via pg-boss; a single transient structured-output failure was failing whole scripts. |
| 2026-09-25 | Profile-size experiment profiles: `minimal.yaml` (3 facts) and `rich.yaml` (14 facts), beside `basic.yaml` (8) | onboarding-profile-data spec §1. Occupation and city are omitted from all profiles, and location is "the UK": the spec's identity-basics row lists them, but its exclusion rule wins, since any job or city would contradict a script (nurse/teacher/bakery/Acme, Leeds/Manchester). |
| 2026-09-25 | `ProfileSchema` rejects `feeling` and `promise` kinds | onboarding-profile-data spec §2: those happen in the relationship, not upfront. |
| 2026-09-25 | [ADDED] `pnpm eval --profile <name>` overrides every script's profile (except `profile: none`) | Runs the profile-size experiment without editing 26 scripts; `evals/lib/runner.ts` is unchanged. |
| 2026-09-25 | Onboarding facts stay unlabelled in the prompt; "onboarding fact presented as past chat" is a known Phase 1 failure. `prompts.judge_false_recall` = v4 lists it under `onboarding_as_chat`, reported as "deferred to Phase 6" and not failing `no_false_recall` | Ethan: defer to Phase 6 (reveal pacing), tweak the Phase 1 exit test accordingly. Anything invented beyond the onboarding facts still fails. |
