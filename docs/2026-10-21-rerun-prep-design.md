# Rerun prep: what the 2026-10-21 run showed, fixed before the next run

Design doc, 2026-10-21. Status: settled with Ethan (lines below are his answers).

## Intent

Ethan: "before running, check for any open decisions and parts that need fixes, explain them to
me, and then let me make a decision, write a proper plan and implement, and only then do a run."

The run is `evals/results/review-2026-10-20T15-30-05-524Z.md` (trace dir with the same stamp).
The no-night fixes already built from it (free recovery 0.02, plan v5, idea notes and `idea_again`)
are in `2753cfd`.

## Spec and settled lines

- §7 snapshot (DECIDED, built): nightly `core_render_snapshot` rewrites her six sections from
  bounded evidence. **Line:** an emptied section keeps last night's lines.
- §8.5 reflect (built): opinions and interests have near-twin merging; goals have none. **Line:**
  a new goal that is a near-twin of an active one is not added (and that goal isn't dropped the
  same night); a seed goal can't be dropped in its first week.
- §9 user mind (built): loops read her snapshot as `who_you_are`. **Line (Ethan):** "i dont want
  her to fixate on the user and invent facts all the time, but the assumptions about the user are
  fine and encouraged at a moderate level, since humans form perceptions of others based on our
  own reflection too regardless of its accuracy." So her reads stay, framed as her impressions;
  an idea needs something they said; she never puts words in their mouth. Her full snapshot
  stays in.
- §9 user mind: **Line:** the loops get NOW and each memory's date.
- §13 outreach: **Line:** `idea_again` lifts once they've written since the last reach-out.
- §16a posts: **Line:** the draft and check see the feed's description of the picture.
- Needs (§8.2): left as is (Ethan).
- B121 turn judge: it timed out again (1/16), so the timeout goes up as the backlog planned.

## Assumptions

- **Verified:**
  - The night-1 render returned empty Lately/Opinions/Interests/Goals/People. The code stored it
    as v1 (`core_snapshot` v1 in the dump).
  - The 10-19 run's v1 kept her seed self.
- **Verified:** her theme reached Sam through the user-mind loops:
  - the user model, 01-09: "showing up matters more than arriving polished";
  - the idea, 01-09: "are you actually doing it rough like you said";
  - the stored trait, 01-13: "The user tends to obsessively polish work".
  - Sam never said he polishes.
- **Verified:** goal churn. Reflect dropped "Send the unfinished post without checking it first" and
  added near-copies. The seed goal "Learn the winter constellations by sight" was dropped.
- **Verified:** summary misdates: 01-12 "The interview's still ahead"; 01-14 "ran the race Tuesday".
- **Verified:** the user-mind inputs carry no dates (`memoryLines` sends subject, kind and content).
- **Verified:**
  - `reach_out_log.answered_at` is set by the user's next message (`markLatestAnswered`).
  - ESO/NOIRLab RSS items have a `<description>`.
  - The draft and check see only `find.title`.
- **Assumed (low stakes):**
  - The goal twin threshold is 0.85, like the opinion twin threshold (no measurement yet).
  - The feed description is cut to 300 characters.

## Design

1. **Snapshot keeps an emptied section** (`process/core/render-snapshot.ts`). Last night's sections
   are parsed from the previous content, or the seed self on the first night. A section the model
   returns empty, which had lines, keeps those lines and their self lines (depth from the section
   default).
2. **Goal twins and the seed week** (`process/core/reflect.ts`, `CoreGoals.nearActive`):
   - A goal add within `core.goals.twin_similarity` (0.85) of an active goal is skipped, and that
     goal is taken off tonight's drop list.
   - A `seed` goal younger than `core.goals.seed_keep_days` (7) is never dropped.
3. **User mind: NOW, dates, and her reads stay hers** (`process/user/*`):
   - `RunInputs` gains the user's timezone.
   - `memoryLines` adds `when` (`formatLocal(occurred_at)`, or null), and every loop input gets
     `now`.
   - New prompt versions:
     - summarise v3: NOW decides past vs ahead;
     - model v3 and reflect v3: reads framed as her impressions, at a moderate level, never stated
       as things they said;
     - ideate v4: an idea rests on something they told her, and never says "like you said" unless
       they did.
4. **`idea_again` lifts on their reply** (`repos/user/reach-out.ts` `lastSentKind`): only an
   unanswered last reach-out counts.
5. **Captions see the description**:
   - schema: `web_find.description` (nullable text; migration 0040), and `WebItem.description`;
   - the RSS sources keep `<description>`, stripped of tags and cut at `posts.description_max_chars`
     (300);
   - the draft and check inputs add "What it shows: …".
6. **Leftovers:**
   - `turn.judge_timeout_ms` 3000 → 5000 (B121 done);
   - `driftStep` stops computing energy;
   - the state tick counts a busy block from yesterday's plan that runs into the past hour;
   - the spec backlog header's highest number.

## Scope and leak check

- **Core:** items 1, 2 and the tick.
- **User:** items 3 and 4. User loops read core (V2); nothing user-scoped reaches core.
- **World and posts:** item 5.
- **Canary:** the leak canary and side-channel tests are unchanged and must stay green.

## Exit test and review run

- **Exit test:** none new. These are tuning fixes inside built phases. Each item gets its unit
  test, and the full suite and `pnpm eval --llm=fake --compare` run at close.
- **Review run (ask Ethan first):** `pnpm review:world-outreach`, about $1.20. It checks:
  - plan v5 and free recovery 0.02;
  - ideas and their reset;
  - the snapshot keeping her seed self;
  - how much of her theme reaches her reads of Sam;
  - summary dates.

## Out of scope

- **Needs running low:** left as is (Ethan).
- **A superseded idea source:** it isn't followed to its replacement (minor).
- **Plan prompt "1 to 3":** the prompt still states the number itself; prompt files can't read
  config.
