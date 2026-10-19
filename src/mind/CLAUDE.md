# src/mind — the mind (spec §3–4, §8–13)

- Framework-free: no Next imports, no `Date.now()`, no `process.env`. Everything comes through the
  injected `Deps` (`platform/deps.ts`); time comes from `Clock`; numbers from config.
- Four engines, each split into `core/` and `user/` (plus `shared/`): `memory/` (store), `state/`
  (values that drift), `world/` (what happens), `process/` (appraise, think, decide, express);
  `platform/` holds LLM, embedder, clock, config, jobs, prompts.
- Engine laws: world events reach memory only through appraisal; state moves only in code; plans
  are memory, outcomes are world; hypotheticals are marked unreal.
- Core-only code takes `CoreDeps` (no `db`, no `user_id`); core loops live in `process/core/` and
  each writes `core_loop_trace` within `core.daily_call_budget`. ESLint stops core, world and
  shared code importing user, process or admin-repo code: don't work around it.
- Message flow: POST → crisis check ∥ turn judge → `turn-taking/` → `hot-path/` (`composeFrom`:
  retrieve → assemble → one generation) → `guard/` (one check, one regeneration, fallback) →
  `shapeText` → pacing/`availability/` → SSE + push → `cold-path/` (extract → reconcile → update
  state; tone nudges the user's affect, never core mood → big-event check). A reach-out is a reply
  with a synthetic trigger through the same hot path.
- The hot path is read-only; memory writes never delay a reply.
- Code owns the numbers, the LLM writes the content: scoring, gates, thresholds and state changes
  are in code; a prompt never decides a number that code could.
- Every LLM process has a deterministic fake (`platform/llm/fake`).
