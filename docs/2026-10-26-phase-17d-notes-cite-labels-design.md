# Phase 17d: Notes cite labels

Design doc, 2026-10-26. Status: settled with Ethan (2026-10-26).

## Intent

The phase doc's 17d row: summarise, model, reflect and ideate cite propositions by id and never
work out dates; code renders what they cite; a note resting on a superseded label is retired; the
remaining stored-text anchoring on the user side is deleted. B1 (ideate reads her life as theirs)
and B132 (anchoring minors) are its backlog items.

Ethan, at intake: "work on the assumption that phase 16, patchwork fixes, are temporary. i want to
get the base right, and principled." So her notes get the same treatment as the user's messages:
**the model understands, code computes**. A note's references are citations, a note's own time
words are labelled in the fixed time structure, and no code parses her prose for dates.

## Spec and settled lines

- §9.5 user loops: PROPOSED, built 9a to 16b. Their date handling (Built 16, Built 16b:
  `shownDates`, anchoring on insert, "copy its date") is what 17d replaces.
- Phase doc `docs/2026-10-25-phase-17-labelled-memory-design.md` (DECIDED with Ethan): annotate,
  don't translate; the model understands, code computes; notes cite the labels they rest on.
- [[her-speech-stays-free]]: notes are her private memory, not her speech, so code may build
  them. Her messages are untouched.
- Choices Ethan settled at intake (2026-10-26):
  1. **Inline citations.** The loop writes `[m3]` where it means a memory. When the note is
     stored, code swaps in that memory's label and date token and keeps the ids.
  2. **Memories and open threads are citable.** Moves are reached through the memories that quote
     them. Citing moves directly waits until the loops read the conversation (new §25 entry).
  3. **Her notes label their own time words** in the fixed time structure, counted from now or
     from a cited memory. Code resolves them. Phase 16's parser gets no user-side caller.
  4. **Core moves to labels in 17e**, right after 17d. The note mechanism lives in `platform/` so
     both minds use it. 17e deletes `anchorTimes`, chrono and the last "copy its date" prompts.
     Phase 17 closes after 17e.
  5. **Thinking on** for the user loops, following 17a's evidence that time labels need it.
  6. **Only discrete notes are retired:** ideas, reflections and beliefs that cite a superseded
     memory. A summary or read stays until the next run replaces it whole (V9: the conversation
     leads).
  7. **B1: citations show whose, and only a contradiction drops.** A citation is optional
     everywhere: an original idea, reflection or core note that cites nothing is written. A
     rendered citation carries its owner ("telescope booking (yours)"), so every later reader sees
     whose it is. Only a note declared about them whose citations are all hers is dropped. Ethan
     (2026-10-26): requiring citations "drops original ideas or loops", so it was not built.

## Assumptions

- **Verified:** the loops write through `insertFact`, which anchors every note
  (`src/db/repos/user/facts.ts:150-176`) using `shownDates` (`process/user/inputs.ts:149`).
- **Verified:** ideate re-anchors itself and finds its source facts by embedding similarity
  (`nearestDated`, `user_mind.ideate.source_similarity`, `dated_facts`; `ideate.ts:108-121`), and
  outreach reads those sources from `payload.from` (`process/outreach/inputs.ts:148`).
