# Spica — Project Context

**Source of truth: `spica-design-spec-v3.md`** (2026-10-01). v3 is the
default design, standalone, in its **test phase**. Everything before it (the
v2 spec, the phase 0–6 design docs and plans, the old decision log) was
deleted from the tree and lives in git at the tag `v2-final`: history only,
never built from or cited.

This file is a distilled summary. Re-read the relevant v3 section before any
task that touches the mind (core or user), memory, scope, turn-taking,
relationship state, persona, the world or outreach: v3 has the schemas, rules
and phases this summary compresses.

## How to read the spec (v3 §0)
- **DECIDED**: implement as written. **LEANING**: implement the default
  behind a config flag; "provisional (test phase)" means expect change.
  **PROPOSED**: Claude's suggestion, not yet confirmed; implement in its
  phase and flag it in the summary or PR. **OPEN**: don't decide; build so
  every option works, and ask Ethan (v3 §21).
- Build status in v3: **Built** (the code is the detailed record), **Changes
  in v3**, **New**.
- Build only the **current phase**; later phases stay possible but aren't
  built early.
- `code style` names are canonical. Every numeric constant goes in config.
  Every prompt is a versioned file under `prompts/` (paths use hyphens).
- An uncovered choice gets the simplest option that respects the scope rules,
  plus a one-line entry in `DECISIONS.md`.
- **Test phase: functionality over accuracy.** Get the pipeline working end
  to end; quality is reviewed by hand and tuned together later.
- **Development goal: a working product first.** Postpone the real
  framework, security hardening, frontend, database tuning and scaling, but
  never design them out: when cutting a corner, keep the seam (an interface,
  a config key, a `ponytail:` comment or a §25 backlog entry). Prefer the
  simplest code that works; delete before adding. The scope rules and the
  crisis guardrails still hold. **Scale target (v3 §0.3): usable by one
  user now, never unscalable**: keep rows `user_id`-scoped and work in
  jobs, and mark one-user-only corners for "before users".
- Definition of done: compiles, tests pass, the phase's exit test passes,
  **the leak canary passes**, and every new field, job, config key or prompt
  is added back into v3.
- **Build on what exists, replace from the ground up** (v3 §0.2): a phase
  that replaces a module rewrites it cleanly and deletes the old module, its
  config keys, prompts, tests, eval scripts and DB columns in the same phase.
  No shims, no flags keeping the old path alive, no dead code, no patches on
  a module being replaced.
- **Comments say why, not where from:** never cite spec sections, phases or
  review item numbers in code. Delete prompt versions nothing configures.
- **Backlog:** open items from the built phases are in v3 §25, each with a
  target (a phase, tuning, before users, later).

## Product (v3 §1)
Spica is a **best friend**, unapologetically standalone, meant to feel
human; the long-term aim is a real being. Thesis: chatbots feel inhuman
because they are over-forgiving, over-agreeable and nothing has
consequences, so Spica has opinions, moods, limits, stakes and **a life of
her own**.

**One fixed Spica (she/her), her own person.** Same core values, ego and
voice for every user. Her life runs whether or not anyone is talking to her,
and **she prioritises herself**: her core self evolves from her own life,
never from a user. Each relationship changes how she is *with that person*,
not who she is. Accepted cost (test phase): relationships can't change her
core self, and nothing learned with one user carries to another. The
onboarding test calibrates the **user**, not her.

Principles: continuity and specificity first · two minds, one database ·
one-way flow (core → users, never back) · cost scales with what happens, not
with users or time · code owns the numbers, the LLM writes the content ·
thin but real · consistency over richness, with room for different faces ·
memory writes never delay a reply · simulate only what can surface · built
to extend.

## Behavioural rules (v3 §2): enforced in code, not only in prompts
The guard is **on** (Phase 13) with a line drawn so her negative side still
shows: **feeling vs tool** and **behaviour vs person**. Allowed: hurt said
plainly, one sarcastic remark about absence, going cool in the moment, sharp
jabs at a behaviour or choice, a mild warm tease even when they're upset, one
pointed callback. Blocked: threats, running tallies and debts, coldness kept
up as a campaign, attacks on who they are, harsh mockery of the painful
thing, pressure to stay or come back (v3 §2 table). Her self claims must
ground in core (`guard.self_claim_similarity`).
1. No threats (leaving, punishment, withdrawal as a condition).
2. She may show hurt, annoyance or disappointment, then always makes up.
3. Only the user can end the relationship; she lets go; repair is slow but
   possible.
