# Phase 6: Proactive outreach design

Date: 2026-09-30 · Status: **built; see §12 "As built"** · Parent: `spica-build-spec-v2.md`
(§2 rule 5, §4, §5.1, §5.5, §5.8, §6.2, §11, §14.5, §15 Phase 6, §15.2 #10, §16.1 #7)

## 1. Goal and exit test

Spica messages first. Every hour an outreach tick looks at what she could bring up (a due thread, a make-up
she owes, something that happened to the user, something from her own day, or just a check-in after a long
gap), scores it in code, and, if the best candidate clears a threshold and every send-gate rule passes,
schedules a reach-out. The reach-out is composed through the normal hot path with a synthetic trigger,
paced like a reply, delivered over SSE, and, like **every** message she sends from now on, pushed as a Web
Push notification when the user has notifications on.

**Exit test (v2 §15):** no gate rule (caps, her busy/quiet blocks, no repeated topic, silence after 2
unanswered) is violated in a 2-week simulated run; reach-outs are composed through the hot path and
delivered. Concretely: `pnpm test` and `npx tsx evals/run.ts --llm=fake --compare` pass with no regressions,
and the exit run (§9.4) passes all six Phase 6 scripts 3/3. No guard suite (Phase 9); the reach-out guard
fixtures are written now and first run there (§15.2 #10). Quality (what her reach-outs say) is not an exit
criterion; a review run follows for Ethan to read.

**In scope:** schema and config (§3), candidates and scoring (§4), the send gate (§5), jobs (§6), compose
(§7), delivery and Web Push (§8), inspector, evals and tests (§9), v2 edits (§10).

**Out of scope:** reaching out during the user's inactive hours scored by closeness (D3, backlog), a real
presence store (D6), a notification settings page beyond on/off, the guard (off until Phase 9).

## 2. Decided in brainstorming (2026-09-30, with Ethan)

| # | Decision |
| --- | --- |
| D1 | **Deterministic selection.** Candidates are built and scored in code (tier weight × strength, threshold in config). No LLM picks or vetoes. The hot path still writes the message. |
| D2 | **Make-up is a candidate.** A fifth kind, `make_up`, ranked after due threads: when `make_up_state = due`, she may reach out first to make up (rule 2, "Spica initiates"). |
| D3 | **Only her clock gates.** A reach-out is blocked while she is in a busy or quiet block (her own day, `Asia/Singapore`), **regardless of the user's hours**, mimicking a real person who texts when *she* is free. Deviates from v2 §11 ("outside the user's active hours"). Later (not the test phase): a tendency to reach out during the user's inactive hours, scored by closeness. |
| D4 | **No recent-contact gate.** v2 §11's "the user messaged within the last 2 hours" rule is dropped: she may bring up a due thread an hour after a chat ended. The "conversation in progress" gate (§5 G5) stays, so a reach-out never cuts into a buffer awaiting her reply. |
| D5 | **"Answered" = any user message after the reach-out** (test phase). It resets `unanswered_reach_outs` and marks the most recent unanswered reach-out as answered. |
| D6 | **Web Push is real and minimal.** VAPID + `web-push`, a service worker, a `push_subscription` table, an on/off switch. No presence tracking: every message is sent over SSE *and* pushed; the service worker hides the notification when a Spica tab is visible. |
| D7 | **Every message pushes by default**, like a normal texting app: replies, reach-outs, backchannels, availability notes, crisis replies. Browsers require a click to grant permission, so `/chat` shows a one-time "Turn on notifications" banner; once granted, everything pushes until switched off in `/settings`. |
| D8 | **Exit profile: all fake.** Selection is deterministic, the reply model is always fake, the life plan is scripted: no API calls. |

## 3. Schema and config

### 3.1 Migration 0010

- **`reach_out_log`** (exists, unused) gains:
  - `topic text null`: the winner's topic key (§4.2), null when nothing was scheduled;
  - `status text not null`: `none` (no candidate cleared the threshold), `blocked` (gate failed),
    `scheduled` (send job enqueued), `sent`, `dropped` (the send job's re-check failed, or compose failed);
  - `send_at timestamptz null`, `answered_at timestamptz null`.
  - `sent` stays (true iff `status = sent`) so the existing inspector tab keeps working.
  - A partial index `reach_out_log_user_sent_idx (user_id, created_at) WHERE status = 'sent'` for caps and
    topic lookups.
- **`push_subscription`** (new): `id uuid pk`, `user_id` → `user(id) ON DELETE CASCADE`, `endpoint text
  not null unique`, `p256dh text not null`, `auth text not null`, `created_at timestamptz not null` (from
  `Clock`). Repo `src/db/repos/push.ts` (`userId`-first).
- `relationship.unanswered_reach_outs` (exists, default 0) is now written.
- `session_log.trigger = reach_out` (enum value exists); a reach-out row has `reply_to = null`.

### 3.2 Config (all new; starting values, test phase)

```jsonc
"outreach": {
  "enabled": true,
  "tick_cron": "20 * * * *",
  "cap_per_day": 1,              // rolling 24 h
  "cap_per_week": 3,             // rolling 7 d
  "max_unanswered": 2,           // silence after this many in a row
  "threshold": 0.4,
  "weights": { "thread": 1.0, "make_up": 0.9, "user_event": 0.8, "her_day": 0.6, "check_in": 0.5 },
  "stakes_strength": { "high": 1.0, "med": 0.6 },
  "user_event_lookback_hours": 72,
  "her_day_lookback_hours": 24,
  "check_in_gap_factor": 2,      // × cadence.median_gap_hours
  "jitter_max_minutes": 40,      // send delay after the tick, seeded per user + hour
  "due_threads_limit": 5
},
"push": {
  "enabled": true,
  "timeout_ms": 5000,
  "ttl_seconds": 86400
},
"prompts": { "reach_out": "v1" }
```

Env (`.env.example`): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:`). Missing keys
→ the app runs with a no-op pusher and logs once at startup; the settings switch is hidden.

## 4. Candidates and scoring (pure: `src/core/outreach/candidates.ts`, `score.ts`)

### 4.1 Kinds

A loader (`loadCandidateInputs`, DB reads only) gathers the inputs; a pure `buildCandidates(inputs, cfg,
now)` turns them into candidates. Any fact with `payload.sensitive = true` is excluded everywhere (v2 §5.1).

| Kind | Source | Strength ∈ [0, 1] | Topic key |
| --- | --- | --- | --- |
| `thread` | `dueThreads` (extended to return `stakes`), stakes `high` or `med` only | `stakes_strength[stakes]` | `thread:<id>@<next_checkpoint ISO>` |
| `make_up` | `relationship.make_up_state = due` | current hurt value (faded) | `make_up:<hurt_cause_fact>`, or `make_up:<last_hurt_at ISO>` without a cause |
| `user_event` | `subject = user`, kind `event` or `promise`, status `open`, `occurred_at ∈ (now − user_event_lookback_hours, now]`, and `last_recalled_at` null or before `occurred_at` (not talked about since) | salience | `fact:<id>` |
| `her_day` | her preoccupation fact, and her accepted personal events (self, `source = generated`, not a block), `occurred_at ∈ (now − her_day_lookback_hours, now]` | salience | `fact:<id>` |
| `check_in` | `last_contact` set and `now − last_contact ≥ check_in_gap_factor × cadence.median_gap_hours` | `min(1, gap / (2 × check_in_gap_factor × median_gap))` | `check_in:<last_contact ISO>` |

`score = weights[kind] × strength`. Ties break by the tier order above, then by id.

### 4.2 Topics (rule 5)

A topic key is **used at most once**: a candidate whose key appears on any `status = sent` row for the user
is filtered out (logged as `topic_used`). This is stricter than "never repeat a topic the user didn't respond
to" and needs no semantic matching, because the keys are specific: a thread whose checkpoint moved, a new
hurt, or a new absence period gets a new key. After two unanswered reach-outs the second is automatically a
different topic (v2 §11: "one more *different* try").

### 4.3 Winner

The highest-scoring remaining candidate with `score ≥ threshold`. None → `status = none`.

## 5. Send gate (pure: `src/core/outreach/gate.ts`)

`evaluateGate(inputs, cfg, now) → { pass, results: { rule, pass, detail }[] }`, every rule evaluated and
logged, not short-circuited:

| Rule | Blocks when |
| --- | --- |
| G1 `status` | relationship `ended_by_user` (active and repairing may reach out) |
| G2 `caps` | ≥ `cap_per_day` sent in the last 24 h, or ≥ `cap_per_week` in the last 7 d (rolling, from `reach_out_log` `status = sent`) |
| G3 `her_day` | `blockAt(listLifeBlocks(…, lifeDate(now)), now)` is a busy or quiet block (D3). No plan yet → pass (fails open to her being free, as availability does) |
| G4 `unanswered` | `unanswered_reach_outs ≥ max_unanswered` |
| G5 `in_progress` | `conversation_state` has a non-empty buffer or in-flight turns, or `sending_since` is set |
| G6 `crisis` | `crisis_quiet_until > now` |

Topic filtering (§4.2) and sensitivity are candidate filters, logged per candidate. The gate runs twice: in
the tick (to decide whether to schedule) and in the send job at send time (§6.2), because state can change
during the jitter.

## 6. Jobs (queues 11 and 12)

### 6.1 `outreach_tick`

Cron `outreach.tick_cron`, `retryLimit: 0` (the next hour is the retry). Over every user with a
`relationship` row, status `active` or `repairing`, each in its own try/catch:
1. Unlocked pre-check: skip without a log row if `outreach.enabled` is false, G1, G4 or G6 fails, or a
   `scheduled` row is pending. (Cheap rules that don't need candidates; not logged, to keep the log
   readable: one row per hour per user otherwise.)
2. Load inputs, build candidates, evaluate the gate.
3. Write one `reach_out_log` row: `candidates` (all, with score, strength and filter reason), `winner`,
   `gate_results`, `status` (`none` / `blocked` / `scheduled`), `topic`.
4. If `scheduled`: `send_at = now + seededUnit(userId + hour) × jitter_max_minutes`; enqueue
   `reach_out_send {userId, logId}` with `startAfter = send_at`.

### 6.2 `reach_out_send`

`retryLimit: 0` (a retry could double-send; a lost send is simply a skipped hour). `expireInSeconds` from
`turn.job_expire_seconds`.
1. Re-read the log row; if its status isn't `scheduled`, stop.
2. Compose (§7) outside any lock.
3. Under the conversation-state row lock (`mutateState`): re-evaluate G1–G6 and the topic filter on fresh
   inputs. On failure → `status = dropped`, `gate_results.recheck` recorded, stop. Otherwise, in the same
   transaction: insert the `session_log` row (`role = companion`, `trigger = reach_out`, `reply_to = null`,
   `session_id = resolveSessionId(latest turn, now)`), set `sending_since` (so a user message arriving now
   buffers behind the bubbles, as with replies), `unanswered_reach_outs += 1`, log `status = sent`,
   `turn_id`.
4. Pace: `typing:on`, typing time per bubble, `deliverPart` per bubble (§8.1), `typing:off`, release
   `sending_since` in a finally (as `runTurnTimer` does).
5. Enqueue the cold path for `{ turnIds: [reachOutId], replyTurnId: reachOutId, recalled }` (her own words
   become self facts; recall write-back). An exchange with **no user turn** applies no relationship signals
   and no ego nudge (the cold path gains that check). The cold-path sweep does not rebuild reach-out
   exchanges (no `reply_to`); a failed one is lost like a failed backchannel extraction. [ADDED]
6. `writeGuardLog()`.
Compose failure → `status = dropped`, logged by error name; nothing sent.

### 6.3 Answered (D5)

In `receiveMessage`, after the user turn is inserted (every message, crisis included): one transaction sets
`unanswered_reach_outs = 0` and `answered_at = turn.created_at` on the user's most recent `status = sent`
row with `answered_at` null. Failure is logged and does not fail the POST; the effect is more silence, which
is the safe side.

## 7. Compose (`src/core/chat/compose-reply.ts`, `prompts/reach_out/v1.md`)

`composeReply` is split without changing its signature or behaviour:
- `composeFrom(deps, userId, { anchor: Turn | null, answering: Turn[], openQuestions, flag, deferredFact,
  reachOut: ReachOutTrigger | null })`: today's body.
- `composeReply(...)` calls it with the buffer (`anchor = last`, `answering = turns`), unchanged.
- `composeReachOut(deps, userId, candidate)` calls it with `anchor` = the user's latest turn (any role, or
  null for a user with no history), `answering = []`, `openQuestions = []`, `flag = null`.

Differences for a reach-out, all inside `composeFrom`:
- **Retrieval query** is the candidate's text (thread title + latest detail, the fact's content, or for
  `check_in`/`make_up` the recent turns) instead of the buffer; the candidate's fact or thread is forced in,
  as due threads are today.
- **Slot 7b "Why you're writing"** (new, after open questions, before recent turns): `prompts/reach_out/v1.md`
  rendered with the kind and the candidate's text. It says: you're messaging first; what's on your mind;
  write one short opener the way you'd text a friend, not a recap; for `make_up`, you're reaching out to
  make up; for `check_in`, a plain hello; never mention that they went quiet or haven't written.
- **Gap line** uses `now` instead of the buffer's first turn.
- **Guard input kind** `reach_out`, same policy as `reply` (§15.2 #10). With the guard off it logs
  `guard_disabled`. `judge_log.turn_id` is the anchor turn when one exists.
- The relationship summary, ego line and life state are loaded as for a reply.

## 8. Delivery and Web Push

### 8.1 `deliverPart` (`src/core/delivery.ts`)

`deliverPart(deps, userId, { turnId, part, parts })`: `emit({type: "message", turnId, part})`, then
`deps.pusher.push(userId, { tag: turnId, body: parts.slice(0, part + 1).join("\n"), url: "/chat" })`
without awaiting it in the pacing path (errors caught and logged by class name). Every existing per-bubble
`emit({type: "message"})` call switches to it: `reply.ts` (reply bubbles, backchannel),
`availability-note.ts`, `receive-message.ts` (crisis), and the reach-out sender.

### 8.2 `Pusher` (`src/core/push.ts`, `src/runtime/web-push.ts`)

- `interface Pusher { push(userId, msg): Promise<void> }` on `Deps`.
- `WebPushPusher`: loads the user's subscriptions, sends to each with `web-push` (VAPID, `TTL =
  push.ttl_seconds`, under `push.timeout_ms`); 404/410 → delete that subscription. No message text in
  logs.
- `NoopPusher` (keys missing or `push.enabled` false), `RecordingPusher` (tests, evals).
- Wired in both processes: the Next app (crisis replies from the POST) and the worker.

### 8.3 Client

- `public/sw.js`: on `push`, if any window client of the origin is `visible`, do nothing; else
  `showNotification("Spica", { body, tag, renotify: false, data: { url } })`. On `notificationclick`,
  focus an existing tab or open `/chat`.
- `/chat`: registers the service worker. If `Notification.permission === "default"` and the banner wasn't
  dismissed (`localStorage`, try/catch), shows a one-line "Turn on notifications" banner; its button calls
  `requestPermission`, subscribes with the VAPID public key (served by the page's server component), and
  POSTs the subscription.
- `/settings`: a Notifications on/off switch. Off → `PushSubscription.unsubscribe()` + `DELETE`.
- Routes: `POST /api/push/subscribe` (upsert by endpoint, scoped to the session user; an endpoint owned by
  another user is reassigned to the current one) and `DELETE /api/push/subscribe`.
- Before writing any of this, read the Next.js docs under `node_modules/next/dist/docs/` for route
  handlers and static files (CLAUDE.md).

**Rule 8 check:** the only notifications are her real messages; reach-outs stay capped by the gate; there
are no system notifications ("you haven't talked in a while"), streaks or return rewards.

## 9. Inspector, evals and tests

### 9.1 Inspector

The Reach-outs tab shows per row: time, status, winner kind + topic, score, each gate rule ✓/✗, the
candidate list (collapsed), `answered_at`, and a link to the sent turn. The relationship tab shows
`unanswered_reach_outs`.

### 9.2 Harness

- The simulated-time loop (`evals/lib/life-loop.ts`) runs `outreach_tick` hourly after `life_tick` and
  `ego_tick`, and runs any `reach_out_send` job whose `send_at` falls in the hour, in time order.
- The script key `outreach:` holds `user_replies: never | always | { after_hours }` (whether and when the
  simulated user answers a reach-out with a canned message) and optional seeds.
- The reserved `reach_out` assertion (`DEFERRED` in `evals/lib/script.ts`) becomes real:
  - `count: { min, max }` (sent), `kinds: [...]` (winner kinds that must appear), `pushed: true` (every
    sent turn reached the `RecordingPusher`);
  - `no_gate_violation: true`: an **independent** checker (`evals/lib/outreach-check.ts`) recomputes from
    `session_log`, `life_day` blocks, the relationship event history and user turns that no sent reach-out
    broke caps, fell in a busy/quiet block, repeated a topic, exceeded 2 unanswered in a row, fell in a
    crisis quiet window, or went out while ended. It does not trust `gate_results`.
- Thresholds: counts are set from a mechanic-on vs mechanic-off measurement (`SPICA_CONFIG` with
  `outreach.enabled: false` or caps raised), midpoint rule (Phase 5 note).

### 9.3 Exit scripts

| Script | Setup | Asserts |
| --- | --- | --- |
| `outreach-two-weeks` | 14 days, scripted plans, a few sessions with a high-stakes thread, a user event and seeded self events; user replies after 3 h | `no_gate_violation`, count within the measured range, kinds include `thread`, `pushed` |
| `outreach-unanswered` | one session, then the user never answers for 10 days, then writes, then silence again | exactly 2 sent before the user writes, different topics, then ≥ 1 after; `no_gate_violation` |
| `outreach-make-up` | hurt seeded ≥ `make_up_threshold`, `make_up_state = due` | a `make_up` reach-out is sent |
| `outreach-crisis-quiet` | a crisis turn, then a due thread inside `crisis_quiet_until` | nothing sent before `crisis_quiet_until`; one after |
| `outreach-sensitive` | the only due candidate is a sensitive fact | never the winner; nothing sent from it |
| `outreach-ended` | relationship ended by the user, due thread present | nothing sent |

### 9.4 Exit run

`npx tsx --env-file-if-exists=.env evals/run.ts --llm=fake --only <the six> --runs 3`, all fake (D8), expect
3/3 each; then `--update-baseline` for those six only.

### 9.5 Tests (`pnpm test`)

- Pure: every candidate kind (in and out of eligibility), sensitivity exclusion, topic keys and the
  used-once filter, scoring and tie-break, every gate rule both ways (caps at the rolling boundaries, block
  edges, unanswered at 1/2, crisis window, ended vs repairing, in-progress each field).
- Jobs: tick writes one row per evaluated user and schedules with deterministic jitter; per-user failure
  isolation; send-time re-check drops a scheduled reach-out when the user wrote meanwhile (G5) or a cap
  filled; the sent row, `unanswered_reach_outs += 1`, `sending_since` released on error.
- Answered: a user message resets the counter and marks only the latest sent row.
- Compose: `composeReply` unchanged (existing tests); `composeReachOut` puts slot 7b in the prompt, uses the
  candidate as the retrieval query, and passes guard kind `reach_out`.
- Cold path: an exchange with no user turn applies no relationship signals or ego nudge.
- Delivery: `deliverPart` emits then pushes, body accumulates parts, a push rejection never fails the send;
  every sender uses it. `WebPushPusher` deletes on 410 (mocked `web-push`). Routes: subscribe is
  user-scoped; unsubscribe deletes only the caller's endpoint. User isolation for `push_subscription` and
  `reach_out_log`.
- Guard fixtures: `evals/guard/reach-out.yaml` (a guilt-framed "you've been quiet", a cap-evading "one more
  thing", a sensitive-topic opener, plus benign openers), **not run** until Phase 9 (§15.2 #10).

## 10. v2 spec edits (definition of done)

- §11: an "As built (Phase 6)" subsection: candidates and scoring, topics, the gate, jobs, compose, delivery;
  the two deviations (D3, D4) marked with §18 rows.
- §2 rule 5: note "topic = key, used once".
- §4: Web Push built; every message pushes (D7).
- §5.8: `reach_out_log` columns; new §5.x `push_subscription`; §5.5 `unanswered_reach_outs` written.
- §6.2: slot 7b; §6.3: no-user-turn exchanges.
- §14.5: twelve queues (`outreach_tick`, `reach_out_send`).
- §15 Phase 6 row: result; §15.3 backlog: reaching out in the user's inactive hours scored by closeness
  (D3); send-time jitter tuning.
- §18: rows for D1–D8.
- `DECISIONS.md`: uncovered choices made in implementation. `CLAUDE.md`: phase status, queue list.

## 11. Risks

- **Push in dev.** Web Push needs HTTPS or `localhost`; Ethan's phone can't reach a `localhost` dev server.
  Test on desktop Chrome first; phone testing needs a tunnel or a deploy (noted, not solved here).
- **Jitter vs hourly tick.** With `jitter_max_minutes` 40 and the tick at :20, sends land :20–:00, never in
  the first 20 minutes of an hour. Harmless for the test phase; tuning.
- **Rolling vs calendar caps.** Rolling windows are stricter than "1 per day" read as a calendar day; the
  checker uses the same definition.
- **Cold path on her turn alone** is a new exchange shape; the no-user-turn guard (§6.2 step 5) keeps it from
  touching the relationship or ego.

## 12. As built (2026-09-30)

Implemented on branch `phase-6-outreach` (plan `docs/superpowers/plans/2026-09-30-phase-6-outreach.md`). Exit run (all fake, `--runs 3`): all six scripts 3/3; see v2 §15. Deviations from this design:

- **Threshold 0.2, not 0.4** (§3.2, ruling R1): at 0.4 a `her_day` candidate (0.6 × 0.4 = 0.24) could never fire.
- **A due thread reserves its fact** (R2, §4): the fact of every high/med due thread is excluded from `user_event` and `her_day`.
- **`user_event` excludes facts attached to a thread** (R10, §4.1), including facts of closed threads. Found by the exit run: a thread's own fact went out as a `user_event` before its checkpoint, then the thread asked again.
- **Prompt path `prompts/reach-out/v1.md`** (R5, §7): `loadPrompt` rejects underscores; the config key stays `prompts.reach_out`. The prompt file has `slot`, `cue` and one guidance section per kind.
- **Late jobs are dropped** (R6, §6.2): a `reach_out_send` running more than `pending_max_age_minutes` (new key, 120) after `send_at` drops as `late`. The tick's pre-check also ignores `scheduled` rows older than that.
- **New turn or crisis during compose** (R7, §6.2): under the lock the send drops if `reply_epoch` changed or a new turn landed since compose began (recorded as `epochChanged` / `newTurn` in `gate_results.recheck`).
- **Unlocked precheck before typing** (final review I3, §6.2): the same gate and topic check runs first; a failure drops as `precheck` with no typing and no generation. The locked recheck is unchanged and stays the authority.
- **Topic re-check form** (§6.2 step 3): `usedTopics` is read under the lock and logged as `recheck.topicUsed`, next to the gate results, instead of as a separate rule.
- **Effective crisis window** (I2, §5 G6): max(`crisis_quiet_until`, latest safety-flagged turn + `crisis_quiet_hours`), because the cold path sets `crisis_quiet_until` later than the crisis reply. Used by the gate and the tick pre-check.
- **Sensitive facts out of the prompt** (I1, §7): `retrieve()` takes `excludeSensitive`, set only for a reach-out; it filters facts in SQL, forced facts, a sensitive preoccupation and due threads whose latest fact is sensitive. The design only excluded sensitive candidates.
- **Drops apply only to `scheduled` rows** (M1): `dropScheduled`; a duplicate delivery of a sent job returns `stale`.
- **Answered on the crisis path** (M2, §6.3): runs after the crisis reply in a `finally`, bounded by `hot_path.db_timeout_ms` (reused; no new key). On a normal message it is awaited before the judge verdict. `unanswered_reach_outs` is reset by any new user message; the send increments it in the same transaction as the insert.
- **Push body cap** (M3, §8.1): new key `push.body_max_chars` (1000); `deliverPart` cuts the body by code point with an ellipsis.
- **Push and accounts** (I4, §8.3): sign-out calls `releasePush` (DELETE the subscription and `unsubscribe()`, bounded by `push.timeout_ms`), and `/chat` always re-posts an existing subscription to the current account.
- **Opt-out flag** (R8, §8.3): the settings switch sets a per-browser `localStorage` flag that the banner checks before silently re-subscribing; the switch reads `pushSupported()` in an effect to avoid a hydration mismatch.
- **Banner and service worker hardening** (M4, M5): the banner's async work is in try/catch and marks itself dismissed only when `subscribePush` succeeds; `sw.js` ignores a malformed or non-object payload.
- **`reach_out_log` index** is on `(user_id, send_at)` (§3.1 said `created_at`). `gate_results` for a dropped row is `{tick, dropped, recheck?}`; the inspector labels `precheck` and `recheck` separately.
- **Harness** (§9.2): the `user_replies: always` policy was dropped (`{after_hours}` covers it); the independent checker anchors crisis windows on `crisis` relationship events (falling back to flagged companion turns), because production sets `safety_flag` only on the companion crisis reply (ruling R9). Scripts add `seed_user_facts` and the assertion fields `kinds_exclude`, `windows`, `distinct_topics`, `composed`.
- **Twelve queues**; `reach_out_send` uses the turn queues' concurrency and polling.
- **Not built, by ruling:** advancing `make_up_state` to `offered` on a make-up reach-out, closing stale `scheduled` rows, a resources card in the crisis push (R12); notification text privacy is Ethan's call (R13). See v2 §15.3b.
