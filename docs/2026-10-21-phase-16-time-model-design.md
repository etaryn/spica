# Phase 16: time model (times stored as data, distances rendered by code, time-bound items expire)

Design doc, 2026-10-21. Status: **draft**. The approach was settled with Ethan on 2026-10-21; the
details below still need his review (see "Open for Ethan").

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

## Design (to settle)

1. **One renderer.**
   - A helper in `src/mind/platform/timezone.ts`, e.g. `relativeLocal(at, now, tz)`, gives "Sat 17 Jan (in 4 days)", "Thu 8 Jan (5 days ago)", "today 22:00 (in 3 h)".
   - Every prompt input that carries a time goes through it: the user-mind loops, extract's turn labels, outreach reasons, the guard's WHY, recalled facts in the reply, her own memories in the core loops, and the Your-day line.
   - The model never counts days.
2. **No relative words in stored text.**
   - Every writer's prompt says to give a date or no time: extract, summarise, reflect, model, ideate, core appraise, anticipate, ruminate, wander, reflect and render-snapshot.
   - A shared code check (a small list of words: today, tonight, tomorrow, yesterday, this morning, this week…) catches a slip and asks once more, or stores the text with a flag.
3. **Two times on every item.**
   - Items carry when they were written (`created_at`, which exists) and when the thing they're about happens (`occurred_at`, which exists on facts and core memory; check the gaps, such as ideas, threads, summaries and the snapshot's Lately lines).
   - The renderer shows both, e.g. "noted Tue 6 Jan (yesterday), about Tue 6 Jan 22:00 (last night)".
4. **Stale-after.**
   - New column(s), e.g. `fact.stale_after` and `core_memory.stale_after`, set by code from `occurred_at` and the kind. An idea about an event is stale once the event is past plus a grace period; her news after a day; an anticipation once its time has passed.
   - The day sweep marks them `stale`, and every reader already skips `stale`.
   - Outreach candidates read `stale_after` too, so a stale item never wins between sweeps.

## Scope and leak check

- **Times on user items** are user-scoped (`fact`).
- **Times on her items** are core (`core_memory`); the core loops keep reading only core.
- **The shared renderer** is a pure platform helper with no user data.
- **Exit test:** a stale idea never sends; no stored text contains a relative word (fake writers); the renderer's day counts; the leak canary and side-channel checks.

## Open for Ethan

1. **Grace periods by kind:** how long an idea, her news, an anticipation and an open thread stay usable after their event.
2. **A relative word that slips through:** asking the model again, storing it with a flag, or stripping it.
3. **Summaries, notes on the user and her snapshot's Lately lines:** they describe the present. Does their text get a "written on" stamp in the inputs, or a refresh when their facts expire?
4. **B127:** fold guard v6 (text support isn't `in_person`) into this phase's guard pass?
5. **Paid runs at close:** `review:world-outreach` (about $1.20) and `eval:guard` (about $0.85).

## Out of scope

- The persona rewrite (a later phase, with Ethan).
- Needs reaching 0 (Ethan: leave as is).
- Goal progress being slow (watch in the Phase 16 run).
