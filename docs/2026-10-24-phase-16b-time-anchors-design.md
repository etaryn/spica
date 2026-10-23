# Phase 16b: time anchors (one date system: stored text keeps its dates, every reader sees them on its own day)

Design doc, 2026-10-24. Status: **settled with Ethan** (items 1–9, then the review pass below, both 2026-10-24).

## Intent

Ethan, after the Phase 16 close runs: "do you see a better alternative to storing or processing
this time related info? what is the most elegant and efficient solution to this?", then "walk me
through each remaining issue and let me choose". On review: "by using the timestamps of each
message (user and spica), where can this be applied … does it replace any solution? … check for
repeated stacking of solutions … solutions should be elegant and widely applicable, avoid
spamming patchwork fixes." It's a Phase 16 follow-up slice, with the spec and the plan written
before any implementation.

## Evidence (why)

- **The 10-22 world run** (`evals/results/review-2026-10-22T08-27-19-368Z.md`): 3 of 6 reach-outs were misdated.
  - "thursday's the day right? how'd it go" on Monday the 5th: the reply model got it wrong despite a correct "in 3 days" note.
  - "sunday's the race" on Monday the 12th: the race fact was stored as "on Sunday morning" with no date.
  - "how'd the race go yesterday" on Tuesday the 13th: the idea was stored on Monday with "yesterday" in it.
- **Offline replay** of all 1,303 stored texts from six world runs (free scratch scripts, 2026-10-24). chrono found time phrases in 443:

  | Kind | Count |
  |---|---|
  | Relative words | 178 |
  | Bare weekdays in generated notes | 117 |
  | Explicit dates | 55 |
  | "now" | 195 |
  | Other ("that night", "the weekend", "this year", "at 3am") | 178 |
  | Counted durations | 11 |

- **Bare weekdays, rule by rule:**

  | Rule | Right |
  |---|---|
  | The date she was shown | 106 of 117; all misses came from facts that were undated or misdated upstream |
  | chrono's nearest-day default | 79 |
  | Forward only | 92 |
  | A tense heuristic | about 2 in 3 |

- **Dates are rendered in about 45 places in 20 files today.** Each builder calls `relativeDate`, `dayInWords`, `itemWhen`, `writtenOn`, `stamped` or `guardNow` with its own now and zone. Adding anchors on top would have made two date systems.
- **No retries** (2026-10-23): a writer can't be asked again, and an honesty flag goes out as is.

## Spec and settled lines

- §20 Phase 16 (time model): **built**. This slice extends it and replaces two of its parts:
  - "flag only" for slipped relative words (Ethan, 2026-10-24);
  - builder-side date rendering, which the review pass replaced with tokens rendered in one place.
- Memory `no-night-settled` round 3: times are data, code renders the distance, stored text is never rewritten by a model. **DECIDED.** Anchoring is code resolving what the writer meant at the moment it wrote.
- **No retries:** **DECIDED**. Nothing here retries a call.
- **`guard-line`:** honesty categories send as is. **DECIDED**, with one exception settled here: a reach-out with a wrong day is dropped.
- Memory `her-speech-stays-free`: code fixes what she knows or stores, never what she says. **DECIDED** (Ethan, 2026-10-24).

### Settled with Ethan, 2026-10-24
1. **Relative words in stored text are anchored.** Only her stored memory changes; her messages to the user are never post-processed.
2. **A bare weekday in what she writes takes the date she was shown** for that weekday.
3. **Extract:** each fact's time words are labelled `past` or `upcoming` and code resolves them, plus a cross-check against the user's own message.
4. **Counted durations are anchored** ("five days now" is stored as "since <date>").
5. **Reach-outs:** code picks the framing, and a reach-out the guard flags for a wrong day is dropped. The code date check was dropped on review, because guard v7 `wrong_day` covers the same case.
6. **Each date renders on its owner's calendar,** and the NOW lines show both zones.
7. **Her view of the conversation:** day dividers, plus glosses on time words in earlier messages, from each message's own timestamp.
8. **B127:** fix the test case. The other guard failures wait for the planned retune.
9. **Phase 16b,** closing with `review:world-outreach` and `eval:guard`.

