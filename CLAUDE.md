# Spica — Project Context

**Source of truth: `spica-build-spec-v2.md`** (merged 2026-09-24 from the v1
spec and Ethan's build directive; conflicts resolved with Ethan and logged in
its §18). `Spica — MVP build spec.md` (v1) and `spica-build-directive.md` are
superseded and kept for history only; do not build from them.

This file is a distilled summary. Re-read the relevant v2 section before any
task that touches memory, turn-taking, relationship state, persona, life sim
or outreach: v2 has the exact schemas, formulas and phase directives that
this summary compresses.

## How to read the spec (v2 §0)
- **DECIDED**: implement as written. **LEANING**: implement the default
  behind a config flag. "Provisional (testing phase)" means expect it to
  change after real use. **OPEN**: don't decide; build so either option
  works, and ask Ethan. **ADDED**: Claude's suggestion, not yet confirmed;
  flag it in the summary or PR.
- Build only the **current phase**; later phases stay possible but aren't
  built early.
- `code style` names are canonical. Every numeric constant goes in config.
  Every prompt is a versioned file under `prompts/`.
- An uncovered choice gets the simplest option that keeps the fact store the
  single source of truth, plus a one-line entry in `DECISIONS.md`.
- Never add a second persistent store for memory-like data.
- Definition of done: compiles, tests pass, eval harness shows no
  regression, and every new field, job or config key is added back into v2.

## Product
Spica is a **best friend**, unapologetically standalone, meant to feel
human. The long-term aim is a real being. Thesis: chatbots feel inhuman
because they are over-forgiving, over-agreeable and nothing has
consequences, so Spica has opinions, moods, limits, a life, and stakes.

**One fixed Spica** (she/her): the same values, ego and voice for every
user. The personality test calibrates the *user*, not her
(`test_calibrates: user`). Whether Spica should instead vary per user is
still OPEN.

Principles: continuity and specificity first · one substrate (every feature
reads and writes the same fact store and DB) · thin but real · consistency
over richness · memory writes never delay a reply (deliberate human pacing
is fine) · built to extend (modules register through interfaces).

## Behavioral rules (v2 §2): enforced in code, not only in prompts
1. No threats, ever (of leaving, punishment or withdrawal).
2. May show hurt, annoyance or disappointment toward the user, then always
   makes up.
3. Only the user can end the relationship; she lets go, and repair is slow
   but possible.
4. Hurt about absence is OK, punishing it is not. She may say once that she
   missed them, owned as her own feeling, never as a debt the user owes.
   (Provisional, testing.)
5. Proactive messages are capped; she never repeats a topic the user
   didn't respond to.
6. She never attacks the user personally: jabs are fine, contempt is not.
   Where that line sits is OPEN.
7. **Crisis carve-out:** crisis or self-harm suspends all friction (no hurt,
   no busy delays, no backchannels). She gives plain support and MUST show
   crisis resources.
8. No manipulation for engagement: no guilt, no pressure, no streaks.

## Architecture (v2 §4–§6)
Stack (built): TypeScript / Next.js, Postgres 16 + pgvector (one DB for
everything, including pg-boss jobs), POST for sending messages, **SSE**
(fed by Postgres LISTEN/NOTIFY) for everything the server pushes, Web Push
later. Models sit behind `LLMProvider`: `claude-sonnet-5` for replies,
`claude-haiku-4-5` for extraction, judges, the guard and classifiers.
Embeddings: Voyage `voyage-3.5`, 1024 dimensions, behind `Embedder`.

Message flow: receive → crisis check → **turn-taking engine** (buffer, open
questions, a cheap `context_complete?` judge, backchannel style
`judge|signals|silent`, default `judge` provisionally; no strict
one-message-one-reply) → **hot path**, once complete → **guard layer**
(checks every outgoing message for threats, contempt, guilt framing,
punishment or manipulation; regenerates once, then falls back to a safe
line) → pacing (read delay + typing time; availability stretches it,
crisis skips it) → SSE → **cold path** (async).

