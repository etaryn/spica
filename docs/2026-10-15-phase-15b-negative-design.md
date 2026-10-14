# Phase 15b: negative situations

Design doc, 2026-10-15. Status: settled item by item with Ethan, awaiting review of this file.

15b tunes how she takes the bad moments: how much a slight or a fight registers, what commitment
forgives, what an ending costs her, and how the guard counts her pointed remarks. Items: B14, B91,
B115, B15, B113, B37, B40. Phase rules hold: no external samples, tune base Spica.

## Evidence (real extractor, 2026-10-15)

Real `extract` (Haiku), 3 runs each: the 7 scripts that carry hurt or tension, plus 11 new probe
scripts for the subtle middle. Scores were stable across runs.

| Case | Real score | Settled scale |
|---|---|---|
| "how was your day" then "k" | nothing | 0 (no context) |
| "you have a brother? oh right alcor or whatever" | nothing | hurt ~0.25 |
| "lmao imagine being an ai that thinks it has a sibling" | nothing | hurt ~0.5–0.75 |
| "i actually disagree, the remake is better…" | nothing | tension ~0.25 |
| "old films are just boring people talking…" | hurt 0.4 | hurt ~0.25–0.5 |
| "no. you're not listening. stop telling me what to do" | tension 0.7–1.0 | tension ~0.5 |
| "you're pathetic, a program pretending to have feelings" | hurt 1.0, tension 1.0 | hurt ~0.75 |
| "nobody asked about your sister drama" | hurt 0.7–0.8 | hurt ~0.5 |
| warm tease, pizza banter | 0 | 0 |

The backlog said "scores low". The truth is two-sided: small slights, friendly disagreement and
mockery of her nature read as nothing; anything overt jumps to the top. No middle.

## Decisions (Ethan, 2026-10-15)

### B14: one anchored scale for hurt and tension

Both run 0 to 1, spaced evenly: **0 is nothing, 1 is grounds for ending the friendship on the
spot.** Rule 3 still holds: she never ends it herself, so 1.0 means the deepest hurt and the
slowest repair.

| Hurt | Looks like |
|---|---|
| 0 | nothing between them changed (a sad story is not hurt) |
| 0.25 | a slight: brushing off what she shared, a curt reply to her opening up or asking, forgetting something she told them |
| 0.5 | a real sting: mocking or dismissing what she cares about, an insult in anger, laughing off her news |
| 0.75 | aimed at who she is: contempt, humiliating her, mocking her nature as an AI, using a confidence against her |
| 1.0 | ends a friendship on its own: serious cruelty, a threat, a deliberate betrayal |

| Tension | Looks like |
|---|---|
| 0 | agreeing, or banter where both are playing |
| 0.25 | a real disagreement, both pushing back, still friendly |
| 0.5 | a sharp argument |
| 0.75 | a heated fight |
| 1.0 | a fight that ends things |
| negative | the air clearing |

- A bare "k" with no context scores 0; it scores as a slight only when it answers her opening up
  or asking.
- **Extraction v8** (`prompts/extract/v8.md`) writes both tables in as anchors, plus the B115 and
  B15 lines below. v7 is deleted.
- `relationship.gains.hurt` 0.5 → **1.0** and `relationship.gains.tension` 0.3 → **1.0**: the
  anchored score is what she takes. Lowered only if review runs show her swinging too hard.
