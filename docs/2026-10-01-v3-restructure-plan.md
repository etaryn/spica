# v3 Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise, rename and rewrite every module built in phases 0–6 so the code follows v3's structure and vocabulary, remove three outdated features, and change no other behaviour.

**Architecture:**
- `src/core` becomes `src/mind`, organised by v3's four engines (`memory`, `state`, `world`, `process`) plus `platform`, with each engine split into `core/` and `user/` scope folders.
- An ESLint boundary rule enforces the one-way flow: core and world never import user code.
- The work goes in a fixed order: one scripted move commit (pure `git mv` + import rewrite, so git keeps file history), then one readability-rewrite commit per engine, then the repo/worker split, the removals, and the docs.
- This reorders the design doc's steps 2–7 (move everything first, then rewrite) so git rename detection survives. The content is unchanged.

**Tech Stack:** TypeScript ~6.0, Next.js 16, Drizzle, pg-boss, Vitest, ESLint (typescript-eslint flat config), Prettier (new), pnpm.

**Spec:** `docs/2026-10-01-v3-restructure-design.md` (approved). Background: `spica-design-spec-v3.md`, `CLAUDE.md`.

## Global Constraints

- Branch: `v3-restructure`. Never commit to `main`.
- Every commit leaves `pnpm typecheck`, `pnpm lint` and `pnpm test` green.
- **No behaviour change** except the removals in Task 10. A suspected bug goes in `docs/2026-10-01-v3-restructure-bugs.md` (file, line, what looks wrong), never into a fix.
- **Canonical names keep their exact spelling:**
  - DB table and column names, pg-boss queue name strings, config keys, prompt paths and versions.
  - Spec names in `code style`: `session_log`, `fact`, `life_day`, `life_plan`, `outreach_tick`, `relationship_param`, `composeFrom`, ….
- `prompts/**` is never edited. Her voice must not change.
- `src/mind` stays framework-free: no Next/React imports, no `Date.now()`, no `new Date()` with no args, no `process.env` (only `platform/clock.ts` may read time).
- **Casing:**
  - TypeScript identifiers: camelCase; types: PascalCase.
  - DB columns, Drizzle domain property names and config keys: snake_case.
  - Files and folders: kebab-case.
- **Imports:**
  - `./x` within the same folder, `@/…` for everything else (the move script produces this).
  - No `../` imports in `src/`.
- **Every file in `src/mind`, `src/db/repos`, `src/runtime`, `src/server` and `src/worker`** starts with a 2–4 line `/** … */` header. It says, in plain English and v3 terms, what the file does.
  - Never cite spec sections, phases or review item numbers in any comment.
  - Exceptions: `legacy-*` folders are moved untouched and get no header.
- **Comments say why, not what.** Delete comments that restate the code.
- **Prettier:** `printWidth: 100`, double quotes, semicolons, trailing commas `all`. Checked by `pnpm lint`.
- **Function and type names say what happens in plain words.** Every renamed exported symbol is logged in `docs/2026-10-01-v3-restructure-renames.md` (`| old | new | file |`), so later tasks and Ethan can find it.
- **Tests:**
  - Tests are moved and renamed, never weakened: same assertions, same count.
  - The only tests deleted are those for removed features (Task 10).

### Readability rewrite: what a finished file looks like

This is the bar for every non-legacy file in Tasks 4–9.

