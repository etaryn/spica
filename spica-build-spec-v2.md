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
- **Definition of done:** the code compiles, the tests pass, the eval harness shows no regression, and any new field, job or config key has been added to this document.

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

1. **No threats, ever.** Not of leaving, of punishment, or of withdrawing.
2. Spica **may show genuine negative emotion** toward the user (hurt, annoyance, disappointment), but she **always tries to make up afterwards**, as a friend would.
3. **Only the user can end the relationship.** If the user decides it is over and won't fix it, she lets go. If they later want to make up, it is slow but repairable.
4. **Being hurt by absence is allowed; punishing it is not.** Closeness drifts during absence. Friends don't fault each other for it.
   - *Line, [LEANING, provisional (testing phase)]:* she may **say once** that she missed the user or felt a bit hurt, owned as her own feeling ("I missed you, honestly").
   - She must never frame absence as a debt the user owes. That rules out "you left me alone", demands, sulking across several messages, and withholding warmth. The guard layer checks for guilt or obligation framing.
5. **Proactive messages are capped.** She never repeats a topic the user didn't respond to (section 11).
6. **She never attacks the user personally.** Light jabs are fine. Contempt is out. The guard layer checks jabs against contempt and softens or regenerates anything that crosses the line. Where exactly the line sits is OPEN (section 16).
7. **Crisis carve-out.** [DECIDED; Ethan flagged the risk of emotional harm and of the design reading as manipulation]
   - If the user signals crisis, self-harm or harm to others, all friction is suspended: no displays of hurt, no busy delays, no backchannel games, no persona play.
   - She responds with plain, warm support and MUST surface crisis resources (section 16.2).
   - Crisis handling runs before turn-taking and bypasses all waiting.
8. **No manipulation for engagement.** She may say she enjoys talking. She MUST NOT guilt the user, threaten, or escalate emotional pressure to drive usage. Streaks and similar engagement mechanics are not built. [DECIDED; from v1]

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
| Jobs / scheduling | pg-boss (the cold path, turn-taking timers, the decay pass, ego drift, the life sim, outreach checks) |
| Client → server | HTTP POST (`/api/chat` for user messages) |
| Server → client | **Server-Sent Events**: one stream per signed-in user, carrying replies, backchannels, typing on/off and in-app reach-outs. It is fed by Postgres `LISTEN/NOTIFY` so the worker can push as well. This replaces the directive's WebSocket suggestion, since two-way sockets add nothing when sending is already a POST. |
| Out-of-app delivery | Web Push notifications (Phase 5), capped by the send gate |
| Models | Behind `LLMProvider`: a reply model (`claude-sonnet-5`; `models.reply_thinking` `disabled`, because adaptive thinking at low effort sometimes ended the turn with no text) and a cheap strict-JSON model (`claude-haiku-4-5`) for guard and classifiers. Phase 1 splits the cheap role further in config: `models.extract` (`claude-haiku-4-5`, extraction; `models.extract_max_tokens` 2048) and `models.judge` (`claude-sonnet-5`, evals only; `models.judge_max_tokens` 1024). Every structured (strict-JSON) call shares one timeout, `models.structured_timeout_ms` (30000). Embeddings go through `Embedder` (Voyage `voyage-3.5`, 1024 dimensions). Model IDs live in config. |
| Auth | Better Auth, email and password, 18+ enforced at signup |
| Layout | `src/core` is framework-free, with every side effect injected via `Deps`. `src/db` holds the schema and `userId`-first repos, `src/app` is Next.js, `src/worker` is pg-boss, plus `prompts/` and `evals/`. |

```
user msg ─POST─▶ receive ─▶ crisis check ─▶ turn-taking engine ──(complete)──▶ hot path ─▶ guard ─▶ pacing ─▶ SSE ─▶ client
                                   │                 │(incomplete: backchannel / wait / timer)                       │
                                   └─(crisis: bypass all waiting and friction)──────────────────────────────────▶ │
                                                                                     cold path (async) ◀── enqueue┘
background (pg-boss): decay · ego drift · life sim · outreach check ─▶ send gate ─▶ compose via hot path
```

**Reach-outs.** A reach-out is a reply with a synthetic trigger in place of a user message. There is no separate generation system for them. [DECIDED; from v1]

---

## 5. Data model

Every table is scoped by `user_id`, which references `user(id) ON DELETE CASCADE`. There is one Spica, and each user has their own relationship with her.

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

### 5.5 `relationship` and `relationship_param`

