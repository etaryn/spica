# tests (spec §17)

- Layout mirrors the source: `tests/mind/<engine>/...` for `src/mind`, `tests/db/` for repos,
  `tests/exit/` for phase exit tests, `tests/evals/` for the eval harness.
- Helpers: `helpers/llm.ts` (`sequence` for scripted outputs, `CANARY`, `CapturingLLM`),
  `helpers/deps.ts`, `helpers/db.ts` (tests migrate their own DB; never point at the dev DB).
- Exit tests cover only the phase's own functionality with deterministic assertions. The reply
  model is always faked; the guard is faked (passes unless the test scripts it); other fakes are
  agreed per phase with Ethan. Quality is never an exit criterion.
- Every exit test includes the leak canary (a token planted in user A's data never appears in core
  or in user B's prompts) and the side-channel check (user A's exchange leaves core state
  unchanged). Copy the pattern from `exit/phase-15d.test.ts`.
- A failing test is reported as failing with its output; never weaken an assertion to pass.
