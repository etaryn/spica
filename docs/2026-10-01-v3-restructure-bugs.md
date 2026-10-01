# v3 restructure: before/after record and suspected bugs

## Before state

- `pnpm test`: 88 files, 600 tests, all passing.
- `pnpm eval --llm=fake --compare`: 44 PASS, 32 SKIPPED (need a real model), 0 FAIL;
  "no regressions against baseline".

## After state

- `pnpm typecheck`, `pnpm lint` (ESLint + Prettier): pass.
- `pnpm test`: 91 files, 607 tests, all passing (the 600 from before, plus 4 boundary-rule
  cases, 1 job-name case, 1 config case and 1 migration case).
- `pnpm build`: succeeds.
- `pnpm eval --llm=fake --compare`: 43 PASS, 32 SKIPPED, 0 FAIL, "no regressions against
  baseline" (`silent-style` removed).
- `prompts/` unchanged against `main`.
- Dev server: every route responds when signed out (login and signup 200; chat, memory and
  settings redirect; the inspector 404s for a non-admin; the APIs return 401). No chat message
  was sent, so the dev Spica's memory wasn't touched.
- Worker: starts against the test database and registers the same 12 queues.

## Suspected bugs

Found while rewriting; not fixed (the restructure changes no behaviour).

- `src/mind/world/day-plan.ts`: the plan label limit (80 characters) and the number of generation attempts (2) are literals in code, not config keys. The rewrite names them as constants but doesn't move them, because a new config key is out of scope here.
