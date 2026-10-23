# Phase 16b: time anchors (stored text keeps the date it meant; every reader sees it on its own day)

Design doc, 2026-10-24. Status: **settled with Ethan** (items 1–9 below, 2026-10-24).

## Intent

Ethan, after the Phase 16 close runs: "do you see a better alternative to storing or processing
this time related info? what is the most elegant and efficient solution to this?", then "walk me
through each remaining issue and let me choose a course of action for each". He placed it as a
Phase 16 follow-up slice, with the spec and the plan written before any implementation.

## Evidence (why)

- **The 10-22 world run** (`evals/results/review-2026-10-22T08-27-19-368Z.md`): 3 of 6 reach-outs were misdated.
  - "thursday's the day right? how'd it go" on Monday the 5th. The reply model got it wrong despite a correct "in 3 days" note.
  - "sunday's the race" on Monday the 12th. The race fact was stored as "on Sunday morning" with no date.
  - "how'd the race go yesterday" on Tuesday the 13th. The idea was stored on Monday with "yesterday" in it.
- **Offline replay** of all 1,303 stored texts from six world runs (free; scratch scripts, 2026-10-24). chrono found time phrases in 443:

  | Kind | Count |
  |---|---|
  | Relative words | 178 |
  | Bare weekdays in generated notes | 117 |
  | Explicit dates | 55 |
  | "now" | 195 |
  | Other ("that night", "the weekend", "this year", "at 3am") | 178 |
  | Counted durations | 11 |

- **Bare weekdays, one rule at a time:**

  | Rule | Right |
  |---|---|
  | The date she was shown | 106 of 117; all 11 misses came from facts that were undated or misdated upstream |
  | chrono's nearest-day default | 79 |
  | Forward only | 92 |
  | A tense heuristic | about 2 in 3 ("Sam's got a race Sunday" reads as past) |

- **No retries** (2026-10-23): a writer can't be asked again, and an honesty flag goes out as is (`process/guard/outgoing.ts:100-103`).

## Spec and settled lines

- §20 Phase 16 (time model): **built**. This slice extends it and replaces one of its choices, "flag only" for slipped relative words (Ethan, 2026-10-24).
- Memory `no-night-settled` round 3: times are data, code renders the distance, stored text is never rewritten by a model. **DECIDED.** Anchoring is code resolving what the writer meant at the moment it wrote, not a model rewrite.
- No retries side phase: **DECIDED**. Nothing here retries a call.
- `guard-line`: honesty categories send as is. **DECIDED**, with one exception settled below (item 5): a reach-out with a wrong day is dropped.
- Code owns the numbers (`src/mind/CLAUDE.md`). The new number is in config.

### Settled with Ethan, 2026-10-24
1. **Relative words in stored text are anchored.** Only her stored memory changes. Her messages to the user are never post-processed and phrase time freely.
2. **A bare weekday in what she writes takes the date she was shown** for that weekday.
3. **Extract, both fixes:** each time phrase is labelled `past` or `upcoming` and code resolves the day, plus a cross-check against the user's own message.
4. **Counted durations are anchored** ("five days now" is stored as "since <date>").
5. **Reach-outs, all three fixes:** code picks the framing, code checks the drafted message's days, and a reach-out flagged for a wrong day is dropped.
6. **Each date renders on its owner's calendar,** and the NOW lines show both zones.
7. **Her view of the conversation** gets glosses on older messages, computed from their own send times, plus day dividers.
8. **B127:** fix the test case. The other guard failures wait for the planned guard retune.
9. **Phase 16b**, closing with `review:world-outreach` and `eval:guard`.

## Assumptions

