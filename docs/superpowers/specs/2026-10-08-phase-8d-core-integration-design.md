# Phase 8d: Core integration design

Date: 2026-10-08. Parent design: `docs/superpowers/specs/2026-10-02-phase-8-core-loops-design.md` §§7–11. Source of truth: `spica-design-spec-v3.md` §§10.3, 12, 15, 17, 20, 21 #4, 25 (B53, B54).

Status: slice design approved in conversation with Ethan on 2026-10-08; this file is for his review before the plan.

## 1. Goal and boundary

8d closes Phase 8. Core recall leans toward her mood and her goals (B53). The reply learns the claim line, and the cold path measures how well her claims about herself are grounded in core (§21 #4, B54). The inspector shows the core mind's loops, budget and drift. A fourteen-day exit proves every loop runs within budget over two simulated weeks, and the leak canary covers every core loop. Nothing new is built for Phase 9; enforcing the claim line stays a guard-phase item.

Decisions taken with Ethan (2026-10-08):

| Question | Decision |
|---|---|
| Exit runs | One YAML script `evals/scripts/core-two-weeks.yaml`: exit 1 runs it all-fake from Vitest, exit 2 runs it with only the core loops real through `pnpm eval`. No new runner. |
| Real run | Run exit 2 once at slice close and report the review file. |

## 2. Recall (B53)

`core.memory.candidates` also returns each candidate's `valence` and `goal_sim`, computed in the same SQL: the highest cosine similarity between the memory's embedding and any active `core_goal` embedding, or 0 if she has no active goal. `retrieveCore` gives each candidate:

`boost = (1 + retrieval.core_mood_bias × valence × mood_valence) × (1 + retrieval.core_goal_bias × goal_sim)`

Both biases are 0.3, and `mood_valence` comes from `core.state.get()` (0 with no state). `RankableMemory` gains an optional `boost` (default 1) that multiplies the score in `rankMemories`. User retrieval passes no boost and is unchanged. Core retrieval stays read-only, and superseded, stale and hypothetical items stay excluded.

## 3. The claim line

### 3.1 Prompts

- **`prompts/reply/v11.md`:** v10 plus the parent design's §8.1 rule in her terms:
  - her life comes only from the sections about her that are in front of her, and she never promises anything about her own life;
  - her own opinions are at full strength, and on anything she has no view of yet she gives a first impression held lightly; "favourite", "the best" and "I hate" are only for what is hers;
  - reactions to the user are hers to give freely;
  - if something she told them earlier no longer matches who she is now, who she is now is true, and she may say she changed her mind.

  `config.prompts.reply` moves to `v11` and v10 is deleted.
- **`prompts/extract/v5.md`:** v4 plus a `claim_kind` (`life | opinion | reaction`) on every `self` fact, null for `user` and `shared` facts. The extraction zod schema gains the nullable field. `config.prompts.extract` moves to `v5` and v4 is deleted. The fake extractor emits `claim_kind` on its self facts.

### 3.2 Grounding

- **Migration:** `fact` gains a nullable `claim_kind` enum (`life | opinion | reaction`) and a nullable boolean `grounded`.
- **Core method:** `core.memory.groundingSimilarity(embedding): Promise<number>`. One query returns the best cosine similarity across recallable core memory (the same filter as `candidates`) and `core_self_line` rows, counting only core values (`version` null) and the latest snapshot's version. It takes no user and touches no user table.
- **Cold path:** after reconcile, for each candidate with `claim_kind` `life` or `opinion`, it calls `groundingSimilarity` with the embedding already computed. `grounded` is that similarity ≥ `claims.grounded_similarity` (0.75, recorded in `DECISIONS.md`). `claim_kind` and `grounded` are written when encode inserts the fact; a merge into an existing fact leaves the existing fact's values alone. Reading core here is allowed (V2 is one-way); the result is written only to the user's fact.
- **Failure:** a grounding query error is logged by class and leaves `grounded` null. It never fails the cold path.
- **Review:** eval review files report ungrounded `life` and `opinion` claims per conversation. Nothing blocks. The backlog gains `invented_self` (guard phase), which uses the same check.

## 4. Inspector

The Core tab (`src/app/inspector/core/page.tsx`, data from `inspectCore` in `src/db/repos/admin/inspector-core.ts`) adds plain tables in the existing style:

- **Budget today:** calls spent against `core.daily_call_budget` for her current local date, then a row per loop × status with its calls.
- **State:** the current rows plus emotion (label, valence, arousal, `about` phrase, since), needs and `last_nightly_day`.
- **Goals:** every goal with title, status, progress, source and dates.
- **Core memory:** counts by kind and status, and a recent list that also shows `superseded_by` and `payload.gist_of` / `gisted_into`.
- **Snapshots:** the last `inspector.snapshot_versions` (5) versions, each listing which sections changed from the version before. The latest version's content is shown in full.
- **Drift log:** the latest rows (version, check, value, verdict, score, excerpt).
- **Traces:** the existing columns plus status, calls, tokens in/out, cost and error class.

The per-user facts tab shows `claim_kind` and `grounded` for self facts. The access guard is unchanged.

## 5. Exits

### 5.1 Eval plumbing

- `evals/lib/life-loop.ts` calls `coreNightly` after `coreMindTick` every simulated hour, matching the worker's order.
- `ALL_PURPOSES` gains `core_reflect`, `core_consolidate`, `core_snapshot` and `core_drift`.
- The YAML `core` assertion gains structural checks:
  - `snapshot_versions` (min/max), counting versions above v0;
  - `drift_rows` per check (`values | diff | trend`, min);
  - `goals` (active min/max);
  - `fell_through` (a planned event with `outcome = fell_through` and a `resolution` event pointing at it);
  - `loops_done` (a list of loop names, each needing at least one `done` trace).
- `package.json` gains `exit:core`, an alias for `pnpm eval --script core-two-weeks` with `--real` set to `core_resolve, core_appraise, core_anticipate, core_ruminate, core_wander, core_reflect, core_consolidate, core_snapshot, core_drift`. Reply, extract, `life_plan`, `life_event`, reconcile, the guard and embeddings stay faked.

### 5.2 Script (`evals/scripts/core-two-weeks.yaml`)

- **Setup:** profile `none`, model plans (faked in both runs), and runs until day 14 12:00.
- **Injected events:**
  - a planned event early enough that anticipation is due inside its 12-hour window;
  - a strong event (|valence| ≥ 0.5) for rumination;
  - a planned event with `fallthrough: true`;
  - enough ordinary resolved episodes in the first week for a gist group.
- **Sessions:** one short session, so the user pipeline runs.
- **Assertions:** structural only: 14 snapshot versions; values, diff and trend drift rows; at least one active goal; the fell-through plan; every loop in `loops_done`. Content-dependent counts are left to exit 1's code and reported in exit 2's review file.

### 5.3 Exit 1 (`tests/exit/core-loops.test.ts`, in `pnpm test`)

The first case runs the script all-fake through `runScript` and requires every script assertion to pass. It then checks the database directly:
- each local day's summed core trace `calls` are ≤ the budget;
- a gist exists;
- a rumination thought exists;
- at least one goal's progress moved;
- needs moved from baseline;
- every Phase 8 loop has a `done` trace.

The second case overrides `core.daily_call_budget` to 6. It asserts optional loops trace `skipped_budget`, essentials trace `fallback`, and no day exceeds 6 calls.

If 336 hourly ticks make the test too slow (over about two minutes), the loop advances only through hours where something is due. The plan records that change if it is made.

### 5.4 Exit 2 (`pnpm exit:core`, on demand)

The same script with the core loops on real Haiku; the review file under `evals/results/` logs every core prompt and output. It needs `ANTHROPIC_API_KEY` and runs once at slice close. Its result is reported, and its quality is reviewed by hand later.

### 5.5 Canary

`tests/exit/mind-split.test.ts` also runs `coreMindTick` and `coreNightly` after user A's canary exchange. It scans `core_goal`, `drift_log`, `core_self_line` and the new trace columns, and checks that every core-loop prompt captured by `CapturingLLM` is free of the token. The side-channel assertion stays. The structural core-layer test also covers `groundingSimilarity`.

## 6. Testing

Unit tests:
- the boost maths, with no goals and with zero mood;
- `rankMemories` with and without a boost;
- `candidates` returning `goal_sim`;
- `groundingSimilarity` counting only core values plus the latest snapshot's lines, and excluding stale, superseded and hypothetical memory;
- the cold path writing `claim_kind` and `grounded` only for `life` and `opinion` claims, with a grounding failure leaving null;
- the extraction schema accepting `claim_kind`;
- the new `core` assertion checks;
- `inspectCore` returning the new sections.

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, the canary and exit 1, then exit 2.

## 7. Deleted or replaced

`prompts/reply/v10.md` and `prompts/extract/v4.md`. After merge: this file, the 8d plan, and the parent Phase 8 design (built; history in git).

## 8. Paperwork

- **v3:**
  - §6.2 (the `fact` columns), §10.3 (the boost), §12 (grounding), §15 (inspector), §17 (`exit:core`);
  - §20: Phase 8 built, with the fourteen-day exit;
  - §21 #4: settled as the claim line;
  - §25: B53 and B54 done, `invented_self` added (guard phase);
  - every new config key (`retrieval.core_mood_bias`, `retrieval.core_goal_bias`, `claims.grounded_similarity`, `inspector.snapshot_versions`) and prompt version.
- **`DECISIONS.md`:** the grounding threshold and the snapshot-version count.
- **CLAUDE.md:** current phase becomes "Phase 8 built; next is Phase 9 (user mind), needs a design doc".
- **Memory:** the phase-status note is updated.
