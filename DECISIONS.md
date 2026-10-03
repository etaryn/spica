# Decisions

Choices not covered by `spica-design-spec-v3.md`, one line of reasoning each
(v3 §0.2). Open decisions (v3 §21) are not logged here: they need Ethan.

Decisions from before v3 (Phases 0–6) are in git history at the tag
`v2-final`; the ones that still shape the design are restated in v3 or in the
code itself.

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-10-03 | Resolution model errors and invalid output are handled inside the runner callback as `fallback`; the runner still traces and rethrows unexpected failures | Ethan approved preserving the tested runner contract while allowing the planned event to happen when resolution cannot generate an outcome. |
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
| 2026-10-02 | ~~Appraisal at an event's time writes its own `core_loop_trace` row (`core_appraise_due`), only in runs where something landed~~ Superseded the same day: the runner traces each appraisal run as `core_appraise` | Generation and appraisal now run at different times; a separate row keeps each traceable without an empty row every hour. |
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
| 2026-10-02 | The core budget check is a plain read of today's summed trace `calls`, with no lock held across the run | Core jobs run at different minutes of the hour and a rare one-call overshoot costs cents; a lock across a model call would serialise every core job. |
| 2026-10-02 | Core model calls are metered by wrapping the LLM in the runner (`ClassifyRequest.onUsage`); a call counts when attempted | Loops see the budget only through `canCall()`, and the count includes retries and reconcile calls, which cost the same. |
| 2026-10-02 | Event generation over budget marks the day done with no event | Otherwise every hourly run would try again and spend past the budget. |
| 2026-10-02 | `life_plan` and `life_event` keep the `life` model role; new core loops use `core` | Both are Haiku today; separate roles let the world generators and her thinking be tuned apart. |
| 2026-10-02 | Appraisal's input prints the event's surface valence, and the fake appraisal echoes the event's words and valence | Fake mode keeps the generator's words and the mood maths, so earlier evals and tests hold. |
| 2026-10-02 | Two placeholder seed goals ship in persona v5 | Ethan writes the real ones. |
| 2026-10-02 | Migration `0018` nulls the old placeholder emotion (`label = neutral`) and backfills trace `calls` as 1 where a model was recorded | A placeholder would read as a feeling in the line; earlier rows made one call when they named a model. |
| 2026-10-02 | `AGENTS.md` points coding agents at `CLAUDE.md` | Phase 8 is implemented with Codex as well as Claude; one source of project instructions avoids drift. |
| 2026-10-03 | A successful thinking run commits its trace with its thought, source marker and state writes | A retry or overlapping tick must see completion as one atomic fact. |
| 2026-10-03 | Dropped anticipation/rumination thoughts apply no source or state effects; a valid all-deduped wander still uses a slot | Source completion follows accepted thoughts, while a completed wander invocation counts toward its daily cap. |
| 2026-10-03 | Malformed legacy memory payloads are skipped during candidate selection; missing historical emotion stays absent | Corrupt JSON must neither abort selection nor invent a past feeling. |
| 2026-10-03 | The three thought prompts share a 512-token cap; resolution has its own 512-token cap | Separate resolution and thinking budgets keep each model request bounded without a per-loop key for identical thought limits. |
| 2026-10-03 | Thought valence comes from its source: proposed anticipation emotion, rumination episode or wander seed | The model writes the text, while existing core evidence determines the stored valence. |
| 2026-10-03 | Equal-time/equal-score source candidates break ties by stable ID | A retry or reordered repository result then chooses the same source. |
| 2026-10-03 | Nightly gist groups use Monday-start local calendar weeks; snapshot deletion cascades versioned self lines and drift rows, while fixed-value lines have no snapshot FK target | PostgreSQL's local week boundary gives deterministic grouping; version-owned diagnostics and lines cannot outlive their source snapshot. |
| 2026-10-04 | Test-phase reflection defaults: 30 new inputs, 6 context items, 2 insights, 3 opinions, 2 interests, 1024 output tokens, low/medium/high confidence 0.4/0.7/0.9, fading factor 0.5, and insight/opinion/interest/narrative salience 0.5/0.5/0.4/0.6 | Bounds keep the nightly call and memory writes predictable while quality is tuned by hand. |
| 2026-10-04 | Test-phase core consolidation defaults: decay grace 3 days, rate 0.08, stale floor 0.05; gist after 7 local days, at least 3 episodes, at most 1 group nightly, source factor 0.5, and 512 output tokens | The decay follows the existing user rule while one bounded gist call limits nightly cost. |
| 2026-10-04 | Snapshot rendering uses at most 8 items per kind and 1024 output tokens; recent insights are bounded newest-first since the previous render | Limits bound nightly context while preserving recent low-salience changes. |