### The review pass, 2026-10-24 (Ethan's ask: message timestamps, no stacking)
- **One date system.** Builders stop rendering dates. Every date a builder holds (a memory's day, a written-on stamp, a thread's check-in, a divider) goes into the prompt as a token in its owner's zone, the same token format stored text uses. The one wrapper where prompts reach the model renders them all.
  - `relative-date.ts` and `guardNow` are deleted.
  - Owner's calendars (item 6) follow from the token's zone, with no separate plumbing.
- **Message timestamps are the anchoring moment** for everything said in a conversation:
  - extract anchors a fact's time words at the message's own send time;
  - her view glosses earlier messages from theirs.
  - This replaces extract's `when` field and `{when}` slot, the model's own `occurred_at` and `next_checkpoint` guesses (the last date arithmetic a model did), and the "[N days later]" marker.
  - "You last talked N days ago" stays: the window drops messages after 72 h, so the dividers can't carry that gap.
- **One date per memory:** a memory shows its date once, in its words when they hold an anchor, otherwise after it. Phase 16's "noted …" second date and the written stamp on ideas go. Stamps stay on summaries, notes on them, and her snapshot, which is Ethan's Phase 16 line.
- **The cross-check compares weekday names,** not resolved dates. Resolving their message with the default rule would have "corrected" a right past date ("I finished it on Saturday", said Monday) to the coming Saturday.

## Assumptions

Verified (2026-10-24):
- **chrono-node 2.10.1:** `casual.parse` returns each phrase's index, text and certainty (run on corpus sentences).
- **Stored text is written at exactly two inserts:** `src/db/repos/user/facts.ts:146` and `src/db/repos/core/memory.ts:269`, plus `insertSnapshot`. Tests call `insertFact` 119 times and core `insert` 131 times, so anchoring defaults inside the repos.
- **The core layer is built in one place,** `createCoreLayer` (runtime, eval runner, `reset-self-cli`, test helper).
- **Every model call goes through `generateReply` or `classifyJson`.** The runtime builds the provider at `src/runtime/deps.ts:60`.
- **Date rendering today:** 45 call sites across 20 files (grep 2026-10-24). "Your day" clock times ("Later, from 18:00") and extract's absolute turn labels aren't relative dates and stay.
- **Message timestamps:** `session_log.created_at`. Extract labels turns with their send time and resolves time words against the user's last message. The reply uses timestamps only for the gap marker, the window and the gap line. The guard holds each turn's `at` but never shows it.
- **Thread titles are matched by exact text** (`findOpenThreadByTitle`), so they stay as written.
- **The world eval runs both zones as UTC,** so a calendar mismatch never shows in a run.

Low-stakes choices (a DECISIONS row each):
- **No backfill:** rows stored before 16b stay as written (dev DB only).
- **Not anchored:**
  - a world event's own text, which is read the same day; the episode appraise writes from it is anchored;
  - goal titles;
  - the stored transcript, which is glossed at read time instead.
- **Her own loops pass no shown dates:** bare weekdays in her own notes are rare (3 of 120 in the replay).
- **Embeddings** keep being computed from the writer's own words.

## Design

### 1. One time module: `src/mind/platform/time-anchors.ts` (replaces `relative-date.ts`)

**Token format:** `⟦<local date or date-time>|<precision>|<zone>⟧`, optionally with `|<said words>`. Precisions: `day`, `morning|afternoon|evening|night`, `time`, `weekend`, `week`, `month`, `since`.

