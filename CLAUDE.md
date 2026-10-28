# Spica — Project Context

**Source of truth: `spica-design-spec-v3.md`** (2026-10-01, test phase). Pre-v3 material lives
only at the git tag `v2-final`: history, never built from or cited.

The spec is ~2,800 lines: never read it whole. List its sections with
`grep -n '^##' spica-design-spec-v3.md`, then read only the range you need (the router below names
the sections). Re-read the relevant section before any task that touches the mind, memory, scope,
turn-taking, relationship state, persona, the world or outreach.

Folders with their own `CLAUDE.md` (loaded when you work there): `src/mind/`, `src/db/`,
`tests/`, `evals/`, `prompts/`.

## Router: task → spec → code → prompts
Code paths are under `src/mind/` unless rooted; tests mirror the code under `tests/mind/`; job
handlers are in `src/worker/<engine>-jobs.ts`; every number is in `config/default.json`.

| Area | Spec | Code | Prompts |
|---|---|---|---|
| Behaviour rules, guard | §2, §10.5, §18 | `process/guard/` | `guard/` |
| Crisis | §10.2, §18 | `process/crisis/` | `safety/`, `guard/crisis/` |
| Scope, leak canary | §4 | `platform/core.ts`, `platform/deps.ts`, `tests/exit/mind-split.test.ts` | — |
| Data model | §6 | `src/db/schema.ts`, `src/db/repos/{user,core,world,admin}/` | — |
| Persona, snapshot, drift | §7 | `platform/persona.ts`, `process/core/{render-snapshot,drift-watch}.ts` | `persona/`, `core/snapshot/`, `core/drift/` |
| World, day plan, events | §8.3 | `world/`, `process/core/{world-tick,resolve}.ts`, `src/db/repos/world/` | `life/` |
| Core loops, core state | §8 | `process/core/`, `state/core/`, `memory/core/` | `core/`, `core-state/` |
| User mind | §9 | `process/user/` | `user-mind/` |
| Turn-taking, pacing | §10.1 | `process/turn-taking/`, `process/receive/` | `turn-judge/` |
| Availability | §10.6, §8.4 | `process/availability/` | `life/availability/` |
| Reply (hot path), voice | §10.3 | `process/hot-path/`, `process/deliver.ts` | `reply/`, `voice/` |
| Cold path, extraction | §10.4 | `process/cold-path/`, `memory/user/`, `memory/shared/` | `extract/`, `reconcile/` |
| Relationship | §11 | `state/user/relationship/` | `relationship/` |
| Memory mechanics | §12 | `memory/{core,user,shared}/` | `judge/` |
| Outreach | §13 | `process/outreach/` | `reach-out/` |
| Onboarding | §14 | `process/onboarding/`, `src/app/onboarding/` | `onboarding/` |
| Module bus, public persona | §16 | `platform/{modules,social}.ts`, `src/modules/`, `process/core/public-persona.ts` | — |
| Post engine | §16a | `process/core/{browse,post*}.ts`, `formats/`, `assets/poses/` | `post/` |
| Evals, review runs, inspector | §17 | `evals/`, `src/app/inspector/`, `src/db/repos/admin/` | `eval/` |
| HTTP, SSE, push | §5 | `src/app/api/`, `src/server/`, `src/runtime/` | — |
| Phases · open questions · backlog | §20 · §21 · §25 | `docs/spec-v3-history.md` (built-phase detail, done items) | — |

## Workflow
Skills in `.claude/skills/`, the reviewer in `.claude/agents/`, hooks in `.claude/settings.json`.
- **Start** every task that changes behaviour with `spica-intake`: it routes the task, separates
  verified facts from assumptions and asks Ethan only what changes the build. A fix gets three
  lines and no brainstorming or design doc; a slice gets a design doc, then a plan.
- **Build** test-first for logic. While working, run targeted tests (`pnpm test <path>`,
  `pnpm test --changed`); the full suite (~10 min) runs once, at close.
- **Close** with `spica-close`: definition of done, `scope-reviewer` on the diff, spec
  write-back, commit.
- **Paid runs** go through `review-run`; a hook makes any command that calls a real model ask
  first. Another hook runs ESLint on every edited TS file, so a boundary break shows at the edit.
- **Intent over assumption:** a choice the code, spec or memory doesn't settle, and that Ethan
  would notice, gets asked (batched, recommended option first). Anything else: state it in one
  line, take the simplest option within the scope rules, log it in `DECISIONS.md`.
- **Cost:** read the spec by section and run reviews from the review markdown, never whole logs.
  Execute plans inline; one reviewer subagent per task, not one per plan step, unless Ethan picks
  subagent-driven execution. No subagent for what one grep answers.

