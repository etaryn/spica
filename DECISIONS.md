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
| 2026-10-09 | User loops reuse `core.prices` and `core.max_retries` | Same models and API, so one price table and one retry policy; a separate set would only drift. |
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
