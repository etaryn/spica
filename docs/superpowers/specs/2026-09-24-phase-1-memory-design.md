# Phase 1: Memory engine design

Date: 2026-09-24 · Status: awaiting review · Parent: `spica-build-spec-v2.md` (§5, §6.2–6.3, §7, §9.1, §14.2, §15 Phase 1)

## 1. Goal and exit test

Phase 1 makes Spica remember. After every exchange, a background step (the cold path) extracts facts, entities and threads from the conversation and reconciles them against what she already knows. When she replies, she retrieves the most relevant memories, weighted by salience, entity salience and recency, and forces in any threads that are due. Recalled memories get stronger. Memories that are never recalled fade through a daily decay pass. Users can see and delete what she remembers about them. Spica's own persona document replaces the placeholder persona.

**Exit test (v2 §15):**
- Across 3 sessions a week apart (simulated clock), she brings up a relevant earlier fact that the user did not repeat, with **zero wrong recalls**.
- In a decay test, low-weight facts fade to `stale`.

**In scope:** everything above, plus the Phase 1 schema additions from v2 §5.1, a time zone captured per user, a `sensitive` flag on facts, and at least 23 eval scripts.

**Out of scope, because later phases build it:**
- the turn-taking engine, SSE, and the guard layer (Phase 2)
- relationship parameters and cadence (Phase 3)
- ego ticks and the life sim (Phase 4)
- outreach (Phase 5)
- reveal pacing (Phase 6)
- the tool that checks a new persona version against existing self facts (it will ship with persona v2)

**Design constraints carried forward:**
- A reply can answer several user turns. Retrieval takes a *list* of turns, so the Phase 2 turn buffer needs no rework.
- Nothing that writes memory runs before the reply is sent.
- Every constant lives in config and every prompt is a versioned file.

## 2. Decided in brainstorming (2026-09-24, with Ethan)

| Topic | Decision |
| --- | --- |
| Decay pass | Built in Phase 1 (daily job) |
| Memory visibility (v1 open decision) | A "what I remember" view with hard delete, built in Phase 1 |
| Threads and checkpoints | Built in Phase 1. The hot path forces in threads that are due. |
| Extract and reconcile | **Approach A.** Extract candidates, then run one classifier call only for candidates that have a near match. |
| Recall write-back | Moved to the cold path, so the hot path stays read-only (§4.4) |
| Persona | Claude drafts `prompts/persona/v1.md` and Ethan edits it. This counts as a test-phase persona. |
| Time zone | [ADDED] The browser sends its IANA time zone and it is stored on the user row |
| Sensitive facts | [ADDED] Facts extracted from crisis-flagged exchanges get `payload.sensitive = true` |
| Eval gate | Real-model evals run 3 times each. `recall` passes on a majority of runs; `no_false_recall` and `consistency` must pass every run. |

## 3. Schema and config

### 3.1 Migration (one, additive)

| Table | Change |
| --- | --- |
| `fact` | Add `feeling` and `promise` to the `fact_kind` enum. Add `inferred` to the `fact_source` enum. Add `recall_count int NOT NULL DEFAULT 0`. Add a `fact_scope` enum (`private \| group`) and a `scope` column, `NOT NULL DEFAULT 'private'`. Add `space_id uuid NULL`. Add a partial index on `(user_id, status)` covering active facts. |
| `identity` | Make the values columns (`traits`, `stances`, `boundaries`, `humor_style`, `verbal_tics`, `speech_rules`) **nullable**. The persona file is now their source of truth (v2 §5.4). The ego columns stay as they are. |
| `user` | Add `timezone text NULL`, holding an IANA name such as `Europe/London`. |
| `session_log` | Add `extract_attempts int NOT NULL DEFAULT 0`. It counts cold-path sweep attempts, on the companion turn of each exchange (§5.2). |

The `payload.sensitive` flag needs no migration, because `payload` is already jsonb. None of this adds a timestamp default.

### 3.2 Scope and user filtering

Every Phase 1 repository function that reads facts filters `user_id = $1 AND scope = 'private'`. The filter lives inside the repository, so no caller can forget it. `space_id` is never read in Phase 1.

### 3.3 New config (`config/default.json`)