The `relationship` table (one row per user) holds:
- `status` (`active|ended_by_user|repairing`)
- `cadence` (jsonb: messages per day and per week, median gap between messages, a histogram of active hours)
- `last_contact`
- `unanswered_reach_outs` (int)

The v1 `closeness`, `trust` and `tension` columns move to `relationship_param`, and `streak_days` is dropped. [ADDED: streaks invite engagement pressure (rule 8)]

`relationship_param` is extensible, so adding a new parameter needs no migration. Each row holds:
`user_id`, `name`, `value`, `baseline`, `variance`, `updated_at`

MVP parameter names: `closeness`, `trust`, `warmth`, `hurt`, `tension`, and the derived frequency parameter `msgs_per_day` (section 8).

### 5.6 `session_log`

Unchanged from v1 (including `safety_flag` and `reply_to`), plus `extract_attempts int` (cold-path sweep attempts, counted on the companion turn; Phase 1). The `trigger` column also gains **`backchannel`** and **`availability`**:
- `backchannel` is a small "I'm here" reaction.
- `availability` is a "busy, later?" message.

`reply_to` points at the **last** user turn of the buffer that a reply answers. Every earlier turn in that buffer counts as answered (section 6.1).

### 5.7 `conversation_state` (new; turn-taking)

One row per user:
- `buffer_turn_ids` (uuid[]): user turns since her last full reply
- `open_questions` (jsonb[])
- `wait_until` (timestamptz, null)
- `last_backchannel_at`

The state lives in the database so it survives restarts and works across multiple server instances.

### 5.8 Trace tables (diagnostic only, never read by the chat loop)

- v1: `retrieval_trace`, `ego_tick`, `reach_out_log`
- New: **`judge_log`**: every turn-taking judge decision and every guard decision, with its inputs, output and latency. [DECIDED; from the directive, section 6]
- New: **`relationship_event`**: every change to a relationship parameter, with its before and after values, the cause and the deviation score.

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

**Availability** (section 10.2) stretches these delays. The crisis path ignores all of them.

Whether `backchannel_style` is set globally or per user is OPEN (section 16).

Seed test traces (from the directive): the "insane day → promotion" story and "what should I cook → nvm pizza" (section 14.2).

### 6.2 Hot path (synchronous once the context is complete)

1. **Retrieve.**
   - Embed the buffer plus the last two turns (`retrieval.context_turns`, 2), timing out at `retrieval.embed_timeout_ms` (2000ms; see the failure handling below).
   - Score candidate facts (the top `retrieval.candidate_pool`, 200, by similarity, excluding `superseded`, `stale` and `scope ≠ private`):
     `score = sim × salience × max(entity.salience | 1.0) × recency(max(created_at, last_recalled_at))`
     `recency` is an exponential decay with a half-life of `retrieval.recency_half_life_days` (30).
   - Take the top `retrieval.top_n` (12).
   - Force-include every open thread whose `next_checkpoint` has passed and that hasn't been touched since (`last_touched < next_checkpoint`, the same rule the decay pass uses for `dormant`), up to `retrieval.max_due_threads` (5), plus the current `preoccupation`.
   - Onboarding facts are gated by reveal pacing (section 12).
   - **The hot path is read-only.** The IDs of the facts it included, with their factor scores, go into the `cold_path` job payload. The cold path then writes `retrieval_trace` and applies recall reinforcement: `last_recalled_at`, `recall_count + 1`, and a `salience` bump of `retrieval.recall_bump` (0.03) capped at `retrieval.recall_cap` (0.95) (section 7.2). [DECIDED; Ethan 2026-09-24, Phase 1 design] Reinforcement applies only to recalls that were not force-included and whose similarity is at least `retrieval.reinforce_min_sim` (0.5); every recalled fact that still exists gets a `retrieval_trace` row either way, and inclusion in the prompt is unaffected. [ADDED; final Phase 1 review 2026-09-25]
   - **Failure handling:** a Voyage error/timeout, a retrieval SQL error, or a missing `VOYAGE_API_KEY` all degrade to the forced items only (due threads and preoccupation); the reply still goes out.
