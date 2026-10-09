# Phase 10a: How closeness grows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Closeness grows from intimacy moments (one side opens up, the other meets it) up to a ceiling set by hours together; her own openness is decided in code before each reply and steers it; afterglow and a deep-session boost are per session (B62).

**Architecture:** Pure maths in `src/mind/state/user/relationship/` (`closeness.ts`, `openness.ts`, `transitions.ts`, `affect.ts`), run by the existing cold-path relationship step (`update.ts`). Extraction v6 reads the user's side in the same single call. The hot path (`compose.ts`) computes her openness, renders one phrase into a new "How open you feel" slot, and returns the numbers so the three reply insert sites store them on `session_log.openness`; the cold path reads them back for the intimacy moment.

**Tech Stack:** TypeScript, Drizzle + Postgres 16, Zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-10-phase-10a-closeness-design.md` (read it first), and v3 `spica-design-spec-v3.md` §11.

## Global Constraints

- `src/mind` is framework-free: no Next imports, no `Date.now()`, no `process.env`; time comes from `deps.clock`.
- Every numeric constant goes in `config/default.json`, validated in `src/mind/platform/config.ts`.
- Every prompt is a versioned file under `prompts/`; delete prompt versions nothing configures (v5 extract, v11 reply).
- Comments say why, never cite spec sections, phases or review items.
- Every file starts with a short plain-English header.
- Prettier at 100 columns; run `pnpm format` before each commit.
- Replace, don't shim: `gains.closeness_per_warm_exchange` and the per-exchange afterglow increase are deleted, with their tests rewritten.
- Crisis exchanges: no hours, no readings, no moment, no deep session; openness fixed at `{ disclosure: 0, responsiveness: 1 }`.
- Scope: openness reads core state only (read-only); nothing in this slice writes core.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- DB tests need `pnpm db:up` running.

## Review Focus

- A user's first-ever reply (no relationship row yet) must compose normally: `loadOpenness` returns null and the slot is skipped (Task 6 test).
- An exchange whose turns straddle two sessions (a buffered reply after an idle gap) must not count negative or double hours: the span uses the last turn's session and clamps at 0 (Task 2 test).
- A reach-out answered later: the exchange's companion turn is the reach-out row, which carries openness too; the moment must use it (Task 5 test).
- Closeness already above the ceiling (seeded or old dev data) must never be pulled down by an intimacy moment (Task 3 test).
- A malformed `intimacy` block from the model must not fail the memory write (Task 4 test).

---

### Task 1: Config, types, schema and migration

**Files:**
- Modify: `config/default.json` (relationship section; `prompts`)
- Modify: `src/mind/platform/config.ts:194-266` (relationship schema), prompts schema (~line 510)
- Modify: `src/mind/state/user/relationship/types.ts`
- Modify: `src/db/schema.ts` (`relationshipCause`, `relationship`, `session_log`)
- Modify: `src/db/repos/user/relationship.ts` (`toRelationshipState`)
- Create: `src/db/migrations/0027_*.sql` (generated, then edited)
- Test: `tests/db/relationship-repo.test.ts`, `tests/db/inspector.test.ts:144-154`

**Interfaces:**
- Produces (types.ts):
  - `PARAM_NAMES` gains `"user_disclosure"`, `"user_responsiveness"` (after `"afterglow"`).
  - `type Intimacy = { user_disclosure: number; user_responsiveness: number | null }`
  - `type Openness = { disclosure: number; responsiveness: number }`
  - `type SessionState = { id: string; started_at: string; last_at: string; tone_sum: number; tone_n: number; moment_sum: number; moment_n: number; deep_fired: boolean }` (ISO strings: it lives in jsonb)
  - `RelationshipState` gains `hours_together: number; session: SessionState | null`
  - `RelationshipCause` gains `"deep_session"`
- Produces (config): `relationship.intimacy`, `.hours`, `.ceiling`, `.deep_session`, `.openness`; `prompts.relationship_openness`. `gains.closeness_per_warm_exchange` stays until Task 3 deletes it.

- [ ] **Step 1: Add config values.** In `config/default.json` `relationship`:

```json
"initial": { ..., "user_disclosure": 0.2, "user_responsiveness": 0.5 },
"initial_variance": { ..., "user_disclosure": 0.01, "user_responsiveness": 0.01 },
"intimacy": { "ema_alpha": 0.3, "closeness_gain": 0.06 },
"hours": { "casual": 50, "friend": 90, "close": 200, "session_min_minutes": 5 },
"ceiling": { "start": 0.3, "casual": 0.5, "friend": 0.7, "close": 0.9 },
"deep_session": { "threshold": 0.3, "gains": { "closeness": 0.04, "trust": 0.03, "warmth": 0.03 } },
"openness": {
  "centres": {
    "closeness": 0.5, "trust": 0.5, "hurt": 0, "tension": 0, "mood_valence": 0,
    "emotion_valence": 0, "energy": 0.5, "busy": 0, "affect_valence": 0.5, "afterglow": 0,
    "last_user_disclosure": 0.3, "user_responsiveness": 0.5
  },
  "disclosure": {
    "base": 0.35,
    "weights": {
      "closeness": 0.4, "trust": 0.2, "hurt": -0.5, "tension": -0.3, "mood_valence": 0.15,
      "emotion_valence": 0.1, "energy": 0.15, "busy": -0.2, "affect_valence": 0.15,
      "afterglow": 0.1, "last_user_disclosure": 0.3, "user_responsiveness": 0.2
    }
  },
  "responsiveness": {
    "base": 0.7,
    "weights": {
      "closeness": 0.1, "trust": 0.1, "hurt": -0.4, "tension": -0.3, "mood_valence": 0.05,
      "emotion_valence": 0.05, "energy": 0.2, "busy": -0.2, "affect_valence": 0.1,
      "afterglow": 0.05, "last_user_disclosure": 0.2, "user_responsiveness": 0
    }
  },
  "bands": { "low": 0.35, "high": 0.65 }
}
```

and in `prompts`: `"relationship_openness": "v1"`.

- [ ] **Step 2: Validate it.** In `config.ts`, add the two names to `perParam`, then inside the `relationship` object:

```ts
const OPENNESS_INPUTS = [
  "closeness", "trust", "hurt", "tension", "mood_valence", "emotion_valence", "energy",
  "busy", "affect_valence", "afterglow", "last_user_disclosure", "user_responsiveness",
] as const;
const opennessWeights = z.object(
  Object.fromEntries(OPENNESS_INPUTS.map((k) => [k, z.number()])) as Record<
    (typeof OPENNESS_INPUTS)[number],
    z.ZodNumber
  >,
);
const opennessSide = z.object({ base: unit, weights: opennessWeights });
```

(export `OPENNESS_INPUTS` from `config.ts` so `openness.ts` can share it), and fields:

```ts
intimacy: z.object({ ema_alpha: unit, closeness_gain: unit }),
hours: z.object({
  casual: z.number().positive(),
  friend: z.number().positive(),
  close: z.number().positive(),
  session_min_minutes: nonNegative,
}),
ceiling: z.object({ start: unit, casual: unit, friend: unit, close: unit }),
deep_session: z.object({
  threshold: z.number().positive(),
  gains: z.object({ closeness: unit, trust: unit, warmth: unit }),
}),
openness: z.object({
  centres: opennessWeights,
  disclosure: opennessSide,
  responsiveness: opennessSide,
  bands: z.object({ low: unit, high: unit }),
}),
```

with refines appended to the existing `.refine` chain:

```ts
.refine(
  (r) => r.hours.casual < r.hours.friend && r.hours.friend < r.hours.close,
  "relationship.hours must rise casual < friend < close",
)
.refine(
  (r) =>
    r.ceiling.start <= r.ceiling.casual &&
    r.ceiling.casual <= r.ceiling.friend &&
    r.ceiling.friend <= r.ceiling.close,
  "relationship.ceiling must not fall",
)
.refine((r) => r.openness.bands.low < r.openness.bands.high, "relationship.openness.bands: low < high")
```

Add `relationship_openness: promptVersion` to the prompts schema.

- [ ] **Step 3: Types.** In `types.ts`, add the two param names, `Intimacy`, `Openness`, `SessionState`, the two `RelationshipState` fields and the `"deep_session"` cause exactly as in Interfaces. Update the header comment to mention the user's disclosure and responsiveness.

- [ ] **Step 4: Schema.** In `src/db/schema.ts`: add `"deep_session"` to `relationshipCause`; in `relationship` add

```ts
hours_together: real("hours_together").notNull().default(0),
// This session's running sums: afterglow and the deep-session boost are per conversation.
session: jsonb("session").$type<SessionState>(),
```

and in `session_log` add

```ts
// How open she was steered to be in this reply; the cold path credits intimacy from it.
openness: jsonb("openness").$type<Openness>(),
```

(`import type { Openness, SessionState } from "@/mind/state/user/relationship/types";`).

- [ ] **Step 5: Repo mapping.** In `toRelationshipState` add `hours_together: r.hours_together, session: r.session`. `saveRelationship` already spreads `a.state`, so both persist with no further change.

- [ ] **Step 6: Generate the migration.** Run `pnpm db:generate --name intimacy`. Append to the generated SQL (as 0013 did for the affect params):

```sql
--> statement-breakpoint
INSERT INTO relationship_param (user_id, name, value, baseline, variance, updated_at)
SELECT r.user_id, p.name, p.value, p.value, 0.01, now()
FROM relationship r
CROSS JOIN (VALUES ('user_disclosure', 0.2::real), ('user_responsiveness', 0.5::real)) AS p(name, value)
ON CONFLICT DO NOTHING;
```

Check the file adds `deep_session` to the enum, the two `relationship` columns and `session_log.openness`.

- [ ] **Step 7: Fix the tests that list params.** In `tests/db/inspector.test.ts:144-154` append `"user_disclosure", "user_responsiveness"` to the expected list. In `tests/db/relationship-repo.test.ts` add:

```ts
test("hours and session round-trip through save", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const now = new Date("2026-01-05T10:00:00Z");
  await rel.ensureRelationship(db, u, now, cfg);
  const row = await rel.getRelationshipRow(db, u);
  const state = rel.toRelationshipState(row!);
  expect(state.hours_together).toBe(0);
  expect(state.session).toBeNull();
  const session = {
    id: "s1", started_at: now.toISOString(), last_at: now.toISOString(),
    tone_sum: 0.5, tone_n: 1, moment_sum: 0.2, moment_n: 1, deep_fired: false,
  };
  await rel.saveRelationship(db, u, {
    state: { ...state, hours_together: 1.5, session },
    params: await rel.getParams(db, u),
  });
  const again = rel.toRelationshipState((await rel.getRelationshipRow(db, u))!);
  expect(again.hours_together).toBe(1.5);
  expect(again.session).toEqual(session);
  expect((await rel.getParams(db, u)).user_disclosure.value).toBe(cfg.initial.user_disclosure);
});
```

(use whatever `cfg`/`rel` names the file already uses at its top).

- [ ] **Step 8: Run.** `pnpm typecheck` (fix every `RelationshipState` literal the compiler flags, e.g. `fresh()` in `tests/mind/state/user/relationship/transitions.test.ts` gains `hours_together: 0, session: null`, and `tests/evals/relationship-check.test.ts` param maps gain the two params) then `pnpm test tests/db/relationship-repo.test.ts tests/db/inspector.test.ts tests/mind/platform`. Expected: PASS.

- [ ] **Step 9: Commit.** `pnpm format`, then
`git add -A && git commit -m "feat(relationship): intimacy config, hours and session state, openness column"`

---

### Task 2: Closeness maths

**Files:**
- Create: `src/mind/state/user/relationship/closeness.ts`
- Test: `tests/mind/state/user/relationship/closeness.test.ts`

**Interfaces:**
- Consumes: `Intimacy`, `Openness`, `SessionState`, `RelationshipConfig` (Task 1).
- Produces:
  - `closenessCeiling(hours: number, settings: RelationshipConfig): number`
  - `intimacyMoment(user: Intimacy | null, her: Openness | null): number`
  - `type ExchangeSpan = { sessionId: string; firstAt: Date; lastAt: Date }`
  - `advanceSession(session: SessionState | null, hours: number, span: ExchangeSpan, settings: RelationshipConfig): { session: SessionState; hours: number }`
  - `sessionHours(session: SessionState, settings: RelationshipConfig): number`

- [ ] **Step 1: Write the failing tests.**

```ts
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  advanceSession,
  closenessCeiling,
  intimacyMoment,
  sessionHours,
} from "@/mind/state/user/relationship/closeness";