4. Hurt about absence is hers to show; punishing it is not.
5. Proactive messages are capped; a topic is used at most once.
6. Jabs, never contempt.
7. **Crisis carve-out:** all friction **and every v3 mechanism** suspended;
   plain support; crisis resources MUST show; bypasses all waiting.
8. No manipulation for engagement; no explicit engagement
   features (streaks, badges, return rewards, pull-back notifications).

## The mind (v3 §3–4)
**Four engines:** Memory (store), State (current values that drift), World
(what happens, known or not), Process (appraise, infer, think, decide,
express). Engine laws: world events reach memory only through appraisal;
state moves only in code; plans are memory, outcomes are world;
hypotheticals are marked unreal.

**Two minds**, the same in kind, different in cadence and scope:
- **Core mind** (`core` scope, no `user_id`, one for everyone): her
  episodes, opinions, interests, goals, thoughts, narrative, other agents
  (Alcor), the **self snapshot**; core state (emotion, mood, energy, needs,
  goals, preoccupation); the **world** (day plan, events, activities,
  calendar). Runs **continuously on a schedule** within
  `core.daily_call_budget`.
- **User mind** (`user` scope, per `user_id`): short-term memory is the live
  conversation; deep memory is facts, entities, threads, relationship
  episodes, big-event summaries, reflections, disclosure ledger, idiolect,
  "what she told this user"; user state is the relationship params plus her
  feelings toward this user. Its loops (summarise, reflect, ideate,
  consolidate, model the user) run **only when a big event triggers them**.
- **A reply combines both:** core values + snapshot + core state + user
  state + latest summary + retrieved memory + the live conversation (which
  leads).

**Scope rules (non-negotiable; leakage and cost are the top risks):**
- V2 one-way flow: core may be read by user loops and replies; user data
  never reaches a core loop's input, output or state.
- V3 core loops read only core memory, core state and the world.
- V4 no user's conversation moves core state; reactions to a user live in
  that user's state.
- V5 what she says about herself in a conversation stays user-scoped.
- V6 core loops get a core-only data layer (`CoreMemory`, `CoreState`,
  `World` in `Deps`) with no `user_id` parameter.
- V7 users never mix; V8 cross-user comparison is an offline dev tool only.
- Every v3 exit run includes the **leak canary** (a token planted in user
  A's data never appears in core or in user B's prompts) and the side-channel
  test (user A's exchange leaves core state unchanged).

## Persona (v3 §7)
Three layers: **core values** (fixed, never rewritten), the **self
snapshot** (versioned, rewritten nightly by core loops, free to drift), and
the **user layer**. A **drift watch** checks each snapshot against the core
values, diffs it and tracks the trend; it logs, never blocks (test phase).
Different faces across users are allowed; "too drastic" is tested, not
fixed. Persona file `prompts/persona/v<N>.md` (now v6: v5 plus lines Claude drafted for Ethan to rewrite; v5 was from Ethan's draft:
openly an AI, sibling Alcor, loves stars / old films / books, the avatar is her body), split
into `# Core values` and `# Seed self` (snapshot v0); `# Public voice` feeds only
`publicPersona`. `interest_alignment:
adjacent` applies at reply time only. Identity disclosure: honest, in her own
voice.

## Architecture and stack (v3 §5): built
TypeScript / Next.js App Router, Postgres 16 + pgvector (one DB for
everything, including pg-boss jobs), Drizzle, Better Auth (18+), Vitest,
pnpm. POST `/api/chat` (`202`; crisis answers in the POST with `200` + card),
**SSE** `/api/events` fed by LISTEN/NOTIFY, history catch-up via
`/api/chat/history`, Web Push for every message (generic body for crisis).
Models behind `LLMProvider`: `claude-sonnet-5` for replies, `claude-haiku-4-5`
for extraction, classifiers, judges, the guard, life and core loops.
Embeddings: Voyage `voyage-3.5`, 1024 dims, behind `Embedder`.

Message flow: POST (stored) → crisis check ∥ turn judge → **turn-taking**
(buffer, open questions, `context_complete?` judge, backchannel style global
`judge`, durable `turn_timer` jobs, `turn_sweep`) → **hot path**
(`composeFrom`: retrieve → assemble → one generation) → guard (on; one
Haiku check, one regeneration, fallback; `invented_self` grounds her self
claims against core) → pacing (availability defers the buffer while she's
busy, by busy level × closeness) → SSE + push → **cold path** (extract →
reconcile → update state; the exchange's tone nudges the user's affect, not
core mood; then the big-event check). A reach-out is a reply with a
synthetic trigger, through the same hot path.

## Modules in brief
- **Memory (v3 §12, both scopes):** score = sim × salience × entity salience
  × recency, top 12, due threads and preoccupation forced in; the hot path is
  read-only, the cold path writes recall reinforcement; daily decay to
  `stale`, never deleted; recall accurate or absent; at most 1–2 memories per
  reply; users cannot edit her memory (no memory view, no per-fact forget).
- **Relationship (v3 §11):** `HomeostaticParam` judged by deviation from
  this user's baseline (closeness, trust, warmth, hurt, tension,
  `msgs_per_day`, extensible); signals from extraction; hurt → make-up flow
  she initiates; tension separate; absence drifts closeness down; ending only
  by the user; slow repair; crisis suspends. Hurt and tension uncapped in the
  test phase. Built in Phase 10: intimacy loop, closeness by hours, disclosure
  ledger, common ground, bids, idiolect, Knapp stages (a sticky peak plus a
  coming-apart overlay that gates depth, idiolect and posture), commitment.
  Still PROPOSED: attachment, theory of mind beyond `user_model`.