Before (illustrative of today's style; the real `score.ts` formula is what you keep):
```ts
export function rankCandidates(cs: Candidate[], now: Date, cfg: RetrievalConfig): Scored[] {
  return cs.map((c) => ({ ...c, recency: Math.exp(-((now.getTime() - (c.last_recalled_at ?? c.created_at).getTime()) / DAY) / cfg.recency_half_life_days), score: c.sim * c.salience * c.entity_salience * /* … */ 1 })).sort((a, b) => b.score - a.score).slice(0, cfg.top_k);
}
```
After:
```ts
/**
 * Memory ranking: scores each candidate memory by similarity × weight × entity weight × recency
 * and keeps the best few. Pure maths, no data access, shared by both minds.
 */

export function rankMemories(
  candidates: Candidate[],
  now: Date,
  settings: RetrievalConfig,
): Scored[] {
  const scored = candidates.map((candidate) => {
    const recency = recencyWeight(candidate, now, settings);
    const score = candidate.sim * candidate.salience * candidate.entity_salience * recency;
    return { ...candidate, recency, score };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, settings.top_k);
}
```
Rules shown:
- a header that says what the file does
- parameters named in words (`candidates`, `settings`), not `cs` or `cfg`
- one idea per line, with intermediate values named
- the behaviour, the formula and the config keys are identical to before

## Review Focus

1. **pg-boss queue name strings.** Renaming the `*_QUEUE` constants must not change their string values: scheduled jobs and pending jobs in a running DB are keyed by them. Pinned by the queue-name test in Task 2.
2. **The boundary rule actually fires.** A rule that silently matches nothing gives false comfort. Pinned by the ESLint API test in Task 2: a core file importing a user repo fails, and a legacy file is exempt.
3. **Applying the column-drop migration to Ethan's populated dev DB.** It must apply cleanly over existing `identity` rows. Pinned by the migration test in Task 10.
4. **Removed config keys left in an override.** An eval script that still sets `turn.backchannel_style` must fail loudly, not be silently ignored. Pinned by the config test in Task 10.
5. **Prompts unchanged.** Any edit to `prompts/**` changes her voice. Pinned by the `git diff --quiet main -- prompts/` check in Task 11.

---

### Task 1: Prettier and the before-state record

**Files:**
- Create: `.prettierrc.json`, `.prettierignore`, `docs/2026-10-01-v3-restructure-bugs.md`, `docs/2026-10-01-v3-restructure-renames.md`
- Modify: `package.json` (scripts, devDependency), then every formatted file

- [ ] **Step 1: Record the before state**

Run: `pnpm test 2>&1 | tail -5` and note the file and test counts (expected about 88 files / 599 tests).
Run: `pnpm db:up` then `pnpm eval --llm=fake --compare`. Expected: exit 0, all scripts match `evals/baseline.json`.
Write both results into the top of `docs/2026-10-01-v3-restructure-bugs.md` under `## Before state`, followed by an empty `## Suspected bugs` heading.

- [ ] **Step 2: Create the renames log**

`docs/2026-10-01-v3-restructure-renames.md`:
```markdown
# v3 restructure: renamed symbols

Every exported symbol renamed during the restructure. File moves are in the
design doc's layout section.

| Old | New | File |
| --- | --- | --- |
```

- [ ] **Step 3: Add Prettier**

Run: `pnpm add -D prettier`

`.prettierrc.json`:
```json
{ "printWidth": 100, "trailingComma": "all" }
```

`.prettierignore`:
```
.next/
node_modules/
src/db/migrations/
evals/results/
pnpm-lock.yaml
next-env.d.ts
tsconfig.tsbuildinfo
*.md
prompts/
evals/**/*.yaml
.superpowers/
```

In `package.json` scripts, change `"lint": "eslint ."` to `"lint": "eslint . && prettier --check ."` and add `"format": "prettier --write ."`.

- [ ] **Step 4: Format everything**

Run: `pnpm format`
Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass, and the test count is the same as in Step 1.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add Prettier and format the codebase"
```

---

### Task 2: Move every file into the v3 layout

Pure moves and import rewrites. No code changes inside files except import specifiers.

**Files:**
- Create (outside the repo): `<scratchpad>/move.mjs`, `<scratchpad>/map.json`
- Move: everything listed in the map below
- Modify: `eslint.config.mjs`
- Test: `tests/mind/platform/boundaries.test.ts`, `tests/mind/platform/job-names.test.ts`

- [ ] **Step 1: Write the move map**

`<scratchpad>/map.json` maps repo-relative old path to new path:
```json
{
  "src/core/age.ts": "src/mind/platform/age-gate.ts",
  "src/core/clock.ts": "src/mind/platform/clock.ts",
  "src/core/config.ts": "src/mind/platform/config.ts",
  "src/core/deps.ts": "src/mind/platform/deps.ts",
  "src/core/errors.ts": "src/mind/platform/errors.ts",
  "src/core/events.ts": "src/mind/platform/events.ts",
  "src/core/log.ts": "src/mind/platform/log.ts",
  "src/core/prompts.ts": "src/mind/platform/prompts.ts",
  "src/core/push.ts": "src/mind/platform/push.ts",
  "src/core/queue.ts": "src/mind/platform/jobs.ts",
  "src/core/time.ts": "src/mind/platform/time.ts",
  "src/core/timeout.ts": "src/mind/platform/timeout.ts",
  "src/core/timezone.ts": "src/mind/platform/timezone.ts",
  "src/core/embed/fake.ts": "src/mind/platform/embedder/fake.ts",
  "src/core/embed/scripted.ts": "src/mind/platform/embedder/scripted.ts",
  "src/core/embed/types.ts": "src/mind/platform/embedder/types.ts",
  "src/core/embed/voyage.ts": "src/mind/platform/embedder/voyage.ts",
  "src/core/llm/anthropic.ts": "src/mind/platform/llm/anthropic.ts",
  "src/core/llm/fake.ts": "src/mind/platform/llm/fake.ts",
  "src/core/llm/types.ts": "src/mind/platform/llm/types.ts",

  "src/core/memory/score.ts": "src/mind/memory/shared/ranking.ts",
  "src/core/memory/types.ts": "src/mind/memory/shared/types.ts",
  "src/core/memory/apply.ts": "src/mind/memory/user/encode.ts",
  "src/core/memory/decay.ts": "src/mind/memory/user/decay.ts",
  "src/core/memory/extract.ts": "src/mind/memory/user/extract.ts",
  "src/core/memory/reconcile.ts": "src/mind/memory/user/reconcile.ts",
  "src/core/memory/retrieve.ts": "src/mind/memory/user/retrieve.ts",

  "src/core/relationship/apply.ts": "src/mind/state/user/relationship/update.ts",
  "src/core/relationship/cadence.ts": "src/mind/state/user/relationship/cadence.ts",
  "src/core/relationship/homeostasis.ts": "src/mind/state/user/relationship/params.ts",
  "src/core/relationship/signals.ts": "src/mind/state/user/relationship/signals.ts",
  "src/core/relationship/summary.ts": "src/mind/state/user/relationship/summary.ts",
  "src/core/relationship/tick.ts": "src/mind/state/user/relationship/daily-tick.ts",
  "src/core/relationship/transitions.ts": "src/mind/state/user/relationship/transitions.ts",
  "src/core/relationship/types.ts": "src/mind/state/user/relationship/types.ts",
  "src/core/ego/ego.ts": "src/mind/state/legacy-ego/ego.ts",
  "src/core/ego/line.ts": "src/mind/state/legacy-ego/line.ts",
  "src/core/ego/nudge.ts": "src/mind/state/legacy-ego/nudge.ts",
  "src/core/ego/tick.ts": "src/mind/state/legacy-ego/tick.ts",

  "src/core/life/clock.ts": "src/mind/world/her-clock.ts",
  "src/core/life/plan.ts": "src/mind/world/day-plan.ts",
  "src/core/life/blocks.ts": "src/mind/world/legacy-life-tick/blocks.ts",
  "src/core/life/events.ts": "src/mind/world/legacy-life-tick/events.ts",
  "src/core/life/tick.ts": "src/mind/world/legacy-life-tick/tick.ts",

  "src/core/chat/receive.ts": "src/mind/process/receive/receive-turn.ts",
  "src/core/chat/session.ts": "src/mind/process/receive/session.ts",
  "src/core/turn/cues.ts": "src/mind/process/turn-taking/cues.ts",
  "src/core/turn/judge.ts": "src/mind/process/turn-taking/judge.ts",
  "src/core/turn/pacing.ts": "src/mind/process/turn-taking/pacing.ts",
  "src/core/turn/receive-message.ts": "src/mind/process/turn-taking/receive-message.ts",
  "src/core/turn/reply.ts": "src/mind/process/turn-taking/commit-and-reply.ts",
  "src/core/turn/state.ts": "src/mind/process/turn-taking/state.ts",
  "src/core/turn/sweep.ts": "src/mind/process/turn-taking/sweep.ts",
  "src/core/turn/transitions.ts": "src/mind/process/turn-taking/transitions.ts",
  "src/core/turn/availability.ts": "src/mind/process/availability/deferral.ts",
  "src/core/turn/availability-note.ts": "src/mind/process/availability/busy-note.ts",
  "src/core/chat/assemble.ts": "src/mind/process/hot-path/assemble.ts",
  "src/core/chat/compose-reply.ts": "src/mind/process/hot-path/compose.ts",
  "src/core/chat/parts.ts": "src/mind/process/hot-path/split-parts.ts",
  "src/core/life/state.ts": "src/mind/process/hot-path/your-day-line.ts",
  "src/core/cold-path.ts": "src/mind/process/cold-path/cold-path.ts",
  "src/core/memory/sweep.ts": "src/mind/process/cold-path/sweep.ts",
  "src/core/safety/crisis.ts": "src/mind/process/crisis/classifier.ts",
  "src/core/safety/keywords.ts": "src/mind/process/crisis/keywords.ts",
  "src/core/guard/categories.ts": "src/mind/process/guard/categories.ts",
  "src/core/guard/fallback.ts": "src/mind/process/guard/fallback.ts",
  "src/core/guard/guard.ts": "src/mind/process/guard/guard.ts",
  "src/core/guard/keywords.ts": "src/mind/process/guard/keywords.ts",
  "src/core/guard/outgoing.ts": "src/mind/process/guard/outgoing.ts",
  "src/core/outreach/answered.ts": "src/mind/process/outreach/answered.ts",
  "src/core/outreach/candidates.ts": "src/mind/process/outreach/candidates.ts",
  "src/core/outreach/gate.ts": "src/mind/process/outreach/gate.ts",
  "src/core/outreach/inputs.ts": "src/mind/process/outreach/inputs.ts",
  "src/core/outreach/send.ts": "src/mind/process/outreach/send.ts",
  "src/core/outreach/tick.ts": "src/mind/process/outreach/tick.ts",
  "src/core/outreach/types.ts": "src/mind/process/outreach/types.ts",
  "src/core/delivery.ts": "src/mind/process/deliver.ts",

  "src/queue/pg-boss-queue.ts": "src/runtime/pg-boss-jobs.ts",
  "src/lib/auth-client.ts": "src/server/auth-client.ts",
  "src/lib/auth-factory.ts": "src/server/auth-factory.ts",
  "src/lib/auth.ts": "src/server/auth.ts",
  "src/lib/deps.ts": "src/server/deps.ts",
  "src/lib/event-hub.ts": "src/server/event-hub.ts",
  "src/lib/inspector-access.ts": "src/server/inspector-access.ts",
  "src/lib/inspector-guard.ts": "src/server/inspector-guard.ts",
  "src/lib/session.ts": "src/server/session.ts",

  "tests/core/age.test.ts": "tests/mind/platform/age-gate.test.ts",
  "tests/core/clock.test.ts": "tests/mind/platform/clock.test.ts",
  "tests/core/config.test.ts": "tests/mind/platform/config.test.ts",
  "tests/core/embed.test.ts": "tests/mind/platform/embedder.test.ts",
  "tests/core/errors.test.ts": "tests/mind/platform/errors.test.ts",
  "tests/core/llm.test.ts": "tests/mind/platform/llm.test.ts",
  "tests/core/prompts.test.ts": "tests/mind/platform/prompts.test.ts",
  "tests/core/timezone.test.ts": "tests/mind/platform/timezone.test.ts",
  "tests/core/score.test.ts": "tests/mind/memory/shared/ranking.test.ts",
  "tests/core/apply.test.ts": "tests/mind/memory/user/encode.test.ts",
  "tests/core/decay.test.ts": "tests/mind/memory/user/decay.test.ts",
  "tests/core/extract.test.ts": "tests/mind/memory/user/extract.test.ts",
  "tests/core/reconcile.test.ts": "tests/mind/memory/user/reconcile.test.ts",
  "tests/core/retrieve.test.ts": "tests/mind/memory/user/retrieve.test.ts",
  "tests/core/relationship-cold-path.test.ts": "tests/mind/state/user/relationship/cold-path.test.ts",
  "tests/core/relationship-homeostasis.test.ts": "tests/mind/state/user/relationship/params.test.ts",
  "tests/core/relationship-summary.test.ts": "tests/mind/state/user/relationship/summary.test.ts",
  "tests/core/relationship-tick.test.ts": "tests/mind/state/user/relationship/daily-tick.test.ts",
  "tests/core/relationship-transitions.test.ts": "tests/mind/state/user/relationship/transitions.test.ts",
  "tests/core/ego.test.ts": "tests/mind/state/legacy-ego/ego.test.ts",
  "tests/core/ego-line.test.ts": "tests/mind/state/legacy-ego/line.test.ts",
  "tests/core/ego-nudge.test.ts": "tests/mind/state/legacy-ego/nudge.test.ts",
  "tests/core/ego-tick.test.ts": "tests/mind/state/legacy-ego/tick.test.ts",
  "tests/core/life-clock.test.ts": "tests/mind/world/her-clock.test.ts",
  "tests/core/life-plan.test.ts": "tests/mind/world/day-plan.test.ts",
  "tests/core/life-events.test.ts": "tests/mind/world/legacy-life-tick/events.test.ts",
  "tests/core/life-tick.test.ts": "tests/mind/world/legacy-life-tick/tick.test.ts",
  "tests/core/receive-message.test.ts": "tests/mind/process/turn-taking/receive-message.test.ts",
  "tests/core/turn-judge.test.ts": "tests/mind/process/turn-taking/judge.test.ts",
  "tests/core/turn-pacing.test.ts": "tests/mind/process/turn-taking/pacing.test.ts",
  "tests/core/turn-reply.test.ts": "tests/mind/process/turn-taking/commit-and-reply.test.ts",
  "tests/core/turn-sweep.test.ts": "tests/mind/process/turn-taking/sweep.test.ts",
  "tests/core/turn-transitions.test.ts": "tests/mind/process/turn-taking/transitions.test.ts",
  "tests/core/availability.test.ts": "tests/mind/process/availability/deferral.test.ts",
  "tests/core/availability-note.test.ts": "tests/mind/process/availability/busy-note.test.ts",
  "tests/core/assemble.test.ts": "tests/mind/process/hot-path/assemble.test.ts",
  "tests/core/compose-reply.test.ts": "tests/mind/process/hot-path/compose.test.ts",
  "tests/core/life-state.test.ts": "tests/mind/process/hot-path/your-day-line.test.ts",
  "tests/core/cold-path.test.ts": "tests/mind/process/cold-path/cold-path.test.ts",
  "tests/core/sweep.test.ts": "tests/mind/process/cold-path/sweep.test.ts",
  "tests/core/crisis.test.ts": "tests/mind/process/crisis/classifier.test.ts",
  "tests/core/guard.test.ts": "tests/mind/process/guard/guard.test.ts",
  "tests/core/guard-outgoing.test.ts": "tests/mind/process/guard/outgoing.test.ts",
  "tests/core/outreach-answered.test.ts": "tests/mind/process/outreach/answered.test.ts",
  "tests/core/outreach-candidates.test.ts": "tests/mind/process/outreach/candidates.test.ts",
  "tests/core/outreach-gate.test.ts": "tests/mind/process/outreach/gate.test.ts",
  "tests/core/outreach-inputs.test.ts": "tests/mind/process/outreach/inputs.test.ts",
  "tests/core/outreach-send.test.ts": "tests/mind/process/outreach/send.test.ts",
  "tests/core/outreach-tick.test.ts": "tests/mind/process/outreach/tick.test.ts",
  "tests/core/delivery.test.ts": "tests/mind/process/deliver.test.ts",
  "tests/queue/pg-boss-queue.test.ts": "tests/runtime/pg-boss-jobs.test.ts",
  "tests/queue/worker-jobs.test.ts": "tests/worker/jobs.test.ts",
  "tests/lib/auth.test.ts": "tests/server/auth.test.ts",
  "tests/lib/inspector-access.test.ts": "tests/server/inspector-access.test.ts"
}
```

Then run `git ls-files tests/core tests/queue tests/lib src/core src/lib src/queue`. Every listed file must be a key in the map. If one isn't, add it to the map next to its siblings, following the same pattern, before moving on.

- [ ] **Step 2: Write the move script**

`<scratchpad>/move.mjs`:
```js
// Moves files per map.json and rewrites every import specifier that points at a moved file
// (or at any repo file) to the house style: "./x" within a folder, "@/…" for src, relative otherwise.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const map = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const files = execFileSync("git", ["ls-files", "src", "tests", "evals"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mts)$/.test(f));
const known = new Set(files);
const P = path.posix;
const moved = (f) => map[f] ?? f;

function resolveSpecifier(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith(".")) base = P.normalize(P.join(P.dirname(fromFile), spec));
  else return null;
  for (const candidate of [base, base + ".ts", base + ".tsx", base + "/index.ts"]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

function specifierFor(fromFile, targetFile) {
  const target = targetFile.replace(/\.tsx?$/, "");
  if (P.dirname(fromFile) === P.dirname(targetFile)) return "./" + P.basename(target);
  if (target.startsWith("src/")) return "@/" + target.slice(4);
  const rel = P.relative(P.dirname(fromFile), target);
  return rel.startsWith(".") ? rel : "./" + rel;
}

const importPattern = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\2/g;
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const rewritten = source.replace(importPattern, (match, lead, quote, spec) => {
    const target = resolveSpecifier(file, spec);
    if (!target) return match;
    return `${lead}${quote}${specifierFor(moved(file), moved(target))}${quote}`;
  });
  if (rewritten !== source) fs.writeFileSync(file, rewritten);
}

for (const [from, to] of Object.entries(map)) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  execFileSync("git", ["mv", from, to]);
}
```

- [ ] **Step 3: Run it**

Run: `node <scratchpad>/move.mjs <scratchpad>/map.json && pnpm format`
Then: `git ls-files src/core src/lib src/queue tests/core tests/queue tests/lib`
Expected: no output (the old folders are empty).

- [ ] **Step 4: Point ESLint at the new paths and add the boundary rule**

Replace `eslint.config.mjs` with:
```js
import tseslint from "typescript-eslint";

