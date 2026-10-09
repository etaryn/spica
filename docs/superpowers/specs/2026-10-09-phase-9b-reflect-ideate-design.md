# Phase 9b: Reflect, ideate, ideas slot, new outreach candidates — design

Date: 2026-10-09. Status: approved in conversation, awaiting spec review.

Phase 9 (user mind, v3 §9) is built in three slices. 9a (foundation, `user_summarise`, the summary
slot) is built.

| Slice | Builds |
|---|---|
| 9a (built) | Big-event triggers, `user_mind_run`, the user loop runner and `user_loop_trace`, `user_summarise`, the summary slot |
| **9b (this doc)** | `user_reflect`, `user_ideate`, the ideas slot, outreach `core_thought` and `user_idea` candidates, B26 |
| 9c | `user_consolidate`, `user_model`, the remaining triggers, inspector User mind tab, B2, full Phase 9 exit |

## Intent

After a big event she does more than summarise: she forms a view of the person (a reflection)
and thinks of something she wants to bring up (an idea). Reflections come back through ordinary
retrieval when relevant. An idea gets one chance: once in a reply, or as the reason for a
reach-out. Separately, a recent thought from her own life can become a reason to write first.

Test phase: functionality over accuracy. Reflection and idea quality is for review runs.

## Decisions taken with Ethan (2026-10-09)

- **§21 #7 settled: ideas only.** `user_ideate` ideas feed outreach as `user_idea`; reflections
  never become reach-out candidates.
- **Reflections are read through normal retrieval**, not a fixed slot.
- **An idea gets one chance**: retired once offered in a reply's slot or used by a reach-out;
  unused ideas expire after a TTL.
- **Batch shape: one run, three loops in sequence** (summarise → reflect → ideate), each with its
  own prompt and trace. Not one combined call, not a run per loop.

## 1. Data

One migration: `fact_kind` gains `reflection` and `idea`. No new tables or columns.

## 2. The batch

`runUserMind` runs `userSummarise`, then `userReflect`, then `userIdeate`, each through
`runUserLoop` (its own `user_loop_trace`). Later loops read what earlier ones wrote. A loop that
throws is traced `failed` and the next still runs; the run is `failed` if any loop failed,
otherwise `done`. A loop that returns nothing (`null` output) is `done` and writes nothing.

Cost: 3 calls per run; with `user_mind.max_triggers_per_day` (3), at most 9 per user per day.

## 3. `user_reflect`

Prompt `prompts/user-mind/reflect/v1.md`, `prompts.user_reflect` v1, model `models.user_mind`.

**Inputs** (this user only, plus the snapshot read-only):
- the live summary (the one summarise just wrote, or the previous if summarise failed);
- the new memories this run's summarise read (its trace's `inputs.fact_ids`; if summarise failed,
  the same query summarise uses), sensitive excluded;
- her `user_mind.reflect.recent` (5) most recent live reflections about this user, so she
  doesn't repeat herself;
- the phrased relationship line ("You and them");
- the run's triggers in words (the summarise `triggerText`, shared);
- the snapshot.

**Output**: strict JSON `{ reflection: string | null, subject: "user" | "shared" }`; the text is
fitted to `user_mind.reflect.max_chars` (300); `max_tokens` `user_mind.reflect.max_tokens` (384).

**Writes** (non-null only) one fact: `kind = reflection`, the given `subject`,
`source = generated`, `source_ref = user_reflect:<traceId>`, embedded, `status = open`,
salience `user_mind.reflect.salience` (0.5), confidence `user_mind.reflect.confidence` (0.6).
Trace `inputs`: summary id, fact ids, recent reflection ids; `outputs`: reflection id or null.

**Read back** through normal user retrieval ("About them" or "Between you" by subject). It decays
like any fact. It is **excluded from cold-path reconcile**: it is her inference, and a turn fact
must not merge into or supersede it.

## 4. `user_ideate`

Prompt `prompts/user-mind/ideate/v1.md`, `prompts.user_ideate` v1, model `models.user_mind`.

**Inputs**: the live summary; this run's new reflection, if any; the same new memories as
reflect; open threads (top `user_mind.summarise.max_threads`, sensitive excluded); her live ideas
for this user (to avoid duplicates); the snapshot.

**Output**: `{ idea: string | null }`, fitted to `user_mind.ideate.max_chars` (200);
`max_tokens` `user_mind.ideate.max_tokens` (256). At most one idea per run.

**Writes** (non-null only) one fact: `kind = idea`, `subject = shared`, `source = generated`,
`source_ref = user_ideate:<traceId>`, embedded, `status = open`, salience
`user_mind.ideate.salience` (0.5), confidence `user_mind.ideate.confidence` (0.6).

**Live idea**: `kind = idea`, `status = open`, created within `user_mind.ideate.ttl_days` (3) of
now. Expiry is a read-time filter; no job. Ideas are **excluded from retrieval, reconcile, decay
and outreach `user_event` inputs** (like summaries), so they never appear twice.

## 5. The ideas slot and retirement

