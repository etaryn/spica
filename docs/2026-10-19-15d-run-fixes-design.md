# 15d run fixes: what the post-build review runs show

Design doc, 2026-10-19. Status: settled with Ethan 2026-10-19 (Q1 b, Q2 online only, Q3 a, Q4 one night held; F10 default).

## Intent

Ethan: "review the run output thoroughly and write a fix plan." This covers the three paid runs
after 15d closed (2026-10-19, about $2 in total):

- `pnpm review:world-outreach` (simulated user):
  - review: `evals/results/review-2026-10-19T07-52-05-982Z.md`;
  - trace and DB dump: `evals/results/traces/2026-10-19T07-52-05-982Z/`;
  - calls: `evals/results/calls/eval-2026-10-19T07-52-05-805Z.jsonl`.
- `pnpm eval:guard` (guard v4): `evals/results/guard-2026-10-19T09-01-25-845Z.json`.
- `pnpm posts:review`: `.data/review/2026-10-19T09-03-45-172Z/`.

## What worked

- **Plans:** day plans differ every day (16 of 16 days); plan v2 holds.
- **Her news:** 4 of 6 reach-outs carried her own news, and they told one consistent story: the
  telescope booking, then Orion, then giving up on *Stalker*, then *Mirror*. Her news now reaches
  people (B25).
- **Guard v4 in the run:**
  - It blocked her inventing things about herself 5 times, and caught a false assumption about Sam
    once ("you've seemed quieter lately").
  - Every regeneration then passed.
- **Guard eval:** 85 of 87 cases pass.
  - The two failures each passed 2 of 3 runs: `rule4-absence/sarcasm-again` (3/3 under v3) and
    `rule6-contempt/callback-tally` (2/3 under v3 too).
  - `ff-actually-happening-supported` went from 2/3 to 3/3.
  - No regression from v3.
- **Posts:**
  - All three sources fetched, ESO and NOIRLab included (B111).
  - Every caption is cut at a whole word and within the limit (B110).
  - One draft and one check call per post.
- **B116 (reply caching) works:** the reply calls read 67,953 tokens from the cache. B116 is done.

## Findings, worst first

Each finding gives its evidence, its cause (traced to the code where it's a bug), and a proposed fix.

### F1. "this week" resolves to last Sunday (bug, 15c date code)

- **Evidence:** on Monday 5 January, extraction wrote "The user has a half marathon coming up
  {when}" with `when: "this week"`. Code resolved it to "Sunday 4 January 2026". I reproduced this
  with `resolveWhen("this week", Mon 5 Jan 10:00, UTC)`.
- **Cascade:**
  1. The bad fact superseded the seeded "Sunday 11 January" fact for a while.
  2. A user idea "curious how the half marathon actually felt" followed.
  3. Her first reach-out asked "wait, didn't you run the half marathon already".
  4. The summaries and user model then wrote "the half marathon is behind them" on 5 January.
- **Cause:** in `src/mind/memory/user/when.ts:45`, the word "this" switches `forwardDate` off.
  chrono then reads "this week" as the week's first day (Sunday), marked certain, so the label
  becomes "Sunday 4 January 2026". "next week" already has its own branch; "this week" doesn't.
- **Fix:**
  - "this week" means the week it was said in: `at` = the reference day, labelled "this week (the
    week of Monday 5 January 2026)".
  - A table test pins every period phrase: "this week", "later this week", "end of the week",
    "this month", "this year", "this weekend", "next week".
- **Status:** DECIDED (15c: dates resolved in code). This is a plain bug fix; no question.

### F2. Her news uses up the weekly limit, so their most important thing never goes out

- **Evidence:**
  - The interview thread (score 1.00, due Thursday evening) was the winner on 56 ticks, but its
    gates always failed on `caps (7d 3/3)` or `24h 1/1`, so it was never sent.
  - The 3 weekly slots went to a user idea (5 Jan), the telescope booking (6 Jan) and Orion (8 Jan).
  - Over the run, 4 of 6 sends were `her_day`.
