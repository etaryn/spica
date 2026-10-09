# Phase 10a: How closeness grows — design

Date: 2026-10-10. Status: approved in conversation, awaiting spec review.

Phase 10 (relationship psychology, v3 §11.3) is built in slices:

| Slice | Builds |
|---|---|
| **10a (this doc)** | Intimacy loop, closeness by time together, her openness at reply time, B62 (session afterglow, deep session) |
| 10b | Depth tiers in her self, disclosure ledger and reciprocity, common ground, inspector ledger |
| 10c | Bids, idiolect |
| 10d | Stages, commitment, first-time milestone trigger, full Phase 10 exit |

Attachment stays out of Phase 10: the user side waits on §21 #8 (onboarding).

## Intent

Closeness today rises with every warm exchange, so it tracks message volume. After 10a it grows
the way a friendship does: someone opens up and the other meets it (Reis & Shaver), and how close
two people *can* be is bounded by the time they've spent together (Hall). She is no longer
assumed to be always open and attentive: how much she discloses and how well she responds is her
own decision, made in code from her mind and from how this person has treated her, and it steers
the reply. A long deep conversation counts for more than a string of short warm ones (B62).

Test phase: functionality over accuracy; every weight is a first guess, tuned in review runs.

## Decisions taken with Ethan (2026-10-10)

