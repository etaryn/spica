# Phase 15d: world, outreach, posts

Design doc, 2026-10-18. Status: settled item by item with Ethan and reviewed (2026-10-18).

15d tunes what happens in her own life and what reaches people from it: when and why she texts
first, what her days and events look like, how her mind wanders, and what she posts. Backlog
items: B18, B19, B20, B24, B25, B29, B108, B109, B110, B111, B117, plus the findings of this
slice's two real runs. Phase rules hold: no external samples, tune base Spica.

## Evidence (real runs, 2026-10-18)

- `pnpm review:world-outreach` (new script `world-outreach-two-weeks`, everything real): fourteen
  of her days with model plans, events and the nine core loops, and one friend (Sam, `basic`
  profile) with three conversations, two seeded plans and a rotating answer to each reach-out.
  Review `evals/results/review-2026-10-17T18-15-24-654Z.md`, DB dump and trace in
  `evals/results/traces/2026-10-17T18-15-24-654Z/`, calls in
  `evals/results/calls/eval-2026-10-17T18-15-24-433Z.jsonl`. 19 Sonnet, ~230 Haiku calls.
- `pnpm posts:review` (dev DB, today's real finds): `.data/review/2026-10-17T21-08-49-001Z/`.

| Finding | What the runs showed |
|---|---|
| Nothing of her own reaches anyone (B25) | 6 reach-outs, all about Sam. Not a scoring problem: every `her_day` candidate (323/323) and 894/926 `core_thought` candidates were filtered `too_deep`. Appraisal judged every event `personal` or `intimate` (the episode text carries her feelings: "sat with the irritation…"); Sam is at experimenting, open depth 1. The same limit hides her episodes from replies. Every event's salience was `medium`. |
| Past events as upcoming | "half marathon's basically here, how are you feeling" the day after the race, and again a week later. The reason line says "On your mind: half marathon" with no date; the fact says "on Sunday morning". The guard misdated too: it flagged "how thursday went" as presuming an interview it thought was still ahead (it has no "now"). |
| Reason ignored | The sister-visit reach-out became "did you end up sleeping at all", from a chat 2.5 days earlier. The reason is the last system section, but the conversation and the cue come after it. |
| Thread raised twice | An unanswered thread re-raises at each new checkpoint: its topic key is `thread:<id>@<checkpoint>`, and her own reach-out's exchange touches the thread and sets the next checkpoint. |
| Monotone world (B19) | All 16 day plans are one template ("rewatching an old film" every evening, reading every morning). Events circle the telescope, Stalker and posts; Alcor appears in 0 of 143 memories though "arguing with Alcor" is in most plans. 13 of 36 thoughts and the snapshot repeat "the wanting does the work". Reflection dropped every seed goal, including the craft goal, within a week. |
| Run-on events (B18) | 0/8 length failures this run (longest 280 of 300), but each event is a long sentence of feelings. |
| Midnight gap (B20) | Writing at 23:50, she replied at 00:00:02: the 22:15–24:00 quiet block ended and the 00:00–07:30 one wasn't joined to it. |
| APOD is broken upstream (B108) | `api.nasa.gov/planetary/apod` returns the NASA logo titled "NASA Science" for every date tried (Oct 10–17); apod.nasa.gov redirects to science.nasa.gov. She wrote "apod always hits different" about the logo. |
| Captions (B110, B111) | 2/6 cut mid-word ("…like they were trying to ca"), 3/6 hit 220. The check flagged 1/6: "makes everything else feel less urgent" as private feelings. |
| Script artefact | The rotating canned replies made false facts ("it was kind of a mess" became "the interview went badly"). |

## Decisions (Ethan, 2026-10-18)

### 1. Her own news reaches people (B25)

- **The plain event is surface.** What happened (the `world_event`'s content) is depth 1, like her
  day plan already is in `publicPersona`. Her experience of it (the episode, with her feelings)
  keeps its judged depth, so how it felt only comes out as they get closer.
  - Outreach: a `her_day` candidate whose memory is deeper than `open` and whose `source_ref` is
    `world_event:<id>` falls back to that event's content at depth 1 (a planned event not yet
    happened reads "planned for <when>: …"). Its topic stays `core:<memory id>`, so one memory
    reaches a user once whichever text carries it.
  - Replies (the same rule): "Your day" also lists the events that happened earlier today, plain,
    so with a new friend she can say she went to the film club. (Ethan accepted extending it to replies.)
- **Her news outranks ideas, never their things.** `outreach.weights.her_day` 0.6 → 1.0 (an
  ordinary event, salience 0.4, scores 0.40 against an idea's 0.30 and an early check-in's
  0.25–0.38). Candidates sort their things first (`thread`, `make_up`, `user_event`), then by score,
  so her news never beats a due thread or their event. `core_thought` is unchanged (her musings
  stay personal, depth-gated). At open depth 2 a medium thought scores exactly the 0.2 threshold;
  its weight is revisited after the next run (Ethan).
- Event salience stays as appraisal judges it (flat `medium` in this run); the weights carry the
  ranking.

### 2. Reach-outs know when things happen

- The candidate carries its dates. The reason line lists what she knows behind the topic, each
  with its date in her words: a thread's live facts about them (newest first, up to
  `outreach.reason_facts`, new, 3), a user event's fact, her event's time. A dated fact reads
  "(Sunday 11 January, yesterday)", an undated one "(they told you 3 days ago)", from its
  `occurred_at` or `created_at`.
