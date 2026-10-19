# src/db — schema and repos (spec §6)

- `schema.ts` is the truth for every table. Don't read `migrations/` to learn the schema; the
  `migrations/meta/` snapshots are 3 MB of generated JSON and are hidden from search by `.ignore`.
- Change the schema in `schema.ts`, then `pnpm db:generate` for the next numbered migration. Never
  edit an applied migration.
- Repos: `repos/user/` (every function takes `userId` first, every query scoped by it),
  `repos/core/` (no `user_id` anywhere), `repos/world/`, `repos/admin/` (cross-user: the inspector
  and the sweeps/ticks that walk every user; core code may never import it, ESLint enforces).
- Domain table properties are snake_case (`session_log.user_id`); Better Auth tables are camelCase
  (required).
- Timestamps come from the injected `Clock`; never `DEFAULT now()`.
- A replaced column is dropped in the same phase that replaces it.