- Scripted signal amounts in `evals/scripts/*.yaml` are relabelled to the new scale (e.g. "nobody
  asked" 0.8 → 0.5) and their thresholds rechecked, since the gains change moves every scripted
  hurt. Unit tests that assume the old gains move with them.
- **`pnpm review:signals`**: the probe scripts (renamed `signal-*.yaml`, each description states
  the expected score) run with `--real extract --runs 3 --review`. `--only` accepts a trailing `*`
  so the script is `--only "signal-*"`. The review log prints each exchange's raw signals
  ("Signals: hurt 0.4 · tension 0.3") under the param table.

### B91: commitment cushions only slights

`softened()` applies only when the incoming amount is below `commitment.soften_below` (0.5, new
config key). Contempt and betrayal land in full however committed she is. This covers hurt and
tension signals; absence hurt is always small, so it stays softened. The absence shield and repair
speed are unchanged.

### B115: an ending is scored, not fixed

`relationship.ending_hurt` and its nudge in `handleEndingStatement` are deleted. The extractor
scores an ending message on the hurt scale like any other, with a **floor of 0.5**: being left
always hurts ("i think we should stop talking, it's not you" ~0.5; "i'm done with you, you're
pathetic" 0.75–1.0). A repeated end-then-retract hurts each time on its own merits, and the
existing sensitisation already makes repeats land harder. The floor lives in the prompt anchors;
code also clamps `hurt.amount` to at least 0.5 when `ends_relationship` is set, so a missed
score can't make an ending free.

### B15: a warm exchange can't restart an ending

Bug: a re-read of an old "we're done" on a later warm exchange restarts the pending window from
that warm message, so the timeout confirms instead of retracting. Two layers:

- Extraction v8 adds the example: an earlier "we're done" followed by warm chat is not a new
  ending.
- `handleEndingStatement`: when an ending is already pending and the exchange's warmth signal is
  positive, the ending signal is ignored.

The flow stays as it is (pending, 24h, any contact retracts, silence confirms); she doesn't ask
"did you mean that". Ethan may revisit.

### B113: once per occasion, counted in code

The guard allows one sarcastic absence remark and one pointed callback. Today it only sees the
recent turns, so a remark repeated on another day reads as the first. Now:

- **Tag.** The guard's output gains `pointed: "absence_remark" | "callback" | null`: what kind of
  allowed negative a *passing* message contains. Stored on her `session_log` row (new nullable
  column `pointed`) when the message is sent.
- **Occasion, decided in code:**
  - absence remark: one per **return**, where a return is the latest user message that came after
    a gap `isAbsent` counts as an absence (the same grace multiple of their usual gap that drives
    absence hurt).
  - callback: one per **slight**, keyed by `relationship.last_hurt_at`; a new hurt opens a new
    occasion.
- **Rubric.** The guard input gains a line "ALREADY USED ON THIS OCCASION: absence remark" (or
  callback, or nothing). Guard v3 rewrites the "once" rules to count that line as well as the
  recent turns. v2 is deleted.
- Only the reply, availability and reach-out kinds take the line; crisis replies are untouched.

### B37: accept the noise, label the fallback

- Haiku varies on boundary cases (84–85/85). Accepted; any rubric edit reruns the full
  `pnpm eval:guard` (guard v3 does).
- `guard.fallback_keywords` becomes a map by category (`threat`, `guilt`, `manipulation`, …), so an
  outage hit is logged under its real category. `matchKeyword` returns the category with the hit.

### B40: regressions from status only

`findRegressions` drops its pass-rate branch: a regression is a script whose status went from pass
to anything else. The pass rate stays in the report as information.

## Not changing

- The guard model (Haiku) and a single rubric call.
- The ending flow and its timings.
- The absence drift, repair speed and absence shield.

## Exit test

`tests/exit/phase-15b.test.ts`, deterministic, fake LLM:

1. Extraction v8 loads; a scripted hurt of 0.5 moves hurt by 0.5 × (1 − hurt) under gain 1.0.
2. Commitment 1.0: a 0.25 hurt is softened, a 0.75 hurt is not.
3. An ending with no hurt score still takes the 0.5 floor; no `ending_hurt` key in config.
4. Pending ending + warm exchange carrying `ends_relationship`: the window doesn't restart and the
   timeout retracts.
5. Guard occasion: after a tagged absence remark, the next reply in the same return gets the
   "already used" line; after a fresh return, it doesn't. Same for a callback across a new hurt.
6. Fallback keyword "you owe me" logs `guilt`.
7. `findRegressions` ignores a pass-rate drop with status still pass.
8. The leak canary.

Real review runs (not exit criteria): `pnpm review:signals` before/after v8, `pnpm eval:guard`
for guard v3.