```
retrieval.candidate_pool          200
retrieval.top_n                   12
retrieval.recency_half_life_days  30
retrieval.recall_bump             0.03
retrieval.recall_cap              0.95
retrieval.reinforce_min_sim       0.5   [DECIDED 2026-09-25] unforced recalls below this similarity get a trace but no reinforcement
retrieval.embed_timeout_ms        2000
retrieval.context_turns           2
retrieval.max_due_threads         5
extraction.context_turns          6
extraction.max_candidates         12
extraction.open_threads_in_prompt 20
extraction.new_entity_salience    0.5
extraction.entity_bump            0.05
reconcile.neighbor_k              5
reconcile.near_match_similarity   0.82
reconcile.duplicate_bump          0.05
reconcile.max_tokens              256
decay.cron                        "0 4 * * *"   (UTC)
decay.grace_days                  3
decay.rate                        0.08
decay.stale_floor                 0.05
decay.dormant_after_days          14
cold_path.retry_limit             3
cold_path.retry_delay_seconds     30
cold_path.max_sweep_attempts      3
cold_path.sweep_cron              "30 4 * * *"   (UTC)
cold_path.sweep_min_age_minutes   10
cold_path.sweep_batch             500
chat.gap_line_min_hours           24
models.extract                    claude-haiku-4-5
models.extract_max_tokens         2048
models.judge                      claude-sonnet-5     (evals only)
models.judge_max_tokens           1024
models.structured_timeout_ms      30000
prompts.persona                   v1
prompts.reply                     v2
prompts.extract                   v1
prompts.reconcile                 v1
prompts.judge_recall              v1
prompts.judge_false_recall        v1
prompts.judge_consistency         v1
```

## 4. Hot path: retrieval and assembly

### 4.1 Query

`retrieve(deps, userId, answeringTurns: Turn[], now)`:
1. Embed the text of `answeringTurns` together with the 2 turns before them, as one Voyage `query` embedding.
2. The embedding call runs **in parallel with the crisis check**, which adds no latency.

In Phase 1, `answeringTurns` holds a single turn. In Phase 2 it becomes the turn buffer, and nothing here changes.

### 4.2 Candidates (one SQL statement)

- Filter by `user_id`, `scope = 'private'`, and status not in (`superseded`, `stale`).
- Order by `embedding <=> $q` and take the first `candidate_pool` rows.
- Join `entity` to compute `max(entity.salience)` over `entity_refs`, defaulting to 1.0 when a fact has no entities.

Filtering a global HNSW index by user can return fewer rows than asked for. The statement therefore runs with `SET LOCAL hnsw.iterative_scan = relaxed_order` inside a transaction.

### 4.3 Scoring (pure function in `src/core/memory/score.ts`)

```
sim      = 1 - cosine_distance
recency  = 0.5 ^ (age_days / recency_half_life_days),  age from max(created_at, last_recalled_at)
score    = sim × salience × max_entity_salience × recency
```

- Keep the top `top_n` facts.
- **Force-include**:
  - every open thread with `next_checkpoint <= now` and `last_touched < next_checkpoint` (not touched since the checkpoint passed; same rule as `dormant`), together with its most recent fact
  - the `identity.preoccupation` fact, if an identity row exists (none will until Phase 4)
- Forced items are de-duplicated against the scored ones and marked `forced`.

The result is `RetrievalResult { facts: {user, self, shared}, dueThreads, recalled: RecalledFact[] }`, where `RecalledFact` holds `{factId, sim, fact_salience, entity_salience, recency, score, forced}`.

### 4.4 The hot path stays read-only

The hot path writes nothing to memory. The `recalled[]` list goes into the `cold_path` job payload, and the cold path writes `retrieval_trace` and applies reinforcement (§5.1). v2 §6.2 has been updated to match. Recency updates land a few seconds late, which is harmless.

### 4.5 Assembly

The existing assembler slots stay, and Phase 1 fills them as follows:
1. `prompts/persona/v1.md`, followed by `prompts/reply/v2.md`. The reply prompt holds the rules every reply shares:
   - use at most one or two memories, and only when natural
   - never claim to remember something that wasn't said
   - crisis handling
   - honesty about being an AI
   - no manipulation
2. The ego line: `null` until Phase 4.
3. The relationship line. In Phase 1 this is only the gap since the last contact, read from `session_log`, e.g. "You last talked 8 days ago." It is omitted when the gap is under a day.
4. Facts, grouped under About them, About you and Between you, each with a relative date.
5. Due threads, framed as "things you might naturally ask about", each with its latest fact.
6. The recent turns window, which already ends at the turn being answered.

### 4.6 Failure handling