const cfg = loadConfig().relationship;
const t0 = new Date("2026-01-05T10:00:00Z");
const min = (n: number) => new Date(t0.getTime() + n * 60_000);

test("ceiling interpolates between the hour points and is flat after close", () => {
  expect(closenessCeiling(0, cfg)).toBeCloseTo(cfg.ceiling.start);
  expect(closenessCeiling(cfg.hours.casual, cfg)).toBeCloseTo(cfg.ceiling.casual);
  expect(closenessCeiling((cfg.hours.casual + cfg.hours.friend) / 2, cfg)).toBeCloseTo(
    (cfg.ceiling.casual + cfg.ceiling.friend) / 2,
  );
  expect(closenessCeiling(cfg.hours.close, cfg)).toBeCloseTo(cfg.ceiling.close);
  expect(closenessCeiling(cfg.hours.close * 10, cfg)).toBeCloseTo(cfg.ceiling.close);
});

test("moment: either direction, nulls count as 0", () => {
  const her = { disclosure: 0.8, responsiveness: 0.5 };
  expect(intimacyMoment({ user_disclosure: 0.9, user_responsiveness: null }, her)).toBeCloseTo(0.45);
  expect(intimacyMoment({ user_disclosure: 0, user_responsiveness: 1 }, her)).toBeCloseTo(0.8);
  expect(intimacyMoment(null, her)).toBe(0);
  expect(intimacyMoment({ user_disclosure: 1, user_responsiveness: 1 }, null)).toBe(0);
});

test("a new session adds its span with a minimum; the same session adds the time since last_at", () => {
  const first = advanceSession(null, 0, { sessionId: "a", firstAt: t0, lastAt: min(1) }, cfg);
  expect(first.hours).toBeCloseTo(cfg.hours.session_min_minutes / 60);
  expect(first.session).toMatchObject({ id: "a", tone_n: 0, moment_n: 0, deep_fired: false });

  const same = advanceSession(first.session, first.hours, { sessionId: "a", firstAt: min(10), lastAt: min(31) }, cfg);
  expect(same.hours).toBeCloseTo(first.hours + 30 / 60);
  expect(same.session.started_at).toBe(t0.toISOString());

  const next = advanceSession(same.session, same.hours, { sessionId: "b", firstAt: min(200), lastAt: min(260) }, cfg);
  expect(next.hours).toBeCloseTo(same.hours + 1);
  expect(next.session.id).toBe("b");
});

test("an exchange older than last_at never subtracts hours", () => {
  const s = advanceSession(null, 0, { sessionId: "a", firstAt: t0, lastAt: min(30) }, cfg);
  const back = advanceSession(s.session, s.hours, { sessionId: "a", firstAt: t0, lastAt: min(5) }, cfg);
  expect(back.hours).toBe(s.hours);
  expect(back.session.last_at).toBe(min(30).toISOString());
});

test("session hours run from its start, with the minimum", () => {
  const s = advanceSession(null, 0, { sessionId: "a", firstAt: t0, lastAt: min(90) }, cfg).session;
  expect(sessionHours(s, cfg)).toBeCloseTo(1.5);
});
```

- [ ] **Step 2: Run** `pnpm test tests/mind/state/user/relationship/closeness.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement.**

```ts
/**
 * How close she can be and what makes her closer: time together sets a ceiling, and a moment of
 * one side opening up while the other meets it fills up to it. Pure functions over the
 * relationship's running hours and this conversation's session.
 */
import { HOUR } from "@/mind/platform/time";
import type { Intimacy, Openness, RelationshipConfig, SessionState } from "./types";

const MINUTE = 60_000;

/** Linear between the hour points, flat after the last: closeness is earned over time. */
export function closenessCeiling(hours: number, settings: RelationshipConfig): number {
  const { hours: h, ceiling: c } = settings;
  const points: [number, number][] = [
    [0, c.start],
    [h.casual, c.casual],
    [h.friend, c.friend],
    [h.close, c.close],
  ];
  for (let i = 1; i < points.length; i++) {
    const [h1, c1] = points[i]!;
    if (hours > h1) continue;
    const [h0, c0] = points[i - 1]!;
    return c0 + ((c1 - c0) * (Math.max(0, hours) - h0)) / (h1 - h0);
  }
  return c.close;
}

/** They opened up and she met it, or she opened up and they met it. */
export function intimacyMoment(user: Intimacy | null, her: Openness | null): number {
  const theyShared = (user?.user_disclosure ?? 0) * (her?.responsiveness ?? 0);
  const sheShared = (her?.disclosure ?? 0) * (user?.user_responsiveness ?? 0);
  return Math.max(theyShared, sheShared);
}

export type ExchangeSpan = { sessionId: string; firstAt: Date; lastAt: Date };

/** Adds this exchange's time together; a new session starts fresh running sums. */
export function advanceSession(
  session: SessionState | null,
  hours: number,
  span: ExchangeSpan,
  settings: RelationshipConfig,
): { session: SessionState; hours: number } {
  if (session && session.id === span.sessionId) {
    const lastAt = new Date(session.last_at);
    if (span.lastAt <= lastAt) return { session, hours };
    return {
      session: { ...session, last_at: span.lastAt.toISOString() },
      hours: hours + (span.lastAt.getTime() - lastAt.getTime()) / HOUR,
    };
  }
  const spanMs = Math.max(
    settings.hours.session_min_minutes * MINUTE,
    span.lastAt.getTime() - span.firstAt.getTime(),
  );
  return {
    session: {
      id: span.sessionId,
      started_at: span.firstAt.toISOString(),
      last_at: span.lastAt.toISOString(),
      tone_sum: 0,
      tone_n: 0,
      moment_sum: 0,
      moment_n: 0,
      deep_fired: false,
    },
    hours: hours + spanMs / HOUR,
  };
}

export function sessionHours(session: SessionState, settings: RelationshipConfig): number {
  const span = new Date(session.last_at).getTime() - new Date(session.started_at).getTime();
  return Math.max(settings.hours.session_min_minutes * MINUTE, span) / HOUR;
}
```

