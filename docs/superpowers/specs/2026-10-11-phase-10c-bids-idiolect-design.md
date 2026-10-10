# Phase 10c: Bids and idiolect — design

Date: 2026-10-11. Status: approved in conversation, awaiting spec review.

Phase 10 (relationship psychology, v3 §11.3) slices: 10a how closeness grows (built), 10b depth
tiers, disclosure ledger, common ground (built), **10c bids and idiolect (this doc)**, 10d stages,
commitment, the first-time milestone trigger and the full exit. Attachment stays out (§21 #8).

## Intent

Today how the user meets her small reaches (a joke, a question, her news) only shows up inside the
general warmth signal, and an inside joke is just another `shared` fact that may or may not come
back. After 10c, turning toward or away from her bids has its own small, code-owned consequence
(Gottman), and the things that are theirs alone, the jokes, nicknames, rituals and running
references, are recognised once they recur and reused when they're close enough.

Test phase: functionality over accuracy; every number is a first guess, tuned in review runs.

## Decisions taken with Ethan (2026-10-11)

- **Turning away costs a little:** toward a small warmth gain, away a small warmth drop, against a
  bigger warmth drop plus a small trust drop. No running ratio param.
- **Idiolect is a candidate first, established when it recurs** in a later exchange; only
  established idiolect is offered for reuse.
- **Closeness gates reuse, with a they-started exception:** below the band she still echoes what
  the user started. Coining new ones is left to the reply model at any closeness.
- **Both read by extraction v7**, the cold path's existing call: no new model calls, jobs or tables.

## 1. Bids

**Read:** extraction v7 adds `bid_response: "toward" | "away" | "against" | null`. It judges her
last message before the new exchange (the end of "Earlier conversation"): if she made a bid (a
joke, a question, her news or excitement, an invitation, a reach-out), how did the user's new
messages meet it?
- *toward*: picked it up, laughed, answered it, asked back.
- *away*: ignored it, went straight to their own topic.
- *against*: mocked, rebuffed or snapped at it.
- null when her last message held no bid. A value outside the enum is null; it never fails the
  memory write.

**Code guards** (`normalizeBid` in `signals.ts`): the response is null when
- the exchange has no user turn (a reach-out on its own);
- her last earlier message is in a different `session_id` from the first new user turn (coming
  back after a gap is not turning away), or there is no earlier message of hers;
- the exchange is a crisis exchange (nothing in the relationship moves).

**Effect** (`applyBid` in `transitions.ts`, cause `bid`, `detail.response`):
`relationship.bids.effects` gives a delta per param per response, defaults toward
`{ warmth: 0.03 }`, away `{ warmth: -0.03 }`, against `{ warmth: -0.06, trust: -0.03 }`. Gains use
the same diminishing returns as signal gains; losses don't. Skipped when the user has ended the
relationship, as warmth and trust signals are today.

**Overlap:** the `warmth` signal still judges the user's overall manner; the bid is a separate,
smaller read of the response to one reach. They can stack in the test phase (flagged for tuning).

**Inspector:** bid events appear in the Relationship tab's existing event list.

**Scope:** user state only; core is never read or written (V4).

## 2. Idiolect

**Storage:** new fact kind `idiolect`, always `subject: shared`, with
`payload.idiolect = { type: "joke" | "nickname" | "ritual" | "reference", started_by: "user" |
"spica", established_at: string | null }` (ISO time). Content is self-contained, e.g. "The user
calls Spica 'Starfish' after the aquarium mix-up". User-scoped like every fact.

**Read:** extraction v7 may emit `kind: "idiolect"` facts with `idiolect_type` and `started_by`
(required for the model, null for other kinds; fixtures without them read as null). Emitted for a
funny moment that could become a running joke, a nickname either side gives, a small ritual, or a
running reference, **and again whenever either of them calls back to one**, so reconcile can match
it. The prompt's "an inside joke" example moves from generic `shared` facts to this kind. Missing
or invalid fields on an idiolect fact fall back to `type: reference`, `started_by: user`.

**Candidate, then established** (encode):
- A new idiolect fact is inserted with `established_at: null`.
- When reconcile judges a later candidate a `duplicate` of an idiolect fact, and the candidate's
  `source_ref` differs from the target's (a different exchange), `established_at` is set to the
  exchange time if still null. A repeat within the same exchange doesn't count.
- `contradicts` (the nickname changed) supersedes as usual; the new fact starts as a candidate.
- A crisis exchange's facts are `sensitive`; a sensitive idiolect fact is never offered.

**Where it is read:**
- Left out of ordinary user retrieval (the kind exclusion lists that already hold `idea`,
  `summary`, …), because it has its own slot.
- Still a reconcile neighbour, so callbacks find it.
- Still decays to `stale` like any fact, so an unused joke fades; stale items are never offered.

**Reply slot "Your things together"** (after "What you remember"), built on the hot path from the
retrieval query embedding (read-only):
- Candidates: active, established, non-sensitive idiolect facts with similarity ≥
  `relationship.idiolect.min_similarity` (0.3); top `idiolect.max_items` (2) by similarity ×
  salience.
- **Gate:** closeness ≥ `idiolect.min_closeness` (0.4) allows any; below it only
  `started_by: user`. No relationship yet counts as below.
- Each line is the fact's content plus one mark from `started_by`: *(they started this)* or
  *(you started this)*.
- Crisis: the slot is empty. Reach-out: the same gate applies.
- Offered items join the existing recall write-back, like retrieved facts.

**Reply prompt v14** (v13 deleted) adds: "Your things together" is yours and theirs alone; use at
most one when it fits naturally, never explain it, answer to a nickname they gave you, and don't
force it.

**Inspector (Relationship tab):** idiolect facts with type, who started it, and candidate or
established.

**Not in 10c:** the "first inside joke" milestone trigger (10d, with the other milestones).

## 3. Storage, config, deletions

**Migration 0029:** add `idiolect` to the fact kind enum. No columns (the state lives in
`payload`).

**Config:** `relationship.bids.effects`; `relationship.idiolect` (`min_closeness`,
`min_similarity`, `max_items`); prompt versions extract v7 and reply v14.

**Deleted:** `prompts/extract/v6.md`, `prompts/reply/v13.md`.

## 4. Tests

**Unit:** bid enum normalisation; the no-user-turn, new-session and crisis guards; the three
effects, diminishing returns on gains only, and the ended-relationship skip; idiolect field
fallback; established only on a cross-exchange duplicate, never on a same-exchange repeat; the
slot's gate (band, user-started exception, no relationship), similarity floor, stale and
sensitive exclusions, crisis empty; idiolect kept out of ordinary retrieval but kept as a
reconcile neighbour.

**Exit** `tests/exit/phase-10c.test.ts` (scripted extraction, reply faked, guard off):
1. Toward, away and against move warmth and trust as configured.
2. A return in a new session records no bid.
3. A joke seen once is not offered; called back in a later exchange, it is.
4. A new user gets only the idiolect they started; a close friend gets hers too.
5. A crisis exchange records no bid and offers no idiolect.
6. Leak canary and side channel: user A's idiolect never reaches user B's prompts or any core
   loop input, and A's exchanges leave core state unchanged.

**Review run** `pnpm exit:idiolect`: an eval script over days with real extraction, logging each
exchange's bid read, idiolect births and establishments, and the slot.

## 5. Spec updates (v3)

§6.1 kind `idiolect` and its payload; §10.3 the "Your things together" slot and reply v14; §10.4
extraction v7 (`bid_response`, idiolect fields); §11.3 bids and idiolect **Built 10c**; §17.1
inspector; §20 the 10c row. `DECISIONS.md`: bids stack with the warmth signal; established by a
cross-exchange duplicate; idiolect state in `payload`, not columns.