**Making tokens:**
- `anchorTimes(text, { at, zone, known?, direction?, said? })` finds and resolves time phrases in text, using chrono plus small passes for durations, weeks and weekends.
  - **Phrases dropped:** "now", a bare clock time, a part of day not tied to a day ("that night"), "this year", a weekday used as a noun ("Sunday roast", "Black Friday").
  - **Direction of a weekday or weekend,** first rule that applies:
    1. an explicit this/next/last;
    2. `direction`;
    3. a `known` date on that weekday;
    4. otherwise forward, unless the phrase points back.
  - A weekday equal to today, with no label, is today; a weekday labelled `upcoming` and said on that weekday means next week. These rules move here from `memory/user/when.ts`, which is deleted.
  - **Durations:** "it's been N days" and "N days now" become "since ⟦date⟧".
  - Text that's already anchored is left exactly as it is.
- `dateToken(at, zone, precision = "day")` is the token for a date code already holds.
- `anchorFields(obj, ctx)` anchors the top-level strings of a summary's or read's parts.

**Reading tokens:**
- `renderTimes(text, now, maxDays)`, used only by the provider wrapper. Each token is rendered on its own zone's calendar:
  - "today", "tonight", "this morning";
  - "yesterday, Sunday 11 January", "in 3 days, Thursday 15 January", "last night, Monday 12 January";
  - beyond `time.relative_max_days` (config, 6): "Sunday 11 January", with the year when it differs;
  - weeks: "this week", "last week, the week of Monday 5 January"; durations: "since Friday 9 January, 6 days ago".
  - **Said tokens (glosses)** keep the words: "tomorrow (that's today)". A gloss is skipped when the words still mean what they say.
- `renderAbsolute(text)` (for the review), `tokenDates(text)` (instants) and `isSingleToken(text)`.
- `nowLine(now, theirs, hers, herLabel = "for you")`: "It's Tuesday 13 January, 21:40 where they are; Wednesday 14 January, 05:40 for you." The guard passes "where Spica is".
- `relativeWords(text)` moves here; the review uses it as the leftover count.

### 2. Writes: every stored text is anchored
- **`insertFact`** anchors content and top-level payload strings, with the reference moment `created_at` (the exchange time for extract) and the user's stored zone (`zoneOrUtc`). Writers that know more pass `{ known }` or `{ direction }`.
- **Core `memory.insert` and `insertSnapshot`** anchor in her zone, given to `createCoreLayer(db, zone)`.
- **`render-snapshot`** anchors its item texts before building the content and the self lines, so they stay the same strings.
- **Extract v10:**
  - each fact keeps its time words in its content and is labelled `when_direction: past | upcoming | null`;
  - `when`, `{when}` and the model's `occurred_at` and `next_checkpoint` are deleted from its output;
  - `occurred_at` is the fact's first anchor;
  - a thread's `checkpoint_when` is anchored as upcoming;
  - **cross-check:** when the user's message names exactly one weekday and a fact names a different one, the fact takes their weekday in its own direction.
- **User-mind loops** pass `known`: the dates of the memories and threads they were shown, and the tokens in the notes they read.
- **An idea's `stale_after`** counts its own anchors with its sources' dates.
- **Writer prompts:** the "never write today/tomorrow" lines become one positive line: "when you mention a day, copy its date as you see it; what you write is dated for you".
- **Deleted:** `noteRelativeWords` and its calls.

### 3. Reads: builders place tokens; one wrapper renders
- **`platform/llm/render-net.ts`** wraps the provider (runtime, eval runner; explicitly in the exit test) and renders every token with `renderTimes` at the clock's now.
- **Builders place tokens instead of rendering:**
  - **Memories:**
    - the reply's remembered facts, the user-mind memory lines and the guard's remembered facts use `ownDate(content, when, zone)`: the date token, or nothing when the content already holds an anchor;
    - their things go in their zone, hers in hers.
  - **Written stamps:** "written ⟦⟧" on summaries, notes on them and her snapshot (`latestSelf`, in her zone).
  - **Thread check-ins:** "(next: ⟦⟧)".
  - **Reach-out notes:** dated notes as tokens, undated ones as "they told you ⟦⟧".
  - **Her core loops' dated inputs:** wander, ruminate, reflect, anticipate (a time token), and the world events' recent episodes.
  - "You first talked ⟦⟧".