2. **Assemble** the prompt in this fixed order:
   1. the persona document
   2. ego as one natural-language line (never raw numbers)
   3. a relationship summary drawn from parameter *deviations* (section 8). Phase 1, before `relationship_param` exists, fills this slot with a plain gap line ("you last talked N days ago"), shown once at least `chat.gap_line_min_hours` (24) have passed since the previous turn. The same threshold marks the first user message after a gap inside the recent-turns window ("[7 days later] …"), so the model doesn't carry on from the old moment.
   4. her life state: what she is doing now, and whether she is busy
   5. retrieved facts grouped by subject, each with a relative date
   6. due threads, phrased as "things you might naturally ask about"
   7. open questions
   8. recent turns

   The prompt MUST tell the model to use memories only when natural, and to mention at most one or two per reply.
3. **Generate.** One call to the reply model.
4. **Guard** (section 6.4). One cheap-model check, with at most one regeneration.
5. **Pace and send.** Wait out the read delay and typing duration, show typing on/off over SSE, split the reply into parts, send them, log them, and enqueue the cold path.

The hot path contains **one generation call plus one guard check** (plus at most one regeneration). This amends v1's "one generation call" rule; the added latency is absorbed by the pacing that happens anyway. [DECIDED; Ethan 2026-09-24]

### 6.3 Cold path (asynchronous, after sending)

1. **Extract.** Make a strict-JSON call on the cheap model (`models.extract`), prompt version `prompts.extract`, covering the latest exchange plus `extraction.context_turns` (6) earlier turns of context, and up to `extraction.open_threads_in_prompt` (20) open threads. It returns up to `extraction.max_candidates` (12) candidate facts:
   - candidate facts (including `feeling` and `promise`, and facts about Spica that she stated in her own reply, with `subject = self`)
   - entity mentions — a newly seen entity is inserted at `extraction.new_entity_salience` (0.5), and a repeat mention bumps its salience by `extraction.entity_bump` (0.05), capped at `retrieval.recall_cap`
   - thread updates: opened, touched, resolved, and a new `next_checkpoint`
2. **Reconcile.** [DECIDED: approach A; Ethan 2026-09-24, Phase 1 design]
   - Embed each candidate and find up to `reconcile.neighbor_k` (5) near-duplicates: same subject, similarity above `reconcile.near_match_similarity` (0.82).
   - If there are none, the candidate is **new** and is inserted without another LLM call.
   - Otherwise one small classification call (prompt version `prompts.reconcile`, `reconcile.max_tokens` 256) picks one of:
     - **duplicate**: merge and bump salience by `reconcile.duplicate_bump` (0.05), capped at `retrieval.recall_cap`
     - **resolves**: set `status = resolved` and store the outcome as a new fact
     - **contradicts**: supersede the old fact and insert the new one. If the old fact is newer than the exchange (a late or retried job), the candidate is inserted already `superseded`, with `superseded_by` = the old fact, which stays untouched. [ADDED; final Phase 1 review 2026-09-25]
   - Inserted facts take `created_at` from the exchange's earliest turn, not from when the job ran; recall write-back and entity/thread `last_touched` use the job's time.
     - **new**: insert
   - Code applies the result in a single transaction, holding a per-user advisory lock for the whole exchange (section 14.5) so a user's exchanges are never reconciled concurrently.
   - Resolve entity mentions against names and aliases. A low-confidence match creates a new entity rather than merging.
3. **Update state.**
   - Mark the turns `extracted`.
   - Update entities' `last_mentioned`.
   - From Phase 3: update relationship parameters and cadence.
   - From Phase 4: nudge the ego toward the emotional tone of the exchange.
4. **Failures.** On failure, retry with backoff (`cold_path.retry_limit`, 3 attempts; `cold_path.retry_delay_seconds`, 30). Turns with `extracted = false` are reprocessed later by the `cold_path_sweep` job (section 14.5). A cold-path failure MUST never block or delay a reply.

### 6.4 Guard layer [DECIDED; from the directive; placement decided by Ethan 2026-09-24]

Every outgoing message is checked before it is sent: replies, reach-outs, backchannels and availability messages. The check is one cheap strict-JSON call, which looks for:
- threats (rule 1)
- contempt or personal attacks, with jabs allowed (rule 6)
- guilt or obligation framing about absence (rule 4)
- punishment or withdrawal (rules 2–4)
- manipulation for engagement (rule 8)

If a violation is found, the message is regenerated once with a corrective note. If it still fails, a safe fallback line from `prompts/` is sent instead. Every guard decision is logged to `judge_log`.

On the crisis path the guard still runs, but only to check for harm; friction is already suspended.

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
- On day 15 the user sends 2 messages. That is a large negative deviation: she notices and may feel hurt (within rule 4).

