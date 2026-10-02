# Agent instructions

Read `CLAUDE.md` first: it is this project's instructions for every coding agent, not only
Claude. Follow it exactly. In particular:

- `spica-design-spec-v3.md` is the source of truth; `CLAUDE.md` summarises it.
- `DECISIONS.md` records choices the spec doesn't cover; read it before making one, and add a
  one-line row for any new one.
- The current phase's design doc is in `docs/superpowers/specs/`, its plan in
  `docs/superpowers/plans/`. Implement plans exactly as written; if the plan and the code
  disagree, stop and say so rather than improvising.