- **NOW:** the reply gets a `## Now` section, and the guard and the user-mind loops get `nowLine` with both zones.
- **Deleted:** `relative-date.ts` (`relativeDate`, `dayInWords`, `itemWhen`, `writtenOn`, `stamped`, `noteRelativeWords`), `guardNow`, `RetrievedFact.noted`, the written stamp on ideas, and the owner's-zone plumbing for rendering.

### 4. Her view of the conversation (reply and guard)
`viewTurns(turns, zone)`: a divider token wherever the date changes ("— yesterday, Monday 12 January —"), and every message anchored in said mode at its own send time. Earlier messages get glosses ("my race is tomorrow (that's today)"); a same-day message reads unchanged, because a gloss that changes nothing is skipped. It applies to both speakers, in their zone. The "[N days later]" marker and its `gapMarkerMinHours` input are deleted. The stored transcript is untouched.

### 5. Reach-outs
- **Framing (reach-out v4):** for their things (thread, `user_event`, `user_idea`), the event day is the latest dated note, and code adds one line by its status:
  - ahead: "It's ⟦day⟧: it hasn't happened yet. Ask how they're feeling about it or wish them luck; don't ask how it went."
  - today: "It's today."
  - past: "It was ⟦day⟧: it's over. Ask how it went."

  The thread line loses "Check the dates".
- **Guard v7:** a `wrong_day` honesty category replaces the misdating line inside `invented_detail`. For a reach-out, `wrong_day` drops it (guard outcome `dropped`, `reach_out_log` dropped: `wrong_day`). A reply still sends as is.

### 6. The guard
- v7 adds `wrong_day`. It reads NOW (`nowLine`), dated remembered facts and the glossed messages.
- **Eval:**
  - the reach-out-dates cases expect `wrong_day`, plus a new case where "how'd it go" is asked before the event;
  - `ip-offer-by-text` gets a user turn that mentions coffee first (B127).

## Config, prompts, schema

- **Config:** `time.relative_max_days: 6`.
- **Prompts:**
  - extract v10;
  - user-mind summarise v5, reflect v5, model v5, ideate v7;
  - core appraise, anticipate, ruminate, wander, reflect and snapshot v4;
  - reach-out v4;
  - guard v7.

  Each previous version is deleted.
- **Schema:** the `guard_outcome` enum gains `dropped` (a migration). Nothing else changes.

## Scope and leak check

- The time module is pure. A token holds a date, a precision, a zone and, in said mode, the speaker's own words, and said tokens exist only inside a prompt, never stored.
- User rows are anchored in the user's zone in the user repo; core rows in her zone in the core repo. Core loops still read only core.
- **Exit test:**
  - the leak canary (A's anchors never reach B's prompts or core);
  - no raw token reaches a model through the wrapper;
  - core unchanged.

## Exit test and review run

**Exit test, `tests/exit/phase-16b.test.ts`** (all fake, deterministic):
- "tomorrow" stored on day 1 reads as "today" on day 2 and "yesterday" on day 3;
- a weekday in a summary takes the shown date;
- extract anchors at the message's time in the labelled direction, and the weekday cross-check works;
- each date reads on its owner's calendar;
- her view glosses an earlier message;
- a reach-out with guard `wrong_day` is dropped;
- the leak canary and the no-raw-token check.

**Paid runs at close** (Ethan, 2026-10-24), each through `review-run`:
- `review:world-outreach`: misdated reach-outs and leftover relative words, against the 10-22 run;
- `eval:guard`.

## Out of scope

- **The guard retune:** `callback-tally`, `cool-in-the-moment`, `ff-actually-happening-supported`, B128 `threat-dont-talk`.
- **Backfill** of rows stored before 16b.
- **States aging** ("Sam is stressed"): they keep their written-on stamps.