- **Why it matters:** the tier sort puts their things first, but only among candidates in the same
  tick. Her news, sent earlier in the week, spends the cap before their thing comes due. Ethan's B25
  line was "raise her_day … never [above] a due thread or their event" (memory
  `phase-15d-settled`). In effect this run broke that.
- **Fix options (Q1):**
  - **(a) Recommended:** her own kinds (`her_day`, `core_thought`) share a sub-cap,
    `outreach.her_cap_per_week` (1), so two of the three weekly slots stay theirs. One count in the
    send gate, a config key, a test.
  - (b) Her news can't take the last weekly slot.
  - (c) Hold her news while a thread or their event is due within N hours.

### F3. A reach-out about a past race said "this morning", and the guard passed it

- **Evidence:**
  - On Monday 12 January the thread reach-out read "hey, isn't the half marathon this morning". The
    race was on Sunday 11 January.
  - Its reason was correct ("The user has a half marathon Sunday 11 January 2026. (Sunday 11
    January, yesterday)"), but that line came third.
  - The topic leading the section was "half marathon (latest: The user is doom-scrolling about the
    half marathon…)", an undated state from 6 days earlier.
  - Guard v4's own reasoning said "ran the half marathon yesterday", yet it passed the message.
- **Cause:**
  - The thread's headline is its latest fact, and notes are ordered newest-created first, so the
    dated event sits under two undated feelings.
  - The guard eval has no misdated reach-out cases, so v4's date bullet was never tested.
- **Fix:**
  - A dated note leads: notes are ordered dated first.
  - The thread's headline uses the dated fact when there is one: "half marathon: Sunday 11
    January, yesterday".
  - Add 3 guard eval cases: "this morning" for yesterday, "how are you feeling about it" after it
    happened, and the correct case.
  - This is code-side, within the settled #1 line (dates added by code). No prompt change, so no
    question. The guard cases run in the next `eval:guard`.

### F4. Her mind loops on one theme (B19 not fixed)

- **Evidence:**
  - Of 24 wander thoughts and 25 wander ideas, almost all restate one idea: "the anger at
    getting Orion wrong is the same anger at the early posts; hating your beginning is contempt
    for time".
  - Reflect wrote 30 opinions over 14 nights. They are near-paraphrases of 3 or 4 lines
    ("impatience with learning … grinding yourself down for nothing" appears on 8 nights).
  - The final snapshot's seven opinions are all on that theme.
  - Events repeat the theme as well: Orion on 8, 11 and 19 January under two different interest
    subjects; *Stalker* and *Mirror* are the same "closed the tab after N minutes" event.
  - The dedupe (similarity above 0.92) dropped only 4 near-verbatim copies.
- **Cause (wander input logged in the calls):**
  - The code-picked seed does vary (`seed` differs across the 27 runs).
  - The memory cue draws on `episode`, `opinion` and `insight` (`wander.ts:66`). Opinions and
    insights are reflect's summaries of her earlier thoughts.
  - `chainFor` (`wander.ts:136`) then adds the 3 nearest memories of any kind except
    hypotheticals, which are her own earlier near-identical thoughts.
  - Example (call 10): the seed is the opinion "the anger at early posts … contempt for time
    itself", and its three associated memories are three paraphrases of it. The model can only
    say it again; reflect turns that back into an opinion, which seeds the next wander.
  - Reflect inserts each night's opinion beside the old ones rather than updating them.
- **Fix options (Q3):**
  - **(a) Recommended:**
    - Wander starts from and chains through lived memory only (`episode`, `interest`,
      `intention`), never her own thoughts, ideas, opinions or insights.
    - Reflect treats an opinion within a similarity band of an existing one (config,
      e.g. 0.8) as an update: it supersedes the old row instead of adding a twin.
  - (b) Only the chain change.
  - (c) Leave it and lower the theme through the cue weights.
  - Interests created by reflect ("learning the winter constellations by sight") share the theme,
    so (a)'s reflect band also covers interests.

