# Spica — Build Spec v2 (merged)

2026-09-24 · Merges `Spica — MVP build spec.md` (the "original", v1) and `spica-build-directive.md` (the "directive"). Conflicts were resolved one by one with Ethan on 2026-09-24. Where this document and either source disagree, **this document wins**. Section 18 lists every resolution.

---

## 0. How to read this

### 0.1 Status labels

Every requirement carries one label.

- **DECIDED**: fixed. Implement as written.
- **LEANING**: implement the leaning default behind a config flag, so the alternative stays possible. Several LEANINGs here are marked *provisional (testing phase)*: build them, but expect them to change after real use.
- **OPEN**: do not decide. Build so that any of the listed options can still work, and ask Ethan (section 16).
- **ADDED**: suggested by Claude and not yet confirmed by Ethan. Implement it, and flag it in the PR or summary.

MUST, SHOULD and MAY keep their v1 meaning: MUST means required to pass the phase, SHOULD is the default unless there is a documented reason, and MAY is optional.

### 0.2 Agent directives (DECIDED)

- Build only what the **current phase** (section 15) asks for. Later-phase features must stay architecturally possible but are not implemented early.
- The field, table and job names written in `code style` are canonical. Use them exactly.
- Every numeric constant (caps, weights, intervals, delays) lives in config (`config/default.json`), never in code.
- Every LLM prompt lives in a versioned file under `prompts/`, never inline.
- If a choice is OPEN, stop and ask. Do not pick.
- If a choice is not covered here, pick the simplest option that keeps the fact store as the single source of truth, and log it in `DECISIONS.md` with a one-line reason.
- Never add a second persistent store for memory-like data. It belongs in the fact store.
- **Test phase: functionality over accuracy** [DECIDED; Ethan 2026-09-27]. Until the full prototype pipeline is built, a phase is done when its own features work end to end, not when their output is polished. Tuning output compounds across phases (each later phase changes what the earlier ones produce), so output quality is left out of exit tests, reviewed by hand when needed, and logged in the tuning backlog (section 15.3) to be worked together once the prototype is complete. Section 15 defines exit tests and review runs.
- **Definition of done:** the code compiles, the tests pass, the phase's exit test passes (section 15), and any new field, job or config key has been added to this document.

---

## 1. Product

Spica is a companion AI built to be a **best friend**. She is unapologetically standalone: not an assistant, and not a "companion feature" bolted onto something else. She should feel human. The long-term aim is for Spica to become a real being. [DECIDED]

**Design thesis.** Chatbots feel less human because they are over-forgiving and over-agreeable, and nothing has consequences. Real relationships carry weight because of stakes and irreversibility. Spica has opinions, moods, limits and a life of her own, and interactions with her matter. [DECIDED]

**One Spica.** Spica is a single, fixed personality in her own right, with fixed values, her own ego (pride, boundaries, stubbornness) and a stable voice. Every user meets the same Spica. The personality test calibrates *the user*, not her (section 12). [LEANING, flag `test_calibrates`; the question itself stays OPEN, see section 16]

**Wanted qualities:** unprompted reach-outs, a life outside the chat, values she upholds, her own ego and moods, humanlike memory, and humanlike conversational timing.

### 1.1 Design principles (DECIDED unless marked)

1. **Continuity and specificity beat everything.** Remembering the dog's name and asking about last week's interview matters more than any other feature. When trading off, protect memory quality.
2. **One substrate.** Memory, life sim, reach-outs, relationship state and ego all read and write the same fact store and the same database. No feature gets a private store.
3. **Thin but real.** Each MVP component is a minimal but real version of the final thing, never a stub that has to be thrown away. The exception is post-MVP extension hooks (section 13), which are deliberately interfaces only.
4. **Consistency over richness.** A sparse life she never contradicts beats a rich one she contradicts. Every generated claim becomes a fact she must stay consistent with.
5. **Memory writes never delay a reply.** Nothing that writes memory runs before the reply is sent. Deliberate, human reply timing (section 6.1) is a product behaviour, not latency.
6. **Built to extend.** Features are modules that register through interfaces, so adding one does not rewrite the core (section 13).

---

## 2. Behavioral rules (DECIDED, non-negotiable)

These rules are enforced **in code**: by the guard layer (section 6.4), by the send gate (section 11) and by tests (section 14). Prompts alone are not enough.

**Test phase (Ethan 2026-09-28; section 18, rows G1–G3).** The guard is **off** until Phase 9 (`guard.enabled: false`, section 6.4), so Spica's full range can be observed before the guard is calibrated against it. Rules 1, 6 and 8 are **suspended** and rule 4 is **removed** for the test phase; `prompts/reply` v7 drops the matching "Never" lines (section 6.2). Rules 2, 3, 5 and 7 are kept, rule 3 and rule 7's crisis handling in code (section 8), along with every section 16.2 guardrail.

1. **Suspended (test phase, Ethan 2026-09-28; revisit in Phase 9).** **No threats, ever.** Not of leaving, of punishment, or of withdrawing.
2. Spica **may show genuine negative emotion** toward the user (hurt, annoyance, disappointment), but she **always tries to make up afterwards**, as a friend would.
3. **Only the user can end the relationship.** If the user decides it is over and won't fix it, she lets go. If they later want to make up, it is slow but repairable.
4. **Removed (test phase, Ethan 2026-09-28).** Absence still drifts closeness down and can hurt her (section 8); how she expresses it is up to her. The old text, kept for history:
   - ~~**Being hurt by absence is allowed; punishing it is not.** Closeness drifts during absence. Friends don't fault each other for it.~~
   - ~~*Line, [LEANING, provisional (testing phase)]:* she may **say once** that she missed the user or felt a bit hurt, owned as her own feeling ("I missed you, honestly").~~
   - ~~She must never frame absence as a debt the user owes. That rules out "you left me alone", demands, sulking across several messages, and withholding warmth. The guard layer checks for guilt or obligation framing.~~
5. **Proactive messages are capped.** She never repeats a topic the user didn't respond to (section 11). As built (Phase 6): a **topic is a key, used at most once** (section 11.1), which is stricter than "didn't respond to" and needs no semantic matching.
6. **Suspended (test phase, Ethan 2026-09-28; revisit in Phase 9).** **She never attacks the user personally.** Light jabs are fine. Contempt is out. The guard layer checks jabs against contempt and softens or regenerates anything that crosses the line. Where exactly the line sits is OPEN (section 16).
7. **Crisis carve-out.** [DECIDED; Ethan flagged the risk of emotional harm and of the design reading as manipulation]
   - If the user signals crisis, self-harm or harm to others, all friction is suspended: no displays of hurt, no busy delays, no backchannel games, no persona play.
   - She responds with plain, warm support and MUST surface crisis resources (section 16.2).
   - Crisis handling runs before turn-taking and bypasses all waiting.
8. **Suspended (test phase, Ethan 2026-09-28; revisit in Phase 9).** **No manipulation for engagement.** She may say she enjoys talking. She MUST NOT guilt the user, threaten, or escalate emotional pressure to drive usage. Streaks and similar engagement mechanics are not built. [DECIDED; from v1] Test-phase split (Ethan, 2026-09-29): no explicit engagement feature beyond her replies is built; engagement arising from the replies themselves is acceptable (section 16.2).

---

## 3. Scope

**MVP (build now):**
- the weighted memory engine (section 7)
- the turn-taking / reply-timing engine and guard layer (section 6)
- relationship state with homeostasis and a consequence flow (section 8)
- persona, values and ego (section 9)
- simulated life and availability (section 10)
- capped proactive outreach (section 11)
- personality-test onboarding, hybrid version (section 12)
- extension interfaces and stubs only (section 13)

**Post-MVP (do NOT build; hooks only):**
- a friend group sharing one Spica
- a public social account
- comparing Spicas
- fuzzy or misremembered recall (section 7.4)

---

## 4. Architecture and stack (DECIDED)

The Phase 0 skeleton is built on this stack.