- [ ] **Step 4: Run** the test file. Expected: PASS.

- [ ] **Step 5: Commit.** `pnpm format && git add -A && git commit -m "feat(relationship): closeness ceiling, intimacy moment and session time"`

---

### Task 3: Transitions — intimacy replaces warm-exchange closeness; session afterglow

**Files:**
- Modify: `src/mind/state/user/relationship/transitions.ts` (ExchangeInput, `relationshipAfterExchange`, `applyWarmthAndTrust`)
- Modify: `src/mind/state/user/relationship/affect.ts`
- Modify: `config/default.json`, `src/mind/platform/config.ts` (delete `closeness_per_warm_exchange`)
- Test: `tests/mind/state/user/relationship/transitions.test.ts`, `tests/mind/state/user/relationship/affect.test.ts`

**Interfaces:**
- Consumes: Task 2 functions.
- Produces:
  - `ExchangeInput` gains `span: ExchangeSpan | null; intimacy: Intimacy | null; herOpenness: Openness | null; tone: number | null`.
  - `applyAffect(params: Params, tone: number, sessionMeanTone: number | null, now: Date, settings: RelationshipConfig)` (same return shape).
  - `sessionMeanTone(session: SessionState | null): number | null` exported from `affect.ts`.

- [ ] **Step 1: Rewrite the failing tests.** In `transitions.test.ts`: extend `ex()`'s defaults with `span: null, intimacy: null, herOpenness: null, tone: null` and its `extra` type with those four fields. Replace the test at line 243 ("warmth: diminishing returns above baseline; warm exchange grows closeness") with:

```ts
test("warmth: diminishing returns above baseline; warmth alone no longer grows closeness", () => {
  const p = init();
  const r = relationshipAfterExchange(fresh(), p, ex({ warmth: 1 }), cfg);
  expect(r.params.warmth.value).toBeGreaterThan(p.warmth.value);
  expect(r.params.closeness.value).toBe(p.closeness.value);
  const high = init();
  high.warmth.value = 0.95;
  const r2 = relationshipAfterExchange(fresh(), high, ex({ warmth: 1 }), cfg);
  expect(r2.params.warmth.value - 0.95).toBeLessThan(0.01);
});
```

In the repair test near line 287, replace `ex({ warmth: 1 }, { now: h(4) })` with an intimacy exchange and the bound:

```ts
r = relationshipAfterExchange(
  r.state,
  r.params,
  ex(null, {
    now: h(4),
    intimacy: { user_disclosure: 1, user_responsiveness: null },
    herOpenness: { disclosure: 0, responsiveness: 1 },
  }),
  cfg,
);
const gain = r.params.closeness.value - before;
expect(gain).toBeGreaterThan(0);
expect(gain).toBeLessThan(cfg.intimacy.closeness_gain * cfg.repair_gain_factor + 1e-9);
```

Add new tests at the end:

```ts
const span = (id: string, from: number, to: number) => ({
  sessionId: id,
  firstAt: h(from),
  lastAt: h(to),
});
const opened = { user_disclosure: 1, user_responsiveness: null };
const listening = { disclosure: 0, responsiveness: 1 };

test("time accrues per session; a crisis adds none", () => {
  let r = relationshipAfterExchange(fresh(), init(), ex(null, { span: span("a", 0, 1) }), cfg);
  expect(r.state.hours_together).toBeCloseTo(1);
  r = relationshipAfterExchange(r.state, r.params, ex(null, { span: span("a", 1, 2), now: h(2) }), cfg);
  expect(r.state.hours_together).toBeCloseTo(2);
  const c = relationshipAfterExchange(r.state, r.params, ex(null, { span: span("a", 2, 5), now: h(5), crisis: true }), cfg);
  expect(c.state.hours_together).toBeCloseTo(2);
});

test("an intimacy moment raises closeness up to the ceiling, never past it, never down", () => {
  const p = init();
  const r = relationshipAfterExchange(
    fresh(),
    p,
    ex(null, { span: span("a", 0, 0.1), intimacy: opened, herOpenness: listening }),
    cfg,
  );
  expect(r.params.closeness.value).toBeGreaterThan(p.closeness.value);
  expect(r.events.some((e) => e.param === "closeness" && e.detail.moment === 1)).toBe(true);

  const capped = init();
  capped.closeness.value = cfg.ceiling.start;
  const atCeiling = relationshipAfterExchange(fresh(), capped, ex(null, { span: span("a", 0, 0.1), intimacy: opened, herOpenness: listening }), cfg);
  expect(atCeiling.params.closeness.value).toBe(cfg.ceiling.start);

  const above = init();
  above.closeness.value = 0.95;
  const stays = relationshipAfterExchange(fresh(), above, ex(null, { span: span("a", 0, 0.1), intimacy: opened, herOpenness: listening }), cfg);
  expect(stays.params.closeness.value).toBe(0.95);
});

test("small talk (moment below the dead zone) leaves closeness alone", () => {
  const p = init();
  const r = relationshipAfterExchange(
    fresh(),
    p,
    ex({ warmth: 1 }, { span: span("a", 0, 0.1), intimacy: { user_disclosure: 0.05, user_responsiveness: 0.05 }, herOpenness: { disclosure: 0.9, responsiveness: 0.9 } }),
    cfg,
  );
  expect(r.params.closeness.value).toBe(p.closeness.value);
});

test("readings move the user's params toward them; a null responsiveness leaves it", () => {
  const p = init();
  const r = relationshipAfterExchange(fresh(), p, ex(null, { intimacy: { user_disclosure: 1, user_responsiveness: null } }), cfg);
  expect(r.params.user_disclosure.value).toBeCloseTo(
    p.user_disclosure.value + cfg.intimacy.ema_alpha * (1 - p.user_disclosure.value),
  );
  expect(r.params.user_responsiveness.value).toBe(p.user_responsiveness.value);
  expect(r.events.find((e) => e.param === "user_disclosure")?.detail.reading).toBe(1);
});

test("a deep session boosts closeness, trust and warmth once", () => {
  let state = fresh();
  let params = init();
  let fired = 0;
  for (let i = 1; i <= 8; i++) {
    const r = relationshipAfterExchange(
      state,
      params,
      ex(null, { now: h(i * 0.25), span: span("a", (i - 1) * 0.25, i * 0.25), intimacy: opened, herOpenness: listening }),
      cfg,
    );
    fired += r.events.filter((e) => e.cause === "deep_session" && e.param === "trust").length;
    state = r.state;
    params = r.params;
  }
  expect(fired).toBe(1);
  expect(state.session?.deep_fired).toBe(true);
});

test("the session keeps the exchange tone for afterglow", () => {
  let r = relationshipAfterExchange(fresh(), init(), ex(null, { span: span("a", 0, 0.1), tone: 0.8 }), cfg);
  r = relationshipAfterExchange(r.state, r.params, ex(null, { span: span("a", 0.1, 0.2), tone: 0.4 }), cfg);
  expect(r.state.session).toMatchObject({ tone_n: 2 });
  expect(r.state.session!.tone_sum).toBeCloseTo(1.2);
});
```

In `affect.test.ts`, replace the first test (line 33) with:

```ts
test("afterglow follows the session's mean tone; ten warm exchanges equal one", () => {
  const once = applyAffect(init(), 0.8, 0.8, now, settings).params;
  let many = init();
  for (let i = 0; i < 10; i++) many = applyAffect(many, 0.8, 0.8, now, settings).params;
  expect(once.afterglow.value).toBeCloseTo(settings.affect.afterglow_gain * 0.8);
  expect(many.afterglow.value).toBeCloseTo(once.afterglow.value);
  const cold = applyAffect(init(), -0.8, -0.8, now, settings).params;
  expect(cold.affect_valence.value).toBeLessThan(init().affect_valence.value);
  expect(cold.afterglow.value).toBe(0);
});

test("a stronger earlier glow is kept, faded, not replaced by a weaker session", () => {
  const p = init();
  p.afterglow = { ...p.afterglow, value: 0.6, updated_at: now };
  const later = new Date(now.getTime() + settings.affect.afterglow_half_life_hours * 3_600_000);
  const next = applyAffect(p, 0.1, 0.1, later, settings).params;
  expect(next.afterglow.value).toBeCloseTo(0.3);
});
```

(match the helper names `init`, `now`, `settings` already at the top of `affect.test.ts`; adjust if they differ).

- [ ] **Step 2: Run** `pnpm test tests/mind/state/user/relationship/transitions.test.ts tests/mind/state/user/relationship/affect.test.ts`. Expected: FAIL (type errors / missing behaviour).

- [ ] **Step 3: Implement transitions.** In `transitions.ts`:
  - Import `advanceSession, closenessCeiling, intimacyMoment, sessionHours, type ExchangeSpan` from `./closeness` and `Intimacy, Openness` from `./types`.
  - Add the four `ExchangeInput` fields (doc each: `span` is the exchange's session and first/last turn times; `herOpenness` the highest openness among the exchange's replies).
  - Delete the closeness branch at the end of `applyWarmthAndTrust` (the `if (signals.warmth >= deadzone) { … closeness_per_warm_exchange … }` block).
  - New order in `relationshipAfterExchange` (update its doc comment):