const legacy = ["src/mind/state/legacy-ego/**", "src/mind/world/legacy-life-tick/**"];

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/db/migrations/**",
      "next-env.d.ts",
      "evals/results/**",
      ".superpowers/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The mind runs the same in the app, the worker and the evals, so it never touches the
    // framework, the wall clock or the environment directly.
    files: ["src/mind/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "@/app/*", "@/server/*"],
              message: "src/mind must stay framework-free.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Use the injected Clock." },
        {
          object: "process",
          property: "env",
          message: "Read env in the runtime layer and pass config in.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Use the injected Clock.",
        },
      ],
    },
  },
  {
    files: ["src/mind/platform/clock.ts"],
    rules: { "no-restricted-properties": "off", "no-restricted-syntax": "off" },
  },
  {
    // One-way flow: her core self and her world never read a user's data.
    files: ["src/mind/*/core/**/*.ts", "src/mind/world/**/*.ts"],
    ignores: legacy,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "@/app/*", "@/server/*"],
              message: "src/mind must stay framework-free.",
            },
            {
              group: ["@/mind/*/user", "@/mind/*/user/*", "@/mind/*/user/**", "@/db/repos/user/*"],
              message: "Core and world code never reads user data.",
            },
          ],
        },
      ],
    },
  },
);
```
(The framework group is repeated because a later `no-restricted-imports` entry replaces an earlier one for the same file.)

- [ ] **Step 5: Write the boundary test**

`tests/mind/platform/boundaries.test.ts`:
```ts
/**
 * The one-way flow is enforced by ESLint. These cases prove the rule fires for core and world
 * code, and that the per-user legacy folders are exempt until they are deleted.
 */
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
const importsUserRepo = 'import { insertFact } from "@/db/repos/user/facts";\nvoid insertFact;\n';
const importsUserMemory = 'import { retrieve } from "@/mind/memory/user/retrieve";\nvoid retrieve;\n';