- **Verified:** a memory's content is a code-built line, `label, status ⟦date⟧ — the user said
  "…"` (`memory/user/memory-line.ts:27`). Its head, everything before ` — `, is the label and its
  dates. A citation renders that head.
- **Verified:** every supersession of a user fact goes through `setFactStatus`
  (`facts.ts:244`): encode's `updates`, settling a hurt, and summary or read replacement.
- **Verified:** core anchors through `anchorTimes` in `src/db/repos/core/memory.ts` and
  `render-snapshot.ts`, and six core prompts say "copy its date". All of that stays until 17e.
- **Verified:** thinking is chosen by model role in `platform/llm/anthropic.ts:76-80`; `labels`
  has `models.labels_thinking`.
- **Assumed, low stakes:** onboarding facts and settled-hurt copies carry no time words of their
  own. Onboarding facts are code-built from quiz answers, and hurt copies come from labelled
  memories. Both lose anchoring and store as written. `DECISIONS.md` row.
- **Assumed, low stakes:** old ideas holding `payload.from` aren't migrated. Ideas live at most
  `ttl_days` (3), and the dev DB is the only DB. `DECISIONS.md` row.

## Design

### One note mechanism (`src/mind/platform/notes.ts`, new)

Framework-free and mind-free, so core can use it in 17e. Its input:

- the note's text fields by name, as the model returned them;
- the model's `times`;
- the citable items for this call, each with its short id, the text to render in its place, and
  its date if it has one (a `ResolvedTime` day);
- now, and the zone the note is written in.

It returns the rendered fields, the ids actually cited, the resolved times, and what it dropped
and why. The rules:

- **Citations.** `[m3]` / `[t1]` in a field is replaced by the item's render text. An id the
  call wasn't shown is removed from the text and logged (`bad_cite`). Text never quotes a bracket
  the model invented. Citing is never required: a field with none is written as it is.
- **Owner.** Each citable carries whose it is, and the render puts it beside the label: a user
  memory as "design interview (theirs), planned ⟦…⟧", hers as "telescope booking (yours), …", a
  shared one as "(you both)". A thread takes its subject the same way. Core items (17e) have no
  owner, since everything there is hers.
- **Its own times.** The output schema adds
  `times: [{ field, words, from, ...TimeMeaningSchema.shape, clock: optional }]`. It is the same
  structure the labels' time layer uses, with `field` in place of a piece. `words` must occur in
  that field, outside a citation. `from` is `""` for now, or a cited id that has a date. Code
  resolves with `resolveTime` from the base's local day and replaces the words with
  `labelToken(resolved, zone, words)`, so they read "tonight (that's Monday 5 January)" on a later
  day. If the words aren't found, the `from` is unknown or undated, or the meaning doesn't
  resolve, the time is dropped and its words stay as written (`words_missing`, `bad_ref`,
  `bad_time`). That is the same contract as a user time the labeller misses.
- No code reads the words for dates. The review's `relativeWords` count stays as a dev check of
  what the labelling missed, and moves with the parser in 17e.

### What the loops see (`process/user/inputs.ts`)

- `new_memories` gets ids: `{ id: "m1", subject, kind, content, when }`.
- **`earlier_memories` (new)** holds the live memories cited by the notes this loop reads, such as
  the previous summary or read, recent reflections and planned ideas, numbered after the new ones.
  A reference carried forward from an earlier note can then be cited again instead of copied as a
  date.
- `open_threads` gets ids: `{ id: "t1", line }`. A thread renders as its line, and its date is its
  event's date when it has one.
- `memoryLines`, `stampedNote`, `threadLines` and `nowLine` stay. `shownDates` is deleted.

### The loops

Each loop's output schema gains `times`, and its text may hold citations. Prompt versions:
summarise v6, reflect v6, model v6, ideate v8, consolidate v2. Each prompt replaces "copy its date"
with two rules: cite a memory or thread by its id where you mean it, and list every time word you
write yourself with what it means.

- **summarise:** fields `where_things_stand`, `whats_live`, `how_i_feel`. Its payload parts and
  content are the rendered fields, and `payload.cites` holds the cited fact and thread ids.
- **model:** fields `how_they_are`, `what_they_want`, `what_lands`, `belief_1`, `belief_2`. Each
  belief keeps its own cites.
- **reflect:** field `reflection`. It already declares `subject` (user or shared). A reflection
  declared `user` whose citations are all hers isn't written (`subject_mismatch`).
- **ideate:** field `idea`, plus **`about: "them" | "you" | "both"` (new)**.
  - **B1:** an idea declared `about: "them"` whose citations are all hers is the exact B1 shape
    and isn't written (`subject_mismatch`). An idea with no citations is written, and an
    uncited idea lasts `ttl_days`.
  - Prompt v8 replaces "an idea starts from something they told you" with "an idea can start from
    a memory or from you; anything you say about them comes from a memory you cite". This is a
    deliberate behaviour change, so original ideas get through.
  - Left to the guard: an uncited idea inventing a fact about them ("ask how their exam went" with
    no exam memory). The guard's invented-detail check sees it before any send, and the close run
    counts it.
  - The idea is stored with the subject `about` names (user, self, shared), no longer always
    `shared`.
  - `payload.cites` replaces `payload.from`, and outreach reads the cited memories' dates from it.
  - `stale_after` is `ideaStaleAfter` over the cited memories' and threads' dates plus the idea's
    own resolved times. `nearestDated` and its two config keys are deleted.
  - Tuning the expiry stays with B137.
- **consolidate:** field `gist`. Its sources are its citables, so a gist can cite them and labels
  its own times. `occurred_at` is unchanged.
- **Beliefs** are always about them, and they show their citations' owners like every note. A
  belief citing only her memories is dropped the same way (`subject_mismatch`).

### Retirement (`setFactStatus`)

When a fact becomes `superseded`, the same function marks `stale` every open `idea`,
`reflection` and `belief` of that user whose `payload.cites` holds the fact's id. Every
supersession routes through it, so no caller is missed. A summary or read is never retired this
way.

### Thinking and tokens

- New `models.user_mind_thinking` (`adaptive`), read by the provider for the `user_mind` role the
  way `labels_thinking` is for `labels`.
- Thinking tokens count toward `max_tokens`, so each loop's `user_mind.<loop>.max_tokens` rises
  (test-phase defaults sized from the fake-run token report; the close run checks them).
- Each output stays within the API's 16 nullable fields: one time shape per schema adds 5.

### Deleted (replace from the ground up)

- In `insertFact`: the anchoring, `AnchorHints`, `asSaid` and `known`. It stores what it's given.
  Encode's `{ asSaid: true }` goes.
- `shownDates`, ideate's `anchorTimes` and `tokenDates(content)`, `nearestDated`,
  `user_mind.ideate.source_similarity` and `dated_facts`, and `payload.from`.
- Prompts summarise v5, reflect v5, model v5, ideate v7 and consolidate v1, plus their tests and
  fakes.
- `anchorTimes` and `anchorFields` keep only their core callers until 17e.

### Schema

None: `cites` lives in `payload` (jsonb), and so does `about` (ideas also take it as `subject`).
The retirement query is `user_id`-scoped. Indexing `payload->'cites'` waits until it's needed
(`ponytail:` comment).

## Scope and leak check

- Everything in 17d is user scope. `platform/notes.ts` holds no user data and imports nothing
  from user, process or db code. ESLint's boundary rules apply, and core reuses it in 17e.
- Citable items are only what the run already reads for this user. The core snapshot is never
  citable.
- Ideas still read nothing sensitive. A note citing a sensitive memory is marked sensitive by the
  existing rules.
- The exit run includes the leak canary and the side-channel test.

## Exit test and review run

- **Exit test** (`tests/exit/phase-17d.test.ts`): fake LLM, fake reply, fake guard, real DB. One
  user-mind run where the fakes return citations and times. It asserts:
  - the stored notes hold rendered heads and label tokens, with `cites` set;
  - an uncited idea is written, and a citation renders with its owner;
  - an idea about them that cites only her memories isn't written;
  - superseding a cited memory retires the idea, reflection and belief but not the summary or
    read;
  - outreach reads the idea's cited dates;
  - `insertFact` stores text unchanged;
  - leak canary and side-channel test.
- **Unit tests:** `notes.ts` (each drop reason, field scoping, `from` a citation, render), the
  retirement query, and each loop's write.
- **Close runs (paid, through `review-run`, Ethan's go-ahead first):** `review:world-outreach`,
  plus `exit:user`, never run yet, for long conversations. Outputs land in `evals/results/`; the
  analysis goes in `analysis-<date>-phase-17d.md`. They check that her notes cite instead of
  dating, the bad time labels, B1, and retirement firing.

## Out of scope

- **17e (new phase-doc row):** core loops, the snapshot and world intentions on `notes.ts`; delete
  `anchorTimes`, chrono, `relativeWords` and the core "copy its date" prompts; B132 goes with them.
- **§25, new B139:** citing moves directly needs the conversation in the loops' input. Target:
  after `exit:user`.
- B137 (an after-event idea offered early) and B138 (an empty `check_in` on a big day): tuning.

## Spec write-back at close

§9.5 (notes cite and label, retirement, ideate `about`, thinking); §20 row for 17d; §25 B1 done,
B132 moved to 17e, B139 new. The phase doc gets its 17e row. `CLAUDE.md`'s current phase gets
17d's status. `DECISIONS.md` gets its two rows. The history row for the whole phase waits for 17e.
