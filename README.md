# Spica

A standalone AI best friend. Source of truth: `Spica — MVP build spec.md`. Agent context: `CLAUDE.md`.

## Run locally

1. Prerequisites: Node LTS, pnpm, Docker Desktop.
2. `cp .env.example .env`. Set `BETTER_AUTH_SECRET`, `ANTHROPIC_API_KEY` and `INSPECTOR_ADMIN_EMAILS`.
3. `pnpm install`
4. `pnpm db:up && pnpm db:migrate`. Re-run `pnpm db:migrate` after pulling new migrations: tests migrate their own database, the dev database does not.
5. `pnpm dev` (app on http://localhost:3000) and `pnpm worker` (cold-path jobs)

## Checks

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (needs `pnpm db:up`)
- `pnpm eval --llm=fake --compare`: eval harness against the committed baseline
- `pnpm eval --llm=real`: same scripts against the real models (costs money)