async function errorsFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.map((m) => m.message);
}

describe("one-way flow", () => {
  it("stops core code importing a user repo", async () => {
    const errors = await errorsFor(importsUserRepo, "src/mind/state/core/mood.ts");
    expect(errors).toContain("Core and world code never reads user data.");
  });

  it("stops world code importing user memory", async () => {
    const errors = await errorsFor(importsUserMemory, "src/mind/world/day-plan.ts");
    expect(errors).toContain("Core and world code never reads user data.");
  });

  it("lets process code read user data", async () => {
    const errors = await errorsFor(importsUserRepo, "src/mind/process/hot-path/compose.ts");
    expect(errors).not.toContain("Core and world code never reads user data.");
  });

  it("exempts the legacy per-user folders", async () => {
    const errors = await errorsFor(importsUserRepo, "src/mind/world/legacy-life-tick/tick.ts");
    expect(errors).not.toContain("Core and world code never reads user data.");
  });
});
```
The `@/db/repos/user/*` paths don't exist until Task 9. `lintText` doesn't resolve imports, so the test still runs now.

- [ ] **Step 6: Write the job-name test**

`tests/mind/platform/job-names.test.ts`:
```ts
/**
 * Queue names are stored in the database (scheduled and pending jobs), so renaming a constant
 * must never change its string.
 */
