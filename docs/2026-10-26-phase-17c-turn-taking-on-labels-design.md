# 17c. Turn-taking on labels: open questions and bids read from moves

Design doc, 2026-10-26. Status: settled with Ethan (his three choices, 2026-10-26).

## Intent

The phase doc's 17c row: "The code-made layers written as the system runs. The turn judge cites
piece ids for open questions instead of rewriting them; a question closes when a move replies to
it (B9). Bid responses come from replies (`bidAfter`)." Same principle as the rest of Phase 17:
words are kept as said, the model points at them, code reads the labels.

## Spec and settled lines

- §10.1 turn-taking (Built): the judge returns `{reasoning, complete, open_questions, backchannel}`;
  open questions are held (max `turn.max_open_questions`) and "dropped when answered or moved past".
  DECIDED.
- §25 B9: open questions are never cleared when a reply answers them. 17c closes it.
- §25 B7 (part): concurrent POSTs can overwrite `open_questions`. 17c fixes that part.
- §11.3 "Built 10c: bids": `bid_response` toward / away / against, kept only within
  `session.idle_gap_minutes` of her last message. Changes here.
- Phase 17 direction (memory `memory-overhaul-settled`): annotate, don't translate; code reads
  labels; who and when come from the transcript. DECIDED.
- Ethan's choices (2026-10-26):
  1. **Closing:** her reply move plus the judge. The judge cites pieces. It may add questions only
     from the new messages, and may drop old ones (nvm, moot). The cold path closes a question
     when one of her moves `replies_to` it. A judge verdict never reopens a question closed
     meanwhile.
  2. **Bids:** toward and against count only when the cited user move `replies_to` a move of
     hers, with no timing. Away keeps the idle-gap timing, and it also needs that no new user move
     replies to her last message.
  3. **Layers:** the code-made layers are already recorded live, so there is no new storage:
     - conversation: `session_id`, set at receive;
     - exchange: `reply_to`, set at commit, and the cold-path job's turn ids;
     - burst: the turn-taking buffer.

     The judge reads its buffer as numbered pieces. `layers.ts` `conversations()` stays for the
     replay evals.

## Assumptions

- verified: the judge runs at receive, before any label exists for the buffer
  (`receive-message.ts:100`), so the judge's picks are the only source until the cold path runs.
- verified: the cold path labels the burst and her reply together. Her moves' `replies_to` can
  point at a user move from this exchange or at an earlier stored move (`fromRows`), as long as the
  window still shows it (`cold-path.ts:238`).
- verified: `numberPieces` / `renderPieces` (`memory/user/pieces.ts`) give the same piece
  numbering and rendering the labels use; ids are `<message>.<piece>`.
- verified: `conversation_state.open_questions` is jsonb `{turn_id, text}[]`. Its readers are the
  reply (`assemble.ts:135`, through `commit`), the judge and `judge_log`.
- verified: `mutateState` takes its own short transaction on the state row
  (`turn-taking/state.ts`); the cold path's transaction holds a different, advisory lock.
- assumed, low-stakes: a question split over bubbles ("so did you" / "end up going?") is one
  question with several pieces. Stored as a coordinate list.
- assumed, low-stakes: an old open question is closed when any of its coordinates overlaps
  a user move that a new move of hers replies to.

## Design

### Open questions as coordinates

- `OpenQuestion` becomes `{ coords: Coordinate[] }`, where a `Coordinate` is
  `{turnId, start, end}` from `pieces.ts`. No text is stored: readers slice the words from
  `session_log`.
- A migration resets existing rows to `'[]'`, since the old text shape can't be mapped back.
  Dev only.
- One helper renders a question's words from its turns, joining the pieces with " / ". The reply
  and the judge both use it, and the reply still gets `string[]`.

### Turn judge v3

- **Input:**
  - the earlier conversation, unnumbered as today;
  - OPEN QUESTIONS, each with an id `q1…` and the user's exact words;
  - NEW MESSAGES, rendered with `renderPieces` (pieces numbered over the buffer alone, each
    message's gap kept).
- **Output:**
  `{reasoning, complete, still_open: string[], asked: string[][], backchannel}`.
  - `still_open` lists the q-ids that remain open.
  - `asked` lists the new questions, each as the piece ids of a user's new message.
  - The checks, in code:
    - an unknown q-id or piece id is dropped;
    - a question repeating an open one's coordinates is merged;
    - the list is capped at `turn.max_open_questions`, old ones first.
- **Under the lock** (`T.append`), the new list is
  (kept q-ids ∩ the state's current open questions) + the new questions. A question the cold path
  closed while the judge ran stays closed. That also fixes B7's overwrite of `open_questions`.
- **Keyword fallback** (`cueVerdict`): keeps every old question, and asks each new piece that
  ends in "?".
- **Fake judge:** the same cue check, over the rendered pieces.
- **Files:**
  - `prompts/turn-judge/v3.md`; v2 is deleted;
  - config `prompts.turn_judge: v3`.
- **`judge_log`** records q-ids and coordinates, not text.

### Closing on her reply (B9)

- In the cold path, after labelling, code collects the user moves (new and stored) that one of
  her new moves `replies_to`.
- After the cold-path transaction commits, one `mutateState` with a new transition
  `T.closeQuestions` removes every open question that has a coordinate overlapping one of those
  moves.
- No model is involved, and nothing changes if no question matches.
- A crisis exchange still closes questions; the crisis has already cleared the list.

### Bids from replies

- `bidAfter(response, labels, context, turns, idleGap)`:
  - **toward / against:** the cited user move (already checked to be a user move) must have
    `repliesTo` pointing at one of her moves; otherwise null. There is no timing check.
  - **away:** no new user move may reply to a move on her last message before the burst, and the
    user's first new turn must come within `session.idle_gap_minutes` of that message (today's
    rule).
- The prompt's bid block is unchanged; the labels prompt stays at v1.
- §11.3 is rewritten to say the same.

## Scope and leak check

- Everything is user scope (turn-taking, cold path, relationship signals).
- No core loop reads or writes anything new.
- The leak canary and the side-channel test run at the close as usual. Their inputs don't
  change.

## Exit test and review run

- `tests/exit/phase-17c.test.ts`, deterministic with the fake LLM:
  - a question cited by the judge is stored as coordinates;
  - her reply's move replying to it closes it after the cold path;
  - a judge verdict that races the close doesn't reopen it;
  - a late reply carrying a link counts as "toward";
  - an "away" past the gap doesn't count.
- No paid run in 17c. The judge prompt change is checked by hand on the next close run of 17d
  (`review:world-outreach` already exercises the judge).

## Out of scope

- B7's other cases (crisis `reply_to`, retry attempt counts) stay *Later*.
- Closing a question by a user's own move (their "nvm" after the reply) is left out. The judge
  covers withdrawal while the question sits in the buffer.
- Code-made layers as stored rows are left out. Add them when a reader needs a conversation key
  across sessions (the `labelExchange` ponytail).
