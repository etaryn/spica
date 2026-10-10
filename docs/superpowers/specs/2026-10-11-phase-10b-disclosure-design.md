# Phase 10b: How deep she goes — design

Date: 2026-10-11. Status: approved in conversation, awaiting spec review.

Phase 10 (relationship psychology, v3 §11.3) slices: 10a how closeness grows (built), **10b
depth tiers, disclosure ledger, common ground (this doc)**, 10c bids and idiolect, 10d stages,
commitment, the first-time milestone trigger and the full exit. Attachment stays out (§21 #8).

## Intent

Today every user sees the same self: the whole snapshot and whatever core memories rank highest.
After 10b her self is tiered by depth and she reveals deeper tiers as closeness grows and as the
user opens up in return (Altman & Taylor). Chemistry matters as well as time: a conversation that
goes deep can draw her one tier past her usual limit, but only as a glimpse; a later conversation
can turn that glimpse into a heart to heart. Something she isn't ready to share shows as "not
yet", and she may deflect or play it down, never invent. A ledger records what each user has
actually heard from her, and common ground marks what each side knows the other knows.

Test phase: functionality over accuracy; every threshold is a first guess, tuned in review runs.

## Decisions taken with Ethan (2026-10-11)

- **Depth is judged where an item is written** (by the core loop's existing call), not derived
  from kind; existing rows are backfilled by kind.
- **A hard gate plus a held-back line**, with a **chemistry stretch**: one tier above the usual
  limit, as a **peek** (hint, don't tell), when the moment calls for it.
- **Peek vs open** is part of every item offered and of every ledger row.
- **Truthful deflection now; tracked white lies later** (backlog, its own design: cover stories in
  the ledger, kept consistent, confessable when closer; meets the guard-phase `invented_self`
  decision). Honesty about being an AI (§7.6) is never relaxed.
- **Allowed depth in discrete steps** from closeness, with reciprocity holding her back.
- **The ledger records what she actually said**, found through the grounding match.
- **Common ground is derived marks in the prompt**, both directions; no new table.

## 1. Depth on her self (core side, the same for every user)

**Columns:** `core_memory.depth` and `core_self_line.depth` (smallint 1–3: 1 surface, 2 personal,
3 intimate). A line's section is read from the snapshot content it came from, so it needs no
column.

**Who writes depth:**
- Every core loop that writes memories through the model adds one `depth` field to its output,
  with the rubric "1 = she'd tell an acquaintance, 2 = a friend, 3 = only someone close":
  appraise (episodes), wander / ruminate / anticipate (thoughts), reflect (reflections, insights,
  opinions, interests and whatever else it writes), consolidate (gists: the deepest of their
  sources unless the model says otherwise). Each prompt bumps a version; old versions are deleted.
- Code-written memories (intentions from the day plan) take `core.depth.by_kind[kind]`.
- Snapshot render v2 tags each bullet with a depth, stored on its self line.
- Seed-self lines take `core.depth.by_section[section]`; core-value lines are always 1 (who she
  is, an AI with a sibling and her loves, is never secret).

**Existing rows:** the migration backfills `core_memory.depth` by kind (interest, opinion 1;
episode, goal, intention, thought, idea, hypothetical 2; reflection, insight, narrative,
agent_note 3). Existing self lines become 1, which is what every user sees today, so nothing
changes for them until the next render. No model backfill.

A malformed or missing depth from the model falls back to the kind default; it never fails the
loop.

**Scope:** core loops write core; no user data is involved.

## 2. How deep she goes in a reply (hot path, read-only)

**`depthFor(inputs, settings)`** (new `src/mind/state/user/relationship/depth.ts`, pure) returns
`{ open, peek }`:
- **Usual limit (`open`):** 1, +1 at closeness ≥ `relationship.depth.bands.personal` (0.4), +1 at
  ≥ `bands.intimate` (0.65).
- **Reciprocity:** her recent sharing = mean depth of this user's last
  `depth.reciprocity_window` (10) ledger rows, scaled to 0–1 as `(depth − 1) / 2` (none → 0).
  If it exceeds their `user_disclosure` level by more than `depth.reciprocity_gap` (0.35), `open`
  drops one tier (never below 1).
- **Stretch (`peek`):** `open + 1` (at most 3) when her openness disclosure is in its high band, or
  this session went deep (`session.deep_fired`, or session mean moment ≥ `depth.stretch_moment`
  0.5); otherwise `peek = open`.
- **Level, in one place:** an item at or below `open` is open; above it, it is open if the ledger
  already holds a peek of it (the glimpse became the story), else a peek. The hot path tags with
  this rule and the cold path records with it, so no offered tags are stored.
- **Reach-out:** no live chemistry, so `peek = open`. Outreach candidates from her own memories
  (`her_day`, `core_thought`) skip items deeper than `open`.
- **Crisis:** the crisis reply already skips her own memories; `{ open: 1, peek: 1 }` is stored.

**The prompt:**
- **"From your own life":** core retrieval keeps items with `depth ≤ peek`. An item above `open`
  is tagged *(only hint at this)*. An item the ledger shows was peeked before and is now within
  `peek` is offered open (the path from a glimpse to the full story).
- **"Who you are lately":** rebuilt from the latest snapshot's self lines with `depth ≤ open`,
  grouped under their section headings in snapshot order. The snapshot never stretches.
- **Held back:** the best-matching retrieved candidate above `peek`, if its similarity is ≥
  `depth.held_back_similarity` (0.6) and no earlier reply in this session held back the same item,
  adds one line in a new "Not ready to share" slot after "From your own life": *There's something
  about this you're not ready to share with them yet.* The hot path checks this session's earlier
  reply rows, so it stays read-only.

**Recorded:** `Composed.depth: { open: number; peek: number; held_back: string | null }`, stored on
the reply's `session_log.depth` (jsonb) by the same three insert sites as `openness`.

**Reply prompt v13** (v12 deleted) adds: follow the hint tags (a peek is a glimpse, not the
story); if they press on something you're not ready to share, deflect, play it down or change the
subject — never invent something about yourself, and always be honest that you're an AI.

## 3. The ledger and common ground

**Table `disclosure`** (user-scoped): `id`, `user_id` (cascade), `ref_kind` (`memory |
self_line`), `ref_id` (uuid, no foreign key: core tables never depend on user tables, and core
items are never hard-deleted), `depth`, `level` (`open | peek`), `fact_id` (her self fact, set
null on delete), `turn_id` (the reply), `created_at`. Index on `(user_id, created_at)` and
`(user_id, ref_id)`. Rows append; readers take the highest level per item.

**Writing it (cold path):** grounding becomes `CoreMemory.groundingMatch(embedding)` returning
`{ similarity, ref: { kind, id, depth } | null }` (still no user, no user table). For each `life`
or `opinion` self fact whose similarity is ≥ `claims.grounded_similarity`, the cold path inserts a
ledger row in the same transaction: `level = peek` when the item's depth is above the reply's
stored `depth.open`, else `open` (a reply with no stored depth counts as `open`). A reach-out's own
cold path records rows too. A crisis exchange writes none. A claim that extraction merges into an
earlier self fact still records a row, so a peek told again openly is upgraded. No extra calls: grounding already embeds and queries.

**Common ground marks:**
- *Her side:* each "From your own life" item, by this user's ledger: told open → *(they already
  know this)*; only peeked → *(you've hinted at this before)*.
- *Their side:* each memory about them, by `source`: `turn` plain; `onboarding` *(from when you
  first met)*; `generated` or `inferred` *(your own guess, they never said this)*. Retrieval passes
  the source through.
- Reply v13 adds: build on what they already know; never present your own guess as something they
  told you.

**Inspector (Relationship tab):** the ledger (when, item text, depth, level) and the last reply's
depth limits.

**Scope:** the ledger and marks are user-scoped; core is read only (V2); nothing user-side
reaches a core loop. The canary covers the ledger and the depth marks.

## 4. Storage, config, deletions

**Migration 0028:** `core_memory.depth smallint not null default 2` then the backfill by kind;
`core_self_line.depth smallint not null default 1`; `session_log.depth jsonb`; table `disclosure` with its indexes.

**Config:** `relationship.depth` (`bands.personal`, `bands.intimate`, `reciprocity_window`,
`reciprocity_gap`, `stretch_moment`, `held_back_similarity`); `core.depth.by_kind`,
`core.depth.by_section`; prompt version bumps.

**Deleted:** the superseded core loop prompt versions, `prompts/core/snapshot/v1.md`,
`prompts/reply/v12.md`, `groundingSimilarity` (replaced by `groundingMatch`).

## 5. Tests

**Unit:** `depthFor` bands, reciprocity drop and floor, stretch from openness and from a deep
session, reach-out never stretches; retrieval filter and tags; held-back line threshold and once
per item per session; snapshot rebuilt from lines within `open`; `groundingMatch` returns the
ref; ledger level from the stored limit, none in a crisis; both common-ground marks; core loops
parse `depth` and fall back to the kind default; the backfill by kind.

**Exit** `tests/exit/phase-10b.test.ts` (all fake, reply faked, guard off), over seeded core items
at tiers 1–3:
1. A new user's prompt has no tier-3 item; a close friend's does.
2. A deep session stretches her: the next tier appears tagged as a hint, and the ledger records a
   peek when she says it.
3. A peeked item later appears open.
4. Out-sharing them drops her usual limit a tier.
5. A strong match beyond reach gives the held-back line once per session.
6. A reach-out to a stranger never carries a deep item.
7. Told items are marked; her guesses about them are marked as guesses.
8. A crisis writes no ledger rows.
9. The leak canary and side channel: one user's ledger never changes another user's prompt or
   core.

**Review run** `pnpm exit:disclosure`: an eval script over days with real extraction and real
core writes, logging each reply's limits, tags offered and the ledger.

## 6. Spec updates (v3)

§6.1 `disclosure`, depth columns, `session_log.depth`; §8.5 core loops write depth; §10.3 tags,
held-back slot, marks, reply v13; §11.3 disclosure ledger and reciprocity, common ground **Built
10b**; §12.6 `groundingMatch`; §17.1 inspector ledger; §20 the 10b row; §25 new item: tracked white
lies (target 10d or its own slice). `DECISIONS.md`: backfill by kind; core values tier 1; ledger
refs without a foreign key into core.
