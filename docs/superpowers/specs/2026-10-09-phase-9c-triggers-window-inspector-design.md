# Phase 9c: Remaining triggers, crisis-aware user mind, window trim, memory view removal, inspector tab — design

Date: 2026-10-09. Status: approved in conversation, awaiting spec review.

Phase 9 (user mind, v3 §9) is built in slices. 9c was re-sliced with Ethan on 2026-10-09:

| Slice | Builds |
|---|---|
| 9a (built) | Big-event triggers, `user_mind_run`, the loop runner and `user_loop_trace`, `user_summarise`, the summary slot |
| 9b (built) | `user_reflect`, `user_ideate`, the ideas slot, outreach `core_thought` and `user_idea`, B26 |
| **9c (this doc)** | The three deferred triggers (B63), crisis content in the user mind, B2 window trim, removal of the "What I remember" view (replaces B66), inspector User mind tab |
| 9d | `user_consolidate` (with a new user `episode` kind), `user_model` (her read on the user, `belief` facts), full Phase 9 exit |

## Intent

Her user mind runs when it should: after a long talk, after a crisis has eased, and before she
writes first with an out-of-date picture. After a crisis she carries it (gently) into later
conversations without ever raising it on her own. After days apart she remembers the gist, not
the transcript. Users can no longer edit her memory. Every run is visible in the inspector.

Test phase: functionality over accuracy. No prompt changes in this slice.

## Decisions taken with Ethan (2026-10-09)

- **9c / 9d split** as above. 9d's choices are already settled: `user_consolidate` writes a new
  user `episode` kind (gist of 3+ older resolved event/feeling facts from one week, sources' salience
  cut once; user decay already exists, so it only gists); `user_model` writes one live `model` fact
  (superseding, own reply slot) plus `belief` facts through retrieval; common ground waits for
  Phase 10.
- **All three deferred triggers** (B63): `long_conversation`, `crisis_passed`, `stale_summary`.
- **Users cannot influence her mind** (core or user side). The "What I remember" page and
  per-fact forget are removed; this overrides v3 §12.5 and the per-fact part of §18. Account
  deletion stays. B66 is closed as moot.
- **Crisis content flows into the user mind, with the sensitive mark carried forward.**
- **B2: trim at a long gap**, a new key distinct from the gap marker.

## 1. Triggers

`Trigger` (`src/db/repos/user/user-mind.ts`) gains:

```ts
| { kind: "long_conversation"; session_id: string; user_turns: number }
| { kind: "crisis_passed" }
| { kind: "stale_summary"; age_hours: number | null }  // null: no summary yet
```

Each is recorded through the existing `recordBigEvents` + `enqueueUserMindRun`, so it goes through
the daily cap (`user_mind.max_triggers_per_day`) like the 9a triggers. "Fires exactly once" comes
from the existing unique index on `(user_id, source_ref)`.

| Trigger | Detected by | `source_ref` | Skipped when |
|---|---|---|---|
| `long_conversation` | `user_mind_tick` | `long_conversation:<session_id>` | relationship `ended_by_user`; effective crisis window active |
| `crisis_passed` | `user_mind_tick` | `crisis_passed:<effective quiet-until, ISO>` | relationship `ended_by_user` |
| `stale_summary` | `outreachTickUser`, only when it schedules a send | `stale_summary:<reach_out_log id>` | live summary younger than `max_age_hours` |

- **`long_conversation`**: a `session_log.session_id` (sessions already split at
  `session.idle_gap_minutes`) with at least `user_mind.triggers.long_conversation.min_user_turns`
  (20) user turns, whose last turn is older than `quiet_minutes` (30) and newer than
  `user_mind.tick.lookback_hours` (24). Skipped inside a crisis window: rule 7 suspends every v3
  mechanism there, and `crisis_passed` covers the period after.
- **`crisis_passed`**: the effective crisis window (`effectiveCrisisQuietUntil`, the one outreach
  uses) ended within `lookback_hours`. The ISO end time in the `source_ref` makes each crisis fire
  once; a later crisis has a later end and fires again.
- **`stale_summary`**: the live summary is missing or older than
  `user_mind.triggers.stale_summary.max_age_hours` (72). When the run is recorded `pending`, the
  send time becomes `max(jittered, now + lead_minutes)` (`lead_minutes` 5) so the run usually
  finishes before compose. A `capped` run changes nothing. If the run is slow or failed, the
  reach-out uses the summary it finds.
- Trigger lines (`triggerText`):
  - `long_conversation`: "you two just had a long conversation"
  - `crisis_passed`: "they went through something hard, and it has eased"
  - `stale_summary`: "you're about to write to them and haven't taken stock in a while"

### `user_mind_tick`

New hourly job, cron `user_mind.tick.cron` (`25 * * * *`), registered in the worker alongside the
user mind run. One pass:
1. Long-conversation candidates: one admin query over `session_log` (cross-user, admin repo).
2. Crisis-passed candidates: users whose stored `crisis_quiet_until` is after `now - lookback`,
   or who have a flagged turn (`session_log.safety_flag` set) after
   `now - lookback - relationship.crisis_quiet_hours`. Per user, `effectiveCrisisQuietUntil`
   gives the window's end; it fires when that end is in `(now - lookback, now]`.
