# Phase 15a: her voice (texting, not LLM text)

Design doc, 2026-10-15. Status: approved in discussion with Ethan, awaiting review of this file.

## Phase 15: Tuning

Phase 15 works every §25 item marked *Tuning*, in four slices. Each slice opens by discussing
its items one by one with Ethan, settling the line and what feels right, before any design or
build.

| Slice | Items |
|---|---|
| **15a. Her voice** | B32, B33, B3, B57, B35 (B34 moves to *Frontend*) |
| **15b. Negative situations** | B14, B91, B115, B15, B113, B37, B40 |
| **15c. Memory, relationship, user mind** | B4, B5, B41, B38, B67, B70, B71, B81, B83, B85, B86, B87, B90, B92 |
| **15d. World, outreach, posts** | B18, B19, B20, B24, B25, B29, B108, B109, B110, B111 |

15b follows 15a because the guard line has to be calibrated against her new voice, not the old
one.

Two rules hold for the whole phase:

- **No external samples.** Nothing is tuned against outside chats or reference texts: that tunes
  her to someone's bias.
- **Tune base Spica; each user brings their own bias.** What this phase sets is base Spica, the
  same for everyone. Moving toward a user's style happens per user, measured from that user's own
  messages only: user-scoped, never core.

## Goal

Her replies read like a person texting, not an LLM writing a reply. Evidence from the last
real-reply run (`evals/results/review-2026-10-12T19-04-48-414Z.md`, reply v16):

1. Length doesn't track the user's: six words in, forty-five out.
2. The same shape every time: a reaction, then a follow-up question, as two texts.
3. Em dashes, end full stops, mixed capitals.
4. Feelings narrated in full sentences in tense moments.
5. Commentary on how the user texts ("that's a very 'ok cool, anyway' kind of reply").
6. Memories used without naming them, and dropped in only to show she remembers (B3).

Her dry one-liners and lowercase already work and stay.

## Decisions (Ethan, 2026-10-14/15)

### B32 register

- **Length.** Her average reply stays about the length of theirs. Total length and bubble length
  are separate: **bubble length** tracks the user's, and **bubble count** carries extra content
  when she has more to say. Not a hard constraint; she deviates when she has something to say.
- **Register (option A).** A fixed casual base: all lowercase including "i" and names, no full
  stop at the end of a bubble, commas and question marks only where needed, no em dashes, no
  bracketed stage directions, natural dropped words, tics rare. **Formality** (capitals, end
  punctuation) and **emoji rate** drift *partway* toward each user's own; she never turns formal
  and never passes one emoji per message. Slang becomes hers with a user only through idiolect,
  never by copying.
- **Shape (option C).** Code picks a **move** per reply by weighted chance (`react`, `share`,
  `ask`), weights in config so it can grow into a tunable framework. Context overrides the dice:
  if they asked her something or open questions are pending, she answers first.
- **Narration (option A).** Feelings come out short and in the moment ("ok that stung", "wow ok");
  more needs short texts, never a paragraph about her inner state. Noticing their mood is allowed
  as a question ("you ok?"), never as analysis of their message; she never quotes their text back
  or describes their texting style. The *content* of negative reactions is 15b.

### B33 greeting echo (option A)

No backchannel on a buffer that is only a greeting; if a greeting deserves a greeting, the reply
gives it. Whether a backchannel fires is a short fixed rule list in code; the judge still writes
the words:

- only while they're mid-thought (`complete: false`)
- never on a greeting-only buffer
- never repeating the user's own words
- at most one per buffer, rate-limited (as now)

### B3 recall style (option A)

- A memory **about what they're saying now** is used by name or detail, in passing ("poor
  biscuit", "is this about mia leaving?").
- A memory **not tied to what they said** comes up only as something she'd really ask (a
  follow-up, an open thread), never as a quip whose point is "I know this about you".
- **At most one memory per reply** (was one or two).
- Callbacks to shared jokes (idiolect) stay.

### B57 phrase files (option A)

- Drop the "nothing's wrong" lines (hurt or tension below baseline: "at peace", "calm").
- Rank the remaining lines by distance from baseline and keep the strongest few (config cap).
- Reword heavy lines so they read as background, not a topic.
- Her state also biases the move weights and the length band in code (worn out or flat: more
  `react`, a little shorter; hurt or prickly: less `share` and `ask`; good mood or wired: more
  `share`). Bias sizes in config.

### B35 reply model (option A)

A deterministic voice report on every review run, plus a blind model comparison Ethan reads.
The model stays Sonnet 5 until Ethan chooses.

### B34 latency and catch-up

Out of tuning: retargeted to a future *Frontend* phase, catch-up showing unsent bubbles noted
with it.

## Design

### Reply pipeline

All new code is framework-free in `src/mind/process/hot-path/` and reads only this user's data
plus core state (already in the reply).

1. **`textingShape(userTurns, config)`** (pure). From the user's last `voice.window_messages`
   messages (already loaded by the hot path) it computes:
   - **median words per bubble**, blended from `voice.base_words_per_bubble` toward the user's
     median by `count / window_messages` until the window is full; the median keeps one long rant
     from skewing it;
   - **formality**: the share of their messages with a capital start or end punctuation;
   - **emoji rate**: emoji per message.

   Output: `{ band, formal, emojiRate }`, where `band` is one of `voice.bands` (e.g. a few words /
   a sentence / a couple of sentences, each with a word range) and `formal` is
   `formality >= voice.formal_threshold`.
   Ceiling: a recent window, not stored state; if it proves jumpy, swap in a rolling average in
   user state behind the same function.

