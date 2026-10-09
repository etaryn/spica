# Phase 9d: User consolidate, user model, full Phase 9 exit — design

Date: 2026-10-09. Status: approved in conversation, awaiting spec review.

Phase 9 (user mind, v3 §9) is built in slices:

| Slice | Builds |
|---|---|
| 9a (built) | Big-event triggers, `user_mind_run`, the loop runner and `user_loop_trace`, `user_summarise`, the summary slot |
| 9b (built) | `user_reflect`, `user_ideate`, the ideas slot, outreach `core_thought` and `user_idea`, B26 |
| 9c (built) | `long_conversation`, `crisis_passed`, `stale_summary`, crisis-aware user mind, window trim, memory view removed, inspector User mind tab |
| **9d (this doc)** | `user_consolidate` (user `episode` gists), `user_model` (her read on the user plus `belief` facts), the full Phase 9 exit |

## Intent

After a big event she takes stock of the person, not only of what happened: how they are, what
they want, what lands with them, and a few standing beliefs she revises as she learns. Older
weeks with them fold into a remembered gist ("that week you were packing for Osaka") instead of a
pile of separate facts. Phase 9 closes with one scripted two-week run proving every trigger fires
its batch once, idle users cost nothing, and nothing leaves the user's scope.

Test phase: functionality over accuracy; prompts are first drafts, reviewed by hand later.

## Decisions taken with Ethan (2026-10-09)

- **The model fact has three fields**, like the summary: `how_they_are`, `what_they_want`,
  `what_lands`.
- **Beliefs: at most 2 per run, revisable.** `user_model` may name a live belief it was shown that
  a new one replaces; that belief is superseded.
- **Full Phase 9 exit is a scripted multi-day run**, all fake, plus a real review run
  (`pnpm exit:user`) that now includes consolidate and model.
- **Batch order** summarise → reflect → model → ideate → consolidate.
- **Consolidate runs only in a triggered run**, never nightly: cost scales with big events; an
  idle user's facts just decay.
- **Gist eligibility drops "resolved".** User facts reach `resolved` only when a later fact
  resolves them, so "resolved event or feeling facts" would almost never gist. A fact is history
  instead when it is old enough and not on an open thread. (`DECISIONS.md` entry.)

## 1. Batch and data

`runUserMind` (`src/mind/process/user/run.ts`) runs five loops in order, each through
`runUserLoop` with its own trace; a failed loop does not stop the next; the run is `failed` if any
loop failed. The daily cap and everything else from 9a–9c are unchanged.

Migration 0026 adds `episode`, `model`, `belief` to `fact_kind`. The extraction enum excludes
them (along with `summary`, `reflection`, `idea`).

| Kind | Subject | Retrieval | Reconcile neighbour | Decay | Loop input as a new memory | Reply |
|---|---|---|---|---|---|---|
| `episode` (gist) | `shared` | yes | no | yes | no | through retrieval |
| `belief` | `user` | yes | no | yes | no | through retrieval |
| `model` | `user` | no | no | no | no | own slot, "Your read on them" |

Filter changes: retrieval's exclusion list gains `model`; `nearFacts` and
`listFactsForSummary` exclusions gain `episode`, `model`, `belief`; decay's exclusion list gains
`model`.

**Sensitive mark** (sticky, as 9c): a model or belief is written `payload.sensitive` when it read
a sensitive memory, a sensitive summary, a sensitive reflection or a sensitive previous model. A
gist never reads sensitive facts.

## 2. `user_consolidate`

`src/mind/process/user/consolidate.ts`, prompt `prompts/user-mind/consolidate/v1.md`
(`prompts.user_consolidate: v1`).

**Eligible facts** for one user: kind `event` or `feeling`; subject `user` or `shared`; status
`open` or `resolved`; not sensitive; `payload.gisted_into` unset; `thread_id` null or on a thread
whose status is not `open`; dated (`occurred_at`, else `created_at`) before the start of the local
day `user_mind.consolidate.gist_after_days` (7) days ago, in the user's timezone (UTC when unset).

**Group:** eligible facts by Monday-start local week; take the oldest week with at least
`min_group` (3) facts; at most `max_sources` (12) of them, highest salience first (ties by id). One
group per run.

**Call:** inputs `{who_you_are, week, sources: [{id, content, occurred_at}]}`; output
`{gist: string}` fitted to `max_chars` (300); `max_tokens` 512.

**Write** (one transaction, re-checking the group is still eligible with the same ids, as
`core_consolidate` does; a changed group writes nothing):
- one `episode` fact: subject `shared`, source `generated`, status `recurring`, salience = max of
  sources, valence 0, confidence `user_mind.consolidate.confidence` (0.6), `occurred_at` = earliest
  source, `payload.gist_of` = source ids, `source_ref` `user_consolidate:<traceId>`, embedded;
- each source: `payload.gisted_into` = gist id, salience × `gist_source_factor` (0.5), once.

No eligible group: zero-call `done` trace. Invalid model output (ZodError): `fallback` trace,
nothing written. Trace inputs: week and source ids; outputs: gist id.

## 3. `user_model`

`src/mind/process/user/model.ts`, prompt `prompts/user-mind/model/v1.md`
(`prompts.user_model: v1`).