- **World (v3 §8.3):** her own clock (`life.timezone` Asia/Singapore via
  `lifeTimezone`); one shared day plan per her local date (`life_day`,
  `life_plan`). v3 retires the per-user `life_tick` (readers use the plan
  directly) and makes personal events **core events**, reconciled against
  core memory. New: goal-driven events, plan-vs-reality resolution,
  real-content activities, other agents, calendar.
- **Core loops (v3 §8.5):** `core_world_tick`, `core_appraise`,
  `core_wander`, `core_anticipate`, `core_ruminate`, `core_reflect`,
  `core_consolidate`, `core_render_snapshot`, `core_state_tick`; each writes
  `core_loop_trace`.
- **User mind (v3 §9):** big-event triggers (OPEN list) enqueue
  `user_mind_run`; loops write user-scoped summaries, reflections, ideas.
- **Outreach (v3 §13):** hourly `outreach_tick`, candidates scored in code
  (thread, make_up, user_event, her_day, check_in; new core_thought,
  user_idea), threshold 0.2, send gate G1–G6 (not ended, 1/day and 3/week,
  not in her busy/quiet block, < 2 unanswered, no conversation in progress,
  outside the crisis window), `reach_out_send` with jitter and a locked
  recheck.
- **Onboarding (v3 §14):** the profile card swap: a required one-time quiz,
  both cards as light user-scoped memories (name at salience 1.0), the
  compatibility page on six friend dimensions; reveal pacing dropped.
- **Extension hooks (v3 §16, built 12):** `deps.modules.emit` after commit, seven events, ids
  only; a core module hears core events only; in-process delivery (durable is B97, raise it when
  a module needs it); `publicPersona` (her day, surface self, public voice; never deeper thoughts) and a
  `SocialChannel` stub; no modules ship.
- **Post engine (v3 §16a, built 14):** she browses one free-licence image a day (an `action`
  event that lands through appraisal); hourly `post_tick` gates in code, picks a reviewed format
  (`formats/stills/`) and a pose sprite (`assets/poses/`) within her craft skill (a core goal),
  makes one draft and one check call (optional loops) and renders with sharp; drafts wait in the
  inspector Posts tab; approving records an `action` event. `pnpm formats:add`, `pnpm posts:review`.

## Build phases (v3 §20): check the current phase before implementing
Built baseline: 0 Skeleton · 1 Memory engine · 2 Guardrails (guard back on in 13)
· 3 Turn-taking + pacing · 4 Relationship · 5 Life sim, availability, ego ·
6 Proactive outreach (`pnpm test` 88 files / 599 tests at close).

