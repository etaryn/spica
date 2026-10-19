---
name: spica-close
description: Use when a Spica task, slice or phase is about to be reported done, committed or merged. Runs the definition of done in order, stopping at the first failure, and reports only what actually ran.
---

# Spica close

Stop at the first failing step, fix the cause, and rerun that step.

1. **Format and static checks:** `pnpm format`, then `pnpm typecheck` and `pnpm lint`.
2. **Tests.**
   - Targeted first: `pnpm test <path>` for the touched areas.
   - Then the full `pnpm test` once (~10 minutes; one test process at a time; run it in the
     background and don't edit test files while it runs).
   - A slice: its exit test `tests/exit/<slice>.test.ts` passes, with the leak canary and the
     side-channel check.
   - A prompt or process change: `pnpm eval --llm=fake --compare` shows no regressions.
3. **Spec write-back** (v3 is the source of truth): every new table or column, config key, job and
   prompt version; for a finished slice, its compact §20 row plus its full row in
   `docs/spec-v3-history.md`; done §25 items moved there with their resolution, new open items added
   with a target. A `DECISIONS.md` row for each choice the spec doesn't cover.
4. **Nothing left behind.** A replaced module's config keys, prompts (versions nothing
   configures), tests, eval scripts and DB columns are deleted: `git grep` the old names.
5. **Review.** Dispatch the `scope-reviewer` agent on the diff. Fix Critical and Important
   findings; list Minor ones in the report.
6. **Housekeeping for a slice:** delete its design doc and plan (history is in git); update the
   `CLAUDE.md` "Current phase" paragraph and the memory `phase-status` "Now" line.
7. **Commit** in the style of `git log` (`feat(area): what changed, in plain English`,
   `fix(area): …`, `test(exit): …`, `docs: …`) with the attribution trailer. Push only when Ethan
   asks.
8. **Report:** each check with its result, anything skipped and why, and what's deferred. Never
   claim a step that didn't run.
