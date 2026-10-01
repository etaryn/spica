# v3 restructure: design

Date: 2026-10-01. Status: implemented on branch v3-restructure.

## Purpose

v3 is Ethan's own way of structuring Spica. The code built in phases 0–6
follows Claude's default patterns instead. Before Phase 7 starts, every
built module is reorganised, renamed and rewritten so the code reads in
v3's terms and Ethan can understand and work with it. Outdated features are
removed.

Phase numbering is unchanged: 0–6 are built, and v3's phases are 7–13. This
restructure is not a phase. It changes no behaviour except the removals
listed below.

## Decisions (from Ethan)

- **Layout: by engine** (v3 §3.1): memory, state, world, process, plus
  platform for plumbing.
- **Each engine splits by scope** into `core/` and `user/` subfolders. A
  lint rule enforces the one-way flow (V2).
- **The per-user ego and the per-user life tick stay until Phase 7.** They
  move unchanged into `legacy-*` folders, and Phase 7 deletes them when it
  builds the core replacements.
- **Readable rewrite:** v3 names, short functions, one idea per line,
  Prettier at 100 columns, and a plain-English header in every file.

## 1. Layout

`src/core` becomes `src/mind`, so the word "core" means only the core mind.
`src/mind` stays framework-free: no Next.js imports, no `Date.now()`, no
`process.env`, everything through `Deps`.

```
src/mind/
  memory/
    shared/        ranking.ts (was score) · types.ts
    user/          extract · reconcile · encode (was apply) · retrieve · decay
    core/          (empty until Phase 7)
  state/
    user/          relationship: params (was homeostasis) · signals · transitions
                   update (was apply) · daily-tick (was tick) · cadence · summary · types
    core/          (empty until Phase 7)
    legacy-ego/    ego · nudge · tick · line            (Phase 7 deletes)
  world/
    her-clock.ts   (was life/clock)
    day-plan.ts    (was life/plan)
    legacy-life-tick/  tick · events · blocks           (Phase 7 deletes)
  process/
    receive/       receive-turn (was chat/receive) · session
    turn-taking/   receive-message · judge · cues · state · transitions · pacing
                   commit-and-reply (was reply) · sweep
    availability/  deferral (was availability) · busy-note (was availability-note)
    hot-path/      compose (was compose-reply) · assemble · split-parts (was parts)
                   your-day-line (was life/state)
    cold-path/     cold-path · sweep (was memory/sweep)
    crisis/        classifier (was safety/crisis) · keywords
    guard/         guard · categories · fallback · keywords · outgoing
    outreach/      tick · candidates · gate · send · inputs · answered · types
    deliver.ts     (was delivery)
  platform/        llm/ · embedder/ (was embed) · clock · config · deps · errors
                   events · log · prompts · push · jobs (was queue) · time · timeout
                   timezone · age-gate (was age)
```

The rest of `src/`:
- **`src/db/`**: `schema.ts` stays. The repos split by scope: `repos/user/`
  (facts, entities, threads, session-log, relationship, conversation-state,
  identity, push, reach-out, judge-log), `repos/world/` (life-day,
  life-event-log) and `repos/admin/` (the cross-user `admin*` queries the
  workers use). `repos/core/` arrives in Phase 7.
- **`src/worker/`**: job registration is split into one file per engine.
- **`src/app/`**: routes and URLs are unchanged; only the imports change.
- **`tests/`** mirrors `src/mind`; `evals/` keeps its structure.

**One-way import rule** (ESLint `no-restricted-imports`, or an equivalent
boundary rule):
- nothing under a `core/` folder, and nothing in `world/`, imports a
  `user/` folder or `src/db/repos/user/`
- `legacy-ego/` and `legacy-life-tick/` are exempt by name, because they are
  per-user by design and Phase 7 deletes them. The exemption goes with them.

## 2. Naming and style

