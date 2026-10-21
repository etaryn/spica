# prompts (spec §7 for the persona)

- One folder per process (hyphenated), one file per version: `reply/v18.md`. The live version of
  each is set in `config/default.json` under `prompts`; load through `loadPrompt`
  (`src/mind/platform/prompts.ts`).
- Changing a prompt means a new version file plus the config bump; delete versions nothing
  configures. Add the new version to the spec.
- Persona `persona/v<N>.md` has `# Core values` (fixed, never rewritten), `# Seed self` (snapshot
  v0, then rewritten nightly by core loops) and `# Public voice` (feeds only `publicPersona`).
  v7 holds lines Claude drafted that await Ethan's rewrite: don't edit the persona without him.
- She is openly an AI, sibling of Alcor; identity disclosure is honest, in her own voice.
- Numbers belong in config, not prompt text; a prompt describes, code decides.