2. **`pickMove(seed, weights, bias, mustAnswer)`** (pure). A weighted draw over
   `react | share | ask` using `seededUnit(anchorTurnId)`, so retries and evals pick the same
   move. `weights` from `voice.moves.weights`; `bias` from her feeling and this user's state via
   `voice.moves.bias` (per state key, a multiplier per move). `mustAnswer` (they asked her
   something, or open questions are pending) yields "answer, then the drawn move".

3. **"How to text this one"** (new prompt section, assembled after "How open you feel"). Code
   phrases the band, their register (formal or not, emoji rate) and the move from
   `prompts/voice/how-to-text/v1.md`. The model sees words, never numbers.

4. **`shapeText(text, shape, config)`** (pure), run **after the guard**: the guard approved the
   content, this only changes form. It never removes words.
   - `—` and `–` become a comma, or a bubble break at a sentence end;
   - unless `shape.formal`: lowercase every capitalised word (sentence starts, "I", names,
     titles), leaving all-caps words alone (acronyms, shouting); drop a full stop at the end of
     each bubble (never "..." or "?");
   - a bubble over `band.max_words × voice.split_tolerance` splits at sentence boundaries, up to
     `chat.max_parts`; a single over-long sentence is left whole.

   It returns text with blank lines between bubbles, so `splitParts` stays the only splitter and
   history and SSE split stored text the same way. Bracketed stage directions are left to the
   prompt and counted in the voice report: removing them would cut content.

5. **Feeling lines.** `core-state/line` and `relationship/summary` lines are ranked by deviation
   and capped at `voice.feeling_max_lines` (one shared cap over both sections); the
   below-baseline hurt and tension keys are deleted.

6. **Backchannel rules** in `turn_backchannel`: drop the judge's text when every buffered message
   matches `turn.greeting_words` (normalised, punctuation and repeated letters stripped: "hiii!"
   is "hi"), or when the backchannel's normalised words are contained in the user's buffered
   words.

**Crisis** skips 1–4 entirely: no band, no move, no shaping, so plain support and the resources
card stay as built. **Reach-outs** get the band and register from history and no move (the
reach-out prompt already says what she's doing), and are shaped by `shapeText`.
**Backchannels and availability notes** are not shaped (already tiny and judge- or
phrase-written).

### Prompts

- `prompts/reply/v17.md`: "Texting rhythm" and "Format" follow "How to text this one" and the
  narration rule; "Show that you remember" carries the B3 rule and "at most one memory".
- `prompts/turn-judge/v2.md`: no backchannel on a greeting-only buffer; never repeat their words.
- `prompts/core-state/line/v4.md`, `prompts/relationship/summary/v3.md`: noise keys removed,
  heavy lines reworded.
- `prompts/voice/how-to-text/v1.md`: band, register and move phrases.
- The persona's "How you talk" stays as written (Ethan's file); the base rules live in the reply
  prompt and in code. v16, turn-judge v1, line v3 and summary v2 are deleted once nothing
  configures them.

### Config (new `voice` block, all numbers)

`window_messages`, `base_words_per_bubble`, `bands`, `formal_threshold`, `split_tolerance`,
`feeling_max_lines`, `moves.weights`, `moves.bias`; plus `turn.greeting_words`. Starting values
are set at build time and tuned from review runs.

### Evals and review

- **Voice report** (`evals/lib/voice-report.ts`), printed with every review run. Per reply: the
  band, her bubble word counts, em dashes, capitals, end full stops, ends-in-question, move picked
  vs move followed (cheap pattern checks: a question for `ask`, a first-person statement for
  `share`), memories named, feeling lines shown, stage directions. Totals per script.
- **Blind model comparison** (`pnpm review:voice`): one script set run on Sonnet 5 and on Haiku,
  transcripts labelled X and Y in random order, the key in a separate file read afterwards.
- **New review script** with a short-texting user and a long-texting, formal user, so the
  per-user fit shows in transcripts.
- `recall-pet` and `recall-sister-uni` lose their `known_failure`: naming the detail is expected.
- The guard runs on the new voice unchanged here; 15b recalibrates it.

### Exit test

`tests/exit/phase-15a.test.ts`, deterministic; the reply model is faked to write long,
em-dashed, capitalised replies; the guard is faked (passes).

- Stored bubbles fit the band for a short-texting user and for a long-texting one; content words
  are all kept.
- A formal user keeps capitals and full stops; others get the casual base.
- The move is fixed for a given seed, biased by state, and overridden by an open question.
- A greeting-only buffer ("hiii") gets no backchannel; an echoing backchannel is dropped.
- Feeling lines are capped; "at peace" and "calm" never appear.
- A crisis reply is untouched by shaping and carries no move.
- The leak canary passes, and user A's shape never reaches user B's prompt.

Unit tests cover `textingShape`, `pickMove`, `shapeText` and the backchannel rule. Quality is
not an exit criterion: it is read by Ethan in review runs with the voice report.

### Scope rules

Everything reads the current user's messages and state or core state already in the reply; no
core loop sees any of it and nothing is written to core. The shape is computed per reply and not
stored.

### Afterwards

Every new config key, prompt version, the voice report and `pnpm review:voice` go into v3 (§10,
§12, §20, §25), and the decided items are marked done in §25.
