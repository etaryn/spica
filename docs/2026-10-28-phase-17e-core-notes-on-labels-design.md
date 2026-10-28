# Phase 17e: core notes on labels

Design doc, 2026-10-28. Status: draft (Ethan's four intake choices settled; the design below
awaits his OK).

## Intent

"Start phase 17e." The phase doc's row: core loops, the snapshot and the world's planned-event
intentions write through `platform/notes.ts`. They cite core memories and label their own time
words. 17e **deletes** `anchorTimes`, `anchorFields`, chrono, `relativeWords` (moved into evals;
see below) and the core "copy its date" prompt lines. B132 goes with them. It is the last slice
and closes Phase 17.

## Spec and settled lines

- §8.1, §8.3, §8.5: core memory, world and loops (DECIDED, Built). The "Built 16 / 16b / 16c"
  bullets in §8.5 are what this replaces.
- §4 scope: core loops read only core memory, core state and the world through `CoreDeps`
  (DECIDED). `platform/notes.ts` holds no one's data (17d), so core writes through it too.
- [[phase-16-is-temporary]]: principled over patchwork. No Phase 16 parser kept as a fallback.
- [[her-speech-stays-free]]: this changes what she stores and what loops are shown, never what
  she says.
- **Ethan, 2026-10-28 (intake):**
  1. **A core citation renders the cited memory's date only.** "the hike [m1]" is stored as
     "the hike (⟦Saturday 3 January⟧)". The cite is kept as lineage and is the base for "the day
     after [m1]".
  2. **Core loops think.** A new `models.core_thinking: adaptive`.
  3. **`relativeWords` moves into evals** as a detector only, so the review still counts
     unlabelled time words (B140).
  4. **The scope includes world events and goals.** Besides every `core_memory` writer, the
     snapshot and the intention thought: a world event's own text (`life_event`, `core_resolve`)
     and goal title and why (`core_reflect`).

## Assumptions

- **verified.** Every core text write goes through `core.memory.insert` or `insertSnapshot`,
  which parse with `anchorTimes` (`src/db/repos/core/memory.ts:280,579`). The snapshot render
  parses its items once (`render-snapshot.ts:94`). The runner collects shown dates
  (`runner.ts:29,78`), and so does appraise (`appraise.ts:173`).
- **verified.** World event text and goal text are never anchored today (`world.recordEvent`,
  `goals.add`), so labelling them is new and fixes nothing that is broken.
- **verified.** `writeNote` drops an empty citation text (`filter(Boolean)`), so a cited memory
  with no date records the cite and adds nothing to the text.
- **verified.** Both are Haiku 5.5: `life_event` runs on role `life`, the core loops on role
  `core`. Thinking is chosen per role (`anthropic.ts:76`).
- **verified.** The API allows at most 16 nullable or union fields per schema. A `times` entry
  adds 4 (weekday, month, day_of_month, part; clock is "" for none). The largest schemas are
  reflect (about 7 today, about 11 after) and the snapshot (6, then 10).
- **assumed, low-stakes (DECISIONS.md):**
  - `life_event` moves to role `core`, so it thinks like the loops. `life_plan` stays on `life`.
  - Thinking tokens count toward `max_tokens`, so the core loops' token caps go up (to the user
    loops' 8000) and they get `models.core_timeout_ms` (90000, like `user_mind_timeout_ms`).
  - A core notes prompt gets its own file, `prompts/core/notes/v1.md`. Notes v2 speaks of "them"
    and of whose a memory is, and none of that applies to core. Its times section is copied from
    notes v2: copied text over a user-prompt version bump.
  - A core note citing a superseded memory is not retired. Core thoughts belong to their moment,
    and reflect already replaces twins. Added to §25.
- **risk, only a real call shows it:** with thinking on, reflect's schema may go over the
  grammar limit (17a: thinking shrinks the limit). If it does: thinking off for reflect alone,
  behind the same key, which becomes per-loop. Checked in the first paid run.

## Design

### Shared mechanism