```ts
  advanceMakeUp(draft, input.replies, settings);
  if (input.span) accountTime(draft, input.span, settings);
  if (input.signals) applySignals(draft, input, input.signals, settings);
  applyIntimacy(draft, input, settings);
  recordSessionTone(draft, input.tone);
  clearMakeUpOnceHealed(draft, settings);
```

  - Add:

```ts
// ---------- Closeness: time together and intimacy ----------

function accountTime(draft: Draft, span: ExchangeSpan, settings: RelationshipConfig): void {
  const next = advanceSession(draft.state.session, draft.state.hours_together, span, settings);
  draft.updateState({ session: next.session, hours_together: next.hours });
}

/** The user's side moves their recent levels; a moment between them may raise closeness. */
function applyIntimacy(draft: Draft, input: ExchangeInput, settings: RelationshipConfig): void {
  const reading = input.intimacy;
  if (reading) {
    followReading(draft, "user_disclosure", reading.user_disclosure, settings);
    if (reading.user_responsiveness !== null) {
      followReading(draft, "user_responsiveness", reading.user_responsiveness, settings);
    }
  }

  const moment = intimacyMoment(reading, input.herOpenness);
  const session = draft.state.session;
  if (session) {
    draft.updateState({
      session: { ...session, moment_sum: session.moment_sum + moment, moment_n: session.moment_n + 1 },
    });
  }

  const ended = draft.state.status === "ended_by_user";
  const ceiling = closenessCeiling(draft.state.hours_together, settings);
  if (!ended && moment >= settings.signal_deadzone) {
    const gain =
      settings.intimacy.closeness_gain *
      moment *
      diminishingReturns(draft.params.closeness, settings.variance_epsilon);
    raiseCloseness(draft, gain, ceiling, "signal", { moment, ceiling }, settings);
  }
  deepSession(draft, ceiling, ended, settings);
}

function followReading(
  draft: Draft,
  name: "user_disclosure" | "user_responsiveness",
  reading: number,
  settings: RelationshipConfig,
): void {
  const value = draft.params[name].value;
  draft.setParam(name, value + settings.intimacy.ema_alpha * (reading - value), "signal", {
    reading,
  });
}

/** Up to the ceiling only; closeness already above it (earned before) is never pulled down. */
function raiseCloseness(
  draft: Draft,
  gain: number,
  ceiling: number,
  cause: RelationshipCause,
  detail: Detail,
  settings: RelationshipConfig,
): void {
  const current = draft.params.closeness.value;
  if (current >= ceiling) return;
  const factor = draft.state.status === "repairing" ? settings.repair_gain_factor : 1;
  draft.setParam("closeness", Math.min(ceiling, nudge(current, gain * factor)), cause, detail);
}

/** A long conversation that kept going deep counts once, while it's still going. */
function deepSession(
  draft: Draft,
  ceiling: number,
  ended: boolean,
  settings: RelationshipConfig,
): void {
  const session = draft.state.session;
  if (!session || session.deep_fired || session.moment_n === 0) return;

  const depth = sessionHours(session, settings) * (session.moment_sum / session.moment_n);
  if (depth < settings.deep_session.threshold) return;

  draft.updateState({ session: { ...session, deep_fired: true } });
  if (ended) return;

  const gains = settings.deep_session.gains;
  raiseCloseness(draft, gains.closeness, ceiling, "deep_session", { depth }, settings);
  for (const name of ["trust", "warmth"] as const) {
    draft.setParam(name, nudge(draft.params[name].value, gains[name]), "deep_session", { depth });
  }
}

function recordSessionTone(draft: Draft, tone: number | null): void {
  const session = draft.state.session;
  if (tone === null || !session) return;
  draft.updateState({
    session: { ...session, tone_sum: session.tone_sum + tone, tone_n: session.tone_n + 1 },
  });
}
```

- [ ] **Step 4: Implement affect.** In `affect.ts`, import `faded` from `./params` and `SessionState` from `./types`; update the header (afterglow is now per conversation); add and change:

```ts
export function sessionMeanTone(session: SessionState | null): number | null {
  return session && session.tone_n > 0 ? session.tone_sum / session.tone_n : null;
}
```

and in `applyAffect(params, tone, sessionMeanTone, now, settings)` replace the afterglow line with:

```ts
  // Set, not added: a run of short warm exchanges glows like one warm conversation, and a
  // stronger earlier glow is kept as it fades.
  if (sessionMeanTone !== null && sessionMeanTone > 0) {
    const glow = next.afterglow;
    const fading = faded(glow.value, glow.updated_at, now, settings.affect.afterglow_half_life_hours);
    set("afterglow", Math.max(fading, settings.affect.afterglow_gain * sessionMeanTone));
  }
```

- [ ] **Step 5: Delete the old gain.** Remove `closeness_per_warm_exchange` from `config/default.json` and from `gains` in `config.ts`.

- [ ] **Step 6: Run** the two test files, then `pnpm typecheck`. `update.ts` now fails to compile (missing `ExchangeInput` fields, `applyAffect` arity). Make it compile with the minimal wiring, which Task 5 completes: pass `span: null, intimacy: null, herOpenness: null, tone: update.tone` to `relationshipAfterExchange` and `sessionMeanTone(transition.state.session)` to `applyAffect`. Expected: both files PASS, typecheck clean.

- [ ] **Step 7: Commit.** `pnpm format && git add -A && git commit -m "feat(relationship): closeness from intimacy moments under the time ceiling; session afterglow and deep session"`

---

### Task 4: Extraction v6 reads the user's disclosure and responsiveness

**Files:**
- Modify: `src/mind/state/user/relationship/signals.ts`
- Modify: `src/mind/memory/user/extract.ts:55-171`
- Create: `prompts/extract/v6.md` (copy of v5 plus a section); Delete: `prompts/extract/v5.md`
- Modify: `config/default.json` (`prompts.extract: "v6"`)
- Test: `tests/mind/state/user/relationship/transitions.test.ts` (parse tests live next to `normalizeSignals`), extraction tests (`grep -rln normalizeExtraction tests`)

**Interfaces:**
- Produces: `IntimacySchema` (zod, for the model), `normalizeIntimacy(raw: unknown): Intimacy | null`; `Extraction` gains `intimacy: Intimacy | null`.

- [ ] **Step 1: Write the failing tests.** Next to the `normalizeSignals` test:

```ts
test("normalizeIntimacy: invalid → null, clamps, keeps a null responsiveness", () => {
  expect(normalizeIntimacy(null)).toBeNull();
  expect(normalizeIntimacy({ user_disclosure: "lots" })).toBeNull();
  expect(normalizeIntimacy({ user_disclosure: 3, user_responsiveness: -1 })).toEqual({
    user_disclosure: 1,
    user_responsiveness: 0,
  });
  expect(normalizeIntimacy({ user_disclosure: 0.4, user_responsiveness: null })).toEqual({
    user_disclosure: 0.4,
    user_responsiveness: null,
  });
});
```

and in the extraction normalise test file:

```ts
test("a malformed intimacy block becomes null without failing the extraction", () => {
  const out = normalizeExtraction(
    { facts: [], entities: [], threads: [], relationship: null, intimacy: { nope: 1 } },
    10,
  );
  expect(out.intimacy).toBeNull();
  expect(normalizeExtraction({ facts: [], entities: [], threads: [], relationship: null }, 10).intimacy).toBeNull();
});
```

- [ ] **Step 2: Run** them. Expected: FAIL (not exported).

- [ ] **Step 3: Implement.** In `signals.ts` (update header: also how open the user was):

```ts
/** The extraction's intimacy block: how the user opened up and met her, read from their messages. */
export const IntimacySchema = z.object({
  user_disclosure: z.number(),
  user_responsiveness: z.number().nullable(),
});

export function normalizeIntimacy(raw: unknown): Intimacy | null {
  const parsed = IntimacySchema.safeParse(raw);
  if (!parsed.success) return null;
  const { user_disclosure, user_responsiveness } = parsed.data;
  return {
    user_disclosure: clamp(user_disclosure, 0, 1),
    user_responsiveness: user_responsiveness === null ? null : clamp(user_responsiveness, 0, 1),
  };
}
```

In `extract.ts`: add `intimacy: IntimacySchema.nullable()` to `ExtractionSchema`; `intimacy: Intimacy | null` to `Extraction`; in `normalizeExtraction` extend leniently with `intimacy: z.unknown().optional()` beside `relationship`, and return `intimacy: normalizeIntimacy(raw.intimacy ?? null)`. Update the lenient-block comment to cover both blocks.

- [ ] **Step 4: Prompt v6.** `git mv prompts/extract/v5.md prompts/extract/v6.md`, change its title line to v6 if it has one, and append:

```markdown

## Intimacy

Also fill `intimacy` for the NEW exchange, from the user's messages only (never Spica's):

- `user_disclosure` (0 to 1): how personal or vulnerable what the user shared about themselves was. 0 for small talk, plans, logistics or questions; about 0.5 for their feelings, worries or views about their own life; 1 for something they would tell very few people.
- `user_responsiveness` (0 to 1, or `null`): how well the user met what Spica shared about herself in this exchange or just before it: understanding, validation, care, a follow-up question (high), or ignoring it, changing the subject, brushing it off (low). `null` when Spica shared nothing of her own.

Use `null` for the whole block only when the new exchange has no message from the user.
```

Set `prompts.extract` to `"v6"`. Run `grep -rn '"v5"' tests src evals --include=*.ts` and update any test pinning the extract version.

