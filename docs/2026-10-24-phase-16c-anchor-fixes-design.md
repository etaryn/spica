# Phase 16c: time anchor fixes from the 16b close run

Design doc, 2026-10-24. Status: settled with Ethan (choices made item by item on 2026-10-24).

## Intent

Ethan reviewed the analysis of the Phase 16b close runs (`evals/results/analysis-2026-10-24-phase-16b.md`) and chose a fix for each unresolved time issue:

- 16b merges first, as it is.
- The fixes are their own slice, 16c.
- Guard items wait for the guard retune.
- The subject mix-ups go to the backlog.

## Spec and settled lines

- **DECIDED (16b, Ethan):**
  - Stored text keeps the date each time phrase meant, as a token.
  - Every reader renders it on its own day.
  - Anchoring touches stored memory only, never her messages (memory `her-speech-stays-free`).
  - Code, not a model, works out dates.
- **DECIDED (16c, Ethan, 2026-10-24):**
  - **T1:** whole-phrase match.
  - **T2:** merge date pairs in code.
  - **T3:** delete the weekday cross-check.
  - **T4:** her loops pass the dates they were shown.
  - **T5:** `insertFact` uses the row's own date.
  - **T6:** a part of the day plus a clock time anchors as a time.
  - **T7:** code anchors ISO dates, and extract v11 forbids adding dates.
  - **T8:** waits for the guard retune (B128).
  - **N1 and N2:** go to the backlog (B1).
- **Spec sections:** §6 (the `fact` content tokens), §8 (the core loops), §9 (the user mind), §10.4 and §12.3 (extraction), §20 (the 16b row).

## Assumptions

- **T1** (verified by reproduction): `anchorTimes("…on the afternoon of Thursday 8 January, in 3 days, and they're feeling nervous…")` gives "on the ⟦2026-01-05|day|UTC⟧'re feeling nervous".
- **T2** (verified):
  - "yesterday, Thursday 8 January" gives two tokens (9 stored rows in the run).
  - "⟦…⟧, 2026-01-08" leaves the ISO date raw (3 rows).
- **T3** (verified): extract output "interview on Thursday afternoon" was stored as ⟦2026-01-11|afternoon⟧ after the user wrote "that's sunday".
- **T4** (verified):
  - wander was shown "Tuesday 6 January, 2 days ago", wrote "came through for tuesday night", and that was stored as ⟦2026-01-13|night⟧.
  - `runCoreLoop` (`process/core/runner.ts`) is the one place every core loop's model call and commit pass through.
  - appraise has its own path.
- **T5** (verified): the seed "on Sunday morning" with `occurred_at` 11 January, written on Sunday 4 January, was stored as ⟦2026-01-04|morning⟧. "on the weekend" with `occurred_at` 17 January was stored as ⟦2026-01-03|weekend⟧.
- **T6** (verified):
  - `classify` returns null for a clock time on any day part but `day`.
  - 4 core rows were left raw.
- **T7** (verified): extract v10 added "on Friday 2026-01-09" (wrong) and "on the night of 2026-01-14".

## Design

All of it lives in `platform/time-anchors.ts` except T3 (extract), T4 (the core runner), T5 (`insertFact`) and T7's prompt.

1. **Whole-phrase match (T1).**
   - A chrono span is anchored only when one rule reads all of its words.
   - Otherwise the span is split at commas, semicolons and " and ", and each piece is anchored on its own; the original separators stay.
   - A piece no rule reads stays as written.
   - The relative-day rule (`RELATIVE`) and the others match the whole phrase (`^…$`).
   - Invariant: every word that isn't a time phrase survives anchoring (tested on the run's sentences).
2. **Merge pairs (T2).**
   - Two tokens separated only by ", ", " " or brackets, meaning the same day, become one token at the finer precision ("afternoon" over "day").
   - When they disagree, the one from a written-out date (a day and month, or an ISO date) wins over the relative one.
   - This runs at the end of `anchorTimes`, so every writer gets it.
3. **Delete the weekday cross-check (T3).**
   - `anchorExtraction` keeps the past/upcoming label and anchoring from the message's send time.
   - `WEEKDAY_WORD`, `weekdaysIn` and the swap are deleted, along with the `log` parameter if nothing else uses it.
   - The 2026-10-24 DECISIONS row on the cross-check is superseded.
4. **Her loops pass the dates they were shown (T4).**
   - `runCoreLoop`'s metered model records the dates in each input the loop sends (`tokenDates`).
   - Every memory write the loop commits takes them as `known`, through the `tx.memory` the runner hands to `commit`.
   - appraise passes its input's dates on its own insert.
   - The snapshot render's item anchoring takes them too.
   - Core still reads only core, so scope is unchanged.
   - The 2026-10-24 DECISIONS row "Her own loops pass no shown dates" is superseded.
5. **A row's own date (T5).**
   - `insertFact` and core `memory.insert` add the row's `occurred_at` (when set) to the shown dates.
   - A bare weekday and a bare weekend already take a shown date on their day, so "on Sunday morning" takes 11 January and "on the weekend" takes 17 January.
6. **Part of the day plus a clock time (T6).**
   - "tonight at 20:45", "this morning at 9" and "tomorrow night at 11" anchor as a `time` token on that day at that clock time, rendering "yesterday, Friday 9 January at 20:45".
   - A bare clock time still anchors nothing.
7. **ISO dates and extract v11 (T7).**
   - `anchorTimes` anchors `YYYY-MM-DD` as a written-out day, so T2 merges it with a neighbour.
   - `prompts/extract/v11.md` (from v10) adds one line to the Times bullet: "Never add a date or weekday they didn't say: 'the interview happened', not 'the interview on Friday 9 January'."
   - Config `prompts.extract` becomes v11.

No new config keys, tables or columns.

## Scope and leak check

- **T4 is core-only.** The dates come from the core loop's own input, which is built from core memory, core state and the world. The leak canary runs a core loop with a canary in user A's data and checks core memory never holds it.
- **T5 and T7 are user-scoped.** They run in `insertFact` and extract.
- Everything else is pure functions.

## Exit test and review run

`tests/exit/phase-16c.test.ts`, all fake. Cases taken from the 16b run:

- the swallowed sentence keeps "and they're feeling nervous";
- "yesterday, Thursday 8 January" is one token;
- "⟦8 Jan afternoon⟧, 2026-01-08" is one token;
- the interview fact stays on Thursday when the user's message says "that's sunday";
- a core loop shown "Tuesday 6 January" stores "tuesday night" as 6 January;
- a seed with `occurred_at` keeps its day;
- "tonight at 20:45" anchors;
- the leak canary through a core loop.

Free check: replay the 16b run's stored outputs (`evals/results/calls/eval-2026-10-24T08-48-12-585Z.jsonl`) through the new anchoring, and count lost words, doubled tokens and raw relative words. All three should be 0.

Paid check, on Ethan's go-ahead at close: one `pnpm review:world-outreach`, compared with the 2026-10-24 run. `eval:guard` is not needed, since no guard prompt changes.

## Out of scope

- **T8** (the guard trusts memory over the conversation; an honesty flag on a reply is still sent): added to B128, the guard retune. *Tuning.*
- **N1** (her telescope booking became Sam's) and **N2** (a user fact taken from her reach-out alone): added to B1. *Tuning.*
- **N5** (evening activities at noon in her world): to check during the next world review.
