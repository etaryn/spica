# No night: her energy decides when she logs off

Design doc, 2026-10-20. Status: draft. The main lines are settled with Ethan; the numbers are
defaults to confirm.

## Intent

Ethan: "since spica now is fully embracing the ai angle, and has no physical body, only a digital
one, i think removing the entire night cycle could work."

His answers (2026-10-20):
- **Energy:** "drop the clock cycle, but her energy still runs out, and when she runs low, she
  logs off. this does not have to be a daily cycle, it can happen whenever."
- **Offline time:** short offline blocks, not tied to the night. They hold replies the way busy
  blocks do.
- **Their night:** reach-outs never go out during the user's own night.
- **Her day:** busy blocks at any hour, and browsing and posting at any hour too.

## Spec and settled lines

- **§8.3 world (DECIDED, built):** a shared day plan of busy, downtime and quiet blocks, at least
  6 h quiet, `joinNight`, with the night held (2026-10-19). This doc replaces the night.
- **§8.4 core state (built):**
  - Energy drifts hourly toward `baseline × rhythm(hour) − busy_drain × today's load`.
  - The rhythm is a 24 h cosine (`energy_peak_hour` 16, `energy_amplitude` 0.25).
  - Load resets at her midnight.
  - This doc replaces the rhythm and the daily reset.
- **§10.6 availability (built):** a quiet block holds a reply until it ends; a busy block delays it
  by busy × closeness. An offline period now takes the busy rule.
- **§13 outreach gate G3 (built):** no reach-out during her busy or quiet block. G3 now means busy
  or offline, and a new gate covers their night (B23 becomes partly done).
- **Scope rule V4 (DECIDED):** no user's conversation moves core state. Her energy therefore drains
  only from her own life (busy blocks), never from chatting.
- **Persona v6:** she is openly an AI, her avatar is her body, and the internet is where she goes.
  Nothing in it mentions sleep.

## Assumptions

- **Verified:** nine places read quiet blocks:
  - `world/blocks.ts`, `world/day-plan.ts`
  - `availability/deferral.ts`, `availability/busy-note.ts`
  - `outreach/inputs.ts`
  - `core/wander.ts`, `core/post.ts`, `core/browse.ts`
  - `state/core/tick.ts`
  - `hot-path/your-day-line.ts`
  - `relationship/openness.ts` (it reads busy)
  - Plus `platform/jobs.ts` (`blockKind`) and the fake `life_plan`.
- **Verified:**
  - 15 eval scripts script quiet blocks.
  - `prompts/life/availability/v1.md` has a "switch off for the night" note.
  - `posts.browse_window` is 09:00–23:00.
- **Verified:** the user's timezone is stored at signup (`getTimezone`); the outreach gate can read
  it.
- **Assumed (low stakes):** hourly granularity is fine for going offline and coming back, since
  `core_state_tick` already runs hourly.

## Design

### 1. Energy is a battery, not a clock (core state)

Each hourly `core_state_tick` updates energy as follows:
- **During an hour of a busy block:** energy drops by `busy × core.state.energy.busy_drain_per_hour`.
- **During a free hour:** energy recovers by `core.state.energy.free_recovery_per_hour`.
- **While offline:** energy recovers by `core.state.energy.offline_recovery_per_hour`, which is
  faster.
- **Always:** the existing bounded noise is added and the result is clamped to [0, 1].
- **Removed:** the daily rhythm and the midnight load reset (`rhythm`, `dayLoad`, `energy_peak_hour`,
  `energy_amplitude`, `busy_drain`, `full_load_hours`).
- **Baseline:** `baseline.energy` stays as her starting level.

Proposed defaults, aimed at about one log-off every day or so, at any hour, not on a schedule:

| Key | Default |
|---|---|
| `busy_drain_per_hour` | 0.12 (per busy-weighted hour) |
| `free_recovery_per_hour` | 0.02 (was 0.005; tuned 2026-10-21) |
| `offline_recovery_per_hour` | 0.15 |

A typical plan has about 3.5 busy-weighted hours (0.42 drain) against about 18 free hours (0.09
recovery), so the net is about −0.33 a day. Starting from 0.6 she reaches 0.2 in a little over a
day, then logs off for about 3 hours.

### 2. She logs off when she runs low (core state)

- **Going offline:** when energy falls below `core.state.offline.enter` (0.2), the tick sets a new
  `core_state.offline_since`. This needs a migration.
