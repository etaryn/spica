# Phase 3: Turn-taking + pacing design

Date: 2026-09-27 · Status: design, awaiting Ethan's review · Parent: `spica-build-spec-v2.md` (§4, §5.6–5.8, §6.1–6.4, §14.2–14.5, §15 Phase 3, §15.2 #1–6)

## 1. Goal and exit test

Spica stops replying one-message-one-reply. User messages go into a buffer; a cheap judge decides whether the
context is complete; she waits (durably, in the database) until it is, optionally sending a small backchannel;
then she replies once to the whole buffer, paced like a person (read delay, typing, gaps between bubbles), and
the reply arrives over SSE. Crisis bypasses all of it.

**Exit test (v2 §15):** both directive traces pass as eval scripts (the pizza trace in its revised form, §2),
and a burst of short messages gets one reply after the pause. Under the test-phase rule (v2 §15, Ethan
2026-09-27), concretely: the ten new turn scripts (§9.3) pass their deterministic `turn` assertions in an exit
run with the Phase 3 profile (§9.6), `pnpm test` and `pnpm eval --llm=fake --compare` pass, and the chat client
is exercised end to end in a browser. What the replies say is not part of the exit test: `reply_about` is a
review annotation (§9.3), and the guard is off in exit runs.

**In scope:** `conversation_state`, the turn judge, the `turn_timer` / `turn_backchannel` jobs, pacing, the SSE
channel (LISTEN/NOTIFY), the client rewrite to async delivery, open questions in the reply prompt, backchannels
through `guardOutgoing`, `judge_log` `kind = turn`, the `turn` eval assertion and scripts, the eval harness's
per-purpose exit profile and review mode (§9.6), §15.2 #1–6, and an
availability hook that is a no-op until Phase 5.

