# evals — eval harness and review runs (spec §17)

- `run.ts` runs the YAML scripts in `scripts/` (108 of them: open only the one you need);
  `lib/` is the harness; `profiles/` are user profiles; `pnpm eval --llm=fake --compare` is free.
- **Real (paid) runs need Ethan's go-ahead.** Before starting one, name where its outputs will
  land. Every real model call goes through `lib/call-log.ts` (`realProvider`), which logs each
  prompt and output to `evals/results/calls/`; never construct a provider directly
  (`scripts/formats-add.ts` is the one exception). Real `pnpm eval` also writes the review file,
  trace and DB dump under `evals/results/`.
- Design a paid run to cover as many open items as one run can; use `--annotate` when judged
  checks (recall, false recall, consistency) are the point.
- The named runs are the `review:*`, `exit:*`, `calibrate:*` and `eval:*` scripts in
  `package.json`.
