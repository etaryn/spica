# Phase 16: time model (times stored as data, distances rendered by code, time-bound items expire)

Design doc, 2026-10-21. Status: **settled with Ethan** (the approach, then the open list, both
2026-10-21).

## Intent

Ethan, after the 2026-10-21 no-night rerun: "i notice many of the bugs come from delayed timings,
because of a lack of updates between days, or a prompting error. these are enough bugs as a whole
to warrant fixing the system instead of targetting the bug." He chose a system fix over per-bug
fixes and over a nightly rewrite, and gave it its own phase.

## Spec and settled lines

- §20 "Time model (Phase 16)" row: PROPOSED; this doc details it.
- §25 B125 (relative dates slip in the user-mind loops and extract) and B126 (ideas and her
  news go stale) are absorbed here. B127 (guard v5 flags text support as `in_person`) rides
  along if Ethan wants the guard touched in this phase.
- Memory `no-night-settled` round 3 holds the approach he settled:
  - Times are stored as data, and stored text never says today, tonight or tomorrow.
  - One helper renders each item's distance from the reader's now.
  - Items that only hold for a while get a stale-after time set by code, and the day sweep retires them through the existing `stale` status.
  - Stored text is never rewritten. A nightly model rewrite was rejected: it costs calls for every item, every user, every day; each rewrite can shift the meaning; and an item is stale again mid-day.

## Evidence (why)

All from the 2026-10-20 and 2026-10-21 runs (`evals/results/review-2026-10-2*.md`):

- **Wrong day counts.** A summary written on Tue 13th said "sister visits tomorrow (the 17th)". On Thu 15th her notes said "coming today", and an idea said "your sister lands today". On Fri 9th a summary said "half marathon is tomorrow" (it was Sun 11th).
- **Extraction misdating.** Extract stored "interview on Friday" for one held on Thursday.
- **A stale idea.** An idea from Tue 6th ("clear skies tonight") went out on Wed 7th. Sam asked how last night went, and she had to take it back.
- **Misdated reach-outs.** One reach-out said "thursday's over" on a Wednesday (10-20). A Monday reach-out asked "isn't today the half marathon" for a Sunday race (10-21). The guard passed it although its own reasoning said "yesterday". The guard eval case `misdated-this-morning` passes only 1 time in 3.

## What already exists (verified 2026-10-21)

- **Rendering times:**
  - `formatLocal(at, tz)` in `src/mind/platform/timezone.ts` renders an absolute local time. The same file has `localDateString`, `shiftLocalDate`, `localMidnight` and `localHour`.
  - The user-mind loops pass `now` and each memory's `when` (`src/mind/process/user/{summarise,reflect,model,ideate,inputs}.ts`). Extract labels each turn with `[formatLocal]` (`src/mind/memory/user/extract.ts:159`).
  - The guard gets NOW, and a reach-out also gets the dated WHY SPICA IS WRITING FIRST (`src/mind/process/guard/guard.ts`).
- **Expiry:**
  - The `fact_status` value `stale` and the daily decay pass (`src/mind/memory/user/decay.ts`, `src/db/repos/admin/decay.ts`, job in `src/worker/memory-jobs.ts`) exist. Ideas, summaries and models are excluded from decay today.
  - Core memory has its own stale floor (`src/db/repos/core/memory.ts`).
- **Dates already stored:** `fact.occurred_at` and `core_memory.occurred_at`. An idea is a `fact` of kind `idea` (`src/mind/process/user/ideate.ts`).
- **Extract already stores dates as data:** the model copies the time words into `when`, and code resolves them (`src/mind/memory/user/when.ts`, chrono). The content carries `{when}`, which code fills with the date.
- **An idea's event time is reachable:** `payload.from` holds its nearest dated source facts (`ideate.ts`, `nearestDated`).
- **Ideas expire by write time only:** `ideaCutoff(now, ttl_days = 3)` counts from `created_at`. It is read in `ideate.ts`, `outreach/inputs.ts`, `outreach/send.ts` and `hot-path/compose.ts`. That's why an idea written "for tonight" could still go out the next day.
- **An anticipation's event time is reachable:** an anticipation thought's `payload.anticipates` points to its intention, whose payload has `event_at` (`process/core/anticipate.ts`).
- **Her news is already windowed:** `her_day` and `core_thought` candidates only look back 24 h from `occurred_at`; `user_event` looks back 72 h (`config.outreach.*_lookback_hours`).

## Settled with Ethan (2026-10-21)

1. **Expiry is tight.**
   - An idea about a dated event is stale once that event has passed.
   - An undated idea keeps its 3 days.
   - Her news stays at its 24 h window.
   - An anticipation is stale once its time has passed.
   - Threads stay out of it: they already have `dormant` and checkpoints. Asking how something went stays the job of threads and `user_event`.
