# Phase 10d: stages, commitment, the milestone trigger

Design for the last slice of Phase 10 (relationship psychology, v3 §11.3). Agreed with Ethan
2026-10-12. Everything here is user-scoped; nothing reads or writes core (V2–V6). Every number is
a first guess in config (test phase).

## Goal

Make where a relationship *is* shape how she behaves, in both directions, and let history matter:

- **Stages (Knapp):** all ten named stages. A sticky *peak* stage records how far they have come
  together; a *coming-apart* stage overlays it while a bad patch or an absence holds. The stage
  replaces the separate closeness gates for depth and idiolect, and sets a new posture line
  (teasing, boundaries, guarding) in "You and them".
- **Commitment (Rusbult):** satisfaction + investment, daily. It softens the impact of what the
  user does, speeds recovery, and gates bonding.
- **Milestone trigger:** a new big-event kind that runs the user loops the first time something
  happens. An open list of small named detectors.

Out of scope: B84 (tracked white lies) is its own slice. Rusbult's *alternatives* term is dropped
(comparing users breaks V7/V8; her own life already competes through availability). Attachment
stays PROPOSED for later.

## 1. Stages

### Model

Two stored fields on `relationship`:

- `peak_stage`: the highest coming-together stage reached. Only rises. It is the relationship's
  history: once close, the way back is shorter.
- `apart_stage`: null, or the coming-apart stage that holds now. Can only be set once `peak_stage`
  is at least `intensifying`; before that, a bad patch is between near-strangers and hurt and
  tension handle it alone.

The **current stage** is `apart_stage ?? peak_stage`, except `status = ended_by_user`, which is
`terminating`. Both fields are evaluated in code (`stages.ts`, pure) at the end of every
relationship transition: the cold path's exchange and the daily tick. The hot path reads the
stored values only, so it stays read-only and the stage never flickers inside one reply.

### Coming together (peak)

| Stage | Reached when |
|---|---|
| `initiating` | the relationship row exists (default) |
| `experimenting` | `hours_together` ≥ `stages.experimenting_hours` (0.5) |
| `intensifying` | closeness ≥ `stages.intensifying_closeness` (0.4) |
| `integrating` | closeness ≥ `stages.integrating_closeness` (0.65), trust ≥ `stages.integrating_trust` (0.5), and at least one established idiolect item |
| `bonding` | peak is `integrating` and the commitment param's **baseline** (its slow daily average, so "sustained") ≥ `stages.bonding_commitment` (0.7) |

Stages are climbed in order: one evaluation climbs through every stage it qualifies for, so a
jump in closeness still passes through each (and fires each milestone). The hours ceiling (10a) already stops closeness reaching
0.4 without real time together, so no separate hours gate is needed above `experimenting`.

### Coming apart (overlay)

