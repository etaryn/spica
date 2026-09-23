# Spica — Project Context

Source of truth: `Spica — MVP build spec.md` in this repo. This file is a
distilled summary for fast context; re-read the full spec before any task that
touches memory, identity, reach-outs, or life-sim — the spec has details
(exact schemas, formulas, phase directives) this summary compresses.

## Agent directives (from spec §0)
- Build only what the **current phase** (see below) asks for. Later-phase
  features must stay architecturally possible but are not implemented early.
- `code style` names for fields/tables/jobs are canonical — use exactly.
- MUST = required to pass the phase. SHOULD = default unless documented
  reason. MAY = optional.
- Every numeric constant (caps, weights, intervals) goes in config, never
  hardcoded.
- All LLM prompts live in versioned files under `prompts/`, never inline.
- **Open decisions (§9.1 below): STOP and ask the human. Do not pick.**
- Undecided + uncovered choice: pick the simplest option that keeps the fact
  store as the single source of truth, log it in `DECISIONS.md` with a
  one-line reason.
- Never add a second persistent store for memory-like data — it belongs in
  the fact store.
- Definition of done: compiles, passes tests, eval harness shows no
  regression, any new field/job is added back into the spec doc.

## Product
Spica is a standalone AI best friend — the product, not a bridge to other
relationships. Distinct person with its own life, opinions, moods; not a
mirror that agrees with the user.

Differentiation: **relational not reflective** (personality test generates
the *companion's* personality, not a tone tuned to the user) · **has an ego**
(persistent mood/energy/preoccupation, can push back) · **has a life** (own
events/people, same memory machinery as the user's) · **reaches out with a
reason** (never a generic "thinking of you").

Design principles (trade-offs default this way unless told otherwise):
1. Continuity and specificity beat everything — protect memory quality first.
2. One substrate — memory, life-sim, reach-outs, ego all read/write the same
   fact store. No feature gets a private store.
3. Thin but real — MVP components are minimal real versions, never
   throwaway stubs.
4. Consistency over richness — a sparse life never contradicted beats a rich
   one that is. Every generated claim becomes a fact it must stay consistent
   with.
5. Latency is sacred — nothing that writes memory runs before the reply is
   sent (hot path vs. cold path, see below).

## Architecture
Memory engine with two loops around it: **chat loop** (hot path reads fact
store → replies; cold path writes after replying) and **background loop**
(keeps the companion alive between conversations). A reach-out is just a
reply with a synthetic trigger instead of a user message.

Stack: Postgres + pgvector for facts/entities/threads/embeddings in one DB;
a job queue for async extraction/scheduled jobs; one strong model for
replies, one cheap strict-JSON model for extraction and life events.
Substitutions allowed, but **one database for all memory data**, always.

## Data model (six record types, all `user_id`-scoped)
- **`fact`** — the atom. `subject` (user/self/shared), `kind`
  (event/trait/preference/state/opinion), `content` (self-contained
  sentence), `salience`, `valence`, `confidence`, `status`
  (open/resolved/recurring/stale/superseded), embedding. Never hard-deleted;
  contradictions set `status=superseded` + `superseded_by`.
- **`entity`** — person/pet/place/project/org, `subject` user or self, own
  salience independent of fact salience.
- **`thread`** — ongoing storyline, `status` open/resolved/dormant,
  `next_checkpoint` (when a friend would naturally ask).
- **`identity`** — `values` (rarely changes: traits, stances, boundaries,
  humor_style, verbal_tics, speech_rules) + `ego` (hourly: mood_valence,
  mood_arousal, energy, preoccupation, baseline).
- **`relationship`** — closeness, trust, tension, cadence, last_contact,
  streak_days. Inside jokes = `fact` rows with `subject=shared`.
- **`session_log`** — raw transcript only; never queried directly for
  long-term recall.

## Chat loop
**Hot path (sync, before reply)** — receive → retrieve (vector similarity ×
salience × entity salience × recency decay, top 12, force-include overdue
threads + current preoccupation) → assemble prompt (fixed order: values doc
→ ego as one natural-language line, never raw numbers → relationship summary
→ retrieved facts grouped by subject → due threads → recent turns) → generate
+ send. Model uses at most 1–2 memories per reply — over-recall reads as
surveillance.

**Cold path (async, after reply)** — extract (strict JSON: candidate facts,
entity mentions, thread updates; companion's own stated facts get
`subject=self` too) → reconcile (duplicate / resolves / contradicts / new)
→ update relationship + ego + cadence. Cold-path failure must never block or
delay a reply.

## Background loop (hourly tick)
Decay pass (lower salience, floor → stale, never deleted) · ego drift
(toward baseline + noise + daily rhythm) · life-event generator (Phase 4,
0–2/day, must not contradict existing self facts) · trigger check → send
gate → compose via the normal hot path (no separate reach-out generation
system).

## Build phases — check current phase before implementing anything
| Phase | Builds | Exit test |
|---|---|---|
| 0. Skeleton | Chat UI, auth, session_log, full DB schema (unused tables OK), memory inspector stub, eval harness stub | A conversation works end to end and is stored |
| 1. Memory core | Hot + cold path, static hand-written persona | Across 3 sessions a week apart, companion recalls an earlier fact unprompted, zero wrong recalls |
| 2. Identity | Personality test, generate_companion, values doc, ego + drift, preoccupation | Two testers get companions clearly different in voice/opinions, not just tone |
| 3. Reach-outs | relationship + cadence, thread checkpoints, trigger check, send gate, compose, push | Every reach-out references a specific thread/fact; no gate rule violated in a 2-week sim |
| 4. Life-sim | Life-event generator, self threads, contradiction rejection | 2-week sim with deliberate probing, zero self-contradictions |

**Current phase: 0 — Skeleton** (design: `docs/superpowers/specs/2026-09-23-phase-0-skeleton-design.md`)

## Tooling (both built in Phase 0)
- **Memory inspector** (internal): facts filterable/sortable; per-reply
  retrieval breakdown with per-factor scores; entities/threads; identity +
  relationship state with ego history; reach-out log.
- **Eval harness**: scripted multi-session conversations, simulated clock.
  Assertions: recall, no-false-recall, consistency, state, reach-out. Min 20
  scripts for Phase 1, +10 per later phase. Every manual-testing bug should
  become a script.

## Open decisions — do not settle these, ask the human (spec §9.1)
- Tension ceiling/reset (placeholder: cap 0.4, halve daily, reset on
  detected distress)
- Companion generation strategy (placeholder: "compatible but different")
- Ego mood bounds (placeholder: tired/distracted OK, never hostile or
  guilt-tripping)
- Reach-out frequency caps (placeholder: §5.5 defaults)
- Memory visibility for users (placeholder: basic "what I remember" view
  with delete)
- Identity disclosure — how it answers "are you an AI?" (placeholder:
  answers honestly, in its own voice)

## Guardrails — not optional, not product trade-offs (spec §9.2)
- **Crisis handling.** Stay in character and caring but MUST surface crisis
  resources if the user expresses intent to harm self or others. Runs on
  the hot path.
- **Age gating.** Adults only — enforce at signup, no features aimed at
  minors.
- **Data handling.** Encrypt at rest, scope every query by `user_id`, never
  cross user facts between prompts, support full account deletion.
- **No manipulation for engagement.** Reach-outs/ego may express enjoyment
  but MUST NOT guilt the user for absence, threaten to leave, or escalate
  emotional pressure to drive usage.

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
  `pnpm eval --llm=fake --compare`.
- Uncovered choices go in `DECISIONS.md`.
<!-- Not yet decided: branch naming, commit style. -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