**Canonical names stay.** Every name the v3 spec writes in `code style`
keeps its exact spelling: table names (`session_log`, `fact`, `life_day`,
`relationship_param`), job names (`life_plan`, `outreach_tick`) and config
keys.

**Everything else uses v3's prose terms:**

| Today | Becomes | Why |
|---|---|---|
| `src/core` | `src/mind` | "core" means the core mind |
| `chat/compose-reply`, "slots" | `hot-path/compose`, "reply sections" | v3 calls it the hot path |
| `memory/apply` | `memory/user/encode` | the memory engine encodes |
| `safety/` | `process/crisis/` | v3 calls it the crisis path |
| `life/` | `world/` | the World engine; `life_*` job and table names stay |
| `queue.ts` | `platform/jobs.ts` | v3 says jobs |
| `EgoState`, `egoTick`, … | unchanged inside `legacy-ego/` | Phase 7 deletes them |

Function names say what happens in plain words (`driftOneHour`,
`deferWhileBusy`, `shouldReachOut`). Short or vague names (`decide`, `due`,
`band`) are renamed.

**Casing:**
- TypeScript identifiers: camelCase.
- DB columns and config keys: snake_case (the spec and Drizzle use it).
- Files and folders: kebab-case.

**Every file:**
- A 2–4 line header saying, in plain English and v3 terms, what it does.
  No spec section numbers, phases or review item numbers.
- Short functions, one idea per line.
- Named types instead of inline tuples (`Noise`, not
  `[number, number, number]`).
- Comments say why, never what.
- Prettier at 100 columns: `pnpm format`, checked by `pnpm lint`.

**Behaviour does not change.** This is a rewrite for reading. A suspected
bug found along the way goes on a list for Ethan, not into a fix.

## 3. Removals

**Removed now:**
1. **`identity` value columns** (`traits`, `stances`, `boundaries`,
   `humor_style`, `verbal_tics`, `speech_rules`): never read, because the
   persona file is the source. Dropped by migration.
2. **Backchannel styles `signals` and `silent`**: v3 settles the style as
   global `judge`. Also removed:
   - the config keys `turn.backchannel_style` and `turn.signals_probability`
   - the `evals/scripts/silent-style.yaml` script
   - the tests for both modes
3. **The `evals/guard/rule4-absence.yaml` fixture**: v3 removes rule 4
   outright.

**Kept:**
- The guard (off), its prompts and fixtures: v3 keeps them for the guard
  phase.
- `fact.scope` (`private | group`) and `space_id`: v3's friend-group hook.
- The `chat.relationship_line` switch.
- The judge evals.
- Migrations 0000–0010.

**Left for Phase 7** (moved into `legacy-*`, untouched):
- the per-user ego, `ego_tick` and the `ego.*` keys
- the per-user life tick and events, and the block facts
- the persona file's shape, including its outdated public-voice appendix

## 4. Steps and verification

All work is on the branch `v3-restructure`, one commit per step. Every step
leaves `pnpm typecheck`, `pnpm lint` and `pnpm test` green.

1. Prettier and the import-boundary lint rule. The formatting-only commit
   lands first, so it's easy to review.
2. `platform/`, first because everything imports it.
3. `memory/`.
4. `state/`: relationship and `legacy-ego/`.
5. `world/`: day plan, her clock, `legacy-life-tick/`.
6. `process/`, one subfolder at a time.
7. `src/db` repos split by scope; the worker split by engine.
8. Removals (Section 3), with the migration.
9. Tests mirror the new layout; eval imports updated.
10. Docs: the v3 spec (layout table §5, file paths, config keys), CLAUDE.md,
    and `DECISIONS.md` (one line per uncovered choice).

**Done when:**
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass.
- Tests are moved and renamed, never weakened. The only deleted tests are
  for the removed features.
- `pnpm eval --llm=fake --compare` matches `evals/baseline.json` before and
  after (minus `silent-style`).
- One chat runs through the dev server.
- The suspected-bug list is handed to Ethan.