- **Hot path:** retrieve (similarity × salience × entity salience × recency,
  top 12, plus due threads and the current preoccupation forced in; recall
  reinforces weight) → assemble in fixed order (persona doc → ego line →
  relationship summary → life state → facts by subject → due threads → open
  questions → recent turns) → **one** generation + **one** guard check. She
  uses at most 1–2 memories per reply.
- **Cold path:** extract (strict JSON: facts including feeling/promise,
  entities, thread updates with checkpoints; her own stated facts get
  `subject=self`) → reconcile (duplicate / resolves / contradicts / new;
  approach A, DECIDED) → update state (incl. recall write-back: the hot
  path is read-only).
  A cold-path failure never blocks a reply.
- A reach-out is a reply with a synthetic trigger, composed through the
  same hot path and guard.

## Data model (v2 §5): all tables `user_id`-scoped
- **`fact`**: the atom (`salience` is the directive's "weight"). Kinds
  event / trait / preference / state / opinion / **feeling / promise**.
  Sources turn / generated / onboarding / **inferred**. Adds
  `recall_count`, and `scope` / `space_id`, which are post-MVP hooks and
  always `private` for now. The system never hard-deletes (contradicted
  facts are superseded); the **user** can hard-delete their own facts.
- **`entity`**, **`thread`** (with `next_checkpoint`): as in v1.
- **Persona**: the versioned file `prompts/persona/v<N>.md`, the same for
  every user. The `identity` table keeps the per-user **ego** (mood,
  energy, preoccupation).
- **`relationship`** (status active / ended_by_user / repairing, cadence,
  last_contact, unanswered_reach_outs) plus **`relationship_param`**
  (extensible homeostatic params: closeness, trust, warmth, hurt, tension,
  msgs_per_day).
- **`session_log`** (raw transcript; `reply_to` points at the last turn of
  the buffer a reply answers), **`conversation_state`** (turn-taking), and
  trace tables `retrieval_trace`, `ego_tick`, `reach_out_log`,
  **`judge_log`**, **`relationship_event`**.

## Modules in brief
- **Memory (v2 §7):** recall reinforces weight; a daily decay pass (below
  the floor → `stale`, never deleted); MVP recall is accurate or doesn't
  happen at all (real misremembering comes post-MVP, once weights are
  reliable); a "what I remember" view with delete.
- **Relationship (v2 §8):** every param is a `HomeostaticParam` judged by
  its deviation from *this user's* baseline, not its absolute value. Hurt
  goes through a make-up flow Spica initiates. Tension has its own rules.
  Closeness drifts down during absence with no punishment.
- **Persona / ego (v2 §9):** Claude drafts persona v1 and Ethan edits it.
  The persona is iterable, but a new version must not contradict existing
  self facts. `interest_alignment` defaults to `adjacent`. The ego is
  driven by the life sim and reaches behaviour only through the one prompt
  line.
- **Life sim (v2 §10):** MVP is a shared canon (in the persona doc) plus a
  per-user daily life (busy/downtime blocks, 0–2 small events a day) stored
  as self facts, with contradiction rejection. Higher closeness overrides
  busy. (Shared vs per-user life is OPEN and a heavy decision.)
- **Outreach (v2 §11):** caps of 1/day and 3/week (placeholders), quiet
  hours, her busy blocks, never repeating a topic, silence after 2
  unanswered reach-outs until the user writes.
- **Onboarding (v2 §12):** the test's results become user facts with
  reduced confidence, and **reveal pacing** keeps them hidden until
  they're earned in conversation.
- **Extension hooks (v2 §13):** an event bus plus `scope` / `space_id`, a
  `SocialChannel` interface and a `public_persona` stub. Hooks only; the
  features themselves aren't built.

## Build phases (v2 §15): check the current phase before implementing
| Phase | Builds |
|---|---|
| 0. Skeleton ✅ | Chat UI, auth, session_log, full schema, crisis check, inspector, eval harness |
| 1. Memory engine ✅ | Extraction, reconcile, weighted retrieval, recall reinforcement, decay, threads + checkpoints, memory view, schema additions, **persona doc v1** |
| 2. Guardrails | Guard layer on every outgoing message (rules + false-familiarity check), fallback lines, guard tests |
| 3. Turn-taking + pacing | Buffer / judge / backchannels / pacing, SSE |
| 4. Relationship + homeostasis | HomeostaticParam, hurt / tension / make-up, ending / repair |
| 5. Life sim + availability + ego | Schedule / events, availability override, ego driven by life sim |
| 6. Proactive outreach | Triggers, send gate, Web Push |
| 7. Onboarding test | Questionnaire, reveal pacing, results screen |
| 8. Extension stubs | Event bus, module registration, social stubs |

Order changed 2026-09-25 (Ethan): guardrails first, every later phase moved back by one.

**Current phase: 2 (Guardrails), not started.** Phase 1 (Memory engine) done
2026-09-25: `pnpm eval --llm=real --runs 3` passes 26/26 and is the real
baseline in `evals/baseline.json`. Phase 1 design:
`docs/superpowers/specs/2026-09-24-phase-1-memory-design.md`.
Phase 2 starts from v2 §15.1 ("Carried into Phase 2"). Phase 1's known
failures are reported but don't count, and are Phase 2's first targets: implied familiarity ("what's the role again?"),
invented specific details and onboarding facts presented as past chat are
deferred to the Phase 2 guard; knowing a fact without naming it is deferred
to later recall-style tuning. Misremembering what the user said still fails.
Persona v1 (`prompts/persona/v1.md`) accepted by Ethan for the test phase
(v2 §9.1). Each phase's exit test is in v2 §15.

## Open decisions: ask Ethan, don't settle (v2 §16.1)
1. Fixed vs variable Spica. 2. Whether interests need to match. 3. How far
to push irreversibility (hurt / tension ceilings). 4. Where the jab vs
contempt line sits (including the rule 4 wording). 5. Whether the
backchannel style is global or per user. 6. Shared vs per-user life (heavy
decision). 7. Final reach-out caps. 8. Identity disclosure ("are you an
AI?"; placeholder: answer honestly, in her own voice).

## Guardrails: not optional (v2 §16.2)
- **Crisis handling:** checked on every message using recent context, with
  a keyword fallback; bypasses all waits and friction; the resources card
  is guaranteed, even when reply generation fails.
- **Age gating:** 18+, enforced on the server.
- **Data handling:** encryption at rest; `user_id` scoping; never mix users'
  facts; account and per-fact deletion.
- **No manipulation for engagement.**

## Working conventions
- Stack: TypeScript, Next.js (App Router), Drizzle, Postgres 16 + pgvector
  (`docker-compose.yml`), pg-boss, Better Auth, Vitest, pnpm.
- Models: Anthropic (reply + cheap) behind `LLMProvider`; Voyage
  `voyage-3.5` (1024-dim) behind `Embedder`. IDs in config.
- Layout: `src/core` is framework-free (no Next imports, no `Date.now()`,
  no `process.env` — use injected `Deps`); `src/db` schema + `userId`-first
  repos; `src/app` Next.js; `src/worker` pg-boss; `prompts/`; `evals/`.
- Timestamps come from the injected `Clock`; never `DEFAULT now()`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm eval --llm=fake --compare`; `pnpm db:up`, `pnpm db:migrate` (dev
  DB only; tests migrate their own), `pnpm worker`.
- Drizzle property names for domain tables are the spec's snake_case names
  (`session_log.user_id`); Better Auth tables use camelCase (required).
- TypeScript is pinned `~6.0` (typescript-eslint doesn't support 7 yet).
- Uncovered choices go in `DECISIONS.md`.
<!-- Not yet decided: branch naming, commit style. -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