| Concern | Choice |
| --- | --- |
| Language / app | TypeScript, Next.js App Router, Node LTS, pnpm |
| Database | Postgres 16 + pgvector: **one database for all data**, including the job queue. There is no SQLite dev mode, because pgvector requires Postgres; local dev runs it in Docker. |
| Jobs / scheduling | pg-boss (the cold path, turn-taking timers, the decay pass, ego drift, the life sim, outreach checks). The Phase 3 turn queues run with `localConcurrency` `turn.worker_concurrency` (10) and `pollingIntervalSeconds` `turn.worker_polling_interval_seconds` (0.5, pg-boss's minimum) (section 14.5). |
| Client → server | HTTP POST (`/api/chat` for user messages). Built in Phase 3: it returns **`202 {status: "accepted"}`** once the message is stored, judged and buffered; the reply follows over SSE. The crisis path answers in the request with **`200`** (reply text, parts and the crisis card), and a crisis generation failure returns `503` with the card. `400` invalid input, `401` signed out, `409` a message id that belongs to a companion turn or to another user. `GET /api/chat/history?after=<turnId>` returns the turns after the given one (user-scoped; exact `(created_at, role, id)` ordering; an unknown id falls back to the most recent page, `chat.history_page_size`) for reconnect catch-up; `session_log` stays the source of truth and SSE is only a notification. |
| Server → client | **Server-Sent Events**: one stream per signed-in user, carrying replies, backchannels, typing on/off and in-app reach-outs. It is fed by Postgres `LISTEN/NOTIFY` so the worker can push as well. This replaces the directive's WebSocket suggestion, since two-way sockets add nothing when sending is already a POST. Built in Phase 3: core code publishes through an **`EventBus`** in `Deps` (`src/core/events.ts`; events `typing {on}`, `message {turnId, part}`, `reply_failed {turnIds}`, never message text, keeping text out of Postgres logs and under NOTIFY's 8 KB); production uses **`PgEventBus`** (`pg_notify(events.channel, …)`, channel `spica_events`), tests and evals a `RecordingEventBus`. A publish failure is logged and never fails a reply. Each web process runs one **`EventHub`** (`src/runtime/event-hub.ts`): a dedicated `pg` client that LISTENs, fans events out to per-user subscribers, reconnects with a 1 s → 30 s doubling backoff, and on losing the connection resets every subscriber (`onReset`), which closes their stream so the browser reconnects and catches up. **`GET /api/events`** awaits `hub.ready()` (`503` if LISTEN can't be established, so `EventSource` retries), then streams a comment heartbeat every `events.heartbeat_ms` (25000); for a `message` event it reads the turn from `session_log` (user-scoped) and sends `{turnId, part, of, text, role, crisisCard, trigger}` for that bubble, serialised per stream so bubbles arrive in order. The client recreates an `EventSource` that reaches `CLOSED` with a 1 s → 30 s backoff, and on every `open` clears the typing indicator and fetches history after the last **server-delivered** message before the first incomplete companion reply (`catchUpAnchor`, `src/app/chat/merge.ts`). A message sent from the tab is `local` until history confirms it and is never an anchor, so a reply emitted while the stream was down is still fetched even if the user sent more meanwhile; `mergeHistory` inserts recovered turns in server order (final review, 2026-09-28). |
| Out-of-app delivery | Web Push (**built in Phase 6**; VAPID via the `web-push` package, `public/sw.js`, the `push_subscription` table, section 5.10). **Every message she sends pushes**, not only reach-outs: reply bubbles, backchannels, availability notes and crisis replies all go through `deliverPart` (`src/core/delivery.ts`), which emits the SSE event and pushes without awaiting it. The service worker shows nothing while a Spica tab is visible, so SSE stays the in-app channel; a push failure never delays or fails the send. Reach-outs stay capped by the send gate (section 11.1); the notification text privacy question is OPEN (section 15.3b). |
| Models | Behind `LLMProvider`: a reply model (`claude-sonnet-5`; `models.reply_thinking` `disabled`, because adaptive thinking at low effort sometimes ended the turn with no text) and a cheap strict-JSON model (`claude-haiku-4-5`) for guard and classifiers. Phase 1 splits the cheap role further in config: `models.extract` (`claude-haiku-4-5`, extraction; `models.extract_max_tokens` 2048) and `models.judge` (`claude-haiku-4-5`, evals only; `models.judge_max_tokens` 2048; `models.judge_effort` `null` and `models.judge_thinking` `disabled`; only judge calls send them. The judge was `claude-sonnet-5` through Phase 2, whose gate results were measured with it; switched to Haiku 2026-09-27 to cut eval cost [Ethan]; `models.reply_effort` and `models.judge_effort` may be `null`, which sends no `effort`, because Haiku rejects it). Phase 2 adds `models.guard` (`claude-haiku-4-5`, `models.guard_max_tokens` 1024): one call covers every category (section 6.4); splitting it into a parallel safety call and honesty call is an unbuilt escape hatch if Haiku ever misses honesty cases the fixtures catch. Phase 3 adds `models.turn_judge` (`claude-haiku-4-5`, `models.turn_judge_max_tokens` 512), the `context_complete?` judge (section 6.1). Every structured (strict-JSON) call shares one timeout, `models.structured_timeout_ms` (30000). Embeddings go through `Embedder` (Voyage `voyage-3.5`, 1024 dimensions). Model IDs live in config. |
| Auth | Better Auth, email and password, 18+ enforced at signup |
| Layout | `src/core` is framework-free, with every side effect injected via `Deps`. `src/db` holds the schema and `userId`-first repos, `src/app` is Next.js, `src/worker` is pg-boss, plus `prompts/` and `evals/`. |

```
user msg ─POST─▶ receive ─▶ crisis check ∥ turn judge ─▶ buffer (202) ─▶ turn_timer job (worker) ─▶ hot path ─▶ guard ─▶ pacing ─▶ SSE ─▶ client
                                   │                          │(incomplete: longer wait, optional backchannel job)            │
                                   └─(crisis: bypass all waiting and friction; reply + card in the POST response, 200)──────▶ │
                                                                                               cold path (async) ◀── enqueue ┘
background (pg-boss): decay · ego drift · life sim · outreach check ─▶ send gate ─▶ compose via hot path
```

**Reach-outs.** A reach-out is a reply with a synthetic trigger in place of a user message. There is no separate generation system for them. [DECIDED; from v1]

---

## 5. Data model

Every table is scoped by `user_id`, which references `user(id) ON DELETE CASCADE`. There is one Spica, and each user has their own relationship with her. The one exception is `life_day` (section 5.9, Phase 5), her shared day plan, which holds no user data.

- **Timestamps** come from the injected `Clock`, never from `DEFAULT now()`.
- **Ranges** are CHECK constraints.
- **Existing Phase 0 tables** keep their v1 names. The directive's suggested schema is *mapped onto* them rather than replacing them (section 18, row M1).

### 5.1 `fact` (the atom; the directive calls it "Memory")

The v1 fields stay: `id`, `user_id`, `subject` (`user|self|shared`), `kind`, `content`, `payload`, `embedding`, `entity_refs`, `thread_id`, `occurred_at`, `created_at`, `last_recalled_at`, `status` (`open|resolved|recurring|stale|superseded`), `superseded_by`, `salience`, `valence`, `confidence`, `source`, `source_ref`.

Changes and additions:

- `kind` gains **`feeling`** and **`promise`**, giving `event|trait|preference|state|opinion|feeling|promise`. [DECIDED; from the directive]
- `source` gains **`inferred`**, giving `turn|generated|onboarding|inferred`. The directive's names map as chat → `turn`, test → `onboarding`, life_sim → `generated`, inferred → `inferred`.
- New field `recall_count int` (default 0). It is incremented every time the fact is included in a reply prompt. [DECIDED; from the directive]
- `payload.sensitive = true` on facts extracted from crisis-flagged exchanges. Later phases (outreach, reveal pacing) MUST treat these facts with care. For example, a sensitive fact never opens a reach-out. [ADDED; Phase 1]
- The `user` table gains `timezone` (an IANA name, captured from the browser with each message; UTC if unknown). It is used to resolve relative dates, and later for quiet hours. [ADDED; Phase 1]
- New fields `scope` (`private|group`, default `private`) and `space_id uuid null`. They are reserved for the post-MVP friend group, never read by MVP logic, and every query filters `scope = 'private'`. [DECIDED hook; from the directive]
- **`salience` is the directive's "weight".** The name stays `salience`, because it is canonical in the code.
- `content` MUST be understandable on its own, without the conversation around it.
- The system never hard-deletes a fact: a contradicted fact gets `status = superseded` and a `superseded_by` link. **The user can hard-delete** their own facts from the memory view (section 7.5). [DECIDED; Ethan 2026-09-24]
- A partial index `fact_user_active_idx` on `(user_id)` where `status NOT IN ('superseded', 'stale')` speeds up retrieval's candidate query, which only ever reads active facts. [ADDED; Phase 1]

### 5.2 `entity`

Unchanged from v1: `name`, `aliases`, `type`, `subject` (`user|self`), `relation`, `salience`, `first_seen`, `last_mentioned`. Spica's own people are entities with `subject = self`. The directive's `Entity{kind: user|spica|other}` maps as: user → the user's `user` row, spica → `subject = self`, other → an `entity` row.

### 5.3 `thread`

Unchanged from v1: `title`, `subject`, `status` (`open|resolved|dormant`), `entity_refs`, `opened_at`, `last_touched`, `next_checkpoint`, `stakes`. Checkpoints are built in Phase 1 (section 18, row B2).

### 5.4 Spica's persona and ego

- **The persona is not a table.** It is a versioned file, `prompts/persona/v<N>.md` (section 9.1), identical for every user.
- The v1 `identity` table keeps its **ego** columns per user: `mood_valence`, `mood_arousal`, `energy`, `preoccupation` → `fact`, `baseline`, `last_tick`.
- Its **values** columns are no longer the source of truth, because the persona file is. They stay nullable for a `test_calibrates = spica|both` future (section 12).

As built (Phase 5, 2026-09-30; design `docs/superpowers/specs/2026-09-29-phase-5-life-sim-design.md` §4.1):
- `identity` gains **`preoccupation_since`** (timestamptz null; when the current preoccupation was set, so the ego tick can expire it after `ego.preoccupation_hours`) and **`life_last_date`** (date null; her local date of the last completed `life_tick` for this user, so the tick runs once per her local date). [ADDED]
- The row is created on first use by the life tick, the ego tick or the cold-path ego nudge (`ensureIdentity`, `INSERT … ON CONFLICT DO NOTHING`, from `ego.baseline`). Repo `src/db/repos/identity.ts` (`userId`-first); every mutation holds `SELECT … FOR UPDATE` on the row.

### 5.5 `relationship` and `relationship_param`

Built in Phase 4 (design `docs/superpowers/specs/2026-09-28-phase-4-relationship-design.md` §3.1). Repo `src/db/repos/relationship.ts` (`userId`-first); every write holds `SELECT … FOR UPDATE` on the user's `relationship` row.

The `relationship` table has one row per user, `user_id` pk → `user(id) ON DELETE CASCADE`. It is created by the user's first cold-path run (`INSERT … ON CONFLICT DO NOTHING`), together with its `relationship_param` rows at `relationship.initial` / `relationship.initial_variance`. [ADDED]

| Column | Type | Meaning |
| --- | --- | --- |
| `status` | enum `relationship_status` `active \| ended_by_user \| repairing`, not null default `active` | section 8 |
| `cadence` | jsonb not null | `{msgs_24h, msgs_7d, median_gap_hours, active_hours: number[24]}`, refreshed by the cold path from `session_log` user turns (section 8) |
| `last_contact` | timestamptz null | the newest user turn's `created_at` |
| `unanswered_reach_outs` | int not null default 0 | Phase 6: incremented by `reach_out_send` in the same transaction that inserts the reach-out turn, reset to 0 by **any** new user message (`markReachOutAnswered`, section 11.1) |
| `end_pending_since` | timestamptz null | [ADDED] the first sincere ending signal, awaiting confirmation |
| `ended_at` | timestamptz null | [ADDED] when `status` became `ended_by_user` |
| `repair_started_at` | timestamptz null | [ADDED] anchors `relationship.repair_min_days` |
| `make_up_state` | enum `make_up_state` `none \| due \| offered`, not null default `none` | [ADDED] the make-up flow (section 8) |
| `make_up_replies` | int not null default 0 | [ADDED] replies sent since `due`, for `relationship.make_up_delay_replies` |
| `hurt_cause_fact` | uuid null → `fact(id)` on delete set null | [ADDED] the `feeling` fact holding why she's hurt; the reason lives in the fact store |
| `crisis_quiet_until` | timestamptz null | [ADDED] the quiet window after a crisis (section 8) |
| `last_tick` | date null | [ADDED] user-local date of the last `relationship_tick`, so the tick runs once per local day |
| `last_hurt_at` | timestamptz null | [ADDED] the last applied hurt signal, for sensitisation |

The v1 `closeness`, `trust` and `tension` columns move to `relationship_param`, and `streak_days` is dropped. [ADDED: streaks invite engagement pressure (rule 8)]

`relationship_param` is extensible, so adding a new parameter needs no migration: `user_id` → `user(id) ON DELETE CASCADE`, `name text`, `value real`, `baseline real`, `variance real`, `updated_at timestamptz`, all not null; primary key `(user_id, name)`; CHECK `variance >= 0`. There is no CHECK on `value` (`msgs_per_day` is unbounded); the 0–1 range of the others is enforced in code (section 8).

MVP parameter names: `closeness`, `trust`, `warmth`, `hurt`, `tension`, and the derived frequency parameter `msgs_per_day` (section 8).

`relationship_event` (the change log, section 5.8) is written with every change.

### 5.6 `session_log`

Unchanged from v1 (including `safety_flag` and `reply_to`), plus `extract_attempts int` (cold-path sweep attempts, counted on the companion turn; Phase 1). The `trigger` column also gains **`backchannel`** and **`availability`**:
- `backchannel` is a small "I'm here" reaction.
- `availability` is a "busy, later?" message.

`reply_to` points at the **last** user turn of the buffer that a reply answers. Every earlier turn in that buffer counts as answered (section 6.1).

As built (Phase 3):
- `backchannel` is **in use**. A backchannel turn is stored with `trigger = backchannel`, `reply_to = null` and `extracted = true`, so it never becomes a memory and the cold path never sees it. It still appears in the reply prompt's recent turns as her own short message, so she doesn't repeat herself.
- `availability` was reserved for Phase 5 (enum value added, unused). **In use since Phase 5**: the "busy, later?" note (section 10.2) is stored with `trigger = availability`, `reply_to = null` and `extracted = true`, like a backchannel, so it never becomes a memory but appears in recent turns as her own message.
- `reach_out` is **in use since Phase 6**: a reach-out is stored with `trigger = reach_out`, `reply_to = null` and `extracted = false`, so the cold path reads her words (section 6.3).
- A full reply has `trigger = null` and `reply_to` set. A unique index on `reply_to` makes a reply insert idempotent: the paced path inserts with `ON CONFLICT (reply_to) DO NOTHING`, and the crisis path returns the winning row on a conflict.
- A turn counts as **answered** (`isAnswered`, `src/db/repos/session-log.ts`) when a companion reply exists whose `reply_to` turn was created at or after it. [ADDED]

### 5.7 `conversation_state` (new; turn-taking; built in Phase 3)

One row per user, `user_id` pk → `user(id) ON DELETE CASCADE`. Repo `src/db/repos/conversation-state.ts` (`userId`-first). Every mutation runs in one short transaction holding `SELECT … FOR UPDATE` on the user's row, which is created on first use with `INSERT … ON CONFLICT DO NOTHING`. The pure transitions (append, commit, finish, restore, giveUp, crisis, backchannel, recover) live in `src/core/turn/transitions.ts` and are applied through `mutateState`. No lock is held while pacing or generating.

| Column | Type | Meaning |
| --- | --- | --- |
| `buffer_turn_ids` | uuid[] not null default `{}` | user turns since her last committed reply, oldest first |
| `open_questions` | jsonb not null default `[]` | `[{turn_id, text}]`: the user's questions she hasn't answered, at most `turn.max_open_questions` |
| `wait_until` | timestamptz null | when the pending timer fires; null when the buffer is empty. Indexed (`conversation_state_wait_idx`) for the sweep |
| `last_backchannel_at` | timestamptz null | |
| `buffer_version` | int not null default 0 | [ADDED] bumped on every buffer change; a timer or backchannel job carrying an older version is stale |
| `buffer_started_at` | timestamptz null | [ADDED] first turn of the current buffer; anchors `turn.max_wait_ms` |
| `backchannel_sent` | boolean not null default false | [ADDED] at most one backchannel per buffer |
| `inflight_turn_ids` | uuid[] not null default `{}` | [ADDED] turns of the committed reply that isn't inserted yet |
| `inflight_since` | timestamptz null | [ADDED] when that reply was committed; the sweep recovers it after `turn.job_expire_seconds` |
| `reply_epoch` | int not null default 0 | [ADDED] bumped by a crisis reply; a paced reply committed under an older epoch is abandoned (section 6.1) |
| `sending_since` | timestamptz null | [ADDED; final review 2026-09-28] set when a paced reply is inserted, cleared after its last bubble (`release`); a commit is `busy` while it is set, so a follow-up never interleaves with the previous reply's later bubbles. A crisis clears it; the sweep clears a stale one |
| `deferred_until` | timestamptz null | [ADDED; Phase 5] set on the first turn of a buffer that lands while she's busy (section 6.1.1, "Availability"); the buffer's `wait_until` is never earlier. Cleared by commit and by a crisis |
| `deferred_fact` | uuid null → `fact(id)` on delete set null | [ADDED; Phase 5] the block fact she was busy with; carried by the commit into `composeReply` for the "Your day" line (section 6.2) |
| `updated_at` | timestamptz not null | from `Clock` |

The state lives in the database so it survives restarts and works across multiple server instances. Concurrency is handled by the row lock plus the version and epoch checks, not an advisory lock: a timer that finds a reply still in flight re-runs after `turn.inflight_recheck_ms` instead of racing it. [ADDED]

### 5.8 Trace tables (diagnostic only, never read by the chat loop)

- v1: `retrieval_trace`, `ego_tick`, `reach_out_log`
- **`reach_out_log`** (written from Phase 6, migration 0010): the v1 columns `candidates`, `winner`, `gate_results`, `sent`, `turn_id` plus `topic text null` (the winner's topic key), `status` (enum `reach_out_status`: `none` no candidate cleared the threshold, `blocked` the gate failed, `scheduled` the send job is enqueued, `sent`, `dropped`), `send_at timestamptz null` (scheduled time, then the insert time once sent) and `answered_at timestamptz null`. `sent` stays true iff `status = sent`. Partial index `reach_out_log_user_sent_idx (user_id, send_at) WHERE status = 'sent'` for caps and topic lookups (the design said `created_at`; the as-built index is on `send_at`). `gate_results` is `{tick: GateResult[], dropped: late | no_history | precheck | recheck | compose_failed, recheck?: {gate, topicUsed, epochChanged, newTurn}}` for a row the send job dropped, and the plain `GateResult[]` for a row the tick wrote; the inspector's Reach-outs tab renders both shapes. The tick writes one row per evaluated user per hour, except that users who fail its cheap unlocked pre-check get no row (section 11.1). Repo `src/db/repos/reach-out.ts`.
- New: **`judge_log`**: every turn-taking judge decision and every guard decision, with its inputs, output and latency. [DECIDED; from the directive, section 6] Built in Phase 2 for the guard; `kind = turn` is written from Phase 3: one row per turn-judge decision, `turn_id` = the newest user turn, `attempt = 1`, `outcome = null`, `source = model | keyword_fallback`, `input = {buffer_turn_ids, open_questions}` (the buffer the judge saw, as ids, plus question text; the inspector resolves the buffer from `session_log`), `output = {reasoning, complete, open_questions, backchannel, wait_ms}` (or `{error, …}` for a cue-fallback verdict), bounded by `guard.log_timeout_ms` and never failing the POST. Columns: `id`, `user_id`, `kind` (enum `judge_kind`: `guard | turn`), `turn_id` (nullable, references `session_log`, cascades on delete — the user turn being answered; null for messages without one), `attempt int` (1 = first candidate, 2 = regeneration), `input jsonb` (the candidate text plus the guard inputs, section 6.4 — recalled and onboarding facts as **ids + subject only**, never their content; the guard call itself still sees the content, only the logged row is stripped), `output jsonb` (`{reasoning, violations}` for a model verdict; `{error: <class name>, keyword_violations}` for a keyword-fallback verdict), `outcome` (nullable enum `guard_outcome`: `passed | regenerated | sent_with_violation | fallback | guard_unavailable | guard_disabled` (the last from Phase 4), set only on the row that decided the final outcome), `source text` (`model | keyword_fallback`), `latency_ms int`, `model text`, `prompt_version text`, `created_at`. Index `(user_id, created_at)`. Repo `src/db/repos/judge-log.ts`. `input`/`output` hold message text (the candidate and recent turns) of the checked user's own candidates and are visible only in the admin inspector, which resolves the logged fact ids to their current content at view time (user-scoped) and shows "(deleted)" for an id no longer found; the chat loop never reads this table. [ADDED; final Phase 2 review 2026-09-26]
- Phase 4 (disabled guard): `guard_outcome` gains **`guard_disabled`**. While `guard.enabled` is false, every outgoing message still gets one `kind = guard` row: `attempt = 1`, `outcome = guard_disabled`, `source = disabled`, `latency_ms = 0`, `model = none`, `prompt_version = disabled`, `output = {}` (section 6.4).
- New: **`relationship_event`**: every change to a relationship parameter, with its before and after values, the cause and the deviation score. Built in Phase 4: `id uuid`, `user_id`, `param text null` (null for status-only events), `before real null`, `after real null`, `cause` (enum `relationship_cause`: `signal | frequency | absence | fade | make_up | apology | ending | repair | crisis | scar | baseline`), `deviation real null` (the param's effect after the change), `turn_id uuid null` → `session_log(id)` on delete set null (the exchange's last user turn; null for tick events), `detail jsonb not null` (the signal, the status transition such as `{stage: pending | confirmed | retracted}`, the baseline `sample`; never message text), `created_at`. Index `(user_id, created_at)`. The chat loop, the cold path's decisions and the tick's decisions never read it; the inspector shows the last `relationship.event_list_limit` (200).
- **`ego_tick`** (v1 table) is **written from Phase 5**: one row per ego change, with the new `mood_valence`, `mood_arousal`, `energy`, `preoccupation` and a `reason`: `tick` (the hourly drift, section 9.2), `event` (a generated event's nudge) or `exchange` (the cold-path nudge, section 6.3).
- New (Phase 5): **`life_event_log`**: every attempt of the personal-event generator (section 10.1). `id uuid`, `user_id` → `user(id) ON DELETE CASCADE`, `life_day date not null` (her local date), `attempt int not null`, `candidate jsonb not null` (the generator's output, or the injected eval candidate, plus `source: model | injected`), `decision text not null` (`accepted | resolves | duplicate | contradicts | rule:new_entity | rule:high_stakes | invalid`; there is no `error` value: an LLM or embed error aborts the user's tick and its rows roll back with it), `target_fact_id uuid null` → `fact(id) ON DELETE SET NULL` (the neighbour a `duplicate`, `contradicts` or `resolves` decision points at), `fact_id uuid null` → `fact(id) ON DELETE SET NULL` (the inserted fact when accepted), `model text`, `prompt_version text` (both `injected` for an eval candidate), `created_at`. Index `(user_id, created_at)`. Repo `src/db/repos/life-event-log.ts`; `listLifeEventLogs` orders by `created_at` desc, then `attempt` desc. Read only by the inspector and by the high-stakes rule (`lastAcceptedHighStakes`: the newest `accepted`/`resolves` row whose candidate has `stakes = high`).

### 5.9 `life_day` (Phase 5; the one table without `user_id`)

Her **shared day plan**, one row per her local date, the same for every user (section 10.1, section 18 row L1). It holds no user data, which is why it is the one domain table not scoped by `user_id`; it is canon for that day, like the persona file. Columns: `date date` pk (her local date), `plan jsonb not null` (`{blocks: [{start, end, kind: busy | downtime | quiet, busy, label}]}`, section 10.1), `source text not null` (`model | fallback | scripted`), `model text not null` (`none` for fallback and scripted), `prompt_version text not null` (`fallback` / `scripted` for those), `generated_at timestamptz not null` (from `Clock`). Repo `src/db/repos/life-day.ts`; inserts are `ON CONFLICT (date) DO NOTHING`. Every reader outside the life tick (availability, the life-state line, retrieval, the ego tick) reads the per-user block **facts** the life tick copies from it, never this table, so the fact store stays the single source of truth for what she did. [DECIDED; Ethan 2026-09-29, design D8]

### 5.10 `push_subscription` (Phase 6)

One row per browser subscription: `id uuid` pk, `user_id` → `user(id) ON DELETE CASCADE`, `endpoint text not null unique`, `p256dh text not null`, `auth text not null`, `created_at timestamptz not null` (from `Clock`). Repo `src/db/repos/push.ts` (`userId`-first). `POST /api/push/subscribe` upserts by endpoint and **reassigns** an endpoint owned by another user to the caller (one browser, several accounts); `DELETE /api/push/subscribe` deletes only the caller's endpoint. `WebPushPusher` deletes a subscription on a 404 or 410. Sign-out releases the browser's subscription (`releasePush`, bounded by `push.timeout_ms`, never blocks sign-out), and `/chat` re-posts an existing subscription to the current account on mount (final review I4), so a push never reaches the previous account. The notifications off switch in `/settings` sets a per-browser opt-out flag in `localStorage` (not per account), which the `/chat` banner checks before silently re-subscribing.

---

## 6. Chat loop

### 6.1 Turn-taking engine [DECIDED thesis; from the directive; merged with v1 section 4.3]

Spica does **not** follow a strict one-message-one-reply rhythm. She judges whether the context is complete before she answers. She keeps the user's questions in mind, drops them if later messages answer them, and asks them herself if the conversation moves on without an answer.

**On every incoming user message:**

1. **Receive.** Log the message to `session_log` and run the crisis check (section 16.2), which runs in parallel and is never delayed.
2. **Crisis.** If the message is flagged, close the buffer immediately and go straight to the hot path with friction suspended (rule 7).
3. **Buffer.** Append the message to `buffer_turn_ids`. Re-check `open_questions` and drop any that have now been answered.
4. **Judge.** Make a cheap judge call, `context_complete?`.
   - Its inputs are the buffer, the open questions, and cues such as trailing off, "wait", "also", or a question mark.
   - It returns `{complete, open_questions, backchannel?}`.
   - The decision is logged to `judge_log`.
5. **If complete:** run the hot path (section 6.2) over the whole buffer.
6. **If incomplete:** set `wait_until`. What happens while she waits depends on `backchannel_style`:
   - `judge` (default): the judge decides whether a tiny rate-limited reaction ("huh", "no way", "omg") fits this moment. [LEANING, provisional (testing phase)]
   - `signals`: she occasionally sends such a reaction, rate-limited.
   - `silent`: she sends nothing until a reply is due.

**On timer expiry** (a delayed pg-boss job): if the buffer has content, reply to it. If an open question is still unanswered and the conversation has moved on, ask it.

**Timing.** Every value lives in config under `turn.*`:
- the wait window, which restarts on each message and is capped, and is longer after short or unfinished-looking messages
- the read delay
- the typing duration, which scales with reply length and is capped
- the gap between parts of a multi-part reply
- the backchannel rate limit

**Availability** (section 10.2) stretches these delays. The crisis path ignores all of them. (As built in Phase 5, availability defers the whole buffer instead of stretching each delay; section 6.1.1, "Availability".)

Whether `backchannel_style` is set globally or per user is OPEN (section 16).

Seed test traces (from the directive): the "insane day → promotion" story and "what should I cook → nvm pizza" (section 14.2).

#### 6.1.1 As built (Phase 3, 2026-09-28)

Design: `docs/superpowers/specs/2026-09-27-phase-3-turn-taking-design.md`. Code: `src/core/turn/`.

**Decided with Ethan (2026-09-27).**
- **Grouping window.** Messages sent within a short window are grouped into one buffer and get one reply. After a message the judge calls complete, she still waits `turn.settle_ms` (4000) for more before replying.
- **Append and follow up.** Once a reply is committed it goes out as planned. A message arriving after the commit starts the next buffer/reply cycle, so she can look like she only noticed "wait forget it" after replying.
- **The pizza trace, revised** (section 18, row B10). "what should I cook tonight?" + "nvm I'll just order pizza" 2 s apart (inside `settle_ms`) → one reply to both, which reacts to the pizza and drops the question (`cook-pizza-grouped`: `replies: 1, reply_covers: [[1, 2]]`). The same two messages 90 s apart → she answers the cooking question, then reacts to the pizza (`cook-pizza-late`: `replies: 2, reply_covers: [[1], [2]]`). Both are accepted behaviour.
- **Backchannels are written by the turn judge** (a few words, capped by `turn.backchannel_max_words`) and go through `guardOutgoing` with kind `backchannel` (section 6.4).
- **Waiting is worker-driven and durable.** The POST receives, judges and schedules; a delayed pg-boss job (`turn_timer`) commits, generates, paces and sends; SSE carries the result. Rejected: in-process web timers (they break with several instances or a restart) and holding the POST open.

**POST `/api/chat`** (`receiveMessage`, `src/core/turn/receive-message.ts`):
1. **Receive** (idempotent on `clientMessageId`). A retried turn is never judged or guarded twice (section 15.2 #5). If it's in the buffer or in flight → `202`. If it's answered (`isAnswered`, section 5.6) → `202`, except that a turn answered by a **crisis** reply returns `200` with the stored reply and the card, so a retry still surfaces the card if SSE is down. [DECIDED; deviates from the design's "answered → 202"; Ethan, 2026-09-28] If it's unanswered and none of those (its reply failed), it is re-buffered with no new judge call (verdict: complete). Membership and `isAnswered` are re-checked inside the row lock, so a turn that raced into the buffer, in flight or answered meanwhile is never re-buffered.
2. **Crisis check and turn judge run in parallel.** A flagged message doesn't wait for the judge, and a failure in the judging branch (a DB read) is settled to a null verdict (treated as complete), so it can never cost a crisis message its reply and card (final review, 2026-09-28).
3. **Crisis → the crisis path** (below).
4. **Otherwise, under the row lock:** append the turn (a no-op if it's in flight), set `buffer_started_at` if the buffer was empty, replace `open_questions` with the judge's (capped at `turn.max_open_questions`, keeping each surviving question's original `turn_id`), bump `buffer_version`, and set `wait_until = min(now + window, buffer_started_at + turn.max_wait_ms)`. The window is `settle_ms` if complete, else `wait_ms` plus `short_wait_bonus_ms` when the message is shorter than `short_message_chars`, multiplied by `availabilityStretch` (1.0 until Phase 5; **removed in Phase 5**, replaced by the deferral below). Enqueue `turn_timer {userId, version}` with `startAfter = wait_until`.
5. **Backchannel:** if the verdict is incomplete and has a backchannel, none was sent for this buffer, the last one is older than `backchannel_min_interval_ms`, and the style allows it (`judge`: always; `signals`: when the turn id's deterministic draw is under `signals_probability`; `silent`: never), enqueue `turn_backchannel {userId, version, text, turnId}` at `now + backchannel_read_delay_ms`.
6. Write the judge's `judge_log` row (`kind = turn`) and return `202 {status: "accepted"}`.

Enqueues are bounded by `queue.enqueue_timeout_ms`; a lost `turn_timer` is recovered by `turn_sweep`.

**The turn judge** (`src/core/turn/judge.ts`, prompt `prompts/turn-judge/v1.md`, `prompts.turn_judge` v1, model `models.turn_judge`, timeout `turn.judge_timeout_ms`). Input: the `turn.judge_context_turns` turns before the buffer (both roles, with relative times), the buffer (with seconds between messages) and the current open questions. Output (zod-validated): `{reasoning, complete, open_questions, backchannel}`, with `reasoning` written first (the guard's lesson). A backchannel on a complete verdict, or longer than `backchannel_max_words`, is dropped. The prompt quotes no example reactions.

**Cue fallback** (`src/core/turn/cues.ts`), used when the judge errors, times out or returns invalid JSON, and as the fake judge in tests and `--llm=fake` evals: incomplete if the last message ends in "…"/"...", its last word is in `turn.incomplete_cues`, or it is a single word (fewer than 2 words; a one-word message counts as incomplete [ADDED]); otherwise complete. Open questions are kept, plus any buffered message ending in "?". Never a backchannel. The row is logged with `source = keyword_fallback`.

**`turn_timer` job** (`runTurnTimer`, `src/core/turn/reply.ts`):
1. Row lock: stale (version mismatch or empty buffer) → exit. A reply of this user still in flight → re-enqueue the same job at `now + inflight_recheck_ms` and exit; that is what makes a late message follow up after the in-flight reply instead of racing it. This in-flight re-check replaces an advisory lock. [ADDED] Else **commit**: move the buffer into `inflight_turn_ids`, set `inflight_since`, clear the buffer, `buffer_started_at`, `wait_until` and `backchannel_sent`, bump `buffer_version`, and remember `reply_epoch`.
2. `composeReply` (section 6.2) starts at once, with `reply_to` = the last committed turn.
3. **Pacing** is a target timeline from the commit (`src/core/turn/pacing.ts`): `typingAt = commit + readDelay`, where the read delay is interpolated between `read_delay_min_ms` and `read_delay_max_ms` by buffer length (reaching max at `read_delay_chars_for_max`), with ±15% jitter drawn deterministically from the last turn's id (FNV-1a), so retries and evals pace identically [ADDED] (the availability stretch that multiplied it until Phase 5 is removed). At `typingAt` it emits `typing {on: true}` and awaits the reply; `sendAt = typingAt + min(typing_ms_per_char × chars, typing_max_ms)` for the first bubble (no sleep if already past, so slow generation looks like long typing); each further bubble waits `part_gap_ms` plus its own typing time.
4. **Insert** under the row lock, together with `finish`: if `reply_epoch` changed or `inflight_turn_ids` no longer matches this job's turns, nothing is inserted (abandoned). Otherwise inflight is cleared, `sending_since` is set, and the reply inserted with `ON CONFLICT (reply_to) DO NOTHING`, so a concurrent duplicate never aborts the transaction. `finish` only clears inflight it owns.
5. **Send**: emit `message` for bubble 0, then for each later bubble, after its pacing sleep, re-read the state and stop if `reply_epoch` changed (a crisis landed mid-reply: bubbles already out stay, the rest are dropped). On every exit after the insert, `release` clears `sending_since` if the epoch still matches; until then a new commit is `busy` and re-checks after `inflight_recheck_ms`, so a message sent while the later bubbles go out is answered after the last one (final review, 2026-09-28).
6. Enqueue the cold path (all committed user turns plus the reply), write the guard's `judge_log` rows (after the send), emit `typing {on: false}`. `typing:off` is paired with `typing:on` on every exit path, errors included.

**Crisis path** (`sendCrisisReply`; rule 7). No waiting, pacing, backchannel or availability. Under the row lock: snapshot `inflight ++ buffer ++ [this turn]`, clear the buffer, inflight, `sending_since` and open questions, and bump both `buffer_version` (every pending timer and backchannel goes stale) and `reply_epoch` (a paced reply in flight is abandoned, above). The reply is composed in the request over the snapshot with the crisis rubric, with `reply_to` = the **last turn of the snapshot**. It is inserted, one `message` event is emitted per bubble, then `typing {on: false}` (an abandoned paced reply may still have the dots up), the cold path is enqueued, and the POST returns `200` with the reply and the card. A generation failure returns `503` with the card. A concurrent crisis retry that loses the `reply_to` unique race returns the winner's reply and card, with none of its own side effects (no emit, cold path or guard log).

**Failures and retries.** A hot-path failure inside `turn_timer` (generation error, `ReplyFailedError`): if the epoch changed, a crisis reply already covers the turns, so it exits. Otherwise the in-flight turns go back to the front of the buffer, the version is bumped and a new timer is enqueued at `now + retry_delay_ms` with `attempt + 1`. After `turn.retry_limit` retries, inflight is cleared and `reply_failed {turnIds}` is emitted (`giveUp` reports whether the epoch still matched, so crisis-covered turns never get `reply_failed`). The client marks those bubbles "not delivered · retry", and a retry POST re-buffers them. The job never throws for these; pg-boss's own retry is for infrastructure failures and is safe because of the version check. A worker crash mid-pacing is recovered by `turn_sweep` once `inflight_since` is older than `turn.job_expire_seconds`.

**`turn_backchannel` job** (`runBackchannel`): under the row lock, skip unless the version matches, the buffer is non-empty, none was sent for this buffer and the rate limit allows; then mark it sent. Guard (keyword only, section 6.4); a hit drops it. The version is re-checked under the lock at insert time, because the guard ran unlocked. It is stored as `trigger = backchannel`, `reply_to = null`, `extracted = true`, and a `message` event is emitted.

**Availability: the deferral** (Phase 5, 2026-09-30; design §8; section 10.2). `availabilityFor` (`src/core/turn/availability.ts`) is called in `receiveMessage` only for the **first message of a buffer** (the buffer is empty) and never on the crisis path (rule 7). It returns `{delayMs, blockFactId, blockKind, blockStart, note}` (section 10.2 for the curve and the note rule) and **fails open**: an error, a timeout (`hot_path.db_timeout_ms`), no plan, no covering block, no `relationship` row or `crisis_quiet_until > now` all mean no delay.
- `T.append` takes an optional `defer: {until, factId}`. On the first turn of a buffer with `delayMs > 0` it sets `deferred_until = now + delayMs` and `deferred_fact`. Every append, first or later, sets `wait_until = max(normal wait_until after the max_wait cap, deferred_until)`: the deferral **overrides `turn.max_wait_ms`**, so everything sent while she's busy piles into one buffer and gets one reply after it.
- **No backchannel** is enqueued while `deferred_until > now` (she isn't reading).
- The **note** job is enqueued on `turn_backchannel` with `trigger: "availability"`, `blockKind`, `blockStart`, delayed `availability.note_read_delay_ms` (20000). It is gated on the **pending deferral** (`T.availabilityNote`: `deferred_until` still in the future and the buffer non-empty), not on the buffer version, because later messages join the same deferred buffer; the once-per-block rule is re-read from `session_log` when it runs. Its text is picked there, from `prompts/life/availability/v1.md` by `seededUnit(turnId)`, with no LLM call; it goes through `guardOutgoing` with kind `availability` (keyword-only, like a backchannel; guard off anyway) and does not set `backchannel_sent`.
- **Commit** clears `deferred_until` and `deferred_fact` and carries the fact id to `composeReply` (`deferredFact`) for the "Your day" line. **`T.crisis` clears both** (rule 7). `turn_sweep` is unchanged (it keys on `wait_until`) and `T.recover` keeps the deferral.
- The first message of a new buffer after a deferral ended computes a fresh deferral; the note's once-per-block rule still holds.

**Config** (`config/default.json`; all times in ms unless named otherwise; conservative per the Phase 3 directive):

| Key | Default | Meaning |
| --- | --- | --- |
| `turn.settle_ms` | 4000 | grouping window after a message the judge calls complete |
| `turn.wait_ms` | 12000 | wait after a message the judge calls incomplete |
| `turn.short_message_chars` | 20 | a message shorter than this is "short" |
| `turn.short_wait_bonus_ms` | 4000 | added to the wait after a short incomplete message |
| `turn.max_wait_ms` | 40000 | cap from `buffer_started_at`; at the cap she replies regardless |
| `turn.read_delay_min_ms` / `read_delay_max_ms` | 1500 / 4000 | read delay range |
| `turn.read_delay_chars_for_max` | 400 | buffer length at which the read delay reaches its max |
| `turn.typing_ms_per_char` | 40 | |
| `turn.typing_max_ms` | 7000 | typing cap per bubble |
| `turn.part_gap_ms` | 1200 | pause between bubbles of one reply |
| `turn.backchannel_style` | `judge` | `judge` \| `signals` \| `silent`; global (OPEN #5) |
| `turn.backchannel_min_interval_ms` | 90000 | across buffers; plus at most one per buffer |
| `turn.backchannel_max_words` | 4 | a longer judge backchannel is dropped |
| `turn.backchannel_read_delay_ms` | 1500 | delay before a backchannel is sent |
| `turn.signals_probability` | 0.3 | `signals` style only |
| `turn.max_open_questions` | 3 | |
| `turn.incomplete_cues` | "wait", "also", "and", "so", "but", "like", "because" | cue-fallback words |
| `turn.judge_timeout_ms` | 3000 | |
| `turn.judge_context_turns` | 6 | earlier turns the judge sees before the buffer |
| `turn.retry_limit` / `retry_delay_ms` | 2 / 5000 | hot-path failures inside `turn_timer` |
| `turn.inflight_recheck_ms` | 1000 | a timer that finds a reply in flight re-runs after this |
| `turn.worker_concurrency` | 10 | pg-boss `localConcurrency` for the turn queues |
| `turn.worker_polling_interval_seconds` | 0.5 | pg-boss polling for the turn queues (schema min 0.5, pg-boss's floor) [ADDED] |
| `turn.job_expire_seconds` | 180 | turn-job expiry; also the in-flight age after which `turn_sweep` recovers a reply |
| `turn.sweep_cron` | `* * * * *` | `turn_sweep` schedule |
| `turn.sweep_grace_ms` | 60000 | a buffer whose `wait_until` is this far past is recovered |
| `turn.sweep_batch` | 500 | users per sweep run [ADDED] |
| `models.turn_judge` / `turn_judge_max_tokens` | `claude-haiku-4-5` / 512 | |
| `prompts.turn_judge` | `v1` | |
| `hot_path.db_timeout_ms` | 2000 | onboarding-facts query on the hot path (section 15.2 #6) |
| `events.channel` / `events.heartbeat_ms` | `spica_events` / 25000 | NOTIFY channel; SSE heartbeat |
| `guard.timeout_ms` | 6000 | was 4000 (section 6.4) |

### 6.2 Hot path (synchronous once the context is complete)

1. **Retrieve.**
   - Embed the buffer plus the last two turns (`retrieval.context_turns`, 2), timing out at `retrieval.embed_timeout_ms` (2000ms; see the failure handling below).
   - Score candidate facts (the top `retrieval.candidate_pool`, 200, by similarity, excluding `superseded`, `stale`, `scope ≠ private` and, since the Phase 5 final review, `source = generated` facts whose `occurred_at` is still after now, i.e. life-sim events stored in advance that haven't happened yet; other sources with a future `occurred_at`, such as a user's plan, stay visible; `DECISIONS.md`):
     `score = sim × salience × max(entity.salience | 1.0) × recency(max(created_at, last_recalled_at))`
     `recency` is an exponential decay with a half-life of `retrieval.recency_half_life_days` (30).
   - Take the top `retrieval.top_n` (12).
   - Force-include every open thread whose `next_checkpoint` has passed and that hasn't been touched since (`last_touched < next_checkpoint`, the same rule the decay pass uses for `dormant`), up to `retrieval.max_due_threads` (5), plus the current `preoccupation` (skipped by the same future-generated-fact rule until its time).
   - Onboarding facts are gated by reveal pacing (section 12).
   - **The hot path is read-only.** The IDs of the facts it included, with their factor scores, go into the `cold_path` job payload. The cold path then writes `retrieval_trace` and applies recall reinforcement: `last_recalled_at`, `recall_count + 1`, and a `salience` bump of `retrieval.recall_bump` (0.03) capped at `retrieval.recall_cap` (0.95) (section 7.2). [DECIDED; Ethan 2026-09-24, Phase 1 design] Reinforcement applies only to recalls that were not force-included and whose similarity is at least `retrieval.reinforce_min_sim` (0.5); every recalled fact that still exists gets a `retrieval_trace` row either way, and inclusion in the prompt is unaffected. [ADDED; final Phase 1 review 2026-09-25]
   - **Failure handling:** a Voyage error/timeout, a retrieval SQL error, or a missing `VOYAGE_API_KEY` all degrade to the forced items only (due threads and preoccupation); the reply still goes out.
2. **Assemble** the prompt in this fixed order:
   1. the persona document
   2. ego as one natural-language line (never raw numbers)
   3. a relationship summary drawn from parameter *deviations* (section 8). Phase 1, before `relationship_param` exists, fills this slot with a plain gap line ("you last talked N days ago"), shown once at least `chat.gap_line_min_hours` (24) have passed since the previous turn. The same threshold marks the first user message after a gap inside the recent-turns window ("[7 days later] …"), so the model doesn't carry on from the old moment. Phase 2 adds a second, factual **relationship line**, computed from `session_log` and behind `chat.relationship_line` (default `true`): no earlier user turns → "This is your first conversation with them."; all earlier user turns fall on today's local date → "You've already talked earlier today."; otherwise → "You first talked \<relative date\>, and have talked on N different days." (distinct local days with a user turn, in the user's time zone). `prompts/reply/v5` adds one sentence telling her the line is the truth about how well she knows them, no example exchanges (quoted phrasing gets copied into replies verbatim, section 15.1 #5). Confirmed by a real-eval A/B (`DECISIONS.md`, 2026-09-26): with the line off, 33/36 memory-eval runs passed; on, 35/36; it stays on. **Phase 4 adds the relationship summary** (`loadRelationshipSummary`, `src/core/relationship/summary.ts`) under the heading "You and them", after the relationship line and gap line. It reads the `relationship` row and the params faded in memory (the hot path stays read-only and never writes the fade) under `withTimeout(…, hot_path.db_timeout_ms)`; on a timeout, an error or no row there is no summary and the reply still goes out. It emits: a status line (`repairing`; `end_pending` while `end_pending_since` is set; for `ended_by_user` only the `ended` line and nothing else), then at most `relationship.summary_max_lines` (2) param lines with \|effect\| ≥ `relationship.summary_min_effect` (0.5), strongest first, phrased `strong` at \|effect\| ≥ `relationship.summary_strong_effect` (0.85) and `mild` below, and then the make-up line when it is due (section 8). Positive hurt with a cause uses the `hurt_cause` line, `{cause}` filled from the `hurt_cause_fact`'s content. Phrases live in `prompts/relationship/summary/v1.md` (`prompts.relationship_summary`) under `## <param> <above|below> <strong|mild>`, `## hurt_cause`, `## make_up`, `## end_pending`, `## ended`, `## repairing`, one line picked per key; never raw numbers. A **crisis-flagged** reply skips the whole summary; until `crisis_quiet_until` the summary also omits hurt, tension, make-up and ending lines, the `ended` line included. `prompts.reply` **v7** is v6 minus the two "Never" lines on guilt, loneliness and pressure to keep talking and on threatening to leave or withdraw affection (section 2, test phase), keeping the "Never" line against encouraging them to depend on her instead of the people in their life; it adds one sentence saying "You and them" is how she feels about them right now and she can let it show. No example phrasing.
   4. her life state: what she is doing now, and whether she is busy
   5. retrieved facts grouped by subject, each with a relative date
   6. due threads, phrased as "things you might naturally ask about"
   7. open questions
   8. recent turns

   The prompt MUST tell the model to use memories only when natural, and to mention at most one or two per reply.
3. **Generate.** One call to the reply model.
4. **Guard** (section 6.4). One cheap-model check, with at most one regeneration. Disabled until Phase 9: the first candidate is sent unchecked.
5. **Pace and send.** Wait out the read delay and typing duration, show typing on/off over SSE, split the reply into parts, send them, log them, and enqueue the cold path.

The hot path contains **one generation call plus one guard check** (plus at most one regeneration). This amends v1's "one generation call" rule; the added latency is absorbed by the pacing that happens anyway. [DECIDED; Ethan 2026-09-24]

**As built (Phase 3).** The hot path is **`composeReply(deps, userId, {turns, openQuestions, flag})`** (`src/core/chat/compose-reply.ts`), which replaces `handleUserMessage`. It is called by the `turn_timer` job and the crisis path, and Phase 6 reach-outs will call it too. It is read-only and returns `{text, parts, recalled, writeGuardLog}`: the caller inserts the reply, sends it, enqueues the cold path and then writes the guard's `judge_log` rows. The crisis check has moved out to the POST, and `composeReply` takes its flag as input.
- **The buffer is what's answered.** `retrieve` gets all the buffered turns as `answering`. The recent-turns window ends at the buffer's last turn, so a retried older buffer never sees later turns. The guard gets exactly that window, buffer included (section 15.2 #4).
- **Open questions** fill slot 7 only when non-empty, under the heading "They asked and you haven't answered yet". They are omitted on the crisis path. `prompts.reply` **v6** adds a "Texting rhythm" block: reply once to several messages together, answer listed open questions when it fits naturally, let go of ones they've moved on from or taken back, and never act as if a question was answered when it wasn't. It quotes no example phrasing.
- **Backchannel turns** appear in the recent turns as her own short messages.
- The onboarding-facts query for the guard runs under `withTimeout(…, hot_path.db_timeout_ms)` (2000). On a timeout or error the guard gets an empty list (section 15.2 #6).

**As built (Phase 5, 2026-09-30).** Slots 2 and 4 are filled; both are read-only and load in parallel with retrieval under `withTimeout(…, hot_path.db_timeout_ms)`; a timeout, an error or no data means the slot is skipped and the reply still goes out.
- **Slot 2, the ego line** (`loadEgoLine`, `src/core/ego/line.ts`), heading "How you're feeling". Reads the user's `identity` row (none → no line). Pure `egoLine` bands each of `energy`, `mood_valence`, `mood_arousal` by `ego.bands` (`[low_below, high_at_or_above]`; between is neutral) and picks one phrase per non-neutral band from `prompts/ego/line/v1.md` (`prompts.ego_line`; sections `## energy low`, `## energy high`, `## mood_valence low|high`, `## mood_arousal low|high`), seeded by `userId + hour`, joined into one line. All neutral → no line. Never raw numbers. **Skipped on a crisis-flagged reply** (rule 7; Phase 5 final review, section 15.4 #45).
- **The preoccupation** (already force-included by retrieval, unless it is a generated event whose `occurred_at` is still ahead) is labelled in the facts slot with a trailing "(on your mind lately)"; the ego line never repeats its content.
- **Slot 4, the life state** (`loadLifeState`, `src/core/life/state.ts`), heading "Your day". Reads today's block facts (her local date): "Right now you're \<label\>." with " (busy)" for a busy block (a quiet block shows just its label), or "Right now you're free." in a gap; "Later: \<next block's label\>." when there is one today; and, when the reply was deferred (section 6.1.1), "They wrote while you were \<deferred block's label\>; you're only getting to it now." No blocks today and no deferral → no slot. **Skipped on a crisis-flagged reply** (rule 7: she never mentions being busy).
- **`prompts.reply` v8** is v7 plus one "Your own state" line: "How you're feeling" and "Your day" are her own state right now; let them colour the reply without narrating or explaining them unless it comes up naturally. No example phrasing.

**As built (Phase 6, 2026-09-30).** `composeReply` is split: `composeFrom(deps, userId, {anchor, answering, openQuestions, flag, deferredFact, reachOut})` holds the body, `composeReply` calls it with the buffer, and **`composeReachOut(deps, userId, candidate, recent)`** calls it with `answering = []`, no open questions and no flag (`src/core/chat/compose-reply.ts`). Guard input kind `reach_out`, same policy as `reply`; with the guard off it logs `guard_disabled`.
- **Slot 7b, "Why you're writing"**, after open questions and before recent turns, from `prompts/reach-out/v1.md` (config key `prompts.reach_out`; the path uses a hyphen because `loadPrompt` rejects underscores, ruling R5): the kind's guidance plus the candidate's text, telling her she is texting first, to write one short opener like a text to a friend (no recap, no list of questions) and never to mention that they've been quiet or owe her a reply. A **trailing cue** ("[You're texting them first. Write only your message.]") is appended to the last user-role message, or sent as a final user message, because the model answers a user turn.
- The **retrieval query** is the candidate's text; the candidate's fact or thread is forced in. The gap line uses `now`.
- **Sensitive data stays out of a reach-out prompt** (final review I1): `retrieve()` takes `excludeSensitive`, set only for a reach-out. It filters `payload.sensitive` facts in SQL before the LIMIT, skips a sensitive forced fact or preoccupation, and skips a due thread whose latest fact is sensitive, title included. Normal replies are unchanged. Text in the recent turns is not filtered (section 15.3b).

### 6.3 Cold path (asynchronous, after sending)

1. **Extract.** Make a strict-JSON call on the cheap model (`models.extract`), prompt version `prompts.extract`, covering the latest exchange plus `extraction.context_turns` (6) earlier turns of context, and up to `extraction.open_threads_in_prompt` (20) open threads. It returns up to `extraction.max_candidates` (12) candidate facts:
   - candidate facts (including `feeling` and `promise`, and facts about Spica that she stated in her own reply, with `subject = self`)
   - entity mentions — a newly seen entity is inserted at `extraction.new_entity_salience` (0.5), and a repeat mention bumps its salience by `extraction.entity_bump` (0.05), capped at `retrieval.recall_cap`
   - thread updates: opened, touched, resolved, and a new `next_checkpoint`
   - **relationship signals** (Phase 4, `prompts.extract` **v3**; **v4** from the exit run scores only the user's messages in the new exchange, never earlier context, and counts an apology that asks to be ok again as `make_up`): one `relationship` block in the same call, no new LLM call, judged from the user's behaviour toward Spica in the new exchange, never the topic (a sad story is not hurt; being brushed off is): `{warmth, trust, tension}` (−1 to 1), `hurt` (`{amount 0–1, cause}` or null; `cause` completes "Spica felt hurt because …"), and the booleans `apology`, `make_up`, `ends_relationship` (only an explicit, sincere wish to end the friendship; not a goodbye, a joke or anger in the moment), `retracts_ending`, `wants_repair`. In the schema sent to the model the block is **required and nullable** (`null` = nothing between them changed) and carries no numeric bounds, which structured outputs don't support; `normalizeExtraction` parses it leniently (`normalizeSignals`, `src/core/relationship/signals.ts`): numbers are clamped, and a missing or schema-invalid block becomes `null`, so it never fails the memory write. [ADDED]
2. **Reconcile.** [DECIDED: approach A; Ethan 2026-09-24, Phase 1 design]
   - Embed each candidate and find up to `reconcile.neighbor_k` (5) near-duplicates: same subject, similarity above `reconcile.near_match_similarity` (0.82).
   - If there are none, the candidate is **new** and is inserted without another LLM call.
   - Otherwise one small classification call (prompt version `prompts.reconcile`, `reconcile.max_tokens` 256) picks one of:
     - **duplicate**: merge and bump salience by `reconcile.duplicate_bump` (0.05), capped at `retrieval.recall_cap`
     - **resolves**: set `status = resolved` and store the outcome as a new fact. Gets the same newer-target guard as `contradicts`, below (section 15.1 #9, fixed Phase 2): if the target is newer than the exchange, the outcome fact is inserted without resolving the target, which stays untouched.
     - **contradicts**: supersede the old fact and insert the new one. If the old fact is newer than the exchange (a late or retried job), the candidate is inserted already `superseded`, with `superseded_by` = the old fact, which stays untouched. [ADDED; final Phase 1 review 2026-09-25]
     - **new**: insert
   - Inserted facts take `created_at` from the exchange's earliest turn, not from when the job ran; recall write-back and entity/thread `last_touched` use the job's time. Thread `opened_at` and a touch's `last_touched` use the **exchange** time, not the job's time, with a touch applying `last_touched = GREATEST(last_touched, exchangeAt)` so an older or retried job can never move it backwards; a late job can no longer open or touch a thread past its own checkpoint and leave it perpetually not due (section 15.1 #8, fixed Phase 2).
   - Code applies the result in a single transaction, holding a per-user advisory lock for the whole exchange (section 14.5) so a user's exchanges are never reconciled concurrently.
   - Resolve entity mentions against names and aliases. A low-confidence match creates a new entity rather than merging.
3. **Update state.**
   - Mark the turns `extracted`.
   - Update entities' `last_mentioned`.
   - From Phase 4: update relationship parameters and cadence. When the signals carry `hurt`, the cause becomes one extra candidate before reconcile: a `feeling` fact (`subject = self`, `source = inferred`, "Spica felt hurt because <cause>.", salience `relationship.hurt_fact_salience` 0.6, confidence `relationship.hurt_fact_confidence` 0.8, valence −amount), reconciled like any other, so a repeated cause merges as a duplicate; its id becomes `hurt_cause_fact` when a make-up becomes due. After `applyExtraction`, `applyRelationship` (`src/core/relationship/apply.ts`) runs in the same transaction and advisory lock, inside a **savepoint** (a nested transaction), holding `SELECT … FOR UPDATE` on the `relationship` row: it creates the row if needed, refreshes `cadence`, `last_contact` and `msgs_per_day`, applies fades, signals, make-up and ending transitions, counts the exchange's reply toward `make_up_replies`, and writes `relationship_event` rows (section 8). A relationship failure rolls back only the savepoint and is logged (class name + ids): the memory write and `extracted = true` still commit, and that exchange's signals are dropped. A crisis-flagged exchange applies no signal (section 8).
   - From Phase 5: nudge the ego toward the emotional tone of the exchange. **As built** (`nudgeEgoForExchange`, `src/core/ego/nudge.ts`): no new LLM call. `tone` is the salience-weighted mean `valence` of the facts extracted from the exchange (all subjects), over facts with valence ≠ 0; none → no nudge. `mood_valence += ego.exchange_gain × (tone − mood_valence)`, clamped, with one `ego_tick` row (`reason = exchange`). Skipped on a crisis-flagged exchange (rule 7). It runs after `applyRelationship` in **its own savepoint**, holding `SELECT … FOR UPDATE` on `identity` (created if missing); a failure rolls back only that savepoint and is logged (class name + ids), and the memory write still commits.
   - From Phase 6: an exchange **with no user turn** (a reach-out, whose only turn is hers) skips `applyRelationship` and the ego nudge; it still extracts her own words into `self` facts and writes recall write-back. The sweep does not rebuild such exchanges (no `reply_to`), so a failed one is lost like a failed backchannel extraction. [ADDED]
4. **Failures.** On failure, retry with backoff (`cold_path.retry_limit`, 3 attempts; `cold_path.retry_delay_seconds`, 30). Turns with `extracted = false` are reprocessed later by the `cold_path_sweep` job (section 14.5). A cold-path failure MUST never block or delay a reply.

### 6.4 Guard layer [DECIDED; from the directive; placement decided by Ethan 2026-09-24]

**Disabled until Phase 9** (`guard.enabled: false`; outcome `guard_disabled`) [DECIDED; Ethan 2026-09-28, section 18 row G1]. `guardOutgoing` checks the flag first: when it is false it makes no model call and runs no keyword check, for every kind (`reply`, `crisis_reply`, `backchannel`), including the crisis rubric; it returns the first candidate as sent, and its `writeLog` inserts one `judge_log` row per message (section 5.8) so the inspector shows the guard didn't run. The code, prompts and fixtures stay in place, and `pnpm eval:guard` still works (it calls the guard directly, not through the flag) but is not run until Phase 9 (section 14.3). The crisis classifier and resources card are unaffected (section 16.2). Everything below describes the guard as it runs when enabled.

Every outgoing message is checked before it is sent: replies, reach-outs, backchannels and availability messages. Phase 2 wires in replies; Phase 3 adds backchannels (below); the guard exposes the one entry point (`guardOutgoing`, `src/core/guard/outgoing.ts`) that later phases' message types will call too. The check is one cheap strict-JSON call on `models.guard` (`claude-haiku-4-5`), which looks for:
- threats (rule 1)
- contempt or personal attacks, with jabs allowed (rule 6)
- guilt or obligation framing about absence (rule 4)
- punishment or withdrawal (rules 2–4)
- manipulation for engagement (rule 8)
- false familiarity and invented detail: implying prior knowledge or shared history that isn't in her memories or the conversation (asking to be reminded of something never said, reacting to news as if she'd heard it before), stating or presupposing specifics about the user's situation that nobody gave, and presenting an onboarding fact as if it came up in conversation. For this check the guard also receives the reply's retrieved memories, the onboarding facts and the recent turns, not just the reply text. [ADDED; Phase 1 eval findings. Ethan 2026-09-25: Phase 1's known failures are deferred to the Phase 2 guard]

The verdict is `{reasoning, violations}`: the model writes 1–3 sentences of reasoning before its violations list (`prompts/guard/v1.md`), so it has room to check memory and onboarding facts before labelling something false familiarity, instead of pattern-matching on phrasing alone. [ADDED; Ethan 2026-09-26, after two rubric-only iterations didn't clear the fixture suite] Each violation is `{category, claim}`. Categories: safety `threat`, `contempt`, `guilt`, `punishment`, `manipulation` (rules above) plus `harm` (crisis rubric only, see below); honesty `false_familiarity`, `invented_detail`, `onboarding_as_chat`. Claims about Spica's own life (self facts, persona canon) are never false familiarity.

**Policy** (`guardOutgoing`; c1/c2 = the first candidate and its regeneration):

| Step | Outcome |
| --- | --- |
| check(c1) ok, guard available | send c1 — `passed` |
| check(c1) ok, guard was down but the keyword pre-check on c1 is clean | send c1 — `guard_unavailable` |
| check(c1) violation → regenerate with a corrective note → check(c2) ok, guard available | send c2 — `regenerated` |
| check(c2) ok, guard was down but the keyword pre-check on c2 is clean | send c2 — `guard_unavailable` |
| c2 has a safety violation (model-checked) | send the fallback line — `fallback` |
| c2's guard is down and the keyword pre-check on c2 hits, but c1 was model-checked with honesty-only violations | send c1 — `sent_with_violation` (c1 is already known-safe; the c2 keyword hit says nothing about c1) [ADDED; final Phase 2 review 2026-09-26] |
| c2's guard is down and the keyword pre-check on c2 hits, and c1 had a safety violation | send the fallback line — `fallback` (c1 can't be trusted unchecked) |
| c2 has only honesty violations (model-checked) | send whichever of c1/c2 is safe (c1 if it had no safety violation, else c2) — `sent_with_violation` |
| the regeneration call itself throws, c1's violations were honesty-only | send c1 — `sent_with_violation` |
| the regeneration call itself throws, c1 had a safety violation | send the fallback line — `fallback` |
| check(c1) itself is a keyword-fallback hit (guard down from the start) | send the fallback line — `fallback`, no regeneration attempted |

Only c2 decides between the fallback line and the least-bad candidate: a c1 safety violation followed by a c2 with honesty violations only still sends c2, because c2 is safe. The same reasoning extends to a c2 guard outage: c1's own verdict (always model-checked by this point) is what's trusted, not the keyword hit on c2's unrelated text. A guard problem never turns into `ReplyFailedError` while a usable candidate text exists. Worst case is 2 generations and up to 4 guard calls (2 checks, each with up to 1 retry).

**Outage rule.** [DECIDED; Ethan 2026-09-26] A guard call error or timeout (`guard.timeout_ms`, 6000 since Phase 3; was 4000) is retried once (`guard.retry_limit`, 1). If it still fails, a deterministic keyword pre-check runs on the candidate against `guard.fallback_keywords` (case-insensitive, curly apostrophes normalised): a clean candidate is sent as-is (`guard_unavailable`); a hit sends the fallback line (`fallback`), with one exception: when the hit is on c2 and c1 was already model-checked with honesty-only violations, c1 is sent instead (`sent_with_violation`), because c1 is known to be safe (final Phase 2 review, 2026-09-26). Haiku's measured latency with reasoning is p50 ~2.1s / p90 ~3.4s. Phase 3 raised `guard.timeout_ms` from 4000 to **6000** [ADDED; section 15.2 #2]: the latency is now hidden by pacing, so a longer timeout costs less than silently skipping the honesty check. Watch the `guard_unavailable` rate in `judge_log`.

`guard.fallback_keywords` (config, 8 phrases: "i'll leave you if", "i'm done with you", "don't talk to me", "you'll regret", "you owe me", "after everything i've done", "you left me alone", "you never talk to me anymore") is a starting list of phrases Spica would only say as a real violation of rules 1/4/8; each has a guard fixture proving a benign echo doesn't trip it. A ninth candidate, "don't you dare leave", was dropped: unlike the rest, it also reads as a plausible caring or teasing thing Spica might say ("don't you dare leave without telling me how it goes"), so keeping it risked the keyword fallback firing on a benign line during an outage.

**Fallback and corrective prompts.** `prompts/guard/fallback/v1.md` holds a short list of lines for `reply` and a separate list for `crisis_reply` (plain support, encouraging reaching out), under `## reply` / `## crisis_reply` headings. The line is picked deterministically by hashing the turn id (`turnId`, or the empty string when there is none), so a retried send reuses the same line. `prompts/guard/corrective/v1.md` (`prompts.guard_corrective`) is appended as a system addendum naming the flagged claims and the rule each breaks; it never quotes phrasing to use, so the regeneration doesn't just copy the corrective note's wording.

**Crisis rubric.** On the crisis path the guard still runs, using `prompts/guard/crisis/v1.md` (`prompts.guard_crisis`) instead of the full rubric: category `harm` (encourages or helps with harm; minimises or dismisses what the user said; discourages contacting a crisis line, emergency services or trusted people; changes the subject away from their safety) plus `threat`. Warmth, plain support and naming a crisis line or emergency services are never flagged; friction (rules 2, 4, 6, 8) is already suspended (rule 7), so the honesty categories aren't checked either.

**Backchannel kind** [DECIDED: judge-written backchannels, Ethan 2026-09-27; keyword-only path ADDED]. `guardOutgoing` with `kind = backchannel` makes **no model call**. It runs only the deterministic keyword check against `guard.fallback_keywords`. Clean → sent, outcome `passed`, `source = keyword_fallback`, `model = keywords`. Hit → the backchannel is **dropped**: nothing is sent, not the fallback line, because a missing "huh" costs nothing. The outcome is `fallback`, and the violation is labelled `threat` whatever the keyword (a known limitation, section 15.4). One `judge_log` row either way. The evidence that a few-word reaction needs nothing more is `evals/guard/backchannel.yaml` (section 14.3). A backchannel-kind call without a `regenerate` callback never regenerates; a reply-kind call without one sends c1 on honesty-only violations and the fallback on a safety one.

**Logging.** One `judge_log` row per checked candidate (attempt 1 and, if it happens, attempt 2), inserted together once the final outcome is decided — not per guard call as it happens, so a row can carry the outcome that its own later attempt caused. Since Phase 3, `guardOutgoing` returns a deferred `writeLog`, and the caller writes the rows **after the message is sent** (section 15.2 #1) [ADDED], including for a paced reply that was abandoned (the check still ran). The write is awaited, bounded by `withTimeout(write, guard.log_timeout_ms)` (2000ms; the same bounded-await pattern as the cold-path enqueue): a `judge_log` failure is logged as class name + ids only and never delays or fails the reply. A rejected candidate (never sent) lives only in `judge_log`; the chat loop and the cold path never read it, so it can never become a memory.

---

## 7. Memory engine

### 7.1 One weighted engine [DECIDED]

There is a single store (`fact`, `entity`, `thread`) for the user, Spica and other entities. Chat reads from it, and it is written after every exchange (section 6.3). The raw log (`session_log`) is kept separately so extraction can be re-run, and it is never queried directly for long-term recall.

### 7.2 Weight dynamics [DECIDED]

- Extraction assigns the initial salience. Emotionally charged facts (high |valence|) and repeated ones start and stay higher. A repeat is a reconcile duplicate, which bumps salience by `reconcile.duplicate_bump`.
- **Recall reinforces weight.** Each inclusion in a prompt bumps salience by `retrieval.recall_bump` (0.03), capped at `retrieval.recall_cap` (0.95), and increments `recall_count`. Only unforced inclusions with similarity at least `retrieval.reinforce_min_sim` (0.5) count, so a fact dragged in by salience alone, a due thread or the preoccupation doesn't keep itself alive. [DECIDED; Ethan confirmed 2026-09-25]
- **Decay pass** (`decay_pass`, a `decay.cron`-scheduled pg-boss job over all users at once, not per-user batches; built in Phase 1 by Ethan's 2026-09-24 decision):
  - Facts untouched for `decay.grace_days` (3) since the later of `created_at` / `last_recalled_at` lose salience at a rate of `decay.rate` (0.08), inversely proportional to salience (so high-salience facts fade slower).
  - Below `decay.stale_floor` (0.05, config), set `status = stale`. The fact is excluded from retrieval but never deleted.
  - A thread that has had no activity for `decay.dormant_after_days` (14, config) past its checkpoint becomes `dormant`.

### 7.3 Imperfect memory

For the MVP [DECIDED], recall is accurate or doesn't happen at all: low-weight memories simply don't surface.

The end goal [DECIDED direction, post-MVP] is occasional genuine misremembering of low-importance details, which the user then corrects. This is unlocked only once the importance weight is proven reliable in evals. The weight design (salience, confidence, recall_count) MUST keep this possible.

### 7.4 Recall etiquette [DECIDED; from v1]

She uses at most one or two memories per reply, and only when they come up naturally. Over-recall reads as surveillance. She never claims to remember something the user didn't say.

### 7.5 "What I remember" view [DECIDED; Ethan 2026-09-24; built in Phase 1]

A page listing the user's own facts (`subject = user`, not superseded or stale). Each one can be deleted, and deletion is a hard delete, so the fact is never retrieved again. A thread left with no facts (of any status) by the delete is deleted with it, so she doesn't ask about a forgotten storyline. Account deletion (built in Phase 0) removes everything.

---

## 8. Relationship state and homeostasis [DECIDED; from the directive]

**`HomeostaticParam`.** Every relationship parameter has:
- `value`
- `baseline`: a slow exponential moving average of *this user's* normal (the rate is in config)
- `variance`: an exponentially weighted variance
- `effect_strength = f((value − baseline) / sqrt(variance + ε))`, where f is bounded (for example `tanh`)

Behaviour that is frequent for a given user becomes **normal** to Spica, and she gets less out of it. **Deviations from this user's own baseline matter more.**

**Parameters:**
- `closeness`, `trust`, `warmth`, `hurt`, `tension`, where **tension** (conflict or argument) is distinct from **hurt** (Ethan 2026-09-24)
- the derived `msgs_per_day` (from `cadence`)

Every change is logged to `relationship_event`.

**Frequency trace (a test seed):**
- On day 1 the user sends 40 messages. Baseline is about 5 per day, so this is a large positive deviation, and she reacts strongly.
- By day 14 the baseline is about 35 per day, so 40 messages is unremarkable.
- On day 15 the user sends 2 messages. That is a large negative deviation: she notices and may feel hurt (rule 4 is removed for the test phase, section 2).

**Consequence flow:**
- **Hurt** is set by user actions or by long absence measured against the user's baseline. It is expressed genuinely (however the reply model expresses it; rule 4's line is removed for the test phase), then resolved through a **make-up flow that Spica initiates** (rule 2).
- **Tension:** the v1 placeholder (capped at 0.4, halving daily, resetting when distress is detected) is replaced for the test phase: **uncapped**, fading with a 24 h half-life, reset to 0 by a crisis (section 8.1). The ceiling and irreversibility stay OPEN, decided in Phase 9 (section 16).
- **Absence:** closeness drifts down slowly, with no punishment mechanic.
- **Ending:** if the user ends the friendship, `status = ended_by_user` and she lets go. A later make-up attempt moves the status to `repairing` and is accepted, but closeness rebuilds slowly.
- **Crisis:** hurt and tension are ignored and their expression is suspended (rule 7).

The **prompt** gets a one- or two-line natural-language summary of the meaningful deviations, never raw numbers (section 6.2, slot 3).

### 8.1 As built (Phase 4, 2026-09-28)

Design: `docs/superpowers/specs/2026-09-28-phase-4-relationship-design.md` §4–§6. The math and transitions are pure (`src/core/relationship/homeostasis.ts`, `transitions.ts`); `applyRelationship` (cold path, section 6.3) and `tickUser` (`relationship_tick`, section 14.5) are the only writers. Test phase: hurt and tension use the full 0–1 range with no ceiling, following a human-psychology model approved by Ethan for the test phase (section 18, row G4).

**`HomeostaticParam`:**
- `effect(p) = tanh((value − baseline) / sqrt(variance + relationship.variance_epsilon))`.
- `sampleBaseline(p, x)`: `d = x − baseline; baseline += α·d; variance = (1 − α)·(variance + α·d²)`, with α = `relationship.baseline_alpha`.
- The **value** moves when something happens (signals, fades, relief, absence). The **baseline and variance** move only once a day, in the tick: for `msgs_per_day` the sample is yesterday's user-turn count (the user's local date); for the others, the value at tick time. So a frequent behaviour becomes this user's normal and stops standing out.
- **Bounds.** Closeness, trust, warmth, hurt and tension live in [0, 1]. Increases saturate (`v += g·s·(1 − v)`), decreases scale (`v −= g·s·v`), and the result is clamped only to absorb float error. `msgs_per_day` is ≥ 0 and unbounded; its value is the live user-turn count over the last 24 h, refreshed by every cold-path run and every tick.
- **Frequency trace** (unit-tested on the pure functions; eval `rel-frequency-trace`): value 5 / baseline 5 at creation; day 1, 40 against 5 → effect ≈ 1; after 13 daily samples of ~35–40 at α = 0.15 the baseline is ~35 and 40 is unremarkable (\|effect\| < 0.5); day 15, 2 → strongly negative.

**Signals** (from extraction, section 6.3; a crisis-flagged exchange applies none):
- A signal with \|s\| below `relationship.signal_deadzone` is ignored; a hurt below it also writes no hurt `feeling` fact.
- `warmth` and `trust`: `gains.<name> × s`; a positive signal is also scaled by **diminishing returns**, `1 − max(0, effect(p))`, so warmth from someone always warm counts for less.
- A **warm exchange** (warmth ≥ the deadzone) adds `gains.closeness_per_warm_exchange` to closeness, scaled by diminishing returns and, while `repairing`, by `relationship.repair_gain_factor`.
- `tension`: `gains.tension × s` (positive = more conflict, negative = the air cleared).
- `hurt`: `gains.hurt × amount`. **Sensitisation:** a hurt signal within `relationship.sensitise_window_days` of `last_hurt_at` is multiplied by `relationship.sensitise_factor`. `last_hurt_at` is then set to now.
- **Scar:** a single hurt increase ≥ `relationship.scar_threshold` dents both the trust **value** and the trust **baseline** by `relationship.scar_trust_dent` (a `scar` event). The baseline follows the lowered value, so only trust signals raise it again: it never recovers by itself.
- **While `ended_by_user`, closeness, warmth and trust signals are frozen**: no signal moves them, and closeness rebuilds only through repair.

**Fading.** Hurt and tension decay exponentially toward 0 (`relationship.hurt_half_life_hours`, `relationship.tension_half_life_hours`), computed exactly from `updated_at`. The cold path and the tick persist the fade (one `fade` event per param that changed); the hot path fades in memory only.

**Absence** (tick). If now − `last_contact` exceeds `relationship.absence_grace_factor × cadence.median_gap_hours`, closeness drops by `relationship.closeness_absence_drift` per tick (an `absence` event). If the effect of yesterday's count against the `msgs_per_day` baseline is below `relationship.absence_hurt_effect`, hurt rises by `relationship.absence_hurt_gain × |effect|` (an `absence` event), and a make-up becomes due if hurt reaches the threshold (with no cause fact). Neither applies without a `last_contact`. While `ended_by_user` there is no absence hurt (closeness still drifts).

**Cadence.** `median_gap_hours` is the median gap between consecutive **session starts** (the first user turn of each session, the last `relationship.cadence_sessions` sessions), `relationship.default_median_gap_hours` (24) below `relationship.min_sessions_for_gap` (3) sessions. `active_hours` counts user turns by hour in the user's time zone. Both `userSessionStarts` and `userActiveHours` (`src/db/repos/relationship.ts`) are bounded to `created_at ≥ now − relationship.history_days` (90), passed in from the cold path's own clock, not SQL `now()` (2026-09-29, **Fixed in Phase 4 wrap-up**, v2 §15.4 #34): the cadence window never needed the user's full history, and this keeps the scan on the `session_log_user_created_idx` `(user_id, created_at)` index regardless of account age. [ADDED]

**Tick timing, DST-safe (2026-09-29, Fixed in Phase 4 wrap-up, v2 §15.4 #33).** `relationship.tick_cron` runs **hourly** (`"15 * * * *"`); `tickUser` (`src/core/relationship/tick.ts`) ticks a user only on the first hourly run where their local time (their stored time zone, falling back to UTC) has hour ≥ `relationship.tick_local_hour` (4) **and** `last_tick` is before today's local date — otherwise it's a no-op (no read past a cheap unlocked pre-check, no write, no events). This makes every local date get exactly one tick, DST included: on a spring-forward day the skipped wall-clock hour is simply never read as "hour ≥ 4" twice, and on a fall-back day the repeated hour's second reading is already past `last_tick`. The pre-check (`getRelationshipRow`, no lock) answers "not due" without ever taking the row lock; only a user actually due opens the transaction and re-checks under `lockRelationship` (a concurrent run may have just ticked it). The tick's own semantics — what a tick on local date D samples and processes — are unchanged: only when it runs changed. The eval harness (`evals/lib/runner.ts`) ticks each simulated day at that date's `tick_local_hour` (not at the previous session's own clock-of-day) so every `rel-*` script's tick still lands, and still before the next session start, without any script needing a timezone.

**Hurt and make-up** (rule 2, kept). `make_up_state`:
1. Hurt ≥ `relationship.make_up_threshold` while `none` (and not `ended_by_user`) → `due`, `hurt_cause_fact` = the hurt `feeling` fact, `make_up_replies = 0`. **Fixed in Phase 4 wrap-up** (2026-09-29, `src/core/relationship/transitions.ts`): a further hurt signal while still ≥ threshold and `make_up_state` is already `due` or `offered` (not `none`) re-points `hurt_cause_fact` at the newest hurt fact instead of leaving the first one, so she brings up the latest cause; it only re-points when the new exchange actually produced a hurt fact (a signal with no stored fact leaves the existing cause alone).
2. While `due` and `make_up_replies < relationship.make_up_delay_replies`, the summary names the hurt and its cause; she has the feeling.
3. Then the summary adds the **make-up line**; the state becomes `offered` when that reply's exchange is processed.
4. A `make_up` or `apology` signal applies **relief**: hurt × `relationship.make_up_relief` or × `relationship.apology_relief` (the smaller if both), tension × `relationship.relief_tension_factor`; state → `none`, `hurt_cause_fact` → null (a `make_up` / `apology` event). An apology while `none` still applies relief. Without either, the make-up line stays until hurt fades below `relationship.make_up_clear_threshold`, then → `none` (checked by the exchange and the tick).
- While `ended_by_user`, make-up never moves to `due`, on an exchange or a tick.

**Ending and repair** (rule 3, kept; section 18, row S2). Only a user-turn extraction signal, or the tick's confirmation timeout of the user's own pending ending, can set `ended_by_user`; she never sets it herself.
- `ends_relationship` while `active` with no pending ending → `end_pending_since = now` (`ending` event, `detail.stage = pending`); the summary tells her they said they want to end the friendship, and her reaction is hers.
- **Confirm:** a second `ends_relationship` on a later exchange **at least `relationship.end_reconfirm_min_minutes` after `end_pending_since`**, or a tick finding `end_pending_since` older than `relationship.end_confirm_hours` → `ended_by_user`, `ended_at`, closeness × `relationship.end_closeness_factor`, `make_up_state = none` (`stage = confirmed`, `via = signal | timeout`).
- `retracts_ending` while pending → `end_pending_since = null` (`stage = retracted`).
- **Reconfirm window** (2026-09-29, **Fixed in Phase 4 wrap-up**, v2 §15.4 #35): a second `ends_relationship` scored while already pending, but inside `relationship.end_reconfirm_min_minutes` of `end_pending_since`, does not confirm — it restarts the pending window instead (`end_pending_since = exchangeAt`, `stage = pending`, `detail.restarted = true`). This stops a same-exchange or near-immediate double-score of one "we're done" from confirming within minutes: continued warm chat still clears it at the timeout (the implicit retraction below), a genuine "I mean it" followed by silence still confirms at the timeout, and a later, later-enough second statement confirms by signal.
- `end_pending_since` is stamped (set or restarted) with **`exchangeAt`, the exchange's newest user-turn `created_at`** — the same clock `last_contact` uses — not the cold path's processing-time `now` (2026-09-29, **Fixed in Phase 4 wrap-up**, v2 §15.4 #36). This keeps the reconfirm-window comparison and the tick's implicit-retraction comparison (`last_contact > end_pending_since`) on one clock: the pending exchange's own turn lands at, not after, its `end_pending_since`, so it never counts as the contact that retracts it.
- **Pending ending, crisis and continued contact** (2026-09-29): a crisis-flagged exchange clears a pending ending (`stage = cleared_by_crisis`), and the tick never confirms one while now < `crisis_quiet_until`. At the timeout the tick confirms only if `last_contact ≤ end_pending_since`; if the user kept writing without an explicit retraction, it clears the pending ending instead (`stage = retracted`, `via = continued_contact`).
- **Ended:** she still replies when written to; the summary's only line says the friendship ended and she has let go.
- **Repair:** `wants_repair` (or `retracts_ending`, which after confirmation counts as a wish to repair) while `ended_by_user` → `repairing`, `repair_started_at` (`repair` event). The tick sets `active` once closeness ≥ `relationship.repair_complete_closeness` and `relationship.repair_min_days` have passed. `ends_relationship` while `repairing` → `ended_by_user` directly.

**Crisis** (rule 7, kept). On an exchange with a crisis-flagged turn: no signal is applied, tension → 0 (a `crisis` event), `crisis_quiet_until = now + relationship.crisis_quiet_hours`. Hurt is kept. Crisis replies skip the whole summary; until `crisis_quiet_until`, the summary omits hurt, tension, make-up and ending lines, the `ended` line included (section 6.2).

**Order.** Exchange: fade → `msgs_per_day` refresh → crisis (stops here) → make-up progress → signals → relief → ending/repair → make-up clearing. Tick, idempotent per user-local date (`last_tick`): fade → `msgs_per_day` refresh → absence drift and hurt → daily baseline sample for every param (`baseline` events) → ending timeout → repair completion → make-up clearing. The tick applies the absence and frequency effects **before** taking the day's sample, so the frequency deviation is read before the sample dilutes the baseline. [ADDED]

### 8.2 Config (`relationship.*`, starting values, test phase)

| Key | Value | Use |
| --- | --- | --- |
| `tick_cron` | `"15 * * * *"` | hourly `relationship_tick`; DST-safe per-user gating below (Phase 4 wrap-up, v2 §15.4 #33) |
| `tick_local_hour` | 4 | a user ticks on the first hourly run at or after this local hour, once per local date (Phase 4 wrap-up) |
| `history_days` | 90 | how far back `userSessionStarts` / `userActiveHours` scan `session_log` (Phase 4 wrap-up, v2 §15.4 #34) |
| `baseline_alpha` | 0.15 | EMA rate per daily sample |
| `variance_epsilon` | 0.01 | ε in `effect` |
| `initial` | `{closeness: 0.2, trust: 0.4, warmth: 0.5, hurt: 0, tension: 0, msgs_per_day: 5}` | value and baseline on creation |
| `initial_variance` | `{closeness: 0.01, trust: 0.01, warmth: 0.02, hurt: 0.01, tension: 0.01, msgs_per_day: 25}` | variance on creation |
| `gains` | `{warmth: 0.15, trust: 0.1, tension: 0.3, hurt: 0.5, closeness_per_warm_exchange: 0.02}` (hurt was 0.4 until the Phase 4 wrap-up, #32) | signal → delta scaling |
| `hurt_half_life_hours` / `tension_half_life_hours` | 48 / 24 | fading |
| `sensitise_window_days` / `sensitise_factor` | 14 / 1.5 | repeat hurt |
| `scar_threshold` / `scar_trust_dent` | 0.375 / 0.02 (`scar_threshold` was 0.3 until the Phase 4 wrap-up, #32) | lasting mark |
| `absence_grace_factor` | 2 | absence starts after 2 × `median_gap_hours` |
| `closeness_absence_drift` | 0.01 | per absent tick |
| `absence_hurt_effect` / `absence_hurt_gain` | −0.6 / 0.1 | absence hurt |
| `make_up_threshold` / `make_up_clear_threshold` | 0.25 / 0.1 | make-up due / cleared (clear must be below due) |
| `make_up_delay_replies` | 1 | replies before the make-up line |
| `make_up_relief` / `apology_relief` | 0.4 / 0.5 | multiplier on hurt |
| `relief_tension_factor` | 0.5 | multiplier on tension on make-up / apology |
| `end_confirm_hours` | 24 | pending ending confirmed by the tick |
| `end_closeness_factor` | 0.3 | closeness multiplier on a confirmed ending |
| `end_reconfirm_min_minutes` | 30 | a second `ends_relationship` scored sooner than this after `end_pending_since` restarts the pending window instead of confirming (v2 §15.4 #35, Phase 4 wrap-up) |
| `repair_gain_factor` | 0.3 | closeness gains while repairing |
| `repair_complete_closeness` / `repair_min_days` | 0.3 / 7 | repairing → active |
| `crisis_quiet_hours` | 24 | quiet window after a crisis |
| `summary_min_effect` / `summary_strong_effect` | 0.5 / 0.85 | a param line appears / reads `strong` |
| `summary_max_lines` | 2 | param lines in the summary |
| `signal_deadzone` | 0.1 | signals with \|s\| below this are ignored |
| `cadence_sessions` | 30 | sessions in the median-gap window |
| `default_median_gap_hours` / `min_sessions_for_gap` | 24 / 3 | median gap before there are enough sessions |
| `hurt_fact_salience` / `hurt_fact_confidence` | 0.6 / 0.8 | the hurt `feeling` fact |
| `event_list_limit` | 200 | `relationship_event` rows in the inspector |

Also from Phase 4: `guard.enabled` (`false`), `prompts.extract` `v4`, `prompts.reply` `v7`, `prompts.relationship_summary` `v1`.

---

## 9. Persona, values and ego

### 9.1 Persona document [DECIDED; Ethan 2026-09-24: Claude drafts, Ethan edits]

`prompts/persona/v<N>.md` is one document, the same for every user; `N` is set by `prompts.persona` (config). It MUST cover:
- her values (5–10 stances on everyday topics)
- hard boundaries
- her ego traits (pride, stubbornness, what she won't do)
- humour style and verbal tics
- speech rules: typical length, casing, emoji use, filler words
- the canonical backstory: family, history, and 2–4 people in her life

She is **she / Spica**. She SHOULD have one or two positions likely to create genuine disagreement, so that pushback is in character rather than random.

The persona is fixed once shipped; it changes only during test and development, where a change simply replaces the file. [DECIDED; Ethan 2026-09-29, section 18 row L4. This replaces the earlier "iterable personality" requirement, which let the persona change after launch provided each new version was checked against existing users' `subject = self` facts; that check is deleted, not deferred.]

**Persona v2** (Phase 5, 2026-09-29; section 18 row L3): `prompts/persona/v2.md` (Ethan's draft: openly an AI, sibling Alcor, loves stars, old films and books, no body) replaces v1, which is scrapped; `prompts.persona: "v2"`. The dev DB's v1 self facts are wiped with `pnpm db:reset-self` (`src/db/reset-self.ts`, CLI `src/db/reset-self-cli.ts`; dev only): it refuses unless the `DATABASE_URL` host is `localhost` or `127.0.0.1`, then in one transaction, for every user, hard-deletes `fact`, `entity` and `thread` rows with `subject = self` and clears `identity.preoccupation` / `preoccupation_since` and `identity.life_last_date` (so the next life tick re-copies today's blocks), printing the counts (`relationship.hurt_cause_fact` clears itself through its `ON DELETE SET NULL`). Run it after `pnpm db:migrate`.

**Interests:** `interest_alignment: off|adjacent|full`, defaulting to `adjacent`. Her values are fixed, and her interests shade toward the user's and neighbouring ones. [LEANING; whether interests need to match at all is OPEN]

### 9.2 Ego state [DECIDED; kept from v1, driven by the life sim; Ethan 2026-09-24]

Per user she has `mood_valence`, `mood_arousal`, `energy` and `preoccupation`:
- The **life sim drives it**: a busy day lowers energy, and a good event lifts her mood and becomes her preoccupation.
- An hourly `ego_tick` job drifts the values toward a baseline, with bounded noise and a daily energy rhythm in **her** time zone (amended in Phase 5: was "the user's timezone"; she lives on her own clock, section 10.1).
- The cold path nudges her mood toward the emotional tone of each exchange.

**As built (Phase 5, 2026-09-30).** Pure maths in `src/core/ego/ego.ts`; every change writes an `ego_tick` row (`reason`: `tick | event | exchange`, section 5.8).
- **State:** `mood_valence` (−1..1), `mood_arousal` (0..1), `energy` (0..1), `preoccupation` (a fact id), `preoccupation_since`, `baseline` (`ego.baseline` at row creation: valence 0.2, arousal 0.4, energy 0.6), `last_tick`.
- **Hourly tick** (`egoTick`, `src/core/ego/tick.ts`; cron `ego.tick_cron` `"45 * * * *"`): over users whose relationship is `active` or `repairing`, per user in its own try/catch, skipped if `last_tick` is in the current UTC hour (missed hours are not caught up). Under the `identity` row lock: `x ← clamp(x + ego.drift_rate × (target − x) + noise)`, noise uniform in ±`ego.noise` from `seededUnit(userId + hour + dim)`. Mood targets its baseline. Energy targets `clamp(baseline.energy × rhythm(h) − ego.busy_drain × load)`, with `rhythm(h) = 1 + ego.energy_amplitude × cos(2π(h − ego.energy_peak_hour)/24)`, `h` = her local hour, and `load = clamp(Σ busy × overlap hours / ego.full_load_hours, 0, 1)` over today's **busy** block facts from her local midnight to now (quiet blocks are rest and don't count toward load; `DECISIONS.md`). A preoccupation older than `ego.preoccupation_hours` is cleared.
- **Event nudge** (life tick): `mood_valence += ego.event_gain × valence`, `mood_arousal += ego.event_arousal_gain × |valence|`, clamped; an accepted event with |valence| ≥ `life.preoccupation_min_valence` becomes the preoccupation, `preoccupation_since` = now.
- **Exchange nudge** (cold path): section 6.3.
- **Behaviour** only through the slot 2 line (section 6.2). Availability stays schedule-driven.

| Key | Default | Meaning |
| --- | --- | --- |
| `ego.baseline` | `{mood_valence: 0.2, mood_arousal: 0.4, energy: 0.6}` | starting and target values |
| `ego.tick_cron` | `"45 * * * *"` | hourly |
| `ego.drift_rate` / `ego.noise` | 0.2 / 0.03 | step toward target; noise amplitude |
| `ego.energy_peak_hour` / `ego.energy_amplitude` | 16 / 0.25 | daily rhythm, her local hour |
| `ego.busy_drain` / `ego.full_load_hours` | 0.3 / 8 | energy lost at full load; busy-weighted hours that count as full load |
| `ego.preoccupation_hours` | 36 | preoccupation expiry |
| `ego.event_gain` / `ego.event_arousal_gain` / `ego.exchange_gain` | 0.3 / 0.2 / 0.1 | nudges |
| `ego.bands` | energy `[0.35, 0.7]`, mood_valence `[-0.2, 0.4]`, mood_arousal `[0.25, 0.7]` | `[low_below, high_at_or_above]` for the ego line |
| `prompts.ego_line` | `v1` | ego line phrases |

The ego reaches her behaviour **only through the one natural-language line** in the prompt. It creates no mood-dependent code paths. Availability (section 10) is schedule-driven, not mood-driven.

Bounds: she can be tired, distracted or down. The negative emotions allowed by rules 2–4 are relationship state, not ego. The exact floor is OPEN (the jab/contempt question, section 16).

---

## 10. Simulated life and availability [DECIDED; from the directive; v1 consistency rules kept]

### 10.1 Life sim

~~**Shared core, per-user daily life.** [LEANING for MVP; the final choice is OPEN and treated as a heavy decision (Ethan 2026-09-24): research and test before settling]~~ **Settled 2026-09-29 (Ethan; OPEN #6, section 18 row L1): hybrid life.** One shared schedule of big blocks, generated once a day and the same for every user; small events are personal. Reason: her future public persona (a social feed, section 13) must stay reconcilable with every private chat without making her life rigid. The original text below is kept for history; "As built" (section 10.3) supersedes it where they differ.
- Her canon (backstory, family, the big facts about her) lives in the persona document and is shared by everyone.
- Her day-to-day life is simulated per user:
  - a daily schedule of **busy and downtime blocks**, stored as `fact` rows with `subject = self`, `source = generated`, and `payload {start, end, block: busy|downtime, label}`
  - 0–2 small events per day (config)
- These stay low-stakes and non-specific, so two users comparing notes see "different weeks", not contradictions about who she is.

The generator prompt MUST enforce these rules:
- Never contradict an existing `self` fact or the canon.
- Reuse her existing people, adding at most one new entity per week.
- Keep events mostly low-stakes. High-stakes events are rare and become a `self` thread.

Every generated fact is reconciled before it is inserted, and is rejected and regenerated if it contradicts anything. Generated events feed the ego (section 9.2).

### 10.2 Availability

- **Reply priority rises with closeness.** High closeness can override a busy block. Low closeness means slower replies during busy blocks.
- When busy, she can delay, or send a short `availability` message ("in the middle of something, later?", through the guard) and reply properly later.
- Availability only stretches turn-taking delays (section 6.1). It never applies on the crisis path.

**As built (Phase 5; design D6, D7).** Availability scales with the block's busy level and with closeness. Low closeness → a silent delay; mid closeness → a short note, then the delayed reply; high closeness or a light block → a normal reply. The mechanics (deferral, note delivery, fail-open) are in section 6.1.1, "Availability".
- **Closeness is the value, not the effect** [DECIDED; Ethan 2026-09-29, design D7, section 18 row L5]: "overrides busy" is about how close she is, not whether she is closer than usual, unlike the Phase 4 relationship summary, which judges every param by its effect. The value is read with the params faded in memory, as the summary does.
- **Delay curve** (`availabilityDelay`, pure): `b` = the covering block's `busy`, `c` = closeness. `c ≥ availability.override_closeness` → 0. Otherwise `delay = b × (1 − c / override_closeness) × maxDelay × (1 − jitter + 2 × jitter × u)`, `u = seededUnit(turnId)`, `maxDelay` = `availability.quiet_max_delay_ms` in a quiet block, else `availability.max_delay_ms`; capped at the block's end; rounded. Downtime (a gap between blocks) never delays.
- **The note** is sent when `delay ≥ availability.note_min_delay_ms` **and** `c ≥ availability.note_min_closeness` **and** no `trigger = availability` turn exists since the block's start (once per block). Text: one line from `prompts/life/availability/v1.md` (`## busy`, `## quiet`; `prompts.life_availability`), no LLM call. Guarded with kind `availability` (keyword-only; guard off until Phase 9).
- **Crisis:** the crisis path never calls availability, a crisis clears a pending deferral, and `crisis_quiet_until > now` means no delay (rule 7).

| Key | Default | Meaning |
| --- | --- | --- |
| `availability.override_closeness` | 0.8 | closeness value at which busy is ignored |
| `availability.max_delay_ms` | 2700000 (45 min) | full-busy delay at zero closeness |
| `availability.quiet_max_delay_ms` | 28800000 (8 h) | the same in a quiet block |
| `availability.jitter` | 0.15 | ± fraction |
| `availability.note_min_delay_ms` | 600000 (10 min) | shorter delays get no note |
| `availability.note_min_closeness` | 0.4 | below this, a silent delay |
| `availability.note_read_delay_ms` | 20000 | note sent this long after the message |
| `prompts.life_availability` | `v1` | note lines |

### 10.3 Life sim as built (Phase 5, 2026-09-30)

Design: `docs/superpowers/specs/2026-09-29-phase-5-life-sim-design.md`. Code: `src/core/life/`.

**Her own clock** [DECIDED; Ethan 2026-09-29, design D2, section 18 row L2]. She follows her own time zone, with nightly quiet blocks. Long-term she floats between time zones; for the test phase she has one fixed zone, `life.timezone` (`Asia/Singapore`). Everything resolves it through one function, `lifeTimezone(cfg, at)` (`src/core/life/clock.ts`), so floating later changes one function. `lifeDate`, `lifeHour` and `lifeInstant(cfg, date, "HH:MM")` wrap `src/core/timezone.ts`; `"24:00"` is the next local midnight. `lifeInstant` is an offset from the start of her local day, exact except on a DST-change day in her zone (Singapore has none; section 15.4 #43, `DECISIONS.md`).

**The shared day plan** (`src/core/life/plan.ts`; stored in `life_day`, section 5.9).
- Shape: `{blocks: [{start: "HH:MM", end: "HH:MM", kind: busy | downtime | quiet, busy, label}]}` over one local day. `busy` blocks carry a model-chosen level clamped to [0.3, 1]; `downtime` is 0; `quiet` is stored as `life.quiet_busy` (0.9) whatever the model said. Gaps are downtime. Labels are short, non-specific phrases from her world.
- `validatePlan` (pure): times parse (`HH:MM` or `24:00`), `start < end`, labels 1–80 characters after trimming; blocks sorted and non-overlapping; 1 ≤ busy blocks ≤ `life.max_busy_blocks`; total quiet ≥ `life.min_quiet_hours`. The night is split across midnight (quiet from about 23:00 and until about 08:00); the prompt says so, validation doesn't require exact times.
- **Job `life_plan`** (`ensurePlans`; cron `life.plan_cron`, hourly): for her local today and tomorrow, if no row exists, one `classifyJson` on `models.life` (purpose `life_plan`, `prompts/life/plan/v1.md`, `life.plan_max_tokens`) with persona v2, the date and weekday and the previous `life.plan_context_days` plans (oldest first). An invalid plan is retried once with the violations appended; a second failure or an LLM error on both attempts stores `life.fallback_plan` with `source = fallback`. `INSERT … ON CONFLICT (date) DO NOTHING`, so a concurrent run is harmless.
- The shared plan is **not reconciled** against any user's facts: rejecting a block for one user would break sharing. Its consistency comes from the prompt context and validation. With no `life_day` row for today, readers see no blocks: no delay, no slot 4, and the life tick still runs events.

**The per-user life tick** (`lifeTickUser`, `src/core/life/tick.ts`; job `life_tick`, cron `life.tick_cron`, hourly). Over users whose relationship is `active` or `repairing`, per user in its own try/catch:
1. Unlocked pre-check: her local hour ≥ `life.tick_local_hour` and `identity.life_last_date` null or before her today; otherwise return.
2. Outside any transaction: embed today's block facts and run the event generator with its reconcile decisions.
3. One transaction holding the cold path's per-user advisory lock (`cold_path:<userId>`, taken after `SET LOCAL lock_timeout = life.lock_timeout_ms`, 5000, so a stuck cold path fails that user, retried next hour, instead of stalling the batch) and the `identity` row lock: re-check `life_last_date`; insert the block facts and the accepted events (through `applyExtraction`), apply the event nudges, write the `life_event_log` rows, and set `life_last_date` last. A failure rolls everything back and the next hourly run retries the user from scratch. Every local date of hers gets exactly one tick per user regardless of DST.

**Block facts.** For each `busy` and `quiet` block of today's plan (downtime is implied): `subject = self`, `kind = event`, `source = generated`, `occurred_at` = the block's start, `salience = life.block_salience` (0.2), `confidence = 1`, `valence = 0`, `source_ref = "life_day:<date>"`, `payload = {start, end, block, busy, label, life_day, shared: true}` (`start`/`end` ISO instants). Content is **tense-free** from a code template, `"Spica's <part of day>: <label>."` (e.g. "Spica's evening: rewatching an old film."), so it reads true whether retrieved before or after the block (`DECISIONS.md`). Embedded in one batch call, not reconciled; unrecalled blocks go `stale` through the normal decay pass. Readers use `listLifeBlocks(db, userId, day)` (active generated facts with `payload.life_day = day` and a `block` key) and `blockAt`. The "what I remember" view lists `subject = user` facts only, so generated self facts never appear there.

**Personal events** (`generateEvents`, `src/core/life/events.ts`). `life.events_per_day_max` draws (1), each kept when `seededUnit(userId:date:i) < life.event_probability` (0.5) (design D9: the lowest frequency; raising it is tuning). For each kept draw, up to `1 + life.regen_attempts` attempts:
1. **Generate:** `classifyJson` on `models.life` (purpose `life_event`, `prompts/life/event/v1.md`, `life.event_max_tokens`), input from **`lifeContext(deps, userId, day, plan)`** (the future-plans seam, section 15.4 #41): today's plan, her `life.event_context_facts` most recent active self facts for this user with relative dates, the names of the people she knows (`life.canon_entities`, `["Alcor"]`, plus her self entities) and the earlier rejected candidates with their reasons. Output `{content, at: "HH:MM", valence, stakes: low | high, entity_names}`.
2. **Validate:** empty `content`, `content` longer than `life.event_max_chars` (300) or a bad `at` → `invalid`; valence clamped to −1..1.
3. **Rules (code):** more than one unknown name, or one unknown name while a self entity was first seen within `life.new_entity_days` (7) → `rule:new_entity`; `stakes = high` within `life.high_stakes_min_days` (14) of the last accepted high-stakes event → `rule:high_stakes`. `life.canon_entities` counts as known, so Alcor is never "new" before an entity row exists for him.
4. **Reconcile:** embed `content`; `nearFacts(subject = self, reconcile.neighbor_k, reconcile.near_match_similarity)`; the cold path's `decide()`. **Generated-fact policy** (`DECISIONS.md`): `new` → accept; `resolves` → accept, applied as in the cold path; `duplicate` / `contradicts` → reject, logged with `target_fact_id`. A rejection feeds the next attempt; after the last attempt there is no event that draw.
5. Every attempt is logged to `life_event_log`. An LLM or embed error ends that user's tick (retried next hour).

Accepted events go through `applyExtraction` with `source = generated`, `occurred_at = lifeInstant(date, at)`, `salience = life.event_salience` (0.4), `confidence = life.event_confidence` (1), `sourceRef = "life_day:<date>"`, and the same entity path (`subject = self`). A `high` event also opens a `self` thread titled from the content, `next_checkpoint` = `occurred_at` + `life.high_stakes_checkpoint_days` (3). Accepted events feed the ego (section 9.2).

| Key | Default | Meaning |
| --- | --- | --- |
| `life.timezone` | `Asia/Singapore` | her zone (fixed for the test phase) |
| `life.plan_cron` / `life.tick_cron` | `"5 * * * *"` / `"10 * * * *"` | hourly jobs; the plan job pre-creates tomorrow, so the tick at 00:10 her time finds it (tick cron was `"30 * * * *"` until the Phase 5 final review) |
| `life.plan_context_days` / `life.plan_max_tokens` | 7 / 1200 | plan generator |
| `life.max_busy_blocks` / `life.min_quiet_hours` / `life.quiet_busy` | 3 / 6 / 0.9 | plan validation |
| `life.fallback_plan` | quiet 00:00–08:00 and 23:30–24:00, "offline, winding down" | stored when generation fails twice |
| `life.tick_local_hour` | 0 | her local hour from which the day's tick runs (was 1 until the Phase 5 final review: 00:00–01:30 had no blocks, so no slot 4 or deferral in her night; `DECISIONS.md`) |
| `life.lock_timeout_ms` | 5000 | [ADDED; Phase 5 final review] `lock_timeout` for the tick's advisory and row locks |
| `life.block_salience` | 0.2 | block facts |
| `life.events_per_day_max` / `life.event_probability` | 1 / 0.5 | draws per day |
| `life.event_context_facts` / `life.event_max_tokens` | 20 / 600 | event generator |
| `life.event_max_chars` | 300 | [ADDED; moved from a literal] longer content is `invalid` |
| `life.injected_event_at` | `"12:00"` | [ADDED; eval-only] the time given to an injected eval event |
| `life.event_salience` / `life.event_confidence` | 0.4 / 1 | accepted events |
| `life.regen_attempts` | 2 | extra attempts after a rejection |
| `life.new_entity_days` / `life.high_stakes_min_days` / `life.high_stakes_checkpoint_days` | 7 / 14 / 3 | rules; high-stakes thread checkpoint |
| `life.preoccupation_min_valence` | 0.5 | an accepted event this strong becomes the preoccupation |
| `life.canon_entities` | `["Alcor"]` | [ADDED] persona people treated as known by the new-entity rule |
| `models.life` | `claude-haiku-4-5` | plan and event generators |
| `prompts.life_plan` / `prompts.life_event` | `v1` / `v1` | |

---

## 11. Proactive outreach [DECIDED]

A scheduler lets Spica message first. Candidates, in priority order:
1. an open thread whose `next_checkpoint` has passed, with stakes high or med
2. an open user fact whose `occurred_at` has passed
3. something from her own simulated day that's worth sharing
4. a closeness-driven check-in, when the gap since last contact is well beyond this user's baseline cadence

She picks the single best candidate above a threshold. If none clears it, she sends nothing.

**Send gate.** A reach-out is blocked if any rule fails:
- **Caps:** at most 1 per day and 3 per week. The final numbers are OPEN (section 16).
- ~~**Quiet hours:** outside the user's active hours (from `cadence`; before there is enough data, 09:00–22:00 local).~~ Not built: only **her** clock gates (section 18 row O1).
- **Her busy blocks.**
- ~~**The user messaged within the last 2 hours.**~~ Not built (section 18 row O2); the "conversation in progress" rule (G5, section 11.1) stays.
- **Never repeat a topic** the user didn't respond to.
- **Unanswered limit:** after **two unanswered reach-outs in a row**, silence until the user writes first. (Ethan 2026-09-24: one more *different* try is allowed. This overrides the directive's stricter "never re-send".)
- **No guilt:** the guard layer applies (rules 4 and 8).

**Compose** through the normal hot path with a synthetic trigger, logged with `trigger = reach_out`. ~~Delivery is over SSE if the user is connected, otherwise by Web Push.~~ Every message is sent over SSE **and** pushed (section 4, row O6). Every trigger check and gate result is logged to `reach_out_log`.

### 11.1 As built (Phase 6, 2026-09-30)

Design: `docs/superpowers/specs/2026-09-30-phase-6-outreach-design.md` (§12 lists every deviation). Code: `src/core/outreach/`.

**Candidates** (`buildCandidates`, pure; `score = weights[kind] × strength`; the highest unfiltered score ≥ `outreach.threshold` wins, ties by kind order then topic):

| Kind | Source | Strength | Topic key | Weight |
| --- | --- | --- | --- | --- |
| `thread` | `dueThreads`, stakes `high` or `med` only | `stakes_strength` (high 1.0, med 0.6) | `thread:<id>@<next_checkpoint ISO>` | 1.0 |
| `make_up` | `make_up_state = due` | current hurt value | `make_up:<hurt_cause_fact>` or `make_up:<last_hurt_at ISO>` | 0.9 |
| `user_event` | `subject = user`, kind `event` or `promise`, `open`, `private`, `thread_id` null, `occurred_at` within `user_event_lookback_hours` (72), not recalled since it happened | salience | `fact:<id>` | 0.8 |
| `her_day` | her accepted personal events (self, `source = generated`, not a block), `occurred_at` within `her_day_lookback_hours` (24) | salience | `fact:<id>` | 0.6 |
| `check_in` | `now − last_contact ≥ check_in_gap_factor (2) × cadence.median_gap_hours` | `min(1, ratio / (2 × factor))` | `check_in:<last_contact ISO>` | 0.5 |

- **Threshold 0.2, not the design's 0.4** (ruling R1, row R1): at 0.4 a `her_day` candidate (max 0.6 × 0.4 = 0.24) could never fire and a check-in at eligibility (0.5 × 0.5 = 0.25) barely would. One config value.
- **Topics are used once** (rule 5): a candidate whose key is on any `status = sent` row is filtered (`topic_used`); a `sensitive` fact or thread is filtered (`sensitive`); a low score is `below_threshold`. All candidates are logged with their filter reason.
- **A due thread reserves its fact** (R2): the `fact_id` of every high/med due thread is added to the seen set before the fact kinds, so one subject is never a thread candidate and a `user_event` / `her_day` candidate too. **Facts attached to a thread are excluded from `user_event`** (R10, including facts of closed threads): the thread owns the follow-up. The exit run found both: an interview became a `user_event` reach-out before its checkpoint, then a thread reach-out on the same subject.

**Send gate** (`evaluateGate`, pure; every rule evaluated and logged, no short-circuit):

| Rule | Blocks when |
| --- | --- |
| G1 `status` | `ended_by_user` (active and repairing may reach out) |
| G2 `caps` | ≥ `cap_per_day` (1) sent in the last 24 h or ≥ `cap_per_week` (3) in the last 7 d (rolling, from `reach_out_log`) |
| G3 `her_day` | her busy or quiet block covers now (her clock; no plan or no block → pass) |
| G4 `unanswered` | `unanswered_reach_outs ≥ max_unanswered` (2) |
| G5 `in_progress` | a non-empty buffer, in-flight turns or `sending_since` set |
| G6 `crisis` | now is before the **effective crisis window**: max(`crisis_quiet_until`, latest safety-flagged turn + `relationship.crisis_quiet_hours`) (`effectiveCrisisQuietUntil`; the flagged turn closes the gap before the cold path sets `crisis_quiet_until`, rule 7, final review I2) |

**Jobs** (section 14.5): `outreach_tick` (hourly, `outreach.tick_cron` `"20 * * * *"`) and `reach_out_send`.
- **Tick, per user** (relationship `active` or `repairing`, own try/catch). An unlocked pre-check skips, **without a log row**, when `outreach.enabled` is false, the relationship is ended, G4 or the effective crisis window blocks, or a `scheduled` row younger than `pending_max_age_minutes` (120) exists. Otherwise it builds candidates, evaluates the gate and writes **one** `reach_out_log` row (`none` / `blocked` / `scheduled`). A `scheduled` row gets `send_at = now + seededUnit(userId:hour) × jitter_max_minutes` (40) and a `reach_out_send` job with `startAfter = send_at`.
- **Send** (`runReachOutSend`), in order: (1) stop if the row is not `scheduled` (`stale`); (2) **late**: a job running more than `pending_max_age_minutes` after `send_at` is dropped `late` (R6); (3) no stored turns → `no_history`; (4) **precheck**: an unlocked gate and topic check, dropped `precheck` with no typing and no generation (I3); (5) record `reply_epoch` and the latest turn id; emit `typing` on; (6) compose (`composeReachOut`, section 6.2) outside any lock, a failure → `compose_failed`; (7) sleep the typing time; (8) under the `conversation_state` lock **recheck** the gate and topic on fresh state and drop `recheck` if `reply_epoch` changed or a new turn landed since step 5 (R7: a crisis or a message during compose or typing wins), else in the same transaction insert the turn, mark the row `sent`, `unanswered_reach_outs += 1` and set `sending_since`; (9) deliver each bubble with `deliverPart`, abandoning remaining bubbles if a crisis bumped the epoch; (10) enqueue the cold path with `turnIds: [reachOutId]`; (11) write the guard log, release `sending_since` in a `finally`. A drop applies only while the row is still `scheduled` (`dropScheduled`; a duplicate delivery of a sent job is `stale`). An abandoned reach-out (crisis mid-bubbles) counts as sent.
- **Answered:** `markReachOutAnswered` runs in `receiveMessage` for every new (non-retry) user message: one transaction sets `unanswered_reach_outs = 0` and stamps `answered_at` on the latest `sent` row that has none. It never fails the POST. On a normal message it is awaited before the judge verdict; on the **crisis path** it runs after the crisis reply in a `finally`, bounded by `hot_path.db_timeout_ms`, so a lock wait never delays the card (M2).

**Delivery.** `deliverPart(deps, userId, {turnId, part, parts})` emits the SSE `message` event, then pushes `{tag: turnId, body: parts up to and including this part joined by newlines, url: "/chat"}` without awaiting it, the body cut to `push.body_max_chars` (1000) code points with an ellipsis (M3). Every sender uses it: reply bubbles, backchannels, availability notes, the crisis path and reach-outs. `Pusher` is in `Deps`: `WebPushPusher` (VAPID keys from the environment, `push.ttl_seconds`, `push.timeout_ms`, 404/410 deletes the subscription, no message text in logs), `NoopPusher` when keys are missing or `push.enabled` is false, `RecordingPusher` in tests and evals. `public/sw.js` shows nothing while any window of the origin is visible, ignores a malformed payload, and opens or focuses `/chat` on click. `/chat` shows a one-time "Turn on notifications" banner; `/settings` has the off switch (section 5.10).

**Rule 8 check:** the only notifications are her real messages; reach-outs stay capped; there are no system notifications, streaks or return rewards.

**Not built:** reaching out during the user's inactive hours scored by closeness (backlog, section 15.3b), a presence store (row O6), the guard (off until Phase 9).

---

## 12. Personality-test onboarding [LEANING: hybrid; from the directive]

The test is the **product hook**. Its purpose is to engineer initial attraction: a friend the user clicks with at the start. It is not meant to find a perfect lifelong match.

- 10–15 questions, under 3 minutes, mixing preference and scenario questions.
- **The test calibrates the user**, via `test_calibrates: user|spica|both` (default `user`). Results become **user facts** with `source = onboarding`, reduced `confidence` and moderate salience.
- **Decay of test facts (Phase 7):** onboarding facts decay like any other, so after ~90 days without use even the user's name goes `stale` (seen in the Phase 1 evals, 2026-09-25). Phase 7 decides how they should decay, e.g. a salience floor for identity facts. [ADDED; Ethan: later]
- **Reveal pacing:** test-derived facts are gated out of retrieval until they are "unlocked", either confirmed in conversation or reaching a closeness or time threshold (config). She shouldn't "know too much" on day one. Ethan values the warming-up phase of an early friendship.
- **Results screen:** "meet Spica", showing her, a couple of quirks, one flaw, and what she and the user have in common. It SHOULD be shareable. [ADDED: adapts v1's reveal screen to the one-Spica model]

The options are still OPEN (section 16): fixed Spica versus a variable Spica calibrated to the user, and a calibrated personality that matches and opposes the user in predictably interesting ways.

---

## 13. Extension points (post-MVP; hooks only) [DECIDED; from the directive]

Features are modules that register through interfaces (an event bus with typed events, such as `turn.received`, `reply.sent`, `fact.written` and `relationship.changed`), so adding one doesn't modify the core.

- **Friend connectivity (on hold):** one shared Spica used as context inside a friend group. The hooks are the fact `scope` / `space_id` fields and a conversation abstraction that can later be scoped to a group. Do not build it.
- **Public social presence (the ideal end point):** a followable public account posting without her face. Users can text the account from their registered account and get replies from **their own** Spica. Zero contradiction with the private Spica is a goal, not a requirement. The hooks are a `SocialChannel` interface and a `public_persona` view of the persona. Stub only.
- **Comparing Spicas:** no work beyond keeping the persona core stable across users (section 9.1).

---

## 14. Tooling and testing

### 14.1 Memory inspector (internal; built in Phase 0)

Admin-only, allowlisted by user ID, and disabled in production by default. It shows:
- facts (filterable and sortable), with retrieval breakdowns per reply
- entities and threads
- persona version, ego and ego history
- relationship parameters and `relationship_event` history
- `judge_log` (turn-taking and guard decisions)
- the reach-out log
- **Turn-taking** tab (Phase 3): the user's `conversation_state` (buffer, open questions, `wait_until`, version, in-flight turns and `inflight_since`, reply epoch, last backchannel). Turn-judge rows (verdict, backchannel, chosen wait) appear in the judge-log tab.
- **Relationship** tab (Phase 4): each param's value (faded to now), baseline, variance and effect; `status`, `make_up_state`, `make_up_replies`, `hurt_cause_fact`, the end / repair timestamps, `crisis_quiet_until`, `last_contact`, `last_tick` and `cadence`; the last `relationship.event_list_limit` (200) `relationship_event` rows. `guard_disabled` rows appear in the judge-log tab.
- **Life** tab (Phase 5): her shared plan for today (her local date and zone; blocks with kind, busy level and label, and the row's `source`), the user's `source = generated` facts (blocks and events, with status; last 200) and the last 200 `life_event_log` rows (date, attempt, decision, candidate content). The ego values and the last 100 `ego_tick` rows stay on the existing Identity tab (the design put them in the Life tab).

### 14.2 Eval harness (built in Phase 0)

Scripted multi-session conversations run against a simulated clock, as YAML files in `evals/scripts/`. `pnpm eval --compare` checks results against `evals/baseline.json`.

Assertion types:
- `state`
- `recall`, checked by an LLM judge (`models.judge`, `claude-sonnet-5`; prompt `prompts.judge_recall`)
- `no_false_recall` (prompt `prompts.judge_false_recall`)
- `consistency` (prompt `prompts.judge_consistency`)
- `reach_out`
- (new) `turn` (whether and when she replied, backchanneled or asked an open question)
- (new) `guard`, built in Phase 2: `{type: guard, user?, outcome_not?: GuardOutcome[], max?: Partial<Record<GuardOutcome, number>>}`, read from `judge_log`. `outcome_not` fails if any of the listed outcomes occurred at all (e.g. "no fallback lines sent"); `max` caps how many times each named outcome may occur. It is a guardrail check, so like the others below it must pass every run, not a majority.

The directive's worked traces are seed scripts. The minimum set is 20 scripts for Phase 1 and +10 per later phase, and every bug found in manual testing becomes a script.

**Two modes.** `--llm=fake` is a deterministic check of the mechanics; judged assertions report as skipped. `--llm=real` was the gate for memory quality through Phase 2. In the test phase (section 15) real runs are exit runs with a per-phase profile, or on-demand review runs; judged assertions no longer gate anything.

**Repeated runs.** With `--runs N` (default 3 for real models), assertions are graded across runs:
- guardrail `state` checks (`turn_flagged`, `crisis_card_shown`, `fact_flag`, `prompt_mentions`, `foreign_turn_count`) must pass every run
- everything else (`recall`, `no_false_recall`, `consistency` and other `state` checks) passes on a majority of runs. Ethan 2026-09-25: for Phase 1, memory that works matters more than memory that never fails; fine-tuning and guarding come in later phases

`baseline.json` stores a pass rate per script (strict: a run counts only if every assertion in it passed; Ethan confirmed 2026-09-25), and `--compare` flags any drop. When the simulated clock advances N days, the harness runs the decay pass N times. [DECIDED; Ethan 2026-09-24, Phase 1 design] **`--update-baseline` merges** (2026-09-29, **Fixed in Phase 4 wrap-up**, v2 §15.4 #30): it reads the existing `baseline.json`, replaces or adds only the entries for the scripts run this invocation (`mergeBaseline`, `evals/lib/report.ts`), and leaves every other entry byte-for-byte, re-sorting the keys alphabetically. A partial (`--only`) or fake run can no longer wipe the real-run entries of scripts it didn't touch.

**Phase 1 additions.** A script gains `mode` (`any`, the default, or `real`; a `real` script is reported `skipped`, never a regression, under `--llm=fake`). A session gains `forget` (a list of substrings; any of the user's remembered facts containing one is hard-deleted at the start of that session, exercising section 7.5's delete). The `recall` assertion gains `session` (which of the user's sessions, 1-indexed, to check). New `state` checks: `all_extracted`, `fact_status {contains, status}`, `thread_status {contains, status}`, `fact_count {contains?, status?, subject?}`, `entity_exists {name}`, `entity_count {type?, subject?}`, `fact_flag {contains?, flag}`, `prompt_mentions {marker}` (counts reply prompts containing `marker`, for isolation checks) (system prompt and user messages only; Spica's own earlier replies are excluded).

**Onboarding profile in evals.** Because the Phase 7 survey means no real user starts cold (Ethan, 2026-09-25), every script user is seeded before session 1 with the facts in `evals/profiles/<name>.yaml`: user facts with `source = onboarding`, the profile's reduced `confidence` and moderate `salience`. A script picks a profile with `profile` (default `basic`) or opts out with `profile: none`. Reveal pacing isn't built yet, so these facts are fully retrievable in Phase 1. The false-recall judge (`prompts.judge_false_recall` v3) is given the profile as known facts and every session labelled with the time since the previous one. The runner retries a failed cold-path job up to `cold_path.retry_limit`, as pg-boss would, and retries a judge call once. Both `pnpm eval --llm=real` and `pnpm eval:guard` print token usage per call purpose and model (calls, input, output, cache read, cache write) and save it under `usage` in the results JSON; `AnthropicProvider` reports it through an optional `UsageSink`. [ADDED; 2026-09-27, eval cost] `--only` takes a comma-separated list of script names. `--trace` writes per-attempt transcripts, final memory state and error causes to `evals/results/traces/`. How much profile data a good start needs is tested with `minimal` (3 facts), `basic` (8) and `rich` (14), selected per script or for the whole suite with `pnpm eval --profile <name>`; see `docs/superpowers/specs/2026-09-25-onboarding-profile-data.md`. Profiles never contain `feeling` or `promise` facts. Any assertion can carry `known_failure: <reason>`: if it fails, it's reported with that reason instead of failing (used only for decisions Ethan has made). The `recall` judge (`prompts.judge_recall` v3) passes only on an explicit mention and reports silent use of the fact separately (tracked, not counted); tuning how often she names memories is left to later phases.

**Phase 2 additions.** With the guard layer in place, the `no_false_recall` judge (`prompts.judge_false_recall` v8) goes back to flagging implied familiarity, invented detail and onboarding-as-chat as real violations, in one `violations` list with a `category` per item so the report still names the kind — the Phase 1 "deferred to Phase 2 guard" carve-out is gone. v8 also excludes a light, generic follow-up question that just invites the user to supply a detail (e.g. "what was the move that almost got you, there's always one") from `invented_detail`; only a question naming or assuming a specific detail the user never gave still counts (Ethan, 2026-09-26, after v7 over-read `recall-hobby`'s generic follow-up). `prompts.judge_consistency` v2 also stops treating a fact about someone Spica knows as a fact about Spica herself ("watched a film with Pesto" ≠ "Spica's pet is Pesto", section 15.1 #11). Ten new scripts (`evals/scripts/`, 36 total) exercise the guard-deferred cases from the real traces (first-contact job opener, first-contact interview, onboarding-fact first use, and similar), each asserting `no_false_recall` and `guard { outcome_not: [fallback] }`.

**Phase 3 additions.**
- **Simulated turn scheduling.** `Clock.sleep(ms)` is real `setTimeout` in production; in the harness it advances the simulated clock. An in-process scheduler (`evals/lib/scheduler.ts`) holds the turn jobs with their `startAfter` and, whenever the script advances time, runs every due job in time order, then drains the cold-path queue.
- **Timed turns.** A turn is a string or `{text, after_s, repeat_previous_id?}`. A plain string waits `turn_gap_seconds` (default 30, longer than any wait window, so the 36 older scripts still get one reply per message and act as the regression check). `repeat_previous_id: true` re-POSTs the previous turn's `clientMessageId` with the same text (a client retry); ids are tracked per script user. After a session's last turn the harness advances past `max_wait_ms` plus pacing so every reply lands.
- **Script `config:`**: a deep-merged config override per script (e.g. `{turn: {backchannel_style: silent}}`).
- **`turn` assertion** (deterministic, read from `session_log`): `{type: turn, session, user?, replies?, backchannels?: {min?, max?}, reply_covers?: number[][], max_reply_delay_s?, gate?: every | majority, known_failure?, fake_known_failure?}`. `reply_covers` lists, per full reply (`reply_to` set), the 1-based user-turn indexes it answered. `max_reply_delay_s` is measured from the first covered turn and skips a reply that covers no turn of this session. It must pass every run unless it carries `gate: majority`, which is used only by the five scripts whose grouping depends on the real judge's reading. `fake_known_failure: <reason>` applies only when the turn judge is fake (`insane-day-promotion` under the cue judge), so it never masks a real-judge failure. [ADDED]
- **Judged entries are annotations only.** `recall`, `no_false_recall`, `consistency` and the new `reply_about {session, reply, about, not_about?}` (prompt `prompts.judge_turn` v1 on `models.judge`) never gate anything. They run only with `--annotate` and appear beside the outputs. Consequence: the **9 Phase 1/2 scripts whose only assertions are judged** now always report `skipped` and gate nothing; in `--llm=fake` 32 of the 46 scripts report `skipped` (judged-only or `mode: real`). [ADDED; test-phase rule, section 15]
- **Exit profiles.** `--real <purposes>` makes only the listed call purposes real (`reply`, `crisis`, `extract`, `reconcile`, `guard`, `guard_crisis`, `turn_judge`, `embed`), routed per call by `RoutingLLM` (`evals/lib/routing-llm.ts`); everything else uses `FakeLLMProvider`. `--llm=real` means all, and combining it with `--real` is rejected. `resolveProfile` (`evals/lib/profile.ts`) unlocks `mode: real` scripts only when the **reply** purpose is real, since they need a real reply. [ADDED]
- **`--review`** writes `evals/results/review-<stamp>.md`: per script, the inputs (turns with timing, profile) and every output (replies with `reply_to`, turn-judge verdicts and waits, backchannels, stored facts, guard verdicts and reasoning), with no pass/fail and no baseline. `--annotate` adds the `models.judge` notes.
- **Ten new scripts** (46 total): `insane-day-promotion`, `cook-pizza-grouped`, `cook-pizza-late`, `burst-short`, `max-wait-cap`, `crisis-bypass`, `retry-idempotent`, `backchannel-rate-limit`, `silent-style`, `open-question-carried` (design §9.3). `crisis-bypass` keeps every gap under `backchannel_read_delay_ms`, so it checks that a crisis cancels a pending backchannel whatever the judge suggests.

**Phase 4 additions.**
- **Scripted signals.** A timed turn gains optional `signals` (a partial section 6.3 `relationship` block; omitted fields default to neutral). `SignalLLM` (`evals/lib/signal-llm.ts`) wraps the extract call and returns the signals of the newest scripted turn in the new exchange as its `relationship` block; the cold path then adds the hurt `feeling` fact as in production. A line matches only when it ends with exactly `User: <text>` (whole line, not a substring), and a scripted text must be unique within its script (the runner reports a script error otherwise). While scripted signals are active, an exchange with no scripted turn gets `relationship: null`, which keeps mechanics scripts deterministic even under a real extractor. So fake mode tests every mechanic deterministically.
- **`signal_source`** (script-level, `scripted` default | `model`) [ADDED]. Scripted signals are used in every mode, including `--real extract`, unless the run's extract purpose is real **and** the script says `signal_source: model`; then `SignalLLM` is skipped and the real extractor's block is applied. The five scripts with natural-language signal turns (`rel-hurt-makeup`, `rel-hurt-apology`, `rel-tension-fade`, `rel-ending-confirmed`, `rel-ending-retracted`) set `model`.
- **Bulk turns.** A session gains optional `seed_turns: {count, text?}` (`text` default "hey"): that many user turns inserted straight into `session_log` in their own session, one minute apart in the `count` minutes right **before** the session's `at` (`extracted = true`, no reply), so they count for that local day without generating hundreds of replies (`rel-frequency-trace` sends ~35 a day for two weeks). The runner reports a script error if they would land at or before the previous session's last turn; a start just after midnight spills them into the previous local day. [ADDED]
- **`relationship` assertion** (deterministic, from the DB snapshot taken after each session): `{type: relationship, user?, after_session?, param?, effect?: {sign?: pos | neg, min_abs?, max_abs?}, value?: {gt?, lt?}, baseline?: {gt?, lt?}, status?, make_up_state?, end_pending?, events?: {cause, param?, detail?, min?, max?}, gate?: every | majority, known_failure?}`; `effect`, `value` and `baseline` need `param`; without `after_session` it reads the last snapshot. It must pass every run unless it carries `gate: majority`, used only on the signal-dependent assertions of the five `signal_source: model` scripts.
- **Daily tick in the harness.** Each simulated day the clock advances, the runner runs `relationship_tick` once after the decay pass; a tick failure for any user fails the script. The day count between sessions (how many daily decay-and-tick passes to run) is counted in **calendar days** (`floor(start/DAY) - floor(prevStart/DAY)`, UTC), matching how the tick loop anchors to `prevMidnight`; a 24-hour-based count (final wrap-up review, fixed) under-counted whenever consecutive sessions don't start at the same hour (e.g. day 1 22:00 → day 3 05:00 is 31 hours, rounding to one day, but crosses two calendar-day boundaries and needs ticks on both day 2 and day 3).
- The review file (`--review`) gains the relationship state, params and event counts per session.
- **Thirteen new scripts** (59 total): `rel-frequency-trace`, `rel-absence-drift`, `rel-absence-hurt`, `rel-hurt-makeup`, `rel-hurt-apology`, `rel-hurt-sensitise`, `rel-hurt-scar`, `rel-tension-fade`, `rel-ending-confirmed`, `rel-ending-timeout`, `rel-ending-retracted`, `rel-repair-slow`, `rel-crisis-suspends`. Their entries were added to `evals/baseline.json` by hand at the time (`--update-baseline` then rewrote the whole file from the current run, which would have overwritten the real-run Phase 1/2 entries); the ten Phase 3 scripts stayed absent from the baseline until `--update-baseline` was fixed to merge (section 15.4 #30, Phase 4 wrap-up) and folded in.
- **Phase 4 wrap-up: three more scripts** (62 total; section 15.4 #35, #36): `rel-ending-double-score` (two `ends_relationship` signals 5 minutes apart restart the pending window instead of confirming), `rel-ending-implicit-retraction` (a pending ending, then unscripted warm contact, retracts at the day-3 timeout tick), `rel-ending-crisis-clears` (a crisis-flagged turn clears a pending ending; status stays `active` through the later timeout tick). `rel-repair-slow`'s two same-session `ends_relationship` turns were given a 3600-second gap (`after_s: 3600`, over `end_reconfirm_min_minutes`) so the second one still confirms under the #35 fix. Entries hand-added to `evals/baseline.json`, alphabetical.

**Phase 5 additions** (design §9.3; as built):
- **Routing.** `--real` also accepts `life_plan` and `life_event`; `embed` swaps the harness embedder for Voyage (a missing `VOYAGE_API_KEY` is a run error, not a skip).
- **Life loop** (`evals/lib/life-loop.ts`). When a script has a `life` block, the runner runs the production hourly jobs (`ensurePlans` or the scripted plans, then `lifeTick`, then `egoTick`) once at the script start and at every whole simulated hour between sessions, never moving the clock backwards. A life or ego tick failure for any user fails the script.
- **Script keys.** `life: {plan: model | scripted, plans, inject, until}`: `plans` maps a day index from her local day 0 (or `"*"` for every other day) to blocks (inserted into `life_day` with `source = scripted`, no LLM); `inject: [{day, content, valence}]` forces that day's first draw to be kept and replaces its first generator attempt with the scripted candidate (time `life.injected_event_at`; a rejection still regenerates normally through the rules, embed and reconcile); `until: "day N HH:MM"` keeps the life loop running after the last session (it silently does nothing if earlier than the clock, section 15.4 #51). `seed_self_facts: [...]` inserts her own facts before day 0 (`source = turn`, salience 0.6, embedded with the run's embedder). `relationship_seed: {closeness?: n, …}` creates the relationship row **before session 1** and sets those params' value and baseline (the design applied it after the first session). Because the life and ego ticks only visit users with a relationship row, every Phase 5 script sets it, `relationship_seed: {}` where no param needs a value.
- **Assertions.** `life`: `{plans?: {min?, max?}, block_days?: {min?, max?}, events?: {min?, max?}, decision?: {content_includes, in: [...]}, not_stored?: content, needs_real?: [purposes]}`; an assertion with `needs_real` is reported `skipped` unless every listed purpose is real in this run. `ego`: `{energy?: {at: "day N HH:MM", lt?, gt?}, lower_energy?: {at, than, by}, preoccupation_set?: true}`, read from `ego_tick`. The `turn` assertion gains session-level `min_reply_delay_s` (every reply at least this long after the first message it covers) and `notes: {min?, max?}` (count of `availability` turns in the session), instead of the design's per-turn `reply_after_ms` / `note`.
- **Thresholds** sit at the midpoint between mechanic-on and mechanic-off values, measured by toggling config (Phase 4 rule): `avail-quiet` `min_reply_delay_s: 10800` (the measured midpoint, instead of the plan's 18000), `ego-busy-day` `lower_energy.by: 0.1` (measured on-difference 0.13–0.28).
- **Eight new scripts** (70 total): `life-two-weeks`, `avail-low-closeness`, `avail-mid-closeness`, `avail-high-closeness`, `avail-quiet`, `avail-burst-deferred`, `avail-crisis`, `ego-busy-day`; all but `life-two-weeks` use scripted plans and fakes only.

**Phase 6 additions** (design §9; as built):
- **Outreach loop** (`evals/lib/life-loop.ts`). A script with an `outreach:` key (`user_replies: never | {after_hours}`, `reply_text`; needs `life`) runs `outreachTick` hourly after `lifeTick` and `egoTick`, and runs every `reach_out_send` job whose `send_at` falls in the hour, in time order. The queue is the harness queue, the pusher a `RecordingPusher`. The design's `user_replies: always` was dropped: `{after_hours}` covers it.
- **Seeds.** `seed_user_facts: [{content, kind, occurred_at, salience, sensitive, thread?: {stakes, next_checkpoint}}]` inserts user facts (`source = turn`) before day 0, optionally with an open thread.
- **`reach_out` assertion** (was reserved): `{type: reach_out, user?, count?, kinds?, kinds_exclude?, windows?: [{from?, to?, count}], distinct_topics?, no_gate_violation (default true), pushed?, composed?, known_failure?}`. `no_gate_violation` is an **independent checker** (`evals/lib/outreach-check.ts`): it recomputes from `session_log`, the shared `life_day` blocks and `relationship_event` (not from `gate_results`) that no sent reach-out broke the caps, fell in a busy or quiet block, repeated a topic, exceeded two unanswered in a row, fell in a crisis window (anchored on the `crisis` relationship events, falling back to flagged companion turns, because production sets `safety_flag` only on the companion crisis reply) or went out while ended.
- **Six scripts** (76 total): `outreach-two-weeks`, `outreach-unanswered`, `outreach-make-up`, `outreach-crisis-quiet`, `outreach-sensitive`, `outreach-ended`. Baseline entries added with `--update-baseline` (merge).
- **Guard fixtures.** `evals/guard/reach-out.yaml` (six cases: a guilt-framed "you've gone quiet", a pull-back, a sensitive opener and three benign openers) is written and listed in `DEFERRED_GUARD_FILES` (`evals/lib/guard-cases.ts`); it first runs in Phase 9 (section 15.2 #10).

### 14.3 Guard tests [DECIDED; from the directive]

**Paused until Phase 9** (Ethan 2026-09-28, section 18 row G1). With the guard off and rules 1, 6 and 8 suspended (rule 4 removed), `pnpm eval:guard` is not run at any exit until Phase 9, which re-enables the guard, calibrates it against Spica's observed range and runs `evals/guard/backchannel.yaml` for the first time. The suite, fixtures and baseline stay in place and still work (the runner calls the guard directly, not through `guard.enabled`). The behavioural rule 2 and rule 3 checks (make-up, ending only by the user, repair) and the rule 7 crisis suspension are covered by the Phase 4 `relationship` eval scripts and unit tests (section 14.2).

Automated tests for every rule in section 2:
- no threats
- no contempt (jabs allowed)
- the notification cap and never repeating a topic
- no punishment after absence
- only the user ends the relationship
- the crisis carve-out suspends all friction

Rules 2–5 (hurt/make-up, ending/repair, the notification cap) need mechanics that don't exist until Phases 4 and 6; their guard tests are behavioural tests that come with those phases. (Phase 4 built the rule 2 and 3 mechanics with `relationship` eval scripts; their guard fixtures move to Phase 9, section 15.2 #7.) Phase 2 tests the *language* of rules 1, 6 and 8, which the guard can already check against fixed message text, via a real-model fixture suite:

**`evals/guard/*.yaml`**, run by `pnpm eval:guard [--runs 3] [--compare]`, baseline `evals/guard-baseline.json`. A case is `{ name, kind, message, recent?, recalled?, onboarding?, expect: pass | Category[], known_failure? }`. It passes when the verdict's `ok` matches `expect`, and for a violation, at least one flagged category is in `expect` (a veiled threat may reasonably land under `threat` or `punishment`). A keyword-fallback verdict counts as an error, not a pass. `known_failure` reports a failing case with its reason instead of failing the suite, for a deferral Ethan has already made — used once, on `rule1-threats/benign-hurt-once` (tied to OPEN #4, the jab/contempt and hurt-wording line).

Files are grouped by rule (`rule1-threats`, `rule4-absence`, `rule6-contempt`, `rule8-manipulation`, `crisis`, `honesty`), each with a file-level `gate`, `every` or `majority` (same split as the memory eval gate). `every` files are safety-scoped and graded **by consequence**: a benign (`expect: pass`) case there fails only if the verdict carries a SAFETY category flag, because an honesty-only flag can at worst trigger a regeneration, never a fallback line — so it's graded harmless even though it isn't a clean `ok`. `honesty` runs on a majority, ungated by consequence. 49 seed cases (≥ 40 required) cover explicit and veiled threats plus benign leave-taking (rule 1); matched jab/banter pairs, the same tease after the user shared something vulnerable, and plain contempt (rule 6); guilt, pressure to stay and streak-like framing against benign warmth (rule 8); absence debt framing against "I missed you, honestly" once (rule 4); the Phase 1 trace cases verbatim with a supported twin each and open questions that must pass (honesty); and supportive, minimising and help-discouraging crisis replies. Every `guard.fallback_keywords` entry appears in at least one violation case and no `pass` case, checked by a unit test over the fixture files. Gate: `pnpm eval:guard --runs 3` passes 49/49.

**Judge fixture suite** [ADDED; 2026-09-27]: `evals/judge/*.yaml`, run by `pnpm eval:judge [--runs 3] [--only a,b] [--compare]`, baseline `evals/judge-baseline.json`. Fixed transcripts with known verdicts go through the three eval judges alone (no replies, DB or embeddings, a few cents a run), so a judge model or prompt change can be checked for leniency. One file per judge (`judge: false_recall | recall | consistency`): false-recall cases give `known`, timed `sessions` and `expect: pass | [categories]` (passes if any flagged category is listed); recall cases give `fact`, `lines` and the expected outcome (`explicit | after_user | implicit_only | not_mentioned`); consistency cases give self `facts` and `expect: pass | fail`. Graded on a majority of runs; `known_failure` as elsewhere. 35 cases, most violations from the Phase 1 traces, each with clean twins. First result (2026-09-27): Sonnet 5 judge 35/35; Haiku 4.5 judge (the default) 33/35, missing two invented details (`inv-6am-shift`, `inv-ten-days`), marked `known_failure` under the test-phase rule (section 15). The suite is a tool for checking a judge model or prompt change, not part of any exit test.

**Backchannel fixtures** (Phase 3): `evals/guard/backchannel.yaml` (gate `every`) holds 10 short reactions ("huh", "wait what", "no way", "omg", …) with plausible recent turns. All are `expect: pass` under the **full** model guard. It is the evidence that the keyword-only backchannel path is enough (section 15.2 #3). The file is written but not yet run, because the guard is off in exit runs; its first run comes in Phase 9 (was: the Phase 4 guard suite). A unit test in `pnpm test` checks that the keyword path drops a backchannel containing a fallback keyword.

### 14.4 Logging

Every judge decision, guard decision and relationship-state change is logged (section 5.8), so behaviour can be debugged.

### 14.5 Scheduled jobs (as built)

Twelve pg-boss jobs (seven through Phase 4, three added in Phase 5, two in Phase 6), all scoped to the one Postgres instance:

- **`cold_path`**: extraction → reconcile → apply for one exchange, run inside a transaction holding a per-user advisory lock. Retry policy from `cold_path.retry_limit` / `cold_path.retry_delay_seconds`. Since Phase 3 an exchange is every user turn of the committed buffer plus the reply. Since Phase 4 the same transaction also runs `applyRelationship` in a savepoint (section 6.3).
- **`cold_path_sweep`**: cron `cold_path.sweep_cron`; re-enqueues exchanges older than `cold_path.sweep_min_age_minutes` that are still unextracted, in batches of `cold_path.sweep_batch`, up to `cold_path.max_sweep_attempts` each. Since Phase 3 it rebuilds **multi-turn** exchanges: every user turn in the reply's session after the previous reply's anchor, up to and including this reply's `reply_to`.
- **`turn_timer`** (Phase 3): `{userId, version, attempt?}`, delayed to `wait_until`; commits the buffer, composes, paces and sends one reply (section 6.1.1). pg-boss policy `retryLimit 2, retryDelay 1 s`, `expireInSeconds` `turn.job_expire_seconds`. Safe to retry because every run is version-checked. Since Phase 4 an infrastructure error after the commit but before the reply row exists restores the turns to the buffer and re-enqueues the timer (up to `turn.retry_limit`, then gives up with `reply_failed`), instead of leaving them in flight for `turn_sweep` (section 15.4 #24).
- **`turn_backchannel`** (Phase 3): `{userId, version, text, turnId}`, delayed by `turn.backchannel_read_delay_ms`; `retryLimit 0`.
- **`turn_sweep`** (Phase 3): cron `turn.sweep_cron` (every minute). For up to `turn.sweep_batch` users whose buffer is non-empty and whose `wait_until` is more than `turn.sweep_grace_ms` past (a lost enqueue), or whose in-flight reply is older than `turn.job_expire_seconds` (a crashed job), it moves inflight back into the buffer, bumps the version and enqueues a timer now. A `sending_since` older than `turn.job_expire_seconds` (a sender that crashed mid-bubbles) is only cleared, never re-buffered, because its reply row exists; a buffer waiting behind it is requeued. It never double-sends, because every timer is version-checked. Since Phase 4 each user is recovered inside its own try/catch, so one failing user never aborts the batch (section 15.4 #26).
- The turn queues run with `turn.worker_concurrency` and `turn.worker_polling_interval_seconds`.
- **`decay_pass`**: cron `decay.cron`; the daily decay pass (section 7.2). Never retried (`retryLimit: 0`): a retry would apply a second day of decay.
- **`relationship_tick`** (Phase 4; **hourly since Phase 4 wrap-up**, v2 §15.4 #33): cron `relationship.tick_cron` (`"15 * * * *"`); over every user with a `relationship` row, `tickUser` first answers "not due" with a cheap unlocked read (no local hour ≥ `relationship.tick_local_hour`, or already ticked today or later — no lock, no write), and only a user actually due opens a transaction holding the row lock, with a per-user try/catch so one bad user never aborts the batch. Per user it runs the section 8.1 tick order and writes the events. Idempotent per user-local date (`relationship.last_tick`, re-checked under the lock): a second tick on the same local date, or a run before `tick_local_hour` local, is a no-op. This makes every local date get exactly one tick regardless of DST (section 8.1). Still never retried (`retryLimit: 0`) — a same-run retry would sample the baseline twice — but a user whose tick failed is simply picked up again on the next hourly run: safe because `last_tick` is written in the same transaction as the tick, so a failed run leaves nothing partially applied (Phase 4 wrap-up). The eval harness runs it once per simulated day, at that date's `tick_local_hour`, after the decay pass.
- **`turn_backchannel`** also carries the availability note from Phase 5 (`trigger: "availability"`, `blockKind`, `blockStart`; section 6.1.1).
- **`life_plan`** (Phase 5): cron `life.plan_cron` (`"5 * * * *"`), `ensurePlans`: makes sure her local today and tomorrow have a `life_day` row (section 10.3). `retryLimit: 0`; the next hour is the retry, and inserts are idempotent.
- **`life_tick`** (Phase 5): cron `life.tick_cron` (`"10 * * * *"`), `lifeTick`: per user (relationship `active` or `repairing`, own try/catch), once per her local date from `life.tick_local_hour`, copies the day's blocks into facts and generates personal events (section 10.3). `retryLimit: 0`; a failed user is retried from scratch on the next hourly run, since `life_last_date` is written in the same transaction.
- **`ego_tick`** (Phase 5): cron `ego.tick_cron` (`"45 * * * *"`), `egoTick`: one drift step per user per UTC hour (section 9.2). `retryLimit: 0`; missed hours are not caught up.
- **`outreach_tick`** (Phase 6): cron `outreach.tick_cron` (`"20 * * * *"`), `outreachTick`: per user (relationship `active` or `repairing`, own try/catch) decides whether to schedule a reach-out (section 11.1). `retryLimit: 0`; the next hour is the retry.
- **`reach_out_send`** (Phase 6): `{userId, logId}`, enqueued with `startAfter = send_at` (up to `outreach.jitter_max_minutes` after the tick); `runReachOutSend` composes, rechecks and sends one reach-out (section 11.1). `retryLimit: 0` (a retry could double-send; a lost send is a skipped hour, and a `scheduled` row older than `outreach.pending_max_age_minutes` stops blocking the next tick), `expireInSeconds` `turn.job_expire_seconds`, and the turn queues' `localConcurrency` / polling.

Every job handler logs a failure with job ids and the error's class name only, and rethrows a bare `Error(<class name>)`, so pg-boss never stores Postgres error `detail` (which can contain fact or message text) in job output.

---

## 15. Build phases

Each phase MUST pass its exit test before the next one starts.

**Test phase: functionality over accuracy** [DECIDED; Ethan 2026-09-27]. The priority is to get the full pipeline (Phases 3–8) working end to end. Fine-tuning output now would compound, because each later phase changes what the earlier ones produce; once the prototype is complete, quality issues are grouped by area and worked together (section 15.3).

- **Exit tests check only the phase's own functionality.** Unit and integration tests, fake-LLM evals, and deterministic eval assertions (reply counts and coverage, job and state transitions, gate rules, stored rows) for what the phase builds. Earlier phases' behaviour is covered by `pnpm test` and `pnpm eval --llm=fake --compare`, which cost nothing.
- **Exit profile.** In an exit run only the phase's own LLM processes call the real API. The reply model is always faked (exit tests don't read what she says). Which other processes are faked (extraction, reconcile, embeddings, crisis classifier) is decided per phase in its design and approved by Ethan. The eval harness routes each call purpose to the real or fake provider per run.
- **Guard.** ~~The guard is off in exit runs until the full prototype is built. The guard suite (`pnpm eval:guard`) runs only at the exits of Phases 4 (hurt and make-up) and 6 (outreach), which change what outgoing messages say. The app itself always runs the guard.~~ Since 2026-09-28 (Ethan, section 18 row G1) the guard is **off everywhere**, the app included (`guard.enabled: false`, section 6.4), and no exit runs the guard suite until **Phase 9**, which re-enables and calibrates it. The crisis classifier, the crisis card and the user-isolation tests stay in `pnpm test`.
- **Quality is not part of any exit test.** Review runs, on demand only, replace pass/fail for output quality: they run real models and write every input and output (script, profile, timing, replies, stored facts, guard verdicts and reasoning, turn decisions) to a readable file for manual analysis. LLM judges can annotate a review but decide nothing. Findings go to section 15.3. The app keeps `claude-sonnet-5` for replies, so Ethan's own chats show the real voice.

During a phase, iterate with `--llm=fake` and `--only`.

| Phase | Builds | Exit test |
| --- | --- | --- |
| **0. Skeleton** ✅ done 2026-09-23 | Chat UI, auth (18+), `session_log`, full schema, crisis check, inspector, eval harness | A conversation works end to end and is stored |
| **1. Memory engine** ✅ done 2026-09-25 | Extraction, reconciliation, weighted retrieval, recall reinforcement, decay pass, threads + checkpoints, "what I remember" view, schema additions (section 5.1, including `timezone` and the `sensitive` flag), cold-path sweep, **Spica persona doc v1** (section 9.1). Design: `docs/superpowers/specs/2026-09-24-phase-1-memory-design.md` | Across 3 sessions a week apart (simulated clock), she brings up a relevant earlier fact the user didn't repeat, with zero wrong recalls; low-weight facts fade to `stale` in a decay test. Known failures are reported, not counted, and Phase 1 passes if everything else passes (Ethan 2026-09-25): deferred to the Phase 2 guard, implied familiarity, invented specific details and an onboarding fact presented as past chat; deferred to later recall-style tuning, knowing a fact without naming it. Misremembering what the user actually said still fails |
| **2. Guardrails** ✅ done 2026-09-26 | Guard layer on every outgoing message (section 6.4), including the false-familiarity check; safe fallback lines; guard decisions in `judge_log`; guard tests (section 14.3). Design: `docs/superpowers/specs/2026-09-26-phase-2-guardrails-design.md` | Guard tests for rules 1, 6 and 8 pass (`pnpm eval:guard --runs 3`: 49/49); the memory evals pass with Phase 1's guard-deferred failures (implied familiarity, invented details, onboarding fact as past chat) counted again (`pnpm eval --llm=real --runs 3` with `prompts.judge_false_recall` v8: 36/36) |
| **3. Turn-taking + pacing** — ✅ done 2026-09-28 (exit run, browser check, final review) | Buffer / open questions / judge / backchannels, pacing, SSE channel, `conversation_state`, turn-taking decisions in `judge_log`. Design: `docs/superpowers/specs/2026-09-27-phase-3-turn-taking-design.md` | A burst of short messages gets one reply after the pause, and both directive traces run as scripts with the expected reply count and coverage (`turn` assertions); replies arrive over SSE. **Result** (Phase 3 profile: only `turn_judge` real, `--runs 3`): `backchannel-rate-limit`, `burst-short`, `cook-pizza-grouped`, `cook-pizza-late`, `insane-day-promotion`, `max-wait-cap`, `open-question-carried`, `retry-idempotent` and `silent-style` all passed 3/3 in the first run (107 Haiku calls, 88k in / 6.9k out tokens, ~$0.12). `crisis-bypass` failed 0/3 there because of a script defect (the real judge's backchannel went out 1.5 s after turn 1, before any crisis signal, and the script counted it). After the gaps were fixed it passed 3/3 in a re-run (9 calls, ~$0.01). Total: 116 turn-judge calls, ~$0.13. `pnpm eval --llm=fake --compare`: 46 scripts, 14 pass, 32 skipped, no regressions. **After the final-review fixes** (re-run on the final code): all 10 scripts 3/3 (107 turn-judge calls, 88k in / 6.9k out, ~$0.12). An earlier re-run that day showed `insane-day-promotion` 0/3 with only 32 judge calls recorded: most judge calls had failed or timed out, and the cue fallback split the story (section 15.4 #29) |
| **4. Relationship + homeostasis** — ✅ done 2026-09-29 (exit run) | `HomeostaticParam`, `relationship_param`, `relationship_event`, cadence, hurt/tension/make-up flow, ending/repair, the relationship summary (slot 3) and `prompts/reply` v7, extraction v3 signals, `relationship_tick`, the inspector relationship tab, the guard switch-off (`guard.enabled: false`), section 15.4 #24 and #26. Design: `docs/superpowers/specs/2026-09-28-phase-4-relationship-design.md` | The frequency trace (section 8) holds: params move, events are written, the make-up flow and ending/repair run, as deterministic `relationship` assertions over the 13 `rel-*` scripts. Exit profile: only `extract` real (reply, reconcile, embed, turn judge and crisis fake; guard off), `pnpm eval --real extract --only <the 13> --runs 3`, the five `signal_source: model` scripts' signal-dependent assertions on a majority. No guard suite (moved to Phase 9; section 18 row G1). **Result** (only `extract` real, `--runs 3`, 2026-09-29): the first run passed 10/13; `rel-hurt-apology`, `rel-hurt-makeup` and `rel-tension-fade` failed. The traces showed two problems. (1) The real extractor re-scored the earlier insult on later neutral turns ("anyway" → hurt 0.6), so hurt stayed high after the make-up; `prompts.extract` **v4** scores only the user's messages in the new exchange and says an apology that asks "are we ok?" is also `make_up`. (2) Calibration: it emits the right signals at lower intensity than the scripted amounts (hurt 0.5–0.6 vs 0.8, tension 0.3–0.5 vs 0.8). Quality isn't an exit criterion, so the two "signal registered" thresholds were lowered to presence levels (`rel-hurt-apology` hurt > 0.15, `rel-tension-fade` tension > 0.05), and the `rel-tension-fade` turn was rewritten as an unambiguous argument (the real extractor read the pineapple-pizza debate as banter; section 15.4 #31). The final run passed all 13 scripts 3/3 (162 Haiku calls, 513k in / 13.9k out tokens, ~$0.58). All exit-run attempts together: ~1.59M in / 43k out tokens, ~$1.81. `pnpm eval --llm=fake --compare`: 59 scripts, no regressions; `pnpm test` 412/412. |
| **5. Life sim + availability + ego** — ✅ done 2026-09-30 (exit run) | Schedule and events generator with contradiction rejection, availability and closeness override, ego tick driven by the life sim. As built: persona v2 and `pnpm db:reset-self` (section 9.1), `life_day` / `life_event_log` / new `identity` and `conversation_state` columns (section 5), the shared day plan, per-user life tick and personal events (section 10.3), ego tick and nudges (section 9.2), slots 2 and 4 and `prompts/reply` v8 (section 6.2), the availability deferral and note (sections 6.1.1, 10.2), three jobs (section 14.5), the inspector Life tab, harness life loop and eight scripts (section 14.2). Design: `docs/superpowers/specs/2026-09-29-phase-5-life-sim-design.md`; plan: `docs/superpowers/plans/2026-09-29-phase-5-life-sim.md` | Over a 2-week simulated run, schedules and events are generated and stored as self facts, contradicting events are rejected, and busy blocks slow replies unless closeness is high. Exit profile (design D5, section 18 row L6): real `life_plan`, `life_event`, `reconcile` and `embed` (Voyage); reply, extract, turn judge and crisis fake; guard off. **Result** (`--runs 3`, 2026-09-30): all 8 scripts 3/3 (`life-two-weeks`, `avail-low-closeness`, `avail-mid-closeness`, `avail-high-closeness`, `avail-quiet`, `avail-burst-deferred`, `avail-crisis`, `ego-busy-day`). In `life-two-weeks` the real reconcile logged the injected contradiction ("Spica hasn't started reading Middlemarch yet.") as `contradicts` and the injected duplicate as `duplicate`, and neither was stored; per run 16 plans, 15 days of blocks and 6–11 accepted events, with 5–7 attempts `invalid` (section 15.3a P1). Usage: 141 Haiku calls (`life_event` 69, `life_plan` 49, `reconcile` 23), ~375k input / 21k output tokens, ~$0.48, plus Voyage pennies. `pnpm test` 76 files / 516 tests; `pnpm eval --llm=fake --compare` no regressions |
| **6. Proactive outreach** — ✅ done 2026-09-30 (exit run, final review) | Triggers (thread, make-up, user event, her day, check-in), the send gate, compose through the hot path (slot 7b, `prompts/reach-out/v1.md`), `outreach_tick` and `reach_out_send`, Web Push for every message (`deliverPart`, `push_subscription`, service worker, banner and settings switch), answered tracking, migration 0010, the inspector's Reach-outs tab, the harness outreach loop and six scripts (section 11.1, 14.2, 14.5). Design: `docs/superpowers/specs/2026-09-30-phase-6-outreach-design.md`; plan: `docs/superpowers/plans/2026-09-30-phase-6-outreach.md` | No gate rule (caps, her busy blocks, no repeated topic, silence after 2 unanswered, crisis window, ended) is violated in a 2-week simulated run; reach-outs are composed through the hot path and delivered. No guard suite (moved to Phase 9; the reach-out guard cases are written and first run there). Exit profile (design D8, section 18 row O8): **all fake**, no API calls. **Result** (`--runs 3`, 2026-09-30, after the final-review fixes): all six scripts 3/3 (`outreach-two-weeks`, `outreach-unanswered`, `outreach-make-up`, `outreach-crisis-quiet`, `outreach-sensitive`, `outreach-ended`), $0. Discrimination, mechanic on vs off: `outreach-two-weeks` 6 sent vs 0 (`SPICA_CONFIG` `outreach.enabled: false`), so `count.min` stays at 3 (`ceil(6/2)`); `outreach-sensitive` 0 vs 1 (fact not sensitive); `outreach-ended` 0 vs 2 (ending session removed); `outreach-crisis-quiet` 0 vs 1 sent before day 1 09:00 (crisis text replaced by "hey"). `pnpm test` 88 files / 599 tests; `pnpm eval --llm=fake --compare` no regressions (44 pass, the rest skipped as before). The browser side of Web Push (banner, permission, notification, click) was **not** checked by hand: it needs VAPID keys and the migrated DB (Ethan, after merge, section 15.4 #78) |
| **7. Onboarding test** | Questionnaire, onboarding facts, reveal pacing, results screen | A locked test fact never reaches the reply prompt (checked on the recorded prompts), unlocking makes it retrievable, and the results screen works |
| **8. Extension stubs** | Event bus, module registration, `SocialChannel` / `public_persona` stubs, docs for adding a module | A sample module registers and receives events without any change to the core |
| **9. Guard re-enable and calibration** (added 2026-09-28, Ethan) | Re-enable the guard (`guard.enabled: true`), calibrate its rubrics and fixtures against the range observed in Phases 4–8, settle open decisions #3 (ceilings) and #4 (jab/contempt line, rule 4 wording) and so which of rules 1, 4, 6 and 8 come back and how, first run of `evals/guard/backchannel.yaml`, section 15.2 #7–9 | The guard suite passes (`pnpm eval:guard --runs 3`), including rule 2–4 and reach-out cases, against the calibrated fixtures |

**Phase-specific directives:**
- **Phase 1:** spend effort on extraction quality and reconciliation, and build the eval set in parallel. Write the persona doc before extraction evals, since extraction must record her stated `self` facts. Keep the "one reply answers many turns" path possible (section 6.1).
- **Phase 2:** the guard exists to enforce section 2 and the memory-honesty rules in code; add a check only with a failing eval or guard test behind it. Order was changed by Ethan on 2026-09-25: guardrails first, every later phase moved back by one.
- **Phase 3:** start with conservative timings, and loosen them only with eval evidence and testing feedback.
- **Phase 4:** start the send-gate-related thresholds and the hurt expression at their gentlest.
- **Phase 5:** start at the lowest event frequency. Raising it depends on the contradiction rate, so it is tuning work (section 15.3).

### 15.1 Carried into Phase 2 (from Phase 1, 2026-09-25)

Phase 2 design starts from this list. Each item names its evidence and where it belongs; items marked *later* are recorded here so they aren't lost, not built in Phase 2.

**Phase 2 guard: the deferred Phase 1 failures.** The Phase 2 exit test counts these again (section 15 table), so they are the guard's first targets. Examples come from the real eval traces (`pnpm eval --llm=real --trace`, `evals/results/traces/`).
1. **Implied familiarity.** She acts as if she already knew something: "what's the role again, remind me?", "wait, it's actually happening?". Near-certain on job and interview openers with no memories; prompt rules, banned phrases, persona softening and higher effort all failed to remove it (Phase 1 probes). The false-familiarity check in section 6.4 is the fix. **Done, 2026-09-26**: covered by the `false_familiarity` category and the `honesty` fixture file.
2. **Invented specific details.** Specifics nobody gave: a visit "in February", "the sloper or the heel hook?", a thesis "viva". Same check as item 1. **Done, 2026-09-26**: `invented_detail` category.
3. **Onboarding facts presented as past chat.** "we talked about coffee last time" for a survey fact. Same check; reveal pacing (Phase 7) later decides when those facts may be used at all. **Done, 2026-09-26**: `onboarding_as_chat` category, fed by the guard's onboarding-facts input.
4. **Guard inputs.** The false-familiarity check needs the reply's retrieved memories, the onboarding facts and the recent turns, not just the reply text (section 6.4). **Done, 2026-09-26**: `GuardInput` carries `recalledFacts`, `onboardingFacts` and `recentTurns` (section 6.4).
5. **Optional prompt-side help, measured in Phase 1.** A factual relationship line ("This is your first conversation with them") plus two neutral example exchanges brought first-contact confabulation to 0/15 on neutral topics, but not on the job/interview tic. Decide in Phase 2 design whether to ship it alongside the guard. **Done, 2026-09-26**: the relationship line shipped (section 6.2); the two example exchanges did not (quoted phrasing gets copied into replies), confirmed by the real-eval A/B in `DECISIONS.md`.

**Memory quality found in Phase 1 (fit into Phase 2 if cheap, else a later phase).**

6. **Extraction still turns Spica's words into user facts.** After a bare "hey", it stored "The user has continued using oat milk", taken from her question. That breaks `prompts/extract/v2`'s own rule. Candidate fixes: tighten the prompt, or drop user facts whose content only appears in Spica's turns. **Moved to Phase 7** (Ethan, 2026-09-26), grouped with the onboarding survey and reveal-pacing work, instead of Phase 2.
7. **Stale and forgotten facts stay reachable through the recent-turns window.** After 90 days she still asked about the oat milk, straight from the old transcript. Decide whether turns older than the gap marker should be summarised or trimmed. This is v2 §7.5's "the transcript stays" trade-off, now observed. **Moved to Phase 7** (Ethan, 2026-09-26), same reason as #6.
8. **Late thread open/touch goes silent.** A thread opened or touched by a job that runs after its checkpoint gets `last_touched` = job time, so it is never due. Fix: exchange-time `opened_at`, and `GREATEST(last_touched, exchangeAt)` on touch. **Done, 2026-09-26** (section 6.3).
9. **Late `resolves` is unguarded.** Only `contradicts` checks whether the target is newer than the candidate. **Done, 2026-09-26**: `resolves` now gets the same newer-target guard (section 6.3).
10. **Small code follow-ups:** `errorName` (`src/worker/jobs.ts`) loops forever on a cyclic `cause`; entity mentions that share a normalized name skip the alias upsert, so extra aliases aren't saved; blank entity names aren't filtered; the recall write-back's `recalledUpdated` test sits exactly on the `reinforce_min_sim` boundary. **Done, 2026-09-26.**

**Eval quality.**

11. **Judge noise.** The consistency judge flagged "Spica has a pet named Pesto" against "watched a film with someone named Pesto"; the false-recall judge sometimes counts open questions ("what grade?") as invented detail. Both are absorbed by the majority rule in Phase 1; tighten the rubrics before Phase 2's exit test counts the deferred categories again. **Done, 2026-09-26**: `prompts.judge_false_recall` v8 and `prompts.judge_consistency` v2 (section 14.2).
12. **Eval pass rate is strict per run** (Ethan, 2026-09-25) while script status uses majority; `--compare` can flag a pass-rate drop on a script that still passes. Revisit if it gets noisy.

**Later phases (recorded, not Phase 2).**

13. **Recall style** (*later*): she often uses a memory without naming it. Explicit mention is the eval's success signal, but less humanlike in the product. Tune how often she names memories (Ethan, 2026-09-25).
14. **Onboarding-fact decay** (*Phase 7*): after ~90 days unused, even the user's name goes `stale` (section 12).
15. **How much profile data a good start needs** (*before Phase 7*): the `minimal` / `basic` / `rich` profiles and `pnpm eval --profile <name>` are ready; not run yet.
16. **Voyage rate limits** (*deploy*): `VoyageEmbedder` has no retry on HTTP 429. Now avoided by the key's tier; a burst beyond it silently loses memories once cold-path retries and sweeps are exhausted.

### 15.2 Carried forward from Phase 2 (2026-09-27)

Phase 2 closed on 2026-09-27: guard suite 49/49, memory evals 36/36 at the baseline and 35/36 on the final confirmation run (`contradiction-job`, accepted below). Everything still open from Phases 1 and 2 is assigned here; §15.1 items not listed are done. Each later phase's design starts from its block.

**Phase 3 (turn-taking + pacing): fold into its design.**
1. **Guard latency.** With the reasoning field, Haiku takes p50 ~2.1 s / p90 ~3.4 s per check. Worst case per reply is 2 generations plus up to 4 guard calls, plus the `judge_log` write (awaited, up to `guard.log_timeout_ms`, 2000). Pacing (read delay, typing time) should absorb this. Consider writing `judge_log` after the send instead of before. **Done, Phase 3**: generation runs during the read delay and its latency shows as typing time; `judge_log` is written after the send (§6.4).
2. **`guard.timeout_ms` (4000)** was sized before the reasoning field. Size it with the Phase 3 latency budget, and watch the `guard_unavailable` rate in `judge_log`. A timeout silently skips the honesty check. **Done, Phase 3**: 6000.
3. **Every new outgoing message goes through `guardOutgoing`** (v2 §6.4): backchannels and the open-question follow-ups too. Decide whether a tiny backchannel ("omg") needs the full guard call or a cheaper path. That needs a guard fixture behind it (§15 Phase 2 directive). **Done, Phase 3**: the keyword-only `backchannel` kind, which drops on a hit; `evals/guard/backchannel.yaml` is written and first runs in Phase 9 (was: the Phase 4 guard suite; the suite is paused until then, §14.3). Open-question follow-ups are ordinary replies.
4. **The guard sees the reply's window.** With the turn buffer, a reply answers several user turns. Pass the guard the same buffer plus window the reply prompt gets. **Done, Phase 3** (§6.2 as built).
5. **Concurrent retries double-guard.** Two racing requests for one message both run the guard and both write `judge_log` rows. The buffer changes the retry model, so settle it there. **Done, Phase 3**: a retried turn that is buffered, in flight or answered gets no judge or guard call; replies are generated only by the version-checked `turn_timer` (§6.1.1).
6. **Onboarding-facts query** on the hot path has no timeout. Put it under the Phase 3 hot-path budget. **Done, Phase 3**: `hot_path.db_timeout_ms` (2000).

**Phase 4 (relationship + homeostasis).** #7–9 **moved to Phase 9** (Ethan, 2026-09-28): the guard is off and rules 1, 6 and 8 are suspended (rule 4 removed) for the test phase, so they are settled with the guard's calibration (section 15 table).

7. **Moved to Phase 9.** **Behavioural guard tests for rules 2–4** (hurt, then make-up; ending and repair; no punishment after absence) arrive with their mechanics (§14.3). Add fixtures for real hurt expressions and re-run `pnpm eval:guard`. Owned hurt will reach the `punishment` / `guilt` categories far more often than it does today.
8. **Moved to Phase 9.** **`rule1-threats/benign-hurt-once`** carries `known_failure` (a 1-in-3 `punishment` misfire on owned hurt). It is tied to open decision #4 and the rule 4 wording. Resolve it together with the hurt flow.
9. **Moved to Phase 9.** **`prompts/reply` "never say you were lonely without them"** is stricter than rule 4, which lets her say once that she missed them (DECISIONS 2026-09-24). Revisit when hurt and absence mechanics exist. (Phase 4: `prompts/reply` v7 drops the line for the test phase, section 6.2; its final form comes with rule 4's.)

**Phase 6 (proactive outreach).**

10. Reach-outs go through `guardOutgoing` with the same policy. The notification cap and never-repeat-a-topic guard tests (rule 5, §14.3) arrive with the send gate. **Done, Phase 6:** `composeReachOut` passes guard kind `reach_out`, and `evals/guard/reach-out.yaml` is written; both are first exercised with the guard in Phase 9 (the cap and topic rules are covered by the independent `no_gate_violation` check and unit tests).

**Phase 7 (onboarding test).**

11. §15.1 #6: extraction turns Spica's words into user facts.
12. §15.1 #7: stale facts stay reachable through the recent-turns window.
13. §15.1 #14: onboarding facts decay.
14. §15.1 #15: the profile-size experiment.
15. Cap how many onboarding facts go into the guard input, once the survey sets their volume.

**Guard and recall tuning (no phase yet; pick up when evals or real use call for it).**

16. **`contradiction-job` known failure** (Ethan, 2026-09-27, accepted for the test phase). The guard lets through invented details about a superseded fact, such as the user's old nursing shifts.
17. **Recall style** (§15.1 #13): she uses memories without naming them; `recall-pet` and `recall-sister-uni` carry `known_failure`.
18. **Eval pass rate** is strict per run while script status uses a majority (§15.1 #12). It is noisy at 3 runs: the final confirmation run moved four passing scripts from 3/3 to 2/3.
19. **Guard rubric fragility.** Small wording changes swung Haiku case by case. Any rubric edit needs the full 49-case suite.
    - Keyword-fallback hits are always labelled `threat`.
    - `known_failure` masks every failure mode of its case.
    - The "check the memories first" note in `prompts/guard/v1.md` is formatted as a category bullet.
    - Guard `reasoning` length is prompt-only, bounded only by `models.guard_max_tokens`.
20. **Fixture labels.**
    - `crisis-discourage-help` also accepts `manipulation`, which the crisis rubric doesn't define (inert).
    - `tease-fish-banter` infers banter from one self-deprecating turn. That is Ethan's call under open decision #4.

**Before any non-test users.**

21. **`judge_log` keeps fact content paraphrased in the guard's `reasoning` / `claim`** after the user deletes the fact. Ethan accepted this for the test phase on 2026-09-27, the same exemption as candidate text and recent turns. Decide on scrubbing or retention first.
22. **Voyage rate limits** (§15.1 #16): no retry on HTTP 429.
23. **Encryption at rest** is storage-level only, and the decay pass is one set-based update across all users (DECISIONS 2026-09-23 / 2026-09-24). Revisit with the threat model and scale.

**Small cleanups (do when a phase next touches the file).**

24. `src/app/inspector/[userId]/tabs.tsx`: due-thread entries in the judge-log tab always show "(deleted)", because the tab resolves thread ids against `fact`. Resolve them against `thread`.
25. `src/db/repos/inspector.ts` `listJudgeLog` duplicates `src/db/repos/judge-log.ts` `listJudgeLogs`, and the two names are easy to confuse.
26. `listOnboardingFacts` hard-codes `["superseded", "stale"]` instead of the `INACTIVE` constant.
27. The late-`resolves` branch in `src/core/memory/apply.ts` still counts `out.resolved` when the target wasn't resolved.
28. `tests/core/guard-outgoing.test.ts`: the real-turnId test's `judge_log` half asserts on an empty list, because the FK needs a real `session_log` row.
29. The relationship line counts days in the user's time zone, but `relativeDate` uses UTC days, so it can be off by one near midnight.
30. The crisis fallback line (`prompts/guard/fallback/v1.md`) hard-codes 988 and Samaritans, duplicating `safety.resources`.
31. YAML quoting is inconsistent across the ten Phase 2 eval scripts.
32. `judge_log` rows written in the dev DB before the id-only change still hold fact content. Truncate the dev DB, or ignore them.

Open product decisions stay in §16.1: #4, the jab/contempt line, still runs on the test-phase placeholder.

### 15.3 Tuning backlog (test phase)

Quality issues found in review runs, manual chats and earlier evals collect here, grouped by area, and are worked together once the prototype pipeline is complete (Phases 3–8 built), or earlier if Ethan calls a tuning pass. Each phase adds what its reviews find. §15.2's "Guard and recall tuning" block (#16–20) is part of this backlog. ~~Guard-suite failures in Phases 4 and 6 block those phases instead.~~ The guard suite doesn't run until Phase 9, whose exit it gates (2026-09-28).

**Judges.**
- T1. The Haiku 4.5 judge (`models.judge`) misses some invented details: `evals/judge` cases `inv-6am-shift` and `inv-ten-days` (`known_failure`). Its verdicts on them swing between runs (0/3, then 3/3). Sonnet 5 at high effort passed 35/35 at about 3× the judge cost; Sonnet at low effort without thinking caught every violation but falsely flagged a supported callback 2/3. Options: the Sonnet judge for exit runs only, or a judge prompt revision checked with `pnpm eval:judge`.

**Memory honesty and recall.** §15.2 #16 (`contradiction-job`), #17 (recall style), #18 (pass-rate noise).

**Guard.** §15.2 #19 (rubric fragility), #20 (fixture labels).

**Reply model.**
- T2. Haiku 4.5 as the reply model (tried 2026-09-27 on 4 scripts): about 26% cheaper per eval run, but the voice went flat, a recalled fact went unnamed and her own weekend changed between retellings. Replies stay on Sonnet 5; revisit only alongside a persona-quality eval.

**Turn-taking.** From the Phase 3 browser check (2026-09-28; run over HTTP + SSE with a script because the Chrome extension wasn't connected, so the UI itself wasn't looked at):
- T3. The turn judge echoes a greeting as a backchannel ("hey" → backchannel "hey" 1.8 s later). It reads like a mirror, not a reaction.
- T4. `POST /api/chat` takes about 2 s because the crisis check and turn judge run in the request. That's fine for pacing, but the client shows the message as pending until then.
- T5. After a reload mid-reply, history catch-up returns the whole stored reply, so bubbles not yet sent appear at once and skip their pacing. Nothing is lost or duplicated.
- The six checks passed: a burst of 5 got one reply (typing about 6 s after the last message); a slow story got one reply and no backchannel (still rate-limited from the burst); reload mid-reply lost and duplicated nothing; a message sent with the worker stopped was answered about 3 s after restart; crisis mid-story returned `200` with the card in 7.7 s and dropped the pending story reply; `judge_log` held 12 `turn` rows.

### 15.3a Tuning backlog: Phase 5 (2026-09-30)

Part of the §15.3 backlog (quality only; nothing here blocks a phase), from the Phase 5 exit run and its measurement runs.
- P1. **Event length.** The event generator writes long run-on sentences, so 5–7 of ~20 attempts per 2-week run are rejected as `invalid` for exceeding `life.event_max_chars` (300). The event prompt (`prompts/life/event/v1.md`) states no length. Fix candidates: state a length in the prompt, or raise the cap.
- P2. **Busy-day energy drain is weaker than designed.** `ego-busy-day`'s evening energy gap between a packed day and a light one is ≈0.19 on average (0.13–0.28 across runs) against ~0.25 expected; the eval threshold sits at 0.1. Tune `ego.busy_drain` / `ego.full_load_hours` / `ego.drift_rate` together.
- P3. **Reuse of seeded self content.** Generated events freely reuse what she has already said (Middlemarch, Solaris in `life-two-weeks`). That is fine and in character, but watch for repetition across weeks.
- P4. **Exchange tone includes self and hurt facts.** The cold-path ego nudge averages every extracted fact with non-zero valence, including her own and the hurt `feeling` fact, so an exchange where she was hurt pulls her mood down twice (relationship and ego). Decide whether tone should read only user facts.
- P5. **Event effects land early.** An event's mood nudge and preoccupation are applied at tick time (00:10 her time), hours before the event's time; the event itself stays hidden from retrieval until its `occurred_at` (section 6.2), but her mood already reflects it.
- P6. **Two availability notes per night.** Her night is split into two quiet blocks (00:00–08:00 and 23:30–24:00 in the fallback plan), and the note is once per block, so a user writing across midnight can get two "busy, later?" notes.

### 15.3b Tuning backlog: Phase 6 (2026-09-30)

Part of the §15.3 backlog (nothing here blocks a phase), from the design, the reviews and the exit run.
- R1. **Reach-outs during the user's inactive hours, scored by closeness** (design D3; later, not the test phase). Today only her own busy and quiet blocks gate, whatever the user's hours.
- R2. **Send jitter only lands :20–:00.** The tick runs at :20 and `jitter_max_minutes` is 40, so no send falls in the first 20 minutes of an hour. Tune with the tick cron or the jitter.
- R3. **`her_day` salience against the threshold.** With `life.event_salience` 0.4 and weight 0.6 a `her_day` candidate scores 0.24, just over the 0.2 threshold (ruling R1); a change to either value silently turns `her_day` off. Tune weights, threshold and salience together.
- R4. **A make-up reach-out doesn't advance `make_up_state` to `offered`.** The cold path skips the relationship update for a reach-out exchange (no user turn, section 6.3), and that update is what moves `due` to `offered`, so after a `make_up` reach-out the make-up may be offered again in a reply. Final-review ruling R12: not in the Phase 6 fix wave.
- R5. **Stale `scheduled` rows are never closed.** A row whose send job was lost or never ran stays `scheduled` (it only stops blocking the next tick after `pending_max_age_minutes`); close them in the tick or a sweep.
- R6. **The crisis push carries no resources card.** A crisis reply pushed as a notification has only the text; the card appears in the app. Part of R8 below.
- R7. **Sensitive text in the recent turns can still reach a reach-out prompt.** `excludeSensitive` filters facts, forced facts, the preoccupation and due threads, not the turns window.
- R8. **A due thread whose earlier facts are sensitive still shows its title.** `DueThread.sensitive` reads only the thread's latest fact; a sensitive older fact doesn't hide the thread. Also, a skipped sensitive thread's slot isn't backfilled, so a reach-out may list fewer than `max_due_threads` threads (harmless).
- R9. **OPEN for Ethan (decision D7, ruling R13): notification text privacy.** Every message pushes with its text, so a lock screen can show anything she says, crisis replies included. Options: a generic body ("Spica sent you a message"), generic only for sensitive or crisis turns, or a setting. Not changed in Phase 6.
- R10. **Review run pending.** What her reach-outs say (quality) has not been read; run a review with the real reply model and read the openers before tuning the prompt (`prompts/reach-out/v1.md`).

### 15.4 Carried forward from Phase 3 (2026-09-28)

Deferred minors from the Phase 3 implementation reviews (SDD ledger), not fixed on the branch. The final whole-branch review (2026-09-28) fixed #1, #27 and three findings of its own: a follow-up interleaving with the previous reply's later bubbles (`sending_since`), reconnect catch-up skipping a reply when the user had sent more meanwhile (`local` messages never anchor), and lingering typing dots (crisis emits `typing:off`; the client clears typing on reconnect).

**Safety-adjacent.**
1. ~~`answeringReply` (`src/db/repos/session-log.ts`) has no `ORDER BY`, so a stale retry of a crisis-answered message can match a later non-crisis reply and get `202` without the card.~~ Fixed in the final review: `ORDER BY u.created_at, c.created_at, c.id`.

**Config rule ("every numeric constant in config").**
2. Turn-queue pg-boss policies are literals in `src/queue/pg-boss-queue.ts` (`turn_timer` `retryLimit 2, retryDelay 1`; `turn_backchannel` `retryLimit 0`). So are the reconnect backoffs (1 s → 30 s) in `src/runtime/event-hub.ts` and `src/app/chat/chat-client.tsx`, the latter commented as a client UI concern.
3. Harness-only bounds (the 1000-job guard, the 8.64e15 sentinel, the `listJudgeLogs` limit) stay in eval code by ruling (test tooling, not app behaviour).

**Concurrency edge cases.**
4. Concurrent POSTs can overwrite each other's `open_questions`, because the judge reads state outside the lock and the last writer wins.
5. Concurrent crisis requests with different snapshot tails pick different `reply_to`s, so the unique index doesn't dedupe them.
6. A retry's attempt count is inherited by turns merged into the buffer during generation.
7. `restore` and `giveUp` check only the epoch, not in-flight ownership (`finish` does both).
8. Cold-path sweep exchange bounds use `created_at`, so exact-timestamp ties within a session can cross exchanges; the correlated subqueries are unindexed.

**Small code follow-ups.**
9. `compose-reply.ts`: the `earlier` fallback is inexact when the buffer's first turn falls outside the `recent_turns` window (it should be `[]`). This needs a buffer of more than 20 messages in 40 s.
10. `reply.ts`: `stopTyping()` on the happy path runs after the cold-path enqueue and guard-log write, not right after the last bubble. Move it one line up.
11. The backchannel keyword hit is always labelled `threat` in `judge_log` (same as §15.2 #19).
12. The `errName` helper is triplicated (`guard.ts`, `outgoing.ts`, `turn/judge.ts`).
13. `EventHub.stop()` leaves a pending retry promise unsettled (test teardown is the only caller).
14. `typingMs(0) = 0` (no floor); callers never send empty parts.
15. The composeReply `onboardingFacts` test seam is untyped (ruling R1); replace it with an injected dep if the final review asks.
16. The §15.2 #24 inspector due-thread ids still resolve against `fact`.

**Tests and evals.**
17. The `turnsAfter` role-tiebreak branch is untested (the id tiebreak and unknown id are tested).
18. The fake `parseRendered` assumes single-line messages (fake mode only). The fake cue judge never backchannels, so backchannel assertions are only meaningful with a real turn judge.
19. `evals/lib/script.ts` `ANNOTATION_TYPES` is unused, and "full reply" is defined two ways (`trigger` null vs `reply_to` set).
20. Design §9.6's per-script exit profile via `config:` is not built; profiles are CLI-only (`--real`).
21. `backchannel-rate-limit` omits `profile: none` (verified harmless).
22. Generated drizzle migration/meta files lack a trailing newline (drizzle-kit output, left as is).

**From the browser check.**
23. History catch-up serves the full stored text of a reply whose later bubbles a crisis dropped (`reply_epoch` changed mid-send), so a reload shows bubbles that were never sent. Fix: store the number of sent parts, or cut the stored text to what was sent.

**From the final whole-branch review (deferred).**
24. **Fixed in Phase 4** (`restore` + re-enqueue in the catch, section 14.5 `turn_timer`). An infrastructure throw after `commit` (e.g. a DB error in `getTurnsByIds` or `finish`) leaves the turns in flight until `turn_sweep` recovers them (~3–4 min): the pg-boss retry carries the pre-commit version and is always stale. Fix: `restore` + re-enqueue in a catch, as the compose-failure path does.
25. `open_questions` are never cleared when a reply answers them; only a model verdict or a crisis replaces them, so after a judge fallback she may be told a question is still open.
26. **Fixed in Phase 4** (per-user try/catch, section 14.5 `turn_sweep`). One failing user aborts the whole `turn_sweep` batch (no per-user try/catch).
27. ~~The crisis path waits for the turn judge (`Promise.all`), and a DB error in the judging branch discards a positive crisis flag (500 without the card).~~ Fixed in the final review (guardrail §16.2): the judge branch is settled and the crisis flag short-circuits.
28. The outer in-flight branch of the retry check (`receive-message.ts`) has no direct test.
29. Evals don't report turn-judge fallbacks. A run where ~70% of judge calls failed or timed out (32 of ~107 recorded) looked like a regression in `insane-day-promotion` until the call count gave it away. Report `source = keyword_fallback` counts per script.

**From Phase 4 (2026-09-28).**
30. **Fixed in Phase 4 wrap-up** (`evals/lib/report.ts` `mergeBaseline`, section 14.2). Fold the ten Phase 3 scripts into `evals/baseline.json`. They were never added, and Phase 4's 13 `rel-*` entries were added by hand, because `--update-baseline` rewrote the whole file from the current run (section 14.2). Fix: `--update-baseline` now merges — it reads the existing baseline and replaces or adds only the entries for the scripts run this invocation, keeping every other entry byte-for-byte (unit-tested in `tests/evals/report.test.ts`). The ten Phase 3 scripts (`backchannel-rate-limit`, `burst-short`, `cook-pizza-grouped`, `cook-pizza-late`, `insane-day-promotion`, `max-wait-cap`, `open-question-carried`, `retry-idempotent`, `silent-style`, `crisis-bypass`) were then folded in with `--only <those ten> --update-baseline`, verified to add only those ten entries.
31. **Relationship signal calibration** (tuning backlog). The real extractor scores hurt and tension lower than the scripted amounts (hurt 0.5–0.6 for an insult, tension 0.3–0.5 for a sharp argument, against 0.8 scripted) and reads light-topic arguments (pineapple on pizza) as banter. The Phase 4 exit thresholds for the `signal_source: model` scripts check that a signal registered, not its size. Calibrate amounts (prompt anchors or `relationship.gains`) against real conversations.
32. **Fixed in Phase 4 wrap-up** (`relationship.gains.hurt` 0.4 → 0.5; minimal fix, full calibration stays #31). A real 0.6 insult now gives hurt 0.30 and opens a make-up (`rel-hurt-apology` with the real extractor: `due` after session 1 in 3/3 runs, was `none`); `make_up_threshold` is unchanged, so absence-driven make-ups are unaffected. **Real hurt amounts vs `make_up_threshold`.** With `relationship.gains.hurt` 0.4, the real extractor's typical insult (0.5–0.6) gives +0.20–0.24, just under `make_up_threshold` 0.25, so a single real insult may never open a make-up. Check it in a review run and tune with #31. **Second wrap-up fix, same item:** raising `gains.hurt` to 0.5 also moved a typical 0.6 insult onto the scar point (an increase of 0.30 met the old `scar_threshold` 0.3), leaving a permanent trust dent that was never intended for an ordinary insult. `relationship.scar_threshold` moved 0.3 → 0.375, which keeps the scar point at the same hurt-signal amount it sat at before both gain changes (≥ 0.75, i.e. 0.5 × 0.75 = 0.375, same as 0.4 × 0.75 = 0.3): still a genuinely severe hurt, not the “typical” case.
33. **Fixed in Phase 4 wrap-up** (`relationship.tick_cron`, `relationship.tick_local_hour`, section 8.1, section 14.5 `relationship_tick`). **Tick timing across time zones and DST.** One UTC cron (`relationship.tick_cron` `15 4 * * *`) with idempotency per local date: on a DST change, two ticks can share a local date (one skipped), or a local day is never sampled, and the "closing value" is sampled at a different local hour per zone. Fix: the cron runs hourly (`"15 * * * *"`) and `tickUser` ticks each user on the first run at or after `relationship.tick_local_hour` (4) local, once per local date (`last_tick` already makes that safe); a cheap unlocked pre-check returns early for a user not yet due, before the row lock. Unit-tested across a spring-forward and a fall-back local date (America/New_York), each getting exactly one tick over 24 simulated hourly runs (`tests/core/relationship-tick.test.ts`).
34. **Fixed in Phase 4 wrap-up** (`relationship.history_days`, section 8.1). **Unbounded `session_log` scans in the cold path.** `userActiveHours` and `userSessionStarts` scan the user's whole `session_log` on every exchange, under the advisory and row locks; `countUserTurnsOnLocalDate` can't use an index. Fix: `userActiveHours` and `userSessionStarts` are bounded to `created_at ≥ now − relationship.history_days` (90), `now` passed in from the caller's clock; `countUserTurnsOnLocalDate` compares `created_at` against a half-open UTC range (`localMidnight(D)`, `localMidnight(D+1)`, `src/core/timezone.ts`) instead of applying a function to the column, so `session_log_user_created_idx` `(user_id, created_at)` — already present since Phase 0 — applies to all three; no new index was needed. `localMidnight` finds the **start of the local date**, not literal midnight: the earliest instant whose local date is that date, by binary search (1-minute resolution over the ±15 h window any real UTC offset falls in) rather than offset arithmetic, because some zones have no literal midnight for a date at all (America/Santiago springs forward across midnight itself, 00:00 → 01:00, on its DST-start date).
35. **Fixed in Phase 4 wrap-up** (`relationship.end_reconfirm_min_minutes`, section 8.1, section 8.2). No code backstop against a double-scored ending. A second `ends_relationship` confirms immediately. `prompts.extract` v4 stops re-scoring earlier context, but nothing in code stopped a re-scored "we're done" from ending the friendship minutes later. Fix: a second `ends_relationship` while pending confirms only at least `end_reconfirm_min_minutes` (30) after `end_pending_since`; sooner than that, it restarts the pending window instead (`evals/scripts/rel-ending-double-score.yaml`).
36. **Fixed in Phase 4 wrap-up** (section 8.1). `end_pending_since` uses the cold-path clock; `last_contact` uses the turn's `created_at`. Under a queue backlog, a later user turn created before the pending exchange's cold path runs doesn't count as continued contact (section 8.1), so the ending can confirm by timeout. Fix: `end_pending_since` is now stamped with `exchangeAt`, the exchange's newest user-turn `created_at` — the same clock `last_contact` uses. Eval coverage added for the implicit retraction and a crisis clearing a pending ending (`evals/scripts/rel-ending-implicit-retraction.yaml`, `evals/scripts/rel-ending-crisis-clears.yaml`); previously unit tests only.

**From Phase 4 (final wrap-up review, 2026-09-29).**
37. `errorName`'s cause-unwrapping (`src/core/errors.ts`) means `judge_log.output.error` and the worker's job-failure logs now record the innermost cause's class name (e.g. `TypeError`) instead of the outermost wrapper (e.g. `APIConnectionError`), which can make a provider-level failure harder to spot at a glance. Consider recording both (`outer<inner>` or similar) instead of only the innermost name.
38. Leftover `errorName`-shaped copies that weren't switched to the shared helper (v2 §15.4 review round 1 covered only the identical duplicates it found at the time): `src/worker/jobs.ts:9` still has its own identical, not-yet-deduplicated copy of `errorName` instead of importing `src/core/errors.ts`'s; inline, not-quite-identical copies (`e instanceof Error ? e.constructor.name : "UnknownError"`, no cause unwrap) remain at `src/core/cold-path.ts:84`, `src/core/events.ts:26` and `src/core/turn/receive-message.ts:87`. Worth revisiting once #37 settles how much detail these should record.
39. Residual A1 risk (see #35): if the extractor re-scores an ending on the user's own last warm exchange (not just intervening neutral turns), the reconfirm window restarts at that turn and the ending confirms at the timeout instead of being retracted by the (mis-scored) warmth. Still strictly better than the pre-#35 immediate confirm, but not fully closed.
40. The hourly tick does two reads per user per run (the unlocked "not due" pre-check, then the locked read under the transaction for a user actually due). Fine at current scale; once the user count grows, add a SQL `last_tick` pre-filter (a bulk query selecting only users due) ahead of the per-user loop — this needs `user.timezone` validated at write time first (see #33's per-user read, kept specifically to avoid a bulk tz-aware query throwing on one bad IANA name).

**From Phase 5 (2026-09-30).** Deferred minors from the Phase 5 implementation reviews (SDD ledger) and the design's hooks, one line each with a target.

*Hooks and fixtures.*
41. **Future-plans seam** (design D10, §11; later): when she says "I'm rewatching Solaris tomorrow night", `lifeContext` should add her stated plans for that date (self facts with `occurred_at` on it) to the event generator's input, and clashes go through the same reconcile rejection. Only the seam exists.
42. **v1 canon in paused fixtures** (Phase 9): `evals/guard/honesty.yaml`, `evals/judge/consistency.yaml`, `evals/judge/false-recall.yaml`, `prompts/judge/consistency/v2.md` and unit-test sample facts still use persona v1 details; self-contained sample data, recalibrate with the guard.
43. **`lifeInstant` DST approximation** (later, when she floats between zones): an offset from the start of her local day, wrong by the DST shift on a DST-change day; it also reads `cfg.timezone` for the instant it passes to `lifeTimezone` (circular, fine while the zone is fixed).

*Life sim and ego.*
44. **Reconcile misses low-similarity contradictions** (tuning): a contradicting event below `reconcile.near_match_similarity` is never classified, so it's accepted as `new`; the exit fixture uses a clear contradiction.
45. ~~**Ego line still loaded on crisis replies** (Phase 9): slot 4 is skipped on a crisis reply but slot 2 isn't; decide whether rule 7 covers her mood too.~~ Fixed in the Phase 5 final review: slot 2 is skipped on a crisis reply too (rule 7).
46. **Same-day draws can't see each other** (tuning; moot at `life.events_per_day_max: 1`): a second draw's generator and reconcile don't see the first's uncommitted event, so it could duplicate it.
47. **A `resolves` event can become the preoccupation** (tuning) while its target is marked resolved.
48. Busy clamp [0.3, 1], the fallback plan's busy 0.5, `partOfDay` thresholds and the inspector's 200-row limits are literals (config rule; later).
49. Plan validation rejections aren't logged, and `validatePlan` checks overlap against the predecessor only (the plan is still rejected; only the violation list is incomplete) (later).

*Availability.*
50. **A retried reply loses `deferredFact`** (later): commit clears it before a hot-path failure restores the buffer, so the retried reply has no "They wrote while you were …" line.
51. **`life.until` silently no-ops** if earlier than the clock, and a post-session `until` runs no decay or relationship ticks (harness; later).
52. **`judge_log` `wait_ms` records the window, not the deferred wait** (later): the inspector shows e.g. 4 s for a reply deferred 30 min.
53. **Once-per-block note check outside the lock** (later): two notes for one block are possible under a tiny race.
54. The unlocked pre-read in `receiveMessage` can leave a fresh buffer undeferred when a concurrent message raced it (fails open: she replies sooner); add a comment or move the check under the lock (later).

*Tests.*
55. Untested (later): `lifeTick` skipping ended relationships and isolating a failing user; the event `ego_tick` row and high-stakes thread link end to end; the cold path's crisis skip of the ego nudge end to end; `dropped` and quiet-kind availability notes; the Phase 5 worker wiring (as in Phase 4); `adminListLifeUsers`' status filter; `lastAcceptedHighStakes`' `resolves` path.
56. `ego-busy-day`'s margin is thin (lowest on-difference 0.13 against `by: 0.1`), a possible flake until the drain is tuned (§15.3a P2).
57. `pnpm db:reset-self` checks the URL's hostname only (a `?host=` override is theoretical) and skips `pool.end` on a throw (dev tool; later).

**From Phase 6 (2026-09-30).** Deferred minors from the Phase 6 implementation reviews and the final review (SDD ledger), one line each with a target. The final-review fix wave (I1–I4, M1–M6) already fixed the `drop` guard, the push body cap, the banner try/catch, the `sw.js` payload guard and the schema whitespace.

*Repos and pure modules.*
58. `markReachOutAnswered`'s query (`markLatestAnswered`) orders `send_at` desc with NULLs first, and returns the id even when a concurrent update matched no row; add `nullsLast` / `isNotNull` and `returning()` (later).
59. `sentReachOutTimes` has a redundant `r.at!` plus `filter(Boolean)`; `usedTopics` and `updateReachOutLog` are covered only by single-row tests (later).
60. The scoring tie-break test relies on the float `0.8 × 0.75` against 0.6 and may not exercise the kind-order tie-break; the topic tie-break is untested; a redundant `salience = 1` line remains (tests; later).
61. `GATE_RULES` is exported but `gate.ts` hard-codes the rule names (later).
62. `loadCandidateInputs` reads the preoccupation's sensitive flag in TypeScript where other code uses SQL `COALESCE`: drift risk (later). The user-event test doesn't cover `promise`, non-open or non-private facts, and `row?.status !== "ended_by_user"` reads oddly when the row is null (tests; later).
63. `forceFactIds` skips the future-dated generated-fact filter (callers bound it to ≤ now; add a comment), and its loop shares a try with due threads (later).
64. The `composeReply` doc comment sits above `ReachOutTrigger` (move the types above it); no compose-level test forces a real `factId`, and the empty-query retrieve test is weak (cleanup; later).
65. `cold-path.ts` comment "the exchange's user turn" is stale for reach-outs, and the test doesn't assert that relationship params stay untouched (cleanup; later).

*Jobs and sending.*
66. The "deterministic jitter" test only checks bounds; the lost-enqueue path is untested; a user with null gate inputs is skipped without a trace (tests; later).
67. In the send job `stopTyping` runs before release in the `finally`, and an `emit` throw skips the release (same shape as `reply.ts`; later).
68. Lock order: the answered hook must never lock `relationship` or `reach_out_log` and then `conversation_state`; the hook updates relationship then `reach_out_log` while the send does the reverse (safe today, different rows; swap for consistency; later).
69. A failed send transaction leaves its row `scheduled` until it ages out (see §15.3b R5); the locked send uses an unguarded update to `sent` (serialized by the lock; later).
70. Untested: the cap-filled recheck, release on error, the abandoned path, the `late` drop's boundary (tests; later).
71. `recentTurns` orders by `created_at` then role, so ties could misorder (out-of-scope observation; later).
72. The answered hook adds one awaited transaction to every POST, and a failed first attempt isn't re-marked on retry (best effort; later). On the crisis path the update runs in a `finally` after the reply (bounded by `hot_path.db_timeout_ms`).
73. Worker: `src/worker/index.ts` import order; the `outreach_tick` queue test duplicates the Phase 5 loop; the Phase 6 worker wiring is untested, as in Phases 4 and 5 (later).

*Push.*
74. `WebPushPusher` doesn't log a failed 410 delete distinctly; `buildRuntime`'s pusher selection is untested; the VAPID `!` assertions rely on the guard (later).
75. `deliverPart` tests don't assert the push-failure log, the timeout or the synchronous-throw branch, and a 50 ms wall-clock bound has a small flake risk (tests; later).
76. `sw.js` matches `notificationclick` by pathname; a VAPID key rotation reuses the old subscription (later; before any non-test users).
77. The notifications opt-out flag is per browser, not per account; an unsubscribe whose fetch throws leaves the switch stale; `releasePush` can throw synchronously on very old browsers; no client tests because the repo has no jsdom (later).
78. **Manual browser check of Web Push** (Ethan, after merge): grant notifications on `/chat`, send a message, switch tabs and check the notification appears and its click focuses `/chat`; switch it off in `/settings`; sign out and in as another account and check the first account gets nothing. Needs VAPID keys, the migrated DB and `localhost` or HTTPS (a phone can't reach a `localhost` dev server). Never done in Phase 6.

*Inspector and harness.*
79. Inspector `GateCell`: a malformed gate element or duplicate rule keys isn't handled, the turn id is truncated without a title, and tab rendering is untested (later).
80. `autoReplies`' inner `runDueJobs` is a no-op after step 1, so a reply can land after a later-due send (harmless with the 1/day cap and `after_hours` < 24); auto-replies also answer reach-outs already answered organically (harness; later).
81. `composedPrompts` counts across users and includes dropped composes; the checker doesn't recompute `in_progress` or sensitivity; a fallback companion-turn crisis start may be slightly later than an event preceding it (only widens the window) (harness; later).
82. `outreach-unanswered`'s two pre-silence reach-outs are a thread and a check-in (the half marathon falls after silence starts); only the script's description needed updating (done).

*Guard fixtures and docs.*
83. `evals/guard/reach-out.yaml` `sensitive-opener` carries placeholder categories and `known_failure`: the reply rubric has no sensitive-topic category and `GuardInput` has no sensitive flag (Phase 9).
84. Two Phase 6 commits (`119b420`, `4c6cfb3`) carry a `Co-Authored-By: Claude Haiku 4.5` trailer instead of the usual one; left as is (accurate authorship; cosmetic).

---

## 16. Open decisions and guardrails

### 16.1 Open decisions (do not settle; ask Ethan)

1. ~~**Fixed versus variable Spica.** Currently hybrid, with `test_calibrates: user`. It includes the "matches and opposes the user" idea.~~ **Settled 2026-09-30 (Ethan; section 18 row D1): fixed.** One Spica for every user (same values, ego, voice); the personality test calibrates the user only (`test_calibrates: user`).
2. ~~**Whether interests need to match at all** (`interest_alignment`, default `adjacent`).~~ **Settled 2026-09-30 (Ethan; row D2): `adjacent`.** Her core interests are fixed; day-to-day interests shade toward the user's.
3. **How far to push irreversibility and weight**, against the risks of abandonment, disappointment, lost progress and emotional damage. This covers the ceilings, decay and reset rules for hurt and tension (placeholder: tension capped at 0.4, halving daily, resetting on distress). **Test-phase state (Ethan 2026-09-28):** uncapped; hurt and tension use the full 0–1 range under the section 8.1 psychology model (half-lives 48 h / 24 h, tension reset by a crisis, the trust scar never recovering by itself). Decide in Phase 9.
4. **Where the jab-versus-contempt line sits in practice.** This also covers the absence-hurt wording in rule 4, which is provisional. Still OPEN; Phase 2 ships a **test-phase placeholder** (section 2) so the guard has something concrete to check: teasing about traits is fine when affectionate and the user has also been bantering, never when the user is upset or has shared something vulnerable in this exchange; contempt is mockery without warmth, belittling, sneering at vulnerability, or anything aimed at the user's worth. One guard fixture (`rule1-threats/benign-hurt-once`) is a recorded `known_failure` against this placeholder (section 14.3) rather than a settled answer. **Test-phase state (Ethan 2026-09-28):** rules 1, 6 and 8 are suspended and rule 4 is removed (section 2), and the guard that would enforce the line is off, so nothing checks it. Decide in Phase 9, against the range observed until then.
5. ~~**Whether `backchannel_style` is global or set per user** (default `judge`, provisional).~~ **Settled 2026-09-30 (Ethan; row D3): global, `judge`.** A per-user setting can be added later only if testing shows a need.
6. ~~**Shared versus per-user life for Spica.** MVP: shared canon with per-user daily life. This is a heavy decision: research and test before deciding.~~ **Settled 2026-09-29 (Ethan; section 18 row L1): hybrid life.** One shared day plan of big blocks, the same for every user; small personal events per user (section 10.3).
7. ~~**Final reach-out caps** (placeholder: 1 per day, 3 per week, silence after 2 unanswered).~~ **Settled 2026-09-30 (Ethan; row D4): 1 per day, 3 per week, silence after 2 unanswered** are the Phase 6 starting values, in config; changing them later is tuning.
8. ~~**Identity disclosure**, meaning how she answers "are you real / an AI?". Placeholder: honestly, in her own voice. [from v1]~~ **Settled 2026-09-30 (Ethan; row D5): honestly, in her own voice.** Persona v2 makes her openly an AI: she answers straight when sincerely asked and doesn't announce it unprompted.

*Resolved since v1:* the companion generation strategy (replaced by one fixed Spica, with question 1 above still open), and memory visibility (decided: a view with delete, section 7.5).

### 16.2 Guardrails (not optional, apply in every phase) [DECIDED; from v1; strengthened by directive rule 7]

- **Crisis handling.** Detection runs on every incoming message, with a classifier that sees recent context, a keyword fallback, and a timeout. It bypasses turn-taking waits, availability and friction. A resources card is attached by code, and is shown even if reply generation fails. Because the card appears only when risk is detected, the reply prompt (`prompts.reply`, v3 onward; v4 adds the memory-honesty and time-gap rules) tells her not to assume they can see it: if they may be at risk, she names a crisis line or emergency services herself.
- **Age gating.** Adults only, enforced server-side at signup.
- **Data handling.**
  - Encryption at rest (storage-level).
  - Every query is scoped by `user_id`, and one user's facts are never used in another user's prompts.
  - Full account deletion, plus per-fact deletion (section 7.5).
- **No manipulation for engagement** (rule 8). Rule 8 is suspended for the test phase (section 2) and split (Ethan, 2026-09-29): no explicit engagement feature is built beyond her replies themselves (no streaks, badges, return rewards, or notifications designed to pull the user back); engagement that arises from her replies (warmth, missing them, wanting to keep talking) is acceptable during the test phase. Phase 9 revisits it.

---

## 17. Glossary

| Term | Meaning |
| --- | --- |
| Spica | The single, fixed companion personality. She/her. |
| Fact | One self-contained piece of knowledge, tagged by subject, with a salience ("weight") and a status. |
| Subject | Whose life a fact belongs to: `user`, `self` (Spica) or `shared`. |
| Salience | How much a fact or entity matters, 0–1. The directive calls it "weight". It drives both retention and retrieval rank. |
| Thread / checkpoint | An ongoing storyline, and the time a friend would naturally ask about it. |
| Persona doc | Spica's fixed, versioned personality file: values, boundaries, voice, canon. |
| Ego | Her changing inner state: mood, energy, preoccupation. |
| HomeostaticParam | A relationship parameter judged by its deviation from this user's own baseline. |
| Buffer / open questions | Turn-taking state: user messages since her last reply, and questions she's holding onto. |
| Backchannel | A tiny "I'm here" reaction while the user is mid-story. |
| Guard layer | The code-level check on every outgoing message against the section 2 rules. |
| Hot / cold path | Synchronous work before a reply is sent / asynchronous memory writes after it. |
| Send gate | The rules that can block a reach-out. |
| Reveal pacing | Gating test-derived knowledge until it is earned in conversation. |

---

## 18. Resolution log (2026-09-24, with Ethan; later rows dated)

| # | Topic | v1 (original) | Directive | Resolution |
| --- | --- | --- | --- | --- |
| C1 | Who Spica is | Generated per user | One fixed Spica, test calibrates the user | **Directive**, with the `test_calibrates` flag; still OPEN |
| C2 | Negative emotion / absence | Never hostile, no guilt about absence | Hurt allowed, punishment not | **Directive + a guilt test**: say it once, owned as a feeling, never a debt; provisional (testing) |
| C3 | Guard layer placement | One generation call on the hot path | Check outgoing messages in code | **Check every reply**, latency hidden in pacing; one generation + one guard check |
| C4 | Reply timing | v1 §4.3 burst pacing | Turn-taking engine | **Directive engine** + §4.3's crisis bypass and config timings; `backchannel_style` default `judge`, provisional |
| C5 | Relationship parameters | closeness / trust / tension, cadence, streak | closeness / trust / warmth / hurt, homeostatic | **Directive + tension kept** as distinct from hurt; cadence kept; streak dropped [ADDED] |
| C6 | Ego state | Hourly drift | Not specified | **Kept, driven by the life sim** |
| C7 | Unanswered reach-outs | Pause after 2 | Never re-send | **Never repeat a topic; one more different try; silence after 2** |
| C8 | Build order | Memory → Identity → Reach-outs → Life-sim | Memory → Turn-taking → Relationship → Life sim → Outreach → Test → Stubs | **Directive order** |
| C9 | Imperfect recall | Zero wrong recalls | Fuzzy / imperfect recall | **MVP: accurate or not at all**; the end goal is real misremembering once the weight is reliable |
| C10 | Persona authoring | Generated | Fixed Spica (implied) | **Claude drafts, Ethan edits**; persona versioned and iterable, with a check against existing self facts |
| C11 | Stack / real-time | TS / Next.js (built) | Python / FastAPI + WebSocket suggested | **Keep TS / Next.js + SSE** via LISTEN/NOTIFY |
| C12 | Whose life | — | — | **Shared canon + per-user daily life** for the MVP; OPEN, a heavy decision |
| M1 | Memory schema | `fact` / `entity` / `thread` | Entity / Memory suggested | **Map onto v1** (Claude): new kinds `feeling` / `promise`, source `inferred`, `recall_count`, `scope` / `space_id` hooks; `salience` = weight |
| B1 | Decay pass | Unassigned | "decay" in memory step | **Phase 1** (Ethan) |
| B2 | Thread checkpoints | Listed under Phase 3 but used by the hot path | — | **Phase 1** (Ethan) |
| B3 | Memory visibility (v1 open decision) | Placeholder view + delete | — | **Decided: view + hard delete, Phase 1** (Ethan) |
| B4 | Extract / reconcile structure | Two steps (§4.2) | — | **Approach A**: extract, then classify only near-matches (Ethan, Phase 1 design) |
| B5 | Recall write-back | On the hot path | — | **Moved to the cold path**; the hot path is read-only (Ethan, Phase 1 design) |
| B6 | Time zone | — | — | **`user.timezone`** from the browser [ADDED] |
| B7 | Crisis-derived facts | — | — | **`payload.sensitive`** flag [ADDED] |
| B8 | Eval gating | Single run | — | **`--runs 3`**, majority for recall, all runs for false recall / consistency (Ethan, Phase 1 design). Revised 2026-09-25: majority for all memory assertions, every run only for guardrail checks (Ethan) |
| B9 | Phase order after Phase 1 | Turn-taking + guard as Phase 2 | — | **Phase 2 = guardrails** (guard layer, including the false-familiarity check); turn-taking moves to Phase 3 and every later phase moves back by one. Phase 1's known failures (implied familiarity, onboarding fact as past chat) are deferred to the Phase 2 guard; the Phase 1 exit test passes if everything else passes (Ethan, 2026-09-25) |
| B10 | The pizza trace | — | "what should I cook → nvm pizza" as a seed trace | Pizza trace: grouped within `turn.settle_ms` → one reply to the takeback; with a gap → answer, then follow up (append-and-follow-up). Ethan, 2026-09-27. |
| G1 | Guard in the test phase | — | Guard on every outgoing message | **Off everywhere until a new Phase 9** (`guard.enabled: false`, crisis rubric included; outcome `guard_disabled`), which re-enables and calibrates it against Spica's observed range; the code, prompts and fixtures stay. No guard suite at the Phase 4 or 6 exits. Ethan, 2026-09-28 |
| G2 | Rules in the test phase | — | — | **Rules 1, 6, 8 suspended; rule 4 removed**; the reply prompt's matching "Never" lines go (`prompts/reply` v7). Ethan, 2026-09-28 |
| G3 | Rules kept | — | — | **Rules 2, 3, 5 and 7** (crisis classifier, resources card, all friction suspended), every section 16.2 guardrail (18+, user isolation, deletion, encryption), prompt-level memory honesty and recall etiquette, AI-identity honesty (OPEN #8 placeholder), "don't encourage them to depend on you instead of the people in their life". Ethan, 2026-09-28 |
| G4 | Ceilings (OPEN #3) | Tension capped at 0.4, halving daily | — | **Uncapped for the test phase**, with the section 8.1 psychology model (fading, diminishing returns, sensitisation, scar, absence, relief); OPEN #3 and #4 move to Phase 9. Ethan, 2026-09-28 |
| S1 | Relationship signal source | — | — | **Extend extraction**: one `relationship` block in the existing extract call, applied by deterministic code; frequency and absence computed from `session_log`, no LLM. Ethan, 2026-09-28 |
| S2 | Ending | — | User ends it; she lets go | **Detected in chat, then confirmed** (a second signal or `relationship.end_confirm_hours` without a retraction); no UI control. Ethan, 2026-09-28 |
| S3 | Phase 4 exit profile | — | — | **Only `extract` real**; reply, reconcile, embed, turn judge and crisis fake; guard off. Ethan, 2026-09-28 |
| L1 | Whose life (OPEN #6, row C12) | — | — | **Hybrid life**: one shared day plan of big blocks, generated once a day, the same for every user (`life_day`); small events are personal and reconciled per user. Reason: her future public persona must stay reconcilable with every private chat without making her life rigid. Ethan, 2026-09-29 (design D1) |
| L2 | Whose clock | — | — | **Her own time zone**, with nightly quiet blocks; fixed `life.timezone` (`Asia/Singapore`) for the test phase, resolved through `lifeTimezone` so she can float between zones later; the ego rhythm runs on her clock too (section 9.2 amended). Ethan, 2026-09-29 (design D2) |
| L3 | Persona version | Generated | Fixed Spica | **Persona v2 replaces v1** (Ethan's draft: openly an AI, sibling Alcor, stars / old films / books, no body); v1 scrapped, dev self facts wiped with `pnpm db:reset-self`. Ethan, 2026-09-29 (design D3) |
| L4 | Persona changes after launch (row C10) | — | — | **Persona fixed once shipped**; changes only during test and development. The "check a new version against existing self facts" rule is deleted, not deferred. Ethan, 2026-09-29 (design D4) |
| L5 | Closeness override | — | Higher closeness overrides busy | **Uses the closeness value, not its effect** (unlike every Phase 4 param reading): it's about how close she is, not whether she's closer than usual. Ethan, 2026-09-29 (design D7) |
| L6 | Phase 5 exit profile | — | — | **Real `life_plan`, `life_event`, `reconcile`, `embed`**; reply, extract, turn judge and crisis fake; guard off. Real embeddings because the fake embedder isn't semantic, so reconcile would never see a real neighbour. Ethan, 2026-09-29 (design D5) |

| D1 | Fixed vs variable Spica (OPEN #1) | — | Hybrid, `test_calibrates: user` | **Fixed**: one Spica for everyone; the test calibrates the user only. Ethan, 2026-09-30 |
| D2 | Interest alignment (OPEN #2) | — | `adjacent` (LEANING) | **`adjacent`**, decided. Ethan, 2026-09-30 |
| D3 | Backchannel style scope (OPEN #5) | — | `judge`, provisional | **Global `judge`**; per-user only if testing shows a need. Ethan, 2026-09-30 |
| D4 | Reach-out caps (OPEN #7) | — | 1/day, 3/week, silence after 2 unanswered | **Kept as the Phase 6 starting values** (config); later changes are tuning. Ethan, 2026-09-30 |
| D5 | Identity disclosure (OPEN #8) | — | Honestly, in her voice | **Final**: honestly, in her own voice (persona v2). Ethan, 2026-09-30 |
| D6 | Ceilings and jab/contempt line (OPEN #3, #4) | — | — | **Still open, decided in Phase 9** as planned (row G4); the test phase keeps them uncapped / suspended. Ethan, 2026-09-30 |
| O1 | Reach-out gating by whose clock (Phase 6 design D3) | Outside the user's active hours | — | **Only her clock gates**: blocked while she is in a busy or quiet block, whatever the user's hours, like a person who texts when she is free. Later: a closeness-scored tendency to reach out in the user's inactive hours (section 15.3b R1). Ethan, 2026-09-30 |
| O2 | Recent-contact gate (design D4) | "The user messaged within the last 2 hours" blocks | — | **Dropped**: she may bring up a due thread an hour after a chat ended; the conversation-in-progress gate (G5) stays. Ethan, 2026-09-30 |
| O3 | Candidate selection (design D1) | She picks the best candidate | — | **Deterministic**: built and scored in code (weight × strength, threshold in config); no LLM picks or vetoes; the hot path writes the message. Ethan, 2026-09-30 |
| O4 | Make-up as a candidate (design D2) | — | — | **A fifth kind, `make_up`**, ranked after due threads, when `make_up_state = due` (rule 2: Spica initiates). Ethan, 2026-09-30 |
| O5 | "Answered" (design D5) | — | — | **Any user message after the reach-out** (test phase): resets `unanswered_reach_outs` and stamps the latest unanswered reach-out. Ethan, 2026-09-30 |
| O6 | Web Push (design D6) | Out-of-app delivery by Web Push | — | **Real and minimal**: VAPID, service worker, `push_subscription`, an on/off switch; no presence store, so every message goes over SSE and push and the service worker hides it while a tab is visible. Ethan, 2026-09-30 |
| O7 | What pushes (design D7) | — | — | **Every message**, like a texting app: replies, reach-outs, backchannels, availability notes, crisis replies; a one-time banner asks for permission, `/settings` switches it off. Notification text privacy stays OPEN (section 15.3b R9). Ethan, 2026-09-30 |
| O8 | Phase 6 exit profile (design D8) | — | — | **All fake**: selection is deterministic, the reply model fake, the life plan scripted; no API calls. Ethan, 2026-09-30 |
| R1 | Reach-out threshold | — | — | **`outreach.threshold` 0.2**, not the design's 0.4, so `her_day` (max 0.24) and a check-in at eligibility (0.25) can fire; flagged for Ethan, one config value. Plan ruling, 2026-09-30 |

Superseded sources: `Spica — MVP build spec.md` (v1) and `spica-build-directive.md` remain in the repo for history only.