## How to read the spec (v3 §0)
- **DECIDED**: implement as written. **LEANING**: the default behind a config flag; "provisional
  (test phase)" means expect change. **PROPOSED**: Claude's suggestion; implement in its phase and
  flag it in the summary or PR. **OPEN**: don't decide; build so every option works, and ask Ethan.
- Build status: **Built** (the code is the detailed record), **Changes in v3**, **New**.
- Build only the **current phase**; later phases stay possible but aren't built early.
- `code style` names are canonical. Every numeric constant goes in config. Every prompt is a
  versioned file under `prompts/`.
- An uncovered choice gets the simplest option that respects the scope rules, plus a one-line entry
  in `DECISIONS.md`. (Spec §26 logs Ethan's design decisions; `DECISIONS.md` logs implementation
  choices the spec doesn't cover.)
- **Test phase: functionality over accuracy.** Get the pipeline working end to end; quality is
  reviewed by hand and tuned together later.
- **A working product first.** Postpone the real framework, security hardening, frontend, DB
  tuning and scaling, but never design them out: keep the seam (an interface, a config key, a
  `ponytail:` comment or a §25 backlog entry). Simplest code that works; delete before adding.
  **Scale target (v3 §0.3):** one user now, never unscalable: rows `user_id`-scoped, work in jobs,
  one-user-only corners marked for "before users".
- **Replace from the ground up** (v3 §0.2): a phase that replaces a module deletes the old module,
  its config keys, prompts, tests, eval scripts and DB columns in the same phase. No shims, no
  flags keeping the old path alive, no dead code.
- **Comments say why, not where from:** never cite spec sections, phases or review item numbers in
  code.
- **Definition of done:** typecheck, lint and tests pass, the phase's exit test passes, **the leak
  canary passes**, and every new field, job, config key or prompt is added back into v3.

## Product (v3 §1)
Spica is a **best friend**, standalone, meant to feel human. Chatbots feel inhuman because they are
over-forgiving, over-agreeable and nothing has consequences, so Spica has opinions, moods, limits,
stakes and **a life of her own**. **One fixed Spica (she/her)**: same core values and voice for
every user; her core self evolves from her own life, never from a user. A relationship changes how
she is *with that person*, not who she is.

## Behavioural rules (v3 §2): enforced in code, not only in prompts
The guard is **on**. The line: **feeling vs tool**, **behaviour vs person**. Allowed: hurt said
plainly, one sarcastic remark about absence, going cool in the moment, sharp jabs at a behaviour,
a mild warm tease, one pointed callback. Blocked: threats, running tallies, coldness kept up as a
campaign, attacks on who they are, harsh mockery of the painful thing, pressure to stay or return.
1. No threats. 2. Hurt shown, then she always makes up. 3. Only the user ends the relationship;
repair is slow but possible. 4. Hurt about absence is hers to show; punishing it is not.
5. Proactive messages capped; a topic used once. 6. Jabs, never contempt.
7. **Crisis carve-out:** all friction and every v3 mechanism suspended; plain support; crisis
resources MUST show; bypasses all waiting. 8. No manipulation for engagement; no streaks, badges,
return rewards or pull-back notifications.

## Scope rules (v3 §4): non-negotiable; leakage and cost are the top risks
- Core (`core` scope, no `user_id`, one for everyone) runs on a schedule; the user mind (per
  `user_id`) runs only on big events. A reply reads both.
- One-way flow: core may be read by user loops and replies; **user data never reaches a core loop's
  input, output or state**. Core loops read only core memory, core state and the world, through
  `CoreDeps` (no `db`, no `user_id` parameter).
- No user's conversation moves core state; what she says about herself in a conversation stays
  user-scoped. Users never mix; cross-user comparison is an offline dev tool only.
- Every exit run includes the **leak canary** and the side-channel test.

## Guardrails (v3 §18): not optional
Crisis check on every message (context, keyword fallback, timeout; the resources card is
guaranteed even if generation fails) · 18+ server-side · `user_id` scoping, encryption at rest,
account deletion only (users can't view or edit her memory) · no explicit engagement features.

## Current phase
**Phase 15 (tuning) is closed** (2026-10-21): slices 15a–15d, the 15d run fixes, no night and
its rerun fixes are built; what each delivered is in `docs/spec-v3-history.md`.
The 2026-10-19 review runs' fixes are built ("this week",
her news never takes the last weekly slot, wander through lived memory, reflect twins, she lives
online). No night: her energy is a battery, she logs off when it runs low at any hour, and
reach-outs skip their night. **Phase 16, the time model, is built** (2026-10-21; B125, B126,
B127): every time a prompt reads is rendered with its distance, her
notes and snapshot carry the day they were written, ideas expire through `fact.stale_after`, and
guard v6 reads NOW in both zones. **No retries** (2026-10-22, side phase, closed): no prompt is
retried or regenerated after a failure, so structural failures show (SDK transport retries kept).
**Haiku 5.5** (2026-10-23, side phase, closed): every Haiku role on `claude-haiku-5-5` with thinking
off; the guard caches its prompt (`models.guard_cache`).
**Phase 16b, time anchors, is built** (2026-10-24): stored text keeps the date each time phrase
meant as a token (`platform/time-anchors.ts`), builders place tokens on their owner's calendar and
one wrapper renders them where prompts reach the model; extract dates from the message's send
time; her view of the conversation has day dividers and glosses; guard v7 `wrong_day` drops a
misdated reach-out; merged 2026-10-24, close runs done (`evals/results/analysis-2026-10-24-phase-16b.md`).
**Phase 16c, time anchor fixes, is built** (2026-10-24): anchoring reads one
clause at a time and whole date phrases, a day said twice is one token, ISO dates anchor, extract's
weekday cross-check is gone (extract v11), a row's own date and the dates her loops were shown
date the words they write; merged, close run done (`evals/results/analysis-2026-10-24-phase-16c.md`).
**Phase 17, labelled memory** (§20 row; phase doc `docs/2026-10-25-phase-17-labelled-memory-design.md`):
what was said is kept as said and every layer of its meaning is labelled apart from it. **17a is
built** (2026-10-25, replay only; analysis `evals/results/analysis-2026-10-25-phase-17a.md`).
**17b, labels as memory, is built** (merged 2026-10-26): the cold path
labels each exchange in three thinking calls (`memory/user/label.ts`, `prompts/labels/v1.md`), keeps
every label in `annotation`, and stores memories as code-built lines (`memory-line.ts`); her view of
older messages is glossed from time labels; extract v11 and its anchoring are gone. Close run done
(`evals/results/analysis-2026-10-26-phase-17b.md`); Phase 16d was settled in it (B129–B131 done,
"since" always points back; B1 narrowed to ideate and B132 left for 17d; new B137, B138).
**17c, turn-taking on labels, is built** (merged 2026-10-26): open questions are the
user's words by coordinate (`turn-taking/questions.ts`), judge v3 cites pieces and merges under the
state lock, her reply's move closes a question (B9), bids are held to reply links.
**17d, notes cite labels, is built** (merged 2026-10-28, close runs done:
`evals/results/analysis-2026-10-27-phase-17d.md`): her user-mind notes cite
memories and threads by id with whose each is, label their own time words, and are retired when a
memory they cite is superseded (`platform/notes.ts`). **17e, core notes on labels, is built** (2026-10-28, branch
`phase-17e`): every core writer labels its own time words and may cite her memories, a citation
rendered as the memory's date (`memory/core/citables.ts`); core-role calls think; the Phase 16
parser (`anchorTimes`, chrono-node, shown dates) is deleted. Close runs (`exit:core-day`,
`review:world-outreach`, `exit:long`) await Ethan's go; they close Phase 17.
B35 waits on his reply-model comparison; Publishing, Video and Frontend come later. Persona v7's
drafted lines await Ethan's full persona rewrite, planned with Claude in a later phase. Each phase
or slice starts with a design doc in `docs/`; built plans are deleted (history is in git).
CI (`.github/workflows/ci.yml`) runs typecheck, lint and tests on every push to main.

## Open decisions (v3 §21): ask Ethan, don't settle
1 big-event triggers · 2 core values split · 3 faces limit · 4 core vs what she told a user ·
6 drift response · 8 attachment at onboarding · 9 phase order.

## Working conventions
- Stack: TypeScript, Next.js App Router, Postgres 16 + pgvector (pg-boss jobs in the same DB),
  Drizzle, Better Auth, Vitest, pnpm. Models behind `LLMProvider` (Sonnet for replies, Haiku for
  everything else); embeddings behind `Embedder`.
- `src/mind` framework-free; `src/db` schema and repos; `src/runtime` Node implementations;
  `src/server` Next server helpers; `src/app` Next.js; `src/worker` pg-boss, one file per engine.
- Prettier at 100 columns; every file starts with a short plain-English header in v3 terms; names
  follow v3's vocabulary (`docs/2026-10-01-v3-restructure-renames.md`).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test`,
  `pnpm eval --llm=fake --compare`; `pnpm db:up`, `pnpm db:migrate` (dev DB only), `pnpm worker`,
  `pnpm db:reset-self` (dev only).
- TypeScript is pinned `~6.0` (typescript-eslint doesn't support 7 yet).
<!-- Not yet decided: branch naming, commit style. -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