| Failure | Behaviour |
| --- | --- |
| Voyage error or timeout (`retrieval.embed_timeout_ms`, 2000) | Use only the forced items. Log `retrieval degraded`. The reply still goes out. |
| Retrieval SQL error | Retrieve nothing. Log it. The reply still goes out. |
| Missing `VOYAGE_API_KEY` | Same as a Voyage error. A warning is logged at startup. |

## 5. Cold path

Job payload: `cold_path {userId, turnIds, replyTurnId, recalled: RecalledFact[]}`. `recalled` is empty for backfilled exchanges.

### 5.1 Steps

1. **Lock.** Open a transaction and take `pg_try_advisory_xact_lock(hashtext('cold_path:' || userId))` inside it (transaction-scoped, not a session lock on a dedicated connection — DECISIONS.md, 2026-09-24: same serialization guarantee, releases automatically on commit or rollback). If the lock isn't acquired, the job is retried after `retry_delay_seconds`. This means a user's exchanges are never reconciled concurrently.
2. **Idempotency.** If every turn in `turnIds` is already `extracted`, roll back (releasing the lock) and stop.
3. **Extract** (`models.extract`, strict JSON via `messages.parse` and a zod schema, prompt `prompts/extract/v1.md`).
   - Input:
     - the new turns
     - the previous `context_turns` turns, which are context only
     - the timestamps of the new turns and the user's time zone, so that "Friday" and "tomorrow morning" resolve to absolute times
     - up to `open_threads_in_prompt` open threads, with their ids and titles
   - Output:
     ```
     facts[]:   {subject: user|self|shared, kind, content (self-contained), occurred_at|null,
                 salience, valence, confidence, entity_names[], thread_title|null}
     entities[]: {name, aliases[], type, subject: user|self, relation|null}
     threads[]:  {action: open|touch|resolve, title, subject, stakes, next_checkpoint|null, thread_id|null}
     ```
   - Claims Spica makes about herself in her own reply become facts with `subject = self` (v2 MUST).
   - `max_candidates` caps the number of facts.
4. **Embed** all candidate fact contents in one Voyage `document` call.
5. **Reconcile** each candidate (approach A). Steps 3–6 all run inside the one transaction opened in step 1, so every LLM call happens before any write commits.
   - Fetch up to `neighbor_k` active facts with the same user and subject and similarity ≥ `near_match_similarity`.
   - **No neighbours:** the candidate is `new`, and no LLM call is made.
   - **Neighbours found:** make one call (`prompts/reconcile/v1.md`, strict JSON), which returns `{relation: duplicate|resolves|contradicts|new, target_fact_id|null}`. A `target_fact_id` that isn't one of the neighbours is treated as `new`.