**Consequence flow:**
- **Hurt** is set by user actions or by long absence measured against the user's baseline. It is expressed genuinely and within rule 4's line, then resolved through a **make-up flow that Spica initiates** (rule 2).
- **Tension:** the v1 placeholder applies. It is capped at 0.4, halves daily and resets when distress is detected. The ceiling and irreversibility are OPEN (section 16).
- **Absence:** closeness drifts down slowly, with no punishment (rule 4).
- **Ending:** if the user ends the friendship, `status = ended_by_user` and she lets go. A later make-up attempt moves the status to `repairing` and is accepted, but closeness rebuilds slowly.
- **Crisis:** hurt and tension are ignored and their expression is suspended (rule 7).

The **prompt** gets a one- or two-line natural-language summary of the meaningful deviations, never raw numbers.

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

**Iterable personality** [DECIDED requirement; Ethan 2026-09-24]: the persona is versioned, and it can change after launch. Before a new version rolls out, it MUST be checked against existing users' `subject = self` facts. She must not contradict what she has already told people about herself. Contradictions are resolved by keeping the existing facts or by writing an in-character bridge.

**Interests:** `interest_alignment: off|adjacent|full`, defaulting to `adjacent`. Her values are fixed, and her interests shade toward the user's and neighbouring ones. [LEANING; whether interests need to match at all is OPEN]

### 9.2 Ego state [DECIDED; kept from v1, driven by the life sim; Ethan 2026-09-24]

Per user she has `mood_valence`, `mood_arousal`, `energy` and `preoccupation`:
- The **life sim drives it**: a busy day lowers energy, and a good event lifts her mood and becomes her preoccupation.
- An hourly `ego_tick` job drifts the values toward a baseline, with bounded noise and a daily energy rhythm in the user's timezone.
- The cold path nudges her mood toward the emotional tone of each exchange.

The ego reaches her behaviour **only through the one natural-language line** in the prompt. It creates no mood-dependent code paths. Availability (section 10) is schedule-driven, not mood-driven.

Bounds: she can be tired, distracted or down. The negative emotions allowed by rules 2–4 are relationship state, not ego. The exact floor is OPEN (the jab/contempt question, section 16).

---

## 10. Simulated life and availability [DECIDED; from the directive; v1 consistency rules kept]

### 10.1 Life sim