import { describe, expect, it } from "vitest";
import * as jobs from "@/mind/platform/jobs";

describe("job names", () => {
  it("keep the names already stored in pg-boss", () => {
    const names = Object.entries(jobs)
      .filter(([, value]) => typeof value === "string")
      .map(([, value]) => value)
      .sort();
    expect(names).toEqual([
      "cold_path",
      "cold_path_sweep",
      "decay_pass",
      "ego_tick",
      "life_plan",
      "life_tick",
      "outreach_tick",
      "reach_out_send",
      "relationship_tick",
      "turn_backchannel",
      "turn_sweep",
      "turn_timer",
    ]);
  });
});
```
Before trusting the expected list, run `grep -n "_QUEUE = " src/mind/platform/jobs.ts`. If a string differs from the list, the list is wrong: make it match the file exactly. The file is the source of truth for what is stored.

- [ ] **Step 7: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass. The test count is the before count plus 5 (4 boundary cases + 1 job-name case).
If lint reports a boundary error in a non-legacy `world/` file, don't change the code. Note it in the bugs file and fix it in Task 7, the world rewrite (expected: `day-plan.ts` may import `chat/assemble` helpers; that is process, not user, so it is allowed).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: move the code into the v3 engine layout"
```

---

### Tasks 3–8: the readability rewrites (shared procedure)