- **Phase order:** Phase 10 next (settles §21 #9 for this step; `DECISIONS.md` entry). 10a first.
- **Time sets a ceiling, intimacy fills it.** Hours together cap closeness; only intimacy moments
  raise it.
- **Hours = summed session spans**, with a small per-session minimum.
- **Hall's numbers as they are** (50 / 90 / 200 hours) in the real config; tests and review runs
  override them with short hours and a fast clock so one run crosses all three levels.
- **The user's side is read; her side is decided.** Extraction reads `user_disclosure` and
  `user_responsiveness` from the user's messages. Her `her_disclosure` and `her_responsiveness`
  are computed in code before each reply and steer it; extraction never reads her replies.
- **Her openness is computed in code on the hot path** and turned into a phrase; no extra call.
- **B62 on the cold path, as a running session average**, so she feels it during the
  conversation.

## 1. Measurement

### The user's side (cold path)

Extraction v6 (`prompts/extract/v6.md`, replaces v5; same single call) adds an `intimacy` block
next to `relationship`:

| Field | Meaning | Null when |
|---|---|---|
| `user_disclosure` (0–1) | How personal or vulnerable what the user shared about themselves was | never (0 = small talk) |
| `user_responsiveness` (0–1) | How well the user met what she shared (understanding, validation, care) | she shared nothing of her own |

Parsed like the relationship signals: a block that doesn't validate becomes null and never fails
the memory write. Lives in `src/mind/state/user/relationship/signals.ts` next to
`normalizeSignals`.

Kept as two homeostatic params, `user_disclosure` (initial 0.2) and `user_responsiveness`
(initial 0.5), in `relationship_param`. After each exchange each moves toward the new reading by
`relationship.intimacy.ema_alpha` (0.3); a null reading leaves it alone. Each change writes a
`relationship_event` (cause `signal`, `detail.reading`), which is the per-exchange record.

### Her side

`her_disclosure` and `her_responsiveness` are not params and are never extracted. They are
computed at reply time (§3) and stored on the reply row.

### Crisis

A crisis exchange records no reading (as with signals today).

## 2. How closeness grows

All in `transitions.ts` / `update.ts` on the cold path's relationship step.

**Deleted:** `relationship.gains.closeness_per_warm_exchange` and the closeness branch of
`applyWarmthAndTrust`. Warmth and trust signals are unchanged. Closeness now moves only by the
intimacy moment, the deep session, absence drift, ending and repair.

### Time together and the ceiling

`relationship.hours_together` accumulates on each scored exchange:

- the exchange's session equals `relationship.session.id`: add the time from
  `session.last_at` to the exchange's last turn;
- a new session: add `max(relationship.hours.session_min_minutes, last turn − first turn of the
  exchange)` and reset the running session state.

All turns count (hers included). `session.last_at` becomes the exchange's last turn.

The ceiling interpolates linearly between config points and is flat after the last:

| Hours | 0 | `hours.casual` 50 | `hours.friend` 90 | `hours.close` 200 |
|---|---|---|---|---|
| Ceiling | `ceiling.start` 0.3 | `ceiling.casual` 0.5 | `ceiling.friend` 0.7 | `ceiling.close` 0.9 |

The ceiling only caps gains; it never lowers closeness. Pure function `closenessCeiling(hours,
settings)` in a new `src/mind/state/user/relationship/closeness.ts`.

### The intimacy moment

Per exchange, from this exchange's readings and the openness stored on its reply rows (the
highest of the exchange's replies; null counts as 0):

```
moment = max(user_disclosure × her_responsiveness,   // they opened up, she met it
             her_disclosure × user_responsiveness)   // she opened up, they met it
```

If `moment ≥ signal_deadzone` and the relationship isn't ended:
`closeness = min(ceiling, nudge(closeness, intimacy.closeness_gain × moment × diminishingReturns(closeness)))`,
times `repair_gain_factor` while repairing. `intimacy.closeness_gain` starts at 0.06. The event's
`detail` carries `moment` and `ceiling`.

### Deep session (B62)

`relationship.session` keeps `moment_sum` and `moment_n` for the current session. Session depth
is `session hours × (moment_sum / moment_n)`, where session hours is the running span of this
session. The first time it reaches `deep_session.threshold` (0.3, i.e. an hour at moment 0.3)
the session fires once: `deep_session.gains.closeness` (0.04, capped by the ceiling),
`.trust` (0.03), `.warmth` (0.03), each through `nudge`, cause `deep_session`. `session.deep_fired`
stops a repeat.

### Afterglow (B62)

`applyAffect` no longer adds to afterglow per exchange. `relationship.session` keeps `tone_sum`
and `tone_n`; when the session's mean tone is positive, afterglow becomes
`max(faded afterglow, affect.afterglow_gain × mean tone)`. Ten short warm exchanges equal one warm
session, and back-to-back sessions don't stack. `affect_valence` is unchanged.

### Crisis

A crisis exchange adds no hours, no moment, no session sums and fires no deep session.

## 3. Her openness at reply time

Pure function `opennessFor(inputs, settings)` in a new
`src/mind/state/user/relationship/openness.ts`, called by `compose` for every normal reply and
reach-out from data compose already loads (relationship params, core state, the current day-plan
block's busy level).

Each value is `clamp(base + Σ weight × (input − centre), 0, 1)`. Starting values under
`relationship.openness`:

| Input (centre) | her_disclosure | her_responsiveness |
|---|---|---|
| base | 0.35 | 0.7 |
| closeness (0.5) | +0.4 | +0.1 |
| trust (0.5) | +0.2 | +0.1 |
| hurt (0) | −0.5 | −0.4 |
| tension (0) | −0.3 | −0.3 |
| core mood valence (0) | +0.15 | +0.05 |
| current emotion valence (0; 0 when none) | +0.1 | +0.05 |
| core energy (0.5) | +0.15 | +0.2 |
| busy level (0) | −0.2 | −0.2 |
| `affect_valence` (0.5) | +0.15 | +0.1 |
| `afterglow` (0) | +0.1 | +0.05 |
| last exchange's `user_disclosure` reading (0.3) | +0.3 | +0.2 |
| `user_responsiveness` level (0.5) | +0.2 | 0 |

"Last exchange's reading" is the newest `user_disclosure` event's `detail.reading`, or the param
value when none.

**Into the reply.** Each value maps to a band (low below `openness.bands.low` 0.35, high at or
above `openness.bands.high` 0.65, else mid). The pair picks one of nine phrases from
`prompts/relationship/openness/v1.md` (loaded with the existing phrase parser), placed in a new
**"How open you feel"** slot right after "You and them". Reply prompt **v12** adds one line on
using the slot; v11 is deleted. No numbers reach the prompt.

**Recorded.** `Composed` gains `openness: { disclosure: number; responsiveness: number }`; the
caller stores it on the reply's `session_log.openness`, as it stores `snapshot_version`. The cold
path reads it there for the moment; nothing is recomputed.

**Crisis.** Fixed `{ disclosure: 0, responsiveness: 1 }` and the crisis phrase ("just be there
for them"); no input feeds in.

**Scope.** Inputs are core state, read-only (V2: core → user), and this user's own params.
Nothing is written to core.

## 4. Storage, deletions, inspector

**Migration 0027:**
- `relationship.hours_together real not null default 0`
- `relationship.session jsonb` (nullable): `{ id, started_at, last_at, tone_sum, tone_n,
  moment_sum, moment_n, deep_fired }`
- `session_log.openness jsonb` (nullable; reply rows only)
- seeds `user_disclosure` and `user_responsiveness` param rows for existing users (as 0013 did)

Existing dev users start at 0 hours, no backfill (`DECISIONS.md` entry).

**Deleted in this slice:** `gains.closeness_per_warm_exchange` and its branch; the per-exchange
afterglow increment; `prompts/extract/v5.md`; `prompts/reply/v11.md`; tests asserting the old
closeness and afterglow behaviour are rewritten, not kept beside the new ones.

**Inspector (Relationship tab):** hours together, current ceiling, the two user params (if the
param list doesn't already show them generically), and the last reply's openness.

**Config:** every number above under `relationship.intimacy`, `relationship.hours`,
`relationship.ceiling`, `relationship.deep_session`, `relationship.openness`, validated in
`config.ts`.

## 5. Tests

**Unit:** ceiling interpolation and flat tail; moment both directions, nulls as 0; closeness
stops at the ceiling and the ceiling never lowers it; hours accounting (same session, new
session, minimum); deep session fires once per session; ten warm exchanges give the same
afterglow as one; each openness input moves its value in the table's direction; crisis openness
fixed; band → phrase selection; extraction v6 parse (bad block → null).

**Exit** `tests/exit/phase-10a.test.ts`: deterministic, fake extraction and reply, guard off,
short `hours` (e.g. 0.5 / 1 / 2) and a fast clock:
1. A long run of warm small talk (moment ≈ 0) leaves closeness unchanged.
2. Disclosure exchanges raise closeness up to the ceiling, then stop.
3. As hours pass casual, friend and close, the ceiling rises and closeness reaches each level.
4. A deep session fires its boost once.
5. Session-averaged afterglow doesn't pile up.
6. A hurt, tired state puts the guarded phrase in the assembled prompt; a warm, rested state the
   open one.
7. A crisis exchange credits nothing and gets the fixed openness.
8. The leak canary and side-channel tests pass, including over `openness`.

**Review run (quality by hand):** eval scenario `relationship-intimacy` with real extraction v6
over scripted conversations; logs each exchange's readings, her openness, and the closeness and
ceiling path.

## 6. Spec updates (v3)

§6.1 new fields and columns; §10.3 the new slot; §11.3 intimacy loop and closeness by time marked
**Built 10a**, plus her openness; §20 the 10a row; §25 B62 done; every new config key and prompt
listed.