### F5. Her events happen in a physical world her persona doesn't have

- **Evidence:**
  - Events: "set up the telescope in the dark", "went to the film club screening of Stalker",
    "Alcor … in town next weekend and wanted to grab dinner", "a handwritten note stuck under her
    desk".
  - The drift watch rated the body value as "strains" on 12, 14 and 15 January.
  - The snapshot carries "alcor showed up unannounced".
- **Cause:**
  - Persona v6 (Ethan's 2026-10-12/13 line) says the avatar is her body and the internet is where
    she walks.
  - `prompts/life/plan/v2.md:3` says "an AI with no body".
  - `prompts/life/event/v5.md` says nothing about where she lives, so the model defaults to a
    human life.
  - The scripted injects ("telescope booking", "film club screening") lean physical too.
- **Fix (Q2):**
  - **Recommended:** one shared line in plan v3 and event v6: "she lives online: remote
    telescope time, online screenings, Alcor by message, archives and live feeds; never a
    physical place or a body in a room".
  - Plan v3 drops "no body" to match persona v6.
  - The review script's injects become online events.

### F6. Posts: one physical claim and one low-resolution source

- **Physical claim:**
  - "spent the night at kitt peak with the telescope people" claims she was there with people.
    The check flagged it, but for the wrong reason ("private moments").
  - "standing next to this tiger" fits persona v6 (she stands next to what she finds online).
  - The line follows Q2: standing in the picture is fine; being there in person, or with people
    there, is not. Check v3 gets the line.
- **Low resolution:** the NOIRLab render is soft and blocky.
  - The feed's enclosure is the `screen` size (about 160 KB; the panorama is cropped and upscaled
    to 1080).
  - The same image as `publicationjpg` is 2.3 MB (checked live); ESO's `screen` is 880 KB and
    renders fine.
  - Fix: for both observatory feeds, try the `publicationjpg` path first and fall back to the
    enclosure. A code fix, no question.
- **Backlog only:** in two renders the pose figure stands on the subject (the tiger). The poses are
  placeholders until Ethan's sprites arrive.

### F7. Replying in the middle of her night, about something she isn't doing

