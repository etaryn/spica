# v3 restructure: before/after record and suspected bugs

## Before state

- `pnpm test`: 88 files, 600 tests, all passing.
- `pnpm eval --llm=fake --compare`: 44 PASS, 32 SKIPPED (need a real model), 0 FAIL;
  "no regressions against baseline".

## Suspected bugs

Found while rewriting; not fixed (the restructure changes no behaviour).

- `src/mind/world/day-plan.ts`: the plan label limit (80 characters) and the number of generation attempts (2) are literals in code, not config keys. The rewrite names them as constants but doesn't move them, because a new config key is out of scope here.
