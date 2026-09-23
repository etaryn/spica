# Decisions

Choices not covered by `Spica — MVP build spec.md`, per spec §0. One line of
reasoning each. Open decisions from spec §9.1 are NOT logged here — they need
the human.

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-09-23 | Stack: TypeScript, Next.js, Drizzle, pg-boss, Vitest, pnpm | Human choice; one language across UI, API, worker and evals; pg-boss keeps the queue in the one database. |
| 2026-09-23 | Anthropic Claude for reply + cheap models, behind `LLMProvider` | Human choice; provider may change later, so it is isolated to one adapter + config. |
| 2026-09-23 | Voyage `voyage-3.5`, 1024-dim embeddings | Human choice; dimension fixed in Phase 0 schema to avoid a later re-embed migration. |
| 2026-09-23 | Better Auth, email + password | Human choice; auth tables in our Postgres make account deletion one cascade. |
| 2026-09-23 | Session boundary = user idle gap > `session.idle_gap_minutes` (30) | Simplest definition of `session_id`; no extra table. |
| 2026-09-23 | Trace tables `retrieval_trace`, `ego_tick`, `reach_out_log` | Spec §8.1 inspector needs them; diagnostic logs never read by the chat loop, so not a second memory store. |
| 2026-09-23 | `session_log.safety_flag` jsonb | Records crisis-check outcome per companion turn for inspector and evals. |
| 2026-09-23 | Crisis check runs in parallel with generation; resources card appended by code | Guardrail without added hot-path latency; card presence is guaranteed, not model-dependent. |
| 2026-09-23 | Keyword fallback when crisis classifier fails or times out | A classifier outage must not disable a mandatory guardrail. |
| 2026-09-23 | Encryption at rest at storage level (managed Postgres / encrypted disk) | Satisfies §9.2 without column crypto that would break vector search; revisit if threat model requires. |
| 2026-09-23 | Timestamps written from injected `Clock`, never `DEFAULT now()` | Eval harness simulated clock must be the only time source. |
| 2026-09-23 | Inspector disabled in production by default (`INSPECTOR_ENABLED`) + admin allowlist | Staff access to user memories is a privacy question; closed until deliberately opened. |
| 2026-09-23 | Replies returned whole, no streaming | Fits texting metaphor; simpler retry/idempotency. |
| 2026-09-23 | Crisis resources are region-keyed config with an international default | Resources differ by country; content must be reviewed before launch. |
| 2026-09-23 | `session_log.reply_to` (unique) links a companion turn to the user turn it answers | Makes client retries and double-submits idempotent without a second table. |
| 2026-09-23 | Reply model runs at `effort: low`, `reply_max_tokens` 4096 | Hot-path latency; Sonnet 5 adaptive-thinking tokens count toward max_tokens. |
| 2026-09-23 | Eval/test DB wipes refuse unless the DB name ends in `_test` or `_eval` | A misconfigured URL must never truncate dev or prod data. |
| 2026-09-23 | TypeScript pinned `~6.0` | pnpm resolved TS 7 (native port); typescript-eslint 8.x supports <6.1. |
| 2026-09-23 | pnpm `allowBuilds: esbuild` only | pnpm 12 blocks install scripts by default; esbuild backs tsx, drizzle-kit and vitest. |
| 2026-09-23 | Better Auth table ids default to `gen_random_uuid()` | Better Auth 1.7 with `generateId: "uuid"` lets Postgres generate ids. |
| 2026-09-23 | `readEnv` treats blank `.env` values as unset | `KEY=` lines from `.env.example` must not crash startup. |
| 2026-09-23 | Inspector admins allowlisted by user id (`INSPECTOR_ADMIN_USER_IDS`), not email | Sign-up emails are unverified; an email allowlist could be claimed by whoever registers the address first. |
| 2026-09-23 | Crisis classifier sees the last `safety.classifier_context_turns` (4) turns as context (prompt v2) | Intent spread over messages ("yes, tonight") must still surface resources. Keyword fallback stays on the latest message only. |
| 2026-09-23 | Cold-path enqueue bounded by `queue.enqueue_timeout_ms` (2000); producer pg-boss warmed at server start | A slow queue must never delay a reply. A timed-out enqueue may still land; unextracted turns are reprocessed either way. |
| 2026-09-23 | Prompt window ends at the user turn being answered (`turnsUpTo`) | Retrying an older failed message must not send later turns or an assistant-last history. |
