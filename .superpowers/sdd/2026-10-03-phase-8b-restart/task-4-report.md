# Task 4: Goal-driven events

Status: implementation and verification complete. No blocker. Baseline inspected in the isolated restart worktree; owned files only.

## Implemented

Goal selection uses the approved day seeds, share and progress weighting with stable goal ID ordering. Generation includes core needs and the selected goal while assigning goal metadata in code. The world tick persists the goal ID, B51 reconcile target and nullable injected fallthrough override. The generator checks the runner's remaining call budget before each model generation and before reconciliation when near memories exist, retains only previously accepted events on exhaustion, and marks that day's life-event trace as fallback. The configured event prompt is v4; the unreferenced v3 prompt was removed. The deterministic fake can produce goal-connected content while preserving its ordinary spontaneous default.

## TDD evidence

RED: `TEST_DATABASE_URL=postgres://spica:spica@localhost:5432/spica_8b_restart_test pnpm.cmd exec vitest run tests/mind/world/events.test.ts tests/mind/process/core/world-tick.test.ts` (escalated for node_modules access): 3 failed, 43 passed. The failures were behavioral: accepted event lacked `goalRef`, accepted reconcile resolution lacked `resolvesMemoryId`, and the one-call budget case made 2 model requests instead of 1. No missing-module failure.

GREEN (focused): the same command after implementation and boundary tests: 2 files, 52/52 tests passed. This covers seeded goal selection, no active goal, injected events and true/false overrides, reconcile-target persistence, surprise timing, and single-call reconciliation budget exhaustion.

## Verification

`pnpm.cmd typecheck`: passed after the added tests (exit 0).

`pnpm.cmd lint`: passed; ESLint and Prettier clean (exit 0).

`TEST_DATABASE_URL=postgres://spica:spica@localhost:5432/spica_8b_restart_test pnpm.cmd test`: 104 files, 768 tests passed, exit 0. Vitest config has `fileParallelism: false`, so DB files ran serially.

`git diff --check`: passed. Self-review found no unrelated changes or additional code paths using the old prompt. Model output cannot supply the goal ID. No new schema field or job was added by this task.

## Handoff note

`spica-design-spec-v3.md` still names `prompts/life/event/v3.md`. The controller owns v3 documentation; Task 4 owns only the brief's files and this report.
