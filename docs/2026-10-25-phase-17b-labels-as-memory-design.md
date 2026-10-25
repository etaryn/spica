# Phase 17b: labels as memory

Design doc, 2026-10-25. Status: draft (Ethan's four choices settled; the rest awaits his review).

## Intent

From the phase doc: v12 goes live in the cold path, and labels become what she remembers.
- The words stay in `session_log`.
- The labels are stored apart from the words, pointing into them by character range.
- A memory is a proposition label resting on moves.
- Every reader shows the label, the date code computed and the words it rests on.
- What the labels replace is deleted: v11, the stored-text anchoring of extracted facts and
  `when_direction`.

## Spec and settled lines

- **DECIDED (phase doc, Ethan 2026-10-25):**
  - annotate, don't translate;
  - words plus label;
  - the model understands and code computes;
  - who said it and when come from the transcript;
  - exchange mode;
  - a broken link drops only the link;
  - messages stay the stored base;
  - her speech stays free (code never templates what she says).
- **DECIDED (Ethan, this intake):**
  1. **The memory line** is label, status and date, then the words it rests on, quoted with their
     speaker. Code builds the line each time a memory is shown.
  2. **B133:** thinking on the meaning call too. Its grammar is then over the limit, so it splits
     in two, making three calls per exchange.
  3. **Reconcile:**
     - within a conversation, a proposition's `updates` id supersedes that memory directly, with
       no reconcile call;
     - across conversations, the reconcile call stays.
  4. **Glosses** on older messages in her view of the conversation come from their time labels,
     never from parsing.
- **Stays from Phase 16 (phase doc):**
  - send time as the base;
  - dates rendered with their distance (`renderTimes` in `withTimeRendering`);
  - `nowLine`;
  - day dividers;
  - guard `wrong_day`.
- **Spec sections changed at close:** §6.1, §10.4, §12, §20 row, §25 (B133–B136 resolved or
  moved).

## Assumptions

Verified:
- Every reader of a memory reads `fact.content`:
  - retrieval (`retrieve.ts:112,148`, then `assemble.ts:196` and the guard's `recalledFacts`,
    `guard.ts:76`);
  - user-mind inputs (`inputs.ts:113`);
  - outreach (`outreach/inputs.ts`, `candidates.ts`);
  - reconcile neighbours (`facts.ts:98,128`).

  `ownDate` already skips the trailing date when the content carries a date token
  (`assemble.ts:195`).
- `withTimeRendering` renders every `⟦local|precision|zone⟧` token in every prompt with its
  distance (`render-net.ts`), so a line code writes with tokens reads right on any later day.
- Reconcile is shared with core world events (`world/events.ts:347`), so it stays as it is.
- Thinking is one global switch for structured calls (`anthropic.ts:76`,
  `models.structured_thinking`). Turning it on for labelling alone needs its own key.
- v12's hurt block has no `cause` text, only the moves that hurt (`annotations.ts`
  RelationshipSchema). Today the hurt fact's words come from that cause (`hurtFactContent`).
- 17 test files and the fake provider (`fake.ts:46`, with the canary at `:47`) build v11
  extractions. The six eval scripts with `seed_user_facts` seed facts directly, not through
  extract.
- In the 17a rerun's first recorded conversation, "i have a job interview on thursday afternoon"
  produced no proposition at all, where v11 stored one. The meaning call can stay silent on
  what matters most, so B135 is a real gap, not only a difference in granularity.

Taken as the simplest option (each gets a `DECISIONS.md` row at build):
- **B134:** a memory's times must sit in the pieces of the moves it rests on. A time from
  anywhere else drops as a `bad_link`.
- **B136:**
  - a value outside its allowed list drops only its own label, with a new `bad_value` reason;
  - every other label from the call stays.

  How (a lenient parse, then a strict check per label) is settled in the plan, after reading the
  provider's parse.
- **The input window:** as in 17a. The conversation so far plus `extraction.context_turns` turns
  before it, capped at a new `labels.window_messages`. A label on a message outside the window
  is still stored; only links to it break.
- **Cache layout:** the system prompt is cached (`models.extract_cache`), as now. The input
  keeps what changes last, so prefix caching can come later; not built now.

## Design

### 1. Labels v1 and the three calls (first, then a replay rerun)

- **Hand pass for B135 (free).** Compare the rerun's 57 memories with v11's 148 facts in
  `review-extract-labels-2026-10-24T19-57-11-880Z.md`. Sort each gap as:
  - v11 split finer (fine);
  - v12 missed it (prompt);
  - the check dropped it (code).

  The findings go in the analysis file.