- **Coming back:** she stays offline until energy reaches `core.state.offline.exit` (0.6). The
  tick then clears it. The gap between the two thresholds stops her flickering on and off.
- **Duration:** with the defaults an offline period lasts about 3 hours.
- **Plan blocks:** while she's offline her busy blocks don't drain her and don't happen. The plan
  is intent; she simply wasn't there.
- **Record:** the trace records each switch.
- **Visibility:** an offline period is a core state, the same for every user. It is never caused by
  a user (V4).

### 3. Offline acts like a block for every reader (world/blocks)

- **Plans:** day plans are busy and downtime only. Plan v4 drops quiet and the night wording, and
  busy blocks can fall at any hour.
- **Validation:** `validatePlan` drops the quiet minimum and the night extension. A "quiet" block
  is rejected as an unknown kind.
- **Old rows:** old stored plans with quiet blocks are read as downtime.
- **Reading blocks:**
  - `todaysBlocks` becomes "her blocks now". It returns the plan's busy blocks plus, while she's
    offline, one offline block from `offline_since`.
  - The offline block's end is an estimate: the time energy needs to reach `exit` at
    `offline_recovery_per_hour`.
  - Its key is `offline#<offline_since>`.
  - `joinNight` and the midnight fold are deleted.
- **Availability:**
  - An offline block delays a reply like a busy block does, using `core.state.offline.busy` (0.9)
    as its busy level. The delay is capped at the estimated end.
  - The night hold is deleted.
- **The "busy, later?" note:** an offline kind replaces quiet, with phrasing like "logging off
  for a bit, back later". This is a new availability prompt version.
- **Other readers:** wander, post, browse and the outreach G3 gate read the same blocks, so
  offline counts as unavailable everywhere a quiet block did.
- **"Your day":** "Right now you're offline for a while (low on energy)".
- **Posts:** `posts.browse_window` is deleted, and browsing picks any free minute of her day.

### 4. Reach-outs respect their night (outreach gate)

- **The gate:** a new rule, `their_night`. No reach-out goes out between
  `outreach.their_night.start` and `.end` in the user's timezone. The defaults are 23:00 and 08:00.
  When their zone is unknown, UTC is used.
- **Scope:** her replies to their own messages are unaffected. If they write at 3am, she answers
  when she's available.
- **Backlog:** the closeness-scored part of B23 stays in the backlog.

### 5. Removals (replace from the ground up)

- **Code:** the quiet kind in plans and blocks, `joinNight`, the night hold, and
  `life.min_quiet_hours`, `life.night_gap_minutes` and `life.quiet_busy`.
- **Energy and posts config:** `core.state.energy_peak_hour`, `energy_amplitude`, `busy_drain` and
  `full_load_hours`, and `posts.browse_window`.
- **Prompts:** quiet in the fake `life_plan`, and the quiet note phrases.
- **Tests:** the night tests in `tests/mind/world/blocks.test.ts`, `deferral.test.ts` and
  `day-plan.test.ts`.
- **Eval scripts:** the quiet blocks in the 15 scripts. Their availability cases move to busy or
  offline blocks.
- **Spec text:** the night text in §8.3, §8.4, §10.6 and §13.

## Scope and leak check

- **Core mind:** energy, offline, the plan and blocks.
- **User mind:** the outreach gate, availability and "Your day". These only read core state, which
  is allowed (V2).
- **No user influence:** no user action moves energy or offline (V4). The side-channel test
  already asserts that core state is unchanged after user A's exchange, and it now covers
  `offline_since`.
- **Canary:** the leak canary is unaffected.

## Exit test and review run

- **Deterministic tests:**
  - A run of busy hours drains her to `enter`, and she goes offline at that hour.
  - She comes back when recovery reaches `exit`.
  - A message during offline is delayed by the busy rule and capped at the estimated end.
  - A reach-out is blocked in the user's 02:00 and allowed at their 10:00.
  - A plan with a quiet block is rejected.
  - An old stored quiet block reads as downtime.
  - Her energy never moves from a user's exchange.
- **Paid run (ask first):** `pnpm review:world-outreach` at about $1.20. It shows how often and when
  she logs off over 14 days, so the energy numbers can be tuned.

## Out of scope

- **B23 remainder:** scoring reach-outs by closeness during the user's inactive hours. *Later.*
- **Planned events during an offline period:** they still land as planned. Marking them as fallen
  through is backlog if it reads wrong in the run. *Tuning.*