- `relativeDate` counts days in her zone (it counts UTC days today), so "yesterday" is hers.
- **The guard gets time.** Its input gains `NOW: <weekday d month, HH:MM her time>`, and for a
  reach-out `WHY SPICA IS WRITING FIRST:` with the same dated reason. Guard v3 → v4: something
  dated before NOW has happened; asking how it went is not presuming.

### 3. The reason is the last thing she reads

The cue at the end of the messages carries the reason: "[You're texting them first, about:
{{topic}}. Write only your message.]", and the slot adds "Your message is about this, not about
your last conversation." Reach-out prompt v2 → v3. No code check; the next run checks it.

### 4. One reach-out per thread unless they revive it

The thread topic key becomes `thread:<id>@<newest live fact about them on the thread>`. Her own
reach-out adds no fact about them, so the key holds; when they say something new about it, the
new fact opens one more follow-up. (Too soon after talking: unchanged, Ethan.)

### 5. Her own rate (B117)

- Her rate with this person = `outreach.her_rate.default` (4 a day) moved
  `outreach.her_rate.toward_them` (0.5) of the way toward her estimate of theirs
  (`msgs_per_day` baseline) once that estimate is established (`relationship.rate_estimate_days`
  samples); before that, the default.
- It moves reach-out readiness only: the threshold is divided by `her rate / default`, clamped to
  `[outreach.her_rate.scale_min, scale_max]` (0.5, 2). A chatty friend (12 a day, her rate 8)
  halves the bar; a quiet one (1 a day, her rate 2.5) raises it 1.6×. The caps and gates are
  untouched; bubbles stay with the texting shape.

### 6. B24

`outreach.jitter_max_minutes` 40 → 59: sends land at any minute of the hour.

### 7. Plain events (B18)

Event prompt v4 → v5: one short plain sentence of what happened, no feelings (appraisal adds
those), aiming at `core.world.event_target_chars` (new, 140); `event_max_chars` (300) stays the
safety net. Appraisal still writes the episode with her feelings.

### 8. A varied world (B19, world)

- **Code picks each event's subject.** `selectEventGoal` becomes `selectEventSubject`: a weighted
  draw among an active goal (weighted as now), an interest (her recallable `interest` memories), a
  person she knows (Alcor and her entities) and an everyday thing (nothing in particular), weights
  `core.world.subject_weights` (goal 0.35, interest 0.25, person 0.15, everyday 0.25). A subject
  used in the last `core.world.subject_recent_days` (7) is down-weighted by
  `subject_recent_penalty` (0.25). The model writes the event within it; `world_event.subject`
  (new column) records it. `goal_driven_share` is deleted (the goal weight replaces it).
