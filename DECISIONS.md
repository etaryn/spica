# Decisions

Choices not covered by `spica-design-spec-v3.md`, one line of reasoning each
(v3 §0.2). Open decisions (v3 §21) are not logged here: they need Ethan.

Decisions from before v3 (Phases 0–6) are in git history at the tag
`v2-final`; the ones that still shape the design are restated in v3 or in the
code itself.

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-10-01 | New config keys `turn.timer_job_retry_limit` (2), `turn.timer_job_retry_delay_seconds` (1), `life.min_busy` (0.3), `life.fallback_busy` (0.5) | Moves the last literals of the turn-timer queue policy and the day plan's busy levels into config. |
| 2026-10-01 | The inspector resolves due-thread ids in `judge_log` input to thread titles | They were shown as "(deleted)" because only facts were looked up. |
| 2026-10-01 | `src/lib` → `src/server` | It holds the Next.js server-only helpers (auth, session, inspector access); "server" says that, "lib" didn't. |
| 2026-10-01 | `src/queue/pg-boss-queue.ts` → `src/runtime/pg-boss-jobs.ts` | It is the runtime implementation of the jobs interface, next to the other Node implementations. |
| 2026-10-01 | `life_event_log`'s repo lives in `src/db/repos/user/` | The table still has `user_id`; it moves to `world/` when personal events become core events. |
| 2026-10-01 | `relativeDate` and `seededUnit` live in `src/mind/platform/` | They're used across engines; leaving them in `process/` would make world and state import process. |
| 2026-10-01 | The v3 restructure moved every file first, then rewrote | Keeps git's rename history for every file; the approved layout is unchanged. |
| 2026-10-01 | The `turn` config section is a `z.strictObject` | An override of a removed key (`backchannel_style`, `signals_probability`) now fails loudly instead of being ignored. |
| 2026-10-01 | The rule-4 guard fixture (`evals/guard/rule4-absence.yaml`) stays | It is the only coverage for four guard outage keywords; rule 4's remnants (fixture, keywords, `guilt` category, guard prompt) are one unit for the guard phase. |
| 2026-10-01 | `Param` → `HomeostaticParam` | Matches the spec's canonical name. |