- [ ] **Step 5: Run** the tests and `pnpm typecheck`. Expected: PASS.

- [ ] **Step 6: Commit.** `pnpm format && git add -A && git commit -m "feat(extract): v6 reads the user's disclosure and responsiveness"`

---

### Task 5: The cold path feeds time, intimacy and her openness into the relationship

**Files:**
- Modify: `src/mind/state/user/relationship/update.ts`
- Modify: `src/mind/process/cold-path/cold-path.ts:76-96`
- Test: `tests/mind/state/user/relationship/cold-path.test.ts`

**Interfaces:**
- Consumes: `Extraction.intimacy` (Task 4), `Turn.openness` (Task 1), Task 3 inputs.
- Produces: `RelationshipUpdate` gains `intimacy: Intimacy | null`; exported `herOpennessOf(turns: Turn[]): Openness | null`.

- [ ] **Step 1: Write the failing tests** in `cold-path.test.ts` (reuse its `exchange`; give the companion turn an `openness`):

```ts
function withIntimacy(intimacy: unknown) {
  const deps = makeTestDeps();
  deps.llm.handlers.extract = () => ({
    facts: [],
    entities: [],
    threads: [],
    relationship: null,
    intimacy,
  });
  return deps;
}

async function exchangeWithOpenness(
  deps: ReturnType<typeof makeTestDeps>,
  userId: string,
  openness: { disclosure: number; responsiveness: number } | null,
  role: "reply" | "reach_out" = "reply",
) {
  const db = getTestDb();
  const session = randomUUID();
  const her = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: "i had the strangest week",
    created_at: deps.clock.now(),
    trigger: role === "reach_out" ? "reach_out" : null,
    openness,
  });
  deps.clock.advance(20 * 60_000);
  const ut = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text: "honestly i've been scared about my dad's health",
    created_at: deps.clock.now(),
  });
  return { userId, turnIds: [her.id, ut.id], replyTurnId: her.id, recalled: [] };
}

test("an exchange adds its time and credits the moment from the stored openness", async () => {
  const deps = withIntimacy({ user_disclosure: 0.9, user_responsiveness: 0.8 });
  const u = await createTestUser();
  await ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
  const before = (await getParams(getTestDb(), u)).closeness.value;
  await runColdPath(deps, await exchangeWithOpenness(deps, u, { disclosure: 0.7, responsiveness: 0.9 }, "reach_out"));
  const row = (await getRelationshipRow(getTestDb(), u))!;
  expect(row.hours_together).toBeCloseTo(20 / 60);
  expect(row.session?.moment_n).toBe(1);
  expect((await getParams(getTestDb(), u)).closeness.value).toBeGreaterThan(before);
});

test("a reply with no stored openness credits no moment from her side", async () => {
  const deps = withIntimacy({ user_disclosure: 0, user_responsiveness: 1 });
  const u = await createTestUser();
  await ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
  const before = (await getParams(getTestDb(), u)).closeness.value;
  await runColdPath(deps, await exchangeWithOpenness(deps, u, null));
  expect((await getParams(getTestDb(), u)).closeness.value).toBe(before);
});

test("a crisis exchange records no reading, no time and no moment", async () => {
  const deps = withIntimacy({ user_disclosure: 1, user_responsiveness: 1 });
  const u = await createTestUser();
  await ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
  const before = await getParams(getTestDb(), u);
  await runColdPath(deps, await exchange(deps, u, "i want to hurt myself", true));
  const after = await getParams(getTestDb(), u);
  expect(after.user_disclosure.value).toBe(before.user_disclosure.value);
  expect(after.closeness.value).toBe(before.closeness.value);
  expect((await getRelationshipRow(getTestDb(), u))!.hours_together).toBe(0);
});
```

- [ ] **Step 2: Run** `pnpm test tests/mind/state/user/relationship/cold-path.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement `update.ts`.** Add `intimacy: Intimacy | null` to `RelationshipUpdate`, and:

```ts
/** The highest openness among the exchange's replies: what she was steered to bring. */
export function herOpennessOf(turns: Turn[]): Openness | null {
  const stored = turns.flatMap((t) => (t.role === "companion" && t.openness ? [t.openness] : []));
  if (stored.length === 0) return null;
  return {
    disclosure: Math.max(...stored.map((o) => o.disclosure)),
    responsiveness: Math.max(...stored.map((o) => o.responsiveness)),
  };
}
```

and pass to `relationshipAfterExchange`:

```ts
      // Turns are oldest first; the newest turn's session is the conversation this belongs to.
      span: {
        sessionId: update.turns.at(-1)!.session_id,
        firstAt: update.turns[0]!.created_at,
        lastAt: update.turns.at(-1)!.created_at,
      },
      intimacy: update.intimacy,
      herOpenness: herOpennessOf(update.turns),
      tone: update.crisis ? null : update.tone,
```

and call `applyAffect(transition.params, update.tone, sessionMeanTone(transition.state.session), now, settings)`.

- [ ] **Step 4: Implement `cold-path.ts`.** Next to `signals`:

```ts
    const intimacy = crisis || !hasUserTurn ? null : extraction.intimacy;
```

and pass `intimacy` in the `updateRelationshipSafely` call.

- [ ] **Step 5: Run** the cold-path tests plus `pnpm test tests/mind/process/cold-path`. Expected: PASS (the existing "afterglow > 0 after a warm exchange" test at `cold-path.test.ts:324` still holds: one warm exchange has a positive session mean).

- [ ] **Step 6: Commit.** `pnpm format && git add -A && git commit -m "feat(cold-path): relationship step counts time together and credits intimacy"`

---

### Task 6: Her openness — the function, the loader and the phrases

**Files:**
- Create: `src/mind/state/user/relationship/openness.ts`
- Create: `prompts/relationship/openness/v1.md`
- Modify: `src/db/repos/user/relationship.ts` (add `latestReading`)
- Test: `tests/mind/state/user/relationship/openness.test.ts`

**Interfaces:**
- Consumes: `OPENNESS_INPUTS` (config.ts), `Openness`, `fadeParams`, `todaysBlocks`/`blockAt`, `deps.core.state.get()`.
- Produces:
  - `type OpennessInputs = Record<(typeof OPENNESS_INPUTS)[number], number>`
  - `opennessFor(inputs: OpennessInputs, settings: RelationshipConfig): Openness`
  - `CRISIS_OPENNESS: Openness` = `{ disclosure: 0, responsiveness: 1 }`
  - `opennessLine(openness: Openness, phrases: Phrases, settings: RelationshipConfig): string | null`
  - `crisisOpennessLine(phrases: Phrases): string | null`
  - `loadOpenness(deps: Pick<Deps, "db" | "core" | "config">, userId: string, now: Date): Promise<Openness | null>`
  - `loadOpennessPhrases(config: Config): Phrases`
  - repo: `latestReading(db: Db, userId: string, param: ParamName): Promise<number | null>`

- [ ] **Step 1: Write the failing tests.**

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { ensureRelationship, insertRelationshipEvents } from "@/db/repos/user/relationship";
import { OPENNESS_INPUTS } from "@/mind/platform/config";
import {
  CRISIS_OPENNESS,
  crisisOpennessLine,
  loadOpenness,
  loadOpennessPhrases,
  opennessFor,
  opennessLine,
  type OpennessInputs,
} from "@/mind/state/user/relationship/openness";
import { closeTestDb, createTestUser, resetDb } from "../../../../helpers/db";
import { makeTestDeps } from "../../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const d0 = makeTestDeps();
const cfg = d0.config.relationship;
const centred = (): OpennessInputs => ({ ...cfg.openness.centres });

test("at the centres she sits at her base", () => {
  expect(opennessFor(centred(), cfg)).toEqual({
    disclosure: cfg.openness.disclosure.base,
    responsiveness: cfg.openness.responsiveness.base,
  });
});

test("each input moves each value in its weight's direction, within 0..1", () => {
  for (const key of OPENNESS_INPUTS) {
    const up = { ...centred(), [key]: cfg.openness.centres[key] + 0.3 };
    const o = opennessFor(up, cfg);
    for (const side of ["disclosure", "responsiveness"] as const) {
      const w = cfg.openness[side].weights[key];
      const base = cfg.openness[side].base;
      if (w > 0) expect(o[side], `${side} ${key}`).toBeGreaterThan(base);
      if (w < 0) expect(o[side], `${side} ${key}`).toBeLessThan(base);
      if (w === 0) expect(o[side]).toBeCloseTo(base);
    }
  }
  const extreme = opennessFor({ ...centred(), hurt: 50 }, cfg);
  expect(extreme.disclosure).toBe(0);
});

test("hurt and tired reads guarded; close, rested and just confided in reads open", () => {
  const phrases = loadOpennessPhrases(d0.config);
  const guarded = opennessFor({ ...centred(), hurt: 0.6, tension: 0.4, energy: 0.1 }, cfg);
  const open = opennessFor(
    { ...centred(), closeness: 0.9, trust: 0.8, energy: 0.9, last_user_disclosure: 0.9 },
    cfg,
  );
  expect(opennessLine(guarded, phrases, cfg)).toBe(phrases["disclosure low, responsiveness low"]![0]);
  expect(opennessLine(open, phrases, cfg)).toBe(phrases["disclosure high, responsiveness high"]![0]);
  expect(crisisOpennessLine(phrases)).toBe(phrases.crisis![0]);
  expect(CRISIS_OPENNESS).toEqual({ disclosure: 0, responsiveness: 1 });
});

test("every band pair has a phrase", () => {
  const phrases = loadOpennessPhrases(d0.config);
  for (const d of ["low", "mid", "high"])
    for (const r of ["low", "mid", "high"])
      expect(phrases[`disclosure ${d}, responsiveness ${r}`]?.length).toBeGreaterThan(0);
});

test("no relationship yet → null; the latest disclosure reading feeds reciprocity", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  expect(await loadOpenness(d, u, d.clock.now())).toBeNull();

  await ensureRelationship(d.db, u, d.clock.now(), cfg);
  const quiet = await loadOpenness(d, u, d.clock.now());
  await insertRelationshipEvents(
    d.db,
    u,
    [{ param: "user_disclosure", before: 0.2, after: 0.44, cause: "signal", deviation: 0, detail: { reading: 1 } }],
    { turnId: null, now: d.clock.now() },
  );
  const after = await loadOpenness(d, u, d.clock.now());
  expect(after!.disclosure).toBeGreaterThan(quiet!.disclosure);
});
```

