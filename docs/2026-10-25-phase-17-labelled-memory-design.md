# Phase 17: Labelled memory

Phase design doc, 2026-10-25. Status: direction settled with Ethan; each slice gets its own design
doc before it is built.

## Intent

Ethan, after the Phase 16 time work: many issues "arise from the transition from the user text to
how it is stored and processed for calls and eventually revisited", and this "extends beyond time
related issues". He wants "to solve the root cause first", not "patchwork solutions to each case",
and has "no attachment to the solutions in 16".

The phase builds **a framework in which what is said is kept exactly as said and every layer of
its meaning is labelled**:
- the labels live apart from the text, and both are stored;
- code reads only the labels; model calls read both;
- coordinates tie pieces of text, replies and conversations together.

The layers built here are a first set; the infrastructure is the point, and layers are added later.

## Why (the evidence)

- **Where errors start.** In the 16c close run, every user-fact error started at extraction, the
  one place where what was said becomes what is stored:
  - "since friday" read forward;
  - a day added to "the interview happened";
  - a user fact taken from her words;
  - a speaker swapped;
  - facts lifted from the earlier-conversation block that the prompt said never to extract from.

  Downstream loops then multiplied them, for example "deadline day".
- **Prompt rules are not obeyed, and code can't enforce them.** The extract prompt already forbids
  most of this. Code could not check it, because a stored fact has no pointer back to the words it
  came from.
- **Parsing words can't settle meaning.** The Phase 16 anchoring parses prose for dates. On 24 chat
  phrasings it got 2 right, 5 wrong and left 17 alone. Each run found new parser cases.

## The direction (settled with Ethan, 2026-10-25)

- **Annotate, don't translate.** The words are never rewritten; labels sit apart, pointing into the
  text by coordinates. Labels are the normaliser code reads.
- **Words plus label:** the model writes no sentence about the text; a memory's only model-written
  text is a short noun-phrase label.
- **The model understands, code computes.** The model says what time words mean in a fixed
  structure; code does every date calculation, from the send time of the message the words are in.
- **Who said it and when come from the transcript**, never from the model.
- **Pieces are addresses, not units of meaning.** A label covers any set of pieces, across bubbles,
  speakers and late replies.
- **Layers point at the layers below them:** moves (dialogue acts, with what each replies to),
  mentions, times, propositions (memories), thread actions, relationship signals, idiolect. Code
  makes the conversation, burst and exchange layers from what turn-taking records.
- **Messages stay the stored base.** A conversation is a layer over its messages, rendered as one
  chunk for a call, not stored as one item: the hot path needs single messages, and links across
  conversations would remain anyway.
- **Extraction records only what a speaker presents as true.** Inference is the user-mind loops'
  job, stored as her notes, which cite the labels they rest on.

## Slices

| Slice | Builds | Exit |
|---|---|---|
| **17a. Labelling the conversation** | The pieces and coordinates; the code-made layers; the layered output schema and its checks; the time resolver; extract v12. A replay over the recorded runs and invented chat exchanges compares two processing units (after each exchange, once per conversation), thinking off and on. **Nothing live changes.** | Unit tests; a hand review of the replay. Decides the processing unit and whether extract needs thinking |
| **17b. Labels as memory** | v12 live in the cold path. Stand-off storage: an `annotation` table for the text layers; `fact` as the proposition layer; coordinates into `session_log`. Every reader shows words with code-rendered dates: reply, user-mind inputs, outreach, guard, retrieval. Reconcile through ids; threads hold their event's date apart from the check-in; the input's window and cache layout. **Deletes** v11, the stored-text anchoring for extracted facts, `when_direction`, and what reconcile no longer needs | Exit test with the leak canary and the side-channel test; close run `review:world-outreach` |
| **17c. Turn-taking on labels** | The code-made layers written as the system runs. The turn judge cites piece ids for open questions instead of rewriting them; a question closes when a move replies to it (B9). Bid responses come from replies (`bidAfter`) | Exit test |
| **17d. Notes cite labels** | Summarise, model, reflect and ideate cite propositions and moves by id and never write dates; code renders what they cite; a note resting on a superseded label is retired. **Deletes** the remaining stored-text anchoring (`shownDates`, anchoring in `insertFact`, the merge, ISO and clause rules) | Exit test; close run `review:world-outreach`, plus `exit:user` (never run yet) for long conversations |

**17a is built (2026-10-25).** What it settled for 17b:
- **Exchange mode** (Ethan).
- **Two calls per exchange,** because one grammar for every layer is over the API limit:
  - a reading call (moves, mentions, times) with thinking;
  - a meaning call (propositions, threads, idiolect, relationship) without.
- **Optional ids say none with "",** because the API allows at most 16 nullable fields.
- **A broken link drops only the link,** and an earlier message with no move yet may be context.

Results, open items and the analysis: §20 row, §25 B133–B136,
`evals/results/analysis-2026-10-25-phase-17a.md`.

The order is fixed by dependency: 17b needs 17a's format, 17c needs 17b's storage, and 17d needs
labels in storage to cite. Storage and readers land together in 17b, since writing a format no
reader can read would need a shim, which the replace-from-the-ground-up rule rules out.

## What happens to Phase 16

- **Goes:**
  - every parse of stored prose for dates;
  - the date tokens embedded in stored text;
  - the dates her loops write;
  - B129–B132 as separate fixes.

  Most of this goes in 17b; the rest, for her notes, in 17d.
- **Stays:**
  - message send time as the moment a phrase is resolved from;
  - each date rendered with its distance for the reader;
  - `nowLine` with both zones;
  - day dividers in her view of the conversation;
  - guard `wrong_day`, which judges her outgoing messages, not storage.
- **To settle in 17b:** the date glosses on older messages in her view of the conversation. They
  parse raw text, which tested weak.
- **Phase 16d is paused.** At 17b's close, each 16d item (B129–B132, B1) is re-checked against the
  new pipeline; what is left is fixed or backlogged then.

## Scope

- All of it is user scope. Core loops never read user data; core's own loops show the same pattern
  (her bare weekday copied in T4), so core memory can adopt the framework later. That is a §25
  entry, not part of this phase.
- Every slice's close runs the leak canary and the side-channel test from 17b on.
- Her speech stays free: this changes what she stores and how memories are shown to models, never
  what she says.

## Spec write-back

- **Each slice's close:** its §20 row, and the sections it changes:
  - 17a: §20 and §10.4 (v12 exists, replay only);
  - 17b: §6.1, §10.4, §12;
  - 17c: §10.1;
  - 17d: §9.5.
- **At 17a's close:** CLAUDE.md's current phase.
- **At the phase close:** `docs/spec-v3-history.md` gets the full row.

## Risks

- **One call doing every layer** may be too much for Haiku 5.5 without thinking. 17a measures it,
  and the fallback is a reading call plus a meaning call.
- **Enum values are not enforced by structured output.** The installed SDK (0.127.0) moves enums
  into descriptions, so the API enforces types and required fields only. An invalid value fails
  the whole call when it is parsed, as it already can for v11. 17a counts how often; 17b decides
  whether a bad value should drop one label instead.
- **Long conversations are untested.** Every recorded one is 11 messages or fewer; 17d's close
  includes a long-conversation run.