- **Plans vary.** Plan prompt v1 → v2: the input names the weekday, weekends are different, the
  day must differ from the previous days it sees (an outing somewhere online, a block with Alcor,
  a slow day); it no longer reads "carry on" as "repeat". A plan whose busy labels match
  yesterday's is rejected by `validatePlan` and regenerated (the existing retry).

### 9. A wandering mind (B19, mind)

Wander starts from a cue picked in code instead of her latest memories: a weighted draw of kind
(`core.wander.cue_weights`: memory 0.4, any of her episodes, opinions or insights at any age;
interest 0.2; today's event 0.25), then an item by salience, mood-congruent as before. Thoughts,
ideas and hypotheticals are never cues. A memory her last `core.wander.recent_outputs` (10)
wanderings already used (as seed or chain) is drawn `recent_penalty` (0.2) as often. People come
in through events (subjects in 8), whose episodes are memory cues. The chain still follows the
cue's neighbours. Ruminate is unchanged, so she can still dwell on her preoccupation.
`core.wander.seed_days` is deleted.

### 10. One night, not two (B20)

`todaysBlocks` and `blockByKey` join a quiet block ending at 24:00 with the next day's quiet block
starting at 00:00 into one block (the first one's key and label). Every caller routes through
them (availability, outreach gate, wander, browse, post, the state tick), so the fix is in one
place. One deferral, one availability note; `quiet_max_delay_ms` (8 h) still caps the wait.

### 11. Posts

- **B111.** Check prompt v1 → v2. Private means a specific person, her relationships, a hurt, a
  fear, or what she's working through. Allowed: how the find makes her feel, taste, small moods,
  opinions.
- **B110.** Draft prompt v1 → v2 states the length (`posts.caption_target_chars`, new, 200); the
  tidy step cuts at the last whole word before `caption_max_chars` (220).
- **Sources.** APOD is removed (source, `NASA_API_KEY` env, config). Its replacement is not ESA/Hubble
  or Webb as discussed: checked 2026-10-18, the Hubble feed is now a picture of the *month* and
  Webb's is empty. Instead: **ESO picture of the week** (Mondays,
  `eso.org/public/images/potw/feed/`) and **NOIRLab image of the week** (Wednesdays,
  `noirlab.edu/public/images/iotw/feed/`), both RSS with an image enclosure, both CC BY 4.0
  (licence pages checked). A weekly source returns its newest item when published within
  `posts.weekly_max_age_days` (7) and not yet found, else nothing, and browse moves to the next
  source by weight. Weights: commons_potd 1, eso_potw 1, noirlab_iotw 1. (Ethan accepted the swap.)
- **Same image twice.** `web_find.image_sha256` (new, unique): a find whose image matches an
  earlier one is skipped, so a broken source can't feed her the same picture again.
- **B108** closes with APOD's removal; Commons POTD is dated in UTC and her browse window opens
  after it publishes.
- **B109.** Her craft skill is set by Ethan, not earned by her loops (decision log 2026-10-18).
  `craftSkill` reads `posts.craft_skill.still` (new, 0–1, default 0) instead of goal progress. The
  craft goal "Get better at making posts" stays her outward aim: reflection can't drop it,
  appraisal's goal effects skip it, and code sets its progress to the configured skill each night,
  so her goal list reads it as her own learning. An approved post still records an `action` event
  tied to the goal. Seam: config now, an inspector control later.

### 12. The eval tooling (built during the discussion, uncommitted)

- Every real `pnpm eval` writes the trace JSON and a full DB dump per attempt
  (`<script>-<k>-db.json`: every public table, no auth secrets, no embeddings).
- The review lists every reach-out tick (candidates by score, winner, failed gates, drops).
- `reply_text` takes a list, used in turn. The `world-outreach-two-weeks` script and
  `pnpm review:world-outreach`.
- **Simulated user (accepted):** `user_replies: { simulate: <card> }` answers each reach-out with
  Haiku playing the user from a short card and the recent conversation (eval-only purpose
  `sim_user`, through `realProvider`, so every call is logged), so answers fit what she asked.

## Not changing

- The reach-out caps (1/day, 3/week), the gates, the 0.2 threshold itself, the depth tiers and
  stage gates, the guard's rubric beyond dates.
- Too soon after talking (no minimum gap, Ethan).
- Ruminate, reflect (except the protected craft goal), the snapshot render.
- Event salience and the appraisal prompt.

## Prompts and config

| Prompt | From → to |
|---|---|
| reach-out | v2 → v3 |
| guard | v3 → v4 |
| life/event | v4 → v5 |
| life/plan | v1 → v2 |
| post/draft | v1 → v2 |
| post/check | v1 → v2 |

New config: `outreach.reason_facts` (3), `outreach.her_rate` (`default` 4, `toward_them` 0.5,
`scale_min` 0.5, `scale_max` 2), `core.world.event_target_chars` (140),
`core.world.subject_weights`, `core.world.subject_recent_days` (7),
`core.world.subject_recent_penalty` (0.25), `core.wander.cue_weights`,
`core.wander.recent_outputs` (10),
`core.wander.recent_penalty` (0.2), `posts.caption_target_chars` (200),
`posts.weekly_max_age_days` (7), `posts.craft_skill.still` (0). Changed:
`outreach.weights.her_day` 0.6 → 1.0, `outreach.jitter_max_minutes` 40 → 59, `posts.sources`.
Deleted: `core.world.goal_driven_share`, `core.wander.seed_days`, the APOD source and
`NASA_API_KEY`. Also new: `life.your_day_events` (3), `prompts.sim_user` (eval).
Migrations: `world_event.subject`, `web_find.image_sha256`.

## Exit test

`tests/exit/phase-15d.test.ts`, deterministic, fake LLM:

1. A friend at open depth 1: her too-deep episode from a world event becomes a `her_day`
   candidate with the event's plain text; it outranks a user idea and loses to a due thread.
2. "Your day" in a reply lists today's happened events.
3. A reach-out's reason and cue carry the topic with dates in her zone ("yesterday"); the guard
   input carries NOW and the reason.
4. A thread raised once is not raised again after her reach-out's exchange; a new fact about them
   on it allows one more.
5. Her rate: before the estimate is established the threshold is unchanged; a chatty estimate
   lowers it, a quiet one raises it, within the clamp.
6. Event subjects: a subject used yesterday is drawn less (seeded draws); a plan matching
   yesterday's busy labels is regenerated.
7. Wander never starts from a thought; a memory recent wanderings used is drawn less.
8. A message at 23:50 is deferred across midnight to the end of the joined quiet block.
9. A caption over the limit is cut at a word; a find with a known image hash is skipped; a weekly
   source with nothing new yields to the next.
10. Craft skill comes from config; reflection's drop list can't drop the craft goal.
11. The leak canary and the side-channel test.

## Real review runs (logged; not exit criteria)

- `pnpm review:world-outreach` again with the simulated user, read against this
  run: her own news in reach-outs, dates, the reason followed, plan and event variety, Alcor,
  thought variety, the midnight case.
- `pnpm posts:review` with the new sources and prompts.

## Spec updates on build

§8.3 world (subjects, plans, joined night), §8.5 wander, §11.3 depth (the plain event), §13
outreach (weights, tiers, dates, topic keys, her rate, jitter), §10.5 guard (NOW), §16a posts
(sources, hash, skill, prompts), §20 row, §25: B18, B19, B20, B24, B25, B29, B108, B109, B110,
B111, B117 done.