Verified (2026-10-24):
- **chrono-node 2.10.1:** `casual.parse` returns each phrase's index, text and start, and its reference takes an instant and a zone offset. Run on 8 corpus sentences.
- **Stored-text write paths:**
  - `insertFact`: `memory/user/encode.ts` ×4, `hurt.ts`, `process/onboarding/submit.ts`, `process/user/{consolidate,ideate,model ×2,reflect,summarise}.ts`;
  - core `memory.insert`: `process/core/{appraise,consolidate,reflect,thoughts,world-tick}.ts`;
  - `insertSnapshot` / `insertSelfLines`: `render-snapshot.ts`, `memory/core/seed.ts`;
  - `insertThread` / `touchThread`: `encode.ts`.
- **Tests call these directly** about 250 times (119 `insertFact`, 131 core `memory.insert`). So anchoring defaults inside the repos rather than adding a required parameter.
- **The core layer is built in one place** (`createCoreLayer`, `src/db/repos/core/index.ts`), so it can carry her zone.
- **Every model call goes through `LLMProvider.generateReply` / `classifyJson`.** The runtime builds it at `src/runtime/deps.ts:60`.
- **The reply prompt states no date or time.** "Your day" says only "Right now you're…". The guard has NOW.
- **Message timestamps:**
  - extract labels each turn with its send time;
  - the reply uses them only for "[N days later]" after 24 h or more and for "You last talked N days ago";
  - the guard holds each turn's `at` but doesn't print it.
- **Reach-out guidance is per kind** in `prompts/reach-out/v3.md`. The thread line says "Check the dates". A send can be dropped (`send.ts` `drop`).
- **The world eval runs both zones as UTC** (`evals/scripts/world-outreach-two-weeks.yaml`), so a calendar mismatch never shows in a run.

Low-stakes choices (a DECISIONS row each):
- **No backfill:** rows stored before this slice stay as written (dev DB only; `pnpm db:reset-self` clears them). The renderer passes plain text through.
- **Not anchored:**
  - a world event's own text, which is read the same day; the episode appraise writes from it is anchored;
  - goal titles and reasons;
  - the stored transcript, which stays raw and is glossed at read time instead.
- **Embeddings** keep being computed from the writer's own words, as now: anchoring happens at insert.

## Design

### 1. Anchors (`src/mind/platform/time-anchors.ts`, pure)

**Token format:** `⟦<local date or date-time>|<precision>|<zone>⟧`, for example:
- `⟦2026-01-11|day|Europe/London⟧`
- `⟦2026-01-12T22:00|night|Asia/Singapore⟧`
- `⟦2026-01-05|week|UTC⟧`
- `⟦2026-01-09|since|UTC⟧`

Precisions: `day`, `morning|afternoon|evening|night`, `time`, `weekend`, `week`, `month`, `since`.

**`anchorTimes(text, { at, zone, known?, direction? }): string`**
- **Finding phrases:** `chrono.casual.parse` with the reference `at` in `zone`.
- **Phrases kept:**
  - relative day words (today, tonight, tomorrow, yesterday, this morning/afternoon/evening, last night);
  - this/next/last + a weekday, week, weekend or month;
  - a weekday (optionally "on …", a part of day, or followed by a date such as "Thursday the 8th");
  - explicit dates;
  - "in N days" and "N days ago".
- **Phrases dropped:**
  - "now" and "right now";
  - bare clock times ("at 8", "at 3am");
  - a part of day not tied to a day ("that night", "every night", "the morning");
  - "this year";
  - a weekday used as a noun ("Sunday roast", "Black Friday", "Good Friday").
