# v3 restructure: before/after record and suspected bugs

## Before state

- `pnpm test`: 88 files, 600 tests, all passing.
- `pnpm eval --llm=fake --compare`: 44 PASS, 32 SKIPPED (need a real model), 0 FAIL;
  "no regressions against baseline".

## Suspected bugs

Found while rewriting; not fixed (the restructure changes no behaviour).