Each of these tasks rewrites one area to the bar in Global Constraints. Every task follows the same steps:

1. For each file in the task's list, rewrite it to the bar, keeping every exported behaviour identical. Rename exported symbols where the task lists a rename. Pick other plain-word names freely, and log every exported rename in the renames file.
2. Update callers. Run `pnpm typecheck` and follow the errors.
3. Rename test `describe`/`it` titles that use old names. Keep every assertion.
4. Run `pnpm typecheck && pnpm lint && pnpm test`. Expected: all pass with the same test count as before the task.
5. Run `pnpm eval --llm=fake --compare`. Expected: exit 0.
6. Commit with the task's message.

`legacy-*` folders are never rewritten in any task.

### Task 3: Rewrite `platform/`

**Files:** everything under `src/mind/platform/` (`llm/`, `embedder/`, `age-gate`, `clock`, `config`, `deps`, `errors`, `events`, `jobs`, `log`, `prompts`, `push`, `time`, `timeout`, `timezone`).
**Create:**
- `src/mind/platform/seeded-random.ts`: move `seededUnit` here from `process/turn-taking/pacing.ts`, because state, world and outreach all use it.
- `src/mind/platform/relative-date.ts`: move `relativeDate` here from `process/hot-path/assemble.ts`, because world uses it too.

**Interfaces produced:**
- `seededUnit(seed: string): number` in `@/mind/platform/seeded-random` (name kept: it is used across many files and already says what it does).
- `relativeDate(when: Date, now: Date): string` in `@/mind/platform/relative-date`.
- `jobs.ts`: keep the `*_QUEUE` constant names as they are. The job-name test pins the strings.

`config.ts`: keep the zod schema keys exactly. You may split it into one schema constant per config section, in the same file. **Commit:** `refactor: rewrite platform for readability`

### Task 4: Rewrite `memory/`

**Files:** `memory/shared/ranking.ts`, `memory/shared/types.ts`, `memory/user/{extract,reconcile,encode,retrieve,decay}.ts`.
**Moves within the task:** `RetrievedFact`, `DueThread`, `RetrievalResult` and `emptyRetrieval` go from `process/hot-path/assemble.ts` to `memory/shared/types.ts`. They describe what retrieval returns, so memory must not import process.
**Renames:**
- `rankCandidates` → `rankMemories`
- `decide` (reconcile) → `reconcileAgainstNeighbours`
- `applyExtraction` → `encodeExtraction`
- `ApplyOutcome` → `EncodeOutcome`
- `PlannedFact` keeps its name
- `retrieve` keeps its name (the spec says "retrieve")

**Commit:** `refactor: rewrite the memory engine for readability`

### Task 5: Rewrite `state/user/relationship/`

**Files:** `params.ts`, `signals.ts`, `transitions.ts`, `update.ts`, `daily-tick.ts`, `cadence.ts`, `summary.ts`, `types.ts`.
**Renames:**
- `applyRelationship` → `updateRelationship`
- `relationshipTick` → `relationshipDailyTick`

Keep `HomeostaticParam` (spec name) and `loadRelationshipSummary`. `legacy-ego/` is untouched. **Commit:** `refactor: rewrite relationship state for readability`

### Task 6: Rewrite `world/`

**Files:** `world/her-clock.ts`, `world/day-plan.ts`.
Keep the names `lifeTimezone` (spec name), `lifeDate`, `lifeHour`, `lifeInstant` and `ensurePlans`; they match `life_*` canon. `legacy-life-tick/` is untouched. **Commit:** `refactor: rewrite the world for readability`

### Task 7: Rewrite `process/` part 1: receive, turn-taking, availability

**Files:** `process/receive/*`, `process/turn-taking/*`, `process/availability/*`.
**Renames:**
- `availabilityFor` → `deferWhileBusy`
- `runTurnTimer` and `runBackchannel` keep their names (job handlers named after their jobs)

**Commit:** `refactor: rewrite turn-taking and availability for readability`

### Task 8: Rewrite `process/` part 2: hot path, cold path, crisis, guard, outreach, deliver

**Files:** `process/hot-path/*`, `process/cold-path/*`, `process/crisis/*`, `process/guard/*`, `process/outreach/*`, `process/deliver.ts`.
**Renames:**
- `composeReply` keeps its name.
- `composeFrom` keeps its name (spec name). The "slots" wording in comments and variable names becomes "reply sections".
- `handleColdPath` → `runColdPath`
- `sweepUnextracted` → `sweepUnfinishedColdPaths`
- `evaluateGate` keeps its name (it already reads plainly).

Prompt text and section headings inside `assemblePrompt` (e.g. `## How you're feeling`) are prompt content and must not change by a single character. **Commit:** `refactor: rewrite the hot path, cold path, crisis, guard and outreach for readability`

---

### Task 9: Split the repos by scope and the worker by engine

