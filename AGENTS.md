# Spica agent instructions

Codex is the current project driver. This repository is shared with Claude and
work may alternate between the two agents. Keep the working tree coherent for
the next agent: preserve existing work, avoid drive-by refactors, and leave
tests and documentation in a usable state.

## Required reading and authority

Before coding, read `CLAUDE.md`. It is the project-wide engineering contract,
not Claude-specific documentation. Treat it as authoritative together with:

- `spica-design-spec-v3.md` for product and architecture requirements;
- `DECISIONS.md` for decisions not covered by the spec;
- the current phase design document under `docs/superpowers/specs/`;
- the matching implementation plan under `docs/superpowers/plans/`.

Do not edit `CLAUDE.md` or other Claude instruction files. If this file needs
to change, update only `AGENTS.md`; do not copy the whole Claude summary into
it, since duplication will drift.

## Scope and implementation rules

- Implement only the confirmed current phase. The plan is executable
  specification: if the plan and code disagree, stop and report the mismatch
  rather than inventing a design.
- Re-read the relevant v3 section before touching mind, memory, state, scope,
  turn-taking, relationships, persona, world, or outreach code.
- Never settle an item marked OPEN in v3. Ask Ethan when the choice changes
  behaviour or architecture.
- For an uncovered, low-impact choice, choose the simplest scope-respecting
  option and add one dated line to `DECISIONS.md`.
- Build replacements cleanly: remove the replaced path, dead configuration,
  prompts, tests, and schema in the same phase. Do not add compatibility
  shims unless the plan explicitly requires them.
- Preserve the core/user boundary. Core code must not receive `user_id` or
  user data; users must not mix; user conversation must not mutate core state.
- Put numeric constants in config, prompts in versioned `prompts/` files, and
  timestamps behind the injected `Clock`.
- Follow the repository layout, naming, dependency direction, and TypeScript
  conventions in `CLAUDE.md`. Read the relevant installed Next.js guide before
  changing Next.js code.

## Workflow

1. Inspect the tree and git status before editing; preserve unrelated changes.
2. Read the required documents and identify the exact plan step being done.
3. Make the smallest complete change with `apply_patch`.
4. Update tests, migrations, config, prompts, and v3 documentation required by
   the change; do not leave undocumented new fields or jobs.
5. Run proportionate verification, normally `pnpm typecheck`, `pnpm lint`, and
   the relevant tests. For a phase exit, also run the exit test, leak canary,
   and side-channel test required by v3.
6. Report what changed, what was verified, any pre-existing failures, and any
   unresolved decision or plan/code mismatch for the next agent.

## Safety and handoff

Do not reset, discard, delete, or rewrite user work without explicit request.
Use dev-only database commands only against the local development database.
Keep comments focused on why a rule exists, not on spec sections or agent
history. Before handing off, leave the repository buildable and make the
remaining scope obvious in the final summary.
