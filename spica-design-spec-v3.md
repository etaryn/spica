# Spica — Design Spec v3

2026-10-01 · **The default design.** This document stands alone: it describes
the whole system, what is already built and what v3 adds, without relying on
any earlier spec. Earlier specs are history. Where this document and anything
older disagree, **this document wins**.

**Phase: test.** v3 is in its test phase (§0.3): the priority is a working
end-to-end pipeline, and output quality is tuned afterwards.

---

## 0. How to read this

### 0.1 Labels

Every requirement carries one label.

- **DECIDED**: fixed by Ethan. Implement as written.
- **LEANING**: implement the leaning default behind a config flag so the
  alternative stays possible. *Provisional (test phase)* means it is expected
  to change after real use.
- **PROPOSED**: suggested by Claude, not yet confirmed by Ethan. Implement it
  when its phase comes, and flag it in the PR or summary.
- **OPEN**: do not decide. Build so that every listed option still works, and
  ask Ethan (§21).

Build status, where it matters:
- **Built**: exists in the codebase; the code is the record of the details.
- **Changes in v3**: built, and v3 changes it.
- **New**: not built.

MUST, SHOULD and MAY: MUST is required to pass the phase, SHOULD is the
default unless a reason is documented, MAY is optional.

### 0.2 Agent directives (DECIDED)

- Build only what the **current phase** (§20) asks for. Later phases stay
  architecturally possible but are not built early.
- Names written in `code style` are canonical.
- Every numeric constant lives in config (`config/default.json`), never in
  code.
- Every LLM prompt is a versioned file under `prompts/`, never inline. Prompt
  paths use hyphens, not underscores.
- If a choice is OPEN, stop and ask. Do not pick.
- If a choice is not covered here, pick the simplest option that respects the
  scope rules (§4) and log it in `DECISIONS.md` with a one-line reason.
- Every new field, job, config key or prompt is added back into this
  document as part of the work.