**Files:**
- Move: `src/db/repos/{facts,entities,threads,session-log,relationship,conversation-state,identity,push,reach-out,judge-log,users,life-event-log}.ts` → `src/db/repos/user/` (`life-event-log` stays per-user until its `user_id` is dropped with core events)
- Move: `src/db/repos/life-day.ts` → `src/db/repos/world/life-day.ts`
- Move: `src/db/repos/cold-path-admin.ts` → `src/db/repos/admin/cold-path.ts`; `decay-admin.ts` → `admin/decay.ts`; `inspector.ts` → `admin/inspector.ts`
- Create: `src/db/repos/admin/users.ts` (from `users.ts`: `adminListUsers`, `adminGetUser`), `admin/turn-taking.ts` (from `conversation-state.ts`: `adminFindStuckConversations`), `admin/life.ts` (from `identity.ts`: `adminListLifeUsers`), `admin/relationship.ts` (from `relationship.ts`: `adminListRelationshipUsers`)
- Keep: `src/db/repos/util.ts`, `schema.ts`, `client.ts`, `migrate*.ts`, `reset-self*.ts`, `admin.ts`
- Split: `src/worker/index.ts` + `jobs.ts` → `index.ts` (boot, shutdown), `jobs.ts` (keeps `scrubErrors`, `ensureSystemQueues`), `memory-jobs.ts` (`cold_path`, `cold_path_sweep`, `decay_pass`), `state-jobs.ts` (`relationship_tick`, `ego_tick`), `world-jobs.ts` (`life_plan`, `life_tick`), `process-jobs.ts` (`turn_timer`, `turn_backchannel`, `turn_sweep`, `outreach_tick`, `reach_out_send`)
- Test: move `tests/db/*.test.ts` only where a file name refers to a moved repo; imports update via the move script.