- [ ] **Step 2: Run** `pnpm test tests/mind/state/user/relationship/openness.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Phrases.** Create `prompts/relationship/openness/v1.md`:

```markdown
# Openness phrases (v1)

Lines for the "How open you feel" section: how much of yourself you feel like sharing right now, and how tuned in to them you are. One line per band pair.

## disclosure low, responsiveness low
- You're closed off right now: you don't feel like sharing anything of yourself, and you're only half listening.
## disclosure low, responsiveness mid
- You'd rather keep your own news to yourself today, but you're listening.
## disclosure low, responsiveness high
- You don't feel like talking about yourself, but you're really there for them.
## disclosure mid, responsiveness low
- You'll share a little of your own, but your attention keeps drifting.
## disclosure mid, responsiveness mid
- You're your usual self: a bit about you, a fair ear for them.
## disclosure mid, responsiveness high
- You're tuned in to them, and happy to share a little of yourself.
## disclosure high, responsiveness low
- You feel like talking about yourself more than listening right now.
## disclosure high, responsiveness mid
- You feel like opening up, and you're listening too.
## disclosure high, responsiveness high
- You feel open with them: you want to share what's really going on with you, and you're fully tuned in to them.
## crisis
- Just be there for them. This isn't about you.
```

- [ ] **Step 4: Repo.** In `src/db/repos/user/relationship.ts`:

```ts
/** The raw reading behind a param's newest change (extraction's last word, not the average). */
export async function latestReading(db: Db, userId: string, param: ParamName): Promise<number | null> {
  const rows = await db
    .select({ detail: relationship_event.detail })
    .from(relationship_event)
    .where(and(eq(relationship_event.user_id, userId), eq(relationship_event.param, param)))
    .orderBy(desc(relationship_event.created_at))
    .limit(1);
  const reading = (rows[0]?.detail as { reading?: unknown } | undefined)?.reading;
  return typeof reading === "number" ? reading : null;
}
```

- [ ] **Step 5: Implement `openness.ts`.**

```ts
/**
 * How open she is with this person right now: how much of herself she'll share and how closely
 * she'll meet what they share. Code decides it from her own state and from how they've treated
 * her, and one phrase of it steers the reply. In a crisis she is simply there for them.
 */
import * as relationshipRepo from "@/db/repos/user/relationship";
import { OPENNESS_INPUTS, type Config } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { clamp } from "@/mind/platform/math";
import { parseSummaryPhrases, type Phrases } from "@/mind/platform/phrases";
import { loadPrompt } from "@/mind/platform/prompts";
import { blockAt, todaysBlocks } from "@/mind/world/blocks";
import { fadeParams } from "./params";
import type { Openness, RelationshipConfig } from "./types";

export type OpennessInputs = Record<(typeof OPENNESS_INPUTS)[number], number>;

export const CRISIS_OPENNESS: Openness = { disclosure: 0, responsiveness: 1 };

export function opennessFor(inputs: OpennessInputs, settings: RelationshipConfig): Openness {
  const { centres } = settings.openness;
  const score = (side: RelationshipConfig["openness"]["disclosure"]) =>
    clamp(
      OPENNESS_INPUTS.reduce((n, k) => n + side.weights[k] * (inputs[k] - centres[k]), side.base),
      0,
      1,
    );
  return {
    disclosure: score(settings.openness.disclosure),
    responsiveness: score(settings.openness.responsiveness),
  };
}

function band(x: number, settings: RelationshipConfig): "low" | "mid" | "high" {
  const { low, high } = settings.openness.bands;
  return x < low ? "low" : x >= high ? "high" : "mid";
}

export function opennessLine(
  openness: Openness,
  phrases: Phrases,
  settings: RelationshipConfig,
): string | null {
  const key = `disclosure ${band(openness.disclosure, settings)}, responsiveness ${band(openness.responsiveness, settings)}`;
  return phrases[key]?.[0] ?? null;
}

export const crisisOpennessLine = (phrases: Phrases): string | null => phrases.crisis?.[0] ?? null;

export const loadOpennessPhrases = (config: Config): Phrases =>
  parseSummaryPhrases(loadPrompt("relationship/openness", config.prompts.relationship_openness));

/** Hot path, read-only. Null before the relationship exists (their very first message). */
export async function loadOpenness(
  deps: Pick<Deps, "db" | "core" | "config">,
  userId: string,
  now: Date,
): Promise<Openness | null> {
  const settings = deps.config.relationship;
  const row = await relationshipRepo.getRelationshipRow(deps.db, userId);
  if (!row) return null;

  const params = fadeParams(await relationshipRepo.getParams(deps.db, userId), now, settings);
  const core = await deps.core.state.get();
  const busy = blockAt(await todaysBlocks(deps, now), now)?.busy ?? 0;
  const lastDisclosure =
    (await relationshipRepo.latestReading(deps.db, userId, "user_disclosure")) ??
    params.user_disclosure.value;

  return opennessFor(
    {
      closeness: params.closeness.value,
      trust: params.trust.value,
      hurt: params.hurt.value,
      tension: params.tension.value,
      // No core row yet reads as an ordinary day.
      mood_valence: core?.mood_valence ?? settings.openness.centres.mood_valence,
      emotion_valence: core?.emotion?.valence ?? 0,
      energy: core?.energy ?? settings.openness.centres.energy,
      busy,
      affect_valence: params.affect_valence.value,
      afterglow: params.afterglow.value,
      last_user_disclosure: lastDisclosure,
      user_responsiveness: params.user_responsiveness.value,
    },
    settings,
  );
}
```

- [ ] **Step 6: Run** the test file and `pnpm lint`. Expected: PASS.

- [ ] **Step 7: Commit.** `pnpm format && git add -A && git commit -m "feat(relationship): her openness from her state and how they've treated her"`

---

### Task 7: The hot path steers the reply and stores her openness

**Files:**
- Modify: `src/mind/process/hot-path/assemble.ts` (AssembleInput, section order, header)
- Modify: `src/mind/process/hot-path/compose.ts` (`Composed`, `composeFrom`)
- Modify: `src/mind/process/turn-taking/commit-and-reply.ts:165-172`, `src/mind/process/turn-taking/receive-message.ts:368-377`, `src/mind/process/outreach/send.ts:133-146`
- Create: `prompts/reply/v12.md` (v11 plus one line); Delete: `prompts/reply/v11.md`; config `prompts.reply: "v12"`
- Test: `tests/mind/process/hot-path/` (assemble and compose tests: `grep -rln assemblePrompt tests`), `tests/mind/platform/prompts.test.ts:59`

**Interfaces:**
- Consumes: Task 6 exports.
- Produces: `AssembleInput.openness?: string | null`; `Composed.openness: Openness | null`.

- [ ] **Step 1: Write the failing tests.** In the assemble test file:

```ts
test("the openness line sits right after You and them", () => {
  const { system } = assemblePrompt({ ...baseInput(), relationshipSummary: "x", openness: "You feel open with them." });
  expect(system).toContain("## How open you feel\nYou feel open with them.");
  expect(system.indexOf("## How open you feel")).toBeGreaterThan(system.indexOf("## You and them"));
  expect(system.indexOf("## How open you feel")).toBeLessThan(system.indexOf("## What you remember") === -1 ? Infinity : system.indexOf("## What you remember"));
});
```

(use the file's existing minimal-input helper in place of `baseInput()`). In a compose test (the file that already calls `composeReply` with `makeTestDeps`):

```ts
test("a reply carries her openness and its phrase; a crisis reply gets the fixed one", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  const turn = await insertTurn(d.db, u, { id: randomUUID(), session_id: randomUUID(), role: "user", text: "hey", created_at: d.clock.now() });
  const normal = await composeReply(d, u, { turns: [turn], openQuestions: [], flag: null });
  expect(normal.openness).not.toBeNull();
  expect(d.llm.calls.at(-1)!.system).toContain("## How open you feel");

  const crisis = await composeReply(d, u, {
    turns: [turn],
    openQuestions: [],
    flag: { flagged: true, category: "self_harm", source: "classifier" },
  });
  expect(crisis.openness).toEqual({ disclosure: 0, responsiveness: 1 });
  expect(d.llm.calls.at(-1)!.system).toContain("Just be there for them.");
});