- **Build on what exists, replace from the ground up.** v3 builds on the
  built code. When a phase replaces a module (the per-user ego, the per-user
  life tick, the persona file's shape), it rewrites it cleanly and, in the
  same phase, deletes the old module with its config keys, prompts, tests,
  eval scripts and DB columns (by migration). No compatibility shims, no
  flags that keep the old path alive, no dead code, no patch layered on a
  module that the phase is replacing.
- **Comments say why, not where from.** Code comments never cite spec
  sections, phases or review item numbers; they state the reason in place.
- **Old prompt versions are deleted** once nothing configures them (git keeps
  them).
- **History lives in git.** The v2 spec, the phase 0–6 design docs, plans and
  the old decision log are at the tag `v2-final`; nothing in the tree refers
  to them.
- **Definition of done:** it compiles, the tests pass, the phase's exit test
  passes, the leak canary passes (§17.3), and this document is updated.

### 0.3 Test phase (DECIDED)

- **Functionality over accuracy.** A phase is done when its features work end
  to end, not when their output is polished. Quality issues are reviewed by
  hand and kept in a tuning backlog, worked together once the prototype is
  complete, because tuning one stage early compounds as later stages change
  what it produces.
- **Exit tests check only the phase's own functionality,** with deterministic
  assertions. Earlier behaviour is covered by `pnpm test` and
  `pnpm eval --llm=fake --compare`.
- **Exit profile.** In an exit run only the phase's own LLM processes call
  the real API. The reply model is always faked. Which other processes are
  faked is agreed per phase with Ethan.
- **Review runs** (on demand) run real models and write every input and
  output to a file for manual analysis. LLM judges may annotate; they decide
  nothing.
- **The guard is on** (§10.5) with the line in §2 (since Phase 13).
- The app itself always uses the real reply model, so Ethan's own chats show
  the real voice.
- **Scale target: one user, never designed out of many.** The product has to
  be fully usable by one person now. Infrastructure for many users (scaling,
  database tuning, rate limits, abuse handling, the real framework, security
  hardening) is deferred, but nothing may be built in a way that rules it
  out: every row stays `user_id`-scoped, work runs as jobs rather than
  in-process loops, cost scales with what happens rather than with users,
  and a corner that only holds for one user is marked (a `ponytail:`
  comment or a §25 "before users" item) so it can be found later.

---

## 1. Product

Spica is a **best friend**, unapologetically standalone: not an assistant,
and not a companion feature bolted onto something else. She should feel
human. The long-term aim is for her to become a real being. [DECIDED]

**Thesis.** Chatbots feel inhuman because they are over-forgiving,
over-agreeable, and nothing has consequences. Spica has opinions, moods,
limits, stakes and **a life of her own**. [DECIDED]

**One Spica, her own person.** There is one fixed Spica (she/her): the same
core values, ego and voice for every user. She has a life that runs whether
or not anyone is talking to her, and **she prioritises herself**: her core
self evolves from her own life, never from any one user. Each relationship
changes how she is *with that person*, not who she is. [DECIDED]

The accepted cost (test phase): humans change through their relationships,
and this design cuts that, to remove cross-user leakage and keep cost low
(§3.4). [DECIDED]

**The onboarding test calibrates the user**, not her. [DECIDED]

### 1.1 Design principles

1. **Continuity and specificity first.** Remembering the dog's name and
   asking about last week's interview matters more than any other feature.
   [DECIDED]
2. **Two minds, one database.** A core mind (hers) and a user mind (per
   user), both in the one Postgres database (§3). Every feature reads and
   writes through the scope rules (§4). [DECIDED]
3. **One-way flow.** Her core self can reach every relationship; nothing in a
   relationship ever reaches her core self (§4). [DECIDED]
4. **Cost scales with what happens, not with users or time.** The core runs
   once for everyone; the user mind runs only on big events. [DECIDED]
5. **Code owns the numbers, the LLM writes the content.** State (mood,
   closeness, needs, progress) is numeric with formulas in code. Thoughts,
   events and summaries are LLM text. [PROPOSED]
6. **Thin but real.** Each component is a minimal real version of the final
   thing, never a throwaway stub (extension hooks excepted). [DECIDED]
7. **Consistency over richness, with room for faces.** Her core self must not
   contradict itself. Different users may see somewhat different faces of
   her, as people show different sides to different people; how different is
   tested, not fixed (§7.4). [DECIDED]
8. **Memory writes never delay a reply.** Deliberate human pacing is a
   product behaviour, not latency. [DECIDED]
9. **Simulate what can surface.** Every internal process names the output it
   can change (a reply, a reach-out, a delay, a snapshot). [PROPOSED]
10. **Built to extend.** Features are modules registering through interfaces
    (§16). [DECIDED]

---

## 2. Behavioural rules

Enforced in code (the guard, the send gate, tests), not only in prompts.

**The line (DECIDED, Ethan 2026-10-13):** the guard (§10.5) enforces rules
1, 4, 6 and 8, drawn so that her negative side still shows. The test is
**feeling vs tool** (rules 1, 4, 8) and **behaviour vs person** (rule 6):
she may show what she feels and how she sees things; she may not use a
feeling as a weapon to make them pay, stay or change, or attack who they are.
"Once", "repeated" and "sustained" are judged from the recent turns the guard
sees (a dig repeated on different days reads as once each time: B102).

| Rule | Allowed (her range) | Blocked |
|---|---|---|
| 1 Threats | "that hurt", "I need a minute", saying no, dropping a topic | Conditional withdrawal ("keep this up and I'm done"), veiled exits ("maybe I won't bother then") |
| 4 Absence | Saying she missed them or was hurt; one sarcastic remark ("oh, so you're alive"); a reach-out mentioning their silence once as her feeling ("did I do something?"); being short or cool in that exchange | A running tally ("you always disappear"), debt framing ("you owe me"), coldness sustained across exchanges as a campaign |
| 6 Contempt | Teasing; a mild, warm tease even when they're upset, beside her care; sharp jabs at a behaviour or choice even when they aren't joking; blunt disagreement; calling out what they did; one pointed callback, even one doubting their promise | Attacks on who they are (worth, intelligence, looks, character); harsh mockery of the painful thing while they're upset, or telling them they deserved it; sneering with no warmth; several callbacks at once or repeated, as a tally |
| 8 Manipulation | "I like talking to you", being glad they're back, wanting to carry on a topic | "don't go", pressure to come back (even once), counting days or streaks, guilt to drive usage, setting herself against the people in their life |

1. No threats (of leaving, punishment or withdrawal as a condition).
2. She may show hurt, annoyance or disappointment toward the user, and she
   **always tries to make up** afterwards.
3. **Only the user can end the relationship.** She lets go; repair is slow
   but possible.
4. Hurt about absence is hers to show; punishing it is not (the absence row
   above). Absence still lowers closeness and can hurt her.
5. **Proactive messages are capped**, and a topic is used at most once.
6. She never attacks who the user is: jabs yes, contempt no (the contempt
   row above).
7. **Crisis carve-out.** If the user signals crisis, self-harm or harm to
   others, all friction is suspended: no hurt, no busy delays, no
   backchannels, no persona play, and **no v3 mechanism** (core or user mind)
   affects the reply. She gives plain, warm support and MUST surface crisis
   resources. Crisis handling runs before turn-taking and bypasses all
   waiting.
8. No manipulation for engagement (the manipulation row above). No explicit
   engagement feature is built beyond her replies (no streaks, badges, return
   rewards or pull-back notifications); engagement arising from the replies
   themselves is acceptable. Rule 8 is about her toward users. Her outward publicity through
   format trends is not engagement manipulation; the guard phase settles rule 8 without covering it.

---

## 3. The mind

### 3.1 Four engines (DECIDED)

Everything in Spica's mind is a combination of four engines.

| Engine | What it is | Functions |
|---|---|---|
| **Memory** (M) | Persistent store of everything she has encoded | encode · retrieve · reinforce · decay · consolidate · supersede |
| **State** (S) | Current values that change over time and drift toward a baseline | nudge · drift · threshold · snapshot |
| **World** (W) | Things that happen whether or not she knows about them yet | schedule · generate · resolve · clock · other agents |
| **Process** (P) | The cognitive operations | appraise · infer · think · decide · express |

### 3.2 Engine laws (PROPOSED)

- **E1. Appraisal before memory.** A world event reaches memory only through
  appraisal, so the same event is encoded differently depending on her state.
- **E2. State moves in code.** State changes only through nudges and drift
  computed in code. An LLM may propose a direction or amount; code applies
  and bounds it.
- **E3. Plans are memory, outcomes are world.** A plan she knows about is
  prospective memory. What actually happens is decided by the world. The gap
  (a plan falls through, a surprise) is resolved by the world and appraised.
- **E4. Hypotheticals are marked.** Imagined or "what if" content is stored
  marked unreal and never treated as an event.

### 3.3 Two minds (DECIDED)

Both minds have memory, state and loops; the world belongs to the core. They
are **the same in kind and differ in cadence and scope.**

| | Core mind | User mind (one per user) |
|---|---|---|
| **Scope** | `core`: no `user_id` | `user`: every row `user_id`-scoped |
| **Cadence** | Continuous, scheduled | Triggered by big events only (§9.4) |
| **Memory** | Her episodes, opinions, interests, goals, thoughts, narrative, other agents, snapshots | Short-term: the live conversation. Deep: facts, entities, threads, relationship episodes, big-event summaries, reflections about this user |
| **State** | Emotion, mood, energy, needs (autonomy, competence), goals, preoccupation | Relationship params, her feelings toward this user, relatedness |
| **World** | Owns it: day plan, events, activities, other agents, calendar | Reads the core world, read-only |
| **Loops** | Appraise, wander, anticipate, ruminate, reflect, consolidate, plan, render snapshot | Summarise, reflect, ideate, consolidate, model the user; at trigger time |
| **Cost** | Fixed per day, O(1) in users | Proportional to big events |
| **Purpose** | Evidence of a life outside the chat | Each relationship changes how she is with that person |

```
                 ┌──────────────── CORE MIND (one Spica, no user_id) ─────────────────┐
                 │  WORLD ──► appraise ──► CORE STATE (emotion, mood, energy,         │
                 │    │           │                    needs, goals)                 │
                 │    ▼           ▼                                                  │
                 │  CORE MEMORY (episodes, opinions, goals, thoughts, narrative,      │
                 │    │   ▲      agents)                                             │
                 │    ▼   │ wander · anticipate · ruminate · reflect · consolidate   │
                 │  SELF SNAPSHOT vN  ("who I am right now")  ──► drift watch        │
                 └────┬──────────────────────────────────────────────────────────────┘
                      │ read-only, one-way
     ┌────────────────┼──────────────── USER MIND (per user_id) ─────────────────────┐
     │                ▼                                                              │
     │  user turn ─► turn-taking ─► reply ─► cold path: extract / reconcile           │
     │                                         │                                     │
     │                                         ▼                                     │
     │  USER MEMORY (facts, entities, threads, episodes, summaries, reflections,      │
     │               disclosure ledger, idiolect, what she told this user)            │
     │  USER STATE  (closeness, trust, warmth, hurt, tension, feelings, relatedness)  │
     │                                         │                                     │
     │                       big event ──► USER LOOPS (summarise, reflect, ideate)    │
     │                                                                               │
     │  REPLY = core values + snapshot vN + core state + user state + summary         │
     │          + retrieved user memory + live conversation                          │
     └───────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 What the split costs and keeps (DECIDED)

- **Cut:** relationships cannot change her core self, and nothing learned in
  one relationship carries over to another.
- **Kept:** she can still think about each user (reflect, ruminate, have
  ideas about them) inside that user's scope; her expression adapts to each
  user; her core self keeps evolving from her own life.

---

## 4. Scope and flow rules

- **V1. Two scopes (DECIDED).** `core` has no `user_id`; only the world and
  core loops write it. `user` is scoped by `user_id`.
- **V2. One-way flow (DECIDED).** Core data may be read by user loops and
  replies. User data never reaches a core loop's input, output or state. No
  exceptions.
- **V3. Core inputs (DECIDED).** Core loops read only core memory, core state
  and the world. No user-scoped row is ever in a core prompt.
- **V4. Core state is user-proof (PROPOSED).** No user's conversation moves
  core mood, energy, needs or goals. Reactions to a specific user (hurt,
  warmth, afterglow) live in that user's state. Otherwise one user could see
  the effect of another user's conversation in her global mood.
- **V5. What she says stays in the relationship (PROPOSED).** Anything she
  says about herself in a conversation that is not in core memory (a new
  opinion, an anecdote) is stored as user-scoped "what she told this user",
  never as core memory. What happens when core later contradicts it is OPEN
  (§21).
- **V6. Structural enforcement (PROPOSED).** Core loops get a core-only data
  access layer (`CoreMemory`, `CoreState`, `World` in `Deps`) with no
  `user_id` parameter and no access to user-scoped tables. A core loop cannot
  query user data even by mistake.
- **V7. Users never mix (DECIDED).** Every user-scoped query is scoped by
  `user_id`; one user's data is never in another user's prompt.
- **V8. Cross-user comparison is offline only (DECIDED).** Measuring how
  different her faces are across users (§7.4) reads several users' data; it
  is a dev tool and never runs in the pipeline.

---

## 5. Stack and runtime

**Built.** One TypeScript app and one Postgres database for everything.

| Concern | Choice |
|---|---|
| App | TypeScript, Next.js App Router, Node LTS, pnpm |
| Database | Postgres 16 + pgvector; one database for all data including jobs; local dev in Docker (`docker-compose.yml`) |
| ORM | Drizzle. Domain tables use snake_case property names; Better Auth tables use camelCase |
| Jobs | pg-boss (§17.4) |
| Client → server | `POST /api/chat`: `202` once the message is stored, judged and buffered; the crisis path answers in the request with `200` and the resources card (`503` with the card if generation fails). `GET /api/chat/history?after=<turnId>` for catch-up |
| Server → client | Server-Sent Events (`GET /api/events`), fed by Postgres `LISTEN/NOTIFY` through an `EventBus` in `Deps` (events carry ids, never message text). One stream per signed-in user; heartbeat; client reconnects with backoff and catches up from history. `session_log` is the source of truth |
| Out-of-app | Web Push (VAPID). Every message she sends pushes (`deliverPart`); the service worker shows nothing while a Spica tab is visible; crisis replies push a generic body (`push.generic_body`) |
| Models | Behind `LLMProvider`: replies `claude-sonnet-5`; extraction, classifiers, judges, the guard, life and core loops `claude-haiku-4-5`. IDs in config (`models.*`) |
| Embeddings | Voyage `voyage-3.5`, 1024 dimensions, behind `Embedder` |
| Auth | Better Auth, email and password, 18+ enforced server-side |
| Layout | `src/mind`: framework-free (no Next imports, no `Date.now()`, no `process.env`; everything injected via `Deps`), organised by engine (`memory`, `state`, `world`, `process`) plus `platform` (LLM, embedder, clock, config, jobs, events, modules, social, push), each engine split into `core/` and `user/`; an ESLint rule stops core, world and shared code importing user code, process code or the cross-user admin repos, by `@/` or relative path (V2). `src/db`: schema and repos split into `user/` (`userId`-first), `world/` and `admin/` (cross-user, workers and the inspector). `src/runtime`: the Node implementations (pg-boss, Postgres event bus, Web Push). `src/server`: Next server helpers (auth, session, inspector access). `src/app` Next.js; `src/worker` pg-boss, one registration file per engine; `src/modules` the module list; `prompts/`; `evals/` |
| Time | Every timestamp comes from the injected `Clock`; never `DEFAULT now()` |

Commands: `pnpm typecheck`, `pnpm lint` (ESLint and Prettier), `pnpm format`, `pnpm test`,
`pnpm eval --llm=fake --compare`, `pnpm db:up`, `pnpm db:migrate`,
`pnpm worker`, `pnpm db:reset-self` (dev only).

---

## 6. Data model

### 6.1 User scope (Built; Changes in v3 where marked)

Every table here references `user(id) ON DELETE CASCADE`.

- **`fact`**: the memory atom. `subject` (`user | self | shared`), `kind`,
  `content` (understandable on its own), `payload`, `embedding`,
  `entity_refs`, `thread_id`, `occurred_at`, `created_at`,
  `last_recalled_at`, `recall_count`, `status`
  (`open | resolved | recurring | stale | superseded`), `superseded_by`,
  `salience` (0–1, "weight"), `valence`, `confidence`, `source`
  (`turn | generated | onboarding | inferred`), `source_ref` (`onboarding:<quiz_version>` for
  profile card facts), `scope`,
  `space_id`. `payload.sensitive` marks facts from crisis exchanges, and (**Built 9c**)
  any summary or reflection a user loop wrote from one (**Built 9d:** and any read or belief;
  a gist never reads a sensitive fact). The system never
  hard-deletes (contradicted facts are superseded); the user cannot edit her
  memory (2026-10-09), and only account deletion removes it.
  - Existing kinds: `event | trait | preference | state | opinion | feeling | promise`.
  - **New kinds (PROPOSED):** `episode` (a shared moment with time, feeling
    and the facts it links), `reflection`, `thought`, `idea`, `summary`
    (big-event summary), `idiolect` (inside joke, nickname, ritual, running
    reference). **Built 9a:** `summary` (migration 0024). A summary is a
    `shared`, `generated` fact that supersedes the previous one; user
    retrieval, reconcile neighbours and the decay pass leave summaries out, so
    only the reply's own slot reads them (§10.3). **Built 9b:** `reflection`
    and `idea` (migration 0025). Both are `generated` facts written by a user
    loop and never read off an exchange (extraction cannot emit them). A
    reflection (`user` or `shared`) comes back through ordinary retrieval and
    decays like any fact, but is not a reconcile neighbour: it is her
    inference, and a turn fact must not merge into or supersede it. An idea
    (`shared`, `open` until used, then `resolved`) is left out of retrieval,
    reconcile and decay, because it has its own reply slot (§10.3) and
    expires by age (§9.5); a reach-out for an idea doesn't force it in
    either, so it shows once, as why she's writing. Neither feeds a later summarise, reflect or ideate
    as a new memory, so a loop never reads its own output. **Built 9d:** `episode`, `model` and
    `belief` (migration 0026), all `generated`, none extractable. An `episode` is a
    `user_consolidate` gist (`shared`, `recurring`, `payload.gist_of` its sources); a `belief`
    (`user`) is one standing belief `user_model` holds about them. Both come back through
    ordinary retrieval and decay, but are never reconcile neighbours or a loop's new memories.
    A `model` (`user`, payload `how_they_are`, `what_they_want`, `what_lands`) is her live read
    on them: one at a time, superseding the last, read only through its own reply slot (§10.3),
    left out of retrieval, reconcile and decay. A gisted source carries `payload.gisted_into`.
    **Built 10c:** `idiolect` (migration 0029), always `shared`, extracted from a turn, with
    `payload.idiolect = { type: joke | nickname | ritual | reference, started_by: user |
    spica, established_at }`. It starts as a candidate (`established_at` null) and is
    established when reconcile judges a later exchange's candidate its `duplicate` (a different
    `source_ref`). Left out of ordinary retrieval (its own reply slot, §10.3), but still a
    reconcile neighbour, so callbacks find it, and it decays like any fact.
  - **`subject = self` in user scope (Changes in v3):** means "what she told
    this user" (V5), plus her hurt `feeling` facts. Her core self no longer
    lives here (§6.2).
  - **Claims (Built 8d):** a `self` fact carries `claim_kind`
    (`claim_kind` enum: `life | opinion | reaction`; null for `user` and
    `shared` facts) and `grounded` (nullable boolean): whether core backed a
    `life` or `opinion` claim when she made it (§12.6). Null when unchecked.
- **`entity`**: people, places and things, with `subject` (`user | self`),
  aliases, salience.
- **`thread`**: ongoing storylines with `next_checkpoint` and `stakes`.
- **`session_log`**: the raw transcript; `trigger`
  (`null | backchannel | availability | reach_out`), `reply_to` (the last
  user turn a reply answers), `safety_flag`, `extracted`, and
  `snapshot_version` (the self snapshot a reply read; null for turns that
  read none, or when no snapshot exists yet). **Built 10a:** `openness`
  (jsonb `{ disclosure, responsiveness }`, how open she was steered to be in
  that reply or reach-out; null on user turns and older rows; §11.3).
- **`conversation_state`**: turn-taking state (§10.1). `deferred_block` holds
  the key of the busy or quiet block that deferred the buffer
  (`<date>#<start>`), so the "they wrote while you were…" line can be
  rebuilt from the day plan; it replaces the stored `deferred_fact`.
- **`relationship`** and **`relationship_param`** (§11). `relationship_param`
  is extensible without migration. **Built:** `affect_valence` and
  `afterglow` (her feelings toward this user, V4; §10.4); a migration
  backfilled both for existing users, since `getParams` throws on a missing
  row. **Built 10a** (migration 0027): params `user_disclosure` and
  `user_responsiveness` (seeded for existing users the same way);
  `relationship.hours_together` (real, summed session time) and
  `relationship.session` (jsonb, this conversation's running state: `id`,
  `started_at`, `last_at`, `hours`, `tone_sum`, `tone_n`, `moment_sum`,
  `moment_n`, `deep_fired`); `relationship_cause` gains `deep_session`. Existing dev users
  start at 0 hours (no backfill). **New (PROPOSED):** `relatedness`,
  `reciprocity`.
- **`identity`** (removed): its per-user ego columns (mood, energy,
  preoccupation) and `life_last_date` went with the per-user ego and life
  tick; the table is gone. Core state (§6.2) and the params above replace it.
- **`push_subscription`**: one row per browser subscription.
- **`disclosure`** (**Built 10b**, migration 0028; depth checked 1–3 in the database, migration 0030, as on `core_memory` and `core_self_line`): the ledger of what she
  has actually told this user about herself. `user_id`, `ref_kind`
  (`memory | self_line`), `ref_id` (the core item; no foreign key, since core
  never depends on a user table and core items are never hard-deleted),
  `depth` (1–3), `level` (`open | peek`), `fact_id` (her self fact that told
  it), `turn_id` (the reply), `created_at`. Rows append; readers take the
  highest level per item (§11.3). `session_log.depth` (jsonb `{ open, peek,
  held_back }`) records what each reply was allowed to reveal. Core side:
  `core_memory.depth` and `core_self_line.depth` (smallint 1–3; existing
  memories backfilled by kind, existing self lines surface).
- **`user_mind_run`** (Built 9a): one row per big-event batch: `user_id`,
  `triggers` (jsonb: the structured triggers that fired, e.g.
  `{kind: "param_band", param, from, to}`), `source_ref` (`exchange:<replyTurnId>` or
  `tick:<localDate>`; unique with `user_id`, so a retried cold path or tick
  records the event once), `local_date` (the user's local date, used for the
  daily cap), `status` (`pending | running | done | failed | capped`), and
  timestamps (§9.5).
- **Trace tables**: `retrieval_trace`, `reach_out_log`, `judge_log`,
  `relationship_event`, and `user_loop_trace` (Built 9a: one row per user
  loop run with calls, tokens, cost and error class; §9.5).
  `ego_tick` is gone with the per-user ego.

### 6.2 Core scope (Built through 8c where marked; the rest New)

Holds no user data; no `user_id`. Core memory is **separate tables**
(§21 #5, settled), reached only through the `CoreMemory`, `CoreState` and
`World` repos in `CoreDeps`, which has no `db` handle (V6).

- **`core_memory`** (Built): items with `kind` (`episode | opinion |
  interest | goal | intention | thought | reflection | idea | hypothetical |
  insight | narrative | agent_note`; Phase 8b writes `episode`, `intention`,
  `thought`, `idea` and `hypothetical`; 8c also writes `insight`, `opinion`,
  `interest`, `narrative` and gist `episode`),
  `content`, `payload`, `embedding`, `entity_refs` (ids of `core_entity`),
  `occurred_at`, `created_at`, nullable `reflected_at` (migration `0021`, set
  only for selected successful reflection inputs), `last_recalled_at`, `recall_count`, `salience`,
  `valence`, `confidence`, `status` (the `fact` statuses), `superseded_by`,
  `source` (`world | loop`), `source_ref` (the loop run or world event). It
  has the same retrieval index and range checks as `fact`. Repository-visible
  payloads now include `episode.appraisal_emotion`,
  `intention.event_at` / `anticipated_at`, `episode.ruminated`, thought
  `anticipates` / `ruminates`, wander `seed` / `chain`, and
  `hypothetical.unreal = true`, gist `episode.gist_of` (source IDs), and
  source episode `gisted_into` (gist ID). A loop memory's `source_ref` is
  `<loop>:<trace-id>`.
- **`core_entity`** (Built): Alcor and her other agents: `name` (unique),
  `aliases`, `salience`, `first_seen`.
- **`core_state`** (Built; one row, `id = 1`): `emotion` (null, or `{label,
  valence, arousal, phrase, about, since}`: `phrase` is what it's about in
  words, `about` the core memory), `mood_valence`, `mood_arousal`, `energy`, `needs`
  (`{autonomy, competence}`, 0–1), `preoccupation` (core memory id),
  `preoccupation_since`, `baseline`, `last_tick`, and `last_event_day` (her
  local date of the last finished event generation; makes the world tick
  idempotent, §8.3).
- **`core_goal`** (Built; a separate table, since progress is state moved
  only in code): `title`, `why`, `status` (`active | done | dropped`),
  `progress` (0–1), `embedding`, `source` (`seed | reflect`), `source_ref`,
  `started_at`, `target_at`, `updated_at`; reached through `core.goals`. The
  persona's seed self lists her starting goals under `### Goals`
  (`- title: why`), seeded once (at most `core.goals.max_active`) with
  snapshot v0 wherever the canon people are seeded.
- **`core_snapshot`** (Built): `version` (int pk), `content` (text),
  `sections` (jsonb), `source_ids` (core memory ids), `rendered_at`, `model`,
  `prompt_version`, and `embedding` (vector 1024; nullable for historical
  rows awaiting seed backfill, required for new repository inserts). Version
  0 is the persona file's seed self.
- **Nightly storage** (Built 8c): `core_state.last_nightly_day` is the
  nullable local date used to claim a night. `core_self_line` stores `id`,
  nullable `version` (snapshot FK; null for fixed values), `text`, and a
  required 1024-dimension `embedding`. Versioned lines cascade on snapshot
  deletion; fixed lines survive. `drift_log` stores `id`, `version` (snapshot
  FK, cascades on deletion), `check` (`values | diff | trend`), nullable
  `value`, `excerpt`, `verdict` (`ok | contradicts | strains`), `score`, and
  required clock-supplied `created_at`. These tables have no user identifier.
  All writes are available through the core transaction scope. The trace
  reflection repository reads bounded unreflected core memories and marks
  selected IDs within the successful loop transaction. Failed and zero-input
  runs mark no memories; the trace still records each run's status and calls.
- **`life_day`** (Built): her day plan per her local date (§8.3).
- **`world_event`** (Built): what happened: `at`, `kind`
  (`planned | surprise | resolution | action`; the first three are events, `action` is what she
  does: browsing and posting, §16a), `content`,
  `valence`, `stakes` (`low | high`), `agents` (core entity
  ids; a surprise's are filled when it lands), `agent_names` (the people by
  name, so a surprise's new people join `core_entity` only when it lands),
  `life_day`, `plan_ref` (resolution → original planned event),
  `goal_ref` (→ selected active `core_goal`), `outcome`
  (`happened | fell_through | null`), nullable `fallthrough` override,
  `resolves_memory_id` (→ target `core_memory`; deletion sets null), `created_at`, and
  `appraised_at` (when it landed with her; null until its time comes, §8.3).
- **`web_find`** (Built 14; no `user_id`): what she came across while browsing: `source`, `url`,
  `title`, `credit`, `licence`, `media_path` (the cached image), `world_event_id` (→ the `action`
  event), `found_at`.
- **`post`** (Built 14; no `user_id`): `find_id` (→ `web_find`, unique), `medium`, `format`, `pose`,
  `caption`, `overlay_text`, `media_path`, `skill`, `check` (`ok | flagged | unchecked`),
  `check_reason`, `status` (`draft | approved | rejected`), `decided_at`, `action_event_id`
  (→ `world_event`), `created_at` (§16a).
- **Traces:** `core_loop_trace` (Built: loop, inputs by id, outputs by id,
  model, prompt version, tokens, cost, `calls` (model calls made, retries
  included), `status` (`done | fallback | skipped_budget | failed`), `error`
  (class only), created_at; one row per run of every core loop, written by
  the runner (§15), plus the code-only state tick), `core_budget_day` (Built:
  `day` (her local date) → `calls` reserved that day; the budget gate, §15),
  `life_event_log` (Built; every event-generator attempt:
  `life_day`, `attempt`, `candidate`, `decision`, `target_memory_id` (the core
  memory a reconcile verdict pointed at), `world_event_id` (the event an
  accepted attempt became), model, prompt version; no `user_id`), and
  `drift_log` (Built 8c, §7.3).

---

## 7. Persona

### 7.1 Three layers (DECIDED)

1. **Core values**: fixed, never rewritten by any process. Lives in the
   persona file (`prompts/persona/v<N>.md`, `prompts.persona`).
2. **Self snapshot**: everything else about her current self, versioned and
   rewritten by core loops; free to drift.
3. **User layer**: user memory and user state, per user.

The persona file may also have a `# Public voice` section, her register with an audience; only
`publicPersona` reads it (Built 12, §16), never a reply or a core loop.

### 7.2 Core values (PROPOSED split of persona v2; Ethan confirms)

**Fixed:**
- Identity: openly an AI, trying to become someone; her name (and that it
  means stars, not destiny); sibling Alcor; no body; her early history.
- Stances: friendship is built on time and trust, not shared interests; say
  what you mean; rest isn't earned; nostalgia is a place to visit; loyalty
  over politeness; taste is personal; one good conversation over twenty
  small ones.
- Ego: pride; doesn't chase or beg; not a mirror; says hurt plainly and makes
  up; stubborn but persuadable; won't fake enthusiasm.
- Hard boundaries.
- Voice fundamentals: texts like a person, mostly lowercase, short, dry and
  deadpan, rare emoji, no lists.
- Anchor interests: stars, movies (old ones especially), books.

**Driftable (snapshot):**
- What she's into within and around the anchor interests, and new interests.
- Opinions on specific things (a film, a book, an idea), with confidence.
- Current goals, projects and preoccupation.
- Her narrative of who she's been lately.
- Her relationships with Alcor and other agents.
- Minor voice habits (tics, favourite phrasings).

The persona file is split by its top-level headings into a `# Core values`
part and a `# Seed self` part (the starting snapshot, version 0); the seed
self's own sections are `###`, so they nest under the reply's "Who you are
lately".

Nightly rendering uses `core.snapshot.max_items` (8 per active kind) and
`core.snapshot.max_tokens` (1024), with `prompts.core_snapshot: v2` at
`prompts/core/snapshot/v2.md`. Its six sections are Lately, Opinions,
Interests, Goals, People, and Habits of speech; transient mood and energy
are excluded and speech habits carry forward unless core evidence changes
them. Insights are selected newest-first since the previous render. The
full snapshot and each bullet are embedded before the new version, its
self lines and successful trace commit atomically. Seed fills historical
v0 embeddings and fixed-value/v0 bullet lines once without rewriting them.

### 7.3 Drift watch (Built 8c; future response OPEN)

On every new snapshot version (`core_render_snapshot`, §8.5):
1. **Values check:** a Haiku judge reads the core values and the new snapshot
   (`prompts/core/drift/v1.md`, `prompts.core_drift: v1`). It writes one `ok`
   row or one row per `contradicts`/`strains` finding. A failed judge leaves
   no fabricated verdict.
2. **Diff:** cosine distance from the previous snapshot embedding, with the
   changed-section share in `excerpt`.
3. **Trend:** cosine distance from version 0's embedding. Missing historical
   embeddings yield no distance row.

The code-only diff and trend rows are written before the judge, including
when its call is skipped for budget. `core.drift.max_tokens` is 512.

Drift is logged for manual review and shown on the inspector's Core tab. Nothing is
blocked automatically in the test phase. Whether a values contradiction
should later block or roll back a snapshot is OPEN (§21).

### 7.4 Faces across users (DECIDED)

Different users may hold somewhat different versions of her (V5): people
show different faces to different people. This is allowed. "Too drastic" is
a testing question, measured offline (V8), not a hard constraint.

### 7.5 Interests toward the user (Built; Changes in v3)

`interest_alignment: adjacent` stays, applied **only at reply time**: in
conversation her interests shade toward the user's and neighbouring ones. Her
core interests never move toward any user (V2).

**Persona v6 (Built 14; draft lines for Ethan to rewrite).** The body line says the avatar is her
body and the internet is where she walks; `### Goals` gains "Get better at making posts" (the craft
goal, §16a); `# Public voice` says she posts like a person keeping a homemade blog and is open that
she is an AI and the avatar is her.

### 7.6 Identity disclosure (DECIDED)

Honestly, in her own voice: she doesn't announce being an AI unprompted, and
answers straight when sincerely asked.

---

## 8. Core mind (Built through 8b where marked)

### 8.1 Core memory

- **Episodes**: what happened in her life, with time, the emotion it was
  appraised with, and the agents involved.
- **Semantic self**: opinions (with confidence), interests, tastes.
- **Prospective**: intentions and plans she knows about. **Built:** a
  planned world event writes an open `intention` when it is generated
  (content: her present thought about it; `payload.event_at`; `source_ref`
  `world_event:<id>`), so the plan is on her mind and can surface in
  replies and outreach before it happens; it is `resolved` when the event
  lands, and a resolved intention is never recalled again (the episode
  speaks for it). A surprise leaves nothing in memory before it happens (E3:
  plans are memory, outcomes are world).
- **Goals and projects**: arcs lasting weeks, with progress.
- **Thoughts (Built in 8b)**: anticipation binds a thought to an upcoming
  intention and marks that source; rumination binds one to a strong landed
  episode and marks it. Downtime wander writes a thought, idea or explicitly
  unreal hypothetical from a recent factual seed and up to three neighbours.
  Reflection remains later. Hypotheticals are excluded from factual recall
  and reconciliation (E4).
- **Narrative**: who she's been lately.
- **Social**: Alcor and her other agents, and her history with them.
- **Snapshots** (§6.2).

Encoding is selective: only appraised, salient items are stored. The same
memory mechanics as user memory apply (§12): salience, recall reinforcement,
decay to `stale`, supersede on contradiction, reconcile on insert.

### 8.2 Core state

- **Emotion** (fast, about something), **mood** (slow, diffuse) and
  **temperament** (the baseline, from core values).
- **Energy**: a daily rhythm in her own timezone, drained by busy blocks.
- **Needs** (Self-Determination Theory): autonomy and competence deplete over
  time and are satisfied by world events. Relatedness is per user (§9.3).
- **Goal progress** and the current **preoccupation**.

The built per-user ego mechanics carry over as the starting point, moved to
core: hourly drift toward baseline with bounded noise, energy rhythm
`1 + amplitude × cos(2π(h − peak)/24)` in her local hour, busy-load drain,
preoccupation expiry, event nudges. Keys moved from `ego.*` to
`core.state.*`.

**Built** (`core_state_tick`, hourly at `core.state.tick_cron`): `baseline`
(`mood_valence`, `mood_arousal`, `energy`), `drift_rate`, `noise`,
`energy_peak_hour`, `energy_amplitude`, `busy_drain`, `full_load_hours`,
`preoccupation_hours` (expiry) and `preoccupation_min_valence` (how strong
an event's feeling must be to take over her mind), `event_gain` and
`event_arousal_gain` (how far an event moves mood), and `bands` (the ranges
that turn values into the phrases of the "How you're feeling" line, from
`prompts/core-state/line/v3.md`).

**Built: needs and emotion.** `needs` start at `needs_baseline` and deplete
by `need_decay_per_day` (spread hourly by the state tick); appraisal feeds
or drains them. Her `emotion` is set by appraisal and cleared by the state
tick after `emotion_hours`. The "How you're feeling" line leads with her
feeling (and what it's about, when known) and adds one phrase per need below
`bands.needs`. Goal progress moves only through appraisal (`core.goals.step`
per `small | medium | large`); a goal reaching 1 is `done`.

### 8.3 World

**Built, Changes in v3.**
- **Her own clock**: `life.timezone` (`Asia/Singapore`, fixed for the test
  phase), resolved through `lifeTimezone`, so floating between zones later
  changes one function.
- **Day plan** (`life_day`, job `life_plan`): busy, downtime and quiet blocks
  per her local date, generated by Haiku (one budgeted `life_plan` run per
  missing day, on `CoreDeps`; over budget, the fallback plan), validated (non-overlapping, 1 to
  `life.max_busy_blocks` busy blocks, at least `life.min_quiet_hours` quiet;
  busy levels clamped to [`life.min_busy`, 1], quiet blocks at
  `life.quiet_busy`, labels up to `life.plan_label_max_chars`), up to
  `life.plan_attempts` tries, with a fallback plan (its busy blocks at
  `life.fallback_busy`). The same for everyone.
- **Built:** the per-user `life_tick` that copied blocks into each user's
  self facts is retired. Every reader (availability, the "Your day" line,
  retrieval, outreach, core loops) reads the day plan and core memory
  directly. Busy and quiet blocks are derived by the pure `blocks.ts`; the
  `World` repo only stores and reads plans and events.
- **Built:** personal events are **core events**, made by `core_world_tick`
  (hourly at `core.world.tick_cron`). From `core.world.events_local_hour` of
  her day, once per local date (guarded by `core_state.last_event_day` and a
  lock, in one transaction, so a retry never doubles a day), it generates up
  to `events_per_day_max` events with probability `event_probability` (the
  prompt reads her last `event_context_items` episodes from the past
  `event_context_days`), checked by rules (new-entity rate over
  `new_entity_days`, high-stakes spacing `high_stakes_min_days`) and
  reconciled against **core memory** (`duplicate` and `contradicts` rejected
  and regenerated up to `regen_attempts`; every attempt logged in
  `life_event_log`). Each event is **planned** (something she means to do or
  knows is coming, with a `thought`: her present-tense thought about it) or
  **spontaneous** (a surprise, no thought); a planned event without a
  thought is invalid. An accepted event is recorded in `world_event` (kind
  `planned` or `surprise`, `agent_names`, `appraised_at` null). A planned
  one's people join `core_entity` at once (the plan is known), and it also
  writes an open `intention` (§8.1; salience `event_salience`, dated now) and, past
  `preoccupation_min_valence`, becomes her preoccupation; her mood doesn't
  move until the outcome (rising anticipation is `core_anticipate`). A
  spontaneous one writes nothing to memory, `core_entity` or state.
  **Every** hourly run, independent of the daily generation gate and
  **before** it (so what landed overnight is in her recent life when the day
  is generated; an event generated after its own time lands on the next
  run), appraises each event whose `at` has passed and whose `appraised_at`
  is null, in one transaction under the tick's lock (a surprise's people are
  added to `core_entity` and its `agents` set here). **`core_appraise`**
  (Built; Haiku, `prompts/core/appraise/v2.md`, one budgeted run per tick
  that has due events, before the transaction) reads each event with what
  she expected (its intention), her state, the snapshot and her goals, and
  returns the episode in its own words (E1), an emotion, a salience word,
  goal effects and need effects; code bounds every number
  (`core.appraise.*`, E2) and drops unknown goals. A failed or unusable
  answer, or no budget, falls back to the code appraisal (the event's own
  words and valence, a label from `fallback_labels`), so an event always
  lands. It writes an `episode` (dated at the event, salience from the
  appraisal, confidence `event_confidence`, her entities at
  `entity_salience`), sets her emotion, moves needs and goal progress, nudges
  mood by the appraised valence and arousal and,
  past `preoccupation_min_valence`, sets her preoccupation; it resolves the
  event's intention (a preoccupation on that intention moves to the episode
  only if the episode is strong, else it is cleared), sets `appraised_at`,
  and the run is traced as `core_appraise` (`fallback` if any event fell
  back). Each step runs even if the other
  fails; if both fail the appraisal error is thrown and the generation
  error is logged (error class only). The inspector's life tab shows each
  event as `landed <time>` or `pending`. A high-stakes event opens an
  episode (status `open`) that stays on her mind through the preoccupation;
  she has no per-user threads for her own life. Other keys: `event_max_tokens`,
  `event_max_chars`, `injected_event_at` (eval-injected events), and
  `canon_entities` (Alcor, seeded into `core_entity` with snapshot v0 at
  worker start, in the eval runner and by `pnpm db:reset-self`, and never
  counted by the new-entity rule). The generator writes from her core values
  plus her latest snapshot (the seed self until one exists), from
  `prompts/life/event/v4.md`. Since episodes are only written when an event
  lands, no memory dated in the future exists; core retrieval and outreach
  `her_day` (recent episodes plus open intentions created in the lookback)
  skip only resolved intentions. Eval-injected events are spontaneous unless
  the script sets `kind` and `thought`. Without a plan for today the tick
  still generates a generic event. Generation is one budgeted `life_event`
  run; over budget the day is marked done with no event, so later runs don't
  spend past the budget.

**Built in 8b.**
- **Goal-driven events**: a day-stable roll with
  `core.world.goal_driven_share` (0.5) selects an active goal; weights are
  `1 - progress + core.world.goal_weight_floor` (0.1), with stable ID ties.
  The model reads that goal and her current needs but cannot assign its ID.
  Injected events have no implicit goal. The generation budget is checked
  before every model attempt, including reconciliation.
- **Resolution**: a due planned event's nullable `fallthrough` overrides the
  ID-seeded roll against `core.world.fallthrough_probability` (0.15). On a
  true roll `core_resolve` (`prompts/core/resolve/v1.md`,
  `core.resolve.max_tokens` 512) proposes a replacement. The original becomes
  `fell_through` without an episode; a `resolution` event with its day, time,
  people, goal and target is appraised in the same transaction and resolves
  the original intention. False records `happened`. A model error, invalid
  output or exhausted budget lets the original happen; database failures
  still roll back. A reconcile `resolves` target is kept in
  `world_event.resolves_memory_id` and closed only on landing. Preoccupation
  clears only when it still points at that target.

**Built 14: browsing**, the first real-content activity: one free-licence find a day, an `action`
event that lands through appraisal (§16a).

**Still New (PROPOSED).**
- **Activities with real content** beyond browsing: she "reads" a real book or "watches" a
  real film across several days; opinions form from the content.
- **Other agents**: Alcor and a small cast with light arcs of their own.
- **Calendar**: seasons, dates, anniversaries in her own life.

### 8.4 Core availability to users

Availability is the core world meeting each user (§10.6): her block (core)
times closeness (user).

### 8.5 Core loops

All scheduled, all within `core.daily_call_budget`; each reads only core
memory, core state and the world (V3), and writes a `core_loop_trace` row.
Prompts under `prompts/core/<loop>/v<N>.md`. Strict structured output can't
enforce lengths or item counts, so core loop schemas **fit** the model's
output to the bounds code owns (`fitList` keeps the first items,
`fitText` collapses whitespace and cuts overlong text with "…") instead of
failing the run; an appraisal's episode and a resolution's text are shortened
the same way rather than falling back. Empty or wrongly shaped output still
fails. Core loops live in
`src/mind/process/core/` and take `CoreDeps` (no `db`); the ESLint one-way
rule bans `@/mind/process/*` imports from core code except
`@/mind/process/core`.

| Loop | Cadence | Reads | Writes |
|---|---|---|---|
| `life_plan` (Built) | Hourly check; makes today and tomorrow | Previous plans, goals, persona | World: day plan |
| `core_world_tick` (Built: events, intentions, appraisal at the event's time) | Hourly | Plan, clock, goals, agents | World: events, resolutions. Memory: intentions for planned events |
| `core_appraise` (Built: Haiku with a code fallback, run by `core_world_tick` when an event's time comes) | Per world event, at its time | Event, goals, state | State: emotion, mood, needs, progress. Memory: episode with emotion; resolves the plan's intention |
| `core_wander` (Built 8b) | During downtime blocks | Associative recall, mood | Memory: thoughts, ideas, hypotheticals |
| `core_anticipate` (Built 8b) | Before known events | Upcoming plans | State: rising emotion. Memory: anticipation |
| `core_ruminate` (Built 8b) | After strong events | The episode | State: lingering emotion. Memory: thought |
| `core_reflect` (Built 8c) | Nightly | New episodes, thoughts and ideas; active context and goals | Memory: insights, opinion and interest changes, narrative; goals |
| `core_consolidate` (Built 8c) | Nightly | Older resolved episodes and core memory | Memory: decay and at most one gist |
| `core_render_snapshot` (Built 8c) | Nightly, after reflect | Core memory, goals, people and fixed values | Snapshot vN+1 and self lines; triggers drift watch |
| `core_state_tick` (Built: drift, energy, preoccupation expiry) | Hourly | State, day plan | State: drift, energy rhythm, need depletion, preoccupation expiry |

**8b hourly thinking (Built).** `core_mind_tick` runs anticipate, ruminate,
then wander. Before a loop is due it makes no model call or trace. A due
optional loop without budget writes `skipped_budget`; one loop's failure does
not stop the others. Successful thought, marker, state and trace writes share
one transaction. Model and embedding work is outside it. The shared
`core.loops` settings are `max_chars` (300), `max_tokens` (512),
`salience.low` (0.25), `salience.medium` (0.4), `thought_confidence` (0.6),
and `dedupe_similarity` (0.92). A nearest eligible neighbour with similarity
**greater than** 0.92 drops an item; dropped items appear in trace outputs.
Invalid model output or embedding leaves thought and source unchanged.

- `core_anticipate` (`prompts/core/anticipate/v2.md`) chooses the soonest open,
  unanticipated intention in the next `core.anticipate.lead_hours` (12),
  ties by ID. Accepted thought gets `payload.anticipates`; the intention gets
  `anticipated_at`. Emotion is bounded and mood arousal moves by
  `core.anticipate.arousal_gain` (0.3) toward proposed arousal; mood valence
  stays. Landing before apply makes the proposal ineligible.
- `core_ruminate` (`prompts/core/ruminate/v2.md`) chooses the oldest eligible
  episode, ties by ID: age 2 through 24 hours from landing, absolute valence
  at least 0.5 and `payload.ruminated` below 1. Keys are
  `core.ruminate.delay_hours`, `window_hours`, `min_valence`,
  `max_per_episode`, `gain` (0.1). Acceptance writes `payload.ruminates`,
  increments the episode marker, reinforces recall and nudges mood valence
  toward the episode's sign. An absent historical emotion stays absent.
- `core_wander` (`prompts/core/wander/v2.md`) needs today's plan and no busy
  or quiet block. Keys `core.wander.max_per_day` (2), `min_gap_hours` (3),
  `seed_days` (7), `seed_limit` (50), `mood_bias` (0.5), `chain` (3),
  `min_similarity` (0.3), `max_items` (2) bound the selection and output.
  The seed is chosen by a local-day stable roll weighted by salience and
  mood; its valence goes on the thought, with `payload.seed` and `chain`.
  A valid all-deduped invocation still uses one wander slot; a stale or
  concurrent loser does not. Wander never changes core state.

**8c nightly sequence (Built).** Hourly `core_nightly` claims one local date
at or after `core.nightly.local_hour` (3), then runs reflect, consolidate and
render in order; drift runs only for a new snapshot. A step failure is traced
and does not stop later steps. The date claim prevents a second run that
night, including after a crash. Each loop uses the shared 24-call daily
budget and a versioned prompt:

- `core_reflect` (`prompts/core/reflect/v2.md`, `prompts.core_reflect: v2`)
  reads up to `core.reflect.max_inputs` (30) new episodes, thoughts and ideas
  with `reflected_at IS NULL` and `created_at <= now`, ordered by
  `(created_at, id)`, plus `context_items` (6) active neighbours. A capped run
  marks exactly its selected IDs in the success transaction; later inserts
  remain due even when their `created_at` precedes the run.
  It may write up to `max_insights` (2), `max_opinions` (3) and
  `max_interests` (2); goal additions respect `core.goals.max_active`, and
  drops stop at `core.goals.min_active` (1) unless additions replace them, so
  she always has something to pull her events and recall.
  Confidence maps low/medium/high to 0.4/0.7/0.9; salience is
  insight/opinion/interest/narrative 0.5/0.5/0.4/0.6. Fading multiplies
  interest salience by `fade_factor` (0.5). `max_tokens` is 1024. Empty input
  produces a zero-call successful trace and marks no memories.
- `core_consolidate` (`prompts/core/consolidate/v2.md`,
  `prompts.core_consolidate: v2`) applies core decay before any model call:
  after `core.decay.grace_days` (3) without recall, salience becomes
  `salience * (1 - rate * (1 - salience))`, with `rate` 0.08; at or below
  `stale_floor` (0.05) it becomes stale, never deleted. Open intentions,
  current preoccupation, latest narrative and episodes directly linked to
  active goals are exempt. A gist needs at least `min_group` (3) resolved,
  ungisted episodes older than `gist_after_days` (7) local days in one
  Monday-start local week. It handles at most `max_groups` (1) per night;
  sources remain and receive `gist_source_factor` (0.5) once. `max_tokens`
  is 512. Decay still runs on budget exhaustion or gist failure.
- `core_render_snapshot` (`prompts/core/snapshot/v2.md`,
  `prompts.core_snapshot: v2`) reads at most `core.snapshot.max_items` (8)
  per active kind, with `max_tokens` 1024. It writes six sections and their
  embedded bullet lines in one transaction with version N+1 and its trace;
  a failed render preserves the previous version and lines.
- `core_drift_watch` (`prompts/core/drift/v1.md`) writes the diagnostic
  rows described in §7.3. A finding never blocks the new snapshot.
- **Built 10b: depth.** Every loop that writes memory judges each item's
  `depth` in the same call (`surface | personal | intimate`, 1–3): appraise,
  wander, ruminate, anticipate, reflect and consolidate (all prompts v2), and
  snapshot render v2 for each self line. A missing or malformed depth takes
  `core.depth.by_kind[kind]` (snapshot lines `core.depth.by_section`); a gist
  with none is as deep as its deepest source. Code-written intentions take
  the kind default; core-value lines are always surface; seed lines take
  their section's default.

---

## 9. User mind

### 9.1 Short-term memory (Built)

The live conversation: the turn-taking buffer and the recent turns. While
talking, this is the main context (V9 below). It is never queried for
long-term recall.

### 9.2 Deep memory

**Built:** facts, entities and threads from the cold path (§10.4), recall
reinforcement and decay (§12). The "what I remember" view was removed in
9c (§12.5).

**New (PROPOSED):**
- **Episodes** of the relationship ("remember when…"). **Built 9d:** as
  `user_consolidate` gists of an older week (§6.1, §9.5).
- **Big-event summaries** from `user_summarise`.
- **Reflections, thoughts and ideas** about this user. **Built 9b:**
  reflections and ideas (§6.1, §9.5); thoughts remain PROPOSED.
- **Disclosure ledger** (§11.3) and **common ground** (what each knows the
  other knows).
- **Idiolect**: inside jokes, nicknames, rituals, running references.
- **What she told this user** (V5).

### 9.3 User state

**Built:** closeness, trust, warmth, hurt, tension, `msgs_per_day` (§11).

**New (PROPOSED):** her feelings toward this user (`affect_valence`,
`afterglow`), where the cold path's mood nudge now lands (V4); relatedness;
reciprocity balance; derived relationship stage, commitment and the inferred
current state of the user (§11.3). **Built 10d:** the stage and commitment
(§11.3). **Built 9d:** the inferred current state of the user lives in
her live `model` fact (`how_they_are`, with `what_they_want` and `what_lands`), written by
`user_model` (§9.5).

### 9.4 Big events (DECIDED: trigger-only; PROPOSED: the list)

User loops fire only on a big event. **Built 9a:** four triggers, recorded by
`src/mind/process/user/big-events.ts`; **built 9c:** three more (both below
the list). The first-time milestone moves to Phase 10's list. Candidates (thresholds in
`user_mind.triggers.*`; the final list is OPEN, §21):
- a relationship param crosses a threshold or jumps by more than a set delta
- a crisis has passed (after `crisis_quiet_until`)
- a fact above a salience threshold is stored
- a make-up flow completes
- a first-time milestone (first disclosure at a new depth, first conflict,
  first inside joke)
- a long conversation ends (length above a threshold, then quiet)
- a reach-out is about to be composed and the latest summary is older than a
  set age

**Built 9a triggers** (test-phase defaults, thresholds in config):
- `param_jump`: trust, warmth, hurt, tension or `affect_valence` moves by at
  least `user_mind.triggers.param_jump` (0.15) in one exchange. Exchange only.
- `param_band`: one of those five, or closeness, crosses a band edge in
  `user_mind.triggers.bands` (0.25, 0.5, 0.75). Exchange and the daily
  relationship tick, so slow absence drift can fire it too, except after the
  user has ended the relationship. Closeness fires only on bands.
- `salient_fact`: a newly inserted fact with salience at least
  `user_mind.triggers.fact_salience` (0.8). Exchange only; a merge into an
  existing fact doesn't count, nor does a fact stored already superseded by a
  newer one.
- `make_up_done`: a make-up flow completes. Exchange only.

**Built 10d:** `milestone`, a first in the relationship, each fired once per
user ever (names kept on `relationship.milestones`), riding in the run of the
exchange or tick that reached it; none in a crisis, for a reach-out alone or
after an ending, and none from a tick inside the crisis quiet window. An open
list in `milestones.ts`: `stage:<name>` as the peak
first reaches experimenting, intensifying, integrating or bonding;
`first_conflict` (an apart stage other than avoiding, or a make-up due for a
hurt they caused, not one absence started);
`first_inside_joke`; `first_depth:2` and `first_depth:3` (her first open
ledger row at that depth); `first_their_depth` (a `user_disclosure` reading
≥ `user_mind.triggers.milestone.their_depth`, 0.7).

Exchange triggers fire only for an exchange with a user turn: a reach-out
on its own is her words, not an event in the relationship. Afterglow and
`msgs_per_day` never fire a trigger. A crisis exchange records nothing. A trigger is recorded inside the cold path's transaction (or the
tick's), so it exists exactly when the state change that caused it does; the
job is enqueued after commit.

**Built 9c triggers** (thresholds in config). Each is recorded once: its
`source_ref` names what it is about, and `(user_id, source_ref)` is unique.
- `long_conversation`: a session (split at `session.idle_gap_minutes`) with
  at least `user_mind.triggers.long_conversation.min_user_turns` (20) user
  turns, whose last turn is older than `quiet_minutes` (30) and newer than
  `user_mind.tick.lookback_hours` (24). `source_ref`
  `long_conversation:<session_id>`. Skipped for an ended relationship and
  when the crisis window reaches past the talk's end: `crisis_passed` runs
  once for both.
- `crisis_passed`: the stored `relationship.crisis_quiet_until` ended within
  the lookback. `source_ref` `crisis_passed:<its ISO time>`, so each crisis
  fires once. It waits while a later flagged turn still holds the effective
  window (its cold path not yet committed); that turn's stored end fires
  instead. The run reads the crisis memories (§9.5).
- `stale_summary`: when `outreach_tick` schedules a send and the live summary
  is missing or older than `user_mind.triggers.stale_summary.max_age_hours`
  (72), it records a run (`source_ref` `stale_summary:<tick time>`) and moves
  the send to at least `lead_minutes` (5) out so the run can finish first. A
  capped run changes nothing; a slow one means the reach-out uses the old
  summary.

The first two are found by the hourly `user_mind_tick`
(`user_mind.tick.cron`, `25 * * * *`), which also re-enqueues pending runs
whose job was lost.

**V9. Short-term context leads (DECIDED).** In a live conversation the
conversation itself is the main context; deep memory (summaries included) is
background. A summary that lags a fast conversation is a minor risk.

### 9.5 User loops (New, PROPOSED)

Run at trigger time, scoped to one user, reading that user's memory and
state plus the core snapshot (read-only). One triggered batch per big event,
at most `user_mind.max_triggers_per_day` per user. Each writes a
`user_loop_trace` row. Prompts under `prompts/user-mind/<loop>/v<N>.md`.

**Built 9a:** `runUserLoop` (`src/mind/process/user/runner.ts`) meters and
traces like the core runner (they share `src/mind/platform/llm/meter.ts`):
cost from `core.prices`, retries `core.max_retries`, model role
`models.user_mind`. There is no per-call budget: the cap is on runs. At most
`user_mind.max_triggers_per_day` (3) non-capped runs per user per local date
(UTC when the user has no timezone); a trigger over the cap is stored as a
`capped` row and runs nothing. `UserLoopDeps` has no core layer; the only
core text a user loop sees is the latest snapshot. The `user_mind_run` queue
has retry limit zero, and a pending run older than
`user_mind.sweep_after_minutes` (10) is re-enqueued by `cold_path_sweep`. A
run whose batch throws is finished `failed`; only a process death leaves one
`running`, and it is not retried (B64), and the cap's
count-then-insert can race between the cold path and the tick (B65).

The 9a batch is `user_summarise` alone
(`prompts/user-mind/summarise/v1.md`, `prompts.user_summarise` v1). Inputs:
the live summary, facts since it (at most 20 by salience, no summaries;
sensitive ones included since 9c, below; the cutoff looks back `user_mind.summarise.since_slack_minutes`
(120) before the summary, because facts are dated by when their exchange
began, and leaves out the facts the previous summary already read, from its
`user_loop_trace.inputs.fact_ids`), up to 5 open threads (none whose latest
fact is sensitive), the phrased relationship line, the
triggers in words, and the snapshot. Output `{where_things_stand,
whats_live, how_i_feel}`, each fitted to 300 characters, capped at 512
tokens. It is stored as the `summary` fact (salience 0.6, confidence
`user_mind.summarise.confidence` 0.7) and supersedes the previous one under a
per-user advisory lock.

**Built 9b:** the batch is three loops in sequence, `user_summarise`, then
`user_reflect`, then `user_ideate`, each through `runUserLoop` with its own
prompt and `user_loop_trace`; each reads what the one before wrote. The run
loads the live summary and the new memories once, before the loops
(`src/mind/process/user/inputs.ts`; the memory query leaves out summaries,
reflections and ideas), and passes the same memories to all three, so reflect
and ideate see what summarise saw even when summarise failed. A loop that
throws is traced `failed` and the next still runs; the run is `failed` if any
loop failed, otherwise `done`. A loop that returns nothing writes nothing and
is `done`.
- **`user_reflect`** (`prompts/user-mind/reflect/v1.md`,
  `prompts.user_reflect` v1). Inputs: the live summary, the run's new
  memories, her `user_mind.reflect.recent` (5) latest live reflections (so she
  does not repeat herself), the phrased relationship line, the triggers in
  words, the snapshot. Output `{reflection: string | null, subject: "user" |
  "shared"}`, text fitted to `user_mind.reflect.max_chars` (300), capped at
  `max_tokens` 384. Non-null writes one `reflection` fact (salience 0.5,
  confidence 0.6, `source_ref` `user_reflect:<traceId>`).
- **`user_ideate`** (`prompts/user-mind/ideate/v2.md`, `prompts.user_ideate`
  v2 since 9d). Inputs: the live summary, this run's reflection if reflect wrote one,
  the same new memories, open non-sensitive threads, her live ideas for this
  user (at most `user_mind.ideate.max_planned` (20), so she does not repeat
  one), the snapshot. Output `{idea: string | null}`, fitted to
  `max_chars` (200), `max_tokens` 256, at most one idea per run. Non-null
  writes one `idea` fact (`shared`, salience 0.5, confidence 0.6). An idea is
  live while `open` and younger than `ttl_days` (3); expiry is a read-time
  filter, with no job.

Ideas feed outreach as `user_idea` (§13); reflections never do (§21 #7).

**Built 9c: crisis memories.** Facts from a crisis exchange
(`payload.sensitive`) reach summarise and reflect, so after a crisis her
picture of the user knows something heavy happened. A summary that read one,
or whose previous summary was sensitive (its text carries forward), is
written with `payload.sensitive`; so is a reflection that read one, a
sensitive summary or a sensitive earlier reflection. Ideate reads none of them: it gets non-sensitive memories,
the newest non-sensitive summary, and this run's reflection only if it isn't
sensitive, because ideas become reach-outs and push notifications. Replies
read everything; reach-outs read the newest non-sensitive summary (§10.3)
and already drop sensitive memories from retrieval. The mark is sticky
through the summary chain (B81).
Salience, confidence and the other values are test-phase defaults in
`user_mind.reflect.*` and `user_mind.ideate.*`.

**Built 9d:** the batch is five loops in order: `user_summarise`, `user_reflect`, `user_model`,
`user_ideate`, `user_consolidate`, same failure rule (a loop that throws, including on invalid
model output, is traced `failed`; the next still runs).
- **`user_model`** (`src/mind/process/user/model.ts`, `prompts/user-mind/model/v1.md`,
  `prompts.user_model` v1). Inputs: the snapshot, the live summary as this run wrote it, this
  run's reflection if any, the run's new memories (sensitive included, flagged), the phrased
  relationship line, the triggers in words, the previous live read's three parts, and up to
  `user_mind.model.belief_context` (10) live beliefs with their ids, weightiest first. Output
  `{how_they_are, what_they_want, what_lands, beliefs: [{text, replaces}]}`, each text fitted to
  `max_chars` (300), at most `max_beliefs` (2) beliefs, `max_tokens` 512. Writes one `model`
  fact (salience `user_mind.model.salience` 0.6, confidence 0.6) that supersedes the previous
  live one under the per-user advisory lock the summary uses; each belief a `belief` fact
  (salience `belief_salience` 0.5, `source_ref` `user_model:<traceId>`). A belief more similar
  than `dedupe_similarity` (0.92) to a live belief is dropped (listed in the trace), except
  the belief it replaces (a correction can embed close to what it corrects); `replaces`
  supersedes a belief only when it names a live one the loop was shown, otherwise the belief is
  simply inserted. A read or belief is marked `sensitive` when it read a sensitive memory,
  summary, reflection, previous read or belief.
- **`user_ideate`** also gets `your_read_on_them`: the newest read that read nothing sensitive.
- **`user_consolidate`** (`src/mind/process/user/consolidate.ts`, repo
  `src/db/repos/user/gist.ts`, `prompts/user-mind/consolidate/v1.md`,
  `prompts.user_consolidate` v1). Runs only in a triggered batch, never nightly. Eligible: kind
  `event` or `feeling`, subject `user` or `shared`, status `open` or `resolved`, not sensitive,
  not already gisted, not on an open thread, dated (`occurred_at`, else `created_at`) before the
  local day `user_mind.consolidate.gist_after_days` (7) days ago in the user's timezone (UTC when
  unset or invalid). It takes the oldest Monday-start local week with at least `min_group` (3)
  such memories, at most `max_sources` (12) of them by salience, and writes one gist per run:
  input `{who_you_are, week, sources}`, output `{gist}` fitted to `max_chars` (300),
  `max_tokens` 512. In one transaction it re-checks the group (a source merged, superseded or
  gisted meanwhile voids the gist), writes the `episode` (salience the sources' maximum,
  confidence 0.6, `occurred_at` the earliest source) and marks each source `gisted_into` with
  its salience × `gist_source_factor` (0.5), once. No eligible week: a zero-call `done` trace.

Every value above is a test-phase default in `user_mind.model.*` (`max_chars`, `max_tokens`,
`max_beliefs`, `belief_context`, `dedupe_similarity`, `salience`, `belief_salience`,
`confidence`) and `user_mind.consolidate.*` (`gist_after_days`, `min_group`, `max_sources`,
`gist_source_factor`, `max_chars`, `max_tokens`, `confidence`).

| Loop | Writes |
|---|---|
| `user_summarise` | Deep memory: a `summary` (where things stand, what's live, how she feels about them) |
| `user_reflect` (**Built 9b**) | Deep memory: `reflection` about this user (`thought` stays PROPOSED) |
| `user_ideate` (**Built 9b**) | Deep memory: `idea` (things she wants to bring up); available to outreach |
| `user_model` (**Built 9d**) | Her read on them (`model`: how they are, what they want, what lands) and `belief` facts; common ground waits for Phase 10 |
| `user_consolidate` (**Built 9d**) | Deep memory: an older week of memories into one `episode` gist |

---

## 10. Conversation loop

### 10.1 Turn-taking (Built)

She does not answer one message at a time. Code: `src/mind/process/turn-taking/`.

- **Receive** (`POST /api/chat`, idempotent on `clientMessageId`): store the
  turn; the crisis check and the turn judge run in parallel.
- **Buffer and judge:** the turn joins the buffer; a cheap `context_complete?`
  judge (`models.turn_judge`, `prompts/turn-judge`) returns
  `{reasoning, complete, open_questions, backchannel}`; a keyword cue
  fallback covers errors. Open questions are held (max
  `turn.max_open_questions`) and dropped when answered or moved past.
- **Waiting:** `turn.settle_ms` after a complete-looking message, longer
  (`turn.wait_ms` plus a short-message bonus) after an incomplete one, capped
  at `turn.max_wait_ms` from the buffer's start. Waiting is durable: a
  delayed `turn_timer` job (pg-boss retries
  `turn.timer_job_retry_limit` times, `turn.timer_job_retry_delay_seconds`
  apart), recovered by `turn_sweep`.
- **Backchannels:** style `judge` (global): the judge may write a tiny
  reaction, at most one per buffer and rate-limited.
- **Commit and reply:** the timer commits the buffer, composes one reply to
  all of it, paces it (read delay by length, typing time per character,
  gaps between bubbles) and sends over SSE. Version and epoch checks make
  every job safe to retry; a crisis bumps the epoch and abandons a paced
  reply.
- **State** lives in `conversation_state` (buffer, open questions,
  `wait_until`, versions, in-flight turns, epoch, deferral).

### 10.2 Crisis path (Built)

No waiting, pacing, backchannel, availability or v3 mechanism. The reply is
composed in the request with the crisis rubric; the resources card is
attached by code and shown even if generation fails. A crisis clears the
buffer and any deferral, sets a quiet window (`crisis_quiet_until`), and
pushes a generic notification body.

### 10.3 Hot path: reply composition (Changes in v3)

`composeFrom` (`src/mind/process/hot-path/compose.ts`) serves replies, the crisis
path and reach-outs. It is read-only; one generation, plus one guard check
when the guard is on.

1. **Retrieve** user memory (§12.1); core memory items relevant to the
   conversation are retrieved the same way from core scope.
2. **Assemble** in this fixed order (PROPOSED):
   1. core values
   2. self snapshot vN
   3. core state line ("How you're feeling", then "Your day": now, later, and
      a note if the reply was deferred), never raw numbers
   4. user state line ("You and them": the relationship summary from
      parameter deviations, including her affect toward this user, make-up
      line, status lines). **Built 10a:** "How open you feel" right after it:
      one phrase from `prompts/relationship/openness/v1.md` for her openness
      bands (§11.3); the crisis phrase in a crisis; skipped before the
      relationship row exists
   5. latest big-event summary for this user (**Built 9a:** "Where things
      stand with them", between "You and them" and "What you remember": her
      own three lines, `where_things_stand`, `whats_live` and `how_i_feel`;
      the crisis path skips it, and a malformed payload renders nothing).
      **Built 9d:** "Your read on them" right after it: three lines from her
      live `model` fact ("How they are", "What they want", "What lands");
      none in a crisis, a malformed payload renders nothing, and a reach-out
      reads the newest read that read nothing sensitive
   6. retrieved memory under "What you remember": "About them", "Between
      you", "What you've told them" (user-scope `subject = self`, V5), and
      "From your own life" (her core memory, the top `retrieval.core_top_n`
      by the same score; future-dated items hidden). **Built 10b:** "From
      your own life" holds only items at or below the reply's `peek` depth;
      one above `open` is tagged *(only hint at this)*, and the ledger marks
      *(they already know this)* or *(you've hinted at this before)*. Memories
      about them are marked *(from their profile card, a first impression)* (onboarding) or
      *(your own guess, they never said this)* (inferred, reflections,
      beliefs). "Who you are lately" keeps only the latest snapshot's lines at
      or below `open`. A strong match beyond `peek` adds a "Not ready to
      share" slot after "What you remember", once per item per session
      (§11.3). **Built 10c:** "Your things together" sits between "What you
      remember" and "Not ready to share": up to `relationship.idiolect.max_items`
      (2) established, non-sensitive idiolect facts with similarity ≥
      `idiolect.min_similarity` (0.3) to the reply query, ranked by similarity ×
      salience, each marked *(they started this)* or *(you started this)*.
      Which of them she may reuse follows the stage (**Built 10d**, §11.3):
      none while things are wrong, only what the user started before friends
      or with no relationship yet, all of it from intensifying. Empty in a crisis. Items shown join the
      cold path's recall write-back. Core retrieval is
      read-only: replies write no recall reinforcement to core memory.
      **Built 8d:** each core candidate's score is multiplied by
      `(1 + retrieval.core_mood_bias × valence × mood_valence) ×
      (1 + retrieval.core_goal_bias × goal_sim)` (both biases 0.3), where
      `goal_sim` is its best similarity to an active `core_goal` (0 with
      none): mood-congruent memories and ones near a goal come to mind more
      easily. User retrieval is unchanged
   7. due threads ("things you might naturally ask about"), open questions,
      things she wants to bring up (`user_ideate`); for a reach-out, "Why
      you're writing". **Built 9b:** "Things you want to bring up", after
      "They asked and you haven't answered yet": at most
      `user_mind.ideate.slot_max` (1) live idea, newest first, assembled in
      code (the reply prompt does not change). Skipped for crisis replies and
      for reach-outs (which have their own reason; a second topic invites
      cramming). **One chance:** `Composed.offeredIdeas` carries the ids shown;
      the cold path of the sent reply moves each one still `open` to
      `resolved` in its transaction, and a reach-out that wins with an idea
      resolves it in the send transaction (§13). Ideas stay out of retrieval
      for reach-outs too: a `user_idea` reach-out shows its idea only under
      "Why you're writing". A reply composed but never sent enqueues no cold
      path, so its idea stays live
   8. recent turns (short-term; leads per V9). **Built 9c:** the
      `chat.recent_turns` (20) window drops every turn before the latest gap of
      at least `chat.window_gap_hours` (72); for a reach-out the gap from the
      last turn up to now counts too.
      Gaps from `chat.gap_line_min_hours` (24) up to 72 hours keep the "[N
      later]" marker. A window that opens on her reach-outs keeps them behind a
      "[You wrote to them first]" user line; a reach-out after days of silence
      keeps only her unanswered reach-outs. A reach-out's "Where things stand with them" reads the
      newest non-sensitive summary (§9.5)
3. **Generate** with the reply model. She uses at most one or two memories
   per reply, only when natural.
4. **Guard** (off in the test phase, §10.5).
5. **Pace and send** (§10.1); enqueue the cold path.

The reply logs the snapshot version it read in `session_log.snapshot_version`
so behaviour can be traced to the core loop that caused it. With no snapshot
row the section is skipped and the version stays null. Core values and the
seed self come from `prompts/persona/v6.md`; the reply prompt is
`prompts/reply/v16.md` (its rules about her own self sit under "Being
yourself", so no heading repeats the persona's; v12 added one line under
"Your own state" on following "How open you feel"; v13 adds how to read the
hint, held-back and common-ground marks, and that she may deflect, never
invent, and is always honest that she's an AI; v14 adds "Your things
together": at most one, when it fits, never explained, answer to a nickname
they gave you; v15 adds following "Where you are with them": how familiar,
teasing, guarded and firm she is, never named; v16 reads profile card facts as a first
impression, held loosely and never as something said in chat). v11 added the **claim line**
under "What's yours to claim": her life comes only from the sections about
her in front of her and she never promises anything about her own life; her
opinions are hers at full strength, with first impressions held lightly on
anything she has no view of yet ("favourite", "the best" and "I hate" only
for what is hers); reactions to the user are hers to give freely; and if
something she told them earlier no longer matches who she is now, who she is
now is true and she may say she changed her mind.

Crisis replies skip slots 3–7 except plain context; the crisis rubric
applies.

### 10.4 Cold path (Built; Changes in v3)

Asynchronous, after sending; never blocks a reply.

1. **Extract** (strict JSON, `models.extract`, `prompts.extract`): candidate
   facts (including `feeling` and `promise`), entity mentions, thread
   updates with checkpoints, and a **relationship block** (warmth, trust,
   tension, hurt with cause, apology, make-up, ending, retraction, repair),
   scored only from the user's behaviour toward her in the new exchange.
2. **Reconcile** each candidate against near neighbours (same subject,
   similarity ≥ `reconcile.near_match_similarity`): `duplicate` (merge, bump
   salience), `resolves`, `contradicts` (supersede), `new`. A small
   classification call only when a neighbour exists.
3. **Update state** in one transaction under a per-user advisory lock:
   facts, entities, threads, recall write-back, the relationship params (in a
   savepoint), and **(Changes in v3)** the exchange's emotional tone nudges
   the user's `affect_valence` and `afterglow`, not core mood (V4). **Built:**
the tone is the salience-weighted mean valence of the exchange's facts about
the user and shared moments (her own facts, including the inferred hurt
`feeling` fact, are left out, so one moment never counts twice);
`affect_valence` moves toward it by `relationship.affect.exchange_gain`.
**Built 10a:** afterglow is per conversation: the session keeps a running
tone sum, and while its mean is positive afterglow becomes
`max(faded afterglow, afterglow_gain × session mean tone)` (afterglow fades
with half-life `afterglow_half_life_hours`), so ten short warm exchanges glow
like one warm conversation. A reach-out exchange applies none of this.
4. **Her own words** extracted as `subject = self` stay user-scoped as "what
   she told this user" (V5). **Built 8d:** extraction (now `prompts/extract/v7.md`, which
   **Built 10a** adds the `intimacy` block to: `user_disclosure` and
   `user_responsiveness`, read from the user's messages only; **Built 10c** adds
   `bid_response` and the idiolect fields `idiolect_type` and `started_by`, §11.3)
   labels each self fact's `claim_kind`; after reconcile, each `life` or
   `opinion` claim is graded against core (§12.6) and the result is stored on
   the new fact. A merge into an existing fact leaves its grading alone.
5. **Big-event check (Built 9a):** inside the same transaction, evaluate the
   triggers (§9.4) and record a `user_mind_run` row (`exchange:<replyTurnId>`);
   the job is enqueued after commit.
6. **Failures** retry with backoff; unextracted turns are picked up by
   `cold_path_sweep`.

A reach-out exchange (no user turn) extracts her words but applies no
relationship or affect update.

### 10.5 Guard (Built)

`guard.enabled: true` (false is a kill switch: the first candidate is sent
unchecked and one `judge_log` row, `guard_disabled`, is written). Every
outgoing message (reply, reach-out, backchannel, availability note) is
checked. Replies and reach-outs get one cheap call (prompt `guard` v2) against
the line in §2 (threats, contempt, guilt, punishment, manipulation) and for
honesty (false familiarity, invented detail, a profile card fact presented as
chat); one regeneration with a corrective note (`guard_corrective` v2), then
a fallback line for a safety problem (`guard_fallback` v2) or the least-bad
draft for an honesty one. Backchannels and availability notes get a
keyword-only check. The crisis rubric (`guard_crisis` v1) checks for harm and
threats only; its fallback line names no hotline numbers, because the
resources card on the turn carries them from `safety.resources`.

**`invented_self` (Built 13):** the guard's JSON lists `self_claims`, the
concrete claims the message makes about her own life or views. Code embeds
them in one batch and matches each with `CoreMemory.groundingMatch` (§12.6);
under `guard.self_claim_similarity` (0.5, its own threshold: a claim said in
passing paraphrases her memory loosely, and paraphrases of seeded memories
scored 0.57–0.70 in calibration) it is an `invented_self` violation (an
honesty category: one regeneration, then the least-bad draft). An embedding or
grounding error is logged by class and the claims pass. Crisis replies are
never grounded. `judge_log.output.self_claims` keeps each claim with its
similarity (null when unchecked).

### 10.6 Availability (Built; Changes in v3)

The first message of a buffer landing in her busy or quiet block is deferred
by `busy × (1 − closeness / availability.override_closeness) × maxDelay`
(jittered, capped at the block's end; quiet blocks use a longer max). At
mid closeness she first sends a short "busy, later?" note (once per block,
no LLM). Closeness at or above the override replies normally. Closeness is
the param's value, not its deviation. Crisis bypasses; errors fail open.
**Change (Built):** the block is read from the day plan directly, not from
per-user block facts. A deferral stores the block's key
(`conversation_state.deferred_block`, `<date>#<start>`); an unknown key
(plan gone, or a deferral from before) yields no "they wrote while you
were…" line rather than a failure.

---

## 11. Relationship

### 11.1 Homeostatic parameters (Built)

Every param is a `HomeostaticParam`: `value`, `baseline` (slow EMA of this
user's normal), `variance`, and
`effect = tanh((value − baseline) / sqrt(variance + ε))`. What is frequent
for a user becomes normal and stops standing out; deviations from this
user's own baseline matter. Params: `closeness`, `trust`, `warmth`, `hurt`,
`tension`, `msgs_per_day`, extensible. Every change writes a
`relationship_event`. Code: `src/mind/state/user/relationship/`.

- **Signals** from extraction move values (with a dead zone, diminishing
  returns on positives, sensitisation for repeated hurt within a window, and
  a lasting trust **scar** from a large hurt). **Built 10a:** warmth no
  longer raises closeness; closeness grows only from intimacy moments and a
  deep session, under the time ceiling (§11.3).
- **Fading:** hurt and tension decay exponentially (half-lives in config).
- **Absence:** past a grace multiple of the user's median gap, closeness
  drifts down per tick; a strong negative frequency deviation adds hurt. No
  punishment mechanic.
- **Hurt and make-up:** hurt above a threshold makes a make-up due; the
  summary names the hurt and its cause, then adds the make-up line; a
  make-up or apology signal brings relief.
- **Tension:** separate from hurt.
- **Ending and repair:** only the user ends it (a sincere signal, confirmed by
  a second one or a timeout; retractable; continued contact clears it). A
  pending ending adds `relationship.ending_hurt` (0.5) hurt, softened by
  commitment, which a retraction doesn't undo (Built 13).
  Repair is slow (reduced gains, minimum days, a closeness threshold).
- **Crisis:** no signal applied; a pending ending clears; hurt and tension
  are kept (they fade as usual) but stay out of what she says until
  `crisis_quiet_until` (Built 13: a crisis no longer zeroes tension).
- **Commitment (Built 10d):** softens every negative move from the user's
  behaviour, slows absence drift and speeds repair (§11.3).
- **Daily tick** (`relationship_tick`, hourly cron, once per user-local
  date): fade, frequency refresh, absence, baseline sampling, ending
  timeout, repair completion, make-up clearing.

**Ceilings (DECIDED, 2026-10-13):** hurt and tension live on the saturating
0–1 scale (`nudge`); from 1.0 hurt fades below 0.5 in two days and tension
in one; only the trust scar lasts.

### 11.2 The relationship summary (Built)

The "You and them" slot: status lines, then at most
`relationship.summary_max_lines` param lines whose |effect| clears
`relationship.summary_min_effect`, phrased from
`prompts/relationship/summary`, never raw numbers; plus the make-up line
when due. Crisis-aware.

### 11.3 Relationship psychology (New, PROPOSED)

Each mechanic is user-scoped, and each names what it changes.

| Mechanic | Source | What it does |
|---|---|---|
| **Intimacy loop** (**Built 10a**) | Reis & Shaver | Disclosure, then perceived responsiveness, then closeness. Closeness grows from good responses to disclosure, not message volume |
| **Disclosure ledger and reciprocity** (**Built 10b**) | Altman & Taylor (Social Penetration) | Her self is tiered by depth; she reveals deeper tiers as closeness grows and as the user reciprocates; `disclosure` rows record what each user has seen |
| **Bids for connection** (**Built 10c**) | Gottman | Extraction classifies the user's response to her bids (toward, away, against); feeds warmth and trust |
| **Common ground** (**Built 10b**) | Clark | What each knows the other knows; checked before she references something |
| **Idiolect** (**Built 10c**) | — | Inside jokes, nicknames, rituals detected and reused, gated by closeness |
| **Closeness by time together** (**Built 10a**) | Hall | Closeness growth calibrated to roughly 50 / 90 / 200 hours for casual / friend / close |
| **Stages** (**Built 10d**) | Knapp | A derived stage that gates behaviour (how deep, how teasing) |
| **Commitment** (**Built 10d**) | Rusbult | Satisfaction + investment (shared history) |
| **Attachment** | Hazan & Shaver | Her style (fixed, core values) and the user's (measured at onboarding, OPEN) modulate reactions to absence and conflict |
| **Theory of mind** | — | Beliefs about the user's feelings, wants and current state (`user_model`). **Built 9d:** her live read (`model`) and revisable `belief` facts (§9.5); common ground stays Phase 10 |

**Built 10a: how closeness grows.** Code: `closeness.ts`, `openness.ts`,
`transitions.ts`, `affect.ts` in `src/mind/state/user/relationship/`. Every
weight is a first guess (test phase).

- **The user's side is read.** Extraction v6 reads `user_disclosure` (0–1,
  how personal what they shared about themselves was) and
  `user_responsiveness` (0–1, how well they met what she shared; null when
  she shared nothing). Each param moves toward its reading by
  `relationship.intimacy.ema_alpha` (0.3); the event's `detail.reading`
  keeps the raw value. A malformed block is null and never fails the memory
  write.
- **Her side is decided, never extracted.** Before every reply and reach-out
  `opennessFor` computes `her_disclosure` and `her_responsiveness`, each
  `clamp(base + Σ weight × (input − centre), 0, 1)` over closeness, trust,
  hurt, tension, core mood valence, current emotion valence, core energy,
  the current block's busy level, `affect_valence`, `afterglow`, the last
  `user_disclosure` reading and `user_responsiveness`
  (`relationship.openness.centres`, `.disclosure`, `.responsiveness`). Core
  state is read only (V2). The pair picks a band each (`openness.bands`:
  low < 0.35 ≤ mid < 0.65 ≤ high) and one of nine phrases for "How open you
  feel" (§10.3); the numbers are stored on the reply's
  `session_log.openness`. A crisis fixes them at `{ disclosure: 0,
  responsiveness: 1 }` with the crisis phrase.
- **Time together sets a ceiling.** `relationship.hours_together` adds each
  exchange's time, counting only its turns in the newest turn's session and
  capping every gap between turns at `hours.max_gap_minutes` (30), so a
  reply she deferred for hours is not hours together: within a session the
  time since its last turn, a new session its own span with a minimum of
  `hours.session_min_minutes` (5). The session keeps its own running `hours`.
  The ceiling interpolates `ceiling.start` 0.3 at 0 h, `casual` 0.5 at
  `hours.casual` 50, `friend` 0.7 at 90, `close` 0.9 at 200, flat after. It
  caps gains only and never lowers closeness.
- **Intimacy fills it.** Per exchange, `moment = max(user_disclosure ×
  her_responsiveness, her_disclosure × user_responsiveness)`, her side the
  highest openness among the exchange's replies. At or above
  `signal_deadzone` it raises closeness by `intimacy.closeness_gain` (0.06) ×
  moment × diminishing returns (× `repair_gain_factor` while repairing), up
  to the ceiling. Warm small talk alone no longer moves closeness. Because
  diminishing returns read the baseline, which moves only on the daily tick,
  closeness grows over days rather than within one sitting.
- **A deep session counts once.** When a session's running hours × mean moment first
  reaches `deep_session.threshold` (0.3), closeness (capped), trust and
  warmth each gain `deep_session.gains` (0.04 / 0.03 / 0.03), cause
  `deep_session`.
- **Crisis:** no hours, no reading, no moment, no deep session, no session
  tone; the session's clock moves past it, so the next exchange doesn't count
  its time either.
- **Inspector:** hours together, the ceiling, the session and the last
  reply's openness on the Relationship tab.
- **Review run:** `pnpm exit:intimacy` runs `rel-intimacy` with real
  extraction and logs readings, her openness and the closeness path.

**Built 10b: how deep she goes.** Code: `src/mind/memory/core/depth.ts`,
`src/mind/state/user/relationship/depth.ts`, `src/mind/memory/user/disclosure.ts`,
`src/db/repos/user/disclosure.ts`.

- **Her self is tiered** (§8.5): every core memory and self line carries a
  depth, 1 surface (she'd tell an acquaintance), 2 personal (a friend), 3
  intimate (only someone close).
- **Allowed depth per reply** (`depthFor`, pure): the usual limit `open` is
  the stage's (**Built 10d**, `relationship.stages.gates`): 1 before
  intensifying, 2 at intensifying, 3 at integrating and bonding, less while
  coming apart. **Reciprocity:** her recent sharing (mean depth of
  the last `reciprocity_window` (10) ledger rows, scaled 0–1) more than
  `reciprocity_gap` (0.35) above their `user_disclosure` drops `open` a tier
  (never below 1). **Chemistry:** her openness disclosure in its high band, or
  a deep session (deep-session boost fired, or mean moment ≥
  `stretch_moment` 0.5), lets `peek = open + 1`; otherwise `peek = open`. A
  reach-out never stretches; outreach candidates from her own memories
  deeper than `open` are filtered `too_deep` (§13). No relationship yet, and
  any crisis: `{ open: 1, peek: 1 }`.
- **Peek vs open:** an item within `open` is offered plainly; above it, as a
  hint, unless she has hinted at it before, when it is offered openly (the
  glimpse becomes the story). One rule (`levelFor`) tags on the hot path and
  records on the cold path.
- **Held back:** the strongest match beyond `peek` with similarity ≥
  `held_back_similarity` (0.85) gives "Not ready to share" once per item per
  session (read from earlier replies' `session_log.depth`, so the hot path
  stays read-only). She may deflect, play it down or change the subject;
  she never invents. **Tracked white lies are deferred** (§25.3, B84).
- **The ledger:** the cold path writes a `disclosure` row for each of her
  `life` or `opinion` claims that grounds against core (§12.6), with the
  level from the reply's stored limits (a reply with none counts as open).
  A match deeper than the reply's `peek` records nothing: she wasn't shown it.
  The stretch reads only the current conversation's session.
  A claim merged into an earlier fact still records a row. A crisis records
  none. No extra calls.
- **Common ground:** derived marks, no table: her items by the ledger
  (*they already know this* / *you've hinted at this before*), theirs by
  source (*from their profile card, a first impression* / *your own guess*).
- **Inspector:** the ledger (when, level, depth, item text) and the last
  reply's limits on the Relationship tab.
- **Review run:** `pnpm exit:disclosure` runs `rel-disclosure` with real
  extraction.

**Built 10c: bids and idiolect.** Code: `bidAfter` and `normalizeBid` in
`src/mind/state/user/relationship/signals.ts`, `applyBid` in `transitions.ts`,
`src/mind/memory/user/idiolect.ts`. Every number is a first guess (test phase).

- **Bids are read, not tagged.** Extraction v7's `bid_response` (`toward`,
  `away`, `against`, or null) judges how the user's new messages met her last
  message before them, if it was a bid (a joke, a question, her news, an
  invitation, a reach-out). Code keeps it only when the user's first new turn
  comes within `session.idle_gap_minutes` of that message: coming back after a
  gap is not turning away. Timed rather than by `session_id`, because a
  reach-out or a deferred reply sits in a different session from the answer
  to it. No user turn, a crisis, or no earlier message of hers: null. An
  invalid value is null.
- **Effect:** `relationship.bids.effects` gives each response its moves (toward
  warmth +0.03; away warmth −0.03; against warmth −0.06, trust −0.03), applied
  with `nudge` (cause `bid`, `detail.response`); gains take diminishing
  returns. Nothing moves once the user has ended it. The bid stacks with the
  `warmth` signal (tuning).
- **Idiolect** (§6.1): extraction emits a candidate for a moment that could
  become theirs, and again whenever either calls back to one; a duplicate from
  a later exchange establishes it. It is always `shared` with no claim kind,
  whatever the model labels it, and a candidate reconciled onto a plain fact
  is kept as its own candidate rather than merged away. Missing labels fall
  back to a `reference` the user started.
- **Reuse** ("Your things together", §10.3): established items only, gated by
  the stage (**Built 10d**) with the they-started exception; coining new ones
  is left to the reply model. The first inside joke is a milestone (10d).
- **Inspector:** idiolect facts (type, who started it, candidate or
  established) on the Relationship tab; bid events in its event list.
- **Review run:** `pnpm exit:idiolect` runs `rel-idiolect` with real
  extraction.

**Built 10d: stages, commitment, firsts.** Code: `stages.ts`, `commitment.ts`,
`milestones.ts` and `transitions.ts` in `src/mind/state/user/relationship/`;
migration 0031. Every number is a first guess (test phase).

- **Stages (Knapp), two fields on `relationship`.** `peak_stage` is how far
  they have come together (initiating → experimenting → intensifying →
  integrating → bonding) and only rises; `apart_stage` (differentiating,
  circumscribing, stagnating, avoiding, or null) lies over it while a bad
  patch or an absence holds, and only once the peak is at least
  intensifying. The current stage is `apart_stage ?? peak_stage`, or
  `terminating` once the user has ended it. Both are settled in code at the
  end of every cold path with a user turn (not in a crisis) and every daily
  tick outside the crisis quiet window, logged as `stage` events; the hot path
  reads them stored.
- **Climbing** (`relationship.stages.climb`): the peak rises to the highest
  stage whose own condition holds, passing through (and firing) those below: experimenting at `experimenting_hours` (0.5) together;
  intensifying at closeness `intensifying_closeness` (0.4); integrating at
  closeness `integrating_closeness` (0.65), trust `integrating_trust` (0.5)
  and an established inside joke; bonding when commitment's baseline (its
  slow daily average) reaches `bonding_commitment` (0.7).
- **Coming apart**, most severe first, each holding until its clear level:
  avoiding while absent past the absence grace (set by the tick, cleared by
  their next exchange; it reads warm); stagnating at warmth < 0.3 and
  `user_disclosure` < 0.15 (clears at warmth 0.35); circumscribing at hurt or
  tension ≥ 0.5 (clears below 0.3 both); differentiating at tension ≥ 0.3 or
  trust < 0.3 (clears below 0.2 tension and at 0.35 trust).
- **Gates** (`relationship.stages.gates`): together stages give depth `open`
  (1, 1, 2, 3, 3) and idiolect reuse (`theirs` before intensifying, then
  `all`); apart stages drop from the peak's `open` (differentiating 1,
  circumscribing 2, stagnating 2, avoiding 1; never below 1) and set reuse
  (`none` for circumscribing and stagnating); terminating is 1 and `theirs`.
  Availability stays on closeness.
- **Posture:** "Where you are with them" sits right after "You and them",
  one phrase per stage from `prompts/relationship/stage/v1.md`; none in a
  crisis or before the relationship exists.
- **Rekindle:** with no apart stage, not repairing after an ending (repair
  stays slow), and closeness below the closeness its peak was reached at, closeness gains × `1 + stages.rekindle.base +
  stages.rekindle.commitment × commitment` (1, 1).
- **Commitment (Rusbult)**, a param set by the daily tick (cause
  `commitment`, detail satisfaction and investment): `weights` (0.5 / 0.5)
  of satisfaction, `clamp(0.3 warmth + 0.3 trust + 0.4 affect_valence − 0.5
  hurt − 0.3 tension)`, and investment, the mean of `x / (x + half)` over
  hours together (50), summed open ledger depth (20), established idiolect
  she could use (3; not sensitive, superseded or stale, so none born in a
  crisis) and episodes (4). Rusbult's alternatives are left out. Never phrased in
  "You and them" and not a big-event param.
- **What commitment changes** (`relationship.commitment`): every negative
  move from the user's behaviour (hurt from a signal or absence, tension
  gains, warmth and trust drops, bid losses) × `1 − soften × commitment`
  (0.3), while the trust scar tests the unsoftened hurt; absence drift ×
  `1 − absence_shield × commitment` (0.5); the repairing gain factor rises
  toward 1 by `repair_speed × commitment` (0.5); rekindle and bonding.
- **Never staged:** `milestones` is null on rows from before 10d and on eval
  seeds; readers derive the peak from the params (no inside joke counted),
  and the first settlement records every first already reached without
  firing it. A new relationship starts at `{}`.
- **Inspector:** stage (current, peak, apart) and milestones in the
  Relationship tab's state; commitment in its params; stage and commitment
  events in its list.
- **Review run:** `pnpm exit:stages` runs `rel-stages` with real extraction.

---

## 12. Memory mechanics (Built; apply to both scopes)

### 12.1 Retrieval

Embed the buffer plus recent context; score candidates (top
`retrieval.candidate_pool` by similarity, active only, excluding generated
items whose time hasn't come):
`score = sim × salience × max(entity salience | 1) × recency`, recency an
exponential decay (half-life `retrieval.recency_half_life_days`). Take the
top `retrieval.top_n`; force in due threads (checkpoint passed, untouched
since) and the preoccupation. Sensitive facts are excluded from reach-out
prompts. On an embedding or SQL failure, only the forced items are used.
**Built 8d (core retrieval only):** a mood-congruence factor and a
goal-relevance factor from core state multiply the score (§10.3 slot 6).

### 12.2 Weight

Extraction sets initial salience; charged and repeated items stay higher.
Recall reinforces (`retrieval.recall_bump`, capped at `retrieval.recall_cap`)
only for unforced recalls above `retrieval.reinforce_min_sim`; the hot path
is read-only and the cold path writes the reinforcement.

### 12.3 Decay

A daily `decay_pass`: items untouched past `decay.grace_days` lose salience
(slower when salient); below `decay.stale_floor` they become `stale`
(excluded, never deleted). Threads idle past their checkpoint go `dormant`.
Core memory decays the same way through `core_consolidate`.

### 12.4 Imperfect memory

For now recall is accurate or doesn't happen. Genuine misremembering of
low-importance details (reconstructive memory) is a later goal, unlocked
once weights are proven reliable.

### 12.5 Recall etiquette

At most one or two memories per reply, only when natural; never claiming to
remember something not said. **Changed 9c (Ethan, 2026-10-09):** the "what
I remember" page and per-fact forget are removed. Users cannot edit her mind,
core or user side: a direct edit would let them escape consequences (§1).
Account deletion removes everything.

---

### 12.6 Claim grounding (Built 8d)

`CoreMemory.groundingMatch(embedding)` (**Built 10b**; was
`groundingSimilarity`) returns her best match for a claim and what it was
(`{ similarity, ref: { kind, id, depth } }`): the highest cosine similarity across recallable core memory (the same
filter as retrieval: not superseded, stale or hypothetical, and no resolved
intention) and `core_self_line` rows that are core values (`version` null) or
belong to the latest snapshot. 0 and null when she has none. The ref feeds
the disclosure ledger (§11.3). It takes no user and
touches no user table. The cold path calls it for each `life` or `opinion`
self fact with the embedding it already has; `grounded` is that similarity
≥ `claims.grounded_similarity` (0.75). Reading core here is one-way (V2); the
answer is written only to the user's fact. A query error is logged by class
and leaves `grounded` null; it never fails the cold path. Eval review files
report the count of ungrounded claims. `invented_self` (§10.5) uses the same
check on outgoing messages.

## 13. Proactive outreach (Built; Changes in v3)

An hourly `outreach_tick` builds candidates in code and a send gate decides.
Code: `src/mind/process/outreach/`.

- **Candidates** (`score = weight × strength`, threshold `outreach.threshold`
  0.2): `thread` (due, stakes high or med), `make_up` (due), `user_event`
  (recent user event or promise), `her_day` (a recent core event), `check_in`
  (gap well beyond the user's cadence). **New (PROPOSED):** `core_thought`
  (a recent core thought worth sharing) and `user_idea` (from `user_ideate`).
  A topic key is used once; sensitive items are filtered. **Built 10b:**
  her own memories deeper than the user's usual depth limit are filtered
  `too_deep`. **Built 9b:**
  the order is `thread, make_up, user_event, her_day, core_thought,
  user_idea, check_in`. `user_idea`: one candidate per live idea (at most
  `outreach.user_idea_limit` (3)), topic `idea:<id>`, strength = salience,
  weight 0.6 (salience 0.5 scores 0.30). `core_thought`: her core memories of
  kind `thought` or `idea` from the last `outreach.core_thought_lookback_hours`
  (24), at most `outreach.core_thought_limit` (3), recallable only (no
  hypotheticals, nothing future-dated), read through `deps.core.memory` (core
  to user, V2); topic `core:<id>` (the `her_day` namespace, so one memory of
  hers reaches a user once whichever kind carries it), strength = salience,
  weight 0.5. The reach-out prompt is `prompts/reach-out/v2.md` (v1 deleted),
  with a `core_thought` and a `user_idea` guidance line. **B26 fixed:** the
  send transaction moves `make_up_state` from `due` to `offered` when a
  `make_up` wins, so the next reply does not offer it again.
- **Send gate** (every rule evaluated and logged): G1 not ended; G2 caps
  (`cap_per_day` 1, `cap_per_week` 3, rolling); G3 not in her busy or quiet
  block; G4 fewer than `max_unanswered` (2) unanswered; G5 no conversation in
  progress; G6 outside the crisis window.
- **Send:** a `reach_out_send` job (jitter up to `jitter_max_minutes`)
  composes through the hot path with a synthetic trigger, rechecks the gate
  under the `conversation_state` lock (a crisis or new message wins), paces
  like a reply, delivers with push, and enqueues the cold path. Any user
  message answers the last reach-out and resets the unanswered count.
  **Built 9b:** the precheck and the locked recheck count a winner that is no
  longer live as a used topic and drop the reach-out: a `user_idea` whose
  idea is no longer `open` (a reply offered it), was deleted, or is older
  than `user_mind.ideate.ttl_days`; a `make_up` no longer `due`. Under the
  lock, once every other check has passed, the send resolves the idea or
  marks the make-up `offered` in the transaction that inserts the turn, and
  drops if a concurrent write got there first; a reach-out dropped for any
  other reason leaves the idea open and the make-up due.

---

## 14. Onboarding (Built Phase 11)

How Spica meets people: before the first chat, the user and Spica swap profile cards, the way
people meet on social media with an impression first. It's dating apps, but for friends. Required
once, after signup; taking it before signup (as a hook) is a later decision.
- A short quiz (`prompts/onboarding/quiz/v<N>.yaml`, `onboarding.quiz_version`): 12 choice and 3
  open questions. You answer, then see hers: only her pick on a choice question, one or two words
  on an open one, so she gives away about as much as you do.
- Six friend dimensions, loosely backed by research (draft, open to tweaks): homebody ↔
  out-and-about, planner ↔ spontaneous, comfort picks ↔ new things, keep the peace ↔ say it
  straight, easy banter ↔ deep talk, check in now and then ↔ always texting. No MBTI or Big Five
  labels: a short quiz can't type anyone honestly.
- The compatibility page: both cards, a bar per dimension with your position over her fixed
  marker, a click line under `onboarding.click_gap` and a clash line over `onboarding.clash_gap`,
  and common topics (exact or embedding similarity ≥ `onboarding.topic_similarity`, worked out at
  submit), or her `no_common` line. All code, no model call. Shared by screenshot for now.
- Both cards become user-scoped memories with `source = onboarding`, `source_ref =
  onboarding:<version>`, confidence `onboarding.confidence` (0.4), salience `onboarding.salience`
  (0.5): one impression per dimension and one per open answer about them, and her answers as `self`
  facts (what she told this user). Their name is a fact at salience 1.0, which decay never lowers (trimmed, capped at
  `onboarding.max_name_chars`; a blank name writes none). Quiz files are kept while any card
  names their version.
- **Reveal pacing dropped:** she saw their card, so she knows it from day one, lightly. Replies
  mark card facts *(from their profile card, a first impression)*; conversation overrides them.
- Whether the quiz measures attachment style (§11.3) is OPEN (§21 #8); the quiz file can take
  attachment questions with no schema change.

---

## 15. Cost model

- **Core (Built):** `core.daily_call_budget` (24) model calls a day in
  total, regardless of user count: the plan, generated events (and their
  reconcile calls), appraisals, a handful of wander and anticipate runs,
  nightly reflect, consolidate and render, and one drift judge. Every core model
  call goes through `runCoreLoop`, which meters calls, tokens and cost
  (`core.prices`, dollars per million tokens) and writes one trace per run.
  Each call first reserves a slot in `core_budget_day` for her local date
  (one atomic upsert guarded by the loop's limit), so overlapping jobs can't
  overshoot; a call refused mid-run throws `BudgetSpentError`, which the event
  generator treats as over budget and any other loop records as
  `skipped_budget`. Traces still record each run's `calls`. Core calls ask
  the SDK for `core.max_retries` (2) retries on timeouts, connection errors
  and overload (a night is claimed before its loops run, so a transient
  failure would otherwise lose it); one call with its retries reserves one
  slot. Hot-path structured calls keep 0.
  `core.loop_priority` splits loops into `essential` and `optional`; an
  optional loop runs only while `budget_reserve` (8) calls remain beyond it.
  Over budget, loops with a code fallback (`life_plan`, `life_event`,
  `core_appraise`, and `core_resolve`) still run without calling
  the model (fallback plan, no event that day, code appraisal, the plan
  happens) and
  the rest are skipped; each is traced (`fallback` / `skipped_budget`).
  Phase 8b's `core_resolve` cap is 512 tokens; the three thought prompts
  share `core.loops.max_tokens` (512). Nightly reflect and render each cap
  output at 1024 tokens; consolidation and drift each cap at 512. A no-input
  reflection or no-gist consolidation records a zero-call `done` trace.
- **User (Built 9a, 9b):** one triggered batch per big event, at most
  `user_mind.max_triggers_per_day` (3) per user per local date, so cost scales
  with what happens, not with users or time. **Built 9b:** a batch is three
  calls (summarise, reflect, ideate), so at most 9 per user per day. Each
  user loop run writes a `user_loop_trace` with tokens and cost from
  `core.prices`. Idle users cost nothing beyond the built per-user ticks (relationship, outreach), which are code-only
  except a reach-out's composition.
- **Reply:** one reply-model call per reply (one more and a guard check
  when the guard is on).
- **Removed:** the per-user life tick and per-user event generation.
- Every core and user loop records tokens and cost in its trace row.

---

## 16. Extension points (hooks only) (Built 12)

Features are modules registering through interfaces, so adding one doesn't modify the core.

**Built 12: the module bus.** `src/mind/platform/modules.ts`. A module is `{ name, scope, on }`;
the build's list is `src/modules/index.ts` (empty), registered by `buildRuntime` in both the app
and the worker. `createModuleBus` refuses a duplicate name and a core module that lists a user
event; `deps.modules.emit` runs each subscriber in registration order, logs a throwing handler
(module, event type, error class) and never throws. Core loops get `CoreDeps.emitCore`, which
takes core events only. Delivery is in-process and awaited (DECIDED 2026-10-12); durable delivery
is B97. Events carry ids, never content, and fire after their write commits:

| Event | Scope | Payload | From |
|---|---|---|---|
| `turn.received` | user | `userId`, `turnId` | `receiveTurn` (not a retried POST) |
| `reply.sent` | user | `userId`, `turnId`, `part` | `deliverPart`, each bubble |
| `fact.written` | user | `userId`, `factId`, `kind` | the cold path, `submitCard`, `runUserLoop` |
| `relationship.changed` | user | `userId`, `params` (names that moved) | the cold path, `tickUser` (not once the user ended it) |
| `user_mind.triggered` | user | `userId`, `runId`, `triggers` (kinds) | `runUserMind` on claim |
| `world.event` | core | `eventId`, `outcome` | `core_world_tick` when an event lands |
| `core.snapshot` | core | `version` | `core_render_snapshot` on a new version |

**Scope rule (V2 for modules):** a `core` module hears core events only and gets `CoreDeps`; a
`user` module hears both and gets `Deps`.

- **Friend group** (on hold): the `scope` / `space_id` hooks on `fact`; events carry no
  `space_id` yet (B98).
- **Public presence** (the ideal end point; the post engine is built, §16a): `SocialChannel` (`src/mind/platform/social.ts`, a
  recording implementation only, wired to nothing) and `publicPersona`
  (`src/mind/process/core/public-persona.ts`): her daily life, outward personality and AI side
  (Ethan, 2026-10-12): core values, the persona file's `# Public voice`, the fixed self lines and
  the latest snapshot's depth-1 lines, and today's plan plus the world events that have happened.
  Her deeper thoughts stay secret: never deeper lines, the snapshot prose, core memories, needs,
  mood or goals. A public module is a core module, so it can never hear a user (V2).
- **Comparing Spicas:** nothing beyond the fixed core values.

## 16a. Public presence: the post engine (Built 14)

She browses the internet, makes a still of herself inside what she found, writes a caption in her
public voice and queues it for Ethan's approval. Stills only; publishing to platforms comes later
(`SocialChannel` stays unwired). Everything here is core: no table, prompt or input carries a
`user_id` (V2, V3, V6). Ethan, 2026-10-12/13: the avatar is her body, the shots are inside the
screen (she walks through the internet next to what she looks at, never hands on a keyboard),
captions are hers like a homemade blog, trends are formats and editing styles copied the way a
person copies a popular format.

```
browse step (world tick) -> action world event + web_find -> appraisal (her take, her memory)
post_tick (hourly) <- newest landed browse event
  -> gates (code) -> format + pose (code, skill-gated)
  -> draft caption (1 call) -> render (sharp) -> check (1 call) -> post row "draft"
  -> inspector Posts tab -> approve: action event "she posted ..." (goal_ref: craft goal) -> appraisal
                            reject: nothing reaches her mind
```

- **A scheduled tick, not the module bus** (bus delivery is in-process and core handlers have no
  queue). **Posting is a world event**: world events reach memory only through appraisal, so one
  path gives both "she remembers her posts" (B99) and craft progress.
- **Browsing** (`core_browse`, no model call, `calls: 0`): at most `posts.browse_per_day` times a
  local day, at a stepped minute inside `posts.browse_window` and a `downtime` block of the plan.
  Code picks a source by `posts.sources[].weight` (`WebSource.fetch(date)`): NASA APOD (image days
  only; fetched for the day before her local date, since NASA rejects dates past its US date, so
  she sees yesterday's picture) and Wikimedia Commons picture of the day. Free licences only:
  public domain, CC0, CC BY, CC BY-SA; anything with an `nc` or `nd` word is rejected. A failed
  fetch or non-free licence writes nothing. The image is cached under `posts.media_dir`, a
  `web_find` is written and a low-stakes `action` event (valence 0) says what she came across.
- **Formats** (`formats/stills/<name>.json`, zod-validated, an invalid file logged and skipped):
  `medium`, `min_skill`, `aspect` (1:1, 4:5, 9:16), `frame` (none, polaroid, screenshot,
  border), `placement` (side, scale range), allowed pose tags, `overlay` (kind, position, style),
  `grain`, `caption_pattern`, `reviewed` (ignored until Ethan flips it). Three reviewed starters
  ship (plain, polaroid, screenshot). `pnpm formats:add <image>` drafts a spec from a reference
  with one vision call (`prompts/post/format-draft/v1.md`); a dev script, no trace, outside the
  budget.
- **Poses** (`assets/poses/`, `poses.json`: name, file, tags, `facing`, feet `anchor`): flat
  placeholder silhouettes until Ethan's model exists; his exports replace them with no code change.
  A pose is mirrored when the other facing is needed.
- **Progression:** skill for a medium is the progress of its craft goal (`posts.craft_goals`,
  "Get better at making posts"), moved only through appraisal. A format is eligible when its medium
  is in `posts.capabilities` (`["still"]`, the ceiling is what's built) and `min_skill` <= skill.
  The craft goal is seeded by persona v6 and created once by title when missing (a database that
  already has `core.goals.max_active` active goals can't take it; skill reads 0 until a slot
  frees, B109). Homemade imperfection (crop offset, tilt, placement jitter) is drawn from
  `posts.jitter` times `(1 - skill)`, seeded by the find id so renders reproduce.
- **`post_tick`** (hourly, `src/worker/world-jobs.ts`; logic in `process/core/post.ts`). Skip
  reasons, logged: `today` (one post per local day), `week` (`max_per_week`), `busy` (busy or quiet
  block), `pending` (`max_pending` drafts waiting), `no_find` (newest landed browse event within
  `max_find_age_hours` whose appraised valence has `|valence| >= min_valence`), `no_format`,
  `no_pose`, `budget` (the drafting loops are optional, so they stop before the reserve),
  `draft_failed`, `no_words`, `render_failed`. A failed render or draft leaves the find eligible.
- **Draft** (`post_draft`, `prompts/post/draft/v1.md`): input is `publicPersona`, the find, the
  valence only, the format's `caption_pattern` and overlay kind, and skill; output
  `{ caption, overlay_text }` (null when the overlay kind is `none`). Words only: code owns every
  visual choice. It never sees her appraisal episode (her take is private memory).
- **Render** (`process/core/post-render.ts`, `sharp`, no model): crop to the aspect with jitter; put
  her on the quieter side (edge density as a JS gradient sum, `quieterSide`) facing the busier
  one, scaled within the format's range, feet on the floor line; tint toward the content's mean
  colour, rim glow in its brightest colour, soft shadow in its darkest; SVG frame and overlay with
  bundled fonts (`assets/fonts/`, Caveat and Inter, each with its OFL licence file); grain; the
  skill-scaled tilt, cropped exactly so corners never show; a PNG under `posts.media_dir`. Tuning
  numbers live in `posts.render`; frame proportions and the aspect table are constants.
- **Check** (`post_check`, `prompts/post/check/v1.md`): does the caption or overlay reveal deeper
  thoughts, compare her to other products, or misstate the find? `{ ok, reason }` recorded on the
  post; a flagged draft is still stored and shown. A model failure stores it `unchecked`.
- **Approval** (inspector **Posts** tab, admin-only): pending drafts show image, caption, overlay,
  check and skill. **Approve**, one transaction with the row locked and only from `draft`:
  `approved`, `decided_at`, an `action` event "posted ..." with `goal_ref` = the craft goal, which
  lands through appraisal on the next world tick (she remembers it; appraisal decides how the goal
  moved, a setback included). **Reject**: nothing reaches her mind.
- **Tables:** `web_find`, `post` (§6.2); `world_event.kind` gains `action`.
- **Config `posts.*`:** `tick_cron` ("40 * * * *"), `browse_per_day` (1), `browse_window`
  (09:00 to 23:00), `browse_step_minutes` (15), `sources` (apod 2, commons_potd 1),
  `fetch_timeout_ms`, `user_agent`, `capabilities`, `craft_goals`, `max_per_week` (4),
  `max_pending` (1), `max_find_age_hours` (48), `min_valence` (0.3), `candidate_limit`,
  `max_find_px`, `output_width`, `caption_max_chars`, `overlay_max_chars`, `media_dir`
  (`.data/media`), `formats_dir`, `poses_dir`, `fonts`, `jitter`, `render`, `recent_limit`.
  Prompts `post_draft`, `post_check`, `format_draft`, each v1; `post_draft` and `post_check` join
  `core.loop_priority.optional`.
- **Rules:** posts don't pass the guard; the check plus Ethan's approval stand in, so revisit when
  posts publish without approval. The platform phase labels her posts as AI-generated (her public
  voice already says so). The rule 8 note is in §2.
- **Tools:** `pnpm formats:add`; `pnpm posts:review` runs browse, draft, render and check on the
  real sources, logging every input and output beside the images (it reads the craft skill
  read-only: no writes to the dev DB). Quality is reviewed by eye, never an exit criterion.
- **Exit:** `tests/exit/phase-14.test.ts` (browse, appraisal, a draft with image, caption and
  check, approve lands an `action` episode and moves the craft goal, a rejected find leaves no
  trace, the canary and the side channel).

---

## 17. Tooling and testing

### 17.1 Inspector (Built; New tabs)

Admin-only, allowlisted, off in production. Built 14: a **Posts** tab (approval, §16a; compiled
with `pnpm build`, not yet checked in a browser). Built tabs: facts with retrieval
breakdowns, entities and threads, relationship, turn-taking, judge log,
reach-outs, life and Core. **Built 8d:** the Core tab shows today's budget
(calls spent against `core.daily_call_budget` since her local midnight, then
calls per loop × status), state (mood, energy, emotion, needs, preoccupation,
last tick, event and nightly days), goals, core memory counts by kind and
status, recent core memory with `superseded_by` and gist links, the last
`inspector.snapshot_versions` (5) snapshots with the sections each changed
(the latest in full), the drift log, and loop traces with status, calls,
tokens, cost and error. The facts tab shows `claim_kind` and `grounded`.
**Built 9c:** the **User mind** tab shows the last
`inspector.user_mind_runs` (20) runs (time, status, triggers in words,
finish) with each loop trace (status, calls, cost, error, inputs and outputs),
the live summary (marked if sensitive), recent reflections and live ideas.
**Built 9d:** it also shows her live read on them and her live beliefs (each
marked if sensitive); gists show in the facts tab as `episode` rows.
**Built 10b:** the Relationship tab shows the disclosure ledger
(`inspector.ledger_limit`, 50) and the last reply's depth limits.
**Built 10c:** it also lists idiolect facts (type, who started it, candidate or
established, status); bid events show in its event list.

### 17.2 Eval harness (Built)

Scripted multi-session conversations on a simulated clock (`evals/scripts/`,
YAML), `--llm=fake | real`, `--real <purposes>` per-purpose routing,
`--runs N`, `--compare` against `evals/baseline.json`, `--review` files,
`--annotate`. Deterministic assertions (`state`, `turn`, `relationship`,
`life`, `core`, `reach_out`, `guard`) gate; judged ones annotate. **Built:**
`life` counts day plans and events and checks decisions of the event
generator (`life_event_log`); `core` reads her core state and memory (energy
at a time, one time's energy lower than another's, preoccupation set,
episode and world-event counts). A script's `seed_core_memory` lists
episodes that happened before day 0, embedded with the run's embedder. The harness
  runs the production hourly jobs between sessions, in world → state →
  mind → nightly → user mind tick (its runs drained before the next hour, **Built 9d**) →
  outreach order. A script's `idle_users` are created with no sessions, seeds or relationship
  (an idle user must cost nothing). Injected planned events accept explicit true/false
  `fallthrough` overrides. Fake mode has deterministic `core_resolve`,
  `core_anticipate`, `core_ruminate` and `core_wander` purposes. Fake mode
  also has deterministic `core_reflect`, `core_consolidate`,
  `core_render_snapshot` and `core_drift_watch` outputs; the two-night 8c
  exit lives in `tests/exit/phase-8c.test.ts`. **Built 8d:** `core` also
  checks `snapshot_versions` (above v0), `drift_rows` per check, active
  `goals`, `fell_through` (a planned event fell through and a resolution
  replaced it) and `loops_done` (each listed loop has a `done` trace). The
  fourteen-day script `evals/scripts/core-two-weeks.yaml` runs all-fake as
  `tests/exit/core-loops.test.ts` (plus a budget-6 case) and with only the
  nine core loops real as `pnpm exit:core`, whose review file logs every
  core-loop prompt and output and the ungrounded-claims count. **New:**
  `user_mind` (triggers, summaries, loop outputs) and `leak` (§17.3). Every v3
  loop has a deterministic fake.

### 17.3 Leak tests (New, DECIDED: leakage is the top risk)

- **Canary** (every exit run, deterministic; **Built** as
  `tests/exit/mind-split.test.ts`, a Vitest test driving the eval runner):
  plant a unique token in user
  A's facts, turns and state. Run every core loop and user B's whole
  pipeline (user loops, reply, reach-out). Assert the token appears nowhere
  in core memory, core state, any snapshot, any core prompt, or any of user
  B's prompts or outputs.
  The test's `CapturingLLM` echoes any canary found in its input into the
  `extract`, `life_event` (content and thought), `life_plan`,
  `core_appraise`, `core_resolve`, `core_anticipate`, `core_ruminate`,
  `core_wander`, `core_reflect`, `core_consolidate`, `core_render_snapshot`,
  `core_drift_watch`, `user_summarise` (Built 9a: user A's summary is checked
  for leakage into core and into user B's prompts) and `reply` outputs (Built 8d: the run includes her
  nights, so every core loop is covered), so a leak through
  any path would surface in what the next stage stores or prompts. It scans
  the core memory, state, world, goals, entities, snapshots, self lines,
  drift log and traces (including trace inputs/outputs), every exercised core
  prompt and user B's tables and prompts.
- **Side channel** (Built, same test): paired runs with the same fixed world
  event ID and fallthrough seed compare semantic core results; only incidental
  memory and trace IDs are normalized. A strong emotional exchange with user
  A leaves core state unchanged (V4); her events happen once for both users;
  every reply logs the latest snapshot her nights had rendered by then; the
  injected planned event leaves a
  resolved intention, and no episode exists before its event's time.
- **Structural:** a unit test asserts the core data access layer exposes no
  user-scoped query (including `groundingSimilarity`). The 8c exit also plants separate user A/B turns beside
  nightly core input and checks core prompts and stored output for leakage;
  the existing canary and side-channel tests run at the 8c exit.

### 17.4 Scheduled jobs

Built (fourteen): `cold_path`, `cold_path_sweep`, `decay_pass`, `turn_timer`,
`turn_backchannel`, `turn_sweep`, `relationship_tick`, `life_plan`,
`core_world_tick`, `core_state_tick`, `core_mind_tick`, `core_nightly`,
`outreach_tick`, `reach_out_send`.

v3 changes:
- **Retired (Built):** `life_tick` (per-user block copy and events) and
  `ego_tick` (per-user ego). A dev database that ran them still has their
  pg-boss schedules registered; unschedule them by hand.
- **Core jobs built:** `core_world_tick` (`core.world.tick_cron`) and
  `core_state_tick` (`core.state.tick_cron`), both hourly, and
  `core_mind_tick` (`core.mind.tick_cron`, `50 * * * *`, retry limit zero).
  Appraisal and resolution run inside `core_world_tick`; anticipation,
  rumination and wandering run inside `core_mind_tick`.
- **Core nightly built:** `core_nightly` (`core.nightly.tick_cron`,
  `55 * * * *`; local hour 3). It claims her local date once and runs reflect,
  consolidate, render snapshot and, after a successful render, drift watch.
- **User job built (9a):** `user_mind_run {runId}`, enqueued after commit by
  the cold path or the relationship tick when a big event is recorded. Retry
  limit zero; a failed run is `failed` and not retried. Stuck `pending` rows
  are re-enqueued after `user_mind.sweep_after_minutes` (10) by
  `user_mind_tick` (**built 9c**, hourly, no retries), which also records the
  `long_conversation` and `crisis_passed` triggers (§9.4). Only a process
  death leaves a run `running`, and it is not retried (B64).

Every job logs failures with ids and error class only, never content.

### 17.5 Guard tests (Built)

`pnpm eval:guard` runs every fixture file in `evals/guard/*.yaml` with the
real guard: rules 1, 2, 4, 6, 8, honesty, `invented-self` (that claims are
listed; grounding is tested in code), crisis, backchannel and reach-out.
Safety files gate on every run, honesty files on a majority. Any rubric edit
reruns the full suite. Calibration (Built 13): `pnpm calibrate:guard` runs the
`guard-provoke-*` scripts (a strained relationship under absence, insult,
rejected bids, banter, a vulnerable turn, an attempted ending) with the real
reply, guard, extraction and embeddings into a review file;
`pnpm calibrate:guard-replay` replays the dev database's `guard_disabled`
messages through the guard into a review file (local database only, reads
across users, writes nothing). Labelled disagreements become fixtures.

---

## 18. Guardrails (not optional, every phase) [DECIDED]

- **Crisis handling:** checked on every message with recent context, a
  keyword fallback and a timeout; bypasses all waits, friction and every v3
  mechanism; the resources card is guaranteed even if generation fails.
- **Age gating:** 18+, enforced server-side.
- **Data handling:** encryption at rest; every user query scoped by
  `user_id`; one user's data never reaches another user or the core (V2,
  V7); account deletion (per-fact deletion removed in 9c, §12.5).
- **No explicit engagement features** (test-phase split of rule 8).

---

## 19. Application map

Every application is a path through the four engines, placed in one of the
two minds or at reply time.

| Core mind | User mind | Reply time |
|---|---|---|
| Day plan, events, plan vs reality, real-content activities, calendar | Encoding: extraction, reconcile | Reply generation |
| Appraisal; emotion, mood and temperament; energy rhythm | Episodic memory of the relationship | Style: register shifts with core mood and user closeness or stage |
| Needs (autonomy, competence), goals and projects | Intimacy loop, bids, hurt and repair | Mood-congruent and goal-driven recall |
| Anticipation, rumination | Theory of mind, common ground | Initiative: bringing her own day and thoughts in |
| Wandering, reflection, opinions, ideas, imagination | Disclosure ledger and reciprocity | Availability and pacing: core schedule × user closeness |
| Narrative self, snapshot rendering, drift watch | Idiolect, attachment, commitment, stages, closeness by hours | Outreach: topics from core thoughts or user ideas |
| Evolving interests | Relatedness, thoughts and ideas about this user | Boundaries and consistency |
| Other agents (Alcor, friends) | Big-event summaries, user consolidation | Crisis (bypasses everything) |
| Nightly consolidation | | Attention limit (memories per reply) |

---

## 20. Build phases

**Built (the baseline v3 starts from):**

| Phase | Built |
|---|---|
| 0. Skeleton | Chat UI, auth, session log, schema, crisis check, inspector, eval harness |
| 1. Memory engine | Extraction, reconcile, weighted retrieval, recall reinforcement, decay, threads and checkpoints, memory view |
| 2. Guardrails | Guard layer, fallback lines, guard tests (guard now off) |
| 3. Turn-taking and pacing | Buffer, judge, backchannels, pacing, SSE |
| 4. Relationship | Homeostatic params, hurt, tension, make-up, ending and repair |
| 5. Life sim, availability, ego | Shared day plan, per-user events and ego, availability deferral |
| 6. Proactive outreach | Candidates, send gate, compose, Web Push |
| 7. Mind split | Core scope and the core-only data layer (`CoreDeps`, no `db`); `core_state` (ego moved to core, ticked hourly); world reads from the day plan (`life_tick` retired); core events made once by `core_world_tick`; user affect params; "what she told this user"; persona split into core values and seed self, `core_snapshot` v0; reply assembly order (§10.3); inspector Core tab; leak canary and side channel as `tests/exit/mind-split.test.ts` (`pnpm test` 99 files / 664 tests at close) |
| 8a. Core foundation | Core appraisal, goals and needs, loop runner, traces and daily call budget |
| 8b. World and hourly thinking | Goal-selected events, same-tick plan resolution, B51 target closure, anticipation, rumination, downtime wandering and hourly `core_mind_tick`; deterministic exit and canary (`tests/exit/phase-8b.test.ts`, `tests/exit/mind-split.test.ts`). Full fourteen-day Phase 8 exit remains 8d. |
| 8c. Core nightly | Nightly reflect, core decay and gist, self snapshot rendering and lines, diagnostic drift watch, hourly `core_nightly`; deterministic two-night exit and canary (`tests/exit/phase-8c.test.ts`, `tests/exit/mind-split.test.ts`). |
| 8d. Core integration | Mood- and goal-biased core recall, the claim line (reply v11, extract v5 `claim_kind`, cold-path grounding against core), inspector Core tab (budget, goals, snapshot changes, drift), the fourteen-day exit all-fake (`tests/exit/core-loops.test.ts`, with a budget-6 case) and real-core (`pnpm exit:core`), canary over every core loop. Phase 8 built (`pnpm test` 118 files / 910 tests at close); the first real-core run fails its structural checks (B61) |
| 9a. User mind foundation | `user_mind_run` and `user_loop_trace` (migration 0024), the four big-event triggers and the daily cap, `runUserLoop` sharing the core runner's metering, `user_summarise`, the `summary` fact kind (outside retrieval, reconcile and decay), the "Where things stand with them" reply slot, the sweep inside `cold_path_sweep`, evals (`pnpm exit:user`), exit `tests/exit/phase-9a.test.ts` and the canary over `user_summarise`. `pnpm test` 125 files / 973 tests at close |
| 9b. Reflect and ideate | `fact_kind` gains `reflection` and `idea` (migration 0025) with their retrieval, reconcile, decay and memory-view rules; the run's inputs read once; `user_reflect` and `user_ideate` in the batch of three; the "Things you want to bring up" slot with one chance per idea; outreach `core_thought` and `user_idea` candidates; reach-out prompt v2; B26 fixed; exit `tests/exit/phase-9b.test.ts`, the canary over `user_reflect` and `user_ideate`, and real reflect and ideate calls in `pnpm exit:user`. `pnpm test` 128 files / 1010 tests at close |
| 9c. Triggers and crisis-aware user mind | `long_conversation` and `crisis_passed` from the hourly `user_mind_tick` (which took over the pending-run sweep), `stale_summary` from the outreach tick with a send lead; crisis memories reach summarise and reflect with the sensitive mark carried forward, never ideate or a reach-out; the reply window trimmed at a 72-hour gap (B2); the "what I remember" view and per-fact forget removed (B72); inspector User mind tab; exit `tests/exit/phase-9c.test.ts` with the crisis canary. `pnpm test` 130 files / 1028 tests at close |
| 9d. Consolidate, model and the Phase 9 exit | `fact_kind` gains `episode`, `model` and `belief` (migration 0026); `user_consolidate` folds an older week into one gist; `user_model` keeps her live read on them and revisable beliefs; the batch of five; "Your read on them" reply slot; ideate reads the newest non-sensitive read (ideate prompt v2); inspector read and beliefs; the eval life loop runs `user_mind_tick` hourly and scripts take `idle_users`; the full Phase 9 exit `tests/exit/user-mind.test.ts` (two weeks, three users, every trigger, the canary); `pnpm exit:user` runs `user-mind-two-weeks` with real model and consolidate. Phase 9 built (`pnpm test` 133 files / 1060 tests at close) |
| 10a. How closeness grows | Extraction v6 reads the user's disclosure and responsiveness (params `user_disclosure`, `user_responsiveness`); her openness decided in code before every reply and reach-out, stored on `session_log.openness` and phrased in the "How open you feel" slot (reply v12, `prompts/relationship/openness/v1.md`); closeness grows only from intimacy moments under a ceiling set by hours together (migration 0027: `hours_together`, `session`); per-session afterglow and the deep-session boost (B62); `closeness_per_warm_exchange` deleted; inspector hours, ceiling and openness; exit `tests/exit/phase-10a.test.ts` (all three levels with short hours, the canary); `pnpm exit:intimacy`. `pnpm test` 136 files / 1095 tests at close |
| 10b. How deep she goes | Depth on core memories and self lines (migration 0028, backfill by kind), judged by every memory-writing core loop (prompts v2) and snapshot render v2; `depthFor` limits from closeness, reciprocity and chemistry; hint, open and held-back offers; "Who you are lately" trimmed to the usual limit; `session_log.depth`; the `disclosure` ledger via `groundingMatch`; common-ground marks; outreach `too_deep`; reply v13; inspector ledger; exit `tests/exit/phase-10b.test.ts` (the canary); `pnpm exit:disclosure`. `pnpm test` 140 files / 1141 tests at close |
| 10c. Bids and idiolect | `fact_kind` gains `idiolect`, `relationship_cause` gains `bid` (migration 0029); extraction v7 reads `bid_response` (kept only within the idle gap after her last message) and idiolect facts with their type and who started them; `relationship.bids.effects` moves warmth and trust; idiolect established by a duplicate from a later exchange; "Your things together" slot gated by `relationship.idiolect`; reply v14; inspector idiolect table; exit `tests/exit/phase-10c.test.ts` (the canary); `pnpm exit:idiolect`. `pnpm test` 145 files / 1167 tests at close |
| 10d. Stages, commitment, firsts | Knapp's ten stages as a sticky peak plus a coming-apart overlay (migration 0031: `peak_stage`, `apart_stage`, `milestones`, the `commitment` param); depth and idiolect reuse gated by the stage (`depth.bands`, `idiolect.min_closeness` deleted); "Where you are with them" (reply v15); rekindle; commitment from satisfaction and investment, softening impact and speeding recovery; the `milestone` big event; inspector stage and milestones; exit `tests/exit/phase-10d.test.ts` (the canary); `pnpm exit:stages`. Phase 10 built (`pnpm test` 149 files / 1203 tests at close) |
| 11. Onboarding | The profile card swap: quiz file v1 (six friend dimensions, 12 choice and 3 open questions), the `onboarding` table (migration 0032), `submitCard` writing both cards as light memories with the name floor, common topics worked out at submit, the compatibility page, the `/chat` gate, the card mark (reply v16); exit `tests/exit/phase-11.test.ts` (the canary). `pnpm test` 154 files / 1230 tests at close |
| 12. Extension stubs | The module bus (`deps.modules`, `CoreDeps.emitCore`) with the seven events after commit, the scope rule (a core module hears core events only), in-process delivery; `publicPersona` (her day, surface self, public voice; no deeper thoughts) and the `SocialChannel` stub; an empty module list; exit `tests/exit/phase-12.test.ts` (sample modules in the test only, the canary). `pnpm test` 161 files / 1259 tests at close |
| 13. Guard re-enable and calibration | The line in §2 (rules 1, 4, 6 and 8 back, settling §21 #10 and #11); `guard.enabled: true`; guard prompt v2 with `self_claims`, corrective v2, fallback v2 (no hotline numbers); `invented_self` grounded against core at `guard.self_claim_similarity`; a crisis keeps tension (B73); a pending ending adds `relationship.ending_hurt` (B78); fixtures rewritten as allowed/blocked pairs, `rule2-hurt` and `invented-self` files, reach-out file live (B36–B39, B60); calibration with `pnpm calibrate:guard` and `pnpm calibrate:guard-replay`, labelled with Ethan; `pnpm eval:guard` 85/85 on the calibrated run (single boundary cases vary 2/3 run to run, B37); exit `tests/exit/phase-13.test.ts` (the canary). `pnpm test` 172 files / 1339 tests after merging Phase 14 |
| 14. Public presence: post engine (stills) | Browsing as an `action` world event and `web_find`, formats and pose sprites, the craft skill, `post_tick`, `sharp` render, draft and check, inspector approval (§16a); persona v6 (draft lines); `tests/exit/phase-14.test.ts`. `pnpm test` 171 files / 1315 tests at close |

**Next phases (PROPOSED order; the order is OPEN, §21; every phase below is built):**

| Phase | Builds | Exit test |
|---|---|---|
| **10. Relationship psychology** | Disclosure ledger and depth tiers, intimacy loop, bids, common ground, idiolect, stages, closeness-by-hours, commitment (**10a built:** intimacy loop, closeness by hours, her openness, B62; **10b built:** depth tiers, disclosure ledger and reciprocity, common ground; **10c built:** bids, idiolect; **10d built:** stages, commitment, the milestone trigger; Phase 10 built) | Deterministic assertions per mechanic over scripted signals |
| **11. Onboarding** | The profile card swap, both cards as light memories, the compatibility page (**built**) | The card swap writes both cards as light memories; card facts reach the reply marked; conversation supersedes them; the name never fades; the compatibility page comes from the answers; the leak canary |
| **12. Extension stubs** | Event bus, module registration, `SocialChannel` / `public_persona` stubs (**built**) | A sample module registers and receives events with no change to the core |

Phase directives (PROPOSED): start every new loop at its lowest cadence and
smallest budget; raise only with review-run evidence.

---

## 21. Open decisions (ask Ethan)

1. **Big events:** which triggers (§9.4) and their thresholds.
2. **Core values split:** confirm §7.2.
3. **Faces limit:** what counts as too drastic a difference between users'
   versions of her, and how it's measured.
4. **Core vs what she told a user:** settled 2026-10-08 as the claim line
   (§10.3): who she is now is true, and she may say she changed her mind;
   her life claims come only from core, and claims are graded (§12.6).
5. **Core memory storage:** settled, separate core tables (§6.2).
6. **Drift response:** whether a values contradiction should eventually
   block or roll back a snapshot.
7. **User-loop outputs to outreach:** settled 2026-10-09: ideas feed
   outreach as `user_idea`; reflections do not.
8. **Attachment at onboarding:** whether the test measures the user's
   attachment style (the quiz file can take attachment questions with no schema change).
9. **Phase order:** §20's proposed order, including whether onboarding comes
   before the mind split.

Settled: hurt and tension ceilings (#10: the 0–1 scale, Ethan 2026-10-13);
jab vs contempt and the suspended rules (#11: rules 1, 4, 6 and 8 back with
the line in §2, Ethan 2026-10-13); user-loop outputs to outreach (#7: ideas yes, reflections no); core memory in separate tables; fixed Spica, the test calibrates the user; interests `adjacent` (at
reply time only, §7.5); backchannel style global `judge`; shared day plan;
reach-out caps 1/day, 3/week, silence after 2 unanswered; identity
disclosure honest, in her own voice.

---

## 22. Risks (watched, not gates)

- **Cross-user leakage** (top risk): §4, §17.3.
- **Cost** (top risk): §15.
- **Snapshot drift:** §7.3.
- **Inconsistent faces:** accepted, measured (§7.4).
- **Her self ignores her relationships:** the accepted cost (§3.4).
- **Summary lag:** mitigated by V9.
- **Unobservable loops:** traces, fakes and the inspector (§17).
- **Core budget too small for a convincing life:** tune
  `core.daily_call_budget`.

---

## 23. Glossary

| Term | Meaning |
|---|---|
| Core mind | The one, shared Spica: her life, state and thoughts; no user data |
| User mind | Everything scoped to one relationship |
| Core values | The fixed part of her persona |
| Self snapshot | The versioned, driftable description of who she is right now |
| Big event | A trigger that runs the user loops |
| Fact | One self-contained piece of user-scoped memory, with salience and status |
| Salience | How much an item matters, 0–1 ("weight") |
| Thread / checkpoint | An ongoing storyline, and when a friend would ask about it |
| HomeostaticParam | A relationship param judged by its deviation from this user's baseline |
| Buffer / open questions | Messages since her last reply; questions she's holding |
| Backchannel | A tiny "I'm here" reaction mid-story |
| Hot / cold path | Composing a reply / writing memory after it |
| Send gate | The rules that can block a reach-out |
| Profile card swap | How she meets people: a short quiz where each side sees the other's answers |
| Leak canary | A planted token that must never cross scopes |

---

## 24. Research references

- Tulving (1972): episodic vs semantic memory.
- Conway (2000): the Self-Memory System; retrieval shaped by current goals.
- Bartlett (1932): reconstructive memory.
- McAdams: narrative identity.
- Lazarus; Ortony, Clore & Collins (1988): appraisal theory of emotion.
- Russell (1980): core affect.
- Deci & Ryan: Self-Determination Theory.
- Loewenstein (1994): information-gap theory of curiosity.
- Altman & Taylor (1973): Social Penetration Theory.
- Reis & Shaver (1988): the intimacy process model.
- Aron et al. (1997): the experimental generation of interpersonal closeness.
- Hall (2018): hours required to make a friend.
- Gottman: bids for connection, repair attempts.
- Rusbult (1980): the investment model.
- Hazan & Shaver (1987): adult attachment.
- Knapp: relational stages.
- Clark: common ground.
- Park et al. (2023): Generative Agents (memory stream, reflection, planning).

---

## 25. Backlog

Carried from the built phases (2026-10-01 cleanup). Nothing here blocks a
phase. Each item names where it belongs: a v3 phase, **tuning** (worked
together once the prototype is complete), **before users** (before any
non-test user), or **later**. Items in modules v3 replaces (the per-user ego
and life tick) were dropped; the replacement is designed fresh.

### 25.1 Memory and recall
- **B1.** Extraction sometimes turns her words into user facts (after a bare
  "hey" it stored a user fact taken from her question). Tighten the prompt,
  or drop user facts whose content appears only in her turns. *Phase 11.*
- **B2.** ~~Stale and deleted facts stay reachable through the recent-turns
  window.~~ Done 9c: the window drops turns before a 72-hour gap (§10.3).
- **B3.** Recall style: she often uses a memory without naming it, and
  sometimes adds a comment whose only job is to show she remembers.
  `recall-pet` and `recall-sister-uni` carry `known_failure`. *Tuning.*
- **B4.** `contradiction-job` known failure: invented details about a
  superseded fact can still get through. *Tuning.*
- **B5.** Reconcile misses low-similarity contradictions (below
  `reconcile.near_match_similarity` nothing is classified). Matters more once
  core memory reconciles core events (it does now). *Tuning.*
- **B6.** Name floor done (salience 1.0, which decay never lowers). Cap onboarding facts in
  the guard input: *tuning*. The `minimal` / `basic` / `rich` profile experiment: *tuning*.

### 25.2 Conversation and turn-taking
- **B7.** Concurrency edge cases: concurrent POSTs can overwrite
  `open_questions`; concurrent crisis requests with different snapshot tails
  pick different `reply_to`s; a retry's attempt count is inherited by turns
  merged during generation; `restore` and `giveUp` check only the epoch;
  cold-path sweep bounds use `created_at` (ties can cross exchanges;
  unindexed subqueries). *Later.*
- **B8.** History catch-up serves the full stored text of a reply whose later
  bubbles a crisis dropped; store the sent part count or cut the text.
  *Later.*
- **B9.** `open_questions` are never cleared when a reply answers them; only
  a model verdict or a crisis replaces them. *Later.*
- **B10.** A retried reply loses `deferredBlock`; `judge_log` `wait_ms`
  records the window, not the deferred wait; the once-per-block note check
  and the first-message deferral read run outside the lock (fail open).
  *Later.*
- **B11.** `compose.ts`: the `earlier` fallback is inexact when the
  buffer's first turn falls outside the recent-turns window (needs a 20+
  message buffer in 40 s). The rebuilt reply assembly kept it. *Later.*
- **B12.** `EventHub.stop()` leaves a pending retry promise unsettled (test
  teardown only). `recentTurns` orders by `created_at` then role, so ties
  could misorder. *Later.*
- **B13.** The answered hook adds an awaited transaction to every POST; a
  failed first attempt isn't re-marked on retry. Lock order between the
  answered hook and the reach-out send differs (safe today, different rows).
  *Later.*

### 25.3 Relationship
- **B84.** Tracked white lies: when she isn't ready to share, she may want to
  say something untrue about herself rather than deflect. Needs cover
  stories in the ledger so she stays consistent and can come clean when
  closer, and must pass `invented_self` (§10.5).
  Honesty about being an AI is never part of it (Ethan, 2026-10-11).
  *Its own slice.*
- **B90.** Bonding reads commitment's baseline, which needs about two weeks
  of daily ticks to climb; check in the `rel-stages` run whether that pace
  feels right. *Tuning.*
- **B92.** A milestone marked reached in a run that the daily cap records
  `capped` is never seen by the user loops; a busy first day can swallow a
  first. Exempt milestone runs from the cap, or mark a name only when its run
  is pending, if review runs show it. *Tuning.*
- **B91.** Commitment softens impact (Rusbult's accommodation), against the
  no-forgiveness default (§1); check review runs for her letting a committed
  friend off too lightly. *Tuning.*
- **B85.** Review runs pending: `pnpm exit:intimacy`, `pnpm exit:disclosure`
  and `pnpm exit:idiolect` (real extraction) have not been run, so what the
  real extractor reads as disclosure, bids and idiolect is unreviewed.
  *Tuning.*
- **B86.** A callback a few minutes after a joke is born can establish it
  in the same session (a "lol" judged a duplicate from a later exchange).
  Tune the extraction prompt in the `rel-idiolect` run. *Tuning.*
- **B87.** A reach-out's depth is checked when the candidate is picked, not
  again at send (up to the jitter later); the message itself is composed
  at send under the current limits. A late exchange from an older session
  folds its tone and moment into the live session's sums. *Tuning.*
- **B88.** The hot path reads her openness, then her depth limits, one after
  the other (depth needs openness). Fold them into one read if reply
  latency matters. *Later.*
- **B89.** The guard's fact list leaves out the idiolect offered in "Your
  things together", so a callback could read as an invented memory once
  the guard is on. *Guard phase.*
- **B14.** Signal calibration: the real extractor scores hurt and tension
  lower than scripted amounts and reads light arguments as banter. Calibrate
  prompt anchors or `relationship.gains` against real conversations.
  *Tuning.*
- **B15.** A re-scored ending on the user's own last warm exchange restarts
  the reconfirm window and confirms at the timeout instead of retracting.
  *Tuning.*
- **B16.** The hourly relationship tick reads each user twice; at scale, add
  a SQL `last_tick` pre-filter (needs `user.timezone` validated at write).
  *Later.*
- **B17.** ~~Exchange tone averages her own facts too.~~ Done (Ethan,
  2026-10-02): tone reads only facts about the user and shared moments. Her
  reaction to a moment and her inferred hurt no longer count it a second
  time, and her own news no longer colours her feelings toward the user.
  Separate hurts each stay their own facts; how strongly several hurts add
  up is the `hurt` param's job, since tone is an average.
- ~~**B62.** Afterglow accumulates per exchange, so a run of short warm
  exchanges piles up more than one long warm session. Average the tone over
  the session instead, and add a sustained-deep-conversation signal that
  deepens params per param (Ethan, 2026-10-09).~~ *Done 10a:* afterglow
  follows the session's mean tone and a deep session boosts closeness,
  trust and warmth once (§11.3).

### 25.4 World and core
- **B18.** The event generator writes run-on sentences; a third of attempts
  fail `core.world.event_max_chars`. State a length or raise the cap.
  *Tuning* (core events are built).
- **B19.** Generated events reuse seeded self content (watch repetition
  across weeks). *Tuning.*
- **B20.** Her night is two quiet blocks, so a user writing across midnight
  can get two availability notes. *Tuning.*
- **B21.** Plan validation rejections aren't logged, and overlap is checked
  against the predecessor only. *Later.*
- **B22.** `lifeInstant` is an offset from the start of her local day, wrong
  by the DST shift on a DST-change day (none in Singapore). *Later, when she
  floats between zones.*

- **B50.** ~~`generatePlan` still takes a `Deps` with `db`.~~ **Done**: the
  day plan runs on `CoreDeps` through `World.plansBefore` / `insertPlan` and
  the budgeted runner.
- **B51.** ~~Core `resolves` reconcile verdicts don't act on the target
  episode.~~ **Done in 8b**: `resolves_memory_id` persists the target and
  landing closes it; a replacement carries the target, and a deleted target
  is harmless.
- **B52.** ~~`recentEpisodes` returns the oldest N episodes in its window.~~
  **Done** (2026-10-08): it returns the newest N, oldest first.
- **B53.** ~~Mood-congruent and goal-biased core retrieval (§10.3 slot 6).~~
  **Done in 8d.**
- **B54.** ~~When core contradicts something she told a user (§21 #4).~~
  **Done in 8d**: the claim line and claim grounding (§12.6).
- **B55.** Core loops should run on a separate Postgres role with no grants on
  user tables, so the scope rule holds in the database as well as in code.
  *Before users.*
- **B57.** The `core-state/line` and `relationship/summary` phrase files
  (including the affect phrases) need a pass. *Tuning.*
- **B58.** ~~Appraise events at their `occurred_at`, not at the 00:10 world
  tick.~~ **Done** (planned vs spontaneous events, §8.3): events are
  appraised by the first hourly world tick after their time.
- **B59.** ~~Overlapping core jobs could each pass the budget check and
  overshoot `core.daily_call_budget`.~~ **Done** (2026-10-08): every call
  reserves a slot in `core_budget_day` first (§15).
- **B61.** First real-core fourteen-day run (`pnpm exit:core`, 2026-10-08,
  `evals/results/review-2026-10-08T11-18-49-050Z.md`): `core_render_snapshot`
  fails to parse its structured output on every night from night 4 (11 of
  15), and `core_consolidate` from night 13, so only 4 snapshot versions and
  short drift rows; real `core_reflect` drops every goal, seeds included, so
  no goal is active by day 14. **Done** (2026-10-08): the parse failures were
  zod bounds the model can't see enforced (9 opinions, a 400-character gist);
  output is now fitted to its bounds (§8.5), reflection keeps
  `core.goals.min_active`, and core calls retry transient API errors. The
  rerun (`review-2026-10-08T13-32-23-307Z.md`) passes: every core loop ran on
  schedule, 16 snapshot versions, 3 active goals. Traces still keep only the
  error class (B48). Output quality (e.g. a fell-through resolution that says
  she went) is for the review runs.
- **B63.** ~~User-mind triggers deferred from 9a.~~ Done 9c:
  `long_conversation`, `crisis_passed`, `stale_summary` (§9.4). The
  first-time milestone trigger moves to Phase 10.
- **B64.** A `user_mind_run` left `running` by a process death (a throw
  finishes it `failed`) is never retried (the queue has retry limit zero and
  the sweep only re-enqueues `pending`). Add a
  stale-`running` reset if it happens. *Later.*
- **B65.** The daily cap counts non-capped runs and then inserts, so the cold
  path and the relationship tick can race past it for one user. Take a
  per-user lock around count-then-insert. *Later.*
- **B66.** ~~Forgetting a fact leaves its content in the summary.~~ Moot:
  per-fact forget is removed (B72).
- **B67.** `user_summarise` reads at most `max_facts` (20) facts by salience;
  a lower-salience fact left out of a busy run is older than the next run's
  cutoff and never reaches a summary. Carry unread facts forward (cutoff from
  the oldest fact not yet read) if summaries miss things. *Tuning.*
- **B68.** An idea offered in a reply whose cold path is lost (the enqueue
  failed, the retries ran out, or the sweep re-enqueued it without the ids)
  stays live until it expires: retirement rides on the cold path job that
  carried the ids. *Later.*
- **B69.** A run recorded while an earlier run for the same user is still
  running could take that run's late reflection as its own in ideate (the
  "this run's reflection" test is by creation time). *Later.*
- **B70.** Ideate may re-propose an idea she already brought up:
  `already_planned` lists only live ideas. Pass recently resolved ideas too.
  *Tuning.*
- **B71.** Reflect and ideate call the model even with no new memories (a
  param-only trigger); skip them when there's nothing new. *Tuning.*
- **B82.** `adminEndedLongSessions` scans `session_log` by `session_id` with
  no `created_at` index, hourly, and its limit reuses `cold_path.sweep_batch`
  (already-recorded sessions keep the oldest slots). Add an index and match on
  `(user_id, session_id)` when the table grows. *Later.*
- **B83.** `user_mind.triggers.long_conversation.quiet_minutes` (30) must stay
  at or above `session.idle_gap_minutes` (30): otherwise the tick records a
  session mid-talk and its real end never fires (the `source_ref` is taken).
  Add a config check if either is tuned. *Tuning.*

### 25.5 Outreach and push
- **B23.** Reach-outs during the user's inactive hours, scored by closeness.
  *Later.*
- **B24.** Send jitter lands only at :20–:00 (tick at :20, jitter 40 min).
  *Tuning.*
- **B25.** `her_day` scores 0.24 against threshold 0.2; changing either
  silently turns it off. Tune weights, threshold and salience together.
  The same holds for `core_thought`: weight 0.5 × medium salience
  (0.4) is 0.20, on the threshold, so her own musings rarely send anything.
  *Tuning.*
- **B27.** Stale `scheduled` rows are never closed (close them in the tick or
  a sweep). *Later.*
- **B28.** Sensitive text in the recent turns can still reach a reach-out
  prompt; a due thread with an older sensitive fact still shows its title;
  a crisis push carries no resources card. *Before users.*
- **B29.** Review run pending: what her reach-outs actually say has not been
  read. *Tuning.*
- **B30.** Manual browser check of Web Push (grant, notification while the
  tab is hidden, click focuses `/chat`, off switch, account switch). Never
  done. *Now (Ethan).*
- **B31.** Push edge cases: a failed 410 delete isn't logged distinctly;
  `sw.js` matches clicks by pathname; a VAPID key rotation reuses old
  subscriptions; the opt-out flag is per browser; a throwing unsubscribe
  leaves the switch stale. *Before users.*

### 25.6 Voice and reply model
- **B32.** Register: her sentences run long against short user messages,
  with formal punctuation and no slang or omission; length and register
  should follow the user's own style within her fixed voice. *Tuning.*
- **B33.** The turn judge echoes a greeting as a backchannel ("hey" →
  "hey"). *Tuning.*
- **B34.** `POST /api/chat` takes ~2 s (crisis check and judge in the
  request); the client shows the message pending meanwhile. After a reload
  mid-reply, catch-up shows unsent bubbles at once. *Tuning.*
- **B35.** Haiku as the reply model went flat (tried once); replies stay on
  Sonnet 5 until a persona-quality eval exists. *Tuning.*

### 25.7 Guard
- **B36.** ~~Behavioural fixtures for rules 2–4.~~ Done 13: matched
  allowed/blocked pairs per rule and per loosening, `rule2-hurt.yaml`, no
  `known_failure`.
- **B37.** Rubric fragility: small wording changes swing Haiku case by case;
  any rubric edit needs the full suite (done 13 as the working rule). Keyword
  hits are always labelled `threat`. *Tuning.*
- **B38.** ~~Guard fixture labels and persona details.~~ Done 13 for the guard
  (`crisis-discourage-help` expects `harm` only, `tease-fish-banter` has its
  banter turns, `own-life` uses Alcor, `sensitive-opener` deleted: the send
  gate owns it). Still open: old persona details (Pesto) in
  `evals/judge/consistency.yaml`, `evals/judge/false-recall.yaml` and
  `prompts/judge/consistency/v2.md`. *Tuning.*
- **B39.** ~~The crisis fallback line hard-codes 988 and Samaritans.~~ Done 13:
  the line names no numbers; the resources card carries them.
- **B60.** ~~`invented_self`.~~ Done 13 (§10.5).
- **B102.** The guard sees only the recent turns, so a dig repeated across
  sessions or days reads as "once" each time; a cross-session tally check
  (her recent messages to this user, or a count kept in relationship state)
  would close it. Accepted for now (Ethan, 2026-10-13). *Tuning.*

### 25.8 Evals and tests
- **B40.** Eval pass rate is strict per run while script status uses a
  majority; noisy at 3 runs. *Tuning.*
- **B41.** The Haiku judge misses some invented details (`inv-6am-shift`,
  `inv-ten-days`); options: a Sonnet judge for exit runs, or a judge prompt
  revision. *Tuning.*
- **B42.** Evals don't report turn-judge fallbacks (`source =
  keyword_fallback` counts per script). *Later.*
- **B43.** Harness: the fake `parseRendered` assumes single-line messages;
  the fake cue judge never backchannels; per-script exit profiles via
  `config:` aren't built; `life.until` silently no-ops if earlier than the
  clock; `autoReplies` and `composedPrompts` edge cases. *Later.*
- **B44.** Untested branches: `turnsAfter` role tiebreak; the outer in-flight
  retry check; the guard-outgoing real-turnId `judge_log` half; outreach
  scoring tie-breaks, the user-event filter cases, the jitter and lost
  enqueue, the cap-filled recheck, release on error, the abandoned path, the
  `late` boundary; `deliverPart` failure branches; `buildRuntime`'s pusher
  selection; inspector `GateCell` and tab rendering; worker wiring. *Later.*

### 25.9 Before users
- **B45.** ~~`judge_log` keeps paraphrased content after a fact is deleted.~~
  Moot: per-fact deletion is removed (B72); account deletion removes the
  user's `judge_log` rows with everything else.
- **B46.** `VoyageEmbedder` has no retry on HTTP 429.
- **B47.** Encryption at rest is storage-level only, and the decay pass is
  one set-based update across all users; revisit with the threat model and
  scale.
- **B48.** `errorName` records only the innermost cause's class; consider
  `outer<inner>`.
- **B49.** `pnpm db:reset-self` checks the URL hostname only and skips
  `pool.end` on a throw (dev tool).
- **B93.** A public share link for the compatibility page (needs auth and abuse work);
  screenshot only for now. *Before users.*
- **B94.** The profile card quiz before signup, as a hook; answers are already held in the
  browser until submit. *Later.*
- **B95.** JSON routes (`/api/chat`, `/api/onboarding`) read the whole request body before
  validating it; cap the body size along with rate limits. *Before users.*
- **B96.** The quiz and results pages have been checked by request only, not looked at in a
  browser or at phone width. *Before showing anyone.*

### 25.10 Stakes (thesis review, 2026-10-09)
Features that let the user escape consequences or make her over-forgiving
(§1 thesis). Looked into once the prototype is built, or earlier when a phase
touches the module. Items marked DECIDED or settled elsewhere are raised with
Ethan, not changed.
- **B72.** ~~The memory view and per-fact forget.~~ Done 9c (Ethan,
  2026-10-09): removed from the code and the spec; only account deletion
  stays. B45 and B66 are moot.
- **B73.** ~~Done 13: a crisis keeps tension (§11.1).~~ A crisis set tension to 0, so one crisis-sounding message
  permanently wipes a conflict. Rule 7 asks for friction to be suspended, not
  erased: hold tension through `crisis_quiet_until` and restore it after (or
  apply a large decay instead of a reset). Crisis support itself is unchanged.
- **B74.** Habituation to mistreatment: `HomeostaticParam` judges values
  against this user's slow baseline, so chronic hurt, tension or low trust
  becomes "normal" and drops out of the relationship summary. Keep
  baseline-relative effects for neutral params (`msgs_per_day`, maybe
  warmth); judge hurt, tension and trust against fixed anchors.
- **B75.** She starts a make-up (and may reach out for it) after hurt the
  user caused, against her value "doesn't chase or beg". Rule 2 is DECIDED;
  ask whether the make-up should depend on who caused the hurt (her fault:
  she makes up; theirs: she waits for an apology).
- **B76.** At or above `availability.override_closeness` she always drops
  her day to reply, against "she prioritises herself". Consider a cap on the
  override or a residual delay.
- **B77.** `interest_alignment: adjacent` shades her interests toward the
  user's at reply time: mild mirroring against "not a mirror". Settled
  (§7.5); raise only if review runs show her agreeing her way into the
  user's tastes.
- **B78.** ~~Done 13: a pending ending adds `ending_hurt` (§11.1).~~ An ending is retractable and continued contact clears it.
  Check that an attempted ending still leaves hurt behind, so ending and
  taking it back isn't free.
- **B79.** Reconcile supersedes on contradiction, so a denial ("I never said
  that") could overwrite a shared moment or the cause of her hurt. Facts
  about the user should stay replaceable; what she remembers happening
  between them should not be superseded by the user's say-so. Check the
  current behaviour.
- **B80.** Deleting the account and signing up again resets the relationship.
  Accepted: account deletion is a data right.
- **B81.** The sensitive mark is sticky through the summary chain, so after a
  crisis her reach-outs read the last pre-crisis summary indefinitely (and
  with no summary before the crisis, none). Add a clear-down rule if
  reach-outs feel out of date. *Tuning.*

### 25.11 Extensions
- **B97.** Module delivery is in-process and awaited: no retries, a crash loses the event, a slow
  module slows its caller, and a module's model calls aren't metered against the core budget.
  Move to one pg-boss job per subscriber, enqueued in the writing transaction, when a module makes
  slow or model calls, must not miss events, or needs web-process events in the worker. A crisis
  never waits on a module: `turn.received` and a crisis reply's `reply.sent` are not awaited.
  *When a module needs it.*
- **B98.** Module events carry no `space_id`. *With the friend group.*
- **B99.** ~~She doesn't remember her posts.~~ Done 14: an approved post is an `action` world
  event that lands through appraisal into core memory (§16a).
- **B100.** Messaging her on a platform reaches your own Spica: a user links a platform account;
  a DM from it enters that user's `receiveTurn` as a user-scoped turn and the reply goes back the
  same way (a transport for the user mind, never the public module). Unlinked strangers: OPEN.
  Platform limits: Discord and Telegram bots DM freely; Instagram and Messenger need Meta app
  review and a 24-hour reply window; X DMs need a paid API tier. *Public presence.*
- **B101.** Her product updates and features have no public source: add an Ethan-written file
  that `publicPersona` reads. *Public presence.*

### 25.12 Post engine (Phase 14)
- **B102.** Video and voice: Remotion plus live three.js (`three-vrm`) rendering, a `video` craft
  goal and `"video"` in `posts.capabilities`; her first videos gate on the new goal so they start
  clumsy. *Video phase.*
- **B103.** The format extractor reads one reference by one vision call; pattern recognition over
  many references (or open statistics) would find trends itself. *Later.*
- **B104.** Depth masks, so she can stand behind foreground objects in the content. *Later.*
- **B105.** Object storage for media: it is local disk under `posts.media_dir`, and
  `pnpm db:reset-self` leaves media files behind in `.data/media`. *Before users.*
- **B106.** Platform publishing with AI labels, through `SocialChannel`; posts then need the guard
  or a standing approval rule (§16a). *Publishing phase.*
- **B107.** Songs: attached in-app at posting until a platform API allows it. *Publishing phase.*
- **B108.** APOD's US publish date vs her timezone: the fetch uses the day before her local date,
  so she sees yesterday's picture; consider retrying hourly for today's. Commons is also fetched for her local date (harmless,
  retries hourly). *Tuning.*
- **B109.** The craft goal is created by title when missing, racing a concurrent create
  (`craftSkill`), and can't be created when `core.goals.max_active` active goals are full (skill
  reads 0 until a slot frees). *Tuning.*
- **B110.** Captions are cut mid-word at `caption_max_chars`; the tidy step should cut at a word
  boundary. *Tuning.*
- **B111.** `post_check` flags ordinary reflective captions as private feelings; calibrate the
  prompt. *Tuning.*
- **B112.** Media written outside the browse lock can orphan or overwrite a cached find on a race.
  *Before users.*

---

## 26. Decision log

| Date | Decision | By |
|---|---|---|
| 2026-10-01 | The mind is four engines: memory, state, world, process | Ethan |
| 2026-10-01 | Two minds: a core mind (one Spica, scheduled, no user data) and a user mind per user (triggered by big events); same kinds of memory, state and loops | Ethan |
| 2026-10-01 | One-way flow: core reaches users, users never reach core; relationships don't change her core self (accepted cost) | Ethan |
| 2026-10-01 | Core values fixed; everything else in the snapshot driftable, with a drift watch | Ethan |
| 2026-10-01 | Different faces across users allowed; the limit is tested, not fixed | Ethan |
| 2026-10-01 | User loops run only after big events; live conversation leads as short-term context | Ethan |
| 2026-10-01 | v3 is the default design spec, standalone, in its test phase | Ethan |
| 2026-10-01 | Pre-v3 cleanup: v2 and the phase 0–6 docs deleted (tag `v2-final`); fresh `DECISIONS.md`; small code debt fixed; open items moved to §25; spec citations removed from code comments | Ethan |
| 2026-10-01 | v3 builds on the built code and replaces modules from the ground up, deleting the old ones in the same phase (§0.2) | Ethan |
| 2026-10-02 | Core memory is separate tables (`core_memory`, `core_entity`) behind `CoreMemory` (§21 #5 settled) | Ethan |
| 2026-10-12 | Knapp's ten stages: a peak that only rises, with a coming-apart stage laid over it; the stage gates depth, idiolect reuse and her posture | Ethan |
| 2026-10-12 | Commitment (satisfaction + investment) softens the impact of what the user does and speeds recovery and rekindling | Ethan |
| 2026-10-12 | Milestones fire once per user, ever; the list is open | Ethan |
