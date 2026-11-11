---
name: review-run
description: Use before and after any paid model run in Spica (review:*, exit:*, calibrate:*, eval:guard, eval:judge, or pnpm eval with --real / --llm=real). Pre-flight for purpose, cost and logging; afterwards, turns the outputs into findings without reading raw logs whole.
---

# Paid review runs

Every paid run needs Ethan's go-ahead, every time. The paid-run hook also prompts.

## Before

1. **Purpose:** the open items this run answers (§25 B-numbers, the slice's settled-lines
   memory). Design one run to cover as many as it can.
2. **Command:** the exact pnpm script. Real calls must go through `realProvider`
   (`evals/lib/call-log.ts`) so every call is logged; `--review --trace` on, plus `--annotate`
   when judged checks (recall, false recall, consistency) are the point.
3. **Cost:** estimate from the `usage` block of the last comparable run in `evals/results/<stamp>.json`,
   or calls × model price; state it.
4. **Outputs:** `evals/results/review-<stamp>.md` (read this), `evals/results/calls/<tool>-<stamp>.jsonl`
   (every prompt and output), `evals/results/traces/<stamp>/` (trace and DB dump).
5. **Ask Ethan** with purpose, command, cost and outputs in at most five lines.

## Run

DB up (`pnpm db:up`), one run at a time, in the background.

## After

6. Read the review markdown first. Open the call log or trace only for a specific finding (grep by
   script or exchange), never whole.
7. Each finding names its B-item (or proposes a new one) with evidence: the file and a short quote.
   Don't change prompts during the analysis: in tuning, each item's line is settled with Ethan
   first.
8. Record the findings in the slice's settled-lines memory or `phase-status`, and update §25 once
   Ethan agrees.