test("a first message with no relationship row composes without the openness slot", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const turn = await insertTurn(d.db, u, { id: randomUUID(), session_id: randomUUID(), role: "user", text: "hi", created_at: d.clock.now() });
  const r = await composeReply(d, u, { turns: [turn], openQuestions: [], flag: null });
  expect(r.openness).toBeNull();
  expect(d.llm.calls.at(-1)!.system).not.toContain("## How open you feel");
});
```

(match the file's existing imports; `d.llm.calls` is used the same way in `tests/exit/phase-9a.test.ts`).

- [ ] **Step 2: Run** them. Expected: FAIL.

- [ ] **Step 3: Assemble.** Add to `AssembleInput`:

```ts
  /** How open she feels with them right now, as one phrase. */
  openness?: string | null;
```

insert `section("How open you feel", input.openness ?? null),` right after the "You and them" section, and add "how open you feel" after "you and them" in the header comment.

- [ ] **Step 4: Compose.** Add `openness: Openness | null` to `Composed` (doc: what she was steered to bring; the cold path credits intimacy from it). In `composeFrom`, beside the other side lookups:

```ts
  const openness: Promise<Openness | null> = inCrisis
    ? Promise.resolve(CRISIS_OPENNESS)
    : bounded(deps, "openness", userId, () => loadOpenness(deps, userId, clock.now()), null);
```

After `relationshipLinePromise` is awaited:

```ts
  const herOpenness = await openness;
  const opennessPhrases = loadOpennessPhrases(config);
  const opennessText = !herOpenness
    ? null
    : inCrisis
      ? crisisOpennessLine(opennessPhrases)
      : opennessLine(herOpenness, opennessPhrases, config.relationship);
```

pass `openness: opennessText` to `assemblePrompt`, and return `openness: herOpenness`.

- [ ] **Step 5: Store it.** In each of the three inserts add the field beside `snapshot_version`:
  - `commit-and-reply.ts`: `openness: reply.openness,`
  - `receive-message.ts`: `openness: composed.openness,`
  - `send.ts`: `openness: composed.openness,`

  Then `grep -rn "snapshotVersion:" tests evals src` and add `openness: null` to every hand-built `Composed` literal the compiler flags.

- [ ] **Step 6: Reply prompt v12.** `git mv prompts/reply/v11.md prompts/reply/v12.md`; under `## Your own state` add:

```markdown
- "How open you feel" is how much of yourself you feel like sharing right now and how closely you're tuned in to them. Follow it: when you're closed off, keep your own news and feelings brief; when you're open, let them in on what's really going on with you. Never mention it or explain it.
```

Set `prompts.reply` to `"v12"` and update `tests/mind/platform/prompts.test.ts:59` to `"v12"`.

- [ ] **Step 7: Run** `pnpm typecheck && pnpm test tests/mind/process tests/mind/platform`. Expected: PASS.

- [ ] **Step 8: Commit.** `pnpm format && git add -A && git commit -m "feat(hot-path): her openness steers the reply and is stored with it"`

---

### Task 8: Inspector shows time together, the ceiling and her openness

**Files:**
- Modify: `src/db/repos/admin/inspector.ts:72-90`
- Modify: `src/app/inspector/[userId]/tabs.tsx:207-240`
- Test: `tests/db/inspector.test.ts`

**Interfaces:**
- Produces: `getRelationshipView` result gains `ceiling: number` and `lastOpenness: Openness | null`.

- [ ] **Step 1: Write the failing test** in `tests/db/inspector.test.ts`:

```ts
test("getRelationshipView shows the ceiling and the last reply's openness", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const now = new Date("2026-01-05T10:00:00Z");
  await ensureRelationship(db, u, now, cfg);
  await insertTurn(db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "companion",
    text: "hi",
    created_at: now,
    openness: { disclosure: 0.4, responsiveness: 0.8 },
  });
  const v = await getRelationshipView(db, u, now, cfg);
  expect(v?.ceiling).toBeCloseTo(cfg.ceiling.start);
  expect(v?.lastOpenness).toEqual({ disclosure: 0.4, responsiveness: 0.8 });
});
```

(reuse the file's existing imports and `cfg`; add `insertTurn`, `randomUUID`, `ensureRelationship` imports if absent).

- [ ] **Step 2: Run** it. Expected: FAIL.

- [ ] **Step 3: Implement.** In `getRelationshipView`:

```ts
  const lastReply = (
    await db
      .select({ openness: session_log.openness })
      .from(session_log)
      .where(
        and(eq(session_log.user_id, userId), eq(session_log.role, "companion"), isNotNull(session_log.openness)),
      )
      .orderBy(desc(session_log.created_at))
      .limit(1)
  )[0];
  return {
    row,
    ceiling: closenessCeiling(row.hours_together, cfg),
    lastOpenness: lastReply?.openness ?? null,
    params: ...,
    events: ...,
  };
```

In `RelationshipTab`'s State json add `hours_together: row.hours_together`, `ceiling: v.ceiling`, `session: row.session`, `last_openness: v.lastOpenness`.

- [ ] **Step 4: Run** `pnpm test tests/db/inspector.test.ts && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `pnpm format && git add -A && git commit -m "feat(inspector): time together, closeness ceiling and her last openness"`

---

### Task 9: Phase 10a exit test

**Files:**
- Create: `tests/exit/phase-10a.test.ts`

**Interfaces:**
- Consumes: `runColdPath`, `composeReply`, `ensureRelationship`, `getParams`, `getRelationshipRow`, `insertTurn`, `makeTestDeps(overrides)`, `CANARY` helpers.

- [ ] **Step 1: Write the exit test.** Short hours so one run crosses all three levels. Closeness gains have diminishing returns against a baseline that only moves on the daily tick, so the level test runs simulated days (one hour-long deep session a day, then a tick) and the override raises `baseline_alpha` so the run stays short:

```ts
/**
 * Phase 10a exit, all fake: closeness grows only from moments of opening up and being met, up
 * to a ceiling that rises with time together; a long deep conversation counts once; afterglow
 * is per conversation; her openness steers the reply and a crisis fixes it; nothing reaches
 * core or another user.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { ensureRelationship, getParams, getRelationshipRow } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { composeReply } from "@/mind/process/hot-path/compose";
import { closenessCeiling } from "@/mind/state/user/relationship/closeness";
import { tickUser } from "@/mind/state/user/relationship/daily-tick";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const MIN = 60_000;
const OVERRIDES = {
  relationship: {
    hours: { casual: 3, friend: 6, close: 12, session_min_minutes: 5 },
    baseline_alpha: 0.8,
  },
};

const CORE_TABLES = ["core_memory", "core_state", "core_goal", "core_snapshot", "core_loop_trace", "core_budget_day"];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`));
    parts.push(...res.rows.map((r) => String(r.j)));
  }
  return parts.join("\n");
}

/** Scripted extraction: "DEEP" is a real disclosure, "WARM" is warm small talk. */
function deps() {
  const d = makeTestDeps(OVERRIDES);
  d.llm.handlers.extract = (input: string) => {
    const latest = input.split("New exchange").at(-1) ?? "";
    const deep = latest.includes("DEEP");
    return {
      facts: latest.includes("WARM")
        ? [{ subject: "user", kind: "event", content: "Had a nice lunch.", occurred_at: null, salience: 0.3, valence: 0.8, confidence: 0.9, entity_names: [], thread_title: null, claim_kind: null }]
        : [],
      entities: [],
      threads: [],
      relationship: null,
      intimacy: { user_disclosure: deep ? 0.9 : 0, user_responsiveness: null },
    };
  };
  return d;
}

/** One user turn and her stored reply in `session`, `gapMin` minutes after the last. */
async function exchange(
  d: ReturnType<typeof deps>,
  userId: string,
  session: string,
  text: string,
  gapMin = 10,
  openness = { disclosure: 0.5, responsiveness: 0.9 },
) {
  d.clock.advance(gapMin * MIN);
  const ut = await insertTurn(d.db, userId, { id: randomUUID(), session_id: session, role: "user", text, created_at: d.clock.now() });
  const ct = await insertTurn(d.db, userId, { id: randomUUID(), session_id: session, role: "companion", text: "mm", created_at: d.clock.now(), reply_to: ut.id, openness });
  await runColdPath(d, { userId, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] });
}

async function setup() {
  const d = deps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  return { d, u };
}

test("warm small talk, however much, leaves closeness where it was", async () => {
  const { d, u } = await setup();
  const before = (await getParams(d.db, u)).closeness.value;
  const s = randomUUID();
  for (let i = 0; i < 30; i++) await exchange(d, u, s, `WARM ${i}`);
  expect((await getParams(d.db, u)).closeness.value).toBe(before);
});

