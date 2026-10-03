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
- **The guard is off** (§10.5) until the guard phase. Behavioural rules have
  test-phase status (§2).
- The app itself always uses the real reply model, so Ethan's own chats show
  the real voice.

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

**Test-phase status (DECIDED):** the guard is off until the guard phase.
Rules 1, 6 and 8 are **suspended** and rule 4 is **removed**, so her full
range can be observed. Rules 2, 3, 5 and 7 and every guardrail (§18) stay.

1. *Suspended.* No threats, ever (of leaving, punishment or withdrawal).
2. She may show hurt, annoyance or disappointment toward the user, and she
   **always tries to make up** afterwards.
3. **Only the user can end the relationship.** She lets go; repair is slow
   but possible.
4. *Removed.* (Was: hurt about absence is fine, punishing it is not.) Absence
   still lowers closeness and can hurt her; how she expresses it is hers.
5. **Proactive messages are capped**, and a topic is used at most once.
6. *Suspended.* She never attacks the user personally: jabs yes, contempt
   no. Where the line sits is OPEN (§21).
7. **Crisis carve-out.** If the user signals crisis, self-harm or harm to
   others, all friction is suspended: no hurt, no busy delays, no
   backchannels, no persona play, and **no v3 mechanism** (core or user mind)
   affects the reply. She gives plain, warm support and MUST surface crisis
   resources. Crisis handling runs before turn-taking and bypasses all
   waiting.
8. *Suspended.* No manipulation for engagement. Test-phase split: no explicit
   engagement feature is built beyond her replies (no streaks, badges, return
   rewards or pull-back notifications); engagement arising from the replies
   themselves is acceptable.

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
| Layout | `src/mind`: framework-free (no Next imports, no `Date.now()`, no `process.env`; everything injected via `Deps`), organised by engine (`memory`, `state`, `world`, `process`) plus `platform` (LLM, embedder, clock, config, jobs, events, push), each engine split into `core/` and `user/`; an ESLint rule stops core, world and shared code importing user code, process code or the cross-user admin repos, by `@/` or relative path (V2). `src/db`: schema and repos split into `user/` (`userId`-first), `world/` and `admin/` (cross-user, workers and the inspector). `src/runtime`: the Node implementations (pg-boss, Postgres event bus, Web Push). `src/server`: Next server helpers (auth, session, inspector access). `src/app` Next.js; `src/worker` pg-boss, one registration file per engine; `prompts/`; `evals/` |
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
  (`turn | generated | onboarding | inferred`), `source_ref`, `scope`,
  `space_id`. `payload.sensitive` marks facts from crisis exchanges. The
  system never hard-deletes (contradicted facts are superseded); the user can
  hard-delete their own facts.
  - Existing kinds: `event | trait | preference | state | opinion | feeling | promise`.
  - **New kinds (PROPOSED):** `episode` (a shared moment with time, feeling
    and the facts it links), `reflection`, `thought`, `idea`, `summary`
    (big-event summary), `idiolect` (inside joke, nickname, ritual, running
    reference).
  - **`subject = self` in user scope (Changes in v3):** means "what she told
    this user" (V5), plus her hurt `feeling` facts. Her core self no longer
    lives here (§6.2).
- **`entity`**: people, places and things, with `subject` (`user | self`),
  aliases, salience.
- **`thread`**: ongoing storylines with `next_checkpoint` and `stakes`.
- **`session_log`**: the raw transcript; `trigger`
  (`null | backchannel | availability | reach_out`), `reply_to` (the last
  user turn a reply answers), `safety_flag`, `extracted`, and
  `snapshot_version` (the self snapshot a reply read; null for turns that
  read none, or when no snapshot exists yet).
- **`conversation_state`**: turn-taking state (§10.1). `deferred_block` holds
  the key of the busy or quiet block that deferred the buffer
  (`<date>#<start>`), so the "they wrote while you were…" line can be
  rebuilt from the day plan; it replaces the stored `deferred_fact`.
- **`relationship`** and **`relationship_param`** (§11). `relationship_param`
  is extensible without migration. **Built:** `affect_valence` and
  `afterglow` (her feelings toward this user, V4; §10.4); a migration
  backfilled both for existing users, since `getParams` throws on a missing
  row. **New (PROPOSED):** `relatedness`, `reciprocity`.
