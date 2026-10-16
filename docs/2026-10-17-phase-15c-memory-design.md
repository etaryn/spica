# Phase 15c: memory, relationship, user mind

Design doc, 2026-10-17. Status: settled item by item with Ethan (2026-10-16/17), awaiting review
of this file.

15c tunes what she remembers and how she thinks about each person: how her private notes on them
read, what happens after a hurt is repaired, how dates and plans are stored, when contradictions
are caught, and a handful of relationship mechanics. Backlog items: B4, B5, B38, B41, B67, B70,
B71, B81, B83, B85, B86, B87, B90, B92, plus five findings from this slice's real runs. Phase rules
hold: no external samples, tune base Spica.

## Evidence (real runs, 2026-10-15/16)

- `exit:intimacy`, `exit:disclosure`, `exit:idiolect`, `exit:stages`, `exit:user` (real
  extraction; `exit:user` also the five user-mind loops). Reviews in `evals/results/`.
- `pnpm eval --llm=real --annotate --review` on the 14 judged scripts (contradiction, recall,
  false recall, consistency): `review-2026-10-15T23-01-12-127Z.md`.
- Fake replays of `user-mind-two-weeks` to read the run table and every hurt event.
- A Voyage probe of ten realistic contradiction pairs.

| Finding | What the runs showed |
|---|---|
| Hurt outlives its repair | "you went on about stars again" (hurt 0.27), apology next day (hurt 0.08). A week later her summary: "that hurt between us never got resolved", her read: "they're carrying the same hurt I am". The apology moved hurt by 0.148 (the jump trigger is 0.15), crossed no band, and a hurt under the make-up threshold never fires `make_up_done`, so **no user-mind run saw the repair**. The hurt fact stays open, the summary "carries forward", and replies read the summary. |
| Over-dramatising | Every prompt opens "after something important just happened between you"; a salient fact reads "they told you something important". Haiku turns "I work as a nurse" into "they trusted me with something that mattered enough to break that silence", and "introverted" into "carrying something… hollowed out… underwater". It also invents: "they're in Osaka now" from a planned move. |
| Phantom quiet, phantom hurt | `msgs_per_day` starts at a guessed baseline of 5. A new user sending 1–2 messages a day reads "They've been a bit quieter than usual" on day one, and the daily tick adds **absence hurt every day** (cause `absence`, frequency effect −0.66) to someone who talks daily. |
| Wrong weekdays | 5 of 22 dated facts carry the wrong weekday ("Monday 13 January" is a Tuesday). The summary then repeats the wrong day. |
| Dropped plan | "my friend is visiting from somewhere up north next month" got no fact in 1 of 3 runs (extraction ran, returned no facts); in another the visit resolved on "she's arriving soon". |
| Assumed gender | "you're a good big brother", "he'd admit": no gender was ever given (onboarding doesn't ask). |
| Judge over-flags (B41) | 11 flagged replies: 2 hold a real invention ("good big brother", "whatever doom-scrolling job"), 2 borderline, 7 wrong outright (the user's own line attributed to her, a correct inference called misremembering, the onboarding coffee habit called "as chat" three times). |
| Contradictions missed (B5) | Similarity of realistic contradictions: vegetarian→steak 0.755, single→girlfriend 0.789, nurse→teacher 0.797, drives→sold car 0.811 (all below the 0.82 cutoff); six others 0.824–0.925; unrelated controls 0.72–0.73. |
| B4 | Fixed already: no invented details about a superseded fact in 3/3 runs. |
| B86 | "the whale is back", 30 seconds after the whale cloud, established the joke in the same session. |
| Caching | Reply caching works (B116: 3.5M tokens read from cache in the full run). Extraction caching (shipped 2026-10-16) read 543k of 566k input tokens from cache. |

## Decisions (Ethan, 2026-10-16/17)

### 1. A repair is a big event, and the hurt becomes past

- **Trigger.** A new trigger kind `repaired`, recorded when hurt falls from at or above
  `user_mind.triggers.hurt_resolved` (new, 0.1) to below it. From an exchange carrying an apology
  or make-up signal its text is "they apologised, and the hurt has passed"; from the daily tick's
  fade it is "the hurt between you has faded". `make_up_done` stays for the make-up flow. A
  hurt that crosses below the line by fading creates no trigger if the user has ended the
  relationship (as today).
- **The hurt memory turns past.** The reply prompt never shows a fact's status, so marking the
  fact resolved alone wouldn't change what she says. When `repaired` fires, each open hurt fact
  (subject self, kind feeling, source `inferred`, the facts `hurtFeeling` writes) is superseded by
  a resolved copy in the past tense, templated in code from the cause: "Spica was hurt when the
  user said her star talk gets a bit much; they made up." (apology) or "…; it has passed." (fade).
  The new fact is a new memory, so the repair run reads it in `new_memories`.
- `hurt_cause_fact` needs no change: only make-up-level hurts set it, and the make-up flow clears it.

### 2. Her private notes: plain and proportional

Summarise v2, reflect v2, model v2, ideate v3 (v1/v1/v1/v2 deleted):

- No "something important just happened" opening. Each prompt says what the run is: "Take stock of
  where things are with them."
- Trigger texts name the thing. A salient fact reads "they told you: <the fact>" (its content), a
  param move reads as now, a milestone as now.
- Feelings are sized to what happened. Most days are ordinary and the notes say so plainly; no
  imagery, no reading weight into quiet.
- Only what the memories state. A planned event hasn't happened until a memory says it did ("they
  are moving to Osaka in February" is not "they're in Osaka now").
- Carry forward from the previous note only what nothing newer contradicts; when `what_happened`
  or a memory says something is over (a repair, a resolved plan), drop it.
- Use names or they/them for people whose gender no memory gives (see 6).
- **Check for robotic recall** (Ethan): the change is logged (call log, review files) and the
  judged scripts are rerun with real replies after it; Ethan reads her recall lines side by side
  with the 2026-10-15 review to see whether they lost warmth.

**Model.** Rewrite on Haiku first, then `pnpm review:user-mind <call log>`: a replay script that
resends every logged `user_*` call to Sonnet and writes a blind side-by-side file (same inputs,
like `review:voice`). Ethan leans Haiku (cheaper); Sonnet only as a last resort.
`models.user_mind` is already the config key.

### 3. Her estimate of their rate (`msgs_per_day`)

Their message rate is **her estimate** of how much this friend texts, not a fact about them.

- `relationship_param` gains `samples` (integer, default 0): the daily samples behind a baseline.
  For `msgs_per_day`, the first sample sets the baseline outright (no guessed 5 to unlearn); after
  that the usual moving average.
- Until `samples` reaches `relationship.rate_estimate_days` (new, 7) she has no estimate: no
  "quieter / talking more than usual" line, no frequency-based absence hurt, no absence make-up
  from frequency. After that, all three compare their recent count with her estimate, which is
  the allowed "hurt about absence".
- `initial.msgs_per_day` becomes 0 (the schema needs every param; the first daily sample replaces it). Users who already had daily ticks are backfilled to an established estimate so their learned baseline is kept.
- **Her own rate** (how much she texts this person: her default moved part-way toward her
  estimate of theirs, driving reach-out readiness and bubbles, never past the reach-out caps)
  ships in 15d with its readers. New §25 entry, target 15d.

### 4. B81: a crisis stops riding the chain

One rule: **outside an open crisis window, the user-mind loops read nothing sensitive.** Inside
the window (a run triggered by a non-crisis exchange during it), they read everything and mark
what they write, as today. Once the window has passed:

- `previous` is the latest clean summary (`latestNonSensitiveSummary`), the model's previous read
  the latest clean read, and sensitive beliefs, reflections and facts are left out of every loop.
- What they write is unmarked, and the new summary supersedes the live (marked) one.
- The crisis stays in her sensitive memories, which replies still retrieve when relevant. The
  `crisis_passed` run is the first clean run: its trigger text ("they went through something hard,
  and it has eased") is what it knows, without the details.

### 5. Extraction (extract v9; v8 deleted)

- **Dates resolve in code.** Each fact and thread gives the time phrase it saw (`when`:
  "next monday", "tomorrow night", "in two weeks", or null) and writes `{when}` in its content
  where the date goes. Code resolves the phrase against the latest user turn's local time and
  timezone, writes the date into the content at the precision the phrase gives ("Monday 12
  January 2026", "February 2026"), and sets `occurred_at`. A bare weekday is the next one
  after the message ("monday" said on a Monday is next week's); "next <day>" is that day in the
  following week (chrono's reading: "next friday" said on a Wednesday is nine days on). Past
  phrases ("last friday") are never pushed forward. Threads give `checkpoint_when` the same way. If the phrase can't be resolved,
  the model's own `occurred_at` is the fallback.
  - **Parser:** `chrono-node` (MIT, maintained; `forwardDate` and a reference instant with a
    timezone offset). Ethan to confirm in review: it is a new dependency. The alternative is our
    own resolver for a fixed phrase list (today, tonight, tomorrow, weekdays, next week/month, in N
    days/weeks, month names), smaller but every phrase outside the list falls back to the model.
- **Plans are always stored.** An upcoming plan or event in their life (a visit, trip,
  appointment, start date) is always a fact and opens a thread, however vague. It resolves only
  when they say it happened ("she's arriving soon" doesn't).
- **No gender from names.** Extraction never infers a gender the user didn't give.
- **Deliberate forgetting** (Ethan's later plan) is recall-side, never at storage: a controlled,
  salience- and age-based chance a stored fact doesn't surface. New §25 entry, target *Later*
  (seam: retrieval scoring and decay).

### 6. Gender at signup, names or they for everyone else

- Signup gains a required **gender**: woman / man / non-binary / prefer not to say, with the
  matching pronouns (she / he / they; "prefer not to say" is they). A Better Auth additional field
  (`gender`, migration on `user`), validated in the signup hook against the list.
- Onboarding writes it as a card fact at salience 1.0 next to the name ("They are a woman;
  she/her."), so it never fades.
- For people in the user's life, she uses their name or they/them until the user's words give a
  gender. Ethan's reason: a guess drifts and roots in memory, and users can't edit her memory, so
  it is hard to correct. Lines in reply v18, the four user-mind prompts and extract v9.
- A user whose gender changes partway through is a separate later issue (changing core user
  params). New §25 entry, *Later*.
- Eval profiles (`evals/profiles/*.yaml`) gain a gender fact; `admin.ts` test users get a default.

### 7. B5: a contradiction band in reconcile

- `nearFacts` / `core.memory.near` query down to `reconcile.contradiction_similarity` (new, 0.75).
  Neighbours at or above `near_match_similarity` (0.82) are near as today; those in the band are
  shown as `[distant]`.
- Reconcile v2 (v1 deleted): a distant fact may only be the target of "contradicts"; code turns
  any other relation on a distant target into "new". One reconcile call per fact as today; facts
  that had no neighbour but have a distant one now get a call.
- Shared by both minds (core event generation rejects a contradicting candidate the same way;
  its calls come out of the core budget).
- `review:reconcile`: a logged review script with the ten measured pairs through real extraction,
  embedding and reconcile, plus unrelated controls, to read the false-replace rate.

### 8. B41 and B38: judges

- False-recall judge v9 (v8 deleted): "onboarding_as_chat" only when she says it came up in chat;
  an inference consistent with what was said is not misremembering; a new category
  `assumed_identity` for a gender or pronoun nobody gave.
- Code drops any violation whose quoted claim isn't found in one of her messages.
- This run's real cases become fixtures in `evals/judge/false-recall.yaml` (the wrong flags as
  "no violation", the real ones as violations). `pnpm eval:judge` on Haiku; Sonnet only if Haiku can't
  pass.
- B38: the old persona details (Pesto) in `evals/judge/consistency.yaml`,
  `evals/judge/false-recall.yaml` and the consistency judge (v3, v2 deleted) become persona v6
  details.

### 9. Relationship mechanics

- **B86.** A callback establishes a joke only when it comes in a later session than the one the
  joke was born in (the birth's session read from its source turn).
- **B92.** A run with a milestone trigger skips the daily cap (each milestone fires once per user,
  about nine ever).
- **B87.** The reach-out depth check joins the locked recheck at send (code only: the memory's
  stored depth against `loadDepth`, one read). The rarer half (a late exchange from an older
  session folding into the live session's sums) moves to *Later*.
- **B90.** Pace kept (friends after about 25 hours of chat, close after about 80, from the
  50/90/200-hour research) and the slow commitment average kept; B90 closes. `rel-stages` gets a
  seeded `hours_together` so its review walks the stages instead of sitting at "getting to know
  each other" for a fortnight of one-minute chats.
- **Commitment on a fight day** drops close to zero in a young friendship (it is mostly "how good
  it's been lately" until investment builds). By design; unchanged.

### 10. User-mind defaults (B67, B70, B71, B83)

- **B67.** A fact counts as read once a summary has read it; each run reads the unread ones (top
  `max_facts` by salience, created within `user_mind.summarise.unread_days`, new, 14), so a fact a
  busy run left out is read by the next. "Read" is counted within the same chain (clean or marked,
  see 4).
- **B70.** Ideate's `already_planned` also lists ideas resolved in the last
  `user_mind.ideate.recent_days` (new, 14).
- **B71.** A run with no unread facts skips reflect and ideate (summarise and model still run, so
  a param-only trigger still takes stock).
- **B83.** Config load rejects `long_conversation.quiet_minutes` below `session.idle_gap_minutes`.

### Closed

B4 (fixed by later prompts; drop the stale `known_failure` on `contradiction-job`), B85 (the three
runs were done and reviewed here), B90 (above).

## Not changing

- Stage thresholds, the closeness-by-hours ceiling, the commitment formula.
- The guard and its rubric; the reach-out caps and gates (other than B87's recheck).
- The absence closeness drift (it reads the contact gap, not the message rate).
- Relationship summary phrases (only when the message-rate line may show).

## Prompts and config

| Prompt | From → to |
|---|---|
| extract | v8 → v9 |
| reply | v17 → v18 (pronoun line) |
| user-mind/summarise, reflect, model | v1 → v2 |
| user-mind/ideate | v2 → v3 |
| reconcile | v1 → v2 |
| judge/false-recall | v8 → v9 |
| judge/consistency | v2 → v3 |

New config keys: `user_mind.triggers.hurt_resolved` (0.1), `relationship.rate_estimate_days` (7),
`reconcile.contradiction_similarity` (0.75), `user_mind.summarise.unread_days` (14),
`user_mind.ideate.recent_days` (14). Changed: `relationship.initial.msgs_per_day` 5 → 0. Deleted: `user_mind.summarise.since_slack_minutes`.
Migrations: `relationship_param.samples`, `user.gender`.

## Exit test

`tests/exit/phase-15c.test.ts`, deterministic, fake LLM, covers the core of 1, 3, 4, 5, 6, 7, 8, 10 and 14; the rest (2, 9, 11, 12, 13) are pinned by unit tests in their tasks. The side-channel test is unchanged by 15c (no core path moves) and stays in `tests/exit/mind-split.test.ts`.

1. An apology exchange dropping hurt below 0.1 records `repaired` ("they apologised…"); the open
   hurt fact is superseded by a resolved past-tense copy; a fade below 0.1 on the daily tick
   records "the hurt between you has faded".
2. Trigger texts: a salient fact reads "they told you: <content>".
3. A new user: no message-rate line and no frequency absence hurt for the first 7 daily samples;
   the first sample sets the baseline; after 7 a quiet day shows the line and the absence hurt.
4. After a crisis window: the run's inputs hold nothing sensitive and its summary is unmarked;
   inside the window it is marked.
5. Extraction "next monday" from Mon 5 January 2026 resolves to Monday 12 January 2026 in content
   and `occurred_at`; an unresolvable phrase falls back to the model's date.
6. Signup without a gender is rejected; the card facts carry the gender at salience 1.0.
7. A neighbour at 0.78 is distant: a "duplicate" on it counts as new, a "contradicts" supersedes.
8. A false-recall violation quoting a user line is dropped.
9. A callback in the same session doesn't establish a joke; in the next session it does.
10. A milestone run is recorded past the daily cap.
11. A reach-out whose memory became too deep before send is dropped at the recheck.
12. B67: a fact left out of a full run is read by the next; B70: a recently resolved idea is in
    `already_planned`; B71: no unread facts skips reflect and ideate.
13. Config with `quiet_minutes` below `idle_gap_minutes` fails to load.
14. The leak canary and the side-channel test.

## Real review runs (logged; not exit criteria)

- `pnpm exit:user` with the new prompts, then `pnpm review:user-mind` (Haiku vs Sonnet).
- The 14 judged scripts with `--annotate` and real replies, read against
  `review-2026-10-15T23-01-12-127Z.md` for robotic recall.
- An extraction date and plans probe (`signal-*`-style scripts with real extraction, 3 runs).
- `pnpm review:reconcile` (the band's false-replace rate).
- `pnpm eval:judge` for judge v9.
- `pnpm exit:stages` with seeded hours.