- **Core citables** (`memory/core/citables.ts`, new): numbers the core memories a loop is shown
  (m1, m2…). Each one's `Citable.text` is its date token: an intention's `payload.event_at` at
  time precision, otherwise `occurred_at` at day precision, or "" when it has neither. Owner is
  null and kind is `memory`. It returns the lines the loop's input shows (`{ id, kind, content,
  when }`) and the citables `writeNote` takes. It is built only from rows the loop already read
  through `CoreDeps`.
- **`withNoteRules`** takes the prompt name, so core loads `core/notes` at
  `prompts.core_notes: v1`.
- **The core notes prompt** says that ids in square brackets cite a memory. Code adds that
  memory's date, so she never writes a date one already carries, and citing is optional. Its
  `times` section is the notes v2 structure.
- **Each writer** adds `times: noteTimesSchema([...its text fields])` to its schema and passes
  its text through `writeNote(fields, times, citables, { now, zone: her zone })` before it embeds
  or stores anything. `cites` (stored memory ids) goes into the row's payload where the row has
  one. `dropped` goes into the loop's trace outputs. No code reads the prose for dates.

### Per writer

| Writer | Text fields | Cites | Prompt |
|---|---|---|---|
| `life_event` (`world/events.ts`) | `content`, `thought` | recent episodes it is shown | life/event next version |
| `core_resolve` | `content` | the plan's intention | core/resolve v2 |
| `core_appraise` | `episode` | the plan's intention, when there is one | core/appraise v5 |
| `core_anticipate` | thought `content` | the intention | core/anticipate v5 |
| `core_ruminate` | thought `content` | the episode | core/ruminate v5 |
| `core_wander` | `item_1`, `item_2` | seed and chain | core/wander v5 |
| `core_reflect` | `insight_n`, `opinion_n` (stance), `interest_n`, `narrative`, `goal_n_title`, `goal_n_why` | inputs, context, narrative | core/reflect v5 |
| `core_consolidate` | `gist` | the week's sources | core/consolidate v3 |
| `core_render_snapshot` | one field per section; `times` entries also carry the line's index | narrative, opinions, interests, insights, notes | core/snapshot v5 |

- **Reflect** shows its inputs, context and narrative under m-ids instead of uuids, and
  `supersedes` and a fading `target_id` take m-ids, which code maps back. This keeps one id
  system in the input. Goals keep their own ids, since they aren't memories.
- **The snapshot** labels only new lines. A kept line (from an emptied section) is copied as
  stored, tokens included.
- **The code fallbacks** (appraisal, plan, an injected eval event) write no times. Their text
  comes from text that is already labelled, or from scripts.

### Deleted

- From `platform/time-anchors.ts`: `anchorTimes`, `anchorFields`, `AnchorContext`,
  `AnchorHints`, the chrono pass and every parser internal (the regexes, merge, clause, ISO,
  weekday and weekend rules). The `chrono-node` dependency goes too. The token functions stay:
  `dateToken`, `formatToken`, `renderTimes`, `renderAbsolute`, `tokenDates`, `isSingleToken`,
  `stamped`, `written`, `nowLine`, `ownDate`.
- `relativeWords` and its word list move to `evals/lib/relative-words.ts`. The review is its
  only caller.
- Runner: `LoopContext.shown()`, the `classifyJson` wrapper and the `memory.insert` wrapper.
  Appraise: `Appraisal.shown`. `CoreMemory.insert(item, hints)` becomes `insert(item)`.
- The six v4 core prompts, consolidate v2, resolve v1 and the current life/event version, with
  their "copy its date" lines.
- Tests: the anchoring tests in `tests/mind/platform/time-anchors.test.ts`, test 6 in
  `tests/exit/phase-16c.test.ts`, and the 16b and 16 exit tests or db tests that assert
  parsing.

### Config

- `models.core_thinking: "adaptive"`, `models.core_timeout_ms: 90000`.
- `prompts.core_notes: "v1"`, plus a version bump for each prompt above.
- Core token caps raised for thinking: `core.loops.max_tokens`, `snapshot`, `reflect`,
  `consolidate`, `appraise`, `resolve` and `world.event_max_tokens` go to 8000.

No schema change: tokens live in the text, as they already do for core memory.

## Scope and leak check

All of it lives in the core mind. The citables come only from core rows the loop read through
`CoreDeps`. `platform/notes.ts` holds no one's data. The leak canary and the side-channel test
run at the exit, and the exit canary still runs no core loop (a 16 deferred minor). The 17e exit
test adds a core loop run to it, with user rows planted, and asserts that nothing user-scoped
reaches the loop's input, output or stored text.

## Exit test and review run

- **`tests/exit/phase-17e.test.ts`** (fake LLM, fake guard), covering:
  - a wander thought labelled "tomorrow night" is stored as tomorrow's token;
  - "[m1]" renders the cited episode's date and lands in `payload.cites`;
  - an unlabelled "tuesday" stays raw (nothing parses prose);
  - the snapshot labels a new line and keeps a kept line byte for byte;
  - a planned event's thought and a goal's why carry tokens;
  - the leak canary with a core loop in it.
- **Close runs** (paid, through `review-run`, Ethan says go first):
  - `pnpm exit:core-day`, as the grammar and thinking check (small);
  - `review:world-outreach`;
  - a new long-conversation script for B142: one session of 20+ turns, so
    `long_conversation` fires and consolidate writes a gist. It is user side and only rides
    along with the phase close.
- The review's `relativeWords` sections read from the evals detector.

## Spec write-back

- §8.1 and §8.3: the intentions and world events note.
- §8.5: the 16, 16b and 16c bullets are replaced by a "Built 17e" bullet.
- §20 Phase 17 row.
- §25: B132 to history, plus a new entry for core notes not retired on supersede.
- `docs/spec-v3-history.md`: the full Phase 17 row.
- CLAUDE.md current phase, DECISIONS.md.

## Out of scope

- Retiring a core note whose cited memory is superseded (§25, *tuning*).
- B140 and B141 (tuning: user loops leave times empty, and her news goes stale).
- The day plan's block labels (`life_plan`): a block is clock times and a label, not dated
  prose.