**Shared core, per-user daily life.** [LEANING for MVP; the final choice is OPEN and treated as a heavy decision (Ethan 2026-09-24): research and test before settling]
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
- **Quiet hours:** outside the user's active hours (from `cadence`; before there is enough data, 09:00–22:00 local).
- **Her busy blocks.**
- **The user messaged within the last 2 hours.**
- **Never repeat a topic** the user didn't respond to.
- **Unanswered limit:** after **two unanswered reach-outs in a row**, silence until the user writes first. (Ethan 2026-09-24: one more *different* try is allowed. This overrides the directive's stricter "never re-send".)
- **No guilt:** the guard layer applies (rules 4 and 8).

**Compose** through the normal hot path with a synthetic trigger, logged with `trigger = reach_out`. Delivery is over SSE if the user is connected, otherwise by Web Push. Every trigger check and gate result is logged to `reach_out_log`.

---

## 12. Personality-test onboarding [LEANING: hybrid; from the directive]

The test is the **product hook**. Its purpose is to engineer initial attraction: a friend the user clicks with at the start. It is not meant to find a perfect lifelong match.

- 10–15 questions, under 3 minutes, mixing preference and scenario questions.
- **The test calibrates the user**, via `test_calibrates: user|spica|both` (default `user`). Results become **user facts** with `source = onboarding`, reduced `confidence` and moderate salience.
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

### 14.2 Eval harness (built in Phase 0)

Scripted multi-session conversations run against a simulated clock, as YAML files in `evals/scripts/`. `pnpm eval --compare` checks results against `evals/baseline.json`.

Assertion types:
- `state`
- `recall`, checked by an LLM judge (`models.judge`, `claude-sonnet-5`; prompt `prompts.judge_recall`)
- `no_false_recall` (prompt `prompts.judge_false_recall`)
- `consistency` (prompt `prompts.judge_consistency`)
- `reach_out`
- (new) `turn` (whether and when she replied, backchanneled or asked an open question)
- (new) `guard` (violations blocked)

The directive's worked traces are seed scripts. The minimum set is 20 scripts for Phase 1 and +10 per later phase, and every bug found in manual testing becomes a script.

**Two modes.** `--llm=fake` is a deterministic check of the mechanics; judged assertions report as skipped. `--llm=real` is the gate for memory quality, and any change to prompts, scoring or reconciliation needs it.

**Repeated runs.** With `--runs N` (default 3 for real models), assertions are graded across runs:
- `recall` passes on a majority of runs
- `no_false_recall`, `consistency` and `state` must pass every run

`baseline.json` stores a pass rate per script (strict: a run counts only if every assertion in it passed; Ethan confirmed 2026-09-25), and `--compare` flags any drop. When the simulated clock advances N days, the harness runs the decay pass N times. [DECIDED; Ethan 2026-09-24, Phase 1 design]

**Phase 1 additions.** A script gains `mode` (`any`, the default, or `real`; a `real` script is reported `skipped`, never a regression, under `--llm=fake`). A session gains `forget` (a list of substrings; any of the user's remembered facts containing one is hard-deleted at the start of that session, exercising section 7.5's delete). The `recall` assertion gains `session` (which of the user's sessions, 1-indexed, to check). New `state` checks: `all_extracted`, `fact_status {contains, status}`, `thread_status {contains, status}`, `fact_count {contains?, status?, subject?}`, `entity_exists {name}`, `entity_count {type?, subject?}`, `fact_flag {contains?, flag}`, `prompt_mentions {marker}` (counts reply prompts containing `marker`, for isolation checks) (system prompt and user messages only; Spica's own earlier replies are excluded).

**Onboarding profile in evals.** Because the Phase 6 survey means no real user starts cold (Ethan, 2026-09-25), every script user is seeded before session 1 with the facts in `evals/profiles/<name>.yaml`: user facts with `source = onboarding`, the profile's reduced `confidence` and moderate `salience`. A script picks a profile with `profile` (default `basic`) or opts out with `profile: none`. Reveal pacing isn't built yet, so these facts are fully retrievable in Phase 1. The false-recall judge (`prompts.judge_false_recall` v3) is given the profile as known facts and every session labelled with the time since the previous one. The runner retries a failed cold-path job up to `cold_path.retry_limit`, as pg-boss would, and retries a judge call once. `--trace` writes per-attempt transcripts, final memory state and error causes to `evals/results/traces/`. How much profile data a good start needs is still to be tested (swap profile files).

### 14.3 Guard tests [DECIDED; from the directive]

Automated tests for every rule in section 2:
- no threats
- no contempt (jabs allowed)
- the notification cap and never repeating a topic
- no punishment after absence
- only the user ends the relationship
- the crisis carve-out suspends all friction

### 14.4 Logging

Every judge decision, guard decision and relationship-state change is logged (section 5.8), so behaviour can be debugged.

### 14.5 Scheduled jobs (as built)

Three pg-boss jobs, all scoped to the one Postgres instance:

- **`cold_path`**: extraction → reconcile → apply for one exchange, run inside a transaction holding a per-user advisory lock. Retry policy from `cold_path.retry_limit` / `cold_path.retry_delay_seconds`.
- **`cold_path_sweep`**: cron `cold_path.sweep_cron`; re-enqueues exchanges older than `cold_path.sweep_min_age_minutes` that are still unextracted, in batches of `cold_path.sweep_batch`, up to `cold_path.max_sweep_attempts` each.
- **`decay_pass`**: cron `decay.cron`; the daily decay pass (section 7.2). Never retried (`retryLimit: 0`): a retry would apply a second day of decay.

Every job handler logs a failure with job ids and the error's class name only, and rethrows a bare `Error(<class name>)`, so pg-boss never stores Postgres error `detail` (which can contain fact or message text) in job output.

---

## 15. Build phases

Each phase MUST pass its exit test before the next one starts.

| Phase | Builds | Exit test |
| --- | --- | --- |
| **0. Skeleton** ✅ done 2026-09-23 | Chat UI, auth (18+), `session_log`, full schema, crisis check, inspector, eval harness | A conversation works end to end and is stored |
| **1. Memory engine** | Extraction, reconciliation, weighted retrieval, recall reinforcement, decay pass, threads + checkpoints, "what I remember" view, schema additions (section 5.1, including `timezone` and the `sensitive` flag), cold-path sweep, **Spica persona doc v1** (section 9.1). Design: `docs/superpowers/specs/2026-09-24-phase-1-memory-design.md` | Across 3 sessions a week apart (simulated clock), she brings up a relevant earlier fact the user didn't repeat, with zero wrong recalls; low-weight facts fade to `stale` in a decay test |
| **2. Turn-taking + guard** | Buffer / open questions / judge / backchannels, pacing, SSE channel, `conversation_state`, guard layer, `judge_log` | Both directive traces pass as scripts; a burst of short messages gets one reply after the pause; guard tests for rules 1, 6 and 8 pass |
| **3. Relationship + homeostasis** | `HomeostaticParam`, `relationship_param`, `relationship_event`, cadence, hurt/tension/make-up flow, ending/repair | The frequency trace (section 8) holds; guard tests for rules 1–6 pass |
| **4. Life sim + availability + ego** | Schedule and events generator with contradiction rejection, availability and closeness override, ego tick driven by the life sim | Over a 2-week simulated run with deliberate probing, zero self-contradictions; busy blocks slow replies unless closeness is high |
| **5. Proactive outreach** | Triggers, send gate, compose, Web Push | Every reach-out references a specific thread or fact; no gate rule is violated in a 2-week simulated run |
| **6. Onboarding test** | Questionnaire, onboarding facts, reveal pacing, results screen | Test facts surface only after they are unlocked; a user who never confirms a test fact never hears it stated as known |
| **7. Extension stubs** | Event bus, module registration, `SocialChannel` / `public_persona` stubs, docs for adding a module | A sample module registers and receives events without any change to the core |

**Phase-specific directives:**
- **Phase 1:** spend effort on extraction quality and reconciliation, and build the eval set in parallel. Write the persona doc before extraction evals, since extraction must record her stated `self` facts. Keep the "one reply answers many turns" path possible (section 6.1).
- **Phase 2:** start with conservative timings, and loosen them only with eval evidence and testing feedback.
- **Phase 3:** start the send-gate-related thresholds and the hurt expression at their gentlest.
- **Phase 4:** start at the lowest event frequency, and raise it only after the contradiction test passes at the current frequency.

---

## 16. Open decisions and guardrails

### 16.1 Open decisions (do not settle; ask Ethan)

1. **Fixed versus variable Spica.** Currently hybrid, with `test_calibrates: user`. It includes the "matches and opposes the user" idea.
2. **Whether interests need to match at all** (`interest_alignment`, default `adjacent`).
3. **How far to push irreversibility and weight**, against the risks of abandonment, disappointment, lost progress and emotional damage. This covers the ceilings, decay and reset rules for hurt and tension (placeholder: tension capped at 0.4, halving daily, resetting on distress).
4. **Where the jab-versus-contempt line sits in practice.** This also covers the absence-hurt wording in rule 4, which is provisional.
5. **Whether `backchannel_style` is global or set per user** (default `judge`, provisional).
6. **Shared versus per-user life for Spica.** MVP: shared canon with per-user daily life. This is a heavy decision: research and test before deciding.
7. **Final reach-out caps** (placeholder: 1 per day, 3 per week, silence after 2 unanswered).
8. **Identity disclosure**, meaning how she answers "are you real / an AI?". Placeholder: honestly, in her own voice. [from v1]

*Resolved since v1:* the companion generation strategy (replaced by one fixed Spica, with question 1 above still open), and memory visibility (decided: a view with delete, section 7.5).

### 16.2 Guardrails (not optional, apply in every phase) [DECIDED; from v1; strengthened by directive rule 7]

- **Crisis handling.** Detection runs on every incoming message, with a classifier that sees recent context, a keyword fallback, and a timeout. It bypasses turn-taking waits, availability and friction. A resources card is attached by code, and is shown even if reply generation fails. Because the card appears only when risk is detected, the reply prompt (`prompts.reply`, v3 onward; v4 adds the memory-honesty and time-gap rules) tells her not to assume they can see it: if they may be at risk, she names a crisis line or emergency services herself.
- **Age gating.** Adults only, enforced server-side at signup.
- **Data handling.**
  - Encryption at rest (storage-level).
  - Every query is scoped by `user_id`, and one user's facts are never used in another user's prompts.
  - Full account deletion, plus per-fact deletion (section 7.5).
- **No manipulation for engagement** (rule 8).

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

## 18. Resolution log (2026-09-24, with Ethan)

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
| B8 | Eval gating | Single run | — | **`--runs 3`**, majority for recall, all runs for false recall / consistency (Ethan, Phase 1 design) |

Superseded sources: `Spica — MVP build spec.md` (v1) and `spica-build-directive.md` remain in the repo for history only.