**Inputs:** the snapshot; the live summary (as this run wrote it); this run's reflection if any;
the run's new memories (sensitive included, flagged); the relationship line; the triggers in
words; the previous live model's three fields; up to `user_mind.model.belief_context` (10) live
beliefs with ids, by salience.

**Output:**

```ts
{
  how_they_are: string;   // each fitted to user_mind.model.max_chars (300)
  what_they_want: string;
  what_lands: string;
  beliefs: { text: string; replaces: string | null }[];  // at most max_beliefs (2)
}
```

`max_tokens` 512.

**Writes:**
- One `model` fact: subject `user`, source `generated`, status `open`, salience 0.6, confidence
  0.6, payload the three fields (plus `sensitive` when marked), content the three fields joined
  (so it is readable on its own). It supersedes the previous live model under the same per-user
  advisory lock the summary uses.
- Each belief: a `belief` fact, subject `user`, source `generated`, status `open`, salience 0.5,
  confidence 0.6, `source_ref` `user_model:<traceId>`, embedded. A belief whose embedding has
  similarity greater than `user_mind.model.dedupe_similarity` (0.92) to a live belief is dropped
  and listed in the trace outputs. A `replaces` id naming a live belief the loop was shown marks
  that belief `superseded` by the new one; any other `replaces` is ignored and the belief is
  simply inserted.

Trace inputs: summary, reflection, fact, previous model and belief ids; outputs: model id, belief
ids, superseded ids, dropped texts.

## 4. Reply, ideate, outreach, inspector

- **Reply slot "Your read on them"**, right after "Where things stand with them" in
  `assemble.ts`: three short lines. None in a crisis. A reach-out reads the newest non-sensitive
  model (as the summary does). Read through `bounded` like the summary; a malformed payload
  renders nothing.
- **Ideate** gets the model's three fields as `your_read_on_them` only when the model is not
  sensitive.
- **Outreach:** no new candidate. The model reaches a reach-out only through the slot above.
- **Inspector User mind tab:** the live model and live beliefs next to the summary and
  reflections; gists show in the facts list with their `gist_of` count.

## 5. Config

```json
"user_mind": {
  "consolidate": {
    "gist_after_days": 7, "min_group": 3, "max_sources": 12, "gist_source_factor": 0.5,
    "max_chars": 300, "max_tokens": 512, "confidence": 0.6
  },
  "model": {
    "max_chars": 300, "max_tokens": 512, "max_beliefs": 2, "belief_context": 10,
    "dedupe_similarity": 0.92, "salience": 0.6, "belief_salience": 0.5, "confidence": 0.6
  }
},
"prompts": { "user_consolidate": "v1", "user_model": "v1" }
```

## 6. Fakes, tests, exit

**Fakes** (`FakeLLMProvider`, deterministic): `user_consolidate` echoes its sources' contents
into one gist line (so a canary carries through); `user_model` echoes its input into the three
fields and returns one belief, with `replaces` set to the first belief id it was shown, if any.

**Unit tests:** consolidate grouping and week boundary (local timezone), exclusions (open thread,
sensitive, already gisted, too recent, wrong kind), max sources, the re-check race, zero-call and
fallback traces. Model: supersede under lock, belief replace with a valid and an invalid id,
dedupe, sensitive mark from each source. Slot: present, absent in a crisis, the reach-out
non-sensitive variant, order after the summary. Ideate: sees a non-sensitive model only.

**Full Phase 9 exit**: `tests/exit/user-mind.test.ts` over `evals/scripts/user-mind-two-weeks.yaml`
via `runScript`, all fake, about 14 days, three users:
- Alice: sessions that fire `salient_fact`, `param_jump` / `param_band`, `make_up_done`,
  `long_conversation`, a crisis then `crisis_passed`, and `stale_summary` before a reach-out; the
  canary is planted in her facts.
- Bob: a light, ordinary life.
- Carol: created, never talks.

Assertions:
1. Every non-capped `user_mind_run` has exactly five `user_loop_trace` rows; each `source_ref` is
   recorded once; rerunning the ticks adds no runs.
2. No user has more than `max_triggers_per_day` non-capped runs on a local date.
3. Carol has no runs and no traces.
4. Alice has at least one gist after day 7; its sources carry `gisted_into` and were cut once; no
   gist source is sensitive.
5. Alice has exactly one live model; at least one belief is superseded by a newer belief.
6. Every `summary`, `reflection`, `idea`, `episode`, `model`, `belief` row belongs to the user
   whose memory produced it.
7. Core tables are unchanged by user activity (side channel).
8. The canary never appears in Bob's prompts, any core prompt or any core table.

`tests/exit/mind-split.test.ts` adds `user_consolidate` and `user_model` to its user-mind canary
checks (purposes and kinds).

**Real review run:** `pnpm exit:user` runs `user-mind-two-weeks` with
`--real extract,user_summarise,user_reflect,user_model,user_ideate,user_consolidate`, logging every
input and output. Quality is not an exit criterion.

## 7. Docs

v3: §6.1 kinds, §9.2, §9.3 (inferred state lives in the model fact), §9.5 (9d built, the table),
§11.3 theory of mind, §20 rows, config keys. `DECISIONS.md`: gist eligibility. CLAUDE.md: current
phase line. This spec and the plan are deleted once built.

## Out of scope

Common ground, disclosure ledger, idiolect (Phase 10); user `thought` facts; a nightly user
consolidate; reclaiming stale `running` runs (B64) and the cap race (B65).
