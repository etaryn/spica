# Phase 17a: labelling the conversation

Slice design doc, 2026-10-25. Status: settled with Ethan. Phase doc:
`docs/2026-10-25-phase-17-labelled-memory-design.md`.

## Intent

Ethan wants a framework in which the user's text is kept as it is and every layer of its meaning is
labelled. The labels live apart from the text, and both are stored. Code reads only the labels;
model calls read both. Coordinates tie pieces of text, replies and conversations together.

17a answers one question before anything is rebuilt: **can the first call (extract, on Haiku 5.5)
label a conversation in this layered format reliably?** It also compares two processing units and
thinking off against on. **Nothing in the live pipeline changes.**

## Settled with Ethan (2026-10-25)

The phase direction is in the phase doc. For this slice:
- Words plus label. The model writes no sentence; a proposition's only free text is its label.
- Messages stay the stored base. The conversation is rendered as one chunk for the call.
- The replay tries both processing units: (a) after each exchange, (b) once per conversation.
- **A thinking pass:** both units run a second time with thinking on.
- **Invented chat exchanges:** about 10 short ones with chat time words ("tmrw", "tues", "monday
  week", "a few days ago"), marked as ours, not outside samples. The simulated user writes tidy
  text, so the recorded runs barely test these.

## Spec and settled lines

- §10.4 step 1 (extract): Built. 17b replaces its output; v11 stays live through 17a.
- §12.3 time anchoring (Built 16b, 16c): replaced in 17b and 17d if 17a holds.
- No retries (2026-10-22, DECIDED): a label that fails a check is dropped and logged, never
  re-asked. A call that fails is recorded and the replay moves on.
- Her speech stays free (memory): untouched. This changes only what she stores.
- Real runs log everything; paid runs need Ethan's go-ahead (§17, memory).
- Test phase, functionality over accuracy (§0.3): the replay is a hand review, not pass/fail.
- Prompt files (`prompts/CLAUDE.md`): "delete versions nothing configures". v12 is a deliberate
  exception for this slice: read only by the replay, made live or deleted in 17b (a `DECISIONS.md`
  row).

## Assumptions

Verified:
- **Structured output enforces types, not enum values.** `classifyJson` sends the zod schema
  through the SDK's `zodOutputFormat` (`src/mind/platform/llm/anthropic.ts:80`). SDK 0.127.0
  (`lib/transform-json-schema.js`) keeps only types, properties, required fields, items and a few
  string formats; enums and numeric bounds become descriptions.
  - The model sees the allowed values, but the API doesn't hold it to them.
  - `schema.parse` afterwards throws on an invalid value, which fails the whole call. This already
    applies to v11.
  - The replay counts these failures.
- `classifyJson` caches only the system prompt (`cache_control` on `system`); the input is never
  cached. Caching the stable part of the conversation is 17b's decision.
- Structured calls run with thinking off (`models.structured_thinking: disabled`). `adaptive` is
  the other allowed value (`src/mind/platform/config.ts:25`).
- `session_log.text` is never updated after insert, so coordinates into a message never go stale.
- **What a cold-path job carries:** after a reply, `turnIds` is the buffered user turns plus her
  reply (`commit-and-reply.ts:217`); after a reach-out, `[turnId]` alone (`outreach/send.ts`). In
  the 16c dump that's 16 replies with `reply_to` plus 6 reach-outs: 22 exchanges, matching its 22
  extract calls.
- The DB dumps of the three latest world runs hold every turn (`id`, `role` user | companion,
  `text`, `created_at`, `session_id`, `reply_to`, `trigger`). The user's zone is null, so the
  replay uses UTC.
  - The runs have 39 to 41 turns in 15 conversations, and 22 to 24 exchanges each.
  - Their call logs hold each extract call's input (threads with ids, her interests) and v11's
    output:
    - `evals/results/calls/eval-2026-10-22T08-27-19-194Z.jsonl`
    - `evals/results/calls/eval-2026-10-24T08-48-12-585Z.jsonl`
    - `evals/results/calls/eval-2026-10-24T15-12-40-452Z.jsonl`
- The named cases are findable by their text in those dumps.
- Every recorded conversation is 11 messages or fewer.
- Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output (`core.prices`).
- Eval tools take their provider from `evals/lib/call-log.ts` (`realProvider`), which logs every
  call. `evals/guard-replay.ts` is the precedent for a replay.

Assumed (17a tests these):
- Haiku 5.5 can segment moves, link replies and fill every layer in one call.
- The splitter (newlines, then sentence ends) is good enough. A piece is only an address, so a
  wrong split means a label cites two pieces, nothing more.

## Design

### 1. The base and its coordinates

- **The base is the messages**, one immutable row each.
- **A stored coordinate is `(turn_id, start, end)`**, a character range in one message's text.
  Labels hold coordinates, never copies of the text.
- **Pieces exist only in the prompt.** Code splits each message at newlines (her bubbles) and after
  sentence ends (`.`, `!`, `?` before a space). It numbers them `<message>.<piece>`, counting
  messages from the first one shown, and turns any cited piece back into its coordinate.
- **Phrases:** for word-level labels (time words, a mention), the model quotes the exact words
  inside one piece. Code finds them, ignoring case and spacing, and keeps their range.
- **Extent:** any set of pieces, across bubbles, speakers and messages. It must include at least
  one new piece.

### 2. Layers

**Made by code**, in `layers.ts`, from turns:
- **conversation:** the turns sharing a `session_id`.
- **exchange:** her reply plus the user turns since her previous reply or reach-out, up to its
  `reply_to` (that run of user turns is the **burst**); a reach-out alone is an exchange of one.
  Backchannels sit in the conversation but end no exchange.

**Made by the model**, in this order in the output:

| Layer | Extent | Model labels | Code adds |
|---|---|---|---|
| move | pieces of one speaker | `act`, `replies_to` (an earlier move's id) | speaker, send time, coordinates |
| mention | a phrase in one piece | `refers_to` (an open thread's id) or a new `name`, `type`, `subject`, `relation` | coordinate |
| time | a phrase in one piece | the time meaning (section 4); `from` | the resolved date |
| proposition | one or more moves | `subject`, `kind`, `label`, `status`, `times`, `mentions`, `thread_id` or `new_thread`, `updates`, `salience`, `valence`, `confidence`, `claim_kind` | checks, clamps |
| thread action | its propositions | `action`, `thread_id`, `title`, `subject`, `stakes`, `checkpoint` (a time id) | the check-in date |
| idiolect | pieces | `type` | `started_by` (the speaker of its earliest piece) |
| relationship | the moves behind it | v11's numbers; `hurt` cites moves instead of a `cause` sentence | none |
| intimacy | the moves behind it | v11's `user_disclosure`, `user_responsiveness` | none |
| bid response | the user move that answered | `toward`, `away` or `against` | none |

`act` is one of: `states`, `answers`, `confirms`, `denies`, `corrects`, `asks`, `guesses`,
`jokes`, `imagines`, `offers`, `requests`, `promises`, `bids`, `reacts`. The first five present
something as true.

### 3. The input

```
User's timezone: UTC

What Spica is into (to read her own words right):
- …

Open threads (id | title):
- 162fa6b8-… | job interview at small design studio

Conversation:
[1.1] Spica · Wed 2026-01-07 20:30 (UTC): is the interview still thursday?
[2.1] Spica · Wed 2026-01-07 20:30 (UTC): also did you ever book the train
[3.1] User · Wed 2026-01-07 20:41 (UTC): so
[4.1] User · Wed 2026-01-07 20:41 (UTC): they moved it
…

Already labelled in this conversation (exchange mode only):
moves: m1 asks [1.1] · …
times: t1 "thursday" [1.1] → Thursday 8 January 2026
propositions: p1 user event "job interview" planned · moves m1 · times t1

Label the new messages: 3 to 6.
```

- The chunk is the last `extraction.context_turns` (6) turns before the conversation, then the
  conversation itself, up to the exchange's reply in exchange mode.
- A message's first piece carries its speaker and send time (`formatLocal`, ISO date order on
  purpose); its other pieces carry the speaker only.
- Message numbers never shift within a conversation, and the parts that change come last, ready for
  17b's caching decision.

### 4. The time meaning

```
{ id: "t1", piece: "4.1", words: "friday",
  from: "said",                    // "said" | an earlier time's id | an open thread's id
  unit: "day" | "weekday" | "date" | "week" | "weekend" | "month",
  shift: 1,
  weekday: "friday" | null,  month: 1-12 | null,  day_of_month: 1-31 | null,
  part: "morning" | "afternoon" | "evening" | "night" | "start" | "end" | null,
  clock: "HH:MM" | null,  span: "at" | "since" | "until",  rough: false }
```

What `shift` means, counted from the base day ("said" is the local day of the message holding the
words):
- **day:** that many days on.
- **weekday / date:** which one: 1 is the first after the base day, -1 the last before it, 2 the
  one after next; 0 is invalid.
- **week** (its Monday), **weekend** (its Saturday; 0 is the one under way or next to come),
  **month** (its first day): 0 this one, 1 next, -1 last.

Said on Mon 5 Jan 2026:

| Said | Meaning | Resolves to |
|---|---|---|
| tmrw / yday | day +1 / day -1 | 2026-01-06 / 2026-01-04 |
| tues | weekday tuesday +1 | 2026-01-06 |
| that's sunday | weekday sunday +1 | 2026-01-11 |
| since friday | weekday friday -1, since | 2026-01-02 |
| two sundays ago | weekday sunday -2 | 2025-12-28 |
| since the 3rd | date 3, -1, since | 2026-01-03 |
| a few days ago | day -3, rough | 2026-01-02 |
| tonite at 8 | day 0, night, 20:00 | 2026-01-05 20:00 |
| end of the month | month 0, end | 2026-01 |
| the weekend after next | weekend +2 | 2026-01-24 |

- `resolveTime(meaning, baseDate)` is pure date arithmetic. It returns `{ date, precision, part,
  clock, span, rough }`, or null for an invalid meaning or clock. `renderResolved` writes it out
  ("Friday 9 January 2026", "the weekend of Saturday 24 January 2026").
- A time `from` an open thread is reported as relative to that thread: threads hold no event date
  until 17b.

### 5. Code checks

Each check runs on each label. A failure drops the label and records the reason; a label resting
on a dropped label is dropped with it (`bad_ref`).

1. Ids are unique, including against labels already made; every cited piece, move, time, mention,
   thread and `updates` target exists (`bad_ref`).
2. Every label covers at least one new piece; a proposition rests on at least one move with a new
   piece (`nothing_new`).
3. A move's pieces all belong to one speaker; `replies_to` names a move that starts earlier
   (`bad_move`).
4. A phrase's words are found in its piece (`words_missing`).
5. A `user` proposition rests on a **new** user move whose act presents something as true; a
   `self` proposition on a new one of hers; a `shared` one on either speaker's (`wrong_speaker`).
   So an old statement can't come back in on a new "lol".
6. A bid response points at one of the user's moves (`wrong_speaker`).
7. A time meaning resolves (`bad_time`).

Numbers are clamped as v11's are.

### 6. The two processing units

- **(a) Exchange mode:** for each exchange in order, the call sees the conversation up to that
  exchange's reply and the labels already made in the conversation, and labels the exchange's
  messages. Its checked labels join "already labelled" for the next call.
- **(b) Conversation mode:** one call per conversation, every conversation message new.

One prompt serves both. Measured on the recorded runs (rough: characters / 4), (a)'s
conversation-text input is about today's and (b)'s about a third less. In these short
conversations the prompt itself, sent on every call, dominates. In long conversations (a) grows
with the square of the length; 17b decides the window and caching.

### 7. Prompt: `prompts/extract/v12.md`

Rewritten from v11:
- one section per layer, in output order;
- the relationship, intimacy and bid wording carried over, pointed at moves;
- the rules: cite pieces and never restate what was said; moves first, with replies linked even
  across other messages; only a move that presents something as true can carry a memory; for
  time, say what the words mean, never a date, and quote the words exactly; don't repeat what is
  already labelled, and use `updates` to change it;
- short invented examples: meaning spread over three bubbles, and a late reply to the earlier of
  two questions.

`prompts.extract` stays v11.

### 8. Where it lives

| File | Holds |
|---|---|
| `src/mind/platform/time-labels.ts` | `TimeMeaningSchema`, `resolveTime`, `renderResolved`. Pure, with no user data, so core can use them later |
| `src/mind/memory/user/pieces.ts` | `numberPieces`, `findPhrase`, `coordinate`, `renderPieces` |
| `src/mind/memory/user/layers.ts` | `conversations`: the code-made layers from turns |
| `src/mind/memory/user/annotations.ts` | `LabelsSchema` (v12's output), `checkLabels`, `mergeLabels` |
| `src/mind/memory/user/label-input.ts` | `buildLabelInput` |
| `prompts/extract/v12.md` | the prompt |
| `evals/lib/replay-source.ts` | rebuilds each run's conversations from its dump and call log |
| `evals/lib/slang-conversations.ts` | the invented chat exchanges |
| `evals/lib/label-review.ts` | `renderReview`, the review file |
| `evals/extract-replay.ts` | `pnpm review:extract-labels` |

Tests mirror the source under `tests/mind/` and `tests/evals/`, written first.

### 9. The review file

`evals/results/review-extract-labels-<stamp>.md`. The calls go to
`evals/results/calls/extract-replay-<stamp>.jsonl` and `extract-replay-thinking-<stamp>.jsonl`.

- **Top: the totals per unit and pass.** Calls, failed calls, labels per layer, drops per reason,
  measured tokens (input, output, cache) and cost.
- **Named cases first,** found by text:
  - "has it been dark since friday";
  - "okay the interview happened";
  - "ok i should really try to sleep";
  - "telescope zoning out sounds nice";
  - "no half marathon yet lol";
  - "i think it went well?".
- **Then every conversation, invented ones last:**
  - the numbered chunk;
  - its exchanges;
  - v11's facts as logged;
  - for each unit and pass, the labels layer by layer: moves with acts and replies; mentions;
    times with the resolved date written out; propositions with the cited words, speaker and
    time; threads; idiolect; relationship signals; drops with reasons.

## Scope and leak check

All of this is user scope: `memory/user/`, a pure resolver in `platform/`, and `evals/`. No core
code changes; her snapshot's Interests are read from the logs as shown. The replay reads dumps and
logs and writes no database. The leak canary and the side-channel test are unaffected (no pipeline
change); they run from 17b on.

## Exit test and review run

- **Deterministic:** unit tests, written first:
  - `resolveTime` and `renderResolved` (the table above, anchored Mon 5 Jan 2026, plus invalid
    meanings);
  - splitting, numbering, phrases and coordinates;
  - the code-made layers;
  - each check, with a passing and a failing case;
  - the input builder;
  - that the schema converts for structured output;
  - that the replay source parses a logged input;
  - the review renderer.

  Then typecheck, lint and the touched tests.
- **Paid replay:** `pnpm review:extract-labels`, through `review-run` with Ethan's go-ahead.
  - Calls per pass: 81 in exchange mode (68 recorded, 13 invented) and 55 in conversation mode
    (45 recorded, 10 invented); two passes.
  - Cost: about 12 cents with thinking off; thinking on adds an estimated 25 to 40 cents.
- **Read together.** 17a holds if:
  - no named case reproduces;
  - moves and replies are grouped right;
  - the invented chat time words resolve right;
  - nothing important that v11 caught is missing;
  - drops are real faults, not checks misfiring;
  - failed calls (invalid enum values) are rare.

  Then choose for 17b: exchange mode, conversation mode or both, and thinking on or off.

## Out of scope

- 17b, 17c and 17d, as in the phase doc.
- Long conversations: they come at 17d's close.
