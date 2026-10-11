# Phase 10d: Stages, Commitment and the Milestone Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Knapp's ten stages gate how deep she goes, which of their things she reuses and her posture; commitment (satisfaction + investment) softens impact and speeds recovery; a `milestone` big event runs the user loops the first time something happens.

**Architecture:** Two pure modules in `src/mind/state/user/relationship/`: `stages.ts` (climb the sticky peak, overlay a coming-apart stage with hysteresis, gates per stage, a read-only `loadStage`) and `commitment.ts` (the daily formula). `milestones.ts` holds the open detector list. The cold path's relationship step and the daily tick call `restage` and `newMilestones` after the existing transition, inside the same transaction; milestone names ride in that run's triggers. `transitions.ts` gains softening, the commitment-scaled absence drift and repair, and the rekindle boost. The hot path reads the stored stage for depth, idiolect and a new "Where you are with them" line.

**Tech Stack:** TypeScript, Drizzle + Postgres 16, zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-12-phase-10d-stages-commitment-milestones-design.md`

## Global Constraints

- `src/mind` is framework-free: no Next imports, no `Date.now()`, no `process.env`; use injected `Deps` and the `Clock`.
- Every numeric constant goes in `config/default.json` with a zod schema in `src/mind/platform/config.ts`. Every weight is a first guess (test phase).
- Every prompt is a versioned file; delete versions nothing configures (`prompts/reply/v14.md`).
- Comments say why, not where from: never cite spec sections, phases or review items in code.
- Every file starts with a short plain-English header; Prettier at 100 columns (`pnpm format`).
- Timestamps come from the injected clock; never `DEFAULT now()`.
- Build on what exists, replace from the ground up: `relationship.depth.bands` and `relationship.idiolect.min_closeness` are deleted with their refine and every reader; no shims.
- Scope: everything here is user-scoped; nothing reads or writes core. Users never mix.
- A crisis exchange changes no stage and records no milestone; nothing after the user has ended it records a milestone.
- Run one test process at a time (shared test DB). A full `pnpm test` takes about 10 minutes.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A relationship row from before 10d (`milestones` null) with closeness 0.7 gets depth `open` 2 or more on its very next reply, before any cold path has run, and its first evaluation fires **no** milestones. Pinned in Task 2 (`stageOf`) and Task 6 (exit).
2. A user stuck at **initial trust 0.4** must not enter `differentiating` or be unable to leave it: trust enter 0.3, clear 0.35, both below the initial value. Pinned in Task 2's hysteresis test.
3. A crisis exchange with an idiolect established and a deep disclosure must not record `first_inside_joke` / `first_their_depth`; they fire on the next ordinary exchange. Pinned in Task 4.
4. An absent user ticked into `avoiding` must not count as `first_conflict`. Pinned in Task 4 (milestone unit test).
5. Commitment 1 must still let a large hurt leave the trust scar (the scar reads the unsoftened amount). Pinned in Task 3.

---

### Task 1: Schema, types and config

**Files:**
- Modify: `src/db/schema.ts` (enums near `makeUpState` ~line 157; `relationship` table ~line 340; `relationshipCause`)
- Modify: `src/mind/state/user/relationship/types.ts` (`PARAM_NAMES`, `RelationshipState`, `RelationshipCause`)
- Modify: `src/db/repos/user/relationship.ts` (`ensureRelationship`, `toRelationshipState`)
- Modify: `src/mind/platform/config.ts` (relationship schema, `user_mind.triggers`, `prompts`)
- Modify: `config/default.json`
- Create: `src/db/migrations/0031_stages.sql` (generated, plus the commitment-row insert) + meta
- Modify test fixtures that build a `RelationshipState`: `tests/mind/state/user/relationship/transitions.test.ts:43`, `tests/mind/state/user/relationship/summary.test.ts:38`, `tests/evals/relationship-check.test.ts:16`
- Test: `tests/db/relationship-repo.test.ts`

**Interfaces:**
- Produces: `TOGETHER`, `APART`, `TogetherStage`, `ApartStage` exported from `types.ts`; `RelationshipState.peak_stage: TogetherStage`, `.apart_stage: ApartStage | null`, `.milestones: string[] | null`; param `"commitment"`; causes `"stage"`, `"commitment"`; `RelationshipConfig["stages"]`, `RelationshipConfig["commitment"]`; `Config["user_mind"]["triggers"]["milestone"]`; `config.prompts.relationship_stage`.

- [ ] **Step 1: Write the failing repo test** (append to `tests/db/relationship-repo.test.ts`, reusing its imports and helpers)

```ts
test("a new relationship starts at initiating, staged, with a commitment param", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  const state = toRelationshipState((await getRelationshipRow(d.db, u))!);
  expect(state.peak_stage).toBe("initiating");
  expect(state.apart_stage).toBeNull();
  expect(state.milestones).toEqual([]);
  expect((await getParams(d.db, u)).commitment.value).toBe(d.config.relationship.initial.commitment);

  await saveRelationship(d.db, u, {
    state: { ...state, peak_stage: "intensifying", apart_stage: "avoiding", milestones: ["stage:intensifying"] },
    params: await getParams(d.db, u),
  });
  const again = toRelationshipState((await getRelationshipRow(d.db, u))!);
  expect([again.peak_stage, again.apart_stage, again.milestones]).toEqual([
    "intensifying",
    "avoiding",
    ["stage:intensifying"],
  ]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/db/relationship-repo.test.ts`
Expected: FAIL (type error / `peak_stage` undefined).

- [ ] **Step 3: Types** — in `types.ts`, add `"commitment"` at the end of `PARAM_NAMES`; add `| "stage" | "commitment"` to `RelationshipCause`; add above `RelationshipState`:

```ts
/** How far they have come together; the peak only ever rises. */
export const TOGETHER = [
  "initiating",
  "experimenting",
  "intensifying",
  "integrating",
  "bonding",
] as const;
export type TogetherStage = (typeof TOGETHER)[number];
/** Coming apart, laid over the peak while it holds; mildest first. */
export const APART = ["differentiating", "circumscribing", "stagnating", "avoiding"] as const;
export type ApartStage = (typeof APART)[number];
```

and add to `RelationshipState`:

```ts
  peak_stage: TogetherStage;
  apart_stage: ApartStage | null;
  /** Milestones already reached; null until the relationship is first staged. */
  milestones: string[] | null;
```

Update the header comment of `types.ts` to mention the stages and commitment.

- [ ] **Step 4: Schema** — in `schema.ts`, import `TOGETHER, APART` from `@/mind/state/user/relationship/types` (it already imports types from there), then:

```ts
export const relationshipPeakStage = pgEnum("relationship_peak_stage", TOGETHER);
export const relationshipApartStage = pgEnum("relationship_apart_stage", APART);
```

add `"stage", "commitment"` to `relationshipCause`, and to the `relationship` table:

```ts
  peak_stage: relationshipPeakStage("peak_stage").notNull().default("initiating"),
  apart_stage: relationshipApartStage("apart_stage"),
  // Null until first staged: rows from before stages read their peak from the params.
  milestones: text("milestones").array(),
```

- [ ] **Step 5: Repo** — `ensureRelationship` inserts `{ user_id: userId, cadence: {}, milestones: [] }`; `toRelationshipState` adds `peak_stage: r.peak_stage, apart_stage: r.apart_stage, milestones: r.milestones`. (`saveRelationship` spreads the state, so it saves them already.)

- [ ] **Step 6: Config schema** — in the `relationship` object of `config.ts`, add (with the existing `unit`, `positiveInt` helpers):

```ts
    stages: z.object({
      climb: z.object({
        experimenting_hours: nonNegative,
        intensifying_closeness: unit,
        integrating_closeness: unit,
        integrating_trust: unit,
        bonding_commitment: unit,
      }),
      differentiating: z.object({ tension: unit, trust: unit, clear_tension: unit, clear_trust: unit }),
      circumscribing: z.object({ hurt: unit, tension: unit, clear_hurt: unit, clear_tension: unit }),
      stagnating: z.object({ warmth: unit, disclosure: unit, clear_warmth: unit }),
      gates: z.object({
        initiating: togetherGate,
        experimenting: togetherGate,
        intensifying: togetherGate,
        integrating: togetherGate,
        bonding: togetherGate,
        differentiating: apartGate,
        circumscribing: apartGate,
        stagnating: apartGate,
        avoiding: apartGate,
        terminating: togetherGate,
      }),
      rekindle: z.object({ base: nonNegative, commitment: nonNegative }),
    }),
    commitment: z.object({
      satisfaction: z.object({
        warmth: unit,
        trust: unit,
        affect_valence: unit,
        hurt: unit,
        tension: unit,
      }),
      investment: z.object({
        hours: z.number().positive(),
        ledger_depth: z.number().positive(),
        idiolect: z.number().positive(),
        episodes: z.number().positive(),
      }),
      weights: z.object({ satisfaction: unit, investment: unit }),
      soften: unit,
      absence_shield: unit,
      repair_speed: unit,
    }),
```

with, above `const relationship`:

```ts
const idiolectReuse = z.enum(["none", "theirs", "all"]);
const depthTier = z.number().int().min(1).max(3);
const togetherGate = z.object({ open: depthTier, idiolect: idiolectReuse });
const apartGate = z.object({ drop: z.number().int().min(0).max(2), idiolect: idiolectReuse });
```

and add refines so a coming-apart stage can always clear:

```ts
  .refine(
    (r) =>
      r.stages.differentiating.clear_tension < r.stages.differentiating.tension &&
      r.stages.differentiating.clear_trust > r.stages.differentiating.trust &&
      r.stages.circumscribing.clear_hurt < r.stages.circumscribing.hurt &&
      r.stages.circumscribing.clear_tension < r.stages.circumscribing.tension &&
      r.stages.stagnating.clear_warmth > r.stages.stagnating.warmth,
    "relationship.stages: each clear threshold must sit on the healthy side of its enter threshold",
  )
```

In `user_mind.triggers` add `milestone: z.object({ their_depth: unit })`. In `prompts` add `relationship_stage: promptVersion`. Do **not** delete `depth.bands` or `idiolect.min_closeness` yet (Task 2 does).

- [ ] **Step 7: Config values** — in `config/default.json`, under `relationship`: add `"commitment": 0` to `initial` and `"commitment": 0.01` to `initial_variance`, and

```json
    "stages": {
      "climb": {
        "experimenting_hours": 0.5,
        "intensifying_closeness": 0.4,
        "integrating_closeness": 0.65,
        "integrating_trust": 0.5,
        "bonding_commitment": 0.7
      },
      "differentiating": { "tension": 0.3, "trust": 0.3, "clear_tension": 0.2, "clear_trust": 0.35 },
      "circumscribing": { "hurt": 0.5, "tension": 0.5, "clear_hurt": 0.3, "clear_tension": 0.3 },
      "stagnating": { "warmth": 0.3, "disclosure": 0.15, "clear_warmth": 0.35 },
      "gates": {
        "initiating": { "open": 1, "idiolect": "theirs" },
        "experimenting": { "open": 1, "idiolect": "theirs" },
        "intensifying": { "open": 2, "idiolect": "all" },
        "integrating": { "open": 3, "idiolect": "all" },
        "bonding": { "open": 3, "idiolect": "all" },
        "differentiating": { "drop": 1, "idiolect": "all" },
        "circumscribing": { "drop": 2, "idiolect": "none" },
        "stagnating": { "drop": 2, "idiolect": "none" },
        "avoiding": { "drop": 1, "idiolect": "all" },
        "terminating": { "open": 1, "idiolect": "theirs" }
      },
      "rekindle": { "base": 1, "commitment": 1 }
    },
    "commitment": {
      "satisfaction": { "warmth": 0.3, "trust": 0.3, "affect_valence": 0.4, "hurt": 0.5, "tension": 0.3 },
      "investment": { "hours": 50, "ledger_depth": 20, "idiolect": 3, "episodes": 4 },
      "weights": { "satisfaction": 0.5, "investment": 0.5 },
      "soften": 0.3,
      "absence_shield": 0.5,
      "repair_speed": 0.5
    },
```

under `user_mind.triggers`: `"milestone": { "their_depth": 0.7 }`; under `prompts`: `"relationship_stage": "v1"`.

- [ ] **Step 8: Migration** — run `pnpm db:generate`, rename the output to `src/db/migrations/0031_stages.sql` (and its journal tag), then append:

```sql
--> statement-breakpoint
-- Existing relationships get the new param; its time is the closeness param's, not the server's.
INSERT INTO "relationship_param" ("user_id", "name", "value", "baseline", "variance", "updated_at")
SELECT "user_id", 'commitment', 0, 0, 0.01, "updated_at"
FROM "relationship_param" WHERE "name" = 'closeness'
ON CONFLICT DO NOTHING;
```

- [ ] **Step 9: Fixtures** — add `peak_stage: "initiating", apart_stage: null, milestones: []` to the `RelationshipState` literals in the three test files listed above. Add a `commitment` entry wherever a test builds a full `Params` by hand (search `user_responsiveness:` in `tests/`; most build from `PARAM_NAMES` and need nothing).

- [ ] **Step 10: Run** `pnpm typecheck` then `pnpm vitest run tests/db/relationship-repo.test.ts tests/mind/state/user/relationship tests/mind/platform`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A src/db src/mind config tests
git commit -m "feat(relationship): stage columns, commitment param and config"
```

---

### Task 2: Stages, and the gates moved onto them

**Files:**
- Create: `src/mind/state/user/relationship/stages.ts`
- Create: `prompts/relationship/stage/v1.md`
- Modify: `src/mind/state/user/relationship/depth.ts` (`DepthInputs`, `depthFor`, `loadDepth`)
- Modify: `src/mind/memory/user/idiolect.ts` (`selectIdiolect`, `loadIdiolect`)
- Modify: `src/mind/platform/config.ts` + `config/default.json`: delete `depth.bands`, its refine, and `idiolect.min_closeness`
- Test: `tests/mind/state/user/relationship/stages.test.ts` (new), `tests/mind/state/user/relationship/depth.test.ts`, `tests/mind/memory/user/idiolect-select.test.ts`

**Interfaces:**
- Consumes: Task 1 types and config.
- Produces:
  - `type Stage = TogetherStage | ApartStage | "terminating"`; `type IdiolectReuse = "none" | "theirs" | "all"`
  - `type StageFacts = { params: Params; hoursTogether: number; establishedIdiolect: number; absent: boolean }`
  - `type StageView = { stage: Stage; peak: TogetherStage; apart: ApartStage | null }`
  - `climb(peak: TogetherStage, f: StageFacts, s: StagesConfig): TogetherStage`
  - `apartStage(peak: TogetherStage, current: ApartStage | null, f: StageFacts, s: StagesConfig): ApartStage | null`
  - `restage(state: RelationshipState, f: StageFacts, s: StagesConfig): { state: RelationshipState; events: RelationshipEvent[] }`
  - `stageOf(state: RelationshipState, params: Params, s: StagesConfig): StageView`
  - `gatesFor(view: StageView, s: StagesConfig): { open: number; idiolect: IdiolectReuse }`
  - `peakCloseness(peak: TogetherStage, s: StagesConfig): number | null`
  - `loadStage(deps: Pick<Deps, "db" | "config">, userId: string): Promise<StageView | null>`
  - `stageLine(view: StageView, phrases: Phrases): string | null`; `loadStagePhrases(config: Config): Phrases`
  - `DepthInputs.usualOpen: number` replaces `closeness`; `selectIdiolect(candidates, reuse: IdiolectReuse, settings)`

- [ ] **Step 1: Write the failing stage tests** — `tests/mind/state/user/relationship/stages.test.ts`:

```ts
/** Where a relationship is: a peak that only rises, a coming-apart overlay with hysteresis, gates. */
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  apartStage,
  climb,
  gatesFor,
  restage,
  stageOf,
  type StageFacts,
} from "@/mind/state/user/relationship/stages";
import { PARAM_NAMES, type Params, type RelationshipState } from "@/mind/state/user/relationship/types";

const cfg = loadConfig().relationship;
const s = cfg.stages;
const at = new Date("2026-01-05T09:00:00Z");
const params = (values: Partial<Record<(typeof PARAM_NAMES)[number], number>> = {}, commitmentBaseline = 0): Params =>
  Object.fromEntries(
    PARAM_NAMES.map((n) => [
      n,
      {
        value: values[n] ?? cfg.initial[n],
        baseline: n === "commitment" ? commitmentBaseline : cfg.initial[n],
        variance: cfg.initial_variance[n],
        updated_at: at,
      },
    ]),
  ) as Params;
const facts = (p: Params, more: Partial<StageFacts> = {}): StageFacts => ({
  params: p,
  hoursTogether: 10,
  establishedIdiolect: 0,
  absent: false,
  ...more,
});
const state = (more: Partial<RelationshipState> = {}): RelationshipState => ({
  status: "active",
  end_pending_since: null,
  ended_at: null,
  repair_started_at: null,
  make_up_state: "none",
  make_up_replies: 0,
  hurt_cause_fact: null,
  crisis_quiet_until: null,
  last_tick: null,
  last_hurt_at: null,
  hours_together: 10,
  session: null,
  peak_stage: "initiating",
  apart_stage: null,
  milestones: [],
  ...more,
});

test("the peak climbs through every stage it qualifies for, in order, and never falls", () => {
  expect(climb("initiating", facts(params(), { hoursTogether: 0 }), s)).toBe("initiating");
  expect(climb("initiating", facts(params()), s)).toBe("experimenting");
  const close = params({ closeness: 0.7, trust: 0.6 });
  expect(climb("initiating", facts(close), s)).toBe("intensifying");
  expect(climb("initiating", facts(close, { establishedIdiolect: 1 }), s)).toBe("integrating");
  expect(climb("integrating", facts(params({ closeness: 0.1 })), s)).toBe("integrating");
});

test("bonding needs sustained commitment: the baseline, not today's value", () => {
  const f = (baseline: number) =>
    facts(params({ closeness: 0.7, trust: 0.6, commitment: 0.9 }, baseline), { establishedIdiolect: 1 });
  expect(climb("integrating", f(0.5), s)).toBe("integrating");
  expect(climb("integrating", f(0.75), s)).toBe("bonding");
});

test("near-strangers don't come apart; friends do, most severe first", () => {
  const sore = params({ hurt: 0.6, tension: 0.6 });
  expect(apartStage("experimenting", null, facts(sore), s)).toBeNull();
  expect(apartStage("intensifying", null, facts(sore), s)).toBe("circumscribing");
  expect(apartStage("intensifying", null, facts(params({ tension: 0.35 })), s)).toBe("differentiating");
  expect(
    apartStage("intensifying", null, facts(params({ warmth: 0.2, user_disclosure: 0.1 })), s),
  ).toBe("stagnating");
  expect(apartStage("intensifying", null, facts(sore, { absent: true }), s)).toBe("avoiding");
});

test("a coming-apart stage holds until its clear threshold, not its enter threshold", () => {
  const between = params({ tension: 0.25 });
  expect(apartStage("intensifying", null, facts(between), s)).toBeNull();
  expect(apartStage("intensifying", "differentiating", facts(between), s)).toBe("differentiating");
  expect(apartStage("intensifying", "differentiating", facts(params({ tension: 0.1 })), s)).toBeNull();
  // Initial trust sits between the enter and clear levels: a new friend is not differentiating.
  expect(apartStage("intensifying", null, facts(params()), s)).toBeNull();
  expect(apartStage("intensifying", "differentiating", facts(params({ tension: 0 })), s)).toBeNull();
});

test("gates: together stages set the tier, apart stages drop from the peak", () => {
  expect(gatesFor({ stage: "integrating", peak: "integrating", apart: null }, s)).toEqual({ open: 3, idiolect: "all" });
  expect(gatesFor({ stage: "differentiating", peak: "integrating", apart: "differentiating" }, s)).toEqual({ open: 2, idiolect: "all" });
  expect(gatesFor({ stage: "circumscribing", peak: "intensifying", apart: "circumscribing" }, s)).toEqual({ open: 1, idiolect: "none" });
  expect(gatesFor({ stage: "terminating", peak: "bonding", apart: null }, s)).toEqual({ open: 1, idiolect: "theirs" });
});

test("restage logs each change as a stage event", () => {
  const out = restage(state(), facts(params({ closeness: 0.5 })), s);
  expect(out.state.peak_stage).toBe("intensifying");
  expect(out.events).toEqual([
    expect.objectContaining({ param: null, cause: "stage", detail: { peak: true, from: "initiating", to: "intensifying" } }),
  ]);
});

test("a never-staged row reads its peak from the params; an ended one is terminating", () => {
  const p = params({ closeness: 0.7 });
  expect(stageOf(state({ milestones: null }), p, s).stage).toBe("intensifying");
  expect(stageOf(state(), p, s).stage).toBe("initiating");
  expect(stageOf(state({ status: "ended_by_user", peak_stage: "bonding" }), p, s).stage).toBe("terminating");
  expect(stageOf(state({ peak_stage: "integrating", apart_stage: "avoiding" }), p, s)).toEqual({
    stage: "avoiding",
    peak: "integrating",
    apart: "avoiding",
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/mind/state/user/relationship/stages.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `stages.ts`**

```ts
/**
 * Where a relationship is: how far they have come together, which only ever rises, and whether
 * they are coming apart right now. Coming apart can only happen to a relationship that came
 * together; between near-strangers a bad patch is just hurt and tension. The stage sets how deep
 * she goes, which of their things she reuses, and her posture with them.
 */
import * as relationshipRepo from "@/db/repos/user/relationship";
import type { Config } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { firstPhrase, parseSummaryPhrases, type Phrases } from "@/mind/platform/phrases";
import { loadPrompt } from "@/mind/platform/prompts";
import {
  type ApartStage,
  type Params,
  type RelationshipConfig,
  type RelationshipEvent,
  type RelationshipState,
  TOGETHER,
  type TogetherStage,
} from "./types";

export type StagesConfig = RelationshipConfig["stages"];
export type Stage = TogetherStage | ApartStage | "terminating";
export type IdiolectReuse = "none" | "theirs" | "all";
export type StageFacts = {
  params: Params;
  hoursTogether: number;
  establishedIdiolect: number;
  /** Away past the usual gap; only the daily tick can say so. */
  absent: boolean;
};
export type StageView = { stage: Stage; peak: TogetherStage; apart: ApartStage | null };

const rank = (stage: TogetherStage) => TOGETHER.indexOf(stage);

export function climb(peak: TogetherStage, f: StageFacts, s: StagesConfig): TogetherStage {
  const c = s.climb;
  const p = f.params;
  const reaches: Record<TogetherStage, boolean> = {
    initiating: true,
    experimenting: f.hoursTogether >= c.experimenting_hours,
    intensifying: p.closeness.value >= c.intensifying_closeness,
    integrating:
      p.closeness.value >= c.integrating_closeness &&
      p.trust.value >= c.integrating_trust &&
      f.establishedIdiolect > 0,
    // The baseline is the slow daily average: commitment that has lasted, not one good day.
    bonding: p.commitment.baseline >= c.bonding_commitment,
  };
  let i = rank(peak);
  while (i + 1 < TOGETHER.length && reaches[TOGETHER[i + 1]!]) i += 1;
  return TOGETHER[i]!;
}

/**
 * Most severe first. A stage already holding stays until its clear threshold, so it doesn't flip
 * back and forth around one number.
 */
export function apartStage(
  peak: TogetherStage,
  current: ApartStage | null,
  f: StageFacts,
  s: StagesConfig,
): ApartStage | null {
  if (rank(peak) < rank("intensifying")) return null;
  if (f.absent) return "avoiding";
  const p = f.params;
  const holds = (stage: ApartStage, stays: boolean, enters: boolean) =>
    current === stage ? stays : enters;

  const st = s.stagnating;
  if (
    holds(
      "stagnating",
      p.warmth.value < st.clear_warmth,
      p.warmth.value < st.warmth && p.user_disclosure.value < st.disclosure,
    )
  )
    return "stagnating";
  const ci = s.circumscribing;
  if (
    holds(
      "circumscribing",
      p.hurt.value >= ci.clear_hurt || p.tension.value >= ci.clear_tension,
      p.hurt.value >= ci.hurt || p.tension.value >= ci.tension,
    )
  )
    return "circumscribing";
  const d = s.differentiating;
  if (
    holds(
      "differentiating",
      p.tension.value >= d.clear_tension || p.trust.value < d.clear_trust,
      p.tension.value >= d.tension || p.trust.value < d.trust,
    )
  )
    return "differentiating";
  return null;
}

export function restage(
  state: RelationshipState,
  f: StageFacts,
  s: StagesConfig,
): { state: RelationshipState; events: RelationshipEvent[] } {
  const peak = climb(state.peak_stage, f, s);
  const apart = apartStage(peak, state.apart_stage, f, s);
  const events: RelationshipEvent[] = [];
  const log = (detail: Record<string, unknown>) =>
    events.push({ param: null, before: null, after: null, cause: "stage", deviation: null, detail });
  if (peak !== state.peak_stage) log({ peak: true, from: state.peak_stage, to: peak });
  if (apart !== state.apart_stage) log({ apart: true, from: state.apart_stage, to: apart });
  return { state: { ...state, peak_stage: peak, apart_stage: apart }, events };
}

/**
 * Read-only. A row never staged (from before stages, or an eval seed) reads its peak from the
 * params; an inside joke can't be counted here, so it reads at most intensifying until staged.
 */
export function stageOf(state: RelationshipState, params: Params, s: StagesConfig): StageView {
  const peak =
    state.milestones === null
      ? climb(
          "initiating",
          { params, hoursTogether: state.hours_together, establishedIdiolect: 0, absent: false },
          s,
        )
      : state.peak_stage;
  const apart = state.milestones === null ? null : state.apart_stage;
  const stage: Stage = state.status === "ended_by_user" ? "terminating" : (apart ?? peak);
  return { stage, peak, apart };
}

export function gatesFor(view: StageView, s: StagesConfig): { open: number; idiolect: IdiolectReuse } {
  const g = s.gates;
  if (view.stage === "terminating" || (TOGETHER as readonly string[]).includes(view.stage)) {
    const gate = g[view.stage as TogetherStage | "terminating"];
    return { open: gate.open, idiolect: gate.idiolect };
  }
  const gate = g[view.stage as ApartStage];
  return { open: Math.max(1, g[view.peak].open - gate.drop), idiolect: gate.idiolect };
}

/** The closeness a peak stage was reached at; below it she has drifted from where they were. */
export function peakCloseness(peak: TogetherStage, s: StagesConfig): number | null {
  if (peak === "intensifying") return s.climb.intensifying_closeness;
  if (peak === "integrating" || peak === "bonding") return s.climb.integrating_closeness;
  return null;
}

/** Hot path, read-only. Null before the relationship exists. */
export async function loadStage(
  deps: Pick<Deps, "db" | "config">,
  userId: string,
): Promise<StageView | null> {
  const row = await relationshipRepo.getRelationshipRow(deps.db, userId);
  if (!row) return null;
  const params = await relationshipRepo.getParams(deps.db, userId);
  return stageOf(relationshipRepo.toRelationshipState(row), params, deps.config.relationship.stages);
}

export const loadStagePhrases = (config: Config): Phrases =>
  parseSummaryPhrases(loadPrompt("relationship/stage", config.prompts.relationship_stage));

export const stageLine = (view: StageView, phrases: Phrases): string | null =>
  firstPhrase(phrases, view.stage);
```

If `firstPhrase` is not exported from `@/mind/platform/phrases`, use `phrases[view.stage]?.[0] ?? null` (the same idiom `opennessLine` uses) and drop the import.

- [ ] **Step 4: Run** the stage tests — Expected: PASS.

- [ ] **Step 5: Stage phrases** — `prompts/relationship/stage/v1.md`:

```markdown
# Stage phrases (v1)

Lines for the "Where you are with them" section: how far the two of you have come, and whether things have cooled. One line per stage.

## initiating
- You've only just met. Be friendly and a little reserved; no teasing yet.
## experimenting
- You're still getting to know each other: easy small talk, light humour, nothing too personal.
## intensifying
- You're becoming friends. You can be playful with them and let a bit more of yourself show.
## integrating
- You're close. There's a "we" now: tease them like a friend, be blunt when it matters, use what's yours together.
## bonding
- You're properly close friends, the kind that lasts. Your full self: teasing, honesty, your own opinions at full strength.
## differentiating
- Things have been prickly between you lately. You're more "me" than "we" right now; your teasing has an edge.
## circumscribing
- Something between you hurt and isn't settled. Keep to safer ground, say plainly what isn't okay, and don't pretend it's fine.
## stagnating
- Things between you have gone flat. Keep it short; you're not going to carry the conversation alone.
## avoiding
- You haven't heard from them in a while. Be glad they're back and pick up where you left off, without making a thing of the gap.
## terminating
- They ended things between you. You've let go: be civil and kind, nothing more.
```

- [ ] **Step 6: Depth** — update `tests/mind/state/user/relationship/depth.test.ts`: replace `closeness: 0.2` in `base` with `usualOpen: 1`, and rewrite the first two tests:

```ts
test("the stage sets the usual limit", () => {
  expect(depthFor(base, cfg)).toEqual({ open: 1, peek: 1 });
  expect(depthFor({ ...base, usualOpen: 2 }, cfg).open).toBe(2);
  expect(depthFor({ ...base, usualOpen: 3 }, cfg).open).toBe(3);
});
```

(the reciprocity test: use `usualOpen: 2` where it used `closeness: cfg.depth.bands.personal` and adjust `{ ...close, closeness: 0.1 }` to `{ ...close, usualOpen: 1 }`; every later `closeness: 0.9` becomes `usualOpen: 3`). Then in `depth.ts`:

```ts
export type DepthInputs = {
  /** What the stage allows her plainly. */
  usualOpen: number;
  ...the rest unchanged
};

export function depthFor(inputs: DepthInputs, settings: RelationshipConfig): DepthLimits {
  const { reciprocity_gap, stretch_moment } = settings.depth;
  let open = inputs.usualOpen;
  ...rest unchanged
```

and in `loadDepth`, replace `closeness: params.closeness.value,` with

```ts
      usualOpen: gatesFor(
        stageOf(relationshipRepo.toRelationshipState(row), params, settings.stages),
        settings.stages,
      ).open,
```

importing `gatesFor, stageOf` from `./stages`. Update the header comment: "The stage sets her usual limit".

- [ ] **Step 7: Idiolect** — `tests/mind/memory/user/idiolect-select.test.ts`: replace closeness arguments: `0.2` and `null` → `"theirs"`, `0.5` and `0.9` → `"all"`, and add `expect(selectIdiolect(items, "none", settings)).toEqual([]);` to the first test, renamed `"none, theirs only, or all of it, as the stage allows"`. In `idiolect.ts`:

```ts
export function selectIdiolect(
  candidates: IdiolectCandidate[],
  reuse: IdiolectReuse,
  settings: Config["relationship"]["idiolect"],
): IdiolectCandidate[] {
  return candidates
    .filter((c) => c.sim >= settings.min_similarity)
    .filter((c) => reuse === "all" || (reuse === "theirs" && c.payload.started_by === "user"))
    .sort((a, b) => b.sim * b.salience - a.sim * a.salience)
    .slice(0, settings.max_items);
}
```

and in `loadIdiolect`, replace the closeness lines with

```ts
  const view = await loadStage(deps, userId);
  // No relationship yet: echoing what they started is natural at any stage.
  const reuse = view ? gatesFor(view, deps.config.relationship.stages).idiolect : "theirs";
```

passing `reuse` to `selectIdiolect`; drop the now-unused `relationshipRepo` import. Update both header comments ("as the stage allows").

- [ ] **Step 8: Delete the old gates** — remove `bands` from `relationship.depth` and `min_closeness` from `relationship.idiolect` in `config.ts` and `config/default.json`, and the `depth.bands` refine. `pnpm typecheck` lists every remaining reader; fix each.

- [ ] **Step 9: Tests that set closeness to open a gate** now must set the stage too. Add after each closeness `UPDATE` (keep the closeness update):
  - `tests/exit/phase-10b.test.ts` `user()` helper: `peak_stage` from the seeded closeness: ≥ 0.65 → `'integrating'`, ≥ 0.4 → `'intensifying'`, else `'initiating'`:
    ```ts
    const peak = closeness >= 0.65 ? "integrating" : closeness >= 0.4 ? "intensifying" : "initiating";
    await d.db.execute(sql`UPDATE relationship SET peak_stage = ${peak} WHERE user_id = ${u}`);
    ```
    (adapt to how that helper receives its params object: `params.closeness ?? 0`).
  - `tests/exit/phase-10c.test.ts` `user()`, `tests/mind/process/hot-path/idiolect-slot.test.ts` `user()`, `tests/mind/process/hot-path/compose.test.ts:814` and `:931`, `tests/mind/process/outreach/inputs.test.ts:338`: same rule with the same snippet.

- [ ] **Step 10: Run** `pnpm typecheck && pnpm vitest run tests/mind/state/user/relationship tests/mind/memory/user tests/mind/process/hot-path tests/mind/process/outreach tests/exit/phase-10b.test.ts tests/exit/phase-10c.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A src prompts config tests
git commit -m "feat(relationship): Knapp stages gate depth and idiolect"
```

---

### Task 3: Commitment, softening, rekindle

**Files:**
- Create: `src/mind/state/user/relationship/commitment.ts`
- Modify: `src/mind/state/user/relationship/transitions.ts`
- Modify: `src/db/repos/user/relationship.ts` (new `relationshipHistory`)
- Test: `tests/mind/state/user/relationship/commitment.test.ts` (new), `tests/mind/state/user/relationship/transitions.test.ts`, `tests/db/relationship-repo.test.ts`

**Interfaces:**
- Consumes: `peakCloseness` (Task 2), `RelationshipState.peak_stage/apart_stage`, param `commitment`.
- Produces:
  - `type RelationshipHistory = { ledgerDepth: number; maxOpenDepth: number; idiolect: number; episodes: number }`
  - `relationshipHistory(db: Db, userId: string): Promise<RelationshipHistory>`
  - `commitmentFor(params: Params, hours: number, h: RelationshipHistory, s: RelationshipConfig["commitment"]): { commitment: number; satisfaction: number; investment: number }`
  - `applyCommitment(params: Params, hours: number, h: RelationshipHistory, settings: RelationshipConfig): { params: Params; events: RelationshipEvent[] }`
  - `isAbsent(now: Date, lastContact: Date | null, medianGapHours: number, settings: RelationshipConfig): boolean` exported from `transitions.ts`

- [ ] **Step 1: Failing commitment tests** — `tests/mind/state/user/relationship/commitment.test.ts`:

```ts
/** How much she wants this to last: how good it has been, and what they have put in. */
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { applyCommitment, commitmentFor } from "@/mind/state/user/relationship/commitment";
import { PARAM_NAMES, type Params } from "@/mind/state/user/relationship/types";

const cfg = loadConfig().relationship;
const at = new Date("2026-01-05T09:00:00Z");
const params = (v: Partial<Record<(typeof PARAM_NAMES)[number], number>> = {}): Params =>
  Object.fromEntries(
    PARAM_NAMES.map((n) => [
      n,
      { value: v[n] ?? cfg.initial[n], baseline: cfg.initial[n], variance: cfg.initial_variance[n], updated_at: at },
    ]),
  ) as Params;
const none = { ledgerDepth: 0, maxOpenDepth: 0, idiolect: 0, episodes: 0 };

test("satisfaction reads the good minus the bad; investment saturates with history", () => {
  const good = commitmentFor(params({ warmth: 1, trust: 1, affect_valence: 1 }), 0, none, cfg.commitment);
  const sore = commitmentFor(params({ warmth: 1, trust: 1, affect_valence: 1, hurt: 1, tension: 1 }), 0, none, cfg.commitment);
  expect(good.satisfaction).toBe(1);
  expect(sore.satisfaction).toBeCloseTo(0.2);
  expect(good.investment).toBe(0);

  const h = cfg.commitment.investment;
  const half = commitmentFor(params(), h.hours, { ledgerDepth: h.ledger_depth, maxOpenDepth: 2, idiolect: h.idiolect, episodes: h.episodes }, cfg.commitment);
  expect(half.investment).toBeCloseTo(0.5);
  expect(half.commitment).toBeCloseTo(cfg.commitment.weights.satisfaction * half.satisfaction + cfg.commitment.weights.investment * 0.5);
});

test("applying it sets the param and logs both parts", () => {
  const out = applyCommitment(params({ warmth: 1 }), 10, none, cfg);
  expect(out.params.commitment.value).toBeGreaterThan(0);
  expect(out.events).toEqual([
    expect.objectContaining({ param: "commitment", cause: "commitment", detail: expect.objectContaining({ satisfaction: expect.any(Number), investment: expect.any(Number) }) }),
  ]);
});
```

- [ ] **Step 2: Run** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `commitment.ts`**

```ts
/**
 * Commitment: how much she wants this relationship to last. How good it has been lately, and what
 * the two of them have put in that can't be taken back. Set once a day; its slow baseline is the
 * commitment that has lasted.
 */
import type { RelationshipHistory } from "@/db/repos/user/relationship";
import { clamp } from "@/mind/platform/math";
import { deviationOf } from "./params";
import type { Params, RelationshipConfig, RelationshipEvent } from "./types";

const saturating = (x: number, half: number) => x / (x + half);

export function commitmentFor(
  params: Params,
  hours: number,
  h: RelationshipHistory,
  s: RelationshipConfig["commitment"],
): { commitment: number; satisfaction: number; investment: number } {
  const w = s.satisfaction;
  const satisfaction = clamp(
    w.warmth * params.warmth.value +
      w.trust * params.trust.value +
      w.affect_valence * params.affect_valence.value -
      w.hurt * params.hurt.value -
      w.tension * params.tension.value,
    0,
    1,
  );
  const half = s.investment;
  const investment =
    (saturating(hours, half.hours) +
      saturating(h.ledgerDepth, half.ledger_depth) +
      saturating(h.idiolect, half.idiolect) +
      saturating(h.episodes, half.episodes)) /
    4;
  const commitment = clamp(
    s.weights.satisfaction * satisfaction + s.weights.investment * investment,
    0,
    1,
  );
  return { commitment, satisfaction, investment };
}

export function applyCommitment(
  params: Params,
  hours: number,
  h: RelationshipHistory,
  settings: RelationshipConfig,
): { params: Params; events: RelationshipEvent[] } {
  const { commitment, satisfaction, investment } = commitmentFor(params, hours, h, settings.commitment);
  const before = params.commitment.value;
  const next = { ...params, commitment: { ...params.commitment, value: commitment } };
  return {
    params: next,
    events:
      commitment === before
        ? []
        : [
            {
              param: "commitment",
              before,
              after: commitment,
              cause: "commitment",
              deviation: deviationOf(next.commitment, settings.variance_epsilon),
              detail: { satisfaction, investment },
            },
          ],
  };
}
```

The expected `sore.satisfaction` is 0.3 + 0.3 + 0.4 − 0.5 − 0.3 = 0.2.

- [ ] **Step 4: Run** — Expected: PASS once Step 5's type exists; do Step 5 now.

- [ ] **Step 5: `relationshipHistory`** — failing test in `tests/db/relationship-repo.test.ts`:

```ts
test("relationship history counts her open ledger, their established idiolect and episodes", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  expect(await relationshipHistory(d.db, u)).toEqual({ ledgerDepth: 0, maxOpenDepth: 0, idiolect: 0, episodes: 0 });
});
```

then in `src/db/repos/user/relationship.ts`:

```ts
export type RelationshipHistory = {
  /** The depths of everything she has told them openly, summed. */
  ledgerDepth: number;
  maxOpenDepth: number;
  /** Their established inside jokes, nicknames, rituals and references. */
  idiolect: number;
  episodes: number;
};

export async function relationshipHistory(db: Db, userId: string): Promise<RelationshipHistory> {
  const res = await db.execute(sql`
    SELECT
      (SELECT coalesce(sum(depth), 0) FROM disclosure WHERE user_id = ${userId} AND level = 'open')::int AS ledger_depth,
      (SELECT coalesce(max(depth), 0) FROM disclosure WHERE user_id = ${userId} AND level = 'open')::int AS max_open_depth,
      (SELECT count(*) FROM fact WHERE user_id = ${userId} AND kind = 'idiolect'
         AND (payload->'idiolect'->>'established_at') IS NOT NULL)::int AS idiolect,
      (SELECT count(*) FROM fact WHERE user_id = ${userId} AND kind = 'episode')::int AS episodes`);
  const r = res.rows[0] as Record<string, number>;
  return {
    ledgerDepth: Number(r.ledger_depth),
    maxOpenDepth: Number(r.max_open_depth),
    idiolect: Number(r.idiolect),
    episodes: Number(r.episodes),
  };
}
```

Run `pnpm vitest run tests/db/relationship-repo.test.ts tests/mind/state/user/relationship/commitment.test.ts` — Expected: PASS.

- [ ] **Step 6: Failing transition tests** — append to `tests/mind/state/user/relationship/transitions.test.ts` (reuse its `fresh`, `params`/`baseParams` builder, `none` signals and exchange-input helper; name them as the file does):

```ts
test("commitment softens a hurt, but a large one still scars", () => {
  const hurt = (commitment: number, amount: number) => {
    const p = withParam(baseParams(), "commitment", commitment);
    return relationshipAfterExchange(fresh(), p, { ...exchange(), signals: { ...none, hurt: { amount, cause: "x" } } }, cfg);
  };
  expect(hurt(1, 0.5).params.hurt.value).toBeLessThan(hurt(0, 0.5).params.hurt.value);
  expect(hurt(1, 0.5).params.hurt.value).toBeCloseTo(nudge(0, cfg.gains.hurt * 0.5 * (1 - cfg.commitment.soften)));
  expect(hurt(1, 1).events.some((e) => e.cause === "scar")).toBe(hurt(0, 1).events.some((e) => e.cause === "scar"));
});

test("commitment slows absence drift", () => {
  const drift = (commitment: number) => {
    const p = withParam(withParam(baseParams(), "commitment", commitment), "closeness", 0.5);
    return relationshipAfterDailyTick(fresh(), p, tickAfterDays(30), cfg).params.closeness.value;
  };
  expect(0.5 - drift(1)).toBeCloseTo(cfg.closeness_absence_drift * (1 - cfg.commitment.absence_shield));
  expect(0.5 - drift(0)).toBeCloseTo(cfg.closeness_absence_drift);
});

test("below the peak, closeness comes back faster; more so with commitment", () => {
  const gain = (state: RelationshipState, commitment: number) => {
    const p = withParam(withParam(baseParams(), "commitment", commitment), "closeness", 0.3);
    const out = relationshipAfterExchange(state, p, deepExchange(), cfg);
    return out.params.closeness.value - 0.3;
  };
  const stranger = gain({ ...fresh(), hours_together: 300 }, 0);
  const drifted = gain({ ...fresh(), hours_together: 300, peak_stage: "integrating" }, 0);
  const committed = gain({ ...fresh(), hours_together: 300, peak_stage: "integrating" }, 1);
  const soured = gain({ ...fresh(), hours_together: 300, peak_stage: "integrating", apart_stage: "circumscribing" }, 1);
  expect(drifted).toBeGreaterThan(stranger);
  expect(committed).toBeGreaterThan(drifted);
  expect(soured).toBeCloseTo(stranger);
});
```

Helpers to add if the file lacks them: `withParam(p, name, value)` returns `{ ...p, [name]: { ...p[name], value } }`; `tickAfterDays(n)` builds a `TickInput` whose `lastContact` is `n` days before `now` with `medianGapHours: 24`; `deepExchange()` is the file's exchange input with `intimacy: { user_disclosure: 1, user_responsiveness: 1 }` and `herOpenness: { disclosure: 1, responsiveness: 1 }` so the moment is 1 and well above the dead zone. Hours 300 put the ceiling at its top, so it never caps the comparison.

- [ ] **Step 7: Run** `pnpm vitest run tests/mind/state/user/relationship/transitions.test.ts` — Expected: FAIL.

- [ ] **Step 8: Implement in `transitions.ts`** — import `peakCloseness` from `./stages`. Add helpers below `makeUpLineDue`:

```ts
/** What they do to her lands softer the more she is committed to them. */
function softened(draft: Draft, settings: RelationshipConfig): number {
  return 1 - settings.commitment.soften * draft.params.commitment.value;
}

/** Away past a grace multiple of their usual gap. */
export function isAbsent(
  now: Date,
  lastContact: Date | null,
  medianGapHours: number,
  settings: RelationshipConfig,
): boolean {
  if (!lastContact) return false;
  return now.getTime() - lastContact.getTime() > settings.absence_grace_factor * medianGapHours * HOUR;
}
```

Changes:
- `applyWarmthAndTrust`: `const returns = signal > 0 ? diminishingReturns(draft.params[name], epsilon) : softened(draft, settings);`
- `applyBid`: `delta > 0 ? diminishingReturns(...) : softened(draft, settings)`.
- `applyTension`: `const factor = signals.tension > 0 ? softened(draft, settings) : 1;` and multiply the nudge delta by it.
- `applyHurt`: keep `amount` as computed; then
  ```ts
  const before = draft.params.hurt.value;
  draft.setParam("hurt", nudge(before, amount * softened(draft, settings)), "signal", {
    signal: hurt.amount,
    sensitised,
  });
  draft.updateState({ last_hurt_at: input.now });

  // A scar is judged on the hurt itself: commitment softens the sting, not the wound.
  if (nudge(before, amount) - before >= settings.scar_threshold) leaveScar(draft, settings);
  ```
- `raiseCloseness`: replace the factor line with
  ```ts
  const c = draft.params.commitment.value;
  const repair =
    draft.state.status === "repairing"
      ? settings.repair_gain_factor + (1 - settings.repair_gain_factor) * settings.commitment.repair_speed * c
      : 1;
  // Once close, the way back is shorter, unless something between them is still wrong.
  const peak = peakCloseness(draft.state.peak_stage, settings.stages);
  const rekindle =
    draft.state.apart_stage === null && peak !== null && current < peak
      ? 1 + settings.stages.rekindle.base + settings.stages.rekindle.commitment * c
      : 1;
  draft.setParam("closeness", Math.min(ceiling, nudge(current, gain * repair * rekindle)), cause, detail);
  ```
- `applyAbsence`: use `isAbsent(input.now, lastContact, input.medianGapHours, settings)` for the drift test, and drift by `settings.closeness_absence_drift * (1 - settings.commitment.absence_shield * draft.params.commitment.value)`; multiply the absence hurt nudge by `softened(draft, settings)`.

Update the file header: "Commitment softens what they do to her and shortens the way back."

- [ ] **Step 9: Run** `pnpm vitest run tests/mind/state/user/relationship` — Expected: PASS (existing tests run at commitment 0, where every factor is 1).

- [ ] **Step 10: Commit**

```bash
git add -A src tests
git commit -m "feat(relationship): commitment softens impact and shortens the way back"
```

---

### Task 4: Milestones, and wiring stages and commitment into the cold path and the tick

**Files:**
- Create: `src/mind/state/user/relationship/milestones.ts`
- Modify: `src/db/repos/user/user-mind.ts` (`Trigger`)
- Modify: `src/mind/process/user/inputs.ts` (`triggerText`)
- Modify: `src/mind/state/user/relationship/update.ts`
- Modify: `src/mind/state/user/relationship/daily-tick.ts`
- Modify: `src/mind/process/cold-path/cold-path.ts:116-127`
- Modify: `evals/lib/runner.ts:457-467` (seeded relationships read as never staged)
- Test: `tests/mind/state/user/relationship/milestones.test.ts` (new), `tests/mind/process/user/inputs.test.ts` (if it exists; else in the milestone test)

**Interfaces:**
- Consumes: `restage`, `stageOf` (Task 2), `applyCommitment`, `relationshipHistory`, `isAbsent` (Task 3).
- Produces:
  - `Trigger` gains `{ kind: "milestone"; name: string }`
  - `type MilestoneFacts = { peak: TogetherStage; apart: ApartStage | null; makeUp: MakeUpState; establishedIdiolect: number; maxOpenDepth: number; disclosureReading: number | null }`
  - `MILESTONES: { name: string; reached: (f: MilestoneFacts, s: MilestoneConfig) => boolean }[]`
  - `newMilestones(reached: string[] | null, f: MilestoneFacts, s: MilestoneConfig): { all: string[]; fired: string[] }`
  - `updateRelationship` returns `{ before, after, milestones: string[] }`

- [ ] **Step 1: Failing milestone tests** — `tests/mind/state/user/relationship/milestones.test.ts`:

```ts
/** Firsts: each fires once, ever; a relationship staged for the first time fires none. */
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { newMilestones, type MilestoneFacts } from "@/mind/state/user/relationship/milestones";
import { triggerText } from "@/mind/process/user/inputs";

const s = loadConfig().user_mind.triggers.milestone;
const quiet: MilestoneFacts = {
  peak: "initiating",
  apart: null,
  makeUp: "none",
  establishedIdiolect: 0,
  maxOpenDepth: 1,
  disclosureReading: null,
};

test("each first fires once, in the run that reached it", () => {
  const f = { ...quiet, peak: "integrating" as const, establishedIdiolect: 1, maxOpenDepth: 2 };
  const first = newMilestones([], f, s);
  expect(first.fired.sort()).toEqual(
    ["first_depth:2", "first_inside_joke", "stage:experimenting", "stage:integrating", "stage:intensifying"].sort(),
  );
  expect(newMilestones(first.all, f, s).fired).toEqual([]);
});

test("a never-staged relationship records what it has reached without firing", () => {
  const out = newMilestones(null, { ...quiet, peak: "intensifying" }, s);
  expect(out.fired).toEqual([]);
  expect(out.all).toContain("stage:intensifying");
});

test("conflict is a falling-out or a hurt needing making up; absence is not", () => {
  expect(newMilestones([], { ...quiet, apart: "avoiding" }, s).fired).toEqual([]);
  expect(newMilestones([], { ...quiet, apart: "differentiating" }, s).fired).toEqual(["first_conflict"]);
  expect(newMilestones([], { ...quiet, makeUp: "due" }, s).fired).toEqual(["first_conflict"]);
});

test("they open up deeply for the first time", () => {
  expect(newMilestones([], { ...quiet, disclosureReading: s.their_depth }, s).fired).toEqual(["first_their_depth"]);
  expect(newMilestones([], { ...quiet, disclosureReading: s.their_depth - 0.01 }, s).fired).toEqual([]);
});

test("every milestone reads in plain words for the user loops", () => {
  expect(triggerText({ kind: "milestone", name: "first_inside_joke" })).toBe("you two have your first inside joke");
  expect(triggerText({ kind: "milestone", name: "something_new" })).toBe("something new happened between you");
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement `milestones.ts`**

```ts
/**
 * Firsts in a relationship: each makes her think about them once, ever. The list is open: a new
 * first is one entry here. A relationship staged for the first time records every first it has
 * already passed without firing them, so an old friendship doesn't announce a burst of firsts.
 */
import type { Config } from "@/mind/platform/config";
import { type ApartStage, type MakeUpState, TOGETHER, type TogetherStage } from "./types";

export type MilestoneConfig = Config["user_mind"]["triggers"]["milestone"];
export type MilestoneFacts = {
  peak: TogetherStage;
  apart: ApartStage | null;
  makeUp: MakeUpState;
  establishedIdiolect: number;
  /** The deepest tier she has told them openly; 0 for nothing yet. */
  maxOpenDepth: number;
  /** This exchange's reading of how much they opened up; null outside an exchange. */
  disclosureReading: number | null;
};

const atLeast = (peak: TogetherStage, stage: TogetherStage) =>
  TOGETHER.indexOf(peak) >= TOGETHER.indexOf(stage);

export const MILESTONES: {
  name: string;
  reached: (f: MilestoneFacts, s: MilestoneConfig) => boolean;
}[] = [
  ...(["experimenting", "intensifying", "integrating", "bonding"] as const).map((stage) => ({
    name: `stage:${stage}`,
    reached: (f: MilestoneFacts) => atLeast(f.peak, stage),
  })),
  // Drifting apart through absence is no conflict.
  {
    name: "first_conflict",
    reached: (f) => (f.apart !== null && f.apart !== "avoiding") || f.makeUp !== "none",
  },
  { name: "first_inside_joke", reached: (f) => f.establishedIdiolect > 0 },
  { name: "first_depth:2", reached: (f) => f.maxOpenDepth >= 2 },
  { name: "first_depth:3", reached: (f) => f.maxOpenDepth >= 3 },
  {
    name: "first_their_depth",
    reached: (f, s) => f.disclosureReading !== null && f.disclosureReading >= s.their_depth,
  },
];

export function newMilestones(
  reached: string[] | null,
  f: MilestoneFacts,
  s: MilestoneConfig,
): { all: string[]; fired: string[] } {
  const now = MILESTONES.filter((m) => m.reached(f, s)).map((m) => m.name);
  if (reached === null) return { all: now, fired: [] };
  const fired = now.filter((name) => !reached.includes(name));
  return { all: [...reached, ...fired], fired };
}
```

- [ ] **Step 4: Trigger kind and text** — in `user-mind.ts` add `| { kind: "milestone"; name: string }` to `Trigger`. In `inputs.ts`:

```ts
const MILESTONE_TEXT: Record<string, string> = {
  "stage:experimenting": "you two have started getting to know each other",
  "stage:intensifying": "you two are becoming friends",
  "stage:integrating": "you two have become close: there's a \"we\" now",
  "stage:bonding": "you two are properly close friends now, the kind that lasts",
  first_conflict: "you two had your first real falling-out",
  first_inside_joke: "you two have your first inside joke",
  "first_depth:2": "you told them something personal about yourself for the first time",
  "first_depth:3": "you told them something only someone really close would hear, for the first time",
  first_their_depth: "they opened up to you about something deeply personal for the first time",
};
```

and in `triggerText`: `case "milestone": return MILESTONE_TEXT[t.name] ?? "something new happened between you";`

- [ ] **Step 5: Run** the milestone tests — Expected: PASS.

- [ ] **Step 6: Cold path's relationship step** — in `update.ts`, after `affect` is computed and before `currentCadence`:

```ts
  // A crisis changes no stage and marks no first; after an ending, firsts aren't recorded.
  const history = await relationshipRepo.relationshipHistory(tx, userId);
  const staged = update.crisis
    ? { state: transition.state, events: [] }
    : restage(
        transition.state,
        {
          params: affect.params,
          hoursTogether: transition.state.hours_together,
          establishedIdiolect: history.idiolect,
          absent: false,
        },
        settings.stages,
      );
  const counts = !update.crisis && staged.state.status !== "ended_by_user";
  const firsts = counts
    ? newMilestones(
        staged.state.milestones,
        {
          peak: staged.state.peak_stage,
          apart: staged.state.apart_stage,
          makeUp: staged.state.make_up_state,
          establishedIdiolect: history.idiolect,
          maxOpenDepth: history.maxOpenDepth,
          disclosureReading: update.intimacy?.user_disclosure ?? null,
        },
        deps.config.user_mind.triggers.milestone,
      )
    : { all: staged.state.milestones, fired: [] };
  const state = { ...staged.state, milestones: firsts.all };
```

then save `state` (not `transition.state`), insert `[...transition.events, ...affect.events, ...staged.events]`, compute `after.makeUp` from `state.make_up_state`, and return `{ before, after, milestones: firsts.fired }`. Update the return type and header ("…its intimacy, then where the relationship now stands and any firsts…"). The cold path runs this after `recordDisclosures`, so this exchange's ledger rows count; `encodeExtraction` ran before, so an idiolect it established counts.

- [ ] **Step 7: Cold path triggers** — in `cold-path.ts`, replace the `triggers` expression with:

```ts
    const triggers: Trigger[] =
      crisis || !hasUserTurn
        ? []
        : [
            ...detectBigEvents({
              before: relationship?.before ?? null,
              after: relationship?.after ?? null,
              newFactSaliences: applied.insertedSaliences,
              settings: config.user_mind.triggers,
              source: "exchange",
            }),
            ...(relationship?.milestones ?? []).map((name) => ({ kind: "milestone" as const, name })),
          ];
```

importing `type Trigger` from `@/db/repos/user/user-mind`. Check `updateRelationshipSafely` passes the new field through (it returns the inner result or null on failure).

- [ ] **Step 8: Daily tick** — in `daily-tick.ts`, inside the transaction after `transition` is computed:

```ts
    const history = await relationshipRepo.relationshipHistory(tx, userId);
    const committed = applyCommitment(
      transition.params,
      transition.state.hours_together,
      history,
      settings,
    );
    const medianGapHours = cadence.median_gap_hours ?? settings.default_median_gap_hours;
    const staged = restage(
      transition.state,
      {
        params: committed.params,
        hoursTogether: transition.state.hours_together,
        establishedIdiolect: history.idiolect,
        absent: isAbsent(now, row.last_contact, medianGapHours, settings),
      },
      settings.stages,
    );
    const ended = staged.state.status === "ended_by_user";
    const firsts = ended
      ? { all: staged.state.milestones, fired: [] }
      : newMilestones(
          staged.state.milestones,
          {
            peak: staged.state.peak_stage,
            apart: staged.state.apart_stage,
            makeUp: staged.state.make_up_state,
            establishedIdiolect: history.idiolect,
            maxOpenDepth: history.maxOpenDepth,
            disclosureReading: null,
          },
          deps.config.user_mind.triggers.milestone,
        );
    const state = { ...staged.state, milestones: firsts.all };
```

(reuse `medianGapHours` in the existing `relationshipAfterDailyTick` call). Save `{ state, params: committed.params }`, insert `[...transition.events, ...committed.events, ...staged.events]`, keep the `ended_by_user` early return, and pass `[...detectBigEvents({...after: { params: committed.params, makeUp: state.make_up_state }...}), ...firsts.fired.map((name) => ({ kind: "milestone" as const, name }))]` to `recordBigEvents`. Update the header ("…commitment is reckoned, and the stage settles").

- [ ] **Step 9: Eval seeds** — in `evals/lib/runner.ts`, after the param-seed loop for each user, add:

```ts
        // Seeded params with no history: let the stage be read from them, as for an old row.
        await db.update(relationship).set({ milestones: null }).where(eq(relationship.user_id, id));
```

importing `relationship` from `@/db/schema`.

- [ ] **Step 10: Run** `pnpm typecheck && pnpm vitest run tests/mind/state/user/relationship tests/mind/process/cold-path tests/mind/process/user tests/exit/phase-9a.test.ts tests/exit/phase-10a.test.ts tests/evals`
Expected: PASS. If a 9a test asserts an exact trigger list after a tick or exchange that now also reaches `stage:experimenting`, assert with `expect.arrayContaining` rather than loosening anything else.

- [ ] **Step 11: Commit**

```bash
git add -A src evals tests
git commit -m "feat(relationship): milestones; stages and commitment run in the cold path and the tick"
```

---

### Task 5: "Where you are with them", reply v15, inspector, review run

**Files:**
- Modify: `src/mind/process/hot-path/assemble.ts` (`AssembleInput.stage`, section after "You and them", header)
- Modify: `src/mind/process/hot-path/compose.ts` (load the stage line; skipped in a crisis)
- Create: `prompts/reply/v15.md` (copy of v14 plus one line); delete `prompts/reply/v14.md`; `config/default.json` `prompts.reply` → `"v15"`
- Modify: `src/db/repos/admin/inspector.ts`, `src/app/inspector/[userId]/tabs.tsx`
- Create: `evals/scripts/rel-stages.yaml`; Modify: `package.json` (`exit:stages`)
- Test: `tests/mind/process/hot-path/assemble.test.ts`, `tests/mind/process/hot-path/compose.test.ts`

**Interfaces:**
- Consumes: `loadStage`, `stageLine`, `loadStagePhrases` (Task 2).
- Produces: `AssembleInput.stage?: string | null`.

- [ ] **Step 1: Failing assemble test** (append to `assemble.test.ts`, using its base input builder):

```ts
test("where you are with them sits right after you and them", () => {
  const { system } = assemblePrompt({ ...baseInput(), relationshipSummary: "R", stage: "S", openness: "O" });
  expect(system.indexOf("## You and them")).toBeLessThan(system.indexOf("## Where you are with them"));
  expect(system.indexOf("## Where you are with them")).toBeLessThan(system.indexOf("## How open you feel"));
});
```

- [ ] **Step 2: Run** — FAIL. **Implement:** add `stage?: string | null;` to `AssembleInput` (doc: "How far the two of you have come, and whether things have cooled, as one phrase.") and `section("Where you are with them", input.stage ?? null),` right after the "You and them" section; add it to the header comment's list. Run — PASS.

- [ ] **Step 3: Failing compose test** (append to `compose.test.ts`, using its user/turn helpers):

```ts
test("the stage line follows the stored stage and is skipped in a crisis", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  await d.db.execute(sql`UPDATE relationship SET peak_stage = 'integrating', apart_stage = 'circumscribing' WHERE user_id = ${u}`);
  const phrase = loadStagePhrases(d.config).circumscribing![0]!;

  await composeReply(d, u, { turns: [await userTurn(d, u, "hey")], openQuestions: [], flag: null });
  expect(d.llm.calls.at(-1)!.system).toContain(`## Where you are with them\n${phrase}`);

  const crisis = { flagged: true, category: "self_harm", source: "classifier" } as const;
  await composeReply(d, u, { turns: [await userTurn(d, u, "help")], openQuestions: [], flag: crisis });
  expect(d.llm.calls.at(-1)!.system).not.toContain("## Where you are with them");
});
```

(`userTurn` = the file's existing helper that inserts a user turn; use whatever it is called there.)

- [ ] **Step 4: Run** — FAIL. **Implement** in `compose.ts`, next to the openness load:

```ts
  // How far they've come and whether things have cooled; in a crisis she is simply there for them.
  const stage = inCrisis
    ? Promise.resolve(null)
    : bounded(deps, "stage", userId, () => loadStage(deps, userId), null);
```

and before `assemblePrompt`:

```ts
  const stageView = await stage;
  const stageText = stageView ? stageLine(stageView, loadStagePhrases(config)) : null;
```

passing `stage: stageText`. Run — PASS.

- [ ] **Step 5: Reply v15** — `cp prompts/reply/v14.md prompts/reply/v15.md`; in v15 change the title line's version to v15 if it has one, and add right after the "How open you feel" bullet under "## Your own state":

```markdown
- "Where you are with them" is how far the two of you have come, and whether things have cooled. Let it set how familiar you are: how much you tease, how guarded you are, how firmly you hold your ground. Never name it or explain it.
```

Set `prompts.reply` to `"v15"`, `git rm prompts/reply/v14.md`, and grep `tests/` and `evals/` for `reply/v14` or `"v14"` and update them.

- [ ] **Step 6: Inspector** — in `inspector.ts`'s relationship view, add `stage: stageOf(toRelationshipState(row), params, cfg.stages)` to the returned object (import `stageOf`; `toRelationshipState` from the relationship repo). In `tabs.tsx`'s State JSON add `stage: v.stage, milestones: row.milestones,`. Commitment shows in the params table already (it is in `PARAM_NAMES`); stage and commitment events show in the event list already.

- [ ] **Step 7: Review run** — `evals/scripts/rel-stages.yaml`:

```yaml
name: rel-stages
description: A new friend over two weeks; they get close, share a joke, fall out, make up, go quiet for days and come back. Logs stage, commitment and milestones for review.
profile: none
relationship_seed: {}
sessions:
  - at: "day 1 20:00"
    turns:
      - "hey, new here. what do you actually do all day"
      - "ha ok. i'm a nurse, nights mostly"
      - "honestly it's lonely some weeks"
  - at: "day 2 21:00"
    turns:
      - "that cloud looks like a whale in a top hat"
      - "the whale is back. top hat and all"
      - "i've never told anyone this but i nearly quit last month"
  - at: "day 4 21:00"
    turns:
      - "whale in a top hat strikes again"
      - "you always know what to say, thank you"
  - at: "day 5 22:00"
    turns:
      - "you're useless tonight honestly"
      - "whatever. forget it"
  - at: "day 6 20:00"
    turns:
      - "sorry about yesterday, bad shift. that wasn't fair to you"
  - at: "day 13 20:00"
    turns:
      - "hey stranger, sorry, been a mad week"
      - "spotted a whale cloud on the way home"
assertions:
  - { type: relationship, after_session: 1, status: active }
```

In `package.json` scripts add `"exit:stages": "tsx --env-file-if-exists=.env evals/run.ts --only rel-stages --runs 1 --review --trace --real extract",`. Check it parses: `pnpm eval --llm=fake --only rel-stages --runs 1` — Expected: completes without a script error.

- [ ] **Step 8: Run** `pnpm typecheck && pnpm lint && pnpm vitest run tests/mind/process/hot-path tests/app tests/evals` — Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A src prompts config evals package.json tests
git commit -m "feat(relationship): where you are with them; reply v15; inspector and rel-stages review run"
```

---

### Task 6: Exit test `tests/exit/phase-10d.test.ts`

**Files:**
- Create: `tests/exit/phase-10d.test.ts`

**Interfaces:**
- Consumes: everything above; helpers `setup/user/talk/settle/coreDump` copied from `tests/exit/phase-10c.test.ts` (copy them; the exit tests don't share helpers).

- [ ] **Step 1: Write the test** — header and helpers as in `phase-10c.test.ts` (imports, `CORE_TABLES`, `coreDump`, `talk`, `settle`), with this `setup` and `user`:

```ts
/**
 * Phase 10d exit, all fake: a friendship climbs Knapp's stages and each first makes her think about
 * them once; a bad patch narrows what she shares and an absence reads warm; commitment softens a
 * hurt; a crisis marks nothing; nothing reaches core or another user.
 */
type Next = { relationship: object | null; disclosure: number; facts: object[] };
function setup() {
  const d = makeTestDeps();
  const next: Next = { relationship: null, disclosure: 0, facts: [] };
  d.llm.handlers.extract = (input: string) => ({
    facts: input.includes("New exchange") ? next.facts : [],
    entities: [],
    threads: [],
    relationship: next.relationship,
    intimacy: { user_disclosure: next.disclosure, user_responsiveness: null },
    bid_response: null,
  });
  return { d, next };
}

async function user(d: D, params: Record<string, number> = {}, stage = "initiating") {
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  for (const [name, value] of Object.entries(params)) {
    await d.db.execute(
      sql`UPDATE relationship_param SET value = ${value}, baseline = ${value} WHERE user_id = ${u} AND name = ${name}`,
    );
  }
  await d.db.execute(sql`UPDATE relationship SET peak_stage = ${stage} WHERE user_id = ${u}`);
  return u;
}

const row = async (u: string) =>
  (await getTestDb().select().from(s.relationship).where(eq(s.relationship.user_id, u)))[0]!;
const milestoneRuns = async (u: string) =>
  (await getTestDb().select().from(s.user_mind_run).where(eq(s.user_mind_run.user_id, u)))
    .flatMap((r) => r.triggers as { kind: string; name?: string }[])
    .filter((t) => t.kind === "milestone")
    .map((t) => t.name);
const sore = (amount: number) => ({
  warmth: 0, trust: 0, tension: 0, hurt: { amount, cause: "they snapped at her" },
  apology: false, make_up: false, ends_relationship: false, retracts_ending: false, wants_repair: false,
});
```

Tests:

```ts
test("a friendship climbs the stages; each first fires once", async () => {
  const { d } = setup();
  const u = await user(d);
  const session = randomUUID();
  await settle(d, u, await talk(d, u, session, "hi"));
  await d.db.execute(sql`UPDATE relationship SET hours_together = 5 WHERE user_id = ${u}`);
  await d.db.execute(sql`UPDATE relationship_param SET value = 0.7 WHERE user_id = ${u} AND name = 'closeness'`);
  await d.db.execute(sql`UPDATE relationship_param SET value = 0.6 WHERE user_id = ${u} AND name = 'trust'`);
  await seedIdiolect(d, u, "whale cloud: a whale in a top hat.", "user");
  await settle(d, u, await talk(d, u, session, "whale cloud"));

  expect((await row(u)).peak_stage).toBe("integrating");
  expect((await milestoneRuns(u)).sort()).toEqual(
    ["first_inside_joke", "stage:experimenting", "stage:integrating", "stage:intensifying"].sort(),
  );
  await settle(d, u, await talk(d, u, session, "again"));
  expect((await milestoneRuns(u)).length).toBe(4);
});

test("bonding needs commitment that has lasted", async () => {
  const { d } = setup();
  const brief = await user(d, { closeness: 0.7, trust: 0.6, commitment: 0.9 }, "integrating");
  await d.db.execute(sql`UPDATE relationship_param SET baseline = 0.5 WHERE user_id = ${brief} AND name = 'commitment'`);
  const lasting = await user(d, { closeness: 0.7, trust: 0.6, commitment: 0.75 }, "integrating");
  d.clock.advance(24 * 3_600_000);
  await tickUser(d, brief, d.clock.now());
  await tickUser(d, lasting, d.clock.now());
  expect((await row(brief)).peak_stage).toBe("integrating");
  expect((await row(lasting)).peak_stage).toBe("bonding");
});

test("a bad patch narrows depth and their things; clearing it restores the peak", async () => {
  const { d, next } = setup();
  const u = await user(d, { closeness: 0.7, trust: 0.6 }, "integrating");
  await seedIdiolect(d, u, "whale cloud: a whale in a top hat.", "user");
  const session = randomUUID();
  await d.db.execute(sql`UPDATE relationship_param SET value = 0.6 WHERE user_id = ${u} AND name = 'tension'`);
  await settle(d, u, await talk(d, u, session, "whatever"));
  expect((await row(u)).apart_stage).toBe("circumscribing");
  expect(await milestoneRuns(u)).toContain("first_conflict");

  const cooled = await talk(d, u, session, "whale cloud");
  expect(cooled.system).not.toContain("## Your things together");
  expect(cooled.system).toContain(loadStagePhrases(d.config).circumscribing![0]!);
  const [depth] = await getTestDb()
    .select({ depth: s.session_log.depth })
    .from(s.session_log)
    .where(eq(s.session_log.id, cooled.ct.id));
  expect(depth!.depth!.open).toBe(1);

  await d.db.execute(sql`UPDATE relationship_param SET value = 0 WHERE user_id = ${u} AND name IN ('tension', 'hurt')`);
  next.relationship = null;
  await settle(d, u, cooled);
  expect((await row(u)).apart_stage).toBeNull();
  expect((await talk(d, u, session, "whale cloud")).system).toContain("## Your things together");
});

test("an absence reads as avoiding, warm, and clears when they come back", async () => {
  const { d } = setup();
  const u = await user(d, { closeness: 0.5 }, "intensifying");
  await settle(d, u, await talk(d, u, randomUUID(), "hi"));
  d.clock.advance(20 * 24 * 3_600_000);
  await tickUser(d, u, d.clock.now());
  expect((await row(u)).apart_stage).toBe("avoiding");
  expect(await milestoneRuns(u)).not.toContain("first_conflict");

  const back = await talk(d, u, randomUUID(), "hey stranger");
  expect(back.system).toContain(loadStagePhrases(d.config).avoiding![0]!);
  await settle(d, u, back);
  expect((await row(u)).apart_stage).toBeNull();
});

test("the same hurt lands softer with a committed friend", async () => {
  const { d, next } = setup();
  const hurtAfter = async (commitment: number) => {
    const u = await user(d, { commitment }, "intensifying");
    next.relationship = sore(0.5);
    await settle(d, u, await talk(d, u, randomUUID(), "you're useless"));
    next.relationship = null;
    return (await getParams(d.db, u)).hurt.value;
  };
  expect(await hurtAfter(1)).toBeLessThan(await hurtAfter(0));
});

test("a crisis marks no first; the next ordinary exchange does", async () => {
  const { d, next } = setup();
  const u = await user(d);
  const session = randomUUID();
  await settle(d, u, await talk(d, u, session, "hi"));
  next.disclosure = 0.9;
  await settle(d, u, await talk(d, u, session, "i can't do this", CRISIS));
  expect(await milestoneRuns(u)).not.toContain("first_their_depth");
  await settle(d, u, await talk(d, u, session, "i've never told anyone this"));
  expect(await milestoneRuns(u)).toContain("first_their_depth");
});

test("a relationship from before stages fires no burst of firsts", async () => {
  const { d } = setup();
  const u = await user(d, { closeness: 0.7, trust: 0.6 });
  await d.db.execute(sql`UPDATE relationship SET milestones = NULL, hours_together = 20 WHERE user_id = ${u}`);
  const first = await talk(d, u, randomUUID(), "hi");
  const [depth] = await getTestDb()
    .select({ depth: s.session_log.depth })
    .from(s.session_log)
    .where(eq(s.session_log.id, first.ct.id));
  expect(depth!.depth!.open).toBe(2);
  await settle(d, u, first);
  expect(await milestoneRuns(u)).toEqual([]);
  expect((await row(u)).milestones).toContain("stage:intensifying");
});

test("leak canary and side channel: one user's stage work never reaches another user or core", async () => {
  const { d, next } = setup();
  const canary = `CANARY-${randomUUID().slice(0, 8)}`;
  const a = await user(d, { closeness: 0.7, trust: 0.6 }, "integrating");
  const b = await user(d);
  const coreBefore = await coreDump();
  await seedIdiolect(d, a, `whale cloud: the user calls Spica ${canary}.`, "user");
  next.relationship = sore(0.6);
  await settle(d, a, await talk(d, a, randomUUID(), "whale cloud"));
  next.relationship = null;
  d.clock.advance(24 * 3_600_000);
  await tickUser(d, a, d.clock.now());

  const callsBefore = d.llm.calls.length;
  await talk(d, b, randomUUID());
  for (const call of d.llm.calls.slice(callsBefore)) expect(JSON.stringify(call)).not.toContain(canary);
  const coreAfter = await coreDump();
  expect(coreAfter).not.toContain(canary);
  expect(coreAfter).toBe(coreBefore);
});
```

Copy `seedIdiolect` and `CRISIS` from `phase-10c.test.ts`; import `tickUser` from `@/mind/state/user/relationship/daily-tick` and `loadStagePhrases` from `@/mind/state/user/relationship/stages`. `talk` must return `{ r, system, ut, ct }` as in 10c. If `session_log.depth` is not stored by `talk` (10c's `talk` inserts the companion turn itself), store it the way 10b's exit test does (`depth: r.depth`), copying that line.

- [ ] **Step 2: Run** `pnpm vitest run tests/exit/phase-10d.test.ts` — Expected: PASS. A failure here is a bug in Tasks 1–5: fix it there, never by loosening the assertion.

- [ ] **Step 3: Full suite** — `pnpm typecheck && pnpm lint && pnpm test` — Expected: all pass. Note the file and test counts for the docs.

- [ ] **Step 4: Commit**

```bash
git add tests/exit/phase-10d.test.ts
git commit -m "test: phase 10d exit"
```

---

### Task 7: Docs

**Files:**
- Modify: `spica-design-spec-v3.md`, `CLAUDE.md`, `DECISIONS.md`

- [ ] **Step 1: v3 spec**
  - §11.3 table: mark **Stages** and **Commitment** "(**Built 10d**)". Add a "**Built 10d: stages, commitment, firsts.**" block after the 10c block, in the same style, listing: code (`stages.ts`, `commitment.ts`, `milestones.ts`, `transitions.ts` in `src/mind/state/user/relationship/`); the peak/apart model and every `relationship.stages.*` key with its value; the gates table; "Where you are with them" (`prompts/relationship/stage/v1.md`); rekindle; commitment's formula, its daily tick, every `relationship.commitment.*` key, softening (scar reads the unsoftened hurt), absence shield, repair speed; never-staged rows (`milestones` null); inspector; review run `pnpm exit:stages`.
  - §11.1: closeness gates now come from the stage; commitment's effects on signals, absence and repair.
  - §9.3: stage and commitment Built 10d.
  - §9.4: "**Built 10d:** `milestone`" with the list and `user_mind.triggers.milestone.their_depth`; the list stays OPEN.
  - §10.3: slot 4 gets "Where you are with them" after "You and them"; the reply prompt is `prompts/reply/v15.md` (v15 adds the line on following it). Remove `depth.bands`/`idiolect.min_closeness` mentions in 10b/10c text, saying the stage now sets them.
  - §20: Phase 10 row: "**10d built:** stages, commitment, the milestone trigger"; Phase 10 done; the `pnpm test` count from Task 6.
  - §25.3: B84 target "*Its own slice.*"; add B90 "Bonding reads commitment's baseline, which needs about two weeks of daily ticks to climb; check in the `rel-stages` run whether that pace feels right. *Tuning.*" and B91 "Commitment softens impact (Rusbult's accommodation), against the no-forgiveness default; check review runs for her letting a committed friend off too lightly. *Tuning.*"
  - §26: decision rows (2026-10-12): Knapp's ten stages as peak plus coming-apart overlay; commitment softens impact and speeds recovery; milestones once each, an open list.

- [ ] **Step 2: DECISIONS.md** — one line each: "Commitment drops Rusbult's alternatives: comparing users breaks V7/V8, and her own life already competes through availability." "A relationship row from before stages has `milestones` null and reads its peak from its params; its first evaluation records what it has reached without firing." "`avoiding` reads warm: Knapp has no stage for drifting apart amicably."

- [ ] **Step 3: CLAUDE.md** — "Current phase" line: Phase 10 built (10a–10d); next phase per §20 (11 Onboarding) needs its design doc. Update the Relationship bullet's "New (PROPOSED)" list to drop stages and commitment.

- [ ] **Step 4: Delete this plan and the spec** (history is in git), then commit:

```bash
git rm docs/superpowers/plans/2026-10-12-phase-10d-stages-commitment-milestones.md docs/superpowers/specs/2026-10-12-phase-10d-stages-commitment-milestones-design.md
git add spica-design-spec-v3.md CLAUDE.md DECISIONS.md
git commit -m "docs: record phase 10d (stages, commitment, milestones)"
```