Evaluated most severe first; the first that holds wins. Each has an enter threshold and a lower
clear threshold (hysteresis, like the make-up's `make_up_clear_threshold`), so it doesn't flip
back and forth.

| Stage | Enters when | Clears when |
|---|---|---|
| `avoiding` | absent past the grace multiple (the existing absence rule) | any exchange with a user turn |
| `stagnating` | warmth < `stagnating.warmth` (0.3) and `user_disclosure` < `stagnating.disclosure` (0.15) | warmth ≥ `stagnating.clear_warmth` |
| `circumscribing` | hurt ≥ `circumscribing.hurt` (0.5) or tension ≥ `circumscribing.tension` (0.5) | both below their `clear_*` |
| `differentiating` | tension ≥ `differentiating.tension` (0.3) or trust < `differentiating.trust` (0.35) | tension and trust past their `clear_*` |

Hurt and tension fade by half-life, so a value above threshold already means unrepaired and
recent. Bids turned away or against act through warmth and trust (10c), so they need no separate
count. `avoiding` is set only by the daily tick and cleared by the cold path; on return, the other
conditions decide whether a soured friend is still soured.

**Avoiding reads neutral.** Knapp has no stage for drifting apart amicably; `avoiding` is the
nearest name, but her posture on return is warm (callbacks allowed, the rekindle boost on). Absence
can still hurt her through the existing `hurt` path.

### What the stage gates

Per-stage config, `relationship.stages.gates.<stage>`:

| Stage | Depth `open` | Idiolect reuse | Posture line |
|---|---|---|---|
| initiating | 1 | theirs | polite, no teasing |
| experimenting | 1 | theirs | light |
| intensifying | 2 | all | playful |
| integrating | 3 | all | familiar, jabs ok |
| bonding | 3 | all | full range |
| differentiating | peak − 1 | all | teasing edged; more "me" than "we" |
| circumscribing | 1 | none | guarded; names what's not okay |
| stagnating | 1 | none | short, guarded |
| avoiding | peak − 1 | all | warm, "look who's back" |
| terminating | 1 | theirs | she has let go |

Together stages give an absolute `open`; apart stages give `drop` from the peak's `open` (min 1).

- **Depth:** `depthFor` takes the stage's `open` in place of the two closeness bands.
  Reciprocity (drop a tier) and chemistry (peek one further) stay as they are. **Deleted:**
  `relationship.depth.bands` and its refine.
- **Idiolect:** `selectIdiolect` takes the stage's reuse mode (`none`, `theirs`, `all`) in place
  of a closeness test. **Deleted:** `relationship.idiolect.min_closeness`.
- **Availability** is unchanged: it stays a sliding scale on closeness, where a step would be
  worse.
- **Posture:** a new "Where you are with them" line right after "You and them" (before "How open
  you feel"), one phrase per stage from `prompts/relationship/stage/v1.md`. Skipped in a crisis and
  before the relationship row exists. The reply prompt goes to `v15` with one line under "Your own
  state" on following it.

### Rekindle

While the current stage is the peak (no apart stage) and closeness is below the peak stage's
closeness threshold, closeness gains (intimacy moment and deep session) are multiplied by
`1 + stages.rekindle.base + stages.rekindle.commitment × commitment` (1 and 1: 2× to 3×). The
hours ceiling still applies, and since hours never fall, a former friend's ceiling is already
high.

## 2. Commitment

### What it is

How much she wants this relationship to last. Not closeness (how near she feels now): it moves
slowly and holds through low days.

### Computed

A new homeostatic param `commitment` (no migration for the table; the migration adds the row for existing users). Set once a day on the daily tick, cause `commitment`, with
`detail: { satisfaction, investment }`:

- **Satisfaction** (0–1): `clamp(Σ w × input)` over warmth, trust, `affect_valence` (all 0–1),
  minus hurt and tension, with weights in `relationship.commitment.satisfaction`. Read from
  the day's values, which already fade and smooth.
- **Investment** (0–1, only grows in practice): the mean of saturating terms
  `x / (x + half)` over hours together, the depth-weighted ledger count, established idiolect
  count, and relationship episode count, each with its own `half` in
  `relationship.commitment.investment`.
- `commitment = w_s × satisfaction + w_i × investment` (0.5 / 0.5).

The param's baseline (its slow daily average) is the sustained commitment that bonding reads.
`commitment` is left out of the relationship summary's param lines and out of the big-event
param watch.

### What it changes

- **Softens impact** (Ethan: closer to Rusbult's accommodation, reviewed in runs). Every negative
  move from the user's behaviour is multiplied by `1 − commitment.soften × commitment` (0.3): hurt
  from a signal and from absence, tension gains, warmth and trust drops from signals, and bid
  losses. The **trust scar** tests the unsoftened amount, and the coming-apart thresholds are
  unchanged, so a big hurt still scars and a sustained bad patch still narrows things.
- **Absence drift** on closeness × `1 − commitment.absence_shield × commitment` (0.5).
- **Repair:** the repairing gain factor becomes
  `repair_gain_factor + (1 − repair_gain_factor) × commitment.repair_speed × commitment` (0.5).
- **Rekindle** strength (above) and **bonding** (§1).

`DECISIONS.md`: alternatives dropped; softening chosen over the thesis's no-forgiveness default,
to be checked in review runs.

## 3. Milestone trigger

New `Trigger` kind `{ kind: "milestone"; name: string }`. A milestone fires once per user, ever:
the names reached are stored on `relationship.milestones` (text array), and a detector only emits
names not yet in it. Milestones ride in the run of the exchange or tick that reached them, so the
existing per-run `source_ref`, transaction and daily cap all apply unchanged.

Detectors are a list of `{ name, reached(snapshot) }` in `milestones.ts`; adding one is one entry
and one test (the list stays OPEN, §21 #1). The snapshot is read inside the transaction.

| Name | Reached when |
|---|---|
| `stage:experimenting` … `stage:bonding` | `peak_stage` first reaches it |
| `first_conflict` | `apart_stage` first set to anything but `avoiding` (absence is no conflict), or `make_up_state` first leaves `none` |
| `first_inside_joke` | at least one established idiolect item |
| `first_depth:2`, `first_depth:3` | her first `open` ledger row at that depth |
| `first_their_depth` | an exchange's `user_disclosure` reading ≥ `user_mind.triggers.milestone.their_depth` (0.7) |

Rules match the other triggers: none in a crisis, none for a reach-out alone, none after the user
has ended it. The user loops see the milestone names in the run's triggers, like any other kind;
their prompts are unchanged.

## Data

- `relationship`: `peak_stage` (enum, default `initiating`), `apart_stage` (enum, nullable),
  `milestones` (text[], nullable). One migration, no SQL backfill. A new relationship row starts
  with `milestones = {}`. Null means never staged (rows from before 10d, and eval seeds): readers
  derive the peak from the current params, and the first evaluation records every milestone
  already reached without firing any, so old users don't get a burst of "firsts".
- `relationship_param`: `commitment` rows for existing users (in the migration).
- `relationship_event`: causes `stage` (detail `{ peak | apart, from, to }`) and `commitment`.

## Inspector

Relationship tab: current, peak and apart stage; commitment with satisfaction and investment;
milestones reached. Stage and commitment events show in the event list.

## Testing

Exit test (`rel-stages`, deterministic, reply model faked, guard off, leak canary and side-channel
test included), over scripted signals:

1. A new user climbs initiating → experimenting → intensifying → integrating as hours, closeness,
   trust and an established inside joke arrive; each step fires its milestone once.
2. Bonding needs sustained commitment: one high day doesn't reach it; enough days do.
3. A run of tension enters differentiating, more hurt enters circumscribing; depth `open` and
   idiolect reuse narrow; make-up clears it back to the peak, with hysteresis.
4. Absence past grace sets avoiding; the next exchange clears it; closeness regains faster below
   peak (rekindle), more so with high commitment.
5. Commitment: the same hurt lands softer at high commitment, the scar still fires on a large hurt,
   absence drift and repair change as specified.
6. Milestones fire once each, never in a crisis or after the user ended it, and a backfilled user
   fires none on their next exchange.

Unit tests for `stages.ts`, the commitment formula, and each milestone detector. Review run
`pnpm exit:stages` with real extraction logs stages, commitment and milestones over a scripted
arc (quality is reviewed by hand, not asserted).

## Spec updates (v3)

§11.3: mark Stages and Commitment built, add a "Built 10d" block. §9.4: the milestone trigger.
§10.3: the "Where you are with them" slot and reply v15. §20: Phase 10 done. §25: B84 retargeted
to its own slice. Config keys and the new prompt listed where v3 lists them.
