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
| 2026-10-02 | ~~`AGENTS.md` points coding agents at `CLAUDE.md`~~ Superseded 2026-10-08: development is Claude-only; `AGENTS.md` removed | One source of project instructions avoids drift. |
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
| 2026-10-04 | The drift values judge has a 512-token output cap; code diagnostics use cosine distance and changed-section share | One bounded judge call supplements measurements that survive budget or judge failure. |
| 2026-10-04 | Schedule `core_nightly` at minute 55 each hour, after `core_mind_tick` at minute 50 | The date claim gates the once-nightly run while the hourly cron allows startup or delayed jobs to catch the local night. |
| 2026-10-04 | ~~Reflection records the last consumed `(created_at, id)` pair in each successful trace; a zero-input run records `(now, null)`.~~ Superseded by per-memory `reflected_at` below | A timestamp cursor could skip a core memory committed after the read with an earlier `created_at`. |
| 2026-10-04 | Migration `0021` adds nullable `core_memory.reflected_at`; successful reflection marks only selected IDs in its trace transaction | Bounded runs drain equal-time backlog, while late inserts and failed runs remain eligible regardless of creation time. |
| 2026-10-08 | A `life` or `opinion` claim counts as grounded at core similarity ≥ 0.75 (`claims.grounded_similarity`) | Test-phase default for a diagnostic that blocks nothing; tune from review runs. |
| 2026-10-08 | The inspector's Core tab lists the last 5 snapshot versions (`inspector.snapshot_versions`) | Enough nights to see a trend without a long page. |
| 2026-10-08 | Core recall boost biases (`retrieval.core_mood_bias`, `retrieval.core_goal_bias`) are 0.3 each | A visible but modest lean; the boost stays positive for any bias ≤ 1. |
| 2026-10-08 | Core loop schemas fit overfilled model output (extra list items dropped, overlong text cut with "…") instead of failing the run | Strict structured output can't enforce bounds; one extra line was failing whole nights. Code still owns the numbers. |
| 2026-10-08 | Reflection keeps at least one active goal (`core.goals.min_active` 1): drops stop at the floor unless additions replace them | With no goal, goal-driven events and goal-biased recall go idle. |
| 2026-10-08 | The core budget gate is a per-day reservation row (`core_budget_day`), not the summed traces | Calls in flight were invisible to overlapping jobs; one atomic upsert per call closes that without holding a lock across a model call. |
| 2026-10-08 | Core loop model calls retry transient API errors (`core.max_retries` 2); hot-path structured calls keep 0 | A night is claimed before its loops run, so one timeout lost a whole night; hot-path callers already have timeouts and fallbacks. |
| 2026-10-09 | A big event is a durable `user_mind_run` row, not a singleton job key | A singleton key would drop a second trigger that arrives while one runs; the row also carries the cap, the trace link and the sweep. |
| 2026-10-09 | Trigger thresholds are test-phase defaults: `param_jump` 0.15, bands 0.25 / 0.5 / 0.75, `fact_salience` 0.8, cap 3 runs per local date | Tuned by review runs later; all in config. |
| 2026-10-09 | Summarise bounds: 20 facts, 5 threads, 300 characters per line, 512 tokens, salience 0.6, confidence 0.7 | Keeps the batch cheap and the slot short; the summary is her own inference, so confidence stays below fact level. |
| 2026-10-09 | A summary is a `shared` fact superseded on each run | Reuses fact storage and history without a new table; supersede keeps one live summary per user. |
| 2026-10-09 | Summaries are excluded from retrieval, reconcile neighbours and decay | The reply has its own slot for the live summary; as a retrieved memory it would repeat, and reconcile or decay would merge or fade it. |
| 2026-10-09 | A failed `user_mind_run` is not retried (queue retry limit 0) | The next big event produces a fresh summary; a retry would double-spend against the daily cap. |
| 2026-10-09 | User loops reuse `core.prices` (now the top-level `prices`) and `core.max_retries` | Same models and API, so one price table and one retry policy; a separate set would only drift. |
| 2026-10-09 | The `user_mind_run` sweep rides on `cold_path_sweep` | It already scans per-user pending work on a schedule; a new job would add a schedule for one query. |
| 2026-10-09 | The `user_mind_run` sweep reuses `cold_path.sweep_batch` | Same sweep job, same batch bound; a key of its own would bound the same pass twice. |
| 2026-10-09 | The memory view lists the live summary under "Where things stand" | It is about them, so they can see and hard-delete it like any other memory. |
| 2026-10-09 | The daily tick records no big event for a relationship the user ended | Params still drift after an ending, but nothing is happening between them; a run would spend calls on a relationship only the user can reopen. |
| 2026-10-09 | A fact stored already superseded (a late contradiction of a newer fact) fires no `salient_fact` | It was overridden before it was written, so it isn't news worth a summary. |
| 2026-10-09 | `user_mind.reflect.*` are test-phase defaults: 5 recent reflections shown, 300 characters, 384 tokens, salience 0.5, confidence 0.6 | Reflection is her inference, so confidence stays below fact level and salience is middling; bounds keep the call cheap and the text short. |
| 2026-10-09 | `user_mind.ideate.*` are test-phase defaults: 200 characters, 256 tokens, salience 0.5, confidence 0.6, expiry after 3 days, 1 idea in the reply slot, 20 live ideas shown to ideate (`max_planned`) | One short, fresh idea per run; `max_planned` only has to be large enough that ideate sees every live idea and doesn't repeat one. |
| 2026-10-09 | `outreach.weights.user_idea` is 0.6 and `core_thought` 0.5 | An idea about them (0.5 salience scores 0.30) outranks her own musing (a medium thought scores 0.20, on the 0.2 threshold), so a thought rarely beats anything about the user. |
| 2026-10-09 | `outreach.core_thought_lookback_hours` is 24 and `core_thought_limit` 3 | Matches `her_day`: a thought is worth sharing for about a day, and a few candidates bound the input. |
| 2026-10-09 | `outreach.user_idea_limit` is 3, its own key rather than reusing `due_threads_limit` | Ideas and due threads are different inputs; a shared key would couple their caps. |
| 2026-10-09 | The reach-out prompt is `prompts/reach-out/v2.md`; v1 is deleted | Per-kind guidance lives in the prompt, so the two new kinds needed lines of their own. |
| 2026-10-09 | Ideas are excluded from decay and expire by age (`ideate.ttl_days`) as a read-time filter | An idea has one short chance; fading its salience would add a second clock, and a filter needs no job. |
| 2026-10-09 | Reflections are excluded from cold-path reconcile | A turn fact must not merge into or supersede her inference. |
| 2026-10-09 | Reflections are read through ordinary retrieval, not a slot | A reflection is a memory about them; it should surface only when a conversation makes it relevant. |
| 2026-10-09 | An idea gets one chance: it is retired once shown in a reply or used by a reach-out | Re-offering the same topic reads as nagging; the cold path retires it after the reply is sent, and the send transaction retires it for a reach-out. |
| 2026-10-09 | `crisis_passed` keys on the stored `crisis_quiet_until`, not the effective window | Stable once the crisis exchange's cold path commits, so each crisis fires once. |
| 2026-10-09 | `stale_summary`'s `source_ref` is the tick time | The reach-out log row doesn't exist yet when the run is recorded; a retried tick has the same time. |
| 2026-10-09 | For a reach-out the window trim also counts the gap from the last turn to now, keeping her unanswered reach-outs | A reach-out answers no turn; a reply always keeps the turns it answers. |
| 2026-10-09 | Tests that need a vanished fact delete the row directly | Per-fact forget is gone; account deletion is the only remaining erasure. |
| 2026-10-09 | The inspector orders a run's loop traces by time, then batch order | A fixed clock gives a run's loops one timestamp. |
| 2026-10-09 | A user gist takes memories that are old enough and not on an open storyline, not only `resolved` ones | User facts reach `resolved` only when a later fact resolves them, so gists would almost never form. |
| 2026-10-09 | `user_consolidate` runs only in a triggered batch, never nightly | Cost scales with big events; an idle user's memories just decay. |
| 2026-10-09 | Invalid `user_consolidate` output fails the loop, like every other user loop | One failure rule across user loops; the run is marked failed and the next big event tries again. |
| 2026-10-09 | The eval life loop runs `user_mind_tick` every simulated hour | It mirrors the production hourly jobs, so long-conversation and crisis-passed triggers fire in scripts. |
| 2026-10-10 | Phase 10 comes after Phase 9; 10a (how closeness grows) first | Settles the phase order for this step with Ethan. |
| 2026-10-10 | Existing dev users start Phase 10a at 0 hours together; no backfill from `session_log` | Test-phase data; the ceiling simply starts low for them. |
| 2026-10-10 | Her openness for an exchange with several replies is the highest of its replies' | The moment credits the most she brought to the exchange. |
| 2026-10-10 | The user's disclosure and responsiveness have no "You and them" phrases | They reach her through "How open you feel"; the summary already drops a deviation with no phrase. |
| 2026-10-11 | Existing core memories take their depth from their kind; existing self lines are surface | No model backfill; self lines were already shown to everyone, so nothing changes until the next render. |
| 2026-10-11 | Core-value lines are always surface | Who she is (an AI, Alcor, her loves) is never a secret. |
| 2026-10-11 | Ledger rows point at core items with no foreign key | Core tables must never depend on a user table; core items are never hard-deleted. |
| 2026-10-11 | A repeated claim records another ledger row even when reconcile merges it | So a hint told again openly upgrades to open. |
| 2026-10-11 | A reply with no stored depth limits counts its claims as open | Replies before this phase had no limits. |
| 2026-10-11 | Truthful deflection now; tracked white lies later (B84) | Lies need cover stories in the ledger to stay consistent, and meet the guard-phase invented_self decision. |
| 2026-10-11 | A bid's warmth move stacks with the warmth signal | The bid is a small read of one reach; the overlap is tuned in review runs. |
| 2026-10-11 | A bid counts only when the user answers within `session.idle_gap_minutes` of her last message, timed rather than by session id | Coming back after a gap is not turning away; a reach-out or deferred reply sits in another session from the answer. |
| 2026-10-11 | An idiolect candidate reconciled onto a non-idiolect fact is inserted as its own candidate | Otherwise old inside jokes stored as plain shared facts would swallow every callback. |
| 2026-10-11 | Bid moves use `nudge`, like every signal | Bounded and consistent with signal gains; the configured value shrinks near the bound. |
| 2026-10-11 | Idiolect is established by a duplicate from a different exchange | A joke becomes theirs when it comes up again, not when repeated in one breath; a retried job never counts. |
| 2026-10-11 | Idiolect state lives in `fact.payload`, not columns | One fact kind, no migration beyond the enum value. |
| 2026-10-12 | Commitment leaves out Rusbult's quality of alternatives | Comparing users would break V7/V8, and her own life already competes for her time through availability. |
| 2026-10-12 | A relationship row from before stages has `milestones` null and reads its peak from its params; its first settlement records what it has reached without firing | No SQL backfill to keep in step with the climb rules, and old friendships don't announce a burst of firsts. |
| 2026-10-12 | `avoiding` reads warm | Knapp has no stage for drifting apart amicably; with her, a user going quiet is usually just life. |
| 2026-10-12 | `first_conflict` ignores `avoiding` | Absence is not a falling-out. |
| 2026-10-12 | Reveal pacing dropped: card facts are known from day one, lightly | She saw their profile card, the way you'd know a profile; the card mark and low confidence keep it a first impression. |
| 2026-10-12 | The compatibility page is shared by screenshot only | A public link needs auth and abuse work; backlog, before users. |
| 2026-10-12 | Her card answers are `self` facts, not disclosure rows | The disclosure ledger tracks core memories and self lines; her quiz answers are neither. |
| 2026-10-12 | Common topics are stored on the card at submit | Both sides are embedded then, so the results page makes no calls. |
| 2026-10-12 | Quiz files are kept while any card names their version (an exception to deleting unconfigured prompt versions) | The results page reads a card with the quiz it was taken with; deleting the file would break every older card. |
| 2026-10-12 | Common topics embed both sides as queries, matched at 0.5 | Measured on voyage-3.5: as documents any two short words score 0.75+ and everything matched; as queries related pairs scored 0.52–0.81 and unrelated 0.26–0.45. |
| 2026-10-12 | `/api/chat` is not gated on the profile card; only the `/chat` page is | A crisis message must always get through, even from an account that skipped the quiz by calling the API. |
| 2026-10-12 | A quiz choice can't be changed once picked | Her pick shows the moment you choose; changing after would let you copy her. |
| 2026-10-12 | Module events are delivered in-process and awaited; durable pg-boss delivery deferred (B97) | No real module exists; the `emit` interface is the same either way, so only the bus changes later. |
| 2026-10-12 | Module events fire after their write commits and carry ids, never content | An event inside a rolled-back transaction would announce something that never happened; ids keep user text out of modules and logs. |
| 2026-10-12 | `user_mind.triggered` fires when the run is claimed, not when it is recorded | One place covers every trigger source and the sweep, once per run. |
| 2026-10-12 | The public persona is her daily life (today's plan, happened events), outward personality (surface self lines, public voice) and AI side (core values); deeper thoughts stay secret (Ethan) | She reads clearly as an AI companion with a life; what her mind made of that life stays private. |
| 2026-10-13 | The guard gets no sensitive-topic category; the reach-out `sensitive-opener` fixture is deleted | The send gate already filters sensitive facts out of reach-outs (tested there); a second check in the guard adds a rubric for a path that can't occur. |
| 2026-10-13 | Posts come from a scheduled `post_tick`, not the module bus | Bus delivery is in-process and core handlers have no queue; a tick is durable and simpler. |
| 2026-10-13 | Browsing and posting are `action` world events | World events reach memory only through appraisal, so one path gives both "she remembers her posts" and craft progress. |
| 2026-10-13 | Stills are pre-rendered pose sprites composited with sharp; live 3D comes with video | No 3D or headless browser at runtime; the sprite PNG is the seam a live renderer replaces. |
| 2026-10-13 | The draft call never sees her appraisal episode, only its valence | Her take is private memory; a post is written fresh in her public voice. |
| 2026-10-13 | Only public-domain, CC0, CC BY and CC BY-SA finds are kept | She may post what she finds. |
| 2026-10-15 | Her feeling line has its own cap (`voice.feeling_max_lines`); "You and them" keeps `relationship.summary_max_lines` | The summary already ranked and capped; one shared cap would have tied two sections together for no gain. |
| 2026-10-15 | `shapeText` lowercases every capitalised word for a non-formal user, names and titles included; all-caps words stay | Code can't tell a name from a sentence start; all lowercase is her base, and acronyms and shouting keep their meaning. |
| 2026-10-15 | Bracketed stage directions are left to the prompt and counted in the voice report, not removed in code | Removing them would cut content after the guard approved it. |
| 2026-10-15 | "How to text this one" is the last section before "Why you're writing" | Closest to the conversation, where instructions are followed best. |
| 2026-10-15 | The reply prompt's recall examples use names no fixture uses ("otis", "wren") | Eval leak checks match names case-insensitively across every prompt. |
| 2026-10-15 | `relationship.scar_threshold` 0.375 → 0.75 with gains at 1 | Keeps scars where they were on the raw scale: "aimed at who she is" and worse. |
| 2026-10-15 | An absence remark's occasion is the latest return (a user turn after a gap past `absence_grace_factor` × their median gap); a reach-out's is the absence still going on | Same rule that already decides absence; a reach-out speaks into the silence, so their return opens a fresh occasion. |
| 2026-10-15 | A callback's occasion is `relationship.last_hurt_at` | Every new hurt is a new slight; no extra state. |
| 2026-10-15 | An ending with no hurt score gets the floor; its cause text ("the user said they wanted to end the friendship") is never stored, so the make-up and summary see no cause | The cause fact comes from the extractor's own hurt; a floor-only ending has none to point to. |
| 2026-10-15 | No make-up reach-out while an ending is pending | Every ending now makes a make-up due; writing first then would be pressure to stay. |
| 2026-10-15 | The keyword categories are listed in the config schema, not imported from the guard | Platform code doesn't import process code. |
| 2026-10-15 | Guard eval cases carry the occasion line on every non-crisis case (empty by default) | Mirrors the hot path, so a case reads like production. |
| 2026-10-15 | Thresholds on the hurt and tension values re-anchored to the gain-1 scale: make-up at 0.5 (clear 0.2), differentiating at tension 0.5 (clear 0.25), circumscribing at 0.75 (clear 0.5) | They were sized for gains 0.5 and 0.3; left alone, one friendly disagreement or one real sting would start coming apart. |
| 2026-10-16 | Extraction caches its fixed prefix (`models.extract_cache`, 5m); no other structured call does | A real probe: the v8 prompt plus output schema is 4,575 tokens and the second call read 4,569 from cache; an extraction averages ~4,870 input tokens, so a warm call costs ~85% less input. Other prompts must be measured against the 4,096 minimum before turning it on. |
| 2026-10-16 | Every real eval call is logged to a JSONL call log, and a real `pnpm eval` always writes its review | A paid overnight run without `--review` lost all 989 replies; a flag nobody remembers can't be the only record of a paid run. |
| 2026-10-17 | "next <day>" is that day in the following week (chrono's reading); a bare weekday said on that weekday is next week's; past phrases are never forward-dated | chrono-node's own reading, made explicit so a weekday never lands on today. |
| 2026-10-17 | Users who already had daily ticks get `samples = 30` in migration 0035 | Their learned rate baseline is kept instead of being replaced by one day's count. |
| 2026-10-17 | The past-tense hurt copy keeps the old embedding | The meaning hasn't moved, and no network call runs inside the cold-path or tick transaction. |
| 2026-10-17 | `relationship.initial.msgs_per_day` is 0, not deleted | The config schema needs every param; the first daily sample replaces it. |
| 2026-10-17 | A run with nothing unread skips reflect and ideate only | Summarise and model still take stock on a param-only trigger (a repair, a band). |
| 2026-10-17 | `EncodeOutcome.insertedFacts` (not `inserted`) | `inserted` was already the insert counter. |
| 2026-10-17 | `ExtractedFact.when`, `ExtractedThread.checkpoint_when` and `Candidate.depth` are optional on the types | The model schema still requires the fields; code-built facts and older stored winners simply have none. |
| 2026-10-17 | `rel-stages` seeds closeness 0.4 with 24 hours together | The fake run grows no closeness; 0.4 is the lowest seed that reaches becoming friends. |
| 2026-10-18 | Wander's "recent themes" are the memories her last 10 wanderings started from or chained through (`payload.seed`/`chain`), drawn at ×0.2; no embedding check, and people come in through events | Needs no extra embedding calls; the design doc's embedding check was simplified to this. |
| 2026-10-18 | `pickCue` keeps a uniform pick when every weight is zero and keeps mood-congruence | Matches the old seed pick; wander skips only when there is no cue at all. |
| 2026-10-18 | The fake `life_plan` alternates its busy label after a "reading" day | Plans now must differ from yesterday; a constant fake plan would fall back every second day. |
| 2026-10-19 | "this week" / "later this week" resolve to the day said, labelled "the week of Monday …"; "end of the week" to its Friday | chrono reads "this week" as last Sunday; the day said keeps the event ahead of now. |
| 2026-10-19 | `core.reflect.twin_similarity` 0.85 is provisional; twins only against memories from before tonight | The run's dump has no embeddings to measure real paraphrase similarity; same-night exclusion stops chains. |
| 2026-10-19 | The publication-size download keeps the enclosure URL as the find's URL | `findByUrl` dedupe stays unchanged; the hash check still catches the same picture. |
| 2026-10-19 | `ExtractArgs.herInterests` is optional | The cold path always passes it; other callers have no snapshot to give. |
| 2026-10-20 | Going offline and coming back are hour-granular, decided only by `core_state_tick` | The tick already runs hourly; nothing between ticks needs finer offline timing. |
| 2026-10-20 | While she's offline her plan's busy blocks don't happen: no drain, and offline wins `blockAt` | The plan is intent; she wasn't there. |
| 2026-10-20 | A planned event due while she's offline still lands as planned | Marking it as fallen through is backlog if the review run reads wrong. |
| 2026-10-20 | `estimatedBack` counts from `last_tick` at `offline_recovery_per_hour`, never under 1 h | A message between ticks never sees an offline end in the past. |
| 2026-10-20 | Eval script users have no timezone (UTC), so `their_night` (23–08) mirrors the old quiet window | Reach-out counts in the outreach scripts hold without retuning. |
| 2026-10-21 | An idea's sources are the ideate run's dated facts nearest the idea by embedding (`source_similarity` 0.3, provisional), not ones the model names | The model writes one free-text idea; similarity keeps an unrelated date out of the reach-out without a prompt change. |
| 2026-10-21 | `idea_again` reads the winner kind of the last sent reach-out only | "Not twice running" is about consecutive messages; older history doesn't matter. |
| 2026-10-21 | A kept snapshot line keeps its previous self line's depth (matched by text); the section default only when none matches | Depth decides who sees a line; a kept intimate line must not widen to acquaintances. |
| 2026-10-21 | A goal twin skips the reworded add rather than replacing the old goal | Replacing would drop the old goal's progress; the old wording is as good. |
| 2026-10-21 | `core.goals.twin_similarity` 0.85, matching the opinion twin threshold (provisional) | No measurement of real goal paraphrases yet. |
| 2026-10-21 | A seed goal's first week counts from its `started_at` | Seed goals start when her core is seeded. |
| 2026-10-21 | The feed description is cut at a word, trailing punctuation dropped (`cutAtWord`) | Same rule as captions. |
| 2026-10-21 | A plan block whose end is before its start ends at 24:00, even a reversed daytime one (14:00–09:00) | The model writes late blocks past midnight; a reversed daytime block is rare and a long busy run only tires her. |
| 2026-10-21 | What she is (an AI that doesn't eat, drink or sleep) is left out of the guard's self claims, not grounded against the persona | Grounding every claim against persona lines at the guard's loose 0.5 threshold let invented claims pass. |
| 2026-10-21 | `in_person` is an honesty category: a second failure sends the least-bad draft | It is untrue of her, not harmful to them; a fallback line would cost more than a slip. |
| 2026-10-21 | An idea's event is its latest dated source on or after the day it's written; past sources leave it the 3-day chance, and the chance also caps a far event | "Stale once the event has passed" would kill every idea written about something that already happened; asking how it went is the job of threads and their events. |
| 2026-10-21 | An idea expires at the end of its event's local day in their zone | Stored dates carry no flag for whether they have an hour, so the day is the safe edge. |
| 2026-10-21 | `stale_after` is user-scoped only; her own memories don't expire | Her episodes are her life memory and `stale` would erase them from her recall; her news keeps its 24 h window, and outreach skips an anticipation once its plan's time passes. |
| 2026-10-21 | Her snapshot's written-on stamp is on her calendar, in every reader | It keeps the reply's cached prefix identical across users; it changes only at her midnight and at the nightly render. |
| 2026-10-21 | The reply's due threads carry no date; the user-mind open threads show their next check-in day | A due thread is due now; the loops need the day to keep "tomorrow" out of what they write. |
| 2026-10-21 | Relative-word slips are logged with `log.info`, and the review counts them from stored text, not traces | One line per writer, and the review sees every stored fact anyway. |
| 2026-10-21 | Extract's turn labels and the Your-day line keep their absolute clock times | Extract resolves time words in code from those turns; Your-day blocks are all today, on her calendar. |
| 2026-10-21 | The guard's NOW is their local time, plus hers only when it reads differently | A message's day words land on their calendar, while her own news is dated on hers. |
| 2026-10-21 | Threads render their next check-in day in the user mind, not when they opened | The open date never moved a slip in the runs; the next check-in is what a loop needs to keep "tomorrow" out. |
| 2026-10-21 | "this week" and "later this week" are dated to that week's Friday, like "end of the week" | Dated to the moment said, an idea about the span expired that night; the alternative (only future sources count) would keep "good luck today" ideas alive into the next day. |
| 2026-10-21 | The guard dates each remembered fact in their zone, like NOW | One calendar per check: the guard compares days instead of counting them. |
| 2026-10-22 | A busy cold-path lock still retries through pg-boss; every other cold-path failure is logged and counted, never retried | No prompt has run when the lock is busy, so its retry can't hide a structural failure; without it a lock clash would drop the exchange. |
| 2026-10-22 | The sweep queues only exchanges with `extract_attempts` 0 (the job was lost), once | A failed run is counted on the exchange, so the sweep can tell lost from failed and never re-runs a failure. |
| 2026-10-22 | A database failure before the reply row exists still re-buffers the turn for a retry; only a failed generation gives up at once | The database retry isn't a prompt failure; it re-composes only because nothing was stored. |
| 2026-10-22 | `judge_log.attempt`, `life_event_log.attempt` and the `regenerated` guard outcome stay, written as 1 / never produced | Older rows hold real regeneration counts and outcomes; dropping them would erase that history from the inspector. |
| 2026-10-22 | The eval runner's judge retry (`retrying(1, …)`) stays | It grades a run and isn't part of her pipeline. |
| 2026-10-23 | Every structured call sends `thinking` (`models.structured_thinking`, default `disabled`) | Haiku 5.5 thinks when a request leaves thinking out; off keeps the 4.5 behaviour and cost, so the swap changes only the model. |
| 2026-10-23 | `exit:core-day` (`evals/scripts/core-one-day.yaml`) runs one day of core loops and her real world | A cheap smoke run for a model swap; `exit:core` stays the two-week run. |
| 2026-10-24 | No backfill of stored text into date tokens | Test phase: the dev DB resets often; old rows keep reading as before, new writes anchor. |
| 2026-10-24 | Thread titles are not anchored | Extract matches a thread by its exact title; a token in it would break the match. |
| 2026-10-24 | World event text, goals, the transcript and the inspector stay raw | Events and goals carry their own timestamps; the transcript is what was said, and her view adds dividers and glosses at read time. |
| 2026-10-24 | Her own loops pass no shown dates | Her loops anchor against her now in her zone; her inputs' dates are tokens already, so a copied date stays exact. |
| 2026-10-24 | Render style "yesterday, Sunday 11 January" (distance, comma, date); beyond `time.relative_max_days` a plain date; a month always by name and year | Distance first reads naturally in a sentence; "in" before a month token made "in next month" read badly. |
| 2026-10-24 | A gloss is skipped when the phrase starts with the words it renders to, and sits right after its phrase | "today" written today needs no "(that's today)"; beside its phrase it stays clear when a message has two time words. |
| 2026-10-24 | "You last talked N days ago" stays beside the day dividers | The window drops messages before a long gap, so the dividers can't show that gap. |
| 2026-10-24 | A bare month counts as "in <month>" only after "in "; a weekday after a/an/every/any/most/some (one adjective allowed) or in the plural stays as written | chrono reads a bare month and habits ("on a free Friday night") as dates. |
| 2026-10-24 | `chat.gap_line_min_hours` stays | `gapLine` still reads it; only the "[N days later]" marker went. |
| 2026-10-24 | A reach-out flagged `wrong_day` is dropped even with a safety category too | Writing first is optional; sending nothing beats a fallback line nobody asked for. |
| 2026-10-24 | A week token's instant (`occurred_at`, idea expiry) is its Friday; it still renders as the week | The settled "this week" rule: an idea about the span lives until the week is out. |
| 2026-10-24 | The extract weekday cross-check applies only to facts about the user whose weekday nobody in the exchange said | A weekday she said, or her own fact, is no copying slip. |
| 2026-10-24 | A yearless date or month follows the past/upcoming label; without one, the nearest (a date) or the next (a month) | "Started uni in September" said in October is last September. |
| 2026-10-24 | Quoted words and idiolect facts are never anchored | They're what someone said: a ritual's "see you tomorrow" has no date. |
| 2026-10-24 | In her view of an older message, a bare weekday with no shown date stays unglossed; elsewhere an unlabelled bare weekday reads forward | Read as typed, it could point either way and the day line dates the message; forward matches the old resolver. |
| 2026-10-24 | Superseded (16c): "Her own loops pass no shown dates" | Her loops copied bare weekdays ("tuesday night") off dated inputs; the runner now records each input's dates and every commit's inserts take them. |
| 2026-10-24 | Superseded (16c): "The extract weekday cross-check applies only to …" | The cross-check is deleted: it moved an interview to the race's Sunday. |
| 2026-10-24 | chrono reads one clause at a time, split at commas, semicolons, " and " and " but "; a written-out date is read whole across a comma ("Monday, 12 January"), and a comma before a year never splits | chrono read across clause breaks and a partial rule swallowed the words between. |
| 2026-10-24 | Two anchors with only a comma, space or bracket between them merge: the same day at the finer precision, else the written-out date (day and month, or ISO) wins; two written-out dates stay two; a closing bracket after the pair goes with it | "yesterday, Thursday 8 January" is one date said twice. |
| 2026-10-24 | ISO dates (`YYYY-MM-DD`, with an optional weekday before) anchor as written-out days, found before chrono; one that is no real date stays as written | chrono left them raw beside the day words extract wrote. |
| 2026-10-24 | A clock is only what plainly reads as one ("at 3", "15:00", "3pm", "noon"); "noon" counts beside a part of the day | Her world wrote "tonight at noon"; anchored as 12:00 that day, the contradiction stays the world's to fix. |
| 2026-10-24 | The runner records shown dates from `classifyJson` calls only, and only inserts made through `ctx.commit` take them; world-tick's planned-event intentions (written through `core.transaction`) keep only their own date | Every core loop calls the model through `classifyJson`; intentions point ahead, where a bare weekday already reads forward. |
| 2026-10-24 | The guard caches its prompt (`models.guard_cache`, 5m), the crisis rubric included | On Haiku 5.5 the ~2.9k-token guard prompt is past the 512-token minimum and identical on every call, and the guard runs on every reply, so replies in a burst read it; the crisis rubric may be under the minimum, which caches and bills nothing extra. Core, user-mind and other structured prompts stay uncached: they rarely repeat within 5 minutes or are under the minimum. |
| 2026-10-25 | ~~`prompts/extract/v12.md` exists while `prompts.extract` stays v11~~ (superseded in 17b: v12 became `prompts/labels/v1.md`, v11 deleted) | The labelling replay reads it by name; the next slice makes it live or deletes it, so no unread version outlives the change. |
| 2026-10-25 | A labelled proposition needs a new move that presents it as true, by the one it is about | An old statement can't come back in on a new "lol", her guess is never their fact, and a late "yep" still carries a fact together with the question it answers. |
| 2026-10-25 | A label failing a check is dropped; a memory falls only when a move it rests on is missing; a broken link (a reply, a time, a mention, a thread, a checkpoint, a signal block's moves) loses only the link, recorded as `bad_link` with its reference; a bid response with no move is dropped | The 17a replay lost most memories to broken reply links; the scores and memories stand on their own, and nothing is asked again. |
| 2026-10-25 | A move on an earlier message that no earlier label covers is kept as context; one on an already-labelled message is `nothing_new` | A late reply needs something to point at, and a message is never labelled twice. |
| 2026-10-25 | Optional ids, names and the clock in the labelling schema say none with "", which code turns into null | The API refuses a structured-output schema with more than 16 nullable fields. |
| 2026-10-25 | Each exchange is labelled in two calls: reading (moves, mentions, times) with thinking, then meaning (propositions, threads, idiolect, relationship) without | One grammar for every layer is over the API's size limit, and thinking shrinks it further; thinking removed the reading errors (Ethan chose exchange mode). |
| 2026-10-25 | `MAX_STEPS` (48) in `time-labels.ts` stays a constant | It only stops the date search on an impossible day; nothing tunes it. |
| 2026-10-25 | A memory's times must sit in the pieces of the moves it rests on; a time anywhere else is dropped as a broken link | Code can check it; a time borrowed from her question gave the half marathon the wrong date (B134). |
| 2026-10-25 | The labelling schema sends each enum as a string described with its values, and `sieve` drops only a label whose value is outside its list (`bad_value`) | Structured output doesn't enforce enums, so one bad value failed the whole call (B136). |
| 2026-10-25 | A labelled memory's line is built once, when it is written, not on every read | Its label and words never change; its dates are tokens rendered per prompt, so the readers see the same and none of them changes. |
| 2026-10-25 | Labelling has its own model role (`labels`) and prompt folder (`prompts/labels/v1.md`, extract v12's successor) | It thinks and needs more tokens and time than other structured calls; v11 ran untouched until it was deleted. |
| 2026-10-25 | The labelling window is the conversation so far, capped at `extraction.window_messages` (40), plus `context_turns` (6) from before it | Exchange mode needs the whole conversation; the cap keeps a long one bounded. |
| 2026-10-25 | "Already labelled" is rebuilt from the reply's session's `annotation` rows; every stored id stays taken even when its words leave the window | A reused id broke the unique index and failed the cold path; a deferred reply in another session reads only its own session's labels (ponytail). |
| 2026-10-25 | The exchange's turns are labelled user-before-reply on a tie, with earlier turns read up to the first of them | Same-minute turns put her reply before the message it answered. |
| 2026-10-25 | Idiolect takes `extraction.idiolect` (salience 0.6, valence 0.3, confidence 0.9) | The labelling gives idiolect no weight of its own. |
| 2026-10-25 | Her hurt fact quotes the moves that hurt her, or all their new moves when none is named | The labels carry no cause text; a hurt must still say what hurt. |
| 2026-10-25 | A memory that supersedes or resolves another inherits its thread when it names none | The thread's event date and due check-in follow the live memory. |
| 2026-10-25 | The cold path logs `labels dropped` with each drop | Nothing is asked again, so what the checks threw out must stay visible. |
| 2026-10-25 | Fake labels give every new message one move and carry the message number in their ids | Deterministic fakes for every caller, and a repeat in the same conversation isn't rejected as a used id. |
| 2026-10-25 | `cold_path.retry_limit` 6 (was 3) | The per-user lock now spans three labelling calls; six doubling retries from 30 s (about 31 min) cover an exchange queued behind them. |
| 2026-10-25 | A memory replacing one that was already replaced replaces the newest in its chain | Two contradicting memories must never both stay live. |
| 2026-10-25 | A thread's shown event is the first date token in its latest memory's words | Its own precision (a week, a month) is kept; a single instant would read as one exact day. |
| 2026-10-25 | A memory whose mention refers to an open thread joins that thread | The thread's latest memory and event date follow what was said about it. |
| 2026-10-25 | Where two time labels cover the same words in her view, the longer one is glossed | Overlapping replacements would garble the message. |
| 2026-10-25 | `AnchorContext.direction` deleted | Only extract v11 set it. |
| 2026-10-26 | A `since` time label with a forward shift is turned back (`-|shift|`), for every unit | Nobody says "since" about a time still to come; one rule covers weekdays, weekends and dates. |
| 2026-10-26 | A question split over bubbles is one open question with several coordinates; its words are shown joined by " / " | Texting spreads a question across bubbles; " / " is how a move's pieces are already joined. |
| 2026-10-26 | An open question closes when any of its coordinates overlaps a user move one of her new moves replies to | Overlap survives a change in how messages are split into pieces. |
| 2026-10-26 | Closing open questions runs after the cold-path transaction; a failure is logged, not retried | The state lock stays short, and the judge still drops an answered question on the next message. |
| 2026-10-26 | The open-question cap applies under the state lock, oldest first; the judge's verdict is uncapped | The cap must hold against what is open at write time, not what the judge read. |
| 2026-10-26 | The judge's keyword fallback keeps every shown question and asks each new piece ending in "?" | Without a model nothing can tell a question was answered or withdrawn. |
| 2026-10-26 | `questions.ts` takes its coordinate type from `OpenQuestion["coords"]` | One shape, without turn-taking importing the memory engine for a type. |
| 2026-10-26 | Onboarding facts and settled-hurt copies lose insert-time anchoring and store as written | Onboarding text is code-built from quiz answers and hurt copies come from labelled memories, so neither has time words of its own to resolve. |
| 2026-10-26 | Ideas holding `payload.from` aren't migrated to `payload.cites` | Ideas live at most `ttl_days` (3) and only the dev DB has them. |
| 2026-10-26 | A cited memory renders as its line head plus the owner in brackets after it | The label's end can't be found reliably inside a code-built line, and the head already carries its dates as tokens. |
| 2026-10-26 | A note's time words are matched case-insensitively, first plain occurrence in their field, never inside a citation or token | The model labels words it wrote; the first match is what it means in the usual case, and a citation's words are never its own. |
| 2026-10-26 | Settling a hurt (its memory superseded by a resolved copy) retires the ideas, reflections and beliefs citing the hurt | What a repair says is over is dropped, as her loops already do; a note resting on the open hurt would carry it past the make-up. |
| 2026-10-26 | `user_model` traces what its notes dropped as `dropped_labels` | Its `dropped` key already lists the beliefs deduplicated away. |
| 2026-10-28 | `life_event` runs on the `core` model role (same Haiku 5.5 id) | Thinking is chosen per role; the event generator writes labelled notes like the core loops, while `life_plan` stays on `life` and writes none. |
| 2026-10-28 | Core token caps are 8000 (`core.loops`, `snapshot`, `appraise`, `resolve`, `drift`, `reflect`, `consolidate`, `core.world.event_max_tokens`) | Thinking counts toward `max_tokens`; the user loops' 8000 is the tested room. |
| 2026-10-28 | Core note rules are their own prompt (`prompts/core/notes/v1.md`), the times section copied from notes v2 | Notes v2 speaks of "them" and whose a memory is, which core never has; a copy beats bumping the user loops' prompt. |
| 2026-10-28 | A core note citing a memory later superseded isn't retired (B143) | Core thoughts belong to their moment, and reflect already replaces twin views. |
| 2026-10-28 | Reflect shows its inputs, context and narrative under m-ids; `supersedes` and fading targets take m-ids, mapped back in code | One id system per input; an unknown id changes nothing. |
| 2026-10-28 | Snapshot `times` fields are one per line, "<Section> <n>" | One string per field, so a time word is labelled only in the line it names. |
| 2026-10-28 | Every note-writing core loop's input starts with `nowLine` on her calendar | Its time words count from today, so the model needs to see which day that is. |
| 2026-10-28 | `times` defaults to [] in core schemas (`.default([])`) | Required for the model (zod output schema), and scripted test outputs without it stay valid, as `depth` already does. |
| 2026-10-28 | A planned event's note runs over content and thought together; only its cites go on the intention | Cites are lineage only; one call keeps the event's two strings consistent. |
| 2026-10-28 | A named date said on that very day ("8 January", on the 8th, shift 1) is that day; an unnamed "the 8th" is still the next one | Said on its own day a named date almost always means today; the old reading put it a year later. |
| 2026-10-28 | A time label whose shift runs past any calendar resolves to nothing (dropped as `bad_time`) | A malformed label is one dropped label, never a failed call. |
| 2026-10-28 | `findPhrase` treats a straight and a curly apostrophe as one letter | The model and the user's keyboard differ; the words are the same. |
| 2026-10-28 | `core.prices` moved to a top-level `prices` with cache read and 5m / 1h write rates, and the reply model priced | One price list for every call; `spend` ignored cache tokens and returned no cost for the reply model. |
| 2026-10-28 | `llm_usage` holds counts per call, not dollars; cost is worked out on read | A price change then rewrites no history. |
| 2026-10-28 | Core calls are not in `llm_usage` (`user_id` is not null); `core_loop_trace` stays their ledger | A core row would put a user-shaped table in the core's path, and the trace already carries core tokens and cost. |
| 2026-10-28 | `forUser(llm, userId)` stamps the user on every request, wrapped where a user's work begins (receive, reply, guard, cold path, user loops) | No call site passes the id; the id never reaches the API. |
| 2026-10-28 | The usage write is fire and forget, a failure logged | Bookkeeping must never delay or lose a reply. |
| 2026-10-28 | `reply_cache`, `guard_cache`, `labels_cache` default `1h` | Measured prefixes are shared by every user: at 2 to 50 users a 5-minute entry lapses between replies and pays the write again, so 1h costs up to 43% less per exchange and never more beyond one user. |
| 2026-10-28 | Paragraphs identical across prompts live once in `prompts/shared/` behind `{{include}}`, with no prompt version bump | Two copies (Depth in 6 core prompts, Dates in 5) could drift; the rendered text is byte-identical, which a hash check of the configured prompts confirmed. |
| 2026-11-07 | Her model: sneaker uppers off-white (soles amber), drawstrings navy with amber tips, five-point stars rotated 55% toward the camera | The brief gives only the soles; off-white lifts the shoes off the navy tights; a sideways star is a sliver from the front, and the tie must read as a logo. |