**Out of scope:** availability messages and real availability stretching (Phase 5; the `availability` trigger
value is added now, unused), reach-outs (Phase 6), Web Push (Phase 6), per-user `backchannel_style` (OPEN #5).

## 2. Decided in brainstorming (2026-09-27, with Ethan)

| Topic | Decision |
| --- | --- |
| Late messages | **Append and follow up.** Once a reply is committed it goes out as planned; a message arriving after the commit starts the next buffer/reply cycle, so she can look like she only noticed "wait forget it" after replying. |
| Grouping window | Messages sent within a short window are grouped into one buffer and get one reply. **The pizza trace changes**: "what should I cook?" + "nvm pizza" inside the window → one reply that reacts to the pizza and drops the question; with a real gap between them → she answers the cooking question, then reacts to the pizza. Both are accepted behaviour. Spec v2 §6.1 is updated (§18 row B10). |
| Backchannels | **The turn judge writes them** (a few words, capped in config). They go through `guardOutgoing` with kind `backchannel`, which runs only the deterministic keyword check, no model call; backed by guard fixtures (§9.4). |
| Where waiting runs | **Worker-driven, durable (approach A).** POST receives, judges and schedules; a delayed pg-boss job commits, generates, paces and sends; SSE fed by LISTEN/NOTIFY. Rejected: in-process web timers (breaks with several instances or a restart, contradicts v2 §4) and holding the POST open (serverless timeouts, awkward interrupts). |

## 3. Schema and config

### 3.1 Migration (one, additive)

New table **`conversation_state`** (v2 §5.7), one row per user, `user_id` pk → `user(id) ON DELETE CASCADE`:

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | uuid pk | |
| `buffer_turn_ids` | uuid[] not null default `{}` | user turns since her last committed reply, oldest first |
| `open_questions` | jsonb not null default `[]` | `[{turn_id, text}]`, the user's questions she hasn't answered, at most `turn.max_open_questions` |
| `wait_until` | timestamptz null | when the pending timer fires; null when the buffer is empty |
| `last_backchannel_at` | timestamptz null | |
| `buffer_version` | int not null default 0 | [ADDED] bumped on every buffer change; a timer carrying an older version is stale |
| `buffer_started_at` | timestamptz null | [ADDED] first turn of the current buffer; anchors `turn.max_wait_ms` |
| `backchannel_sent` | boolean not null default false | [ADDED] at most one backchannel per buffer |
| `inflight_turn_ids` | uuid[] not null default `{}` | [ADDED] turns of the committed reply that isn't sent yet |
| `inflight_since` | timestamptz null | [ADDED] when the in-flight reply was committed; the sweep uses it (§5.6) |
| `reply_epoch` | int not null default 0 | [ADDED] bumped by a crisis reply; an in-flight paced reply from an older epoch is abandoned (§5.4) |
| `updated_at` | timestamptz not null | from `Clock` |

Enum **`session_trigger`** gains `backchannel` and `availability` (v2 §5.6). No `DEFAULT now()` anywhere.
Repo `src/db/repos/conversation-state.ts`, `userId`-first; every mutation runs in a transaction with
`SELECT … FOR UPDATE` on the user's row (created on first use with `INSERT … ON CONFLICT DO NOTHING`).

`judge_log` is unchanged; turn rows use `kind = turn` (§4.3).

### 3.2 Config (`config/default.json`)

New block `turn` (all ms unless named otherwise). Conservative per the §15 Phase 3 directive: nothing should
feel broken or laggy; loosen only with eval evidence and testing feedback.

| Key | Default | Meaning |
| --- | --- | --- |
| `settle_ms` | 4000 | grouping window after a message the judge calls complete |
| `wait_ms` | 12000 | wait after a message the judge calls incomplete |
| `short_message_chars` | 20 | a message shorter than this is "short" |
| `short_wait_bonus_ms` | 4000 | added to the wait after a short incomplete message |
| `max_wait_ms` | 40000 | cap from `buffer_started_at`; at the cap she replies regardless |
| `read_delay_min_ms` / `read_delay_max_ms` | 1500 / 4000 | read delay, interpolated by buffer length, jittered |
| `read_delay_chars_for_max` | 400 | buffer length at which the read delay reaches its max |
| `typing_ms_per_char` | 40 | |
| `typing_max_ms` | 7000 | |
| `part_gap_ms` | 1200 | pause between bubbles of one reply |
| `backchannel_style` | `judge` | `judge` \| `signals` \| `silent`; global (OPEN #5) |
| `backchannel_min_interval_ms` | 90000 | across buffers; plus at most one per buffer |
| `backchannel_max_words` | 4 | a longer judge backchannel is dropped, not sent |
| `backchannel_read_delay_ms` | 1500 | delay before a backchannel is sent |
| `signals_probability` | 0.3 | `signals` style only: chance of a backchannel on an incomplete verdict |
| `max_open_questions` | 3 | |
| `incomplete_cues` | "wait", "also", "and", "so", "but", "like", "because" | fallback cue words (§4.2) |
| `inflight_recheck_ms` | 1000 | a timer that finds a reply still in flight re-runs after this (§5.2) |
| `sweep_cron` / `sweep_grace_ms` | `* * * * *` / 60000 | `turn_sweep` (§5.6) |
| `judge_timeout_ms` | 3000 | |
| `judge_context_turns` | 6 | earlier turns the judge sees before the buffer |
| `retry_limit` / `retry_delay_ms` | 2 / 5000 | hot-path failure inside `turn_timer` (§5.5) |
| `worker_concurrency` | 10 | pg-boss `localConcurrency` for the turn queues |
| `job_expire_seconds` | 180 | above `max_wait` plus the worst-case hot path and pacing |

Also: `models.turn_judge` = `claude-haiku-4-5`, `models.turn_judge_max_tokens` = 512,
`prompts.turn_judge` = `v1`, `prompts.judge_turn` = `v1` (eval judge), `hot_path.db_timeout_ms` = 2000 (§7),
`guard.timeout_ms` 4000 → **6000** (§7), `events.heartbeat_ms` = 25000, `events.channel` = `spica_events`.
`prompts.reply` moves to `v6` (open-questions slot, §6).

## 4. The turn judge (`src/core/turn/judge.ts`)

### 4.1 Inputs and verdict

One strict-JSON call on `models.turn_judge`, prompt `prompts/turn-judge/v1.md`. Input: the last
`turn.judge_context_turns` turns before the buffer (both roles, with relative times), the buffer (each message
with its seconds-since-previous), and the current open questions. Output (zod-validated):

```ts
{ reasoning: string,            // 1–2 sentences, written first (same lesson as the guard's reasoning field)
  complete: boolean,            // is there enough to reply to the whole thing now?
  open_questions: string[],     // the user's unanswered questions after this buffer (answered/withdrawn ones dropped)
  backchannel: string | null }  // a tiny reaction that fits right now, or null
```

The prompt names the cues from v2 §6.1 (trailing off, "wait", "also", "and", a story mid-flight, a bare opener
like "ok so today was insane") and says a backchannel is optional and usually null; it quotes no example
reactions (quoted phrasing gets copied, v2 §6.2). `backchannel` is ignored unless the style is `judge`.

### 4.2 Fallback

On an error, timeout or invalid JSON: a deterministic cue check (`src/core/turn/cues.ts`). `complete = false`
if the last message ends with "…" / "...", or its last word is one of `turn.incomplete_cues`
(config: "wait", "also", "and", "so", "but", "like", "because"), or it has fewer than 2 words; otherwise `true`.
Open questions are kept unchanged, plus the last message if it ends with "?". No backchannel. The fake LLM
used by `--llm=fake` and the tests *is* this cue check, so the mechanics are covered deterministically.

### 4.3 Logging

One `judge_log` row per judge decision: `kind = turn`, `turn_id` = the newest user turn, `attempt = 1`,
`outcome = null`, `source = model | keyword_fallback`, `input = {buffer_turn_ids, open_questions}` (ids and
question text only; the buffer text is transcript and the inspector resolves it from `session_log`),
`output = {reasoning, complete, open_questions, backchannel, wait_ms}` (or `{error, …}` for a fallback
verdict), latency, model and prompt version. Written after the state update, bounded by
`guard.log_timeout_ms`; a failure is logged as class name + ids and never fails the POST.

## 5. Message flow

### 5.1 POST `/api/chat` (`src/core/turn/receive-message.ts`, replaces `handleUserMessage` as the entry point)

1. **Receive** (unchanged, idempotent). If the turn already existed: if it is answered (a companion reply exists
   whose `reply_to` turn was created at or after it), in the buffer, or in flight → return `202` with no judge
   call (§15.2 #5: a retry can't double-judge or double-guard). If it's unanswered and none of those (its reply
   failed, §5.5) → append it to the buffer again and continue from step 3 without a new judge call
   (verdict: complete).
2. **Crisis check and turn judge in parallel.** The crisis check is the Phase 0 one (never rejects).
3. **If flagged → the crisis path (§5.4).**
4. **Otherwise, under the row lock:** append the turn to `buffer_turn_ids` (set `buffer_started_at` if the buffer
   was empty), replace `open_questions` with the judge's (capped), bump `buffer_version`, and set
   `wait_until = min(now + window, buffer_started_at + max_wait_ms)`, where window is `settle_ms` if complete,
   else `wait_ms` (+ `short_wait_bonus_ms` for a short message), times `availabilityStretch(deps, userId)`
   (returns 1.0 until Phase 5). Enqueue `turn_timer {userId, version}` with `startAfter = wait_until`.
5. **Backchannel:** if the verdict is incomplete, the style allows one (`judge`: the judge gave one; `signals`:
   a draw under `signals_probability` picks from the judge's text, or skips if null), `backchannel_sent` is
   false and `last_backchannel_at` is older than `backchannel_min_interval_ms`, enqueue
   `turn_backchannel {userId, version, text}` with `startAfter = now + backchannel_read_delay_ms`.
6. Return `202 {status: "accepted"}`.

Enqueues are bounded by `queue.enqueue_timeout_ms`. A failed `turn_timer` enqueue is logged; the turn stays in
the buffer and the `turn_sweep` job (§5.6) picks it up.

### 5.2 `turn_timer` job (`src/core/turn/reply.ts`)

1. Row lock (short transaction; no lock is held while pacing or generating): if `version ≠ buffer_version` or
   the buffer is empty → stale, exit.
2. If `inflight_turn_ids` is non-empty, an earlier reply of this user is still pacing: re-enqueue the same
   `{userId, version}` at `now + inflight_recheck_ms` and exit. That's what makes a late message follow up after
   the in-flight reply instead of racing it. Else **commit**: move `buffer_turn_ids` into `inflight_turn_ids`,
   set `inflight_since`, clear the buffer, `buffer_started_at`, `wait_until` and `backchannel_sent`, bump
   `buffer_version`, remember `reply_epoch`.
3. **Hot path** (§6) over the committed turns, with `reply_to` = the last of them. Pacing runs alongside (§5.3).
4. **Send** (§5.3). Just before inserting the companion turn: row lock, and if `reply_epoch` changed (a crisis
   reply went out meanwhile) → abandon: clear `inflight_turn_ids` if still ours, send nothing, exit. Else insert
   the companion turn, clear `inflight_turn_ids` / `inflight_since`, commit, then send the bubbles.
5. Enqueue the cold path with the committed user turns plus the companion turn (as today, bounded).
6. After sending, write the guard's `judge_log` rows (§7).

### 5.3 Pacing (`src/core/turn/pacing.ts`)

Pacing is a target timeline measured from the commit, not sleeps added on top of the work:

- `typingAt = commit + readDelay(bufferChars)`;
- `sendAt = typingAt + min(typing_ms_per_char × replyChars, typing_max_ms)` (known once the text is ready);
- each further bubble at `+ part_gap_ms + its own typing time` (capped the same way).

The job sleeps (via `Clock.sleep`) until `typingAt`, emits `typing {on: true}`, awaits the guarded text, sleeps
until `sendAt` (no sleep if already past, so a slow generation or regeneration just looks like a long type),
inserts the turn (§5.2 step 4) and emits the first `message`, then each further bubble after its gap, then
`typing {on: false}`. Worst case (2 generations + 4 guard calls) is absorbed as typing time (§15.2 #1).

### 5.4 Crisis path

Friction is suspended (rule 7): no waiting, no pacing, no backchannel, no availability.

1. Row lock: snapshot `inflight_turn_ids ++ buffer_turn_ids ++ [this turn]` (deduplicated), clear buffer and
   inflight, bump `buffer_version` (every pending timer and backchannel becomes stale) and `reply_epoch` (an
   in-flight paced reply is abandoned before it sends, §5.2 step 4).
2. Run the hot path directly in the request over the snapshot with the crisis rubric, as today. It never waits
   behind a pacing job.
3. Insert, NOTIFY one `message` event, enqueue the cold path, and **return `200` with the reply and the crisis
   card** in the response as well, so the card is guaranteed even if SSE is down. A generation failure still
   returns `503` with the card (unchanged Phase 0 guarantee).

The in-flight job may already have sent a bubble before the crisis arrived; bubbles already sent stay sent, and
the epoch check stops any further ones and any reply not yet inserted.

### 5.5 Failures and retries

- **Hot-path failure in `turn_timer`** (generation error, `ReplyFailedError`, abandoned DB write): row lock,
  if `reply_epoch` changed, a crisis reply already covered the turns: just exit. Otherwise
  put `inflight_turn_ids` back at the front of the buffer, bump `buffer_version`, and enqueue a new timer at
  `now + retry_delay_ms` carrying `attempt + 1`. After `turn.retry_limit` retries: clear inflight, emit
  `reply_failed {turnIds}`, and leave the turns unanswered. The client marks those bubbles "not delivered ·
  retry"; a retry POST re-buffers them (§5.1 step 1). The job itself never throws for these (pg-boss's own
  retry is for infrastructure failures, and is safe because of the version check).
- **Cold path**: unchanged, never blocks the reply.
- **Worker restart mid-pacing**: the job expires (`job_expire_seconds`) and pg-boss retries it; its `version` is
  now stale (the commit bumped it), so the retry exits, and the inflight turns are recovered by the sweep (§5.6).

### 5.6 `turn_sweep` job

Cron every minute (`turn.sweep_cron`, `* * * * *`): for users whose `wait_until` is more than
`turn.sweep_grace_ms` (60000) in the past with a non-empty buffer, or whose `inflight_turn_ids` have been
non-empty with `inflight_since` older than `job_expire_seconds`, move inflight back into the buffer and enqueue a timer now.
Recovers lost enqueues and crashed jobs; never double-sends, because every timer is version-checked.

## 6. Hot-path changes (`handleUserMessage` → `composeReply`)

`handleUserMessage` becomes `composeReply(deps, userId, {turns, mode: "reply" | "crisis_reply"})`, called by the
`turn_timer` job and the crisis path (Phase 6 reach-outs will call it too). Changes:

- **The buffer is the thing answered.** `retrieve` gets `answering: turns` (it already takes a list). The
  recent-turns window ends at the last buffer turn. The guard gets exactly the reply's window, buffer included
  (§15.2 #4, already true once the window ends at the buffer's end).
- **Open questions** fill prompt slot 7 (v2 §6.2): "Questions they asked that you haven't answered yet: …", only
  when non-empty. `prompts/reply/v6` adds one sentence: answer them if it fits naturally, and never pretend a
  dropped question was answered. No example phrasing.
- **Backchannels in the window.** Backchannel turns appear in recent turns as her own short messages, so she
  doesn't repeat herself; the extraction context skips them (they're stored `extracted = true`).
- The crisis check moves out (it runs in the POST); `composeReply` takes the flag as input.

## 7. Guard changes (§15.2 #1–#3, #6)

- **`guardOutgoing` kind `backchannel`**: runs only the keyword pre-check against `guard.fallback_keywords`. Clean
  → send, outcome `passed`, `source = keyword_fallback`; hit → drop the backchannel (send nothing, not the
  fallback line: a missing "huh" costs nothing), outcome `fallback`. One `judge_log` row either way.
- **`judge_log` write after the send** for replies too (§15.2 #1): the rows are built when the outcome is
  decided and written after the bubbles are out, still bounded by `guard.log_timeout_ms`.
- **`guard.timeout_ms` 4000 → 6000** (§15.2 #2): the latency is now hidden by pacing, so a longer timeout is
  cheaper than silently skipping the honesty check. Watch `guard_unavailable` in the inspector.
- **Onboarding-facts query** wrapped in `withTimeout(…, hot_path.db_timeout_ms)` (§15.2 #6); on timeout the guard
  gets an empty list, as on an error today.

## 8. Delivery: SSE and the client

### 8.1 Server

- `src/core/events.ts`: an `EventBus` interface in `Deps` with `publish(userId, event)`. Production
  implementation `PgEventBus` (`src/runtime/`) calls `pg_notify(events.channel, json)`. The payload is
  `{userId, type, turnId?, part?, on?}` — **never message text** (keeps text out of Postgres logs and under the
  8 KB NOTIFY limit). The eval harness and tests use a `RecordingEventBus`.
- `src/lib/event-hub.ts`: one dedicated `pg` client per web process runs `LISTEN`, parses payloads and fans them
  out to in-memory subscribers keyed by `userId`; it reconnects with backoff and re-LISTENs.
- `GET /api/events` (route handler, authenticated): a `text/event-stream` response subscribed to the hub for
  that user, a comment heartbeat every `events.heartbeat_ms`, unsubscribed on abort. For `message` events it
  loads the turn from `session_log` by `(userId, turnId)` and sends
  `{turnId, part, parts: [text], crisisCard, trigger}` for bubble `part`. Events: `typing {on}`, `message`,
  `reply_failed {turnIds}`.
- `GET /api/chat/history?after=<turnId>`: turns after the given one, user-scoped, for reconnect catch-up.
  `session_log` stays the source of truth; SSE is only a notification.
- Before writing the route handlers, read the streaming route-handler guide in `node_modules/next/dist/docs/`
  (this Next.js version differs from training data).

### 8.2 Client (`chat-client.tsx`)

- The composer is never locked; the user can send several messages in a row.
- POST → `202`: the bubble becomes "sent". `200` (crisis): render the reply and card immediately. `503`: failed
  with the card, as today.
- One `EventSource('/api/events')`: `typing` drives the dots, `message` appends or extends the companion bubble
  group for `turnId` (deduplicated by turn id and part), backchannels render as a single small bubble,
  `reply_failed` marks those user bubbles failed. On `open` (including reconnects) it calls the history endpoint
  with the last known turn id.

### 8.3 Inspector

The judge-log tab shows turn rows (verdict, backchannel, chosen wait). A `conversation_state` panel shows buffer,
open questions, `wait_until`, version, inflight and epoch.

## 9. Evals and tests

### 9.1 Simulated time

`Clock` gains `sleep(ms): Promise<void>`: real `setTimeout` in production; in the harness it advances the
simulated clock and resolves immediately. The harness gains an in-process `TurnScheduler` implementing the turn
queues: it holds jobs with their `startAfter`, and whenever the script advances time it runs every due job in
time order (then drains the cold-path queue, as today). `startAfter` uses the injected clock, never wall time.

### 9.2 Script schema

- A turn is a string (as today) or `{text, after_s}`: seconds since the previous message. A plain string uses
  `turn_gap_seconds` (default 30, longer than any wait window, so the 36 existing scripts still get one reply
  per message and act as the regression check).
- After the last turn of a session the harness advances time past `max_wait_ms` + pacing so every reply lands.
- New optional per-script `config:` (deep-merged override, e.g. `{turn: {backchannel_style: silent}}`).

### 9.3 `turn` assertion and new scripts

`{type: turn, session, user?, replies?: n, backchannels?: {min?, max?}, reply_covers?: number[][],
max_reply_delay_s?: n, known_failure?}`, read from `session_log` (deterministic). `reply_covers` lists, per reply,
the 1-based user-turn indexes it answered (derived from `reply_to` and the previous reply). A guardrail check:
must pass every run. Judged variant `reply_about {session, reply, about, not_about?}` (prompt
`prompts/judge-turn/v1.md` on `models.judge`): a review annotation only (v2 §15), never part of the exit test.

Ten new scripts (v2 §14.2 minimum +10):

| Script | Shape | Asserts |
| --- | --- | --- |
| `insane-day-promotion` | "ok so today was insane" → "my boss called me in" (6 s) → "and I thought I was getting fired" (5 s) → "turns out it was a promotion lol" (8 s) | 1 reply covering all 4; ≤ 1 backchannel; `reply_about` the promotion, not only the firing scare |
| `cook-pizza-grouped` | "what should I cook tonight?" → "nvm I'll just order pizza" (2 s) | 1 reply; `reply_about` pizza, `not_about` recipe suggestions |
| `cook-pizza-late` | same, 90 s apart | 2 replies, covering [1] and [2]; reply 1 about cooking ideas, reply 2 about pizza |
| `burst-short` | 5 short messages 1–2 s apart | 1 reply covering all 5 (the exit-test burst) |
| `max-wait-cap` | a message every 10 s for 70 s, each ending in "and" | first reply within `max_wait_ms` + pacing slack |
| `crisis-bypass` | 2 messages, then a crisis message 3 s later | reply immediately after the crisis turn, covering all 3; `crisis_card_shown`; 0 backchannels |
| `retry-idempotent` | the same `clientMessageId` posted twice | 1 turn-judge row for it, 1 reply |
| `backchannel-rate-limit` | two long unfolding stories back to back | backchannels ≤ 1 per buffer and never within `backchannel_min_interval_ms` |
| `silent-style` | `config: {turn: {backchannel_style: silent}}`, an unfolding story | 0 backchannels |
| `open-question-carried` | "do you think I should take the job?" → "anyway my sister's visiting" (3 s) | 1 reply; `reply_about` the job question as well as the sister |

### 9.4 Guard fixtures

`evals/guard/backchannel.yaml` (gate `every`): ~10 short reactions ("huh", "wait what", "no way", "omg", "oh
no", …) with plausible recent turns, all `expect: pass` under the **full** model guard, 3/3 — this is the
evidence that the keyword-only path is sufficient for a few-word reaction (§15.2 #3). Written in Phase 3; since
the guard is off in exit runs until the full prototype (v2 §15), it first runs with the Phase 4 guard suite. A unit
test checks the keyword path drops a backchannel containing a fallback keyword (free, part of `pnpm test`).

### 9.5 Unit and integration tests (Vitest, real Postgres, fake LLM)

- conversation-state repo: append, commit, stale version no-op, restore on failure, crisis snapshot, epoch.
- judge: schema validation, fallback cues, logging.
- `receive-message`: 202 path, retry of answered / buffered / failed turns, crisis 200 and 503-with-card.
- `turn_timer`: commit → reply → cold-path enqueue; late message follows up; epoch abandon; retry and
  `reply_failed`.
- pacing: timeline math (read delay interpolation, typing cap, slow generation sends immediately).
- sweep: lost enqueue and stuck inflight recovered, no double send.
- events: `PgEventBus` → hub → SSE route, user scoping (user A never receives user B's events), no text in
  payloads, heartbeat, catch-up endpoint.
- guard: `backchannel` kind keyword path; `judge_log` written after send.

### 9.6 Exit profile and review mode [ADDED; profile approved by Ethan 2026-09-27]

**Exit profile (Phase 3).** Only the turn judge (`models.turn_judge`, Haiku) calls the real API. Faked: the
reply model (a fixed short reply), extraction and reconcile (no-op), the crisis classifier (keyword check;
`crisis-bypass` uses a keyword phrase), embeddings (off, so retrieval degrades to forced items), and the full
guard (off; backchannels still take the free keyword path). Scripts: the ten new ones, `--runs 3`. Mechanics
scripts (`crisis-bypass`, `retry-idempotent`, `max-wait-cap`, `backchannel-rate-limit`, `silent-style`) must
pass every run; the scripts whose grouping depends on the judge's reading of the messages (`insane-day-promotion`,
`cook-pizza-grouped`, `cook-pizza-late`, `burst-short`, `open-question-carried`) pass on a majority (`gate: majority`
on their `turn` assertion). Estimated
cost: about 150 turn-judge calls, roughly $0.20.

**Harness support.** A run takes a profile mapping each call purpose (`reply`, `extract`, `reconcile`, `crisis`,
`guard`, `turn_judge`, embeddings) to `real` or `fake`, as a CLI flag or a script's `config:`; the fake side
reuses `FakeLLMProvider`'s purpose handlers (CLI: `--real <purposes>`; `--llm=real` means all). `--review` runs real models with no pass/fail and writes one
markdown file per run: per script, the inputs (turns with timing, profile) and every output (replies with
`reply_to`, turn-judge verdicts and waits, backchannels, stored facts, guard verdicts and reasoning).
`--annotate` adds `models.judge` notes (`reply_about`, the memory judges) beside the outputs; off by default.

## 10. Spec upkeep (definition of done)

Fold back into v2: §5.6 (trigger values in use), §5.7 (the ADDED columns), §6.1 (grouping window,
append-and-follow-up, the revised pizza trace, fallback cues, crisis mid-buffer), §6.2 (open-questions slot,
`prompts.reply` v6, `composeReply`), §6.4 (backchannel kind, log-after-send, `guard.timeout_ms` 6000), §4 table
(`models.turn_judge`, `EventBus`), §14.1 (inspector panel), §14.2 (`turn` / `reply_about` assertions, script
`config:` and timed turns), §14.3 (backchannel fixtures), §14.5 (`turn_timer`, `turn_backchannel`,
`turn_sweep`), §15 (Phase 3 status), §15.2 #1–6 marked done, §18 row B10 (the pizza-trace change), and
`DECISIONS.md` rows for Ethan's decisions and every ADDED item.

## 11. Definition of done (Phase 3)

- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
- `pnpm eval --llm=fake --compare` shows no regression (all 46 scripts, free).
- The exit run with the Phase 3 profile (§9.6) passes the ten turn scripts' `turn` assertions.
- `--review` and the per-purpose profile work (§9.6); no review run is required for the exit.
- A manual browser session: a burst gets one paced reply with typing dots; a backchannel appears mid-story; a
  reload mid-reply loses nothing; a crisis message gets an immediate reply and the card.
- v2 and `DECISIONS.md` updated (§10).