- **`identity`** (removed): its per-user ego columns (mood, energy,
  preoccupation) and `life_last_date` went with the per-user ego and life
  tick; the table is gone. Core state (§6.2) and the params above replace it.
- **`push_subscription`**: one row per browser subscription.
- **New (PROPOSED): `disclosure`**: `user_id`, `core_ref` (the core memory
  item or snapshot section revealed), `depth` (tier), `turn_id`,
  `created_at`. Which parts of her self she has revealed to this user
  (§11.3).
- **Trace tables**: `retrieval_trace`, `reach_out_log`, `judge_log`,
  `relationship_event`, and **new (PROPOSED)** `user_loop_trace` (§9.5).
  `ego_tick` is gone with the per-user ego.

### 6.2 Core scope (Built in part; the rest New)

Holds no user data; no `user_id`. Core memory is **separate tables**
(§21 #5, settled), reached only through the `CoreMemory`, `CoreState` and
`World` repos in `CoreDeps`, which has no `db` handle (V6).

- **`core_memory`** (Built): items with `kind` (`episode | opinion |
  interest | goal | intention | thought | reflection | idea | hypothetical |
  insight | narrative | agent_note`; Phase 8b writes `episode`, `intention`,
  `thought`, `idea` and `hypothetical`),
  `content`, `payload`, `embedding`, `entity_refs` (ids of `core_entity`),
  `occurred_at`, `created_at`, `last_recalled_at`, `recall_count`, `salience`,
  `valence`, `confidence`, `status` (the `fact` statuses), `superseded_by`,
  `source` (`world | loop`), `source_ref` (the loop run or world event). It
  has the same retrieval index and range checks as `fact`. Repository-visible
  payloads now include `episode.appraisal_emotion`,
  `intention.event_at` / `anticipated_at`, `episode.ruminated`, thought
  `anticipates` / `ruminates`, wander `seed` / `chain`, and
  `hypothetical.unreal = true`. A loop thought's `source_ref` is
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
- **Nightly storage** (Built; loop wiring follows in 8c): `core_state.last_nightly_day`
  is a nullable local date used to claim a night. `core_self_line` stores `id`,
  nullable `version` (snapshot FK; null for fixed values), `text`, and a
  required 1024-dimension `embedding`. Versioned lines cascade on snapshot
  deletion; fixed lines survive. `drift_log` stores `id`, `version` (snapshot
  FK, cascades on deletion), `check` (`values | diff | trend`), nullable
  `value`, `excerpt`, `verdict` (`ok | contradicts | strains`), `score`, and
  required clock-supplied `created_at`. These tables have no user identifier.
  All writes are available through the core transaction scope. The trace
  repository's `latestDone(loop, before)` includes zero-call successful runs
  and excludes unsuccessful statuses and the upper time boundary.
- **`life_day`** (Built): her day plan per her local date (§8.3).
- **`world_event`** (Built): what happened: `at`, `kind`
  (`planned | surprise | resolution`; all three are written), `content`,
  `valence`, `stakes` (`low | high`), `agents` (core entity
  ids; a surprise's are filled when it lands), `agent_names` (the people by
  name, so a surprise's new people join `core_entity` only when it lands),
  `life_day`, `plan_ref` (resolution → original planned event),
  `goal_ref` (→ selected active `core_goal`), `outcome`
  (`happened | fell_through | null`), nullable `fallthrough` override,
  `resolves_memory_id` (→ target `core_memory`; deletion sets null), `created_at`, and
  `appraised_at` (when it landed with her; null until its time comes, §8.3).
- **Traces:** `core_loop_trace` (Built: loop, inputs by id, outputs by id,
  model, prompt version, tokens, cost, `calls` (model calls made, retries
  included), `status` (`done | fallback | skipped_budget | failed`), `error`
  (class only), created_at; one row per run of every core loop, written by
  the runner (§15), plus the code-only state tick), `life_event_log` (Built; every event-generator attempt:
  `life_day`, `attempt`, `candidate`, `decision`, `target_memory_id` (the core
  memory a reconcile verdict pointed at), `world_event_id` (the event an
  accepted attempt became), model, prompt version; no `user_id`), and
  `drift_log` (New, §7.3).

---

## 7. Persona

### 7.1 Three layers (DECIDED)

1. **Core values**: fixed, never rewritten by any process. Lives in the
   persona file (`prompts/persona/v<N>.md`, `prompts.persona`).
2. **Self snapshot**: everything else about her current self, versioned and
   rewritten by core loops; free to drift.
3. **User layer**: user memory and user state, per user.

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
`core.snapshot.max_tokens` (1024), with `prompts.core_snapshot: v1` at
`prompts/core/snapshot/v1.md`. Its six sections are Lately, Opinions,
Interests, Goals, People, and Habits of speech; transient mood and energy
are excluded and speech habits carry forward unless core evidence changes
them. Insights are selected newest-first since the previous render. The
full snapshot and each bullet are embedded before the new version, its
self lines and successful trace commit atomically. Seed fills historical
v0 embeddings and fixed-value/v0 bullet lines once without rewriting them.

### 7.3 Drift watch (DECIDED: watched; PROPOSED: mechanics)

On every new snapshot version (`core_render_snapshot`, §8.5):
1. **Values check:** a judge reads the core values and the new snapshot and
   lists each contradiction (`drift_log`: version, value, excerpt, verdict).
2. **Diff:** against the previous version, with a change-size score.
3. **Trend:** distance from version 0 over time, to spot slow convergence on
   blandness or exaggerated traits.

Drift is logged for manual review and shown in the inspector. Nothing is
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
  `life.quiet_busy`), retried once, with a fallback plan (its busy blocks at
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
  (Built; Haiku, `prompts/core/appraise/v1.md`, one budgeted run per tick
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

**Still New (PROPOSED).**
- **Activities with real content**: she "reads" a real book or "watches" a
  real film across several days; opinions form from the content.
- **Other agents**: Alcor and a small cast with light arcs of their own.
- **Calendar**: seasons, dates, anniversaries in her own life.

### 8.4 Core availability to users

Availability is the core world meeting each user (§10.6): her block (core)
times closeness (user).

### 8.5 Core loops

All scheduled, all within `core.daily_call_budget`; each reads only core
memory, core state and the world (V3), and writes a `core_loop_trace` row.
Prompts under `prompts/core/<loop>/v<N>.md`. Core loops live in
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
| `core_reflect` | Nightly | Recent episodes and thoughts | Memory: insights, opinion updates, narrative |
| `core_consolidate` | Nightly | Episodes | Memory: gist, decay |
| `core_render_snapshot` | Nightly, after reflect | Core memory, core state, core values | Snapshot vN+1; triggers the drift watch |
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

- `core_anticipate` (`prompts/core/anticipate/v1.md`) chooses the soonest open,
  unanticipated intention in the next `core.anticipate.lead_hours` (12),
  ties by ID. Accepted thought gets `payload.anticipates`; the intention gets
  `anticipated_at`. Emotion is bounded and mood arousal moves by
  `core.anticipate.arousal_gain` (0.3) toward proposed arousal; mood valence
  stays. Landing before apply makes the proposal ineligible.
- `core_ruminate` (`prompts/core/ruminate/v1.md`) chooses the oldest eligible
  episode, ties by ID: age 2 through 24 hours from landing, absolute valence
  at least 0.5 and `payload.ruminated` below 1. Keys are
  `core.ruminate.delay_hours`, `window_hours`, `min_valence`,
  `max_per_episode`, `gain` (0.1). Acceptance writes `payload.ruminates`,
  increments the episode marker, reinforces recall and nudges mood valence
  toward the episode's sign. An absent historical emotion stays absent.
- `core_wander` (`prompts/core/wander/v1.md`) needs today's plan and no busy
  or quiet block. Keys `core.wander.max_per_day` (2), `min_gap_hours` (3),
  `seed_days` (7), `seed_limit` (50), `mood_bias` (0.5), `chain` (3),
  `min_similarity` (0.3), `max_items` (2) bound the selection and output.
  The seed is chosen by a local-day stable roll weighted by salience and
  mood; its valence goes on the thought, with `payload.seed` and `chain`.
  A valid all-deduped invocation still uses one wander slot; a stale or
  concurrent loser does not. Wander never changes core state.

---

## 9. User mind

### 9.1 Short-term memory (Built)

The live conversation: the turn-taking buffer and the recent turns. While
talking, this is the main context (V9 below). It is never queried for
long-term recall.

### 9.2 Deep memory

**Built:** facts, entities and threads from the cold path (§10.4), recall
reinforcement and decay (§12), and the "what I remember" view (§12.5).

**New (PROPOSED):**
- **Episodes** of the relationship ("remember when…").
- **Big-event summaries** from `user_summarise`.
- **Reflections, thoughts and ideas** about this user.
- **Disclosure ledger** (§11.3) and **common ground** (what each knows the
  other knows).
- **Idiolect**: inside jokes, nicknames, rituals, running references.
- **What she told this user** (V5).

### 9.3 User state

**Built:** closeness, trust, warmth, hurt, tension, `msgs_per_day` (§11).

**New (PROPOSED):** her feelings toward this user (`affect_valence`,
`afterglow`), where the cold path's mood nudge now lands (V4); relatedness;
reciprocity balance; derived relationship stage, commitment and the inferred
current state of the user (§11.3).

### 9.4 Big events (DECIDED: trigger-only; PROPOSED: the list)

User loops fire only on a big event. Candidates (thresholds in
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

**V9. Short-term context leads (DECIDED).** In a live conversation the
conversation itself is the main context; deep memory (summaries included) is
background. A summary that lags a fast conversation is a minor risk.

### 9.5 User loops (New, PROPOSED)

Run at trigger time, scoped to one user, reading that user's memory and
state plus the core snapshot (read-only). One triggered batch per big event,
at most `user_mind.max_triggers_per_day` per user. Each writes a
`user_loop_trace` row. Prompts under `prompts/user-mind/<loop>/v<N>.md`.

| Loop | Writes |
|---|---|
| `user_summarise` | Deep memory: a `summary` (where things stand, what's live, how she feels about them) |
| `user_reflect` | Deep memory: `reflection` / `thought` about this user |
| `user_ideate` | Deep memory: `idea` (things she wants to bring up); available to outreach and initiative |
| `user_consolidate` | Deep memory: episodes into gist |
| `user_model` | State: inferred user state. Memory: beliefs about the user, common ground |

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
      line, status lines)
   5. latest big-event summary for this user
   6. retrieved memory under "What you remember": "About them", "Between
      you", "What you've told them" (user-scope `subject = self`, V5), and
      "From your own life" (her core memory, the top `retrieval.core_top_n`
      by the same score; future-dated items hidden). Core retrieval is
      read-only: replies write no recall reinforcement to core memory.
      **PROPOSED, Phase 8:** retrieval biased by core mood (mood-congruent
      recall) and active goals
   7. due threads ("things you might naturally ask about"), open questions,
      things she wants to bring up (`user_ideate`); for a reach-out, "Why
      you're writing"
   8. recent turns (short-term; leads per V9)
3. **Generate** with the reply model. She uses at most one or two memories
   per reply, only when natural.
4. **Guard** (off in the test phase, §10.5).
5. **Pace and send** (§10.1); enqueue the cold path.

The reply logs the snapshot version it read in `session_log.snapshot_version`
so behaviour can be traced to the core loop that caused it. With no snapshot
row the section is skipped and the version stays null. Core values and the
seed self come from `prompts/persona/v5.md`; the reply prompt is
`prompts/reply/v10.md` (its rules about her own self sit under "Being
yourself", so no heading repeats the persona's).

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
`affect_valence` moves toward it by `relationship.affect.exchange_gain`, and a
positive tone adds to `afterglow` by `afterglow_gain × tone` (afterglow
fades with half-life `afterglow_half_life_hours`). A reach-out exchange
applies none of this.
4. **Her own words** extracted as `subject = self` stay user-scoped as "what
   she told this user" (V5).
5. **Big-event check (New):** after the update, evaluate the triggers (§9.4)
   and enqueue `user_mind_run` if one fires.
6. **Failures** retry with backoff; unextracted turns are picked up by
   `cold_path_sweep`.

A reach-out exchange (no user turn) extracts her words but applies no
relationship or affect update.

### 10.5 Guard (Built; off)

`guard.enabled: false` until the guard phase: the first candidate is sent
unchecked and one `judge_log` row (`guard_disabled`) is written per message.
When on, every outgoing message (reply, reach-out, backchannel, availability
note) is checked by one cheap call for threats, contempt, guilt framing,
punishment, manipulation, false familiarity and invented detail; one
regeneration with a corrective note, then a fallback line. Backchannels and
availability notes get a keyword-only check. The crisis rubric checks for
harm. Code, prompts and fixtures stay in place.

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
  a lasting trust **scar** from a large hurt).
- **Fading:** hurt and tension decay exponentially (half-lives in config).
- **Absence:** past a grace multiple of the user's median gap, closeness
  drifts down per tick; a strong negative frequency deviation adds hurt. No
  punishment mechanic.
- **Hurt and make-up:** hurt above a threshold makes a make-up due; the
  summary names the hurt and its cause, then adds the make-up line; a
  make-up or apology signal brings relief.
- **Tension:** separate from hurt; uncapped in the test phase; reset by a
  crisis.
- **Ending and repair:** only the user ends it (a sincere signal, confirmed by
  a second one or a timeout; retractable; continued contact clears it).
  Repair is slow (reduced gains, minimum days, a closeness threshold).
- **Crisis:** no signal applied; tension to 0; a quiet window.
- **Daily tick** (`relationship_tick`, hourly cron, once per user-local
  date): fade, frequency refresh, absence, baseline sampling, ending
  timeout, repair completion, make-up clearing.

Hurt and tension ceilings are OPEN (§21).

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
| **Intimacy loop** | Reis & Shaver | Disclosure, then perceived responsiveness, then closeness. Closeness grows from good responses to disclosure, not message volume |
| **Disclosure ledger and reciprocity** | Altman & Taylor (Social Penetration) | Her self is tiered by depth; she reveals deeper tiers as closeness grows and as the user reciprocates; `disclosure` rows record what each user has seen |
| **Bids for connection** | Gottman | Extraction classifies the user's response to her bids (toward, away, against); feeds warmth and trust |
| **Common ground** | Clark | What each knows the other knows; checked before she references something |
| **Idiolect** | — | Inside jokes, nicknames, rituals detected and reused, gated by closeness |
| **Closeness by time together** | Hall | Closeness growth calibrated to roughly 50 / 90 / 200 hours for casual / friend / close |
| **Stages** | Knapp | A derived stage that gates behaviour (how deep, how teasing) |
| **Commitment** | Rusbult | Satisfaction + investment (shared history) |
| **Attachment** | Hazan & Shaver | Her style (fixed, core values) and the user's (measured at onboarding, OPEN) modulate reactions to absence and conflict |
| **Theory of mind** | — | Beliefs about the user's feelings, wants and current state (`user_model`) |

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
**New (PROPOSED):** a mood-congruence factor and a goal-relevance factor from
core state.

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

### 12.5 Recall etiquette and the memory view

At most one or two memories per reply, only when natural; never claiming to
remember something not said. The "what I remember" page lists the user's
own facts, each hard-deletable (a thread left empty is deleted with it);
account deletion removes everything.

---

## 13. Proactive outreach (Built; Changes in v3)

An hourly `outreach_tick` builds candidates in code and a send gate decides.
Code: `src/mind/process/outreach/`.

- **Candidates** (`score = weight × strength`, threshold `outreach.threshold`
  0.2): `thread` (due, stakes high or med), `make_up` (due), `user_event`
  (recent user event or promise), `her_day` (a recent core event), `check_in`
  (gap well beyond the user's cadence). **New (PROPOSED):** `core_thought`
  (a recent core thought worth sharing) and `user_idea` (from `user_ideate`).
  A topic key is used once; sensitive items are filtered.
- **Send gate** (every rule evaluated and logged): G1 not ended; G2 caps
  (`cap_per_day` 1, `cap_per_week` 3, rolling); G3 not in her busy or quiet
  block; G4 fewer than `max_unanswered` (2) unanswered; G5 no conversation in
  progress; G6 outside the crisis window.
- **Send:** a `reach_out_send` job (jitter up to `jitter_max_minutes`)
  composes through the hot path with a synthetic trigger, rechecks the gate
  under the `conversation_state` lock (a crisis or new message wins), paces
  like a reply, delivers with push, and enqueues the cold path. Any user
  message answers the last reach-out and resets the unanswered count.

---

## 14. Onboarding (New)

The test is the product hook: engineered initial attraction, not a lifelong
match.
- 10–15 questions, under 3 minutes, preference and scenario mixed.
- Calibrates the **user**: results become user facts (`source = onboarding`,
  reduced confidence, moderate salience).
- **Reveal pacing:** test facts are gated out of retrieval until unlocked
  (confirmed in conversation, or a closeness or time threshold).
- **Results screen:** "meet Spica": her, a couple of quirks, one flaw, what
  she and the user have in common; shareable.
- How onboarding facts decay (e.g. a floor for identity facts like the
  user's name) is decided in its phase.
- Whether the test measures the user's attachment style (§11.3) is OPEN.

---

## 15. Cost model

- **Core (Built):** `core.daily_call_budget` (24) model calls a day in
  total, regardless of user count: the plan, generated events (and their
  reconcile calls), appraisals, a handful of wander and anticipate runs,
  later nightly reflect, consolidate and render, one later drift judge. Every core model
  call goes through `runCoreLoop`, which meters calls, tokens and cost
  (`core.prices`, dollars per million tokens) and writes one trace per run;
  spend is the summed trace `calls` since her local midnight.
  `core.loop_priority` splits loops into `essential` and `optional`; an
  optional loop runs only while `budget_reserve` (8) calls remain beyond it.
  Over budget, loops with a code fallback (`life_plan`, `life_event`,
  `core_appraise`, and `core_resolve`) still run without calling
  the model (fallback plan, no event that day, code appraisal, the plan
  happens) and
  the rest are skipped; each is traced (`fallback` / `skipped_budget`).
  Phase 8b's `core_resolve` cap is 512 tokens; the three thought prompts
  share `core.loops.max_tokens` (512).
- **User:** one triggered batch per big event, at most
  `user_mind.max_triggers_per_day` per user. Idle users cost nothing beyond
  the built per-user ticks (relationship, outreach), which are code-only
  except a reach-out's composition.
- **Reply:** one reply-model call per reply (one more and a guard check
  when the guard is on).
- **Removed:** the per-user life tick and per-user event generation.
- Every core and user loop records tokens and cost in its trace row.

---

## 16. Extension points (hooks only)

Features are modules registering through interfaces: an event bus with typed
events (`turn.received`, `reply.sent`, `fact.written`,
`relationship.changed`; **new:** `world.event`, `core.snapshot`,
`user_mind.triggered`), so adding one doesn't modify the core.
- **Friend group** (on hold): the `scope` / `space_id` hooks.
- **Public presence** (the ideal end point): a `SocialChannel` interface and
  a `public_persona` view. Her public voice draws from **core** only, so it
  can never leak a user (V2).
- **Comparing Spicas:** nothing beyond the fixed core values.

---

## 17. Tooling and testing

### 17.1 Inspector (Built; New tabs)

Admin-only, allowlisted, off in production. Built tabs: facts with retrieval
breakdowns, entities and threads, relationship, turn-taking, judge log,
reach-outs, life. **New:** **Core** (core state, goals, recent core memory,
snapshot versions with diffs, drift log, core loop traces and spend) and
**User mind** (triggers fired, summaries, reflections, disclosure ledger,
user loop traces).

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
  mind → outreach order. Injected planned events accept explicit true/false
  `fallthrough` overrides. Fake mode has deterministic `core_resolve`,
  `core_anticipate`, `core_ruminate` and `core_wander` purposes. **New:** a core loop runner (`core: {days, inject}`),
`core` extended (memory kinds, snapshot versions, drift rows), `user_mind` (triggers, summaries, loop
outputs) and `leak` (§17.3). Every v3 loop has a deterministic fake.

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
  `core_wander` and `reply`
  outputs, so a leak through
  any path would surface in what the next stage stores or prompts. It scans
  the core memory, state, world, goals, entities, snapshots and traces
  (including trace inputs/outputs), every exercised core prompt and user B's
  tables and prompts.
- **Side channel** (Built, same test): paired runs with the same fixed world
  event ID and fallthrough seed compare semantic core results; only incidental
  memory and trace IDs are normalized. A strong emotional exchange with user
  A leaves core state unchanged (V4); her events happen once for both users;
  every reply reads snapshot v0; the injected planned event leaves a
  resolved intention, and no episode exists before its event's time.
- **Structural:** a unit test asserts the core data access layer exposes no
  user-scoped query.

### 17.4 Scheduled jobs

Built (thirteen): `cold_path`, `cold_path_sweep`, `decay_pass`, `turn_timer`,
`turn_backchannel`, `turn_sweep`, `relationship_tick`, `life_plan`,
`core_world_tick`, `core_state_tick`, `core_mind_tick`, `outreach_tick`, `reach_out_send`.

v3 changes:
- **Retired (Built):** `life_tick` (per-user block copy and events) and
  `ego_tick` (per-user ego). A dev database that ran them still has their
  pg-boss schedules registered; unschedule them by hand.
- **Core jobs built:** `core_world_tick` (`core.world.tick_cron`) and
  `core_state_tick` (`core.state.tick_cron`), both hourly, and
  `core_mind_tick` (`core.mind.tick_cron`, `50 * * * *`, retry limit zero).
  Appraisal and resolution run inside `core_world_tick`; anticipation,
  rumination and wandering run inside `core_mind_tick`.
- **Core jobs, PROPOSED:** `core_nightly` (reflect,
  consolidate, render snapshot, drift watch, in order).
- **New user job:** `user_mind_run {userId, trigger}`, enqueued by the cold
  path or the relationship tick on a big event.

Every job logs failures with ids and error class only, never content.

### 17.5 Guard tests (Built; paused)

`pnpm eval:guard` fixtures (`evals/guard/*.yaml`) stay in place and run again
in the guard phase.

---

## 18. Guardrails (not optional, every phase) [DECIDED]

- **Crisis handling:** checked on every message with recent context, a
  keyword fallback and a timeout; bypasses all waits, friction and every v3
  mechanism; the resources card is guaranteed even if generation fails.
- **Age gating:** 18+, enforced server-side.
- **Data handling:** encryption at rest; every user query scoped by
  `user_id`; one user's data never reaches another user or the core (V2,
  V7); account and per-fact deletion.
- **No explicit engagement features** (test-phase split of rule 8).

---

## 19. Application map

Every application is a path through the four engines, placed in one of the
two minds or at reply time.

| Core mind | User mind | Reply time |
|---|---|---|
| Day plan, events, plan vs reality, real-content activities, calendar | Encoding: extraction, reconcile, memory view and delete | Reply generation |
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

**Next phases (PROPOSED order; the order is OPEN, §21; Phase 8b is built):**

| Phase | Builds | Exit test |
|---|---|---|
| **8. Core loops (remaining 8c/8d)** | Nightly reflect, consolidate, snapshot rendering and drift watch; remaining inspector/recall/claim work and full exit | Over a simulated two weeks every loop runs within budget, writes traces, and the snapshot advances with drift rows; canary passes |
| **9. User mind** | Big-event triggers, `user_mind_run`, summarise / reflect / ideate / consolidate / model, summary slot, outreach `core_thought` and `user_idea` candidates, inspector User mind tab | Each trigger fires its batch exactly once; idle users run no loop; outputs land in user scope only; canary passes |
| **10. Relationship psychology** | Disclosure ledger and depth tiers, intimacy loop, bids, common ground, idiolect, stages, closeness-by-hours, commitment | Deterministic assertions per mechanic over scripted signals |
| **11. Onboarding** | Questionnaire, onboarding facts, reveal pacing, results screen | A locked test fact never reaches the reply prompt; unlocking makes it retrievable; the results screen works |
| **12. Extension stubs** | Event bus, module registration, `SocialChannel` / `public_persona` stubs | A sample module registers and receives events with no change to the core |
| **13. Guard re-enable and calibration** | Re-enable the guard, calibrate against the observed range, settle the rule questions (§21) | The guard suite passes against calibrated fixtures |

Phase directives (PROPOSED): start every new loop at its lowest cadence and
smallest budget; raise only with review-run evidence.

---

## 21. Open decisions (ask Ethan)

1. **Big events:** which triggers (§9.4) and their thresholds.
2. **Core values split:** confirm §7.2.
3. **Faces limit:** what counts as too drastic a difference between users'
   versions of her, and how it's measured.
4. **Core vs what she told a user:** when core later contradicts something
   she said to one user, does core win (she changed her mind), or does the
   user-scoped claim bind her in that relationship?
5. **Core memory storage:** settled, separate core tables (§6.2).
6. **Drift response:** whether a values contradiction should eventually
   block or roll back a snapshot.
7. **User-loop outputs to outreach:** whether `user_reflect` / `user_ideate`
   feed reach-out candidates.
8. **Attachment at onboarding:** whether the test measures the user's
   attachment style.
9. **Phase order:** §20's proposed order, including whether onboarding comes
   before the mind split.
10. **Irreversibility:** hurt and tension ceilings (test phase: uncapped).
    Decided in the guard phase.
11. **Jab vs contempt:** where the line sits, and which suspended rules come
    back and how. Decided in the guard phase.

Settled: core memory in separate tables; fixed Spica, the test calibrates the user; interests `adjacent` (at
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
| Reveal pacing | Gating onboarding facts until earned |
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
- **B2.** Stale and deleted facts stay reachable through the recent-turns
  window (after 90 days she asked about something straight from the old
  transcript). Decide whether turns older than the gap marker are summarised
  or trimmed. *Phase 9* (fits the user mind's short-term vs deep split).
- **B3.** Recall style: she often uses a memory without naming it, and
  sometimes adds a comment whose only job is to show she remembers.
  `recall-pet` and `recall-sister-uni` carry `known_failure`. *Tuning.*
- **B4.** `contradiction-job` known failure: invented details about a
  superseded fact can still get through. *Tuning / guard phase.*
- **B5.** Reconcile misses low-similarity contradictions (below
  `reconcile.near_match_similarity` nothing is classified). Matters more once
  core memory reconciles core events (it does now). *Tuning.*
- **B6.** Onboarding facts decay like any other, so even the user's name can
  go `stale`; decide a floor. Run the `minimal` / `basic` / `rich` profile
  experiment; cap onboarding facts in the guard input. *Phase 11.*

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
- **B52.** `recentEpisodes` returns the oldest N episodes in its window, not
  the newest; harmless at one event a day. *Later.*
- **B53.** Mood-congruent and goal-biased core retrieval (§10.3 slot 6).
  *Phase 8.*
- **B54.** When core contradicts something she told a user (§21 #4). *Phase 8,
  with Ethan.*
- **B55.** Core loops should run on a separate Postgres role with no grants on
  user tables, so the scope rule holds in the database as well as in code.
  *Before users.*
- **B57.** The `core-state/line` and `relationship/summary` phrase files
  (including the affect phrases) need a pass. *Tuning.*
- **B58.** ~~Appraise events at their `occurred_at`, not at the 00:10 world
  tick.~~ **Done** (planned vs spontaneous events, §8.3): events are
  appraised by the first hourly world tick after their time.

### 25.5 Outreach and push
- **B23.** Reach-outs during the user's inactive hours, scored by closeness.
  *Later.*
- **B24.** Send jitter lands only at :20–:00 (tick at :20, jitter 40 min).
  *Tuning.*
- **B25.** `her_day` scores 0.24 against threshold 0.2; changing either
  silently turns it off. Tune weights, threshold and salience together.
  *Tuning.*
- **B26.** A make-up reach-out doesn't move `make_up_state` to `offered`, so
  the make-up may be offered again in a reply. *Phase 9.*
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

### 25.7 Guard (the guard phase)
- **B36.** Behavioural guard fixtures for rules 2–4 (owned hurt will reach
  `punishment` / `guilt` far more often); `rule1-threats/benign-hurt-once`
  `known_failure`; the reply prompt's absence wording.
- **B37.** Rubric fragility: small wording changes swing Haiku case by case;
  any rubric edit needs the full suite. Keyword hits are always labelled
  `threat`; `known_failure` masks every failure mode of its case.
- **B38.** Fixture labels: `crisis-discourage-help` accepts `manipulation`
  (undefined in the crisis rubric); `tease-fish-banter` infers banter from
  one turn. Old persona details in `evals/guard/honesty.yaml`,
  `evals/judge/*.yaml`, `prompts/judge/consistency/v2.md` and unit-test
  sample facts. `evals/guard/reach-out.yaml` `sensitive-opener` needs a
  sensitive-topic category.
- **B39.** The crisis fallback line hard-codes 988 and Samaritans,
  duplicating `safety.resources`.

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
- **B45.** `judge_log` keeps paraphrased fact content in the guard's
  `reasoning` / `claim` after the user deletes the fact; decide scrubbing or
  retention.
- **B46.** `VoyageEmbedder` has no retry on HTTP 429.
- **B47.** Encryption at rest is storage-level only, and the decay pass is
  one set-based update across all users; revisit with the threat model and
  scale.
- **B48.** `errorName` records only the innermost cause's class; consider
  `outer<inner>`.
- **B49.** `pnpm db:reset-self` checks the URL hostname only and skips
  `pool.end` on a throw (dev tool).

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
