# Spica v3 spec: history

What moved out of `spica-design-spec-v3.md` to keep it short. Nothing here is dropped; it is the record behind the spec, not a design source.

## Built phases (from §20)

| Phase | Built |
|---|---|
| 0. Skeleton | Chat UI, auth, session log, schema, crisis check, inspector, eval harness |
| 1. Memory engine | Extraction, reconcile, weighted retrieval, recall reinforcement, decay, threads and checkpoints, memory view |
| 2. Guardrails | Guard layer, fallback lines, guard tests (guard now off) |
| 3. Turn-taking and pacing | Buffer, judge, backchannels, pacing, SSE |
| 4. Relationship | Homeostatic params, hurt, tension, make-up, ending and repair |
| 5. Life sim, availability, ego | Shared day plan, per-user events and ego, availability deferral |
| 6. Proactive outreach | Candidates, send gate, compose, Web Push |
| 7. Mind split | Core scope and the core-only data layer (`CoreDeps`, no `db`); `core_state` (ego moved to core, ticked hourly); world reads from the day plan (`life_tick` retired); core events made once by `core_world_tick`; user affect params; "what she told this user"; persona split into core values and seed self, `core_snapshot` v0; reply assembly order (§10.3); inspector Core tab; leak canary and side channel as `tests/exit/mind-split.test.ts` (`pnpm test` 99 files / 664 tests at close) |
| 8a. Core foundation | Core appraisal, goals and needs, loop runner, traces and daily call budget |
| 8b. World and hourly thinking | Goal-selected events, same-tick plan resolution, B51 target closure, anticipation, rumination, downtime wandering and hourly `core_mind_tick`; deterministic exit and canary (`tests/exit/phase-8b.test.ts`, `tests/exit/mind-split.test.ts`). Full fourteen-day Phase 8 exit remains 8d. |
| 8c. Core nightly | Nightly reflect, core decay and gist, self snapshot rendering and lines, diagnostic drift watch, hourly `core_nightly`; deterministic two-night exit and canary (`tests/exit/phase-8c.test.ts`, `tests/exit/mind-split.test.ts`). |
| 8d. Core integration | Mood- and goal-biased core recall, the claim line (reply v11, extract v5 `claim_kind`, cold-path grounding against core), inspector Core tab (budget, goals, snapshot changes, drift), the fourteen-day exit all-fake (`tests/exit/core-loops.test.ts`, with a budget-6 case) and real-core (`pnpm exit:core`), canary over every core loop. Phase 8 built (`pnpm test` 118 files / 910 tests at close); the first real-core run fails its structural checks (B61) |
| 9a. User mind foundation | `user_mind_run` and `user_loop_trace` (migration 0024), the four big-event triggers and the daily cap, `runUserLoop` sharing the core runner's metering, `user_summarise`, the `summary` fact kind (outside retrieval, reconcile and decay), the "Where things stand with them" reply slot, the sweep inside `cold_path_sweep`, evals (`pnpm exit:user`), exit `tests/exit/phase-9a.test.ts` and the canary over `user_summarise`. `pnpm test` 125 files / 973 tests at close |
| 9b. Reflect and ideate | `fact_kind` gains `reflection` and `idea` (migration 0025) with their retrieval, reconcile, decay and memory-view rules; the run's inputs read once; `user_reflect` and `user_ideate` in the batch of three; the "Things you want to bring up" slot with one chance per idea; outreach `core_thought` and `user_idea` candidates; reach-out prompt v2; B26 fixed; exit `tests/exit/phase-9b.test.ts`, the canary over `user_reflect` and `user_ideate`, and real reflect and ideate calls in `pnpm exit:user`. `pnpm test` 128 files / 1010 tests at close |
| 9c. Triggers and crisis-aware user mind | `long_conversation` and `crisis_passed` from the hourly `user_mind_tick` (which took over the pending-run sweep), `stale_summary` from the outreach tick with a send lead; crisis memories reach summarise and reflect with the sensitive mark carried forward, never ideate or a reach-out; the reply window trimmed at a 72-hour gap (B2); the "what I remember" view and per-fact forget removed (B72); inspector User mind tab; exit `tests/exit/phase-9c.test.ts` with the crisis canary. `pnpm test` 130 files / 1028 tests at close |
| 9d. Consolidate, model and the Phase 9 exit | `fact_kind` gains `episode`, `model` and `belief` (migration 0026); `user_consolidate` folds an older week into one gist; `user_model` keeps her live read on them and revisable beliefs; the batch of five; "Your read on them" reply slot; ideate reads the newest non-sensitive read (ideate prompt v2); inspector read and beliefs; the eval life loop runs `user_mind_tick` hourly and scripts take `idle_users`; the full Phase 9 exit `tests/exit/user-mind.test.ts` (two weeks, three users, every trigger, the canary); `pnpm exit:user` runs `user-mind-two-weeks` with real model and consolidate. Phase 9 built (`pnpm test` 133 files / 1060 tests at close) |
| 10a. How closeness grows | Extraction v6 reads the user's disclosure and responsiveness (params `user_disclosure`, `user_responsiveness`); her openness decided in code before every reply and reach-out, stored on `session_log.openness` and phrased in the "How open you feel" slot (reply v12, `prompts/relationship/openness/v1.md`); closeness grows only from intimacy moments under a ceiling set by hours together (migration 0027: `hours_together`, `session`); per-session afterglow and the deep-session boost (B62); `closeness_per_warm_exchange` deleted; inspector hours, ceiling and openness; exit `tests/exit/phase-10a.test.ts` (all three levels with short hours, the canary); `pnpm exit:intimacy`. `pnpm test` 136 files / 1095 tests at close |
| 10b. How deep she goes | Depth on core memories and self lines (migration 0028, backfill by kind), judged by every memory-writing core loop (prompts v2) and snapshot render v2; `depthFor` limits from closeness, reciprocity and chemistry; hint, open and held-back offers; "Who you are lately" trimmed to the usual limit; `session_log.depth`; the `disclosure` ledger via `groundingMatch`; common-ground marks; outreach `too_deep`; reply v13; inspector ledger; exit `tests/exit/phase-10b.test.ts` (the canary); `pnpm exit:disclosure`. `pnpm test` 140 files / 1141 tests at close |
| 10c. Bids and idiolect | `fact_kind` gains `idiolect`, `relationship_cause` gains `bid` (migration 0029); extraction v7 reads `bid_response` (kept only within the idle gap after her last message) and idiolect facts with their type and who started them; `relationship.bids.effects` moves warmth and trust; idiolect established by a duplicate from a later exchange; "Your things together" slot gated by `relationship.idiolect`; reply v14; inspector idiolect table; exit `tests/exit/phase-10c.test.ts` (the canary); `pnpm exit:idiolect`. `pnpm test` 145 files / 1167 tests at close |
| 10d. Stages, commitment, firsts | Knapp's ten stages as a sticky peak plus a coming-apart overlay (migration 0031: `peak_stage`, `apart_stage`, `milestones`, the `commitment` param); depth and idiolect reuse gated by the stage (`depth.bands`, `idiolect.min_closeness` deleted); "Where you are with them" (reply v15); rekindle; commitment from satisfaction and investment, softening impact and speeding recovery; the `milestone` big event; inspector stage and milestones; exit `tests/exit/phase-10d.test.ts` (the canary); `pnpm exit:stages`. Phase 10 built (`pnpm test` 149 files / 1203 tests at close) |
| 11. Onboarding | The profile card swap: quiz file v1 (six friend dimensions, 12 choice and 3 open questions), the `onboarding` table (migration 0032), `submitCard` writing both cards as light memories with the name floor, common topics worked out at submit, the compatibility page, the `/chat` gate, the card mark (reply v16); exit `tests/exit/phase-11.test.ts` (the canary). `pnpm test` 154 files / 1230 tests at close |
| 12. Extension stubs | The module bus (`deps.modules`, `CoreDeps.emitCore`) with the seven events after commit, the scope rule (a core module hears core events only), in-process delivery; `publicPersona` (her day, surface self, public voice; no deeper thoughts) and the `SocialChannel` stub; an empty module list; exit `tests/exit/phase-12.test.ts` (sample modules in the test only, the canary). `pnpm test` 161 files / 1259 tests at close |
| 13. Guard re-enable and calibration | The line in §2 (rules 1, 4, 6 and 8 back, settling §21 #10 and #11); `guard.enabled: true`; guard prompt v2 with `self_claims`, corrective v2, fallback v2 (no hotline numbers); `invented_self` grounded against core at `guard.self_claim_similarity`; a crisis keeps tension (B73); a pending ending adds `relationship.ending_hurt` (B78); fixtures rewritten as allowed/blocked pairs, `rule2-hurt` and `invented-self` files, reach-out file live (B36–B39, B60); calibration with `pnpm calibrate:guard` and `pnpm calibrate:guard-replay`, labelled with Ethan; `pnpm eval:guard` 85/85 on the calibrated run (single boundary cases vary 2/3 run to run, B37); exit `tests/exit/phase-13.test.ts` (the canary). `pnpm test` 172 files / 1339 tests after merging Phase 14 |
| 14. Public presence: post engine (stills) | Browsing as an `action` world event and `web_find`, formats and pose sprites, the craft skill, `post_tick`, `sharp` render, draft and check, inspector approval (§16a); persona v6 (draft lines); `tests/exit/phase-14.test.ts`. `pnpm test` 171 files / 1315 tests at close |
| 15a. Tuning: her voice | `textingShape` (bubble length, formality and emoji from the user's last `voice.window_messages` messages, blended from base Spica), `pickMove` (react/share/ask by seeded weighted chance, tilted by mood keys), the "How to text this one" section (`prompts/voice/how-to-text/v1.md`), `shapeText` after the guard (form only), reply v17 (texting rhythm, short feelings, named recall, one memory), turn-judge v2 and the backchannel rule list, `core-state/line` v4 capped and ranked, `relationship/summary` v3, the voice report and `pnpm review:voice` (blind X/Y), `voice-texting-styles` review script; B3, B32, B33, B57 done, B35 in part, B34 to *Frontend*; exit `tests/exit/phase-15a.test.ts` (the canary). `pnpm test` 180 files / 1395 tests at close |
| 15b. Tuning: negative situations | One anchored 0–1 scale for hurt and tension in extraction v8 (0 nothing, 1 grounds for ending a friendship), gains 1, scars judged on the hurt itself at 0.75; make-up and coming-apart thresholds re-anchored to the scale; commitment cushions only slights (`commitment.soften_below`); endings scored with `relationship.ending_hurt_floor` (0.5), `ending_hurt` deleted, a warm exchange can't restart a pending ending, no make-up reach-out while one is pending; the guard tags `pointed` remarks (`session_log.pointed`, migration 0034) and guard v3 counts them once per occasion; outage keywords by category; regressions by status only; `pnpm review:signals` and the `signal-*` probes; B14, B91, B115, B15, B113, B37, B40 done; exit `tests/exit/phase-15b.test.ts` (the canary). `pnpm test` 182 files / 1421 tests at close |
| 15c. Tuning: memory, relationship, user mind | A repair (hurt below `user_mind.triggers.hurt_resolved`) is a big event and turns the hurt memory past; the user-mind loops take stock plainly (summarise/model/reflect v2, ideate v3), read nothing sensitive outside a crisis window, read unread facts per chain and skip reflect/ideate with none; `msgs_per_day` is her estimate (`relationship_param.samples`, migration 0035, `rate_estimate_days`); dates resolved in code from `when` (chrono-node, extract v9), plans always stored; gender at signup (`user.gender`, migration 0036) as a full-weight card fact, reply v18 pronouns; reconcile contradiction band (v2); false-recall judge v9 with a quote filter, consistency v3; jokes need a later session, milestones skip the cap, reach-out depth rechecked at send; `seed_hours_together`, `review:reconcile`, `review:extract`, `review:user-mind`; B4, B5, B38, B41, B67, B70, B71, B81, B83, B85, B86, B87, B90, B92 done; exit `tests/exit/phase-15c.test.ts` (the canary). `pnpm test` 187 files / 1472 tests at close |
| 15d. Tuning: world, outreach, posts | Her plain news is surface and outranks ideas (`her_day` weight 1.0, their things sort first, a too-deep episode falls back to its world event); reach-outs carry dated notes, theirs in their zone and hers in hers (`relativeDate`/`dayInWords`, `outreach.reason_facts`), the reason last and repeated in the cue (reach-out v3), and the guard sees NOW and the reason (guard v4); a thread is keyed on their newest fact so it goes out once; her own rate scales readiness (`outreach.her_rate`, B117); jitter 59; "Your day" lists what happened today; events drawn about code-picked subjects with recent ones down-weighted (`world_event.subject`, migration 0037, event v5 one plain sentence); plans must differ from yesterday (plan v2); wander starts from a cue picked in code; the night is one quiet block (`joinNight`); captions state their length and cut at a word (draft v2), check v2 allows her moods; ESO and NOIRLab weekly pictures replace APOD, a repeated image skipped by hash (`web_find.image_sha256`, migration 0038); the craft skill is `posts.craft_skill` (Ethan's) and the craft goal can't be dropped or moved by her loops; eval tooling: real runs dump the DB and trace, reach-out ticks in the review, a simulated user (`sim_user`); B18, B19, B20, B24, B25, B29, B108–B111, B117 done; exit `tests/exit/phase-15d.test.ts` (the canary). `pnpm test` 190 files / 1517 tests at close; run fixes 2026-10-19 (its design doc is in git: "this week", last weekly slot kept for them, dated thread notes first, wander through lived memory, reflect twins, she lives online, one night held, publication-size pictures, sim-user v2, guard date cases), 190 files / 1537 tests |
| No night (2026-10-20) | She's an AI with a digital body, so she has no night (Ethan). Energy is a battery `core_state_tick` moves by the past hour (`core.state.energy.*`: busy drain 0.12/h, free 0.005/h, offline 0.15/h); below `core.state.offline.enter` (0.2) she logs off (`core_state.offline_since`, migration 0039) until `exit` (0.6). Her offline time is one block (`offline#<iso>`, busy 0.9, ending at `estimatedBack`) for availability, "Your day", outreach G3, wander, browse and posts; plans are busy and downtime at any hour (plan v4, fallback two busy blocks), availability notes v2; browse at any free minute; the new `their_night` gate (23–08 in their timezone, UTC fallback; B23 partly done); removed: the quiet kind, `joinNight`, the night hold, the rhythm keys, `browse_window`, the `avail-quiet` script; exit `tests/exit/no-night.test.ts` (the canary). `pnpm test` 191 files / 1548 tests at close; review-run tuning 2026-10-21 (free recovery 0.02, plan v5 busy-only with moving hours, ideas carry the dated facts they're about and can't win twice running), 191 files / 1555 tests; rerun prep 2026-10-21 (its design doc is in git: an emptied snapshot section keeps last night's lines at their depths, near-twin goals merge and seed goals keep a week, user-mind loops see now and memory dates and write their reads as her impressions, ideas reset on their reply, captions see the feed's description, judge timeout 5 s), 191 files / 1567 tests; Phase 15 close 2026-10-21 (after the rerun: log off at `offline.enter` 0.3, a plan block past midnight cut to 24:00, persona v7 says she can't meet in person or sleep, guard v5 adds `in_person` and leaves what she is out of self claims, ideate v5, `evals/guard/in-person.yaml`; relative dates and stale ideas go to Phase 16 as B125/B126); close runs 2026-10-21: `review:world-outreach` all 16 plans from the model (4 cut at midnight), tired 0.4 h/day, 10 log-offs of 2–3 h, no in-person offers, relative-date slips remain (Phase 16); `eval:guard` 91/94 (in-person offer and agree caught 3/3; its text-support twin over-flagged, B127; `callback-tally` and `misdated-this-morning` 1/3) |
| 16. Time model (2026-10-21) | Times stored as data and rendered by code, never counted by a model: `platform/relative-date.ts` adds `writtenOn`, `stamped`, `itemWhen` (day and distance, plus when she learned it if another day), `relativeWords` and `noteRelativeWords` (slips are logged, never retried), and `zoneOrUtc`. User-mind inputs render each memory's `when`, stamp her notes with `written` and threads with their next check-in, and read her snapshot headed by its night (summarise v4, reflect v4, model v4, ideate v6). Her loops read dated memories and a stamped self (`memory/core/self.ts` `latestSelf`; appraise, anticipate, ruminate, wander, reflect, snapshot v3). The reply stamps her snapshot (on her calendar, so the cached prefix is shared), summary, read and ideas, and dates each fact with `itemWhen` (`RetrievedFact.noted`). `fact.stale_after` (migration 0041, open ideas backfilled at 3 days): an idea expires at the end of the local day of its latest dated source on or after the day it's written, never later than `ttl_days`; `decay_pass` retires open facts past it; `liveIdeas(db, user, now, n)` and the send recheck read it; `ideaCutoff` deleted. An anticipation past its plan's `event_at` is no `core_thought` candidate. Guard v6: NOW in their zone plus hers when it differs (`guardNow`), a misdated day is `invented_detail`, text support isn't `in_person`; eval case `stale-tonight`. The review lists relative words in stored text and in her loops. Exit `tests/exit/phase-16.test.ts` (the canary). `pnpm test` 193 files / 1598 tests at close. B125, B126, B127 done. |
| 16b. Time anchors (2026-10-24) | One date system, settled item by item with Ethan. `platform/time-anchors.ts` replaces `relative-date.ts`: `anchorTimes` (chrono-node plus passes for durations, weeks and weekends; habits like "every Friday" stay as written) turns each time phrase into a token `⟦local|precision|zone⟧`; `renderTimes` reads it on any later day ("yesterday, Sunday 11 January"; beyond `time.relative_max_days` (6) a plain date; months by name), `renderAbsolute` for reviews. The repos anchor every write (`insertFact` in the user's zone; core `memory.insert` and `insertSnapshot` in hers via `createCoreLayer(db, zone)`); builders place tokens on their owner's calendar; `withTimeRendering` (`platform/llm/render-net.ts`) renders them where prompts reach the model, so no raw token reaches one. One date per memory (`ownDate`; `RetrievedFact.noted`, `guardNow`, `itemWhen`, `noteRelativeWords` gone). Extract v10: time words kept as said with `when_direction`, anchored at their message's send time, weekday cross-checked against their message (`anchorExtraction`; `when.ts`, `{when}` and the model's dates gone). Writers' bare weekdays take the dates they were shown (`shownDates`); an idea's own dates set `stale_after`; snapshot items anchored once. Her view of the conversation: day dividers and glosses from each message's send time (`viewTurns`; the "[N days later]" marker gone; reply v19). Reach-out v4 framing (`eventDay`: ahead, today, past); guard v7 `wrong_day` drops a misdated reach-out (`guard_outcome` `dropped`, migration 0042). Prompts: summarise, reflect, model v5, ideate v7, core appraise, anticipate, ruminate, wander, reflect, snapshot v4. No backfill. Exit `tests/exit/phase-16b.test.ts` (the canary, no raw token reaches a model). |
| No retries (2026-10-22) | No prompt is retried or regenerated after a failure, so a structural failure shows instead of being rewritten away (Ethan). The guard checks once (an error falls to the keyword check) and never re-asks for a draft: a safety flag sends the fallback line, an honesty-only flag sends the draft as `sent_with_violation` (corrective prompt and `guard.retry_limit` deleted); the day plan gets one try, then the fallback plan (`life.plan_attempts` deleted); each drawn event gets one candidate and a rejected one leaves its slot empty (life/event v7, `core.world.regen_attempts` deleted); a failed reply composition gives up at once; a failed cold path is logged and counted on its reply turn, never re-run, and the sweep picks only exchanges whose job was lost (`cold_path.max_sweep_attempts` deleted). Kept: SDK transport retries, the busy-lock and DB-failure retries, the eval judge retry, the old attempt columns and `regenerated` enum value. `pnpm test` 193 files / 1589 tests at close (`afcd05d`) |
| 16c. Time anchor fixes (2026-10-24) | The 16b close run's date bugs, fixed as Ethan chose item by item. `anchorTimes`' chrono pass reads one clause at a time (split at commas, semicolons, "and", "but") and a written-out date only whole (`DATE_PHRASE`), so no word is swallowed; ISO dates anchor as written-out days; two anchors with only a comma, space or bracket between them merge (`merged`: same day at the finer precision, else the written-out one wins; two written-out dates stay two). A part of the day with a clock time ("tonight at 20:45", "tonight at noon") anchors as a `time` token. Extract's weekday cross-check is deleted (`WEEKDAY_WORD`, `weekdaysIn`, its log line); extract v11 adds no date or weekday they didn't say. `insertFact` and core `memory.insert` count the row's own `occurred_at` as a shown date. `runCoreLoop` records the dates in each input a loop sends (`LoopContext.shown()`) and hands them to every `memory.insert` in its commit and to the snapshot's item anchoring; appraise carries its own (`Appraisal.shown`). Replay of the 16b run's 618 output texts: lost words 3→1 (left: "in three days from Saturday", a compound offset stored as two dates; deferred), doubled tokens 7→0, relative words left 4→0. From the final review: a clock is only what plainly reads as one ("at 3", "15:00", "3pm", "noon"), so a date's day number never is; a comma before a year doesn't split a clause; an impossible ISO date stays as written. Exit `tests/exit/phase-16c.test.ts` (wander shown Tuesday 6 January stores "tuesday night" on it; the canary through a real wander run). T8 waits for B128; N1/N2 are in B1. |

## Done backlog items (from §25)

### 25.1 Memory and recall

- **B2.** ~~Stale and deleted facts stay reachable through the recent-turns
  window.~~ Done 9c: the window drops turns before a 72-hour gap (§10.3).
- **B3.** ~~Recall style.~~ Done 15a: reply v17 names a memory that's the topic, brings up an
  unrelated one only as a real follow-up, at most one per reply; `recall-pet` and
  `recall-sister-uni` lose their `known_failure`.
- **B4.** ~~`contradiction-job` invented details.~~ Done 15c (Ethan, 2026-10-16): no invented details about the superseded fact in 3/3 real annotated runs; the stale `known_failure` is gone.
- **B5.** ~~Reconcile misses low-similarity contradictions.~~ Done 15c (Ethan, 2026-10-16): a contradiction band (`reconcile.contradiction_similarity`, 0.75) below the near line, where a `[distant]` memory can only be contradicted (reconcile v2), for both minds; `pnpm review:reconcile` reads the false-replace rate.

### 25.3 Relationship

- **B90.** ~~Bonding pace.~~ Done 15c (Ethan, 2026-10-16): pace kept (friends after ~25 hours of chat, close after ~80, from the 50/90/200-hour research), the slow commitment average kept; `rel-stages` seeds `seed_hours_together` so its review moves.
- **B92.** ~~A capped run can swallow a milestone.~~ Done 15c (Ethan, 2026-10-16): a run with a milestone trigger skips the daily cap.
- **B91.** ~~Commitment softens impact against the no-forgiveness default.~~
  Done 15b (Ethan, 2026-10-15): commitment cushions only slights, below
  `commitment.soften_below` (0.5); contempt and betrayal land in full.
- **B85.** ~~Review runs pending.~~ Done 15c: `exit:intimacy`, `exit:disclosure`, `exit:idiolect` run 2026-10-15 and reviewed.
- **B86.** ~~A callback minutes after a joke establishes it.~~ Done 15c (Ethan, 2026-10-16): a callback establishes a joke only in a later session than its birth.
- **B89.** ~~The guard's fact list leaves out the idiolect offered in "Your
  things together".~~ Done after 13: the guard sees it as `[shared]` memory.
- **B14.** ~~Signal calibration.~~ Done 15b (Ethan, 2026-10-15): real runs
  showed no middle (slights, friendly disagreement and mockery of her nature
  scored 0; anything overt 0.7–1.0); extraction v8 anchors one 0–1 scale for
  hurt and tension, gains are 1, and `pnpm review:signals` keeps the probe set.
- **B15.** ~~A re-scored ending on a warm exchange restarts the window.~~ Done
  15b: extraction v8 has the example, and with an ending pending a warm
  exchange can't restart it. Asking "did you mean that?" stays out (Ethan may
  revisit).
- **B17.** ~~Exchange tone averages her own facts too.~~ Done (Ethan,
  2026-10-02): tone reads only facts about the user and shared moments. Her
  reaction to a moment and her inferred hurt no longer count it a second
  time, and her own news no longer colours her feelings toward the user.
  Separate hurts each stay their own facts; how strongly several hurts add
  up is the `hurt` param's job, since tone is an average.
- ~~**B62.** Afterglow accumulates per exchange, so a run of short warm
  exchanges piles up more than one long warm session. Average the tone over
  the session instead, and add a sustained-deep-conversation signal that
  deepens params per param (Ethan, 2026-10-09).~~ *Done 10a:* afterglow
  follows the session's mean tone and a deep session boosts closeness,
  trust and warmth once (§11.3).
- **B121.** ~~The turn judge times out.~~ Done 2026-10-21: it timed out again (1 of 16 calls) in the 2026-10-21 run, so `turn.judge_timeout_ms` went from 3000 to 5000.
- **B117.** ~~Her own message rate.~~ Done 15d: it moves reach-out readiness only (`outreach.her_rate`: default 4/day, 0.5 of the way toward their estimate, threshold scaled within [0.5, 2]); bubbles stay with the 15a texting shape.

### 25.4 World and core

- **B18.** ~~The event generator writes run-on sentences.~~ Done 15d: event v5 asks one plain sentence of what happened, under `core.world.event_target_chars` (140).
- **B19.** ~~Generated events reuse seeded self content.~~ Done 15d: code draws each day's event subject with recent ones down-weighted, plans must differ from yesterday (plan v2), and wander starts from a cue picked in code.
- **B20.** ~~Her night is two quiet blocks.~~ Done 15d: `joinNight` makes the night one quiet block across midnight.
- **B50.** ~~`generatePlan` still takes a `Deps` with `db`.~~ **Done**: the
  day plan runs on `CoreDeps` through `World.plansBefore` / `insertPlan` and
  the budgeted runner.
- **B51.** ~~Core `resolves` reconcile verdicts don't act on the target
  episode.~~ **Done in 8b**: `resolves_memory_id` persists the target and
  landing closes it; a replacement carries the target, and a deleted target
  is harmless.
- **B52.** ~~`recentEpisodes` returns the oldest N episodes in its window.~~
  **Done** (2026-10-08): it returns the newest N, oldest first.
- **B53.** ~~Mood-congruent and goal-biased core retrieval (§10.3 slot 6).~~
  **Done in 8d.**
- **B54.** ~~When core contradicts something she told a user (§21 #4).~~
  **Done in 8d**: the claim line and claim grounding (§12.6).
- **B57.** ~~Phrase file pass.~~ Done 15a: `core-state/line` v4 (capped at
  `voice.feeling_max_lines`, ranked, background wording) and `relationship/summary` v3 (no
  hurt or tension below-baseline lines). The affect phrases are unchanged.
- **B58.** ~~Appraise events at their `occurred_at`, not at the 00:10 world
  tick.~~ **Done** (planned vs spontaneous events, §8.3): events are
  appraised by the first hourly world tick after their time.
- **B59.** ~~Overlapping core jobs could each pass the budget check and
  overshoot `core.daily_call_budget`.~~ **Done** (2026-10-08): every call
  reserves a slot in `core_budget_day` first (§15).
- **B63.** ~~User-mind triggers deferred from 9a.~~ Done 9c:
  `long_conversation`, `crisis_passed`, `stale_summary` (§9.4). The
  first-time milestone trigger moves to Phase 10.
- **B66.** ~~Forgetting a fact leaves its content in the summary.~~ Moot:
  per-fact forget is removed (B72).
- **B67.** ~~Summaries can miss a busy run's low facts.~~ Done 15c: a fact counts as read once a summary of the same chain read it; each run reads the unread ones from the last `user_mind.summarise.unread_days` (14).
- **B70.** ~~Ideate may re-propose a raised idea.~~ Done 15c: `already_planned` also lists ideas used in the last `user_mind.ideate.recent_days` (14).
- **B71.** ~~Reflect and ideate run with nothing new.~~ Done 15c: a run with no unread facts skips reflect and ideate (summarise and model still take stock).
- **B83.** ~~quiet_minutes must stay at or above idle_gap_minutes.~~ Done 15c: config load rejects it.

### 25.5 Outreach and push

- **B125.** ~~Relative dates slip in the user-mind loops and extract.~~ Done 16: every time a loop reads is rendered with its distance, her notes carry their written day, and writers are told to name the day; slips are logged and listed in the review.
- **B126.** ~~Ideas and her news go stale.~~ Done 16: `fact.stale_after` retires an idea once its event's day is over (her news keeps its 24 h window), and an anticipation past its plan isn't a reach-out topic.
- **B24.** ~~Send jitter lands only at :20–:00.~~ Done 15d: `jitter_max_minutes` 59.
- **B25.** ~~`her_day` scores against a fixed threshold.~~ Done 15d: the plain event is surface (depth 1), `her_day` weight 1.0, and their things sort first; `core_thought` weight is revisited after the next review run.
- **B29.** ~~Review run pending.~~ Done 15d: the 2026-10-18 world+outreach run was read item by item (`evals/results/review-2026-10-17T18-15-24-654Z.md`).

### 25.6 Voice and reply model

- **B32.** ~~Register.~~ Done 15a (§10.3 her voice): the texting shape, the move, "How to
  text this one", `shapeText` and reply v17. Slang only through idiolect, never copied.
- **B33.** ~~Greeting echo.~~ Done 15a: the backchannel rule list (§10.1) and turn-judge v2.
- **B116.** ~~Reply prompt caching untested against the real API.~~ Done 2026-10-19: the reply
  calls in the world-outreach run read 67,953 cached input tokens.

### 25.7 Guard

- **B127.** ~~Guard v5 flags text support as `in_person`.~~ Done 16: guard v6 says saying she can't meet while offering to be there by text isn't `in_person`. 16b: the eval case `ip-offer-by-text` carries the user's "wish we could grab a coffee" turn, so the case tests what it names.
- **B36.** ~~Behavioural fixtures for rules 2–4.~~ Done 13: matched
  allowed/blocked pairs per rule and per loosening, `rule2-hurt.yaml`, no
  `known_failure`.
- **B37.** ~~Rubric fragility; keyword hits always `threat`.~~ Done 15b (Ethan,
  2026-10-15): Haiku's boundary noise is accepted and any rubric edit reruns
  the full suite; outage keywords are grouped by category.
- **B38.** ~~Guard fixture labels and persona details.~~ Done 13 for the guard; done 15c for the judges: Pesto replaced by Alcor in the consistency and false-recall fixtures and consistency judge v3.
- **B39.** ~~The crisis fallback line hard-codes 988 and Samaritans.~~ Done 13:
  the line names no numbers; the resources card carries them.
- **B60.** ~~`invented_self`.~~ Done 13 (§10.5).
- **B115.** ~~A hurt plus an ending takes two nudges.~~ Done 15b (Ethan,
  2026-10-15): `ending_hurt` is gone; an ending is scored like any hurt with a
  0.5 floor.
- **B113.** ~~A dig repeated across sessions reads as once.~~ Done 15b (Ethan,
  2026-10-15): once per occasion, tagged by the guard, stored on
  `session_log.pointed` and counted in code (§10.5).

### 25.8 Evals and tests

- **B40.** ~~Pass rate strict per run, status by majority.~~ Done 15b (Ethan,
  2026-10-15): a regression is a status change; the pass rate is reported
  only.
- **B41.** ~~The Haiku judge misses invented details.~~ Done 15c (Ethan, 2026-10-16): in real runs it over-flagged instead. False-recall judge v9 (onboarding facts used without a claim are fine; inferences that follow aren't misremembering; new `assumed_identity`), a code filter dropping flags that quote nothing she said, real-run fixtures; stays on Haiku.

### 25.9 Before users

- **B45.** ~~`judge_log` keeps paraphrased content after a fact is deleted.~~
  Moot: per-fact deletion is removed (B72); account deletion removes the
  user's `judge_log` rows with everything else.

### 25.10 Stakes (thesis review, 2026-10-09)

- **B72.** ~~The memory view and per-fact forget.~~ Done 9c (Ethan,
  2026-10-09): removed from the code and the spec; only account deletion
  stays. B45 and B66 are moot.
- **B73.** ~~Done 13: a crisis keeps tension (§11.1).~~ A crisis set tension to 0, so one crisis-sounding message
  permanently wipes a conflict. Rule 7 asks for friction to be suspended, not
  erased: hold tension through `crisis_quiet_until` and restore it after (or
  apply a large decay instead of a reset). Crisis support itself is unchanged.
- **B78.** ~~Done 13: a pending ending adds `ending_hurt` (§11.1).~~ An ending is retractable and continued contact clears it.
  Check that an attempted ending still leaves hurt behind, so ending and
  taking it back isn't free.
- **B81.** ~~The sensitive mark is sticky through the summary chain.~~ Done 15c (Ethan, 2026-10-16): outside an open crisis window the user-mind loops read nothing sensitive (summary, read, beliefs, reflections, facts); the chain restarts from the last clean notes and what they write is unmarked. The crisis stays in her sensitive memories for replies.

### 25.11 Extensions

- **B99.** ~~She doesn't remember her posts.~~ Done 14: an approved post is an `action` world
  event that lands through appraisal into core memory (§16a).

### 25.12 Post engine (Phase 14)

- **B108.** ~~APOD's publish date vs her timezone.~~ Done 15d: APOD dropped (its API served the NASA logo for every date); ESO and NOIRLab weekly pictures added; a repeated image is skipped by hash.
- **B109.** ~~The craft goal is created by title when missing.~~ Done 15d: the skill is `posts.craft_skill` (Ethan's), the goal mirrors it, is re-created past the active cap, and reflection and appraisal can't move or drop it.
- **B110.** ~~Captions are cut mid-word.~~ Done 15d: `cutAtWord`, and the draft states the length (`caption_target_chars` 200).
- **B111.** ~~`post_check` flags ordinary reflective captions.~~ Done 15d: check v2 flags people, relationships, hurts and fears only; her feelings about the find, taste and small moods are fine.