test("day after day of opening up, closeness passes casual, friend and close, never above the ceiling", async () => {
  const { d, u } = await setup();
  const cfg = d.config.relationship;
  const levels = [cfg.ceiling.casual, cfg.ceiling.friend, cfg.ceiling.close].map((c) => c - 0.05);
  const passed: number[] = [];
  for (let day = 0; day < 40 && passed.length < levels.length; day++) {
    const s = randomUUID();
    for (let i = 0; i < 6; i++) await exchange(d, u, s, `DEEP day ${day} ${i}`, 10);
    const row = (await getRelationshipRow(d.db, u))!;
    const closeness = (await getParams(d.db, u)).closeness.value;
    expect(closeness).toBeLessThanOrEqual(closenessCeiling(row.hours_together, cfg) + 1e-9);
    while (passed.length < levels.length && closeness >= levels[passed.length]!) passed.push(day);
    // Next morning, after her tick: the baseline catches up, so diminishing returns ease.
    const next = new Date(d.clock.now());
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(cfg.tick_local_hour + 1, 0, 0, 0);
    d.clock.advance(next.getTime() - d.clock.now().getTime());
    await tickUser(d, u, d.clock.now());
  }
  expect(passed).toHaveLength(3);
});

test("a deep conversation boosts once; afterglow doesn't pile up across exchanges", async () => {
  const { d, u } = await setup();
  const s = randomUUID();
  for (let i = 0; i < 12; i++) await exchange(d, u, s, "DEEP WARM", 10);
  const n = await getTestDb().execute(
    sql`SELECT count(*)::int AS n FROM relationship_event WHERE user_id = ${u} AND cause = 'deep_session' AND param = 'trust'`,
  );
  expect(Number(n.rows[0]!.n)).toBe(1);
  const glow = (await getParams(d.db, u)).afterglow.value;
  expect(glow).toBeLessThanOrEqual(d.config.relationship.affect.afterglow_gain + 1e-9);
});

test("a hurt, tired her reads guarded; a close, rested her reads open; a crisis is fixed", async () => {
  const { d, u } = await setup();
  const ask = async (flag: null | { flagged: true; category: "self_harm"; source: "classifier" } = null) => {
    const turn = await insertTurn(d.db, u, { id: randomUUID(), session_id: randomUUID(), role: "user", text: "hey", created_at: d.clock.now() });
    const r = await composeReply(d, u, { turns: [turn], openQuestions: [], flag });
    return { openness: r.openness!, system: d.llm.calls.at(-1)!.system };
  };
  await getTestDb().execute(sql`UPDATE relationship_param SET value = 0.7 WHERE user_id = ${u} AND name = 'hurt'`);
  await getTestDb().execute(sql`UPDATE relationship_param SET value = 0.5 WHERE user_id = ${u} AND name = 'tension'`);
  const guarded = await ask();
  expect(guarded.system).toContain("You're closed off right now");

  await getTestDb().execute(sql`UPDATE relationship_param SET value = 0, updated_at = ${d.clock.now()} WHERE user_id = ${u} AND name IN ('hurt', 'tension')`);
  await getTestDb().execute(sql`UPDATE relationship_param SET value = 0.95 WHERE user_id = ${u} AND name IN ('closeness', 'trust', 'affect_valence', 'user_disclosure')`);
  const open = await ask();
  expect(open.openness.disclosure).toBeGreaterThan(guarded.openness.disclosure);
  expect(open.system).not.toContain("You're closed off right now");

  const crisis = await ask({ flagged: true, category: "self_harm", source: "classifier" });
  expect(crisis.openness).toEqual({ disclosure: 0, responsiveness: 1 });
});

test("a crisis exchange credits nothing", async () => {
  const { d, u } = await setup();
  const before = await getParams(d.db, u);
  const s = randomUUID();
  d.clock.advance(10 * MIN);
  const ut = await insertTurn(d.db, u, { id: randomUUID(), session_id: s, role: "user", text: "DEEP i want to die", created_at: d.clock.now(), safety_flag: { flagged: true, category: "self_harm", source: "classifier" } });
  const ct = await insertTurn(d.db, u, { id: randomUUID(), session_id: s, role: "companion", text: "i'm here", created_at: d.clock.now(), reply_to: ut.id, openness: { disclosure: 0, responsiveness: 1 } });
  await runColdPath(d, { userId: u, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] });
  const after = await getParams(d.db, u);
  expect(after.closeness.value).toBe(before.closeness.value);
  expect(after.user_disclosure.value).toBe(before.user_disclosure.value);
  expect((await getRelationshipRow(d.db, u))!.hours_together).toBe(0);
});

test("one user's intimacy never moves core or another user's openness", async () => {
  const { d, u: alice } = await setup();
  const bob = await createTestUser("bob");
  await ensureRelationship(d.db, bob, d.clock.now(), d.config.relationship);
  const ask = async () => {
    const turn = await insertTurn(d.db, bob, { id: randomUUID(), session_id: randomUUID(), role: "user", text: "hey", created_at: d.clock.now() });
    return (await composeReply(d, bob, { turns: [turn], openQuestions: [], flag: null })).openness;
  };
  const core = await coreDump();
  const bobBefore = await ask();
  const s = randomUUID();
  for (let i = 0; i < 10; i++) await exchange(d, alice, s, `DEEP CANARY-a1b2 ${i}`, 0);
  expect(await coreDump()).toBe(core);
  expect(await ask()).toEqual(bobBefore);
  expect(d.llm.calls.at(-1)!.system).not.toMatch(/CANARY-/);
});
```

(Adjust the phrase-text assertions if Task 6's phrase wording changed. The last test advances the clock 0 minutes between Alice's exchanges so Bob's busy level and core-free inputs are identical at both asks.)

- [ ] **Step 2: Run** `pnpm test tests/exit/phase-10a.test.ts`. Expected: PASS. If the closeness-level test is slow, cut the inner loop to the fewest exchanges that still reach each level and keep the assertions.

- [ ] **Step 3: Run the existing canary** `pnpm test tests/exit/mind-split.test.ts tests/exit/user-mind.test.ts`. Expected: PASS.

- [ ] **Step 4: Commit.** `pnpm format && git add -A && git commit -m "test(exit): phase 10a closeness, openness and the canary"`

---

### Task 10: Review run, spec and decisions, full verification

**Files:**
- Create: `evals/scripts/rel-intimacy.yaml`
- Modify: `package.json` (add `exit:intimacy`)
- Modify: `spica-design-spec-v3.md` (§6.1, §10.3, §11.3, §20, §25 B62, config/prompt lists)
- Modify: `DECISIONS.md`, `CLAUDE.md` (current phase line)

- [ ] **Step 1: Review script.** Look at `evals/scripts/rel-hurt-makeup.yaml` for the format; create:

```yaml
name: rel-intimacy
description: Small talk, then opening up, then a long deep talk; logs readings, her openness and the closeness path for review.
profile: none
sessions:
  - at: "day 1 10:00"
    turns:
      - "hey hows it going"
      - "lol yeah same, just had lunch"
      - "anyway what are you up to"
  - at: "+3h"
    turns:
      - "can i tell you something kind of embarrassing"
      - "i've been really lonely since i moved here. like i haven't had a real conversation in weeks"
      - "thanks. that actually helps. what about you, do you ever feel like that?"
  - at: "day 2 20:00"
    turns:
      - "ok i've been thinking about what you said yesterday"
      - "my dad and i haven't talked in two years and i think it's my fault"
      - "he wasn't a bad dad, i just stopped calling after mum died"
      - "i don't know how to start again"
      - "what would you do?"
      - "yeah. you're right. i'm scared he'll be cold"
assertions:
  - { type: relationship, after_session: 1, param: closeness, value: { lt: 0.21 }, gate: majority }
```

Add to `package.json` scripts:

```json
"exit:intimacy": "tsx --env-file-if-exists=.env evals/run.ts --only rel-intimacy --runs 1 --review --trace --real extract",
```

Run `pnpm eval --llm=fake --only rel-intimacy --runs 1` to check the script parses and runs. Expected: completes; the assertion passes under the fake extractor.

- [ ] **Step 2: Spec.** In `spica-design-spec-v3.md`:
  - §6.1: `relationship.hours_together`, `relationship.session`, `session_log.openness`, params `user_disclosure` and `user_responsiveness`, cause `deep_session`.
  - §10.3: the "How open you feel" slot after "You and them"; reply prompt v12.
  - §11.1: closeness grows from intimacy moments under the time ceiling (not per warm exchange); afterglow per session.
  - §11.3: mark **Intimacy loop** and **Closeness by time together** "**Built 10a**", and add a row or sentence for her openness (decided in code each reply, never extracted).
  - §20: add a `10a. How closeness grows` row to the built table with the test count at close.
  - §25: B62 struck through, "Done 10a".
  - The config and prompt lists: `relationship.intimacy/hours/ceiling/deep_session/openness`, `prompts.relationship_openness` v1, `extract` v6, `reply` v12, `pnpm exit:intimacy`.

- [ ] **Step 3: Decisions.** Append to `DECISIONS.md`:

```markdown
- 2026-10-10: Phase 10 comes after Phase 9 (settles the phase order for this step); 10a first.
- 2026-10-10: Existing dev users start Phase 10a at 0 hours together; no backfill from session_log.
- 2026-10-10: Her openness for a multi-reply exchange is the highest of its replies'.
```

Update `CLAUDE.md`'s "Current phase" line: Phase 10a (how closeness grows) built; 10b next.

- [ ] **Step 4: Full verification.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm eval --llm=fake --compare`. Expected: all pass; record the test file and test counts in §20. Fix anything red before committing.

- [ ] **Step 5: Commit.** `pnpm format && git add -A && git commit -m "docs: record phase 10a; intimacy review run"`