**Slot 7** of the reply, after "They asked and you haven't answered yet": heading **"Things you
want to bring up"**, at most `user_mind.ideate.slot_max` (1) live ideas, newest first. Assembled
by code; the reply prompt version does not change. Skipped for crisis replies and for reach-outs
(a reach-out has its own "Why you're writing"; a second topic invites cramming).

**Retirement** (one chance):
- **Shown in a reply**: `Composed` gains `offeredIdeas: string[]` (ids). The cold-path job
  carries them next to `recalled`; the cold path, in its transaction, moves each still `open` to
  `resolved`. A reply composed but never sent enqueues no cold path, so its idea stays live.
- **Won a reach-out**: the send transaction (the one inserting the turn) marks the idea
  `resolved`. Its topic `idea:<id>` enters `usedTopics` through the reach-out log as today.
- **Expired**: no longer read; the row stays `open` and visible in the memory view.

## 6. B26

In the reach-out send transaction, a winner of kind `make_up` moves `make_up_state` from `due` to
`offered`, so the next reply doesn't offer the make-up again (`advanceMakeUp` already treats
`offered` this way for replies).

## 7. Outreach candidates

`KIND_ORDER` becomes `[thread, make_up, user_event, her_day, core_thought, user_idea, check_in]`.

- **`user_idea`**: one candidate per live idea for this user; topic `idea:<id>`; strength =
  salience; `factId` = the idea. Weight `outreach.weights.user_idea` (0.6): salience 0.5 scores
  0.30.
- **`core_thought`**: her core memories of kind `thought` or `idea` created in the last
  `outreach.core_thought_lookback_hours` (24), at most `outreach.core_thought_limit` (3),
  recallable only (no hypotheticals, nothing future-dated); topic `core:<id>` (the `her_day`
  namespace, so one memory reaches a user once whichever kind carries it); strength = salience;
  `coreMemoryId` set. Weight `outreach.weights.core_thought` (0.5): a medium thought (0.4) scores
  0.20, on the threshold, so her own musings rarely beat anything about the user (noted with
  B25). Read through `deps.core.memory` (no user id): core → user, allowed by V2.

The send gate and the reach-out prompt are unchanged; the candidate text fills "Why you're
writing" as today.

## 8. Memory view

`reflection` and `idea` get labels in the memory view and are hard-deletable like any fact.

## 9. Config

`user_mind.reflect.{max_chars 300, salience 0.5, confidence 0.6, max_tokens 384, recent 5}`;
`user_mind.ideate.{max_chars 200, salience 0.5, confidence 0.6, max_tokens 256, ttl_days 3,
slot_max 1}`; `outreach.weights.{user_idea 0.6, core_thought 0.5}`;
`outreach.core_thought_lookback_hours` 24, `outreach.core_thought_limit` 3;
`prompts.user_reflect: "v1"`, `prompts.user_ideate: "v1"`. Each value gets a `DECISIONS.md` line
(test-phase default).

## 10. Testing

**Unit**: reflect and ideate write on non-null, nothing on null, fit text; the batch continues
past a failed loop and finishes `failed`; reconcile, retrieval and decay exclusions; assembly
renders the slot and skips it for crisis and reach-outs; the cold path retires offered ideas only
while `open`; candidates for `user_idea` and `core_thought` (scores, topics, sort order,
hypotheticals excluded); B26 transition on send.

**Exit** `tests/exit/phase-9b.test.ts`, all fake, scripted extraction, deterministic fakes for
both loops:
1. A trigger runs exactly one batch: 3 traces, one summary, one reflection, one idea.
2. The next reply's prompt contains the ideas slot; after its cold path the idea is `resolved`;
   the following reply has no slot.
3. A loop returning null writes nothing and the run is `done`; a failing reflect still runs
   ideate and the run is `failed`.
4. A live idea wins a reach-out (topic `idea:<id>`) and is resolved in the send transaction.
5. A recent core thought yields a `core_thought` candidate for two users; each receives it at
   most once.
6. B26: after a make-up reach-out is sent, `make_up_state` is `offered`.
7. An idle user runs no loop; core tables are identical before and after every run.

**Canary** `tests/exit/mind-split.test.ts`: `CapturingLLM` echoes into `user_reflect` and
`user_ideate`; A's token never appears in B's prompts or outputs, or anywhere in core.

**Review run** `pnpm exit:user` adds real `user_reflect` and `user_ideate`; every input and
output is written to `evals/results/`.

Definition of done: typecheck, lint, `pnpm test`, the 9b exit, the canary.

## 11. Spec and doc updates (same work)

v3 §6.1 (`reflection`, `idea` kinds), §9.2, §9.5 (the batch, both loops), §10.3 slot 7, §13
(the two candidates, B26), §15 (3 calls per run), §20 (9b row), §21 #7 settled (ideas only),
§25 (B26 closed; core_thought weight noted with B25), `CLAUDE.md` phase line, `DECISIONS.md`.

## Out of scope for 9b

`user_consolidate`, `user_model`, the remaining triggers, the inspector User mind tab, B2, any
send-gate change, and any change to how params move.