- **Direction of a weekday or weekend**, first rule that applies:
  1. an explicit this/next/last;
  2. the `direction` passed in (extract's label);
  3. a `known` date on that weekday (nearest to `at`);
  4. otherwise forward, unless the phrase itself carries a past cue.

  A weekday equal to today, with no label, is today. These rules move here from `memory/user/when.ts`, together with: "this morning" said late at night stays today; "this week" becomes a week token; "end of the week" is its Friday; "in october" said in October is this October.
- **Durations:** "N days/weeks now", "it's been N days/weeks" and "for N days now" become "since ⟦date⟧", with the date `at` minus N.

**Rendering:**
- `renderTimes(text, now)` renders each token on its own zone's calendar, with the calendar maths in `platform/relative-date.ts`:
  - "today", "tonight", "yesterday (Sunday 11 January)", "last night (Sunday 11 January)", "in 3 days (Thursday 15 January)";
  - beyond `time.relative_max_days` (config, 6): "Sunday 11 January";
  - weeks: "this week", "last week (week of Monday 5 January)";
  - durations: "since Friday 9 January (6 days ago)".
- `renderAbsolute(text)` gives "Sunday 11 January 2026", for the inspector and the safety net.
- Text without tokens passes through unchanged.

### 2. The write side: every stored text

- **The repos anchor by default.** `insertFact` (content and a summary's or read's string parts), core `memory.insert` and `insertSnapshot` pass content through `anchorTimes` before writing. Thread titles stay as written, since threads are matched by their exact title. Snapshot self lines are anchored by `render-snapshot` itself, so they stay the same strings as the snapshot text.
  - **Reference moment:** the row's `created_at`, unless the writer passes a better one.
  - **Zone:** the user's stored zone (`zoneOrUtc`) for user rows; for core rows, her zone, given to `createCoreLayer`.
- **Writers pass what they know** through an optional `anchor: { at?, known?, direction? }`:
  - **extract:** `at` is the user's message time and `direction` comes from the fact's new label;
  - **user-mind loops:** `known` is the dates of the memories and threads they were shown;
  - **core loops:** `known` is the dated memories and plan events they were shown.
- **Extract v10:**
  - each fact gets `when_direction: "past" | "upcoming" | null`;
  - `{when}` stays as the slot for their own words and is filled with a token instead of a label;
  - any other time phrase in the content is anchored too.
  - **Cross-check:** anchor the user's source messages at their own send times. If a fact's day matches none of the days they name, and they name exactly one, the fact takes that day (and `occurred_at` with it), and the swap is logged.
- **Ideas:** `ideaStaleAfter` also counts the idea's own future anchors, with the same rule: end of that day, capped by `ttl_days`.
- **Writer prompts:** the "never write today/tonight/tomorrow…" lines are replaced by one positive line: "when you mention a day, copy its date as you see it ('Thursday 8 January')". Explicit dates anchor with certainty.
- **Deleted:**
  - `noteRelativeWords` and its calls;
  - the label strings in `when.ts`, whose rules move into anchoring;
  - the "this week → Friday" date.
- **The review** keeps listing relative words left in stored text, as the leftover count; it should be near zero.

### 3. The read side

- **Every prompt builder renders stored text with `renderTimes`:**
  - user-mind memory lines and notes;
  - the reply's facts, summary, read, ideas and snapshot;
  - reach-out notes;
  - the guard's remembered facts;
  - the core loops (wander, ruminate and reflect inputs, `latestSelf`, anticipate);
  - extract's open threads;
  - consolidate inputs.
- **Owner's calendar:** a token renders in its own zone. Dates read from columns render in the owner's zone: their things in theirs, hers in hers. `assemble` takes both zones.
- **NOW in the reply:** "Your day" opens with "It's Tuesday 13 January, 21:40 where they are; Wednesday 14 January, 04:40 for you" (one clause when both read the same). The user-mind loops' `now` shows both the same way.
- **Safety net:** `platform/llm/render-net.ts` wraps the provider and applies `renderAbsolute` to system, input and messages. It's applied in `src/runtime/deps.ts` and the eval provider, never in tests, so the tests prove that every builder renders.

### 4. Her view of the conversation (reply and guard)

- **Day divider:** the first message of each local day, in their zone, is prefixed "— Tuesday 13 January (yesterday) —". It replaces the "[N days later]" marker. The "You last talked N days ago" line stays.
- **Gloss:** in a message from an earlier day, each time phrase is followed by its meaning now, anchored at that message's own send time in their zone: "my race is tomorrow (that's today, Tuesday 13 January)". This applies to both speakers' messages. Same-day messages are unchanged. It's built in `assemble.ts` `conversationMessages` and the guard's `renderGuardInput`. The stored transcript is untouched.

