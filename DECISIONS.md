# Decisions

Choices not covered by `spica-design-spec-v3.md`, one line of reasoning each
(v3 §0.2). Open decisions (v3 §21) are not logged here: they need Ethan.

Decisions from before v3 (Phases 0–6) are in git history at the tag
`v2-final`; the ones that still shape the design are restated in v3 or in the
code itself.

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-10-01 | New config keys `turn.timer_job_retry_limit` (2), `turn.timer_job_retry_delay_seconds` (1), `life.min_busy` (0.3), `life.fallback_busy` (0.5) | Moves the last literals of the turn-timer queue policy and the day plan's busy levels into config. |
| 2026-10-01 | The inspector resolves due-thread ids in `judge_log` input to thread titles | They were shown as "(deleted)" because only facts were looked up. |
| 2026-10-01 | `src/lib` → `src/server` | It holds the Next.js server-only helpers (auth, session, inspector access); "server" says that, "lib" didn't. |
| 2026-10-01 | `src/queue/pg-boss-queue.ts` → `src/runtime/pg-boss-jobs.ts` | It is the runtime implementation of the jobs interface, next to the other Node implementations. |
| 2026-10-01 | `life_event_log`'s repo lives in `src/db/repos/user/` | The table still has `user_id`; it moves to `world/` when personal events become core events. |
| 2026-10-01 | `relativeDate` and `seededUnit` live in `src/mind/platform/` | They're used across engines; leaving them in `process/` would make world and state import process. |
| 2026-10-01 | The v3 restructure moved every file first, then rewrote | Keeps git's rename history for every file; the approved layout is unchanged. |
| 2026-10-01 | The `turn` config section is a `z.strictObject` | An override of a removed key (`backchannel_style`, `signals_probability`) now fails loudly instead of being ignored. |
| 2026-10-01 | The rule-4 guard fixture (`evals/guard/rule4-absence.yaml`) stays | It is the only coverage for four guard outage keywords; rule 4's remnants (fixture, keywords, `guilt` category, guard prompt) are one unit for the guard phase. |
| 2026-10-01 | `Param` → `HomeostaticParam` | Matches the spec's canonical name. |
| 2026-10-02 | `life_event_log` is written through the core `World` repo | Her events are core events now; the table lost `user_id` and points at `core_memory` and `world_event`. |
| 2026-10-02 | The event prompt moved to `life/event/v2` | v1 framed the event as "one friend's version of her life" and read "what she has said"; the generator now reads only her own recent episodes. |
| 2026-10-02 | The outreach user list moved to `admin/relationship.ts` (`adminListOutreachUsers`) | Its old home (`admin/life.ts`) served the per-user life and ego ticks, which are gone; outreach is its only caller. |
| 2026-10-02 | `outreach.her_day_limit` (5) caps her_day candidates | A dedicated key reads clearer than reusing `due_threads_limit`. |
| 2026-10-02 | User retrieval no longer hides future-dated generated facts | Nothing writes generated self facts any more, and the migration deleted the old ones. |
| 2026-10-02 | No recall reinforcement of core memory from replies | The hot path is read-only and one user's chatting must not move her own memory (V4); the core loops own her memory's weights. |
| 2026-10-02 | No per-user threads for her events: a high-stakes event opens an episode and sets her preoccupation | Her life is one shared story, and a per-user thread would copy core content into user scope. |
| 2026-10-02 | The migration deleted generated self facts | Nothing writes them any more and they were per-user copies of her life; the core events replace them. |
| 2026-10-02 | The deferred-block key is `<date>#<start>` (`conversation_state.deferred_block`) | The block can be looked up in the day plan, so no fact copy is stored; an unknown key just drops the line. |
| 2026-10-02 | `core_state.last_event_day` makes the world tick idempotent | A retried tick sees its day already done instead of generating the day's events twice. |
| 2026-10-02 | `CoreDeps` has no `db` | Core code can then only reach the core repos, so V6 holds structurally. |
| 2026-10-02 | The leak test uses an echoing fake (`CapturingLLM`) | A fake that repeats any canary in its input makes a leak through any LLM stage visible in what is stored next. |
| 2026-10-02 | The affect-param backfill is timestamped by the migration | Migrations run outside the `Clock`; the rows only need a valid `updated_at`. |
| 2026-10-02 | `parseSummaryPhrases` moved to `platform/phrases.ts` | Core code reads a phrase file (`core-state/line`) and may not import from the user relationship module. |
| 2026-10-02 | The mind split's exit run is a Vitest test (`tests/exit/mind-split.test.ts`), not an eval script | It needs the capturing fake and direct table scans, which the YAML runner can't express. |
| 2026-10-02 | The ESLint one-way rule uses `@/mind/process/*` plus `!@/mind/process/core` | A negation can't re-include a path under an excluded parent, so the glob lists the subdirectories core may not import. |
| 2026-10-02 | Migrations `0014_deferred_block` and `0015_mind_split` were hand-merged | drizzle-kit needs a TTY for its rename prompts. |
| 2026-10-02 | Core retrieval and outreach `her_day` never surface a core memory whose time hasn't come | Events are recorded about 00:10 her time with later `occurred_at`, so she would otherwise mention things before they happen. |