3. The pending-run sweep (`sweepPendingUserMindRuns`) moves here from the daily
   `cold_path_sweep`, so a lost run waits an hour, not a day.

Per user: check the skip conditions, `recordBigEvents`, enqueue. Errors are logged per user and
don't stop the pass. Rerunning the tick records nothing new (unique `source_ref`).

## 2. Crisis content in the user mind

- `listFactsForSummary` (used by `loadRunInputs`) stops excluding sensitive facts and returns each
  fact's `sensitive` flag.
- **Summarise and reflect** read all of the run's facts. **Ideate** reads only non-sensitive ones
  (ideas feed outreach and push).
- **Marking**: a summary is written with `payload.sensitive = true` when any input fact is
  sensitive or its `previous` summary is sensitive (its text carries forward). A reflection is
  marked when any input fact is sensitive.
- **Replies** read everything, as today: the summary slot shows a sensitive summary; retrieval
  already returns sensitive facts and now sensitive reflections.
- **Reach-outs** already exclude sensitive memories in retrieval (this now covers sensitive
  reflections too). The summary slot for a reach-out reads the **latest non-sensitive summary**.
- `ponytail:` the mark is sticky through the summary chain, so after a crisis reach-outs keep
  reading the last pre-crisis summary. Add a clear-down rule if reach-outs feel out of date.

## 3. B2: trim the recent-turns window

In reply assembly, the recent turns (`chat.recent_turns`, 20) drop every turn before the latest gap
of at least `chat.window_gap_hours` (72) between consecutive turns. This applies to replies and
reach-outs. Gaps from `chat.gap_line_min_hours` (24) up to 72 hours keep the "[N later]" marker.
After a long gap the window may hold only the new buffer (or nothing, for a reach-out); deep
memory (summary, retrieval) carries the rest. No LLM call. B2 closed.

## 4. Remove "What I remember"

Delete `src/app/memory/` (page, actions, forget button, CSS), `forgetFact` in
`src/db/repos/user/facts.ts`, the links in `src/app/chat/page.tsx` and `src/app/settings/page.tsx`,
their tests, and the inspector's "(deleted)" handling for hard-deleted facts (only account deletion
removes facts now, and it removes everything). Account deletion in settings stays. Update v3 §12.5
and §18; one `DECISIONS.md` line. B66 closed as moot.

## 5. Inspector User mind tab

New tab `mind` on `/inspector/[userId]`, backed by an admin repo read:
- The last `inspector.user_mind_runs` (20) runs: created, status, triggers in words, finished.
  Under each, its loop traces (loop, status, tokens, cost, error class), with inputs and outputs
  in a `<details>`.
- The live summary (sensitive marked), the `user_mind.reflect.recent` latest reflections, and the
  live ideas.

## 6. Config

New keys (all in `config/default.json` and the config schema):
- `user_mind.tick.cron` `"25 * * * *"`, `user_mind.tick.lookback_hours` 24
- `user_mind.triggers.long_conversation.min_user_turns` 20, `.quiet_minutes` 30
- `user_mind.triggers.stale_summary.max_age_hours` 72, `.lead_minutes` 5
- `chat.window_gap_hours` 72
- `inspector.user_mind_runs` 20

`user_mind.sweep_after_minutes` stays (now read by the hourly tick).

## 7. Testing

Unit (deterministic, fakes):
- Long-conversation and crisis-passed detection: thresholds, lookback edges, skip conditions,
  rerun records nothing.
- Outreach: `stale_summary` recorded only when scheduling and stale; send pushed to `lead_minutes`;
  capped run leaves the time alone.
- Sensitive flow: summarise and reflect read sensitive facts and mark output; the mark carries
  through `previous`; ideate never sees sensitive facts; a reach-out's summary slot reads the
  latest non-sensitive summary; reach-out retrieval drops a sensitive reflection.
- Window trim: gap below, at and above 72 h; marker kept for 24–72 h.
- Inspector repo read.

Exit `tests/exit/phase-9c.test.ts` (fake LLM, guard off):
- Each of the three triggers fires its batch exactly once, including when the tick and outreach
  rerun.
- An idle user runs no loop.
- Outputs land in user scope only; core state is unchanged by any run.
- The leak canary covers outputs of a `crisis_passed` run (a token in user A's crisis fact never
  reaches core or user B's prompts).

No new LLM processes, so no new real-API exit calls; `pnpm exit:user` is unchanged.

## 8. Spec updates on close

v3 §9.4 (built 9c triggers), §9.5, §10.3 (window trim, reach-out summary), §12.5 and §18 (memory
view removed), §17 inspector, §20 (9c row, 9d added), §25 (B2, B63, B66 closed). CLAUDE.md
current-phase line.