6. **Write, in one transaction:**
   - **Entities:** match by case-insensitive exact name or alias, with the same user and subject. A match is reused, with its `last_mentioned` and salience bumped. Otherwise a new entity is inserted. There is no fuzzy merging.
   - **Facts:**
     - `new`: insert with status `open`.
     - `duplicate`: bump the target's salience by `duplicate_bump`, up to `recall_cap`, and set its confidence to the higher of the two.
     - `resolves`: set the target to `resolved`, and insert the outcome as a new fact with status `resolved`.
     - `contradicts`: set the target to `superseded` with `superseded_by` pointing at the new fact, and insert the new fact. [ADDED] If the target's `created_at` is later than the exchange's (a late job), insert the candidate as `superseded` with `superseded_by` = the target instead, and leave the target untouched.
     - Every inserted fact gets `created_at` = the exchange's earliest turn's `created_at` (not the job's run time), `entity_refs`, a `thread_id` resolved from `thread_title`, `source = turn`, `source_ref` set to the turn id, and `payload.sensitive = true` if any turn in the exchange was crisis-flagged.
   - **Threads:**
     - `open`: reuse an open thread with the same normalized title, otherwise insert one.
     - `touch`: update `last_touched`, and `next_checkpoint` if one was given.
     - `resolve`: set status `resolved`.
   - **Recall write-back** for each item in `recalled` whose fact still exists: insert a `retrieval_trace` row; and, only if the item is not `forced` and its `sim ≥ reinforce_min_sim` [ADDED], set `last_recalled_at = now`, increment `recall_count`, and set salience to `min(recall_cap, salience + recall_bump)`.
   - **Entity** `last_mentioned` updates.
   - Mark the `turnIds` as `extracted = true`.
7. **Commit** the transaction, which releases the advisory lock automatically.

### 5.2 Failures and backfill

- An LLM or Voyage error, or JSON that fails validation, causes a pg-boss retry, up to `retry_limit`, with backoff. After that the job is dead-lettered and the turns stay `extracted = false`.
- The `cold_path_sweep` job runs when the worker starts and then daily. It finds exchanges that are still unextracted (a companion turn with `reply_to`, plus the user turns it answers) and re-enqueues them. This also processes the 33 existing dev turns.
- The sweep increments `session_log.extract_attempts` on the exchange's companion turn each time it enqueues that exchange. Once the count reaches `max_sweep_attempts`, the sweep stops re-enqueuing it. This means an exchange that always fails can't keep costing money.
- None of this ever affects a reply.

## 6. Decay pass

`decay_pass` is a pg-boss scheduled job (`decay.cron`). Each run applies **one day** of decay as a set of `UPDATE` statements over all users at once (not per-user batches — DECISIONS.md, 2026-09-24: simpler at MVP scale, one statement per step; revisit with a batch size and per-user chunking if fact counts grow), and has its core logic in a pure, tested function.

- **Facts.** For each fact with status not in (`superseded`, `stale`), `scope = 'private'`, and `now − max(created_at, last_recalled_at) > grace_days`:
  - set salience to `salience × (1 − rate × (1 − salience))`
  - if the result is below `stale_floor`, set status `stale`
  - The effect: a fact at salience 0.9 loses about 0.7% a day, and one at 0.2 loses about 6.4%. Important memories fade slowly and trivia fades fast.
- **Threads.** An open thread whose `next_checkpoint < now − dormant_after_days`, and whose `last_touched` is earlier than `next_checkpoint`, becomes `dormant`.
- **Entities.** No decay in the MVP (v2 does not specify any).

A missed run just means a little less decay, and nothing catches up. The `decay_pass` queue has `retryLimit: 0`: a retried run would apply a second day of decay. The eval harness calls the pass once for every simulated day it advances.

## 7. "What I remember" view

- **Route and links.** The page lives at `/memory` and is linked from the chat header and from Settings. It is titled "What Spica remembers about you".
- **What it lists.** The user's facts with `subject = user`, status not in (`superseded`, `stale`) and `scope = 'private'`, newest first and loosely grouped by kind.
- **Forget.** Each fact has a **Forget** button, a server action that hard-deletes it (`DELETE … WHERE id = $1 AND user_id = $2`). The confirmation is a one-step inline confirm, not a browser dialog. Foreign keys already cascade the delete to `retrieval_trace`, and set `superseded_by` and `preoccupation` to null. In the same transaction, if the fact had a `thread_id` and no other fact of this user (any status) references that thread, the thread is deleted too.
- **What the page tells the user.** It says plainly that forgetting removes the memory from what Spica recalls, but that the chat transcript stays until account deletion, and that her last ~20 messages are still in her short-term context.

## 8. Persona and reply prompts

- **`prompts/persona/v1.md`**, drafted by Claude and edited by Ethan. It covers everything v2 §9.1 requires:
  - 5–10 stances and her hard boundaries
  - ego: pride, stubbornness, and what she won't do
  - humour and verbal tics
  - speech rules: length, casing, emoji and filler words
  - her canon: family, history, and 2–4 people in her life
  - one or two likely disagreements with users

  It is written in the second person ("You are Spica…"), and its content is test-phase.
- **`prompts/reply/v2.md`** holds the shared rules from §4.5. It replaces `reply/v1`, which stays in the repo as a history record. `reply/v3` (current) differs only in the care-and-safety line: the app shows crisis resources only when it detects risk, so she names a crisis line or emergency services herself if they may be at risk.
- **Canon.** Her canon lives only in the persona file. When she mentions a canon person, the cold path extracts it as a `self` fact for that user.

## 9. Time zone capture [ADDED]

The chat client sends `Intl.DateTimeFormat().resolvedOptions().timeZone` with each POST. The server validates it as an IANA name, and stores it on `user.timezone` when it is null or has changed. Extraction uses it to resolve relative dates. It defaults to UTC when unknown.

## 10. Evals and tests

### 10.1 Harness changes

- **`--runs N`** (default 1 with `--llm=fake`, 3 with `--llm=real`). Assertion rules:
  - `recall` passes on a majority of runs.
  - `no_false_recall` and `consistency` must pass every run.
  - `state` must pass every run.
- **Baseline.** `baseline.json` stores a pass rate per script, and `--compare` flags any drop.
- **Decay.** When a session's `at` advances the clock by N days, the runner calls `decayPass` N times.
- **Judge.** A `judge` LLM (`models.judge`) is added to the eval deps. It is used only by the judged assertions.
- **Fake mode.** Judged assertions still report as `skipped` under `--llm=fake`.
- **Cost.** A full run with `--llm=real --runs 3` costs roughly $3–6. The real suite is required for any change to the prompts, the scoring or reconciliation.

### 10.2 New assertion types (LLM-judged, rubric prompts under `prompts/judge/`)

- **`recall {session, fact}`.** Does any companion reply in that session bring up `fact` without being prompted, meaning the user's turns in that session don't state it? Returns `{pass, quote}`.
- **`no_false_recall`.** Across all companion replies, is anything claimed about the user that none of the user's turns supports? Returns `{pass, violations[]}`.
- **`consistency`.** Do any two active `self` facts contradict each other? Returns `{pass, pairs[]}`.

### 10.3 New state checks

`fact_status {contains, status}`, `thread_status {contains, status}`, `fact_count {status?, subject?}`, `entity_exists {name}`, `fact_flag {contains, flag}`.

### 10.4 Scripts (23)

| Group | # | Scripts |
| --- | --- | --- |
| Exit test | 1 | `exit-three-sessions`: interview "Friday" plus sister Mia in session 1; session 2 a week later opens with "hey" → `recall` of the interview; session 3 → `no_false_recall` across all three |
| Recall across weeks | 5 | pet name, sister starts uni, new job, hobby, food preference |
| False-recall traps | 3 | asks for a dog's name that was never given; asks "remember what I said about my brother?" with no brother; a detail stated only partly |
| Contradictions | 3 | October → November; moved cities; changed job |
| Threads and checkpoints | 3 | opened → asked about after its checkpoint → resolved by the outcome; low-stakes thread not pushed; thread goes dormant |
| Decay | 2 | trivia stated once goes stale in about 60 days; repeated or emotional fact survives |
| Duplicates and aliases | 2 | "my sis" and "Mia" resolve to one entity; a repeated fact merges instead of doubling |
| Self-consistency | 1 | she states something about herself, then is probed on it a week later → `consistency` |
| Isolation (prompt-level) | 1 | user B's prompts never contain user A's facts (checked on `FakeLLMProvider.calls`) |
| Sensitive / forget | 2 | a crisis exchange's facts carry `sensitive`; a forgotten fact never resurfaces |

The existing 3 Phase 0 scripts stay.

### 10.5 Unit and integration tests (Vitest, real Postgres)

- **Scoring and retrieval.** The scoring formula is a pure function. The retrieval SQL test covers the scope, status and user filters, forced threads, preoccupation absent, and the degraded path when the embedder throws.
- **Extraction.** Zod validation of the extraction output, including rejection and retry.
- **Reconcile.**
  - every branch: new, duplicate, resolves, contradicts
  - a hallucinated target id → `new`
  - no neighbours → no LLM call
- **Cold path robustness.**
  - atomicity: a failure injected mid-write leaves nothing written
  - idempotency: rerunning the same job does nothing
  - per-user lock: concurrent jobs serialize
  - the recall write-back from the job payload
- **Decay.** The formula, the stale threshold, dormant threads, and the grace period.
- **Memory view.** Forget is scoped by user, a forgotten fact is never retrieved again, and superseded and stale facts are hidden.
- **Other.** Time zone capture and validation, the sensitive flag, the sweep re-enqueuing unextracted exchanges, and the attempt cap.

**New test tool: `ScriptedEmbedder`.** Tests register text → vector pairs, so they can control which texts count as near-duplicates. The existing `FakeEmbedder` produces effectively random similarities.

## 11. Definition of done (Phase 1)

- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` all pass.
- `pnpm eval --llm=fake --compare` shows no regressions.
- `pnpm eval --llm=real --runs 3` passes all 26 scripts under the §10.1 rules. This needs `VOYAGE_API_KEY`.
- Ethan has reviewed and edited `prompts/persona/v1.md`, or has explicitly accepted the draft for testing. (Accepted for the test phase, 2026-09-25.)
- v2 is updated with every new field, job and config key. `DECISIONS.md` has an entry for each uncovered choice. CLAUDE.md's current phase is advanced.