### 5. Reach-outs

- **The candidate's event day:**
  - thread: its latest dated fact;
  - `user_event`: the fact;
  - `user_idea`: the latest anchor in the idea or its sources;
  - `her_day`: the memory;
  - an anticipation `core_thought`: its plan's `event_at`;
  - `check_in` and `make_up`: none.
- **Framing (reach-out v4):** code picks one guidance line from the event day's status.
  - ahead: "It's on {day}, {in N days}: it hasn't happened yet. Ask how they're feeling about it or wish them luck; don't ask how it went."
  - today: "It's today."
  - past: "It was on {day}, {N days ago}: it's over. Ask how it went."

  The thread line loses "Check the dates".
- **Code date check:** after compose, before the send's insert, the drafted message is anchored at now, in their zone, with the event day as `known`. If it names exactly one day and that day isn't the event day, it's a wrong day. "how'd the race go yesterday" for a race two days earlier is caught; right day with wrong tense is left to the framing.
- **Block:**
  - guard v7 moves "getting a day wrong" out of `invented_detail` into its own honesty category, `wrong_day`;
  - for a reach-out, `wrong_day` from the guard or the code check drops it (`reach_out_log` dropped: `wrong_day`);
  - a reply still sends as is.

### 6. The guard
- **v7:** the `wrong_day` category. `renderGuardInput` shows the dividers and glosses.
- **Eval:**
  - `ip-offer-by-text` gets a user turn that mentions coffee first (B127);
  - the reach-out-dates cases expect `wrong_day`;
  - `stale-tonight` stays.

## Config, prompts, schema

- **Config:** `time.relative_max_days: 6`.
- **Prompts:**
  - extract v10;
  - user-mind summarise v5, reflect v5, model v5, ideate v7;
  - core appraise, anticipate, ruminate, wander, reflect and snapshot v4;
  - reach-out v4;
  - guard v7.

  Each replaces the previous version, which is deleted.
- **Schema:** none. Tokens live in the content. `occurred_at` and `stale_after` are unchanged.

## Scope and leak check

- `anchorTimes`, `renderTimes` and `renderAbsolute` are pure platform functions. A token holds a date and a zone, nothing else.
- User rows are anchored in the user's zone inside the user repo; core rows in her zone inside the core repo. Core loops still read only core.
- **Exit test:** the leak canary (A's token never reaches B's prompts or core), the side-channel check, and "no prompt from any builder contains ⟦".

## Exit test and review run

**Exit test, `tests/exit/phase-16b.test.ts`** (all fake, deterministic):
- **Rendering over days:** a fact stored with "tomorrow" on day 1 renders as "today" on day 2 and "yesterday" on day 3.
- **Weekdays:** a bare weekday in a summary takes the shown date.
- **Extract:**
  - with `past`, "over the weekend" dates backwards;
  - the cross-check swaps a wrong weekday;
  - a duration renders as "since".
- **Reach-outs:**
  - the framing line follows the event's status;
  - the code check drops a "yesterday" mismatch;
  - guard `wrong_day` drops a reach-out but not a reply.
- **Calendars:** with the user in London and her in Singapore, each date renders on its owner's calendar, and the NOW line shows both.
- **Conversation:** a divider and a gloss appear on an earlier-day message.
- **Safety:** no builder's prompt contains ⟦; the leak canary.

**Paid runs at close** (Ethan, 2026-10-24), each through `review-run`:
- `review:world-outreach`: misdated reach-outs and leftover un-anchored phrases, against the 10-22 run;
- `eval:guard`.

## Out of scope

- **The guard retune:** `callback-tally`, `cool-in-the-moment`, `ff-actually-happening-supported`, B128 `threat-dont-talk`. Planned after the Haiku 5.5 switch.
- **Backfill** of rows stored before 16b.
- **States aging** ("Sam is stressed"): they keep their written-on stamps.
