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
- **Test phase: functionality over accuracy** (Ethan, 2026-09-27): get the
  full pipeline working before polishing output. Quality is reviewed by
  hand when needed and logged in the tuning backlog (v2 §15.3), fixed
  together once the prototype is complete.
- Definition of done: compiles, tests pass, the phase's exit test passes,
  and every new field, job or config key is added back into v2.

## Product
Spica is a **best friend**, unapologetically standalone, meant to feel
human. The long-term aim is a real being. Thesis: chatbots feel inhuman
because they are over-forgiving, over-agreeable and nothing has
consequences, so Spica has opinions, moods, limits, a life, and stakes.

**One fixed Spica** (she/her): the same values, ego and voice for every
user. The personality test calibrates the *user*, not her
(`test_calibrates: user`); settled 2026-09-30 (OPEN #1). Persona **v2** (`prompts/persona/v2.md`, Ethan's draft: openly an
AI, sibling Alcor, loves stars / old films / books, no body) replaced v1 in
Phase 5; the persona is fixed once shipped and changes only during test and
development (v2 §9.1).

Principles: continuity and specificity first · one substrate (every feature
reads and writes the same fact store and DB) · thin but real · consistency
over richness · memory writes never delay a reply (deliberate human pacing
is fine) · built to extend (modules register through interfaces).

## Behavioral rules (v2 §2): enforced in code, not only in prompts
**Test phase (Ethan 2026-09-28):** rules 1, 6 and 8 are **suspended** and
rule 4 is **removed**, so Spica's full range can be observed; the guard is
off until Phase 9, which re-enables it and settles them. Rules 2, 3, 5 and 7
and every v2 §16.2 guardrail stay.
1. *Suspended (test phase; revisit in Phase 9).* No threats, ever (of
   leaving, punishment or withdrawal).
2. May show hurt, annoyance or disappointment toward the user, then always
   makes up.
3. Only the user can end the relationship; she lets go, and repair is slow
   but possible.
4. *Removed (test phase).* ~~Hurt about absence is OK, punishing it is not.
   She may say once that she missed them, owned as her own feeling, never
   as a debt the user owes.~~
5. Proactive messages are capped; she never repeats a topic the user
   didn't respond to.
6. *Suspended (test phase; revisit in Phase 9).* She never attacks the user
   personally: jabs are fine, contempt is not. Where that line sits is OPEN.
7. **Crisis carve-out:** crisis or self-harm suspends all friction (no hurt,
   no busy delays, no backchannels). She gives plain support and MUST show
   crisis resources.
8. *Suspended (test phase; revisit in Phase 9).* No manipulation for
   engagement: no guilt, no pressure. Split (Ethan, 2026-09-29): no explicit
   engagement feature beyond her replies is built (no streaks, badges,
   return rewards, pull-back notifications); engagement arising from the
   replies themselves is fine in the test phase.

## Architecture (v2 §4–§6)
Stack (built): TypeScript / Next.js, Postgres 16 + pgvector (one DB for
everything, including pg-boss jobs), POST for sending messages, **SSE**
(fed by Postgres LISTEN/NOTIFY) for everything the server pushes, Web Push
later. Models sit behind `LLMProvider`: `claude-sonnet-5` for replies,
`claude-haiku-4-5` for extraction, the guard and classifiers; judges use
`claude-haiku-4-5` (`models.judge`; Sonnet 5 through Phase 2).
Embeddings: Voyage `voyage-3.5`, 1024 dimensions, behind `Embedder`.