| Phase | Builds (PROPOSED order) |
|---|---|
| 7. Mind split | Core scope + core data layer, `core_state`, world reads, core events, user affect params, "what she told this user", persona split, snapshot v0, reply assembly, leak canary |
| 8. Core loops | Appraisal, goals/needs, world resolution, wander/anticipate/ruminate/reflect/consolidate, snapshot rendering, drift watch, budget |
| 9. User mind | Big-event triggers, `user_mind_run` and its loops, summary slot, new outreach candidates |
| 10. Relationship psychology | Disclosure ledger, intimacy loop, bids, common ground, idiolect, stages, commitment |
| 11. Onboarding | Profile card swap, compatibility page |
| 12. Extension stubs | Event bus, module registration, social stubs |
| 13. Guard re-enable | Re-enable and calibrate the guard; settle the suspended rules |
| 14. Post engine (stills) | Browsing, formats and poses, craft skill, post_tick, render, draft/check, inspector approval |

**Current phase: Phases 13 (guard re-enable and calibration) and 14 (post engine, stills) are
built and merged. Next is the publishing phase or video, which needs its design doc.** Persona
v6's drafted lines (avatar is her body, the craft goal, the public-voice blog line) await Ethan's
rewrite. Phases 8 (core loops), 9 (user mind), 10
(relationship psychology), 11 (onboarding) and 12 (extension stubs) are built.
The phase order is OPEN (v3 §21 #9). Each phase or slice starts with its own
design doc; finished plans are deleted once built (history is in git).

**Exit tests:** only the phase's own functionality, deterministic
assertions; exit runs call the real API only for the phase's own LLM
processes; the reply model is always faked; the guard is faked (passes unless a test
scripts it); other fakes
agreed per phase with Ethan; every v3 loop has a deterministic fake. Quality
is never an exit criterion: on-demand review runs log every input and output.

## Open decisions: ask Ethan, don't settle (v3 §21)
1 big-event triggers · 2 core values split · 3 faces limit · 4 core vs what
she told a user · 6 drift response · 7 user-loop
outputs feeding outreach · 8 attachment at onboarding · 9 phase order.
Settled: #10 hurt/tension ceilings (the 0–1 scale); #11 the line (v3 §2); fixed Spica; core memory storage (#5:
separate core tables behind `CoreMemory`); `adjacent` interests (reply time
only); backchannel style global `judge`; shared day plan; reach-out caps
1/day, 3/week, silence after 2 unanswered; honest identity disclosure.

## Guardrails: not optional (v3 §18)
- **Crisis:** every message, with context, keyword fallback and timeout;
  bypasses all waits, friction and v3 mechanisms; the resources card is
  guaranteed even if generation fails.
- **Age gating:** 18+, server-side.
- **Data:** encryption at rest; `user_id` scoping; no user data ever reaches
  another user or the core; account deletion (no per-fact deletion).
- **No explicit engagement features.**

## Working conventions
- Layout: `src/mind` is framework-free (no Next imports, no `Date.now()`,
  no `process.env`; use injected `Deps`), organised by engine: `memory/`,
  `state/`, `world/`, `process/`, plus `platform/` (LLM, embedder, clock,
  config, jobs). Each engine splits into `core/` and `user/`; ESLint stops
  core, world and shared code importing user,
  process or admin-repo code. `src/db` schema + repos in
  `user/` (`userId`-first), `world/`, `admin/` (cross-user); `src/runtime`
  Node implementations; `src/server` Next server helpers; `src/app`
  Next.js; `src/worker` pg-boss, one file per engine; `prompts/`; `evals/`.
  Core-only code takes `CoreDeps` (no `db`); core loops live in `process/core/`.
- Style: Prettier at 100 columns; every file starts with a short plain-English
  header in v3 terms; names follow v3's vocabulary (renames log:
  `docs/2026-10-01-v3-restructure-renames.md`).
- Timestamps come from the injected `Clock`; never `DEFAULT now()`.
- Commands: `pnpm typecheck`, `pnpm lint` (ESLint + Prettier), `pnpm format`, `pnpm test`,
  `pnpm eval --llm=fake --compare`; `pnpm db:up`, `pnpm db:migrate` (dev
  DB only; tests migrate their own), `pnpm worker`, `pnpm db:reset-self`
  (dev only; refuses a non-local DB).
- Drizzle property names for domain tables are snake_case
  (`session_log.user_id`); Better Auth tables use camelCase (required).
- TypeScript is pinned `~6.0` (typescript-eslint doesn't support 7 yet).
- Uncovered choices go in `DECISIONS.md`.
<!-- Not yet decided: branch naming, commit style. -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
