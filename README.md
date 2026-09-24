# Spica

A standalone AI best friend. Source of truth: `spica-build-spec-v2.md`. Agent context: `CLAUDE.md`.

## Run locally

1. Prerequisites: Node LTS, pnpm, Docker Desktop.
2. `cp .env.example .env`. Set `BETTER_AUTH_SECRET` and `ANTHROPIC_API_KEY`. After signing up, put your user id in `INSPECTOR_ADMIN_USER_IDS` to open `/inspector` (see `.env.example`).
3. `pnpm install`
4. `pnpm db:up && pnpm db:migrate`. Re-run `pnpm db:migrate` after pulling new migrations: tests migrate their own database, the dev database does not.
5. `pnpm dev` (app on http://localhost:3000) and `pnpm worker` (cold-path jobs)

## Checks

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (needs `pnpm db:up`)
- `pnpm eval --llm=fake --compare`: eval harness against the committed baseline
- `pnpm eval --llm=real`: same scripts against the real models (costs money)
- `pnpm eval --llm=real --runs 3` needs `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`, and a Voyage account rate-limit tier that can absorb the embedding calls from a full run back to back — the last attempt errored on every script with an HTTP 429 before any assertion ran