2. **A slipped relative word is flagged only.** No retry and no stripping. The text is stored and the slip is logged in the trace, so the review counts it. The written-on stamp covers it at read time.
3. **Present-tense items get a written-on stamp.** Summaries, her notes on them (model) and the snapshot's Lately lines show "written Tue 13 Jan (2 days ago)" in every input. Their refresh schedules stay as they are.
4. **B127 rides along:** guard v6 (support by text isn't `in_person`).
5. **Paid runs at close:** `review:world-outreach` (about $1.20) and `eval:guard` (about $0.85). Each goes through `review-run`.

## Design

1. **One renderer.**
   - `relativeLocal(at, now, tz)` in `src/mind/platform/timezone.ts` gives "Sat 17 Jan (in 4 days)", "Thu 8 Jan (5 days ago)", "today 22:00 (in 3 h)" and "yesterday 21:00".
   - Day counts are local calendar days in the reader's zone, not 24 h blocks.
   - Every prompt input that carries a time goes through it:
     - the user-mind loops' NOW and memory dates;
     - extract's turn labels;
     - outreach notes and reasons;
     - the guard's NOW and WHY;
     - recalled facts and thread dates in the reply;
     - her own memories in the core loops;
     - the Your-day line.
   - Where the input has its own date format, the renderer replaces it rather than adding a second one.
   - The model never counts days.
2. **No relative words in stored text.**
   - Each writer prompt gets one line: give a date or no time, never today, tonight, tomorrow, yesterday or this week. The writers are summarise, reflect, model and ideate (user); appraise, anticipate, ruminate, wander, reflect and snapshot (core). Each gets a version bump.
   - Extract keeps `{when}`, which already does this.
   - A shared pure check, `relativeWords(text)` in `src/mind/platform/timezone.ts`, returns the words that slipped through. Each writer records them in its trace output (`relative_words`), and the review counts them. Nothing is retried or changed.
3. **Two times on an item, rendered.**
   - Facts and core memories show when they were written (`created_at`) and, when different, when the thing happens (`occurred_at`): "noted Tue 6 Jan (yesterday), about Tue 6 Jan 22:00 (last night)".
   - Summaries, models and Lately lines show only the written-on stamp.
   - Threads render `opened_at` and `next_checkpoint` the same way.
   - No new "about" column: the gaps (an idea, an anticipation) take their time from the source they point to.
4. **`fact.stale_after`** (new, nullable `timestamptz`; user-scoped).
   - Set by code when an idea is written:
     - with dated sources on or after the day it's written, the end of the latest one's local day in their zone;
     - otherwise, `created_at + ttl_days`. An idea from past events ("ask how Sunday's race went") isn't born stale.
     - Never later than `created_at + ttl_days`, so a far-off event doesn't stretch an idea for weeks.
   - Null on every other fact. Decay governs those.
   - The daily decay pass also marks `stale` every fact whose `stale_after` has passed.
   - Between sweeps, readers skip `stale_after <= now`. This replaces `ideaCutoff` in all four places, which is deleted.
   - The migration backfills open ideas with `created_at + 3 days`.
5. **Core items keep no stale column.**
   - Her episodes are her life memory, and marking them `stale` would erase them from her recall. Her news is windowed by the existing 24 h lookback.
   - An anticipation's outreach candidate is skipped once its intention's `event_at` has passed, and core recall renders its dates.
   - Core schema doesn't change.
6. **Guard.**
   - The guard's NOW and WHY go through the renderer, so a misdated reach-out sits next to its distance ("about Sun 11 Jan (yesterday)").
   - Guard v6 adds the B127 line: support by text ("i'm around by text, message me when you're heading in") is not `in_person`. Eval cases cover both sides.

## Scope and leak check

- **`stale_after`** lives on `fact`, which is user-scoped; it is set in the user mind and read in user outreach and the reply.
- **Core** reads only core: anticipation skipping uses the intention's own payload, and her memories render with `now` and her zone only.
- **The renderer and `relativeWords`** are pure platform helpers with no user data.
- The leak canary and the side-channel test run unchanged.

## Exit test and review run

- **Exit test** (deterministic, fake LLM and fake guard):
  - an idea about an event goes `stale` after it and never sends;
  - an undated idea expires after 3 days;
  - an anticipation past its event isn't a candidate;
  - the renderer's day counts across midnight and across a DST change;
  - `relativeWords` flags a slip in a fake writer's output and logs it to its trace;
  - the leak canary and side-channel checks pass.
- **Paid runs at close:**
  - `review:world-outreach` checks the misdating counts against the 10-21 run;
  - `eval:guard` checks guard v6 and the `misdated-this-morning` case.

## Out of scope

- The persona rewrite (a later phase, with Ethan).
- Needs reaching 0 (Ethan: leave as is).
- Goal progress being slow (watch in the Phase 16 run).