- [ ] **Step 1: Move the repo files** with the Task 2 script and a new map containing the moves above. Run `pnpm format`.
- [ ] **Step 2: Extract the admin functions** into the new `admin/*.ts` files by cut and paste (moved verbatim, plus a header per file). Update imports by following `pnpm typecheck`. Give each repo file the standard header.
- [ ] **Step 3: Split the worker.** Each `*-jobs.ts` exports `registerXJobs(boss: PgBoss, deps: Deps): Promise<void>`, containing the `boss.work` and `boss.schedule` calls for its queues, copied verbatim and in the same order. `index.ts` calls them in this order: memory, process (turn-taking part), state, world, process (outreach part). If one function per file is simpler than preserving that exact interleaving, register them in the file order above: pg-boss registration order has no behavioural effect.
- [ ] **Step 4: Verify.** Run `pnpm typecheck && pnpm lint && pnpm test`: all pass at the same count. Then `pnpm worker` for 10 seconds: the log line `worker started` lists the same queues as before. Stop it.
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: split repos by scope and the worker by engine"
```

---

### Task 10: Remove the outdated features

**Files:**
- Modify: `src/db/schema.ts` (drop 6 `identity` columns), `src/mind/platform/config.ts`, `config/default.json`, `src/mind/process/turn-taking/receive-message.ts`, `tests/db/schema.test.ts`, `tests/mind/platform/config.test.ts`, `tests/mind/process/turn-taking/receive-message.test.ts`, `tests/evals/script.test.ts`, `evals/lib/script.ts` (doc comment example), `evals/baseline.json`, `evals/guard-baseline.json`
- Delete: `evals/scripts/silent-style.yaml`, `evals/guard/rule4-absence.yaml`
- Create: a migration in `src/db/migrations/` (generated); `tests/db/migration-identity-columns.test.ts`

- [ ] **Step 1: Write the failing config test**

In `tests/mind/platform/config.test.ts` add:
```ts
it("rejects the removed backchannel style keys", () => {
  expect(() => loadConfig({ turn: { backchannel_style: "judge" } })).toThrow();
  expect(() => loadConfig({ turn: { signals_probability: 0.3 } })).toThrow();
});
```
Run: `pnpm vitest run tests/mind/platform/config.test.ts`. Expected: FAIL. zod's `z.object` strips unknown keys, so a stale override is silently ignored today. In Step 2, make the `turn` section a `z.strictObject` (only that section; the minimal change that makes a stale override fail loudly) and note it in `DECISIONS.md`.

- [ ] **Step 2: Remove the backchannel styles**

- In `config.ts` delete `backchannel_style` and `signals_probability` from the `turn` schema, and make that section `z.strictObject({ … })`.
- In `config/default.json` delete both keys.
- In `receive-message.ts` delete the `style` and `want` lines and the `want &&` condition, leaving `if (rateOk) {`. Remove the `seededUnit` import if it becomes unused.
- In `tests/mind/platform/config.test.ts`:
  - remove `backchannel_style: "judge"` from the `toMatchObject` expectation
  - remove the `backchannel_style: "loud"` rejection case (superseded by Step 1)
- Delete the `silent` style test in `receive-message.test.ts`.
- In `tests/evals/script.test.ts` and the `evals/lib/script.ts` doc comment, replace the example override `{ turn: { backchannel_style: "silent" } }` with `{ turn: { settle_ms: 1000 } }`.

Run: `pnpm vitest run tests/mind/platform/config.test.ts`. Expected: PASS.

- [ ] **Step 3: Remove the eval script and the guard fixture**

```bash
git rm evals/scripts/silent-style.yaml evals/guard/rule4-absence.yaml
```
Delete the `"silent-style"` entry from `evals/baseline.json`, and every `"rule4-absence/…"` entry from `evals/guard-baseline.json`. Keep the JSON valid.

- [ ] **Step 4: Write the failing migration test**

`tests/db/migration-identity-columns.test.ts`:
```ts
/**
 * The identity table's unused value columns are dropped by migration, and existing ego rows
 * survive it.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getTestDb } from "../helpers/db";

describe("identity value columns", () => {
  it("are gone after migration", async () => {
    const db = getTestDb();
    const result = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'identity'
        AND column_name IN ('traits','stances','boundaries','humor_style','verbal_tics','speech_rules')
    `);
    expect(result.rows).toEqual([]);
  });
});
```
The test DB is migrated by `tests/global-setup.ts`. Run it. Expected: FAIL (6 rows).

- [ ] **Step 5: Drop the columns**

- In `src/db/schema.ts` delete the six `identity` lines (`traits` … `speech_rules`) and the `// values (rarely changes)` comment.
- Run `pnpm db:generate` and check that the new SQL file contains only six `ALTER TABLE "identity" DROP COLUMN …` statements.
- In `tests/db/schema.test.ts` remove the six columns from any expected column list.

Run the migration test and `tests/db/schema.test.ts`. Expected: PASS.

- [ ] **Step 6: Populated-DB check**

Run `pnpm db:migrate` against the local dev DB (it has real `identity` rows). Expected: success. Run `SELECT count(*) FROM identity` before and after through `docker compose exec`; the count must match.

- [ ] **Step 7: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass. The count is the Task 9 count, minus the deleted silent-style test, plus the 2 new tests.
Run: `pnpm eval --llm=fake --compare` (expected exit 0) and `pnpm eval:guard --llm=fake --compare` if it supports `--compare` (check its `--help`). Otherwise run it plainly and expect exit 0.

```bash
git add -A
git commit -m "chore: remove settled backchannel styles, rule-4 fixture and unused identity columns"
```

---

### Task 11: Docs and final verification

**Files:**
- Modify: `spica-design-spec-v3.md`, `CLAUDE.md`, `DECISIONS.md`, `README.md` (if it names old paths), `docs/2026-10-01-v3-restructure-design.md` (status line)

- [ ] **Step 1: Find every stale path**

Run: `git grep -n -E "src/core|src/lib|src/queue|backchannel_style|signals_probability|rule4-absence|silent-style|cold-path-admin|decay-admin" -- ':!docs/2026-10-01-v3-restructure-*' ':!src/db/migrations'`
Expected after this task: no output.

- [ ] **Step 2: Update the v3 spec**

- §5 Layout row:
  - `src/mind` is framework-free and organised by engine (`memory`, `state`, `world`, `process`, `platform`), each split into `core/` and `user/`, with a lint rule enforcing the one-way flow
  - `src/db` has the schema and repos split into `user/`, `world/`, `admin/`
  - `src/runtime` holds the Node implementations
  - `src/server` holds the Next server helpers
  - `src/app`, `src/worker` (one registration file per engine), `prompts/`, `evals/` as before
- §10.1 `Code: src/core/turn/` → `Code: src/mind/process/turn-taking/`.
- §10.3 `src/core/chat/compose-reply.ts` → `src/mind/process/hot-path/compose.ts`.
- §11 and §13 code paths → `src/mind/state/user/relationship/` and `src/mind/process/outreach/`.
- §17.5: the guard fixtures stay except rule 4's, which was removed with the rule.
- Search the spec for `backchannel` and make sure it describes a single `judge` style with no config key.

- [ ] **Step 3: Update CLAUDE.md**

- Replace the `Layout:` bullet under Working conventions with the same layout as the spec's §5.
- Add `pnpm format` to the commands line.

- [ ] **Step 4: Log the uncovered choices in DECISIONS.md**

Add these rows, dated 2026-10-01:
- `src/lib` → `src/server` | It holds the Next.js server-only helpers; "server" says that, "lib" didn't.
- `src/queue/pg-boss-queue.ts` → `src/runtime/pg-boss-jobs.ts` | It is the runtime implementation of the jobs interface, next to the other runtime implementations.
- `life-event-log` repo in `repos/user/` | The table still has `user_id`; it moves to world when core events drop it.
- `relativeDate` and `seededUnit` in `platform/` | They're used across engines; keeping them in process would make world and state import process.
- The restructure moved all files first, then rewrote | It keeps git rename history intact; the design's content is unchanged.
- `turn` config section is `z.strictObject` | A stale override of a removed key now fails loudly instead of being ignored.

- [ ] **Step 5: Final verification**

Run each and record the output in the bugs file under `## After state`:
- `pnpm typecheck && pnpm lint && pnpm test`: all pass, with the counts.
- `pnpm build`: succeeds.
- `pnpm eval --llm=fake --compare`: exit 0.
- `git diff --quiet main -- prompts/ && echo prompts-unchanged`: prints `prompts-unchanged`.
- `pnpm dev` and `pnpm worker`, then sign in and send one chat message. A reply arrives. Open `/inspector` and check that the tabs load. Stop both.

- [ ] **Step 6: Mark the design done and commit**

In `docs/2026-10-01-v3-restructure-design.md` change the status line to `Status: implemented on branch v3-restructure.`

```bash
git add -A
git commit -m "docs: point the spec and CLAUDE.md at the v3 layout"
```

- [ ] **Step 7: Hand over**

Tell Ethan:
- the before and after test counts
- the eval and build results
- the number of renamed symbols (link the renames file)
- every entry in the suspected-bugs list

Ask whether to merge `v3-restructure` into `main`.