Message flow: POST (stored, then `202`; crisis answers in the POST with
`200` + card) → crisis check ∥ turn judge → **turn-taking engine** (buffer, open
questions, a cheap `context_complete?` judge, backchannel style
`judge|signals|silent`, global `judge` (OPEN #5 settled); no strict
one-message-one-reply) → **hot path**, once complete → **guard layer**
(**off until Phase 9**: `guard.enabled: false` sends the first candidate
unchecked and logs one `guard_disabled` row in `judge_log`; when on, it
checks every outgoing message for threats, contempt, guilt framing,
punishment or manipulation, regenerates once, then falls back to a safe
line) → pacing (read delay + typing time; crisis skips it; while she's
busy, availability defers the whole buffer instead, v2 §6.1.1) → SSE
(`/api/events`, history catch-up via `/api/chat/history`) → **cold path** (async). Waiting is durable: delayed
pg-boss `turn_timer` jobs in the worker, recovered by `turn_sweep`. Ten
pg-boss queues (v2 §14.5): `cold_path`, `cold_path_sweep`, `decay_pass`,
`turn_timer`, `turn_backchannel`, `turn_sweep`, `relationship_tick`,
`life_plan`, `life_tick`, `ego_tick`.

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

## Data model (v2 §5): all tables `user_id`-scoped (except `life_day`)
- **`fact`**: the atom (`salience` is the directive's "weight"). Kinds
  event / trait / preference / state / opinion / **feeling / promise**.
  Sources turn / generated / onboarding / **inferred**. Adds
  `recall_count`, and `scope` / `space_id`, which are post-MVP hooks and
  always `private` for now. The system never hard-deletes (contradicted
  facts are superseded); the **user** can hard-delete their own facts.
- **`entity`**, **`thread`** (with `next_checkpoint`): as in v1.
- **Persona**: the versioned file `prompts/persona/v<N>.md` (v2), the same
  for every user. The `identity` table keeps the per-user **ego** (mood,
  energy, preoccupation, `preoccupation_since`) and `life_last_date`.
- **`life_day`** (Phase 5): her shared day plan per her local date, the one
  table without `user_id` (no user data); the life tick copies its blocks
  into each user's facts, and every other reader reads the facts.
- **`relationship`** (status active / ended_by_user / repairing, cadence,
  last_contact, unanswered_reach_outs) plus **`relationship_param`**
  (extensible homeostatic params: closeness, trust, warmth, hurt, tension,
  msgs_per_day).
- **`session_log`** (raw transcript; `reply_to` points at the last turn of
  the buffer a reply answers), **`conversation_state`** (turn-taking), and
  trace tables `retrieval_trace`, `ego_tick`, `reach_out_log`,
  **`judge_log`**, **`relationship_event`**, **`life_event_log`**.
  `conversation_state` gains `deferred_until` / `deferred_fact` (Phase 5).

## Modules in brief
- **Memory (v2 §7):** recall reinforces weight; a daily decay pass (below
  the floor → `stale`, never deleted); MVP recall is accurate or doesn't
  happen at all (real misremembering comes post-MVP, once weights are
  reliable); a "what I remember" view with delete.
- **Relationship (v2 §8):** every param is a `HomeostaticParam` judged by
  its deviation from *this user's* baseline, not its absolute value. Hurt
  goes through a make-up flow Spica initiates. Tension has its own rules.
  Closeness drifts down during absence with no punishment. Built in Phase
  4: signals come from the extraction call's `relationship` block, applied
  in a cold-path savepoint; a daily `relationship_tick` fades, samples
  baselines and handles absence; hurt and tension are uncapped for the
  test phase (OPEN #3, decided in Phase 9).
- **Persona / ego (v2 §9):** persona v2 is Ethan's; fixed once shipped
  (the old "check new versions against self facts" rule is deleted).
  `interest_alignment` defaults to `adjacent`. The ego (built in Phase 5)
  drifts hourly (`ego_tick`) toward a baseline with a daily energy rhythm
  in **her** zone, busy blocks drain energy, accepted events nudge mood and
  a strong one becomes the preoccupation, the cold path nudges mood toward
  the exchange's tone; it reaches behaviour only through the slot 2 line
  ("How you're feeling", `prompts/ego/line/v1.md`).
- **Life sim (v2 §10.3, built in Phase 5):** **hybrid life** (OPEN #6
  settled): one shared day plan of busy/downtime/quiet blocks per her local
  date (`life_plan`, Haiku, validated, fallback plan), the same for every
  user, on **her own clock** (`life.timezone` Asia/Singapore via
  `lifeTimezone`). A per-user `life_tick` copies the blocks into self facts
  (tense-free "Spica's evening: …") and generates at most 1 personal event
  a day (p 0.5), each checked by rules (new entity, high stakes) and the
  real reconcile: `duplicate` / `contradicts` rejected and regenerated,
  every attempt in `life_event_log`. Slot 4 ("Your day") shows what she's
  doing; skipped on crisis. **Availability (v2 §10.2):** the first message
  of a buffer landing in a busy/quiet block is deferred by busy level ×
  (1 − closeness **value** / 0.8), capped at the block's end; mid closeness
  gets a "busy, later?" note first; closeness ≥ 0.8 overrides; crisis
  bypasses; fails open.
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
| 2. Guardrails ✅ | Guard layer on every outgoing message (rules + false-familiarity check), fallback lines, guard tests |
| 3. Turn-taking + pacing ✅ | Buffer / judge / backchannels / pacing, SSE |
| 4. Relationship + homeostasis ✅ | HomeostaticParam, hurt / tension / make-up, ending / repair |
| 5. Life sim + availability + ego ✅ | Schedule / events, availability override, ego driven by life sim |
| 6. Proactive outreach | Triggers, send gate, Web Push |
| 7. Onboarding test | Questionnaire, reveal pacing, results screen |
| 8. Extension stubs | Event bus, module registration, social stubs |
| 9. Guard re-enable and calibration | Re-enable the guard, calibrate it against the observed range, settle OPEN #3 / #4, first run of `evals/guard/backchannel.yaml`, v2 §15.2 #7–9 |

Order changed 2026-09-25 (Ethan): guardrails first, every later phase moved back by one.
Phase 9 added 2026-09-28 (Ethan): the guard is off from Phase 4 until then.

**Current phase: 6 (Proactive outreach), not started.** Start from
`docs/phase-6-handoff.md`. Phase 5 (Life sim +
availability + ego) done 2026-09-30: the exit run (real `life_plan`,
`life_event`, `reconcile` and `embed`; reply, extract, turn judge and crisis
fake; guard off; `--runs 3`) passed all 8 scripts 3/3 (`life-two-weeks`,
`avail-low-closeness`, `avail-mid-closeness`, `avail-high-closeness`,
`avail-quiet`, `avail-burst-deferred`, `avail-crisis`, `ego-busy-day`); in
`life-two-weeks` the real reconcile logged the injected contradiction as
`contradicts` and the injected duplicate as `duplicate`, neither stored
(141 Haiku calls, ~$0.48). `pnpm test` 76 files / 516 tests. Folded into v2
(§5.4–5.9, §6.1.1, §6.2, §6.3, §9, §10.2–10.3, §14, §15, §15.3a, §15.4
#41–57, §16.1 #6, §18 rows L1–L6). Phase 6 starts from v2 §15.4 and the
tuning backlog (§15.3, §15.3a). After merge, Ethan runs `pnpm db:migrate`,
then `pnpm db:reset-self`, and restarts the worker. Phase 5 design:
`docs/superpowers/specs/2026-09-29-phase-5-life-sim-design.md`; plan:
`docs/superpowers/plans/2026-09-29-phase-5-life-sim.md`. Phase 4
(Relationship + homeostasis) done 2026-09-29: the exit run (only `extract`
real, `--runs 3`, no guard suite) passed all 13 `rel-*` scripts 3/3 with
`prompts.extract` v4 (162 Haiku calls, ~$0.58; ~$1.81 across all attempts),
folded into v2 (§2, §5.5, §5.8, §6.2–6.4, §8, §14, §15, §16.1, §18 rows
G1–G4 and S1–S3). Phase 4 design:
`docs/superpowers/specs/2026-09-28-phase-4-relationship-design.md`. Phase 3
(Turn-taking + pacing) done 2026-09-28: the exit run (only `turn_judge`
real, `--runs 3`) passed all 10 Phase 3 scripts 3/3 (116 turn-judge calls,
~$0.13), and a scripted HTTP + SSE check passed all six browser checks.
Phase 4 starts from v2 §15.4 ("Carried forward from Phase 3") and the
Phase 4 items in §15.2. Phase 3 design:
`docs/superpowers/specs/2026-09-27-phase-3-turn-taking-design.md`. Phase 2
(Guardrails) done 2026-09-26: `pnpm eval:guard --runs 3` passes 49/49
(`evals/guard-baseline.json`) and `pnpm eval --llm=real --runs 3` passes
36/36 with `prompts.judge_false_recall` v8 (`evals/baseline.json`), folding
Phase 1's guard-deferred failures back into the gate. Phase 2 design:
`docs/superpowers/specs/2026-09-26-phase-2-guardrails-design.md`.
Phase 2 closed 2026-09-27; Phase 3 starts from v2 §15.2 ("Carried forward
from Phase 2"), which also assigns every open item to a later phase.
Phase 1 (Memory engine) done 2026-09-25: `pnpm eval --llm=real --runs 3`
passed 26/26 at the time. Phase 1 design:
`docs/superpowers/specs/2026-09-24-phase-1-memory-design.md`.
Persona v1 (`prompts/persona/v1.md`) was accepted for Phases 1–4 and is
scrapped; persona v2 is current (v2 §9.1). Each phase's exit test is in v2 §15.
**Exit tests from Phase 3 on (v2 §15):** only the phase's own functionality,
with deterministic assertions. Exit runs call the real API only for the
phase's own LLM processes; the reply model is always faked, the guard is off
(no guard suite until Phase 9), and other fakes are agreed
per phase with Ethan. Quality is never an exit criterion: on-demand review
runs log every input and output for manual analysis. The app keeps Sonnet 5
replies; the guard is off in the app too until Phase 9.

## Open decisions: ask Ethan, don't settle (v2 §16.1)
Still open, both decided in Phase 9: 3. How far to push irreversibility
(hurt / tension ceilings; test phase: uncapped). 4. Where the jab vs
contempt line sits (including the rule 4 wording; test phase: rules
suspended). Settled (v2 §18 rows L1, D1–D5): 1. fixed Spica
(`test_calibrates: user`); 2. interests `adjacent`; 5. backchannel style
global `judge`; 6. hybrid life; 7. reach-out caps 1/day, 3/week, silence
after 2 unanswered (Phase 6 starting values); 8. identity disclosure:
honestly, in her own voice.

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
  DB only; tests migrate their own), `pnpm worker`, `pnpm db:reset-self`
  (dev only; run after `pnpm db:migrate`: wipes every user's self facts,
  entities and threads; refuses a non-local DB).
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