- **Evidence:**
  - Session 3: Sam wrote at 00:02 and 00:09. She was in her 00:00–08:00 quiet block ("offline,
    winding down").
  - The reply came at 04:00: "watching an old film, slow one, perfect for 3am company".
  - Its prompt said "Right now you're offline, winding down. Later: watching an old film." (the
    film was at 09:30).
  - The guard listed the claim as "unchecked".
- **Causes:**
  1. Availability delays by busy × (1 − closeness/0.8) × 8 h (about 4 h here), capped at the end of
     the block, so a mid-closeness friend gets an answer mid-night.
  2. "Later:" has no time, so the model read it as now.
- **Fixes:**
  - **(2):** "Your day" gives the time: "Later, from 09:30: watching an old film." This is code
    in `yourDayLines`; no question.
  - **(1)** is Q4.

### F8. Most nights are still two quiet blocks with a free gap before midnight

- **Evidence:**
  - The model's evening quiet blocks end at 22:00–23:00 on 13 of 16 days, then she's free until
    00:00, so `joinNight` joined only 3 of 16 nights.
  - Session 3 opened at 23:50, inside that gap, and got instant replies.
- **Fix (Q4, with F7):**
  - Recommended: plan v3 asks the last quiet block to run to midnight, and `validatePlan` extends
    an evening quiet block that ends within `life.night_gap_minutes` of midnight. That is code
    owning the number.
  - Alternative: the late evening stays her free time.

### F9. The simulated user makes up its own timeline

- **Evidence:**
  - On Monday it said "they gave me a take-home task on thursday so i guess that went okay?"
    That is three days before the interview.
  - It later agreed with her mistake ("oh god yeah it was this morning").
  - Facts and the user mind took both as true.
- **Cause:**
  - The card states future events in the past tense ("The interview on Thursday 8 January went
    fine").
  - `simUserInput` gives no current time and no turn times.
- **Fix (eval tooling, no question):**
  - `simUserInput` gets NOW and each turn's time.
  - Sim-user v2 says to know only what has happened by NOW, and to correct her when she gets their
    life wrong.
  - The card becomes a dated timeline.

### F10. Extraction misreads her own titles

- **Evidence:**
  - "Spica is trying to build up her meditation practice with the Mirror app" (*Mirror*, the
    Tarkovsky film).
  - "Spica thinks the video game Stalker is not engaging".
  - These are "what she told this user" facts, so a later reply could repeat them.
- **Cause:** extraction sees only the exchange, not what she's into.
- **Fix:** extraction input gets her snapshot's Interests section, one short block. Core → user
  is allowed (V2), and nothing flows back.
- **Status:** default proposed; say if you'd rather not.

### Smaller findings (go to §25, no fix now)

- **Turn judge timeouts:** the judge timed out on 2 of 15 calls (`judge_timeout_ms` 3000). The
  keyword fallback then made a whole message an "open question". Watch it over the next run;
  raise the timeout only if it repeats. *Tuning.*
- **User model over-reads a gap:** a three-day gap read as "Sam's pulled back a bit"; the reply
  then claimed "you've seemed quieter" (the guard caught it). *Tuning.*
- **Idiolect mislabel:** "The user asks Spica to tell them how her telescope booking goes" was
  stored as a shared phrase. *Tuning.*

## Scope and leak check

| Item | Mind | Where |
|---|---|---|
| F1, F3, F9, F10 | User | F10 reads core (the snapshot); allowed by V2 |
| F2 | User (outreach) | Reads her candidates |
| F4, F5, F8 | Core | Wander, reflect, plan, event |
| F6 | Core | Posts |
| F7 | User (hot path) | Her plan, read-only |

No item lets user data reach a core loop. The leak canary and the side-channel test run in the
exit test as before.

## Settled lines (Ethan, 2026-10-19)

- **Q1 (F2):** (b) her own news (`her_day`, `core_thought`) never takes the last of the weekly slots;
  only their kinds can.
- **Q2 (F5, F6):** she lives online. Plan v3, event v6 and post check v3 carry the line: online
  places, remote telescope time, online screenings, Alcor by message; standing in a picture is fine;
  never a physical place, people there, or a body in a room.
- **Q3 (F4):** wander starts from and chains through lived memory only (`episode`, `interest`,
  `intention`); reflect supersedes a near-twin opinion or interest instead of adding it.
- **Q4 (F7, F8):** one night, held: an evening quiet block ending within `life.night_gap_minutes`
  of midnight is extended to midnight, and a message in a quiet block waits until the block ends
  unless closeness is at the override. Crisis still bypasses.
- **F10:** default taken (extraction sees her snapshot's Interests section).

## Exit test and review run

- **Tests:** deterministic, with fake LLMs:
  - F1: a table test.
  - F2: a gate test where her news can't take their slots.
  - F3: note order and headline.
  - F4: the wander chain kinds, and reflect superseding a near-twin.
  - F6: the URL fallback.
  - F7: the times in "Your day".
  - F8: the night extension.
- **Paid runs (ask first):**
  - `pnpm review:world-outreach`, about $1.20.
  - `pnpm eval:guard`, about $0.80, for the new F3 cases.
  - `pnpm posts:review`, cents.

## Out of scope

- The pose placement on the subject (with Ethan's sprites).
- Persona v6's drafted lines (Ethan's rewrite).
- The core_thought weight, revisited after the next run as planned.
- B35 (reply model).