- **`prompts/labels/v1.md`** (the labelling process gets its own prompt folder and model role, so v11 runs untouched until it is deleted): extract v12 plus what the hand pass shows, and the B134 line for the
  model (a memory's times come from the moves it rests on).
- **Three calls:**
  - the reading call: moves, mentions, times;
  - meaning call one: propositions and threads;
  - meaning call two: idiolect and the relationship, intimacy and bid blocks.

  All three think. Each later call sees the earlier calls' checked labels as "already labelled",
  as the meaning call does now. A new model role `labels` with its own keys (`models.labels`,
  `labels_thinking: "adaptive"`, `labels_max_tokens`, `labels_timeout_ms`, `labels_cache`) and
  `prompts.labels`; the provider reads `labels_thinking` for it the way it reads `judge_thinking`
  for the judge. Purposes `labels_read`, `labels_meaning`, `labels_signals`.
- **The live labelling module:** `memory/user/label.ts` takes over the loop body from
  `evals/lib/label-replay.ts` (the calls, the checks, the merge), and the replay calls it, so
  the replay always runs live code.
- **Paid replay rerun** (`pnpm review:extract-labels`, through `review-run`, Ethan's go-ahead).
  It measures B133 (memories lost to invented ids), B135 (the gaps) and the cost of three calls.
  Live wiring starts only after Ethan has read it.

### 2. Storage (user scope; one migration)

- **`annotation`** (new):
  - `id`, `user_id` (cascade);
  - `session_id` (the conversation);
  - `exchange_ref` (the reply turn whose cold path wrote it);
  - `layer` (`move | mention | time | proposition | thread | idiolect`);
  - `local_id` (the conversation's own id: `m3`, `t2`);
  - `coords` (jsonb: `[{turn_id, start, end}]`, empty for layers that point only at labels);
  - `data` (jsonb: the checked label as `checkLabels` returns it; a mention's also holds its
    `entity_id`);
  - `fact_id` (nullable: the memory a proposition or idiolect label became);
  - `created_at`.

  The layers stored are move, mention, time, proposition and idiolect. Thread actions live in
  `thread`, and the relationship blocks in the relationship's own rows.

  Unique on (`user_id`, `session_id`, `local_id`), indexed on (`user_id`, `session_id`). It
  stores what the next exchange's call needs as "already labelled", the times behind the glosses,
  and what 17c and 17d will cite.
- **`fact`**, the proposition layer, with no new columns:
  - `content` is the memory line (section 4), written once, when the fact is made: its label and
    words never change after that, and its dates are tokens rendered when each prompt is sent;
  - `occurred_at` is its first resolved time (the start of its day, week or month in the user's
    zone);
  - the label, its status and its links stay in its proposition's annotation row, which points
    at the fact through `fact_id`.

  Facts not made from labels (onboarding, seeds, her notes) read as they do now.
- **`thread`:** no new column. A thread's event date is its latest labelled fact's date, found
  when the thread is read. `next_checkpoint` stays when to ask (B131).

### 3. The cold path on labels

`runColdPath` keeps its transaction, lock, failure counting, relationship savepoint, big-event
check and module events. What changes:

- **Label:**
  - `label.ts` runs the three calls over the window;
  - "already labelled" is rebuilt from the session's annotation rows;
  - piece ids are worked out again from their coordinates, so a window moving never breaks a
    stored label.
- **Encode** (`encode.ts` works on checked labels; the v11 types go):
  - **annotations:** one row per kept move, mention, time, proposition, thread action and
    idiolect.
  - **entities:** from the mentions that name something new. `refers_to` sets the fact's
    `thread_id`; `name` and `relation` go to `upsertEntityMention`; the words become an alias
    when they differ from the name.
  - **threads:** open, touch or resolve by id. The checkpoint comes from the `checkpointAt` code
    resolved.
  - **facts:** one per proposition:
    - `content` is the label;
    - salience, valence and confidence come from the label;
    - `claim_kind` and grounding work as now;
    - `updates` set: supersede that fact directly;
    - otherwise: reconcile against neighbours as now, shown as memory lines (section 4).
  - **idiolect:** a fact of kind `idiolect`. Its content is the quoted words of its pieces;
    `started_by` is the earlier speaker.
  - **hurt:** the self `feeling` fact's content is code-built from the hurt moves' words. The
    signals map v12's blocks onto the existing `Signals`, `Intimacy` and bid shapes, so
    `updateRelationship` and `bidAfter` are unchanged (17c reworks `bidAfter`).
- **Embedding** of a labelled fact: its label plus the words it rests on.

### 4. Readers: the memory line

- **One renderer:** `memoryLine` (pure, `memory/user/memory-line.ts`) builds the line when the
  fact is written, and it becomes the fact's `content`. Every reader already reads `content`:
  - retrieval;
  - user-mind inputs;
  - outreach inputs and candidates;
  - reconcile neighbours;
  - due-thread detail.

  So the readers don't change. Each date is a token, and `withTimeRendering` renders it with its
  distance on the day each prompt is sent, which is the part that has to happen at read time.
  The line's other inputs (the label and the words) never change after the fact is written.
- **The line:**

  ```
  job interview, happened ⟦2026-01-08|day|Europe/London⟧ — the user said "okay the interview happened" / "i think it went well?"
  train ticket, happened — Spica asked "and did you book the train"; the user said "and yes booked"
  ```

  - Dates are tokens, rendered with their distance on the day a prompt is sent.
  - The verb comes from the move's act (said, asked, answered, confirmed…).
  - Each quote is capped at `labels.quote_chars`, cut at a word.
  - Speakers read "the user" and "Spica", as stored facts already do.
- **Glosses:** `assemble.ts` drops `anchorTimes` on older messages. Each time label on an older
  message puts its token right after the words it covers. Messages with no time labels show as
  written.
- **Thread lines** (`threadLines`, outreach): `title (on ⟦event date⟧; ask after ⟦checkpoint⟧)`,
  so the check-in never reads as the event (B131).

### 5. Deletes (same slice)

- `prompts/extract/` (v11, and v12, which labels v1 replaces), and `models.extract*` and
  `prompts.extract`;
- `extract.ts` with `ExtractionSchema`, `when_direction` and the extraction's anchoring;
- the v11 parts of `encode.ts`;
- `anchorTimes` on older messages in `assemble.ts`;
- the fake provider's v11 `extract` handler (replaced by label handlers, the canary included);
- v11 fixtures in the 17 test files (rebuilt from a small helper that turns a fact spec into
  labels);
- any config key only v11 read (`extraction.max_candidates` if nothing else does).

`insertFact`'s anchoring stays for her notes until 17d. Labelled facts skip it, the way idiolect
already does.

### 6. The 16d re-check (at close)

B1, B129, B130, B131 and B132 are each re-checked against the close run. Each is either closed in
§25 with its evidence, or left with a target.

## Scope and leak check

- All of it is user scope:
  - `annotation` is `user_id`-scoped;
  - the repo is in `repos/user/`;
  - the labelling and encoding code is in `memory/user/` and `process/cold-path/`.
- No core loop reads any of it. Reading core stays one-way, as now: her snapshot's Interests in
  the input, claim grounding.
- The exit test runs the leak canary, with the fake provider's label handler carrying the canary
  into propositions, mentions and the hurt words, and the side-channel test.

## Exit test and review run

- **`tests/exit/phase-17b.test.ts`:** fake LLM, fake guard and fake reply, real DB.
  - Scenarios:
    1. A conversation over two exchanges stores annotations and facts, and the second call sees
       the first's labels.
    2. "they moved it to friday" supersedes the earlier interview fact through `updates`.
    3. A memory line in the reply prompt carries the label, the token date and the quoted words.
    4. A gloss on an older message comes from its time label.
    5. A thread line shows the event date apart from the check-in.
    6. A dropped label (bad value, invented id) loses only itself.
    7. The leak canary and the side-channel test.
- **Paid runs** (each through `review-run`, each with Ethan's go-ahead):
  1. the replay rerun of section 1 (estimated $0.15–0.25; outputs in `evals/results/` and
     `evals/results/calls/`);
  2. the close run `review:world-outreach` (cost from its pre-flight). It shows what the
     two-week world run stores and how reach-outs read it, and feeds the 16d re-check.

## Out of scope

- 17c: turn-taking on labels (open questions as piece ids, B9, `bidAfter` from replies).
- 17d: her notes cite labels; the rest of the stored-text anchoring goes.
- Caching the conversation prefix in the labelling input: a §25 entry if the close run's cost
  says it matters.
- Core memory adopting labels: the §25 entry the phase doc names.
- The inspector shows a labelled fact's label as its content; showing the words there waits for
  a frontend phase.
