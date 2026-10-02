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
| 2026-10-02 | ~~Core retrieval and outreach `her_day` never surface a core memory whose time hasn't come~~ Superseded the same day: episodes are now written only when their event lands, so the guard was removed | Events are recorded about 00:10 her time with later `occurred_at`, so she would otherwise mention things before they happen. |
| 2026-10-02 | The `fact_source` enum keeps `generated` though nothing writes it | Dropping a Postgres enum value means rebuilding the type; an unused value costs nothing. |
| 2026-10-02 | A reply embeds its retrieval query once, shared by user and core retrieval | Same text, one embedding call; one embed failure leaves both with nothing ranked, and the reply still sends. |
| 2026-10-02 | Canon people (`core.world.canon_entities`) are seeded into `core_entity` with snapshot v0 and excluded from the new-person clock | She has always known Alcor, so naming Alcor (or seeding) must never hold back the first genuinely new person. |
| 2026-10-02 | The event generator reads core values plus her latest snapshot (the seed self until one exists) | Her events should fit who she is lately, and the snapshot is core-only. |
| 2026-10-02 | The relationship summary skips a param with no phrase for its deviation before capping lines | A faded afterglow (below its learned baseline) has no phrase and would otherwise take a line slot silently. |
| 2026-10-02 | An intention's content is third person, present tense ("Spica is thinking of …") | It sits beside episodes ("Spica …") in the reply's "From your own life" list, so the same voice keeps the list readable. |
| 2026-10-02 | Appraisal at an event's time writes its own `core_loop_trace` row (`core_appraise_due`), only in runs where something landed | Generation and appraisal now run at different times; a separate row keeps each traceable without an empty row every hour. |
| 2026-10-02 | All events due in one run are appraised in one transaction under the world tick's lock | Re-reading the due list under the lock and marking `appraised_at` in the same transaction makes appraisal once-only and retry-safe. |
| 2026-10-02 | The world tick appraises due events before generating; each step runs even if the other fails, and when both fail the appraisal error is thrown and the generation error logged (class only) | Landing first puts overnight events in the day's "lately" context; one broken step mustn't stall the other; a single thrown error keeps the job's scrubbed error name simple. |
| 2026-10-02 | Migration `0016_appraised_at` backfills `appraised_at = created_at` | Events recorded before the change were appraised when recorded; without the backfill they would be appraised again. |
| 2026-10-02 | A planned event's thought shares `core.world.event_max_chars` with its content | It's one sentence like the content; a second key would add nothing. |
| 2026-10-02 | The fake model's default event is spontaneous | It keeps fake-mode evals close to their old timing; planned events are covered by injected events and the tests. |
| 2026-10-02 | `her_day` reads recent episodes and open intentions with `her_day_limit` each | The simplest union; the outreach scorer picks among them as before. |
| 2026-10-02 | If several strong planned events land in one generation, the last one becomes her preoccupation | At most one event a day is generated today; the rule is just deterministic. |
| 2026-10-02 | Resolved intentions stay reconcile neighbours of new events | Reconcile checks history, and a plan she already carried out is history worth not repeating. |
| 2026-10-02 | `world_event.agent_names` (migration `0017_agent_names`) keeps an event's people by name; a surprise's people join `core_entity` when it lands | A surprise must leave no trace before it happens, new people included; a planned event's people are known and join at generation. |
| 2026-10-02 | The inspector's life tab shows each world event as `landed <time>` or `pending` | Events are recorded ahead of their time, so "recorded today" isn't "happened". |
| 2026-10-02 | Exchange tone (affect, afterglow) reads only user and shared facts | Ethan: one moment must not count twice, separate hurts may stack. Her reaction and inferred hurt duplicated the user's act, and her own news isn't about them. |
