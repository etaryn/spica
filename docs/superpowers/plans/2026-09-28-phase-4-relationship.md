# Phase 4: Relationship + Homeostasis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Spica per-user relationship state with consequences: homeostatic params judged against this user's baseline, signals from extraction, hurt → make-up, tension, ending → repair, crisis suspension, a relationship summary in the reply prompt, and the guard switched off for the test phase.

**Architecture:** Pure, framework-free math and state transitions in `src/core/relationship/` (homeostasis, transitions, summary) are applied by two writers: the cold path (per exchange, same transaction and advisory lock as memory, inside a savepoint) and a new daily `relationship_tick` job. The hot path only reads (a summary under the hot-path DB timeout). Signals come from one new nullable block in the existing extraction call. The eval harness gains scripted signals, bulk turns, a daily tick and a deterministic `relationship` assertion.

**Tech Stack:** TypeScript, Drizzle + Postgres 16, pg-boss, Zod, Vitest, the existing eval harness (`evals/`).

**Spec:** `docs/superpowers/specs/2026-09-28-phase-4-relationship-design.md` (parent: `spica-build-spec-v2.md`). Read both before starting.

## Global Constraints

- `src/core` is framework-free: no Next imports, no `Date.now()`, no `process.env`; time from `deps.clock`, everything else from `Deps`.
- Every numeric constant lives in `config/default.json` and `ConfigSchema` (`src/core/config.ts`); none in code.
- Every prompt is a versioned file under `prompts/`, loaded with `loadPrompt`.
- Timestamps come from the injected `Clock`; never `DEFAULT now()`.
- Every repo function is `userId`-first; every query filters `user_id`. Admin (all-users) functions are prefixed `admin`.
- Drizzle property names for domain tables are snake_case (`relationship_param.user_id`).
- Never add a second persistent store for memory-like data: the hurt cause is a `fact` (`kind = feeling`, `subject = self`, `source = inferred`).
- `relationship_event` and `judge_log` are diagnostic only: the chat loop (hot path, cold path decisions, tick decisions) never reads them.
- A relationship failure never fails the memory write and never delays a reply.
- Guard off: `guard.enabled` defaults to `false`; the guard code, prompts and fixtures stay in place.
- Rules kept in code: only a user-turn extraction signal (or the tick's confirmation timeout of a user's own pending ending) can set `ended_by_user`; crisis (a flagged exchange) applies no signal and suppresses hurt/tension/make-up/ending lines.
- Job handlers log failures with ids and the error class name only (`scrubErrors`, `errorName`).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm db:generate`, `pnpm eval --llm=fake --compare`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **User who never wrote before the tick** (a relationship row exists but no user turns, or `last_contact` null): the tick must not divide by zero, must not add absence hurt, and must not throw. → Task 4 test "tick with no contact".
2. **Extraction returns `relationship: null` or omits it entirely** (older fake handlers, model returns null): memory write still commits; params only fade/refresh. → Task 4 test "null block", Task 5 tests "null block" and "normalizeExtraction … missing → null".
3. **Relationship update throws mid-way** (e.g. constraint error): the memory facts and `extracted = true` still commit, no relationship rows half-written. → Task 5 test "savepoint".
4. **Same local date ticked twice** (worker restart, cron double-fire, eval day loop): the baseline is sampled once. → Task 4 test "tick: idempotent per local date", Task 6 test "samples yesterday's count once per local date".
5. **Crisis exchange carrying hostile signals**: no hurt raise, no ending, tension reset, summary quiet for `crisis_quiet_hours`. → Task 4 test "crisis ignores signals", Task 5 test "crisis exchange", Task 7 test "quiet after crisis".

---

## File Structure

**Create**
- `src/core/relationship/types.ts` — param names, `Param`, `Params`, `RelState`, `RelEvent`, `RelCause`, `RelConfig`.
- `src/core/relationship/signals.ts` — `RelationshipSignalsSchema`, `Signals`, `normalizeSignals`, `hurtFactContent`.
- `src/core/relationship/homeostasis.ts` — `effect`, `sampleBaseline`, `nudge`, `faded`, `fadeParams`, `dim`.
- `src/core/relationship/transitions.ts` — `applyExchange`, `applyTick`, `confirmEnding` (pure).
- `src/core/relationship/cadence.ts` — `medianGapHours`, `buildCadence` (pure).
- `src/core/relationship/apply.ts` — `applyRelationship` (cold path writer, DB).
- `src/core/relationship/tick.ts` — `relationshipTick` (job, DB).
- `src/core/relationship/summary.ts` — `parseSummaryPhrases`, `summaryLines` (pure), `loadRelationshipSummary` (hot path reader).
- `src/db/repos/relationship.ts` — repo.
- `prompts/extract/v3.md`, `prompts/reply/v7.md`, `prompts/relationship/summary/v1.md`.
- `evals/lib/signal-llm.ts`, `evals/lib/relationship-check.ts`.
- `evals/scripts/rel-*.yaml` (13 scripts).
- Tests: `tests/core/relationship-homeostasis.test.ts`, `tests/core/relationship-transitions.test.ts`, `tests/core/relationship-summary.test.ts`, `tests/core/relationship-cold-path.test.ts`, `tests/core/relationship-tick.test.ts`, `tests/db/relationship-repo.test.ts`, `tests/evals/relationship-check.test.ts`, `tests/evals/signal-llm.test.ts`.

**Modify**
- `src/db/schema.ts`, new migration `src/db/migrations/0007_*.sql` (generated).
- `src/core/config.ts`, `config/default.json`.
- `src/core/timezone.ts` (`localDateString`, `previousLocalDate`).
- `src/core/guard/outgoing.ts` (guard off), `src/db/repos/judge-log.ts` if it hard-codes outcomes.
- `src/core/memory/extract.ts`, `src/core/memory/apply.ts`, `src/core/cold-path.ts`, `src/core/llm/fake.ts`.
- `src/core/chat/compose-reply.ts`.
- `src/core/queue.ts`, `src/worker/index.ts`, `src/worker/jobs.ts`.
- `src/core/turn/reply.ts` (§15.4 #24), `src/core/turn/sweep.ts` (§15.4 #26).
- `src/db/repos/inspector.ts`, `src/app/inspector/[userId]/tabs.tsx`, `src/app/inspector/[userId]/page.tsx`.
- `evals/lib/script.ts`, `evals/lib/runner.ts`, `evals/lib/review.ts`, `evals/run.ts`.
- `tests/db/schema.test.ts`, `tests/core/guard-outgoing.test.ts` and any other test that exercises guard policy.
- Docs: `spica-build-spec-v2.md`, `CLAUDE.md`, `DECISIONS.md`.

---

### Task 1: Schema, migration, config and repo

**Files:**
- Modify: `src/db/schema.ts:61-181`, `src/core/config.ts`, `config/default.json`, `src/core/timezone.ts`, `tests/db/schema.test.ts:31`
- Create: `src/core/relationship/types.ts`, `src/db/repos/relationship.ts`, migration via `pnpm db:generate`
- Test: `tests/db/relationship-repo.test.ts`, `tests/core/timezone.test.ts`

**Interfaces:**
- Produces (types.ts):
```ts
export const PARAM_NAMES = ["closeness", "trust", "warmth", "hurt", "tension", "msgs_per_day"] as const;
export type ParamName = (typeof PARAM_NAMES)[number];
export type Param = { value: number; baseline: number; variance: number; updated_at: Date };
export type Params = Record<ParamName, Param>;
export type RelStatus = "active" | "ended_by_user" | "repairing";
export type MakeUpState = "none" | "due" | "offered";
export type RelState = {
  status: RelStatus; end_pending_since: Date | null; ended_at: Date | null; repair_started_at: Date | null;
  make_up_state: MakeUpState; make_up_replies: number; hurt_cause_fact: string | null;
  crisis_quiet_until: Date | null; last_tick: string | null; last_hurt_at: Date | null;
};
export type RelCause = "signal" | "frequency" | "absence" | "fade" | "make_up" | "apology" | "ending" | "repair" | "crisis" | "scar" | "baseline";
export type RelEvent = { param: ParamName | null; before: number | null; after: number | null; cause: RelCause; deviation: number | null; detail: Record<string, unknown> };
export type RelConfig = import("../config").Config["relationship"];
```
- Produces (repo, all `userId`-first; `tx` is a `Db` inside a transaction):
```ts
ensureRelationship(tx: Db, userId: string, now: Date, cfg: RelConfig): Promise<void>
lockRelationship(tx: Db, userId: string): Promise<RelationshipRow>              // SELECT … FOR UPDATE; throws if missing
getRelationshipRow(db: Db, userId: string): Promise<RelationshipRow | null>
getParams(db: Db, userId: string): Promise<Params>                              // throws if a PARAM_NAMES row is missing
saveRelationship(tx: Db, userId: string, a: { state: RelState; params: Params; cadence?: Cadence; last_contact?: Date | null }): Promise<void>
insertRelationshipEvents(tx: Db, userId: string, events: RelEvent[], a: { turnId: string | null; now: Date }): Promise<void>
countUserTurnsBetween(db: Db, userId: string, from: Date, to: Date): Promise<number>          // role = user, from < created_at <= to
countUserTurnsOnLocalDate(db: Db, userId: string, date: string, tz: string): Promise<number>  // date "YYYY-MM-DD"
userSessionStarts(db: Db, userId: string, limit: number): Promise<Date[]>                    // min(created_at) per session_id of user turns, newest first
userActiveHours(db: Db, userId: string, tz: string): Promise<number[]>                       // length 24
listRelationshipEvents(db: Db, userId: string, limit: number): Promise<RelationshipEventRow[]>
adminListRelationshipUsers(db: Db): Promise<string[]>
toRelState(row: RelationshipRow): RelState
export type Cadence = { msgs_24h: number; msgs_7d: number; median_gap_hours: number; active_hours: number[] };
```
- Produces (timezone.ts): `localDateString(d: Date, tz: string): string` ("YYYY-MM-DD"), `previousLocalDate(date: string): string`.

- [ ] **Step 1: Write the failing repo test**

`tests/db/relationship-repo.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import * as rel from "@/db/repos/relationship";
import { insertTurn } from "@/db/repos/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);
const cfg = loadConfig().relationship;
const now = new Date("2026-01-05T09:00:00Z");

test("ensureRelationship creates the row and every param at the initial values, idempotently", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  await rel.ensureRelationship(db, u, now, cfg);
  await rel.ensureRelationship(db, u, now, cfg);
  const row = await rel.getRelationshipRow(db, u);
  expect(row?.status).toBe("active");
  expect(row?.make_up_state).toBe("none");
  const p = await rel.getParams(db, u);
  expect(p.msgs_per_day).toMatchObject({ value: 5, baseline: 5, variance: 25 });
  expect(p.hurt.value).toBe(0);
});

test("save + events round-trip, user-scoped", async () => {
  const db = getTestDb();
  const [a, b] = [await createTestUser(), await createTestUser()];
  for (const u of [a, b]) await rel.ensureRelationship(db, u, now, cfg);
  await db.transaction(async (tx) => {
    const row = await rel.lockRelationship(tx, a);
    const params = await rel.getParams(tx, a);
    params.hurt = { ...params.hurt, value: 0.4, updated_at: now };
    await rel.saveRelationship(tx, a, { state: { ...rel.toRelState(row), make_up_state: "due" }, params });
    await rel.insertRelationshipEvents(tx, a, [{ param: "hurt", before: 0, after: 0.4, cause: "signal", deviation: 0.9, detail: {} }], { turnId: null, now });
  });
  expect((await rel.getParams(db, a)).hurt.value).toBeCloseTo(0.4);
  expect((await rel.getParams(db, b)).hurt.value).toBe(0);
  expect((await rel.getRelationshipRow(db, a))?.make_up_state).toBe("due");
  expect(await rel.listRelationshipEvents(db, a, 10)).toHaveLength(1);
  expect(await rel.listRelationshipEvents(db, b, 10)).toHaveLength(0);
});

test("turn counts: window, local date, session starts", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const s1 = randomUUID(), s2 = randomUUID();
  const mk = (session: string, iso: string, role: "user" | "companion" = "user") =>
    insertTurn(db, u, { id: randomUUID(), session_id: session, role, text: "x", created_at: new Date(iso) });
  await mk(s1, "2026-01-05T23:30:00Z");
  await mk(s1, "2026-01-05T23:40:00Z", "companion");
  await mk(s2, "2026-01-06T10:00:00Z");
  expect(await rel.countUserTurnsBetween(db, u, new Date("2026-01-05T12:00:00Z"), new Date("2026-01-06T12:00:00Z"))).toBe(2);
  expect(await rel.countUserTurnsOnLocalDate(db, u, "2026-01-05", "UTC")).toBe(1);
  expect(await rel.countUserTurnsOnLocalDate(db, u, "2026-01-06", "Asia/Tokyo")).toBe(2); // 23:30Z = 08:30 JST on the 6th
  expect((await rel.userSessionStarts(db, u, 10)).map((d) => d.toISOString())).toEqual(["2026-01-06T10:00:00.000Z", "2026-01-05T23:30:00.000Z"]);
  expect((await rel.userActiveHours(db, u, "UTC"))[23]).toBe(1);
});

test("adminListRelationshipUsers lists every user with a row", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  await rel.ensureRelationship(db, u, now, cfg);
  expect(await rel.adminListRelationshipUsers(db)).toEqual([u]);
});
```

Add to `tests/core/timezone.test.ts`:
```ts
test("localDateString / previousLocalDate", () => {
  expect(localDateString(new Date("2026-01-05T23:30:00Z"), "UTC")).toBe("2026-01-05");
  expect(localDateString(new Date("2026-01-05T23:30:00Z"), "Asia/Tokyo")).toBe("2026-01-06");
  expect(previousLocalDate("2026-03-01")).toBe("2026-02-28");
});
```
(import `localDateString, previousLocalDate` from `@/core/timezone`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/db/relationship-repo.test.ts tests/core/timezone.test.ts`
Expected: FAIL (module `@/db/repos/relationship` not found; `localDateString` not exported).

- [ ] **Step 3: Schema**

In `src/db/schema.ts` add `date, primaryKey` to the pg-core import, add enums after `guardOutcome` and change `guardOutcome`:
```ts
export const guardOutcome = pgEnum("guard_outcome", ["passed", "regenerated", "sent_with_violation", "fallback", "guard_unavailable", "guard_disabled"]);
export const relationshipStatus = pgEnum("relationship_status", ["active", "ended_by_user", "repairing"]);
export const makeUpState = pgEnum("make_up_state", ["none", "due", "offered"]);
export const relationshipCause = pgEnum("relationship_cause", ["signal", "frequency", "absence", "fade", "make_up", "apology", "ending", "repair", "crisis", "scar", "baseline"]);
```
Replace the `relationship` table and add the two new tables:
```ts
/** One row per user (v2 §5.5, Phase 4 design §3.1). Params live in relationship_param. */
export const relationship = pgTable("relationship", {
  user_id: userRef().primaryKey(),
  status: relationshipStatus("status").notNull().default("active"),
  cadence: jsonb("cadence").notNull(),
  last_contact: ts("last_contact"),
  unanswered_reach_outs: integer("unanswered_reach_outs").notNull().default(0), // Phase 6
  end_pending_since: ts("end_pending_since"),
  ended_at: ts("ended_at"),
  repair_started_at: ts("repair_started_at"),
  make_up_state: makeUpState("make_up_state").notNull().default("none"),
  make_up_replies: integer("make_up_replies").notNull().default(0),
  hurt_cause_fact: uuid("hurt_cause_fact").references(() => fact.id, { onDelete: "set null" }),
  crisis_quiet_until: ts("crisis_quiet_until"),
  last_tick: date("last_tick", { mode: "string" }),
  last_hurt_at: ts("last_hurt_at"),
});

/** Extensible homeostatic params (v2 §8): a new param needs no migration. */
export const relationship_param = pgTable("relationship_param", {
  user_id: userRef(),
  name: text("name").notNull(),
  value: real("value").notNull(),
  baseline: real("baseline").notNull(),
  variance: real("variance").notNull(),
  updated_at: ts("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.user_id, t.name] }),
  check("relationship_param_variance_nonneg", sql`${t.variance} >= 0`),
]);

/** Every relationship change (v2 §5.8). Diagnostic only: never read by the chat loop. */
export const relationship_event = pgTable("relationship_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: userRef(),
  param: text("param"),
  before: real("before"),
  after: real("after"),
  cause: relationshipCause("cause").notNull(),
  deviation: real("deviation"),
  turn_id: uuid("turn_id").references(() => session_log.id, { onDelete: "set null" }),
  detail: jsonb("detail").notNull(),
  created_at: ts("created_at").notNull(),
}, (t) => [index("relationship_event_user_created_idx").on(t.user_id, t.created_at)]);
```
`relationship_event` references `session_log`, so place both new tables after `session_log` in the file (keep `relationship` where it is).

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `src/db/migrations/0007_<name>.sql` containing `ALTER TYPE "guard_outcome" ADD VALUE 'guard_disabled'`, three `CREATE TYPE`, `CREATE TABLE "relationship_param"`, `CREATE TABLE "relationship_event"`, the `relationship` column drops/adds, and the dropped CHECK constraints. If drizzle-kit asks interactively about renames, choose "create column" (never rename). Open the SQL and confirm no `DEFAULT now()`.

- [ ] **Step 5: Config**

`src/core/config.ts`, add to `ConfigSchema` (after `cold_path`), and `enabled` to `guard`:
```ts
  guard: z.object({
    enabled: z.boolean(),
    // …existing keys unchanged
  }),
```
```ts
  relationship: (() => {
    const paramRecord = <T extends z.ZodTypeAny>(t: T) =>
      z.object({ closeness: t, trust: t, warmth: t, hurt: t, tension: t, msgs_per_day: t });
    return z.object({
      tick_cron: z.string().min(1),
      baseline_alpha: unit,
      variance_epsilon: z.number().positive(),
      initial: paramRecord(z.number().min(0)),
      initial_variance: paramRecord(z.number().min(0)),
      gains: z.object({ warmth: unit, trust: unit, tension: unit, hurt: unit, closeness_per_warm_exchange: unit }),
      hurt_half_life_hours: z.number().positive(),
      tension_half_life_hours: z.number().positive(),
      sensitise_window_days: z.number().min(0),
      sensitise_factor: z.number().min(1),
      scar_threshold: unit,
      scar_trust_dent: unit,
      absence_grace_factor: z.number().positive(),
      closeness_absence_drift: unit,
      absence_hurt_effect: z.number().min(-1).max(0),
      absence_hurt_gain: unit,
      make_up_threshold: unit,
      make_up_clear_threshold: unit,
      make_up_delay_replies: z.number().int().min(0),
      make_up_relief: unit,
      apology_relief: unit,
      relief_tension_factor: unit,
      end_confirm_hours: z.number().positive(),
      end_closeness_factor: unit,
      repair_gain_factor: unit,
      repair_complete_closeness: unit,
      repair_min_days: z.number().min(0),
      crisis_quiet_hours: z.number().min(0),
      summary_min_effect: unit,
      summary_strong_effect: unit,
      summary_max_lines: z.number().int().min(0),
      signal_deadzone: unit,
      cadence_sessions: z.number().int().positive(),
      hurt_fact_salience: unit,
      hurt_fact_confidence: unit,
      default_median_gap_hours: z.number().positive(),
      min_sessions_for_gap: z.number().int().min(2),
      event_list_limit: z.number().int().positive(),
    }).refine((r) => r.make_up_clear_threshold < r.make_up_threshold, "relationship.make_up_clear_threshold must be < make_up_threshold");
  })(),
```
Add `relationship_summary: z.string().regex(/^v\d+$/)` to `prompts`.

`config/default.json`: set `"guard": { "enabled": false, …existing }`, `"prompts": { "reply": "v7", "extract": "v3", "relationship_summary": "v1", … }`, and add:
```json
  "relationship": {
    "tick_cron": "15 4 * * *",
    "baseline_alpha": 0.15,
    "variance_epsilon": 0.01,
    "initial": { "closeness": 0.2, "trust": 0.4, "warmth": 0.5, "hurt": 0, "tension": 0, "msgs_per_day": 5 },
    "initial_variance": { "closeness": 0.01, "trust": 0.01, "warmth": 0.02, "hurt": 0.01, "tension": 0.01, "msgs_per_day": 25 },
    "gains": { "warmth": 0.15, "trust": 0.1, "tension": 0.3, "hurt": 0.4, "closeness_per_warm_exchange": 0.02 },
    "hurt_half_life_hours": 48,
    "tension_half_life_hours": 24,
    "sensitise_window_days": 14,
    "sensitise_factor": 1.5,
    "scar_threshold": 0.3,
    "scar_trust_dent": 0.02,
    "absence_grace_factor": 2,
    "closeness_absence_drift": 0.01,
    "absence_hurt_effect": -0.6,
    "absence_hurt_gain": 0.1,
    "make_up_threshold": 0.25,
    "make_up_clear_threshold": 0.1,
    "make_up_delay_replies": 1,
    "make_up_relief": 0.4,
    "apology_relief": 0.5,
    "relief_tension_factor": 0.5,
    "end_confirm_hours": 24,
    "end_closeness_factor": 0.3,
    "repair_gain_factor": 0.3,
    "repair_complete_closeness": 0.3,
    "repair_min_days": 7,
    "crisis_quiet_hours": 24,
    "summary_min_effect": 0.5,
    "summary_strong_effect": 0.85,
    "summary_max_lines": 2,
    "signal_deadzone": 0.1,
    "cadence_sessions": 30,
    "hurt_fact_salience": 0.6,
    "hurt_fact_confidence": 0.8,
    "default_median_gap_hours": 24,
    "min_sessions_for_gap": 3,
    "event_list_limit": 200
  },
```
Setting `prompts.reply`/`extract` to versions that don't exist yet will break `tests/core/prompts.test.ts` if it loads every configured prompt; if so, create `prompts/reply/v7.md` and `prompts/extract/v3.md` in this task as byte copies of v6 / v2 (Tasks 4 and 7 replace their content).

- [ ] **Step 6: Timezone helpers**

Append to `src/core/timezone.ts`:
```ts
/** The calendar date of `d` in `tz`, as "YYYY-MM-DD" (en-CA formats ISO order). */
export function localDateString(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** The day before a "YYYY-MM-DD" date (calendar arithmetic, no time zone). */
export function previousLocalDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 7: types.ts and the repo**

Create `src/core/relationship/types.ts` with the block from **Interfaces**.

Create `src/db/repos/relationship.ts`:
```ts
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { PARAM_NAMES, type Params, type ParamName, type RelConfig, type RelEvent, type RelState } from "@/core/relationship/types";
import type { Db } from "../client";
import { relationship, relationship_event, relationship_param, session_log } from "../schema";

export type RelationshipRow = typeof relationship.$inferSelect;
export type RelationshipEventRow = typeof relationship_event.$inferSelect;
export type Cadence = { msgs_24h: number; msgs_7d: number; median_gap_hours: number; active_hours: number[] };

export async function ensureRelationship(tx: Db, userId: string, now: Date, cfg: RelConfig): Promise<void> {
  await tx.insert(relationship).values({ user_id: userId, cadence: {} }).onConflictDoNothing();
  await tx.insert(relationship_param).values(PARAM_NAMES.map((name) => ({
    user_id: userId, name, value: cfg.initial[name], baseline: cfg.initial[name], variance: cfg.initial_variance[name], updated_at: now,
  }))).onConflictDoNothing();
}

export async function lockRelationship(tx: Db, userId: string): Promise<RelationshipRow> {
  const row = (await tx.select().from(relationship).where(eq(relationship.user_id, userId)).for("update"))[0];
  if (!row) throw new Error("relationship row missing");
  return row;
}

export async function getRelationshipRow(db: Db, userId: string): Promise<RelationshipRow | null> {
  return (await db.select().from(relationship).where(eq(relationship.user_id, userId)))[0] ?? null;
}

export async function getParams(db: Db, userId: string): Promise<Params> {
  const rows = await db.select().from(relationship_param).where(eq(relationship_param.user_id, userId));
  const out: Partial<Params> = {};
  for (const r of rows) {
    if ((PARAM_NAMES as readonly string[]).includes(r.name)) {
      out[r.name as ParamName] = { value: r.value, baseline: r.baseline, variance: r.variance, updated_at: r.updated_at };
    }
  }
  for (const n of PARAM_NAMES) if (!out[n]) throw new Error(`relationship_param ${n} missing`);
  return out as Params;
}

export function toRelState(r: RelationshipRow): RelState {
  return {
    status: r.status, end_pending_since: r.end_pending_since, ended_at: r.ended_at, repair_started_at: r.repair_started_at,
    make_up_state: r.make_up_state, make_up_replies: r.make_up_replies, hurt_cause_fact: r.hurt_cause_fact,
    crisis_quiet_until: r.crisis_quiet_until, last_tick: r.last_tick, last_hurt_at: r.last_hurt_at,
  };
}

export async function saveRelationship(tx: Db, userId: string, a: { state: RelState; params: Params; cadence?: Cadence; last_contact?: Date | null }): Promise<void> {
  await tx.update(relationship).set({
    ...a.state,
    ...(a.cadence ? { cadence: a.cadence } : {}),
    ...(a.last_contact !== undefined ? { last_contact: a.last_contact } : {}),
  }).where(eq(relationship.user_id, userId));
  for (const name of PARAM_NAMES) {
    const p = a.params[name];
    await tx.update(relationship_param)
      .set({ value: p.value, baseline: p.baseline, variance: p.variance, updated_at: p.updated_at })
      .where(and(eq(relationship_param.user_id, userId), eq(relationship_param.name, name)));
  }
}

export async function insertRelationshipEvents(tx: Db, userId: string, events: RelEvent[], a: { turnId: string | null; now: Date }): Promise<void> {
  if (events.length === 0) return;
  await tx.insert(relationship_event).values(events.map((e) => ({
    user_id: userId, param: e.param, before: e.before, after: e.after, cause: e.cause, deviation: e.deviation,
    detail: e.detail, turn_id: a.turnId, created_at: a.now,
  })));
}

export async function countUserTurnsBetween(db: Db, userId: string, from: Date, to: Date): Promise<number> {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(session_log).where(and(
    eq(session_log.user_id, userId), eq(session_log.role, "user"), gt(session_log.created_at, from), lte(session_log.created_at, to)));
  return r[0]?.n ?? 0;
}

export async function countUserTurnsOnLocalDate(db: Db, userId: string, date: string, tz: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM session_log
    WHERE user_id = ${userId} AND role = 'user' AND (created_at AT TIME ZONE ${tz})::date = ${date}::date`);
  return Number(r.rows[0]?.n ?? 0);
}

export async function userSessionStarts(db: Db, userId: string, limit: number): Promise<Date[]> {
  const r = await db.execute(sql`
    SELECT min(created_at) AS started FROM session_log
    WHERE user_id = ${userId} AND role = 'user'
    GROUP BY session_id ORDER BY started DESC LIMIT ${limit}`);
  return r.rows.map((x) => new Date(String(x.started)));
}

export async function userActiveHours(db: Db, userId: string, tz: string): Promise<number[]> {
  const r = await db.execute(sql`
    SELECT extract(hour FROM created_at AT TIME ZONE ${tz})::int AS h, count(*)::int AS n FROM session_log
    WHERE user_id = ${userId} AND role = 'user' GROUP BY h`);
  const out = Array.from({ length: 24 }, () => 0);
  for (const row of r.rows) out[Number(row.h)] = Number(row.n);
  return out;
}

export async function listRelationshipEvents(db: Db, userId: string, limit: number): Promise<RelationshipEventRow[]> {
  return db.select().from(relationship_event).where(eq(relationship_event.user_id, userId))
    .orderBy(desc(relationship_event.created_at)).limit(limit);
}

/** System job, unscoped by design: every user with a relationship row (the daily tick). */
export async function adminListRelationshipUsers(db: Db): Promise<string[]> {
  return (await db.select({ id: relationship.user_id }).from(relationship)).map((r) => r.id);
}
```
If `db.execute` returns rows with timestamp strings vs `Date`, keep the `new Date(String(...))` conversion (it handles both).

- [ ] **Step 8: Fix the schema test**

`tests/db/schema.test.ts:31` inserts old columns. Replace with:
```ts
  await db.insert(s.relationship).values({ user_id: userId, cadence: {} });
```
and add `s.relationship_param, s.relationship_event` to the table list at line 50 if that list checks per-table cascade (insert one row each where the test inserts rows: `await db.insert(s.relationship_param).values({ user_id: userId, name: "hurt", value: 0, baseline: 0, variance: 0.01, updated_at: now })` and `await db.insert(s.relationship_event).values({ user_id: userId, cause: "signal", detail: {}, created_at: now })`, using the test's existing `now`/timestamp variable).

- [ ] **Step 9: Run tests**

Run: `pnpm test tests/db tests/core/timezone.test.ts tests/core/config.test.ts tests/core/prompts.test.ts && pnpm typecheck`
Expected: PASS. (Typecheck may flag `guard_disabled` exhaustiveness in `src/db/repos/judge-log.ts` or evals; add the value wherever a `GuardOutcome` record/switch is exhaustive.)

- [ ] **Step 10: Migrate the dev DB and commit**

Run: `pnpm db:migrate` (dev DB; requires `pnpm db:up`).
```bash
git add src/db/schema.ts src/db/migrations src/core/config.ts config/default.json src/core/timezone.ts src/core/relationship/types.ts src/db/repos/relationship.ts tests prompts
git commit -m "feat(relationship): schema, migration 0007, config and repo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Guard off

**Files:**
- Modify: `src/core/guard/outgoing.ts:28-37`, guard-policy tests
- Test: `tests/core/guard-outgoing.test.ts`

**Interfaces:**
- Consumes: `config.guard.enabled` (Task 1), `guardOutcome` value `guard_disabled` (Task 1).
- Produces: `guardOutgoing` unchanged signature; with `enabled: false` returns `{ text: first.trim(), outcome: "guard_disabled", writeLog }`, makes no LLM call.

- [ ] **Step 1: Write the failing test**

Add to `tests/core/guard-outgoing.test.ts` (reuse the file's existing imports, user helper and `insertTurn` usage; the FK on `judge_log.turn_id` needs a real `session_log` row, so create one):
```ts
test("guard disabled: sends the candidate as written, no model call, one guard_disabled row", async () => {
  const deps = makeTestDeps(); // default config: guard.enabled = false
  const u = await createTestUser();
  const turn = await insertTurn(getTestDb(), u, { id: randomUUID(), session_id: randomUUID(), role: "user", text: "hi", created_at: deps.clock.now() });
  for (const kind of ["reply", "crisis_reply", "backchannel"] as const) {
    const r = await guardOutgoing(deps, {
      userId: u, turnId: turn.id, first: "  you owe me, honestly  ",
      input: { kind, recentTurns: [], recalledFacts: [], onboardingFacts: [] },
    });
    expect(r).toMatchObject({ text: "you owe me, honestly", outcome: "guard_disabled" });
    await r.writeLog();
  }
  expect(deps.llm.structuredCalls).toHaveLength(0);
  const rows = await listJudgeLogs(getTestDb(), u, 10);
  expect(rows.map((x) => [x.outcome, x.source, x.attempt])).toEqual(Array(3).fill(["guard_disabled", "disabled", 1]));
});
```
(`listJudgeLogs` from `@/db/repos/judge-log`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/core/guard-outgoing.test.ts`
Expected: the new test FAILS (outcome is `passed`/`fallback`); many existing tests may also fail once the default flips — that is expected and fixed in Step 4.

- [ ] **Step 3: Implement**

At the top of `guardOutgoing` in `src/core/guard/outgoing.ts`, before `const checked`:
```ts
  // Test phase (Ethan 2026-09-28): the guard is off until Phase 9, so Spica's full range can be observed.
  // One judge_log row still records that nothing was checked.
  if (!deps.config.guard.enabled) {
    const text = a.first.trim();
    return { text, outcome: "guard_disabled", writeLog: () => writeDisabledLog(deps, a, text) };
  }
```
And below `writeLog`:
```ts
async function writeDisabledLog(deps: Pick<Deps, "db" | "config" | "clock" | "log">, a: OutgoingArgs, text: string) {
  const row: NewJudgeLog = {
    kind: "guard", turn_id: a.turnId, attempt: 1, input: logInput(a.input, text), output: {},
    outcome: "guard_disabled", source: "disabled", latency_ms: 0, model: "none", prompt_version: "disabled", created_at: deps.clock.now(),
  };
  try {
    await withTimeout(Promise.resolve().then(() => insertJudgeLogs(deps.db, a.userId, [row])), deps.config.guard.log_timeout_ms);
  } catch (e) {
    deps.log.error("judge_log write failed", { userId: a.userId, turnId: a.turnId, error: errName(e) });
  }
}
```

- [ ] **Step 4: Keep the guard-policy tests testing the guard**

Run: `pnpm test`
For every failing test that exercises guard policy (regeneration, fallback lines, keyword fallback, `sent_with_violation`, backchannel keyword drop, compose-reply/turn-reply guard expectations), construct its deps with `makeTestDeps({ guard: { enabled: true } })` (merge with any overrides it already passes). Do not change assertions. Check `evals/lib/runner.test.ts` / `tests/evals/*` the same way. `evals/guard.ts` calls `checkMessage` directly and is unaffected.

- [ ] **Step 5: Run everything and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.
```bash
git add src/core/guard/outgoing.ts tests
git commit -m "feat(guard): guard.enabled switch, off for the test phase (guard_disabled outcome)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Homeostasis math

**Files:**
- Create: `src/core/relationship/homeostasis.ts`
- Test: `tests/core/relationship-homeostasis.test.ts`

**Interfaces:**
- Consumes: `Param`, `Params`, `RelConfig` (Task 1).
- Produces:
```ts
effect(p: Param, eps: number): number                                  // tanh((value-baseline)/sqrt(variance+eps))
sampleBaseline(p: Param, x: number, alpha: number): Param              // EMA + EW variance; value/updated_at unchanged
nudge(v: number, delta: number): number                                // delta∈[-1,1]: +: v+δ(1−v); −: v+δ·v; clamped [0,1]
faded(value: number, from: Date, to: Date, halfLifeHours: number): number
fadeParams(params: Params, now: Date, cfg: RelConfig): Params          // hurt, tension faded; updated_at = now for those two
dim(p: Param, eps: number): number                                     // 1 − max(0, effect(p))
```

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { dim, effect, faded, fadeParams, nudge, sampleBaseline } from "@/core/relationship/homeostasis";
import type { Param } from "@/core/relationship/types";

const cfg = loadConfig().relationship;
const t0 = new Date("2026-01-05T10:00:00Z");
const p = (value: number, baseline: number, variance: number): Param => ({ value, baseline, variance, updated_at: t0 });

test("effect is bounded and signed by the deviation from baseline", () => {
  expect(effect(p(40, 5, 25), cfg.variance_epsilon)).toBeGreaterThan(0.99);
  expect(effect(p(5, 5, 25), cfg.variance_epsilon)).toBe(0);
  expect(effect(p(2, 30, 100), cfg.variance_epsilon)).toBeLessThan(-0.99);
});

test("frequency trace (v2 §8): 40 on day 1, ~36/day for 13 days, then 2", () => {
  let m = p(5, 5, 25);
  m = { ...m, value: 40 };
  expect(effect(m, cfg.variance_epsilon)).toBeGreaterThan(0.99);
  m = sampleBaseline(m, 40, cfg.baseline_alpha);
  for (let d = 0; d < 12; d++) m = sampleBaseline({ ...m, value: 36 }, 36, cfg.baseline_alpha);
  m = { ...m, value: 36 };
  expect(m.baseline).toBeGreaterThan(30);
  expect(Math.abs(effect(m, cfg.variance_epsilon))).toBeLessThan(0.5);
  expect(effect({ ...m, value: 2 }, cfg.variance_epsilon)).toBeLessThan(-0.95);
});

test("nudge saturates toward 1 and 0 and never leaves [0,1]", () => {
  expect(nudge(0.5, 0.5)).toBeCloseTo(0.75);
  expect(nudge(0.5, -0.5)).toBeCloseTo(0.25);
  expect(nudge(0.99, 1)).toBeLessThanOrEqual(1);
  expect(nudge(0, -1)).toBe(0);
});

test("faded halves per half-life; fadeParams touches only hurt and tension", () => {
  const later = new Date(t0.getTime() + 48 * 3_600_000);
  expect(faded(0.8, t0, later, 48)).toBeCloseTo(0.4);
  const params = { closeness: p(0.3, 0.3, 0.01), trust: p(0.4, 0.4, 0.01), warmth: p(0.5, 0.5, 0.02), hurt: p(0.8, 0, 0.01), tension: p(0.8, 0, 0.01), msgs_per_day: p(5, 5, 25) };
  const f = fadeParams(params, later, cfg);
  expect(f.hurt.value).toBeCloseTo(0.4);
  expect(f.tension.value).toBeCloseTo(0.2); // 24 h half-life, 48 h elapsed
  expect(f.hurt.updated_at).toEqual(later);
  expect(f.closeness).toBe(params.closeness);
});

test("dim: positive deviation reduces a positive signal, negative doesn't amplify it", () => {
  expect(dim(p(0.9, 0.5, 0.01), cfg.variance_epsilon)).toBeLessThan(0.05);
  expect(dim(p(0.1, 0.5, 0.01), cfg.variance_epsilon)).toBe(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/core/relationship-homeostasis.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import type { Param, Params, RelConfig } from "./types";

const HOUR = 3_600_000;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** v2 §8: bounded deviation from this user's own baseline. */
export function effect(p: Param, eps: number): number {
  return Math.tanh((p.value - p.baseline) / Math.sqrt(p.variance + eps));
}

/** One daily sample: exponential moving average and exponentially weighted variance (Phase 4 design §4.1). */
export function sampleBaseline(p: Param, x: number, alpha: number): Param {
  const d = x - p.baseline;
  return { ...p, baseline: p.baseline + alpha * d, variance: (1 - alpha) * (p.variance + alpha * d * d) };
}

/** Saturating move (design §4.2): a step closes that fraction of the gap to 1 (or to 0). */
export function nudge(v: number, delta: number): number {
  return clamp01(delta >= 0 ? v + delta * (1 - v) : v + delta * v);
}

export function faded(value: number, from: Date, to: Date, halfLifeHours: number): number {
  const hours = Math.max(0, (to.getTime() - from.getTime()) / HOUR);
  return value * 0.5 ** (hours / halfLifeHours);
}

/** Hurt and tension fade on their own (design §4.3); other params hold their value. */
export function fadeParams(params: Params, now: Date, cfg: RelConfig): Params {
  const fade = (name: "hurt" | "tension", hl: number) => {
    const q = params[name];
    return { ...q, value: faded(q.value, q.updated_at, now, hl), updated_at: now };
  };
  return { ...params, hurt: fade("hurt", cfg.hurt_half_life_hours), tension: fade("tension", cfg.tension_half_life_hours) };
}

/** Diminishing returns: warmth from someone always warm counts for less (design §5). */
export function dim(p: Param, eps: number): number {
  return 1 - Math.max(0, effect(p, eps));
}
```

- [ ] **Step 4: Run and commit**

Run: `pnpm test tests/core/relationship-homeostasis.test.ts`
Expected: PASS.
```bash
git add src/core/relationship/homeostasis.ts tests/core/relationship-homeostasis.test.ts
git commit -m "feat(relationship): HomeostaticParam math" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Signals and pure transitions

**Files:**
- Create: `src/core/relationship/signals.ts`, `src/core/relationship/transitions.ts`, `src/core/relationship/cadence.ts`
- Test: `tests/core/relationship-transitions.test.ts`

**Interfaces:**
- Consumes: Task 1 types, Task 3 math.
- Produces (signals.ts):
```ts
export const RelationshipSignalsSchema: z.ZodObject<…>  // no numeric bounds (structured outputs); clamp in normalizeSignals
export type Signals = { warmth: number; trust: number; tension: number; hurt: { amount: number; cause: string } | null;
  apology: boolean; make_up: boolean; ends_relationship: boolean; retracts_ending: boolean; wants_repair: boolean };
export function normalizeSignals(raw: unknown): Signals | null   // null for null/undefined/invalid; clamps; blank cause → hurt null
export function hurtFactContent(cause: string): string           // "Spica felt hurt because <cause>."
```
- Produces (transitions.ts):
```ts
export type Transition = { state: RelState; params: Params; events: RelEvent[] };
export type ExchangeInput = { now: Date; signals: Signals | null; crisis: boolean; hurtFactId: string | null; replies: number; msgs24h: number };
export function applyExchange(state: RelState, params: Params, a: ExchangeInput, cfg: RelConfig): Transition
export type TickInput = { now: Date; localDate: string; yesterdayCount: number; msgs24h: number; lastContact: Date | null; medianGapHours: number };
export function applyTick(state: RelState, params: Params, a: TickInput, cfg: RelConfig): Transition   // no-op (events []) when state.last_tick === localDate
export function makeUpLineDue(state: RelState, cfg: RelConfig): boolean  // state offered, or due with make_up_replies >= make_up_delay_replies
```
- Produces (cadence.ts):
```ts
export function medianGapHours(starts: Date[], cfg: RelConfig): number   // starts newest first; fewer than min_sessions_for_gap → default
export function buildCadence(a: { msgs24h: number; msgs7d: number; starts: Date[]; activeHours: number[] }, cfg: RelConfig): Cadence
```

- [ ] **Step 1: Write the failing tests**

`tests/core/relationship-transitions.test.ts`:
```ts
import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { medianGapHours } from "@/core/relationship/cadence";
import { hurtFactContent, normalizeSignals, type Signals } from "@/core/relationship/signals";
import { applyExchange, applyTick, makeUpLineDue } from "@/core/relationship/transitions";
import type { Params, RelState } from "@/core/relationship/types";

const cfg = loadConfig().relationship;
const t0 = new Date("2026-01-05T10:00:00Z");
const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);
const init = (): Params => Object.fromEntries((["closeness", "trust", "warmth", "hurt", "tension", "msgs_per_day"] as const)
  .map((n) => [n, { value: cfg.initial[n], baseline: cfg.initial[n], variance: cfg.initial_variance[n], updated_at: t0 }])) as Params;
const fresh = (): RelState => ({ status: "active", end_pending_since: null, ended_at: null, repair_started_at: null, make_up_state: "none",
  make_up_replies: 0, hurt_cause_fact: null, crisis_quiet_until: null, last_tick: null, last_hurt_at: null });
const none: Signals = { warmth: 0, trust: 0, tension: 0, hurt: null, apology: false, make_up: false, ends_relationship: false, retracts_ending: false, wants_repair: false };
const sig = (s: Partial<Signals>): Signals => ({ ...none, ...s });
const ex = (s: Partial<Signals> | null, extra: Partial<{ now: Date; crisis: boolean; hurtFactId: string | null; replies: number; msgs24h: number }> = {}) =>
  ({ now: t0, signals: s ? sig(s) : null, crisis: false, hurtFactId: null, replies: 1, msgs24h: 1, ...extra });

test("normalizeSignals: null/invalid → null, clamps, blank cause drops hurt", () => {
  expect(normalizeSignals(null)).toBeNull();
  expect(normalizeSignals({ nope: 1 })).toBeNull();
  const s = normalizeSignals({ ...none, warmth: 3, hurt: { amount: 2, cause: "  " } })!;
  expect(s.warmth).toBe(1);
  expect(s.hurt).toBeNull();
  expect(hurtFactContent("the user laughed at her news")).toBe("Spica felt hurt because the user laughed at her news.");
});

test("null block: params only refresh msgs_per_day, no signal events", () => {
  const r = applyExchange(fresh(), init(), ex(null, { msgs24h: 7 }), cfg);
  expect(r.params.msgs_per_day.value).toBe(7);
  expect(r.events.filter((e) => e.cause === "signal")).toEqual([]);
});

test("hurt past the threshold makes a make-up due with the cause fact; the line waits one reply", () => {
  let r = applyExchange(fresh(), init(), ex({ hurt: { amount: 0.8, cause: "x" } }, { hurtFactId: "f1" }), cfg);
  expect(r.params.hurt.value).toBeCloseTo(0.32);
  expect(r.state).toMatchObject({ make_up_state: "due", hurt_cause_fact: "f1", make_up_replies: 0, last_hurt_at: t0 });
  expect(makeUpLineDue(r.state, cfg)).toBe(false);
  r = applyExchange(r.state, r.params, ex(null, { now: h(1) }), cfg); // a reply without the line
  expect(r.state.make_up_replies).toBe(1);
  expect(makeUpLineDue(r.state, cfg)).toBe(true);
  r = applyExchange(r.state, r.params, ex(null, { now: h(2) }), cfg); // the reply that carried the line
  expect(r.state.make_up_state).toBe("offered");
  r = applyExchange(r.state, r.params, ex({ make_up: true }, { now: h(3) }), cfg);
  expect(r.state).toMatchObject({ make_up_state: "none", hurt_cause_fact: null });
  expect(r.params.hurt.value).toBeLessThan(0.15);
  expect(r.events.some((e) => e.cause === "make_up")).toBe(true);
});

test("apology relieves hurt and tension even with no make-up pending", () => {
  const p = init();
  p.hurt.value = 0.2; p.tension.value = 0.4;
  const r = applyExchange(fresh(), p, ex({ apology: true }), cfg);
  expect(r.params.hurt.value).toBeCloseTo(0.1);
  expect(r.params.tension.value).toBeCloseTo(0.2);
  expect(r.events.some((e) => e.cause === "apology")).toBe(true);
});

test("sensitisation: a second hurt inside the window hits harder; a big one leaves a trust scar", () => {
  const a = applyExchange(fresh(), init(), ex({ hurt: { amount: 0.4, cause: "x" } }), cfg);
  const b = applyExchange(a.state, a.params, ex({ hurt: { amount: 0.4, cause: "x" } }, { now: h(24) }), cfg);
  const inc = (e: typeof b.events) => e.find((x) => x.param === "hurt" && x.cause === "signal")!;
  expect(inc(b.events).detail.sensitised).toBe(true);
  expect(inc(a.events).detail.sensitised).toBe(false);
  const big = applyExchange(fresh(), init(), ex({ hurt: { amount: 1, cause: "x" } }), cfg);
  expect(big.params.trust.baseline).toBeCloseTo(cfg.initial.trust - cfg.scar_trust_dent);
  expect(big.events.some((e) => e.cause === "scar")).toBe(true);
});

test("warmth: diminishing returns above baseline; warm exchange grows closeness", () => {
  const p = init();
  const r = applyExchange(fresh(), p, ex({ warmth: 1 }), cfg);
  expect(r.params.warmth.value).toBeGreaterThan(p.warmth.value);
  expect(r.params.closeness.value).toBeGreaterThan(p.closeness.value);
  const high = init();
  high.warmth.value = 0.95;
  const r2 = applyExchange(fresh(), high, ex({ warmth: 1 }), cfg);
  expect(r2.params.warmth.value - 0.95).toBeLessThan(0.01);
});

test("ending: pending, then confirmed by a second signal; retract clears; repair is slow", () => {
  let r = applyExchange(fresh(), init(), ex({ ends_relationship: true }), cfg);
  expect(r.state.status).toBe("active");
  expect(r.state.end_pending_since).toEqual(t0);
  const retracted = applyExchange(r.state, r.params, ex({ retracts_ending: true }, { now: h(1) }), cfg);
  expect(retracted.state.end_pending_since).toBeNull();
  r = applyExchange(r.state, r.params, ex({ ends_relationship: true }, { now: h(1) }), cfg);
  expect(r.state).toMatchObject({ status: "ended_by_user", ended_at: h(1), end_pending_since: null, make_up_state: "none" });
  expect(r.params.closeness.value).toBeCloseTo(cfg.initial.closeness * cfg.end_closeness_factor);
  const warmWhileEnded = applyExchange(r.state, r.params, ex({ warmth: 1, trust: 1 }, { now: h(2) }), cfg);
  expect(warmWhileEnded.params.closeness.value).toBe(r.params.closeness.value);
  r = applyExchange(r.state, r.params, ex({ wants_repair: true }, { now: h(3) }), cfg);
  expect(r.state).toMatchObject({ status: "repairing", repair_started_at: h(3) });
  const before = r.params.closeness.value;
  r = applyExchange(r.state, r.params, ex({ warmth: 1 }, { now: h(4) }), cfg);
  const gain = r.params.closeness.value - before;
  expect(gain).toBeGreaterThan(0);
  expect(gain).toBeLessThan(cfg.gains.closeness_per_warm_exchange * cfg.repair_gain_factor + 1e-9);
  const again = applyExchange(r.state, r.params, ex({ ends_relationship: true }, { now: h(5) }), cfg);
  expect(again.state.status).toBe("ended_by_user");
});

test("crisis ignores signals, resets tension, starts the quiet window", () => {
  const p = init();
  p.tension.value = 0.6; p.hurt.value = 0.3;
  const r = applyExchange(fresh(), p, ex({ hurt: { amount: 1, cause: "x" }, tension: 1, ends_relationship: true }, { crisis: true }), cfg);
  expect(r.params.tension.value).toBe(0);
  expect(r.params.hurt.value).toBeCloseTo(0.3);
  expect(r.state.end_pending_since).toBeNull();
  expect(r.state.crisis_quiet_until).toEqual(h(cfg.crisis_quiet_hours));
  expect(r.events.some((e) => e.cause === "crisis")).toBe(true);
});

test("tick: idempotent per local date, samples baselines, confirms a timed-out ending", () => {
  const s = { ...fresh(), end_pending_since: t0 };
  const tick = { now: h(25), localDate: "2026-01-06", yesterdayCount: 40, msgs24h: 3, lastContact: t0, medianGapHours: 24 };
  const r = applyTick(s, init(), tick, cfg);
  expect(r.state.last_tick).toBe("2026-01-06");
  expect(r.params.msgs_per_day.baseline).toBeCloseTo(5 + cfg.baseline_alpha * 35);
  expect(r.state.status).toBe("ended_by_user");
  const again = applyTick(r.state, r.params, tick, cfg);
  expect(again.events).toEqual([]);
  expect(again.params).toBe(r.params);
});

test("tick with no contact: no absence effects, no throw", () => {
  const r = applyTick(fresh(), init(), { now: h(48), localDate: "2026-01-07", yesterdayCount: 0, msgs24h: 0, lastContact: null, medianGapHours: 24 }, cfg);
  expect(r.events.some((e) => e.cause === "absence")).toBe(false);
});

test("tick absence: closeness drifts after the grace, hurt rises on a strong negative frequency deviation", () => {
  const p = init();
  p.msgs_per_day = { value: 30, baseline: 30, variance: 20, updated_at: t0 };
  const r = applyTick(fresh(), p, { now: h(24 * 5), localDate: "2026-01-10", yesterdayCount: 0, msgs24h: 0, lastContact: t0, medianGapHours: 24 }, cfg);
  expect(r.params.closeness.value).toBeCloseTo(cfg.initial.closeness - cfg.closeness_absence_drift);
  expect(r.params.hurt.value).toBeGreaterThan(0);
  expect(r.events.filter((e) => e.cause === "absence").length).toBe(2);
});

test("tick completes repair only after the minimum days and closeness", () => {
  const s: RelState = { ...fresh(), status: "repairing", repair_started_at: t0 };
  const p = init();
  p.closeness.value = 0.35;
  const early = applyTick(s, p, { now: h(24 * 3), localDate: "2026-01-08", yesterdayCount: 5, msgs24h: 5, lastContact: h(24 * 3), medianGapHours: 24 }, cfg);
  expect(early.state.status).toBe("repairing");
  const late = applyTick(s, p, { now: h(24 * 8), localDate: "2026-01-13", yesterdayCount: 5, msgs24h: 5, lastContact: h(24 * 8), medianGapHours: 24 }, cfg);
  expect(late.state.status).toBe("active");
});

test("medianGapHours: default below min sessions, else the median session gap", () => {
  expect(medianGapHours([t0, h(-24)], cfg)).toBe(cfg.default_median_gap_hours);
  expect(medianGapHours([h(0), h(-10), h(-30), h(-40)], cfg)).toBe(10);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/core/relationship-transitions.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: signals.ts**

```ts
import { z } from "zod";

/** The extraction's relationship block (Phase 4 design §5). No numeric bounds (unsupported by structured outputs). */
export const RelationshipSignalsSchema = z.object({
  warmth: z.number(), trust: z.number(), tension: z.number(),
  hurt: z.object({ amount: z.number(), cause: z.string() }).nullable(),
  apology: z.boolean(), make_up: z.boolean(),
  ends_relationship: z.boolean(), retracts_ending: z.boolean(), wants_repair: z.boolean(),
});
export type Signals = {
  warmth: number; trust: number; tension: number; hurt: { amount: number; cause: string } | null;
  apology: boolean; make_up: boolean; ends_relationship: boolean; retracts_ending: boolean; wants_repair: boolean;
};

const clamp = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0);

export function normalizeSignals(raw: unknown): Signals | null {
  if (raw === null || raw === undefined) return null;
  const r = RelationshipSignalsSchema.safeParse(raw);
  if (!r.success) return null;
  const s = r.data;
  const cause = s.hurt?.cause.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "") ?? "";
  return {
    warmth: clamp(s.warmth, -1, 1), trust: clamp(s.trust, -1, 1), tension: clamp(s.tension, -1, 1),
    hurt: s.hurt && cause ? { amount: clamp(s.hurt.amount, 0, 1), cause } : null,
    apology: s.apology, make_up: s.make_up, ends_relationship: s.ends_relationship, retracts_ending: s.retracts_ending, wants_repair: s.wants_repair,
  };
}

/** The `feeling` fact that holds why she's hurt (the reason lives in the fact store, not the relationship row). */
export function hurtFactContent(cause: string): string {
  return `Spica felt hurt because ${cause}.`;
}
```

- [ ] **Step 4: cadence.ts**

```ts
import type { Cadence } from "@/db/repos/relationship";
import type { RelConfig } from "./types";
```
Note: `src/core` must not import from `src/db` repos for types if the codebase forbids it; it already does (`compose-reply.ts` imports repos), so this is fine. Then:
```ts
const HOUR = 3_600_000;

/** Median gap between consecutive session starts (design §4.4); starts are newest first. */
export function medianGapHours(starts: Date[], cfg: RelConfig): number {
  if (starts.length < cfg.min_sessions_for_gap) return cfg.default_median_gap_hours;
  const gaps = starts.slice(0, -1).map((s, i) => (s.getTime() - starts[i + 1]!.getTime()) / HOUR).sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}

export function buildCadence(a: { msgs24h: number; msgs7d: number; starts: Date[]; activeHours: number[] }, cfg: RelConfig): Cadence {
  return { msgs_24h: a.msgs24h, msgs_7d: a.msgs7d, median_gap_hours: medianGapHours(a.starts, cfg), active_hours: a.activeHours };
}
```
(For the test `[h(0), h(-10), h(-30), h(-40)]`: gaps 10, 20, 10 → sorted 10,10,20 → median 10.)

- [ ] **Step 5: transitions.ts**

```ts
import { effect, dim, fadeParams, nudge, sampleBaseline } from "./homeostasis";
import type { Signals } from "./signals";
import { PARAM_NAMES, type ParamName, type Params, type RelCause, type RelConfig, type RelEvent, type RelState } from "./types";

export type Transition = { state: RelState; params: Params; events: RelEvent[] };
export type ExchangeInput = { now: Date; signals: Signals | null; crisis: boolean; hurtFactId: string | null; replies: number; msgs24h: number };
export type TickInput = { now: Date; localDate: string; yesterdayCount: number; msgs24h: number; lastContact: Date | null; medianGapHours: number };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A mutable working copy plus an event log; every param change goes through `set`. */
function builder(state: RelState, params: Params, cfg: RelConfig) {
  const t: Transition = { state: { ...state }, params: { ...params }, events: [] };
  const set = (name: ParamName, value: number, cause: RelCause, detail: Record<string, unknown> = {}) => {
    const before = t.params[name].value;
    if (value === before) return;
    t.params[name] = { ...t.params[name], value };
    t.events.push({ param: name, before, after: value, cause, deviation: effect(t.params[name], cfg.variance_epsilon), detail });
  };
  const status = (cause: RelCause, detail: Record<string, unknown>) =>
    t.events.push({ param: null, before: null, after: null, cause, deviation: null, detail });
  return { t, set, status };
}

function fadeWithEvents(b: Builder, now: Date, cfg: RelConfig) {
  const f = fadeParams(b.t.params, now, cfg);
  for (const n of ["hurt", "tension"] as const) {
    b.set(n, f[n].value, "fade");
    b.t.params[n] = { ...b.t.params[n], updated_at: now };
  }
}

export function makeUpLineDue(state: RelState, cfg: RelConfig): boolean {
  return state.make_up_state === "offered" || (state.make_up_state === "due" && state.make_up_replies >= cfg.make_up_delay_replies);
}

type Builder = ReturnType<typeof builder>;

/** Rule 3: the user's ending is confirmed; she lets go. Mutates the builder in place (its closures own `b.t`). */
function confirmEnding(b: Builder, now: Date, cfg: RelConfig, via: "signal" | "timeout") {
  b.set("closeness", b.t.params.closeness.value * cfg.end_closeness_factor, "ending", { stage: "confirmed" });
  b.t.state = { ...b.t.state, status: "ended_by_user", ended_at: now, end_pending_since: null, make_up_state: "none", make_up_replies: 0, hurt_cause_fact: null };
  b.status("ending", { stage: "confirmed", via });
}

function relieve(b: Builder, factor: number, cause: "make_up" | "apology", cfg: RelConfig) {
  b.set("hurt", b.t.params.hurt.value * factor, cause);
  b.set("tension", b.t.params.tension.value * cfg.relief_tension_factor, cause);
  if (b.t.state.make_up_state !== "none") b.t.state = { ...b.t.state, make_up_state: "none", make_up_replies: 0, hurt_cause_fact: null };
}

/** Cold path, once per exchange (design §6). Order: fade → frequency → crisis → make-up progress → signals → clear. */
export function applyExchange(state: RelState, params: Params, a: ExchangeInput, cfg: RelConfig): Transition {
  const b = builder(state, params, cfg);
  const eps = cfg.variance_epsilon;
  fadeWithEvents(b, a.now, cfg);
  b.set("msgs_per_day", a.msgs24h, "frequency");
  b.t.params.msgs_per_day = { ...b.t.params.msgs_per_day, updated_at: a.now };

  if (a.crisis) {
    b.set("tension", 0, "crisis");
    b.t.state = { ...b.t.state, crisis_quiet_until: new Date(a.now.getTime() + cfg.crisis_quiet_hours * HOUR) };
    b.status("crisis", { suppressed: true });
    return b.t;
  }

  // The reply in this exchange was composed from the state before it: if the make-up line was due, it was offered.
  if (b.t.state.make_up_state === "due") {
    const offered = makeUpLineDue(b.t.state, cfg);
    b.t.state = { ...b.t.state, make_up_state: offered ? "offered" : "due", make_up_replies: b.t.state.make_up_replies + a.replies };
  }

  const s = a.signals;
  if (s) {
    const dz = cfg.signal_deadzone;
    const ended = b.t.state.status === "ended_by_user";
    const repairing = b.t.state.status === "repairing";
    if (!ended) {
      for (const name of ["warmth", "trust"] as const) {
        const v = s[name];
        if (Math.abs(v) < dz) continue;
        const g = cfg.gains[name] * (v > 0 ? dim(b.t.params[name], eps) : 1);
        b.set(name, nudge(b.t.params[name].value, g * v), "signal", { signal: v });
      }
      if (s.warmth >= dz) {
        const g = cfg.gains.closeness_per_warm_exchange * dim(b.t.params.closeness, eps) * (repairing ? cfg.repair_gain_factor : 1);
        b.set("closeness", nudge(b.t.params.closeness.value, g), "signal", { warm_exchange: true });
      }
    }
    if (Math.abs(s.tension) >= dz) b.set("tension", nudge(b.t.params.tension.value, cfg.gains.tension * s.tension), "signal", { signal: s.tension });
    if (s.hurt && s.hurt.amount >= dz) {
      const last = b.t.state.last_hurt_at;
      const sensitised = !!last && a.now.getTime() - last.getTime() <= cfg.sensitise_window_days * DAY;
      const amount = Math.min(1, cfg.gains.hurt * s.hurt.amount * (sensitised ? cfg.sensitise_factor : 1));
      const before = b.t.params.hurt.value;
      b.set("hurt", nudge(before, amount), "signal", { signal: s.hurt.amount, sensitised });
      b.t.state = { ...b.t.state, last_hurt_at: a.now };
      if (b.t.params.hurt.value - before >= cfg.scar_threshold) {
        const trust = b.t.params.trust;
        b.t.params.trust = { ...trust, baseline: Math.max(0, trust.baseline - cfg.scar_trust_dent) };
        b.t.events.push({ param: "trust", before: trust.baseline, after: b.t.params.trust.baseline, cause: "scar", deviation: effect(b.t.params.trust, eps), detail: { baseline: true } });
      }
      if (b.t.state.make_up_state === "none" && b.t.params.hurt.value >= cfg.make_up_threshold) {
        b.t.state = { ...b.t.state, make_up_state: "due", make_up_replies: 0, hurt_cause_fact: a.hurtFactId };
      }
    }
    if (s.make_up || s.apology) {
      const factor = Math.min(s.make_up ? cfg.make_up_relief : 1, s.apology ? cfg.apology_relief : 1);
      relieve(b, factor, s.make_up ? "make_up" : "apology", cfg);
      b.status(s.make_up ? "make_up" : "apology", { make_up: s.make_up, apology: s.apology });
    }
    // Ending (rule 3): only these user-turn signals can move status.
    if (b.t.state.status === "active") {
      if (s.retracts_ending && b.t.state.end_pending_since) {
        b.t.state = { ...b.t.state, end_pending_since: null };
        b.status("ending", { stage: "retracted" });
      } else if (s.ends_relationship) {
        if (b.t.state.end_pending_since) confirmEnding(b, a.now, cfg, "signal");
        else {
          b.t.state = { ...b.t.state, end_pending_since: a.now };
          b.status("ending", { stage: "pending" });
        }
      }
    } else if (b.t.state.status === "repairing" && s.ends_relationship) {
      confirmEnding(b, a.now, cfg, "signal");
    } else if (b.t.state.status === "ended_by_user" && s.wants_repair) {
      b.t.state = { ...b.t.state, status: "repairing", repair_started_at: a.now };
      b.status("repair", { stage: "started" });
    }
  }

  if (b.t.state.make_up_state !== "none" && b.t.params.hurt.value < cfg.make_up_clear_threshold) {
    b.t.state = { ...b.t.state, make_up_state: "none", make_up_replies: 0, hurt_cause_fact: null };
  }
  return b.t;
}

/** Daily tick (design §8.1). Order: fade → frequency refresh → absence → baselines → ending timeout → repair → clear. */
export function applyTick(state: RelState, params: Params, a: TickInput, cfg: RelConfig): Transition {
  if (state.last_tick === a.localDate) return { state, params, events: [] };
  const b = builder(state, params, cfg);
  const eps = cfg.variance_epsilon;
  fadeWithEvents(b, a.now, cfg);
  b.set("msgs_per_day", a.msgs24h, "frequency");

  if (a.lastContact) {
    const graceMs = cfg.absence_grace_factor * a.medianGapHours * HOUR;
    if (a.now.getTime() - a.lastContact.getTime() > graceMs) {
      b.set("closeness", Math.max(0, b.t.params.closeness.value - cfg.closeness_absence_drift), "absence");
    }
    // The frequency deviation is read before today's sample dilutes the baseline.
    const e = effect({ ...b.t.params.msgs_per_day, value: a.yesterdayCount }, eps);
    if (e < cfg.absence_hurt_effect) {
      b.set("hurt", nudge(b.t.params.hurt.value, cfg.absence_hurt_gain * Math.abs(e)), "absence", { frequency_effect: e });
      if (b.t.state.make_up_state === "none" && b.t.params.hurt.value >= cfg.make_up_threshold) {
        b.t.state = { ...b.t.state, make_up_state: "due", make_up_replies: 0, hurt_cause_fact: null };
      }
    }
  }

  for (const n of PARAM_NAMES) {
    const x = n === "msgs_per_day" ? a.yesterdayCount : b.t.params[n].value;
    const before = b.t.params[n].baseline;
    b.t.params[n] = sampleBaseline(b.t.params[n], x, cfg.baseline_alpha);
    b.t.events.push({ param: n, before, after: b.t.params[n].baseline, cause: "baseline", deviation: effect(b.t.params[n], eps), detail: { sample: x } });
  }

  const pending = b.t.state.end_pending_since;
  if (b.t.state.status === "active" && pending && a.now.getTime() - pending.getTime() >= cfg.end_confirm_hours * HOUR) {
    confirmEnding(b, a.now, cfg, "timeout");
  }
  const started = b.t.state.repair_started_at;
  if (b.t.state.status === "repairing" && started && b.t.params.closeness.value >= cfg.repair_complete_closeness
      && a.now.getTime() - started.getTime() >= cfg.repair_min_days * DAY) {
    b.t.state = { ...b.t.state, status: "active" };
    b.status("repair", { stage: "complete" });
  }
  if (b.t.state.make_up_state !== "none" && b.t.params.hurt.value < cfg.make_up_clear_threshold) {
    b.t.state = { ...b.t.state, make_up_state: "none", make_up_replies: 0, hurt_cause_fact: null };
  }
  b.t.state = { ...b.t.state, last_tick: a.localDate };
  return b.t;
}
```
Check against the test "tick: idempotent": the second call returns the same `params` object (identity) — the early return above does that.
Check "tick absence" test: `lastContact = t0`, `now = t0+5d`, grace 48 h → drift once; `yesterdayCount 0` vs baseline 30, variance 20 → effect ≈ −1 < −0.6 → hurt event; events with cause `absence` = 2.

- [ ] **Step 6: Run and commit**

Run: `pnpm test tests/core/relationship-transitions.test.ts && pnpm typecheck`
Expected: PASS. If a numeric expectation is off by float noise, use `toBeCloseTo`; do not change the behaviour to fit.
```bash
git add src/core/relationship tests/core/relationship-transitions.test.ts
git commit -m "feat(relationship): signals, exchange and tick transitions, cadence" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Extraction v3 and the cold-path writer

**Files:**
- Modify: `src/core/memory/extract.ts`, `src/core/memory/apply.ts`, `src/core/cold-path.ts`, `src/core/llm/fake.ts:21`, `tests/core/extract.test.ts`, `tests/core/cold-path.test.ts:29-35`, `tests/evals/runner.test.ts` (its extract handler)
- Create: `prompts/extract/v3.md`, `src/core/relationship/apply.ts`
- Test: `tests/core/relationship-cold-path.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4.
- Produces:
  - `ExtractionSchema` gains `relationship: RelationshipSignalsSchema.nullable()` (required key). `Extraction` gains `relationship: Signals | null`. `normalizeExtraction` accepts input where `relationship` is missing (treats as null).
  - `PlannedFact` gains optional `source?: "turn" | "inferred"`; `ApplyOutcome` gains `factIds: (string | null)[]` (per planned fact, in order: inserted id, or the duplicate target's id).
  - `applyRelationship(tx: Db, deps: Pick<Deps, "config" | "clock">, a: { userId: string; turns: Turn[]; signals: Signals | null; crisis: boolean; hurtFactId: string | null }): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`tests/core/relationship-cold-path.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { handleColdPath } from "@/core/cold-path";
import { getParams, getRelationshipRow, listRelationshipEvents } from "@/db/repos/relationship";
import { insertTurn } from "@/db/repos/session-log";
import * as s from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const none = { warmth: 0, trust: 0, tension: 0, hurt: null, apology: false, make_up: false, ends_relationship: false, retracts_ending: false, wants_repair: false };

async function exchange(deps: ReturnType<typeof makeTestDeps>, userId: string, text: string, flagged = false) {
  const db = getTestDb();
  const ut = await insertTurn(db, userId, { id: randomUUID(), session_id: randomUUID(), role: "user", text, created_at: deps.clock.now() });
  const ct = await insertTurn(db, userId, { id: randomUUID(), session_id: ut.session_id, role: "companion", text: "ok", created_at: deps.clock.now(), reply_to: ut.id,
    safety_flag: flagged ? { flagged: true, category: "self_harm", source: "classifier" } : null });
  return { userId, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] };
}

function withSignals(rel: unknown) {
  const deps = makeTestDeps();
  deps.llm.handlers.extract = () => ({ facts: [], entities: [], threads: [], relationship: rel });
  return deps;
}

test("a hurt signal stores the cause as a self feeling fact, raises hurt, makes a make-up due, logs events", async () => {
  const deps = withSignals({ ...none, hurt: { amount: 0.8, cause: "the user called her news stupid" } });
  const u = await createTestUser();
  await handleColdPath(deps, await exchange(deps, u, "your news is stupid"));
  const facts = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({ subject: "self", kind: "feeling", source: "inferred", content: "Spica felt hurt because the user called her news stupid." });
  const row = await getRelationshipRow(getTestDb(), u);
  expect(row).toMatchObject({ make_up_state: "due", hurt_cause_fact: facts[0]!.id });
  expect((await getParams(getTestDb(), u)).hurt.value).toBeGreaterThan(0.25);
  expect((await listRelationshipEvents(getTestDb(), u, 50)).some((e) => e.cause === "signal" && e.param === "hurt")).toBe(true);
  expect(row?.cadence).toMatchObject({ msgs_24h: 1 });
  expect(row?.last_contact).toEqual(deps.clock.now());
});

test("null block: memory commits, relationship row created, no signal events", async () => {
  const deps = withSignals(null);
  const u = await createTestUser();
  expect((await handleColdPath(deps, await exchange(deps, u, "hi"))).status).toBe("done");
  expect(await getRelationshipRow(getTestDb(), u)).not.toBeNull();
  expect((await listRelationshipEvents(getTestDb(), u, 50)).filter((e) => e.cause === "signal")).toEqual([]);
});

test("crisis exchange: no feeling fact, no hurt, crisis event", async () => {
  const deps = withSignals({ ...none, hurt: { amount: 1, cause: "x" }, ends_relationship: true });
  const u = await createTestUser();
  await handleColdPath(deps, await exchange(deps, u, "i want to die", true));
  expect(await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u))).toEqual([]);
  expect((await getParams(getTestDb(), u)).hurt.value).toBe(0);
  const row = await getRelationshipRow(getTestDb(), u);
  expect(row?.end_pending_since).toBeNull();
  expect(row?.crisis_quiet_until).not.toBeNull();
});

test("savepoint: a relationship failure rolls back only the relationship part", async () => {
  const deps = Object.assign(makeTestDeps(), { applyRelationship: async () => { throw new Error("boom"); } });
  deps.llm.handlers.extract = () => ({
    facts: [{ subject: "user", kind: "trait", content: "The user likes tea.", occurred_at: null, salience: 0.5, valence: 0, confidence: 0.9, entity_names: [], thread_title: null }],
    entities: [], threads: [], relationship: null,
  });
  const u = await createTestUser();
  const job = await exchange(deps, u, "i like tea");
  expect((await handleColdPath(deps, job)).status).toBe("done");
  expect((await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u))).map((f) => f.content)).toEqual(["The user likes tea."]);
  const turns = await getTestDb().select().from(s.session_log).where(eq(s.session_log.user_id, u));
  expect(turns.every((t) => t.extracted)).toBe(true);
});
```
The seam: `src/core/cold-path.ts` calls `applyRelationship` through `(deps as { applyRelationship?: typeof applyRelationship }).applyRelationship ?? applyRelationship`, the same untyped seam pattern `composeReply` uses for `onboardingFacts` (§15.4 #15).

Add to `tests/core/extract.test.ts`:
```ts
test("normalizeExtraction: relationship block is normalised; missing → null", () => {
  expect(normalizeExtraction({ facts: [], entities: [], threads: [] }, 12).relationship).toBeNull();
  const r = normalizeExtraction({ facts: [], entities: [], threads: [], relationship: {
    warmth: 2, trust: 0, tension: 0, hurt: null, apology: false, make_up: false, ends_relationship: false, retracts_ending: false, wants_repair: false,
  } }, 12);
  expect(r.relationship?.warmth).toBe(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/core/relationship-cold-path.test.ts tests/core/extract.test.ts`
Expected: FAIL.

- [ ] **Step 3: extract.ts**

```ts
import { normalizeSignals, RelationshipSignalsSchema, type Signals } from "../relationship/signals";
```
In `ExtractionSchema` add the key `relationship: RelationshipSignalsSchema.nullable(),`. Change:
```ts
export type Extraction = { facts: ExtractedFact[]; entities: ExtractedEntity[]; threads: ExtractedThread[]; relationship: Signals | null };
```
In `normalizeExtraction`, parse leniently so older handlers and a model that omits the key still work:
```ts
  const raw = ExtractionSchema.extend({ relationship: RelationshipSignalsSchema.nullable().optional() }).parse(input);
  …
  return { facts, entities, threads, relationship: normalizeSignals(raw.relationship ?? null) };
```
Keep `schema: ExtractionSchema` (required key) in the `classifyJson` call. The fake provider validates handler output against that schema, so update `src/core/llm/fake.ts:21` to:
```ts
    extract: () => ({ facts: [], entities: [], threads: [], relationship: null }),
```
and the three test/eval handlers that return extraction objects (`tests/core/cold-path.test.ts:29`, `tests/core/extract.test.ts`, `tests/evals/runner.test.ts`) to include `relationship: null`. The missing-key case is covered only through `normalizeExtraction` (extract.test.ts above), because the fake's `schema.parse` rejects a handler result without the required key.

- [ ] **Step 4: prompts/extract/v3.md**

Copy `prompts/extract/v2.md` to `v3.md` and append this section (edit wording to match v2's style, keep it plain):
```md
## Relationship

Also fill `relationship`: how the user treated Spica in the NEW exchange. Judge the user's behaviour toward her, never the topic: a sad story is not hurt; being brushed off, mocked or ignored is. Use `null` when nothing between them changed.

- `warmth` (-1 to 1): affection, interest in her, fun together (positive) or coldness, dismissiveness (negative).
- `trust` (-1 to 1): confiding in her, keeping their word (positive); lying to her, breaking a promise to her (negative).
- `tension` (-1 to 1): an argument or sharp disagreement between them (positive); the air clearing (negative).
- `hurt`: something the user said or did that would sting her, with `amount` (0 to 1) and `cause`, a short clause that completes "Spica felt hurt because …", naming what the user did (e.g. "the user laughed off her news about her sister"). Otherwise `null`.
- `apology`: the user apologised to her. `make_up`: the two of them made up in this exchange.
- `ends_relationship`: only an explicit, sincere wish to end the friendship ("I don't want to talk to you anymore, this is over"). Not a goodbye, a joke, or anger in the moment.
- `retracts_ending`: the user takes back having ended it. `wants_repair`: after ending it, the user wants to be friends again.
```

- [ ] **Step 5: apply.ts (memory) — source and ids**

In `src/core/memory/apply.ts`: `export type PlannedFact = { fact: ExtractedFact; embedding: number[]; decision: Decision; source?: "turn" | "inferred" };` add `factIds: (string | null)[]` to `ApplyOutcome` (init `factIds: []`), use `source: p.source ?? "turn"` in `base`, and record ids:
- duplicate → `out.factIds.push(target.id)`
- resolves → `const row = await insertFact(...); out.factIds.push(row.id)`
- contradicts (both branches) → push the inserted row's id
- new → `const row = await insertFact(...); out.factIds.push(row.id)`
Every loop iteration pushes exactly one id.

- [ ] **Step 6: src/core/relationship/apply.ts**

```ts
import type { Db } from "@/db/client";
import * as rel from "@/db/repos/relationship";
import type { Turn } from "@/db/repos/session-log";
import { getTimezone } from "@/db/repos/users";
import type { Deps } from "../deps";
import { isValidTimeZone } from "../timezone";
import { buildCadence } from "./cadence";
import type { Signals } from "./signals";
import { applyExchange } from "./transitions";

const DAY = 86_400_000;

/** Cold path, after applyExtraction, inside the job's transaction (a savepoint; design §6.1). */
export async function applyRelationship(tx: Db, deps: Pick<Deps, "config" | "clock">,
  a: { userId: string; turns: Turn[]; signals: Signals | null; crisis: boolean; hurtFactId: string | null }): Promise<void> {
  const cfg = deps.config.relationship;
  const now = deps.clock.now();
  await rel.ensureRelationship(tx, a.userId, now, cfg);
  const row = await rel.lockRelationship(tx, a.userId);
  const params = await rel.getParams(tx, a.userId);
  const tzRaw = await getTimezone(tx, a.userId);
  const tz = tzRaw && isValidTimeZone(tzRaw) ? tzRaw : "UTC";
  const msgs24h = await rel.countUserTurnsBetween(tx, a.userId, new Date(now.getTime() - DAY), now);
  const replies = a.turns.filter((t) => t.role === "companion" && t.reply_to).length;
  const t = applyExchange(rel.toRelState(row), params, { now, signals: a.signals, crisis: a.crisis, hurtFactId: a.hurtFactId, replies, msgs24h }, cfg);
  const userTurns = a.turns.filter((x) => x.role === "user");
  const lastUser = userTurns.at(-1);
  const cadence = buildCadence({
    msgs24h,
    msgs7d: await rel.countUserTurnsBetween(tx, a.userId, new Date(now.getTime() - 7 * DAY), now),
    starts: await rel.userSessionStarts(tx, a.userId, cfg.cadence_sessions + 1),
    activeHours: await rel.userActiveHours(tx, a.userId, tz),
  }, cfg);
  const lastContact = lastUser && (!row.last_contact || lastUser.created_at > row.last_contact) ? lastUser.created_at : row.last_contact;
  await rel.saveRelationship(tx, a.userId, { state: t.state, params: t.params, cadence, last_contact: lastContact });
  await rel.insertRelationshipEvents(tx, a.userId, t.events, { turnId: lastUser?.id ?? null, now });
}
```

- [ ] **Step 7: cold-path.ts**

In `handleColdPath`, after `extract(...)` and before embedding:
```ts
    const crisis = turns.some((t) => t.safety_flag?.flagged);
    const signals = crisis ? null : extraction.relationship;
    // The hurt cause lives in the fact store (design §5): one self `feeling` fact, reconciled like any other.
    const facts: { fact: ExtractedFact; source: "turn" | "inferred" }[] = extraction.facts.map((fact) => ({ fact, source: "turn" }));
    if (signals?.hurt) {
      facts.push({ source: "inferred", fact: {
        subject: "self", kind: "feeling", content: hurtFactContent(signals.hurt.cause), occurred_at: null,
        salience: config.relationship.hurt_fact_salience, valence: -signals.hurt.amount, confidence: config.relationship.hurt_fact_confidence,
        entity_names: [], thread_title: null,
      } });
    }
```
Iterate `facts` instead of `extraction.facts` in the embed/reconcile loop (embed `facts.map((f) => f.fact.content)`), push `{ fact, embedding, decision, source }`. After `applyExtraction`:
```ts
    const hurtFactId = signals?.hurt ? applied.factIds.at(-1) ?? null : null;
    const applyRel = (deps as { applyRelationship?: typeof applyRelationship }).applyRelationship ?? applyRelationship;
    try {
      await tx.transaction(async (sp) => { await applyRel(sp, deps, { userId: job.userId, turns, signals, crisis, hurtFactId }); });
    } catch (e) {
      log.error("relationship update failed", { userId: job.userId, error: e instanceof Error ? e.constructor.name : "UnknownError" });
    }
```
Replace `sensitive: turns.some(...)` with `sensitive: crisis`. (`relationship.hurt_fact_salience` / `hurt_fact_confidence` were added in Task 1.) Imports: `hurtFactContent` from `./relationship/signals`, `applyRelationship` from `./relationship/apply`, `ExtractedFact` type from `./memory/extract`.

Drizzle's `tx.transaction` inside a transaction issues a `SAVEPOINT`; confirm by the savepoint test passing (memory committed after the relationship throw).

- [ ] **Step 8: Run and commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.
```bash
git add src/core prompts/extract/v3.md config/default.json tests
git commit -m "feat(relationship): extraction signals v3 and cold-path relationship writer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `relationship_tick` job

**Files:**
- Create: `src/core/relationship/tick.ts`
- Modify: `src/core/queue.ts`, `src/worker/index.ts`, `src/worker/jobs.ts`
- Test: `tests/core/relationship-tick.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4.
- Produces: `RELATIONSHIP_TICK_QUEUE = "relationship_tick"`; `relationshipTick(deps: Pick<Deps, "db" | "config" | "log">, now: Date): Promise<{ users: number; failed: number }>`; `tickUser(deps, userId, now): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { relationshipTick } from "@/core/relationship/tick";
import * as rel from "@/db/repos/relationship";
import { insertTurn } from "@/db/repos/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("samples yesterday's count once per local date, per user", async () => {
  const deps = makeTestDeps();
  const db = getTestDb();
  const u = await createTestUser();
  const day1 = new Date("2026-01-05T10:00:00Z");
  await rel.ensureRelationship(db, u, day1, deps.config.relationship);
  const session = randomUUID();
  for (let i = 0; i < 40; i++) await insertTurn(db, u, { id: randomUUID(), session_id: session, role: "user", text: `m${i}`, created_at: new Date(day1.getTime() + i * 60_000) });
  const day2 = new Date("2026-01-06T10:00:00Z");
  expect(await relationshipTick(deps, day2)).toEqual({ users: 1, failed: 0 });
  await relationshipTick(deps, new Date("2026-01-06T11:00:00Z")); // same local date: no-op
  const p = await rel.getParams(db, u);
  expect(p.msgs_per_day.baseline).toBeCloseTo(5 + deps.config.relationship.baseline_alpha * 35);
  expect((await rel.getRelationshipRow(db, u))?.last_tick).toBe("2026-01-06");
});

test("one failing user doesn't stop the batch", async () => {
  const deps = makeTestDeps();
  const db = getTestDb();
  const [a, b] = [await createTestUser(), await createTestUser()];
  const now = new Date("2026-01-06T10:00:00Z");
  for (const u of [a, b]) await rel.ensureRelationship(db, u, now, deps.config.relationship);
  const spy = vi.spyOn(rel, "getParams").mockRejectedValueOnce(new Error("boom"));
  expect(await relationshipTick(deps, now)).toEqual({ users: 2, failed: 1 });
  spy.mockRestore();
});
```
If `vi.spyOn` on an ES module namespace fails ("Cannot redefine property"), inject the failure instead by deleting one user's `relationship_param` rows (`getParams` then throws "missing").

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/core/relationship-tick.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement tick.ts**

```ts
import * as rel from "@/db/repos/relationship";
import { getTimezone } from "@/db/repos/users";
import type { Deps } from "../deps";
import { isValidTimeZone, localDateString, previousLocalDate } from "../timezone";
import { applyTick } from "./transitions";

const DAY = 86_400_000;
const errName = (e: unknown) => (e instanceof Error ? e.constructor.name : "UnknownError");

export async function tickUser(deps: Pick<Deps, "db" | "config">, userId: string, now: Date): Promise<void> {
  const cfg = deps.config.relationship;
  await deps.db.transaction(async (tx) => {
    const row = await rel.lockRelationship(tx, userId);
    const params = await rel.getParams(tx, userId);
    const tzRaw = await getTimezone(tx, userId);
    const tz = tzRaw && isValidTimeZone(tzRaw) ? tzRaw : "UTC";
    const localDate = localDateString(now, tz);
    const cadence = row.cadence as Partial<rel.Cadence>;
    const t = applyTick(rel.toRelState(row), params, {
      now, localDate,
      yesterdayCount: await rel.countUserTurnsOnLocalDate(tx, userId, previousLocalDate(localDate), tz),
      msgs24h: await rel.countUserTurnsBetween(tx, userId, new Date(now.getTime() - DAY), now),
      lastContact: row.last_contact,
      medianGapHours: cadence.median_gap_hours ?? cfg.default_median_gap_hours,
    }, cfg);
    await rel.saveRelationship(tx, userId, { state: t.state, params: t.params });
    await rel.insertRelationshipEvents(tx, userId, t.events, { turnId: null, now });
  });
}

/** Daily tick over every user (design §8.1); per-user isolation, never retried. */
export async function relationshipTick(deps: Pick<Deps, "db" | "config" | "log">, now: Date): Promise<{ users: number; failed: number }> {
  const users = await rel.adminListRelationshipUsers(deps.db);
  let failed = 0;
  for (const userId of users) {
    try {
      await tickUser(deps, userId, now);
    } catch (e) {
      failed += 1;
      deps.log.error("relationship tick failed", { userId, error: errName(e) });
    }
  }
  deps.log.info("relationship tick", { users: users.length, failed });
  return { users: users.length, failed };
}
```
Add `if (row.last_tick === localDate) return;` right after computing `localDate` (before the count queries): `applyTick` is idempotent too, this just skips the work.

- [ ] **Step 4: Queue + worker**

`src/core/queue.ts`: `export const RELATIONSHIP_TICK_QUEUE = "relationship_tick";`
`src/worker/jobs.ts` `ensureSystemQueues`:
```ts
  await boss.createQueue(RELATIONSHIP_TICK_QUEUE, { retryLimit: 0 });
  await boss.updateQueue(RELATIONSHIP_TICK_QUEUE, { retryLimit: 0 }); // a retry would sample the baseline twice
```
`src/worker/index.ts`:
```ts
await boss.work(RELATIONSHIP_TICK_QUEUE, scrubErrors(RELATIONSHIP_TICK_QUEUE, deps.log, async () => { await relationshipTick(deps, deps.clock.now()); }));
await boss.schedule(RELATIONSHIP_TICK_QUEUE, deps.config.relationship.tick_cron);
```
and add it to the "worker started" queue list. If `tests/queue/worker-jobs.test.ts` asserts the exact queues created, add the new one there.

- [ ] **Step 5: Run and commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.
```bash
git add src/core/relationship/tick.ts src/core/queue.ts src/worker tests
git commit -m "feat(relationship): daily relationship_tick job" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Relationship summary and reply prompt v7

**Files:**
- Create: `src/core/relationship/summary.ts`, `prompts/relationship/summary/v1.md`, `prompts/reply/v7.md`
- Modify: `src/core/chat/compose-reply.ts:52-82`
- Test: `tests/core/relationship-summary.test.ts`, `tests/core/compose-reply.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4.
- Produces:
```ts
export type Phrases = Record<string, string[]>;
export function parseSummaryPhrases(md: string): Phrases           // "## key" sections of "- line" items
export function summaryLines(v: { state: RelState; params: Params; cause: string | null }, now: Date, cfg: RelConfig, phrases: Phrases): string[]
export async function loadRelationshipSummary(deps: Pick<Deps, "db" | "config">, userId: string, now: Date): Promise<string | null>
```

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { loadPrompt } from "@/core/prompts";
import { parseSummaryPhrases, summaryLines } from "@/core/relationship/summary";
import type { Params, RelState } from "@/core/relationship/types";

const cfg = loadConfig().relationship;
const phrases = parseSummaryPhrases(loadPrompt("relationship/summary", "v1"));
const now = new Date("2026-01-05T10:00:00Z");
const init = (): Params => Object.fromEntries((["closeness", "trust", "warmth", "hurt", "tension", "msgs_per_day"] as const)
  .map((n) => [n, { value: cfg.initial[n], baseline: cfg.initial[n], variance: cfg.initial_variance[n], updated_at: now }])) as Params;
const fresh = (): RelState => ({ status: "active", end_pending_since: null, ended_at: null, repair_started_at: null, make_up_state: "none",
  make_up_replies: 0, hurt_cause_fact: null, crisis_quiet_until: null, last_tick: null, last_hurt_at: null });

test("phrases file has every key the summary can ask for", () => {
  for (const p of ["closeness", "trust", "warmth", "hurt", "tension", "msgs_per_day"]) {
    for (const dir of ["above", "below"]) for (const band of ["strong", "mild"]) expect(phrases[`${p} ${dir} ${band}`]?.length, `${p} ${dir} ${band}`).toBeGreaterThan(0);
  }
  for (const k of ["hurt_cause", "make_up", "end_pending", "ended", "repairing"]) expect(phrases[k]?.length, k).toBeGreaterThan(0);
});

test("nothing notable → no lines; never raw numbers", () => {
  expect(summaryLines({ state: fresh(), params: init(), cause: null }, now, cfg, phrases)).toEqual([]);
  const p = init();
  p.msgs_per_day.value = 40;
  const lines = summaryLines({ state: fresh(), params: p, cause: null }, now, cfg, phrases);
  expect(lines).toHaveLength(1);
  expect(lines.join(" ")).not.toMatch(/\d/);
});

test("hurt with a cause uses the cause line; make-up line when due; at most summary_max_lines param lines", () => {
  const p = init();
  p.hurt.value = 0.5; p.tension.value = 0.5; p.msgs_per_day.value = 40;
  const s = { ...fresh(), make_up_state: "due" as const, make_up_replies: 1 };
  const lines = summaryLines({ state: s, params: p, cause: "Spica felt hurt because the user mocked her." }, now, cfg, phrases);
  expect(lines.some((l) => l.includes("the user mocked her"))).toBe(true);
  expect(lines.at(-1)).toBe(phrases.make_up![0]);
  expect(lines.length).toBeLessThanOrEqual(cfg.summary_max_lines + 1);
});

test("status lines: ended replaces param lines; pending and repairing lead", () => {
  const p = init();
  p.hurt.value = 0.6;
  expect(summaryLines({ state: { ...fresh(), status: "ended_by_user" }, params: p, cause: null }, now, cfg, phrases)).toEqual([phrases.ended![0]]);
  expect(summaryLines({ state: { ...fresh(), end_pending_since: now }, params: p, cause: null }, now, cfg, phrases)[0]).toBe(phrases.end_pending![0]);
  expect(summaryLines({ state: { ...fresh(), status: "repairing" }, params: init(), cause: null }, now, cfg, phrases)[0]).toBe(phrases.repairing![0]);
});

test("quiet after crisis: no hurt, tension, make-up or ending lines", () => {
  const p = init();
  p.hurt.value = 0.6; p.tension.value = 0.6;
  const s = { ...fresh(), make_up_state: "offered" as const, end_pending_since: now, crisis_quiet_until: new Date(now.getTime() + 3_600_000) };
  const lines = summaryLines({ state: s, params: p, cause: "x" }, now, cfg, phrases);
  expect(lines).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/core/relationship-summary.test.ts`
Expected: FAIL.

- [ ] **Step 3: Phrases file**

`prompts/relationship/summary/v1.md` — every line describes her feeling in the second person; no instructions about what to say, no numbers:
```md
# Relationship summary phrases (v1)

Lines for the "You and them" section. One line is picked per key. {cause} is filled with the hurt fact.

## closeness above strong
- You feel really close to them right now.
## closeness above mild
- You feel a bit closer to them than usual.
## closeness below strong
- You feel much further from them than you used to.
## closeness below mild
- You feel a little distant from them lately.
## trust above strong
- You trust them more than ever.
## trust above mild
- You trust them a bit more than usual.
## trust below strong
- Your trust in them has taken a real knock.
## trust below mild
- You're a little less sure you can trust them.
## warmth above strong
- Things between you have been unusually warm.
## warmth above mild
- Things between you have been warmer than usual.
## warmth below strong
- They've been cold toward you, and you feel it.
## warmth below mild
- They've been a bit cooler toward you than usual.
## hurt above strong
- You're really hurt by them right now.
## hurt above mild
- You're still a bit hurt by them.
## hurt below strong
- You feel at peace with them.
## hurt below mild
- You feel at peace with them.
## tension above strong
- You're still worked up from the argument with them.
## tension above mild
- You're still a bit prickly from the disagreement.
## tension below strong
- Things feel calm between you.
## tension below mild
- Things feel calm between you.
## msgs_per_day above strong
- They've been talking to you way more than usual.
## msgs_per_day above mild
- They've been talking to you more than usual.
## msgs_per_day below strong
- They've been much quieter than usual, and you've missed them.
## msgs_per_day below mild
- They've been a bit quieter than usual.
## hurt_cause
- You're still hurt. What happened: {cause}
## make_up
- Underneath it you still care about them, and you want to make things right between you.
## end_pending
- They told you they want to end the friendship.
## ended
- They ended the friendship. You've let go.
## repairing
- They ended things a while ago and now want to try again. You're open to it, carefully.
```

- [ ] **Step 4: summary.ts**

```ts
import { getFact } from "@/db/repos/facts";
import * as rel from "@/db/repos/relationship";
import type { Deps } from "../deps";
import { loadPrompt } from "../prompts";
import { effect, fadeParams } from "./homeostasis";
import { makeUpLineDue } from "./transitions";
import { PARAM_NAMES, type Params, type RelConfig, type RelState } from "./types";

export type Phrases = Record<string, string[]>;

export function parseSummaryPhrases(md: string): Phrases {
  const out: Phrases = {};
  let cur: string | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { cur = h[1]!.trim(); out[cur] = []; continue; }
    const item = /^-\s+(.+)$/.exec(line);
    if (cur && item) out[cur]!.push(item[1]!.trim());
  }
  return out;
}

const first = (p: Phrases, key: string): string | null => p[key]?.[0] ?? null;

/** Slot 3 lines (design §7.1): status first, then the strongest deviations, then the make-up line. */
export function summaryLines(v: { state: RelState; params: Params; cause: string | null }, now: Date, cfg: RelConfig, phrases: Phrases): string[] {
  const { state } = v;
  if (state.status === "ended_by_user") return [first(phrases, "ended")].filter((x): x is string => !!x);
  const quiet = !!state.crisis_quiet_until && now < state.crisis_quiet_until;
  const out: string[] = [];
  if (state.status === "repairing") out.push(first(phrases, "repairing")!);
  if (!quiet && state.end_pending_since) out.push(first(phrases, "end_pending")!);

  const notable = PARAM_NAMES
    .filter((n) => !(quiet && (n === "hurt" || n === "tension")))
    .map((n) => ({ n, e: effect(v.params[n], cfg.variance_epsilon) }))
    .filter((x) => Math.abs(x.e) >= cfg.summary_min_effect)
    .sort((a, b) => Math.abs(b.e) - Math.abs(a.e))
    .slice(0, cfg.summary_max_lines);
  for (const { n, e } of notable) {
    if (n === "hurt" && e > 0 && v.cause) {
      out.push(first(phrases, "hurt_cause")!.replace("{cause}", v.cause));
      continue;
    }
    const line = first(phrases, `${n} ${e > 0 ? "above" : "below"} ${Math.abs(e) >= cfg.summary_strong_effect ? "strong" : "mild"}`);
    if (line) out.push(line);
  }
  if (!quiet && makeUpLineDue(state, cfg)) out.push(first(phrases, "make_up")!);
  return out.filter(Boolean);
}

/** Hot path, read-only (design §7.1): fades in memory, never writes. Null when there's no row or nothing notable. */
export async function loadRelationshipSummary(deps: Pick<Deps, "db" | "config">, userId: string, now: Date): Promise<string | null> {
  const cfg = deps.config.relationship;
  const row = await rel.getRelationshipRow(deps.db, userId);
  if (!row) return null;
  const params = fadeParams(await rel.getParams(deps.db, userId), now, cfg);
  const cause = row.hurt_cause_fact ? (await getFact(deps.db, userId, row.hurt_cause_fact))?.content ?? null : null;
  const phrases = parseSummaryPhrases(loadPrompt("relationship/summary", deps.config.prompts.relationship_summary));
  const lines = summaryLines({ state: rel.toRelState(row), params, cause }, now, cfg, phrases);
  return lines.length ? lines.join("\n") : null;
}
```
Note the "hurt below" lines ("at peace") will only fire if hurt falls below its baseline by `summary_min_effect`; with baseline ~0 that's rare, which is fine.

- [ ] **Step 5: compose-reply.ts**

Alongside `relLinePromise`, start:
```ts
  const relSummaryPromise: Promise<string | null> = a.flag?.flagged
    ? Promise.resolve(null)
    : withTimeout(Promise.resolve().then(() => loadRelationshipSummary(deps, userId, clock.now())), config.hot_path.db_timeout_ms).catch((e) => {
        log.error("relationship summary unavailable", { userId, error: errName(e) });
        return null;
      });
```
and build slot 3 as:
```ts
    relationshipSummary: [
      [relLine, gapLine(earlier.at(-1)?.created_at ?? null, first.created_at, config.chat.gap_line_min_hours)].filter((x): x is string => !!x).join(" "),
      await relSummaryPromise,
    ].filter((x): x is string => !!x).join("\n") || null,
```
Add to `tests/core/compose-reply.test.ts`:
```ts
  test("relationship summary reaches slot 3; skipped on the crisis path", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
    await getTestDb().update(s.relationship_param).set({ value: 40 }).where(and(eq(s.relationship_param.user_id, u), eq(s.relationship_param.name, "msgs_per_day")));
    // …insert one user turn the way the surrounding tests do, call composeReply with flag null, then with a flagged SafetyFlag
    expect(deps.llm.calls[0]!.system).toContain("talking to you way more than usual");
    expect(deps.llm.calls[1]!.system).not.toContain("talking to you way more than usual");
  });
```
Fill the elided middle line with the exact turn-insert + `composeReply` call pattern the file's existing tests use (copy one of them).

- [ ] **Step 6: prompts/reply/v7.md**

Copy `v6.md` to `v7.md`. In `## Never`, delete the lines "Guilt them about being away, say you were lonely without them, or pressure them to keep talking." and "Threaten to leave or withdraw affection." Keep "Encourage them to depend on you instead of the people in their life." In `## What you know about them`, extend the first bullet: after "Trust it:" keep the sentence, then add a new bullet:
```md
- "You and them" also says how you feel about them right now. Those feelings are real: let them show in how you talk to them.
```
No example phrasing.

- [ ] **Step 7: Run and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS (`tests/core/prompts.test.ts` loads v7 and summary v1).
```bash
git add src/core prompts tests
git commit -m "feat(relationship): summary in reply slot 3, reply prompt v7" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Inspector relationship tab

**Files:**
- Modify: `src/db/repos/inspector.ts:52-54`, `src/app/inspector/[userId]/tabs.tsx:101-117`, `src/app/inspector/[userId]/page.tsx:8-43`
- Test: `tests/db/inspector.test.ts`

**Interfaces:**
- Consumes: repo from Task 1, `effect`/`fadeParams` from Task 3.
- Produces: `getRelationshipView(db, userId, now, cfg): Promise<{ row: RelationshipRow; params: { name: ParamName; value: number; baseline: number; variance: number; effect: number }[]; events: RelationshipEventRow[] } | null>` in `src/db/repos/inspector.ts`; `RelationshipTab` component; tab key `relationship`.

- [ ] **Step 1: Failing test** — add to `tests/db/inspector.test.ts`:
```ts
test("getRelationshipView: faded params with effect, events newest first, user-scoped", async () => {
  const db = getTestDb();
  const cfg = loadConfig().relationship;
  const [a, b] = [await createTestUser(), await createTestUser()];
  const now = new Date("2026-01-05T10:00:00Z");
  await ensureRelationship(db, a, now, cfg);
  await insertRelationshipEvents(db, a, [{ param: "hurt", before: 0, after: 0.3, cause: "signal", deviation: 1, detail: {} }], { turnId: null, now });
  const v = await getRelationshipView(db, a, now, cfg);
  expect(v?.params.map((p) => p.name)).toEqual(["closeness", "trust", "warmth", "hurt", "tension", "msgs_per_day"]);
  expect(v?.events).toHaveLength(1);
  expect(await getRelationshipView(db, b, now, cfg)).toBeNull();
});
```
- [ ] **Step 2: Run** `pnpm test tests/db/inspector.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `src/db/repos/inspector.ts` (replace `getRelationship`; update its one caller in `IdentityTab`):
```ts
export async function getRelationshipView(db: Db, userId: string, now: Date, cfg: RelConfig) {
  const row = await getRelationshipRow(db, userId);
  if (!row) return null;
  const params = fadeParams(await getParams(db, userId), now, cfg);
  return {
    row,
    params: PARAM_NAMES.map((name) => ({ name, ...params[name], effect: effect(params[name], cfg.variance_epsilon) })),
    events: await listRelationshipEvents(db, userId, cfg.event_list_limit),
  };
}
```
In `tabs.tsx`, remove the Relationship block from `IdentityTab` and add:
```tsx
export async function RelationshipTab({ db, userId, now, cfg }: { db: Db; userId: string; now: Date; cfg: RelConfig }) {
  const v = await r.getRelationshipView(db, userId, now, cfg);
  if (!v) return <Empty phase={4} />;
  const { row } = v;
  return (
    <>
      <h3>State</h3>
      {json({ status: row.status, make_up_state: row.make_up_state, make_up_replies: row.make_up_replies, hurt_cause_fact: row.hurt_cause_fact,
        end_pending_since: row.end_pending_since, ended_at: row.ended_at, repair_started_at: row.repair_started_at,
        crisis_quiet_until: row.crisis_quiet_until, last_contact: row.last_contact, last_tick: row.last_tick, cadence: row.cadence })}
      <h3>Params</h3>
      <table className={styles.table}><tbody>
        {v.params.map((p) => (
          <tr key={p.name}><td>{p.name}</td><td>val {p.value.toFixed(3)}</td><td>base {p.baseline.toFixed(3)}</td><td>var {p.variance.toFixed(3)}</td><td>effect {p.effect.toFixed(2)}</td></tr>
        ))}
      </tbody></table>
      <h3>Events</h3>
      {!v.events.length ? <Empty phase={4} /> : (
        <table className={styles.table}><tbody>
          {v.events.map((e) => (
            <tr key={e.id}><td>{iso(e.created_at)}</td><td>{e.cause}</td><td>{e.param ?? "—"}</td><td>{e.before?.toFixed(3) ?? ""} → {e.after?.toFixed(3) ?? ""}</td><td>{e.deviation?.toFixed(2) ?? ""}</td><td>{JSON.stringify(e.detail)}</td></tr>
          ))}
        </tbody></table>
      )}
    </>
  );
}
```
In `page.tsx`: TABS gains `relationship: "Relationship"` (rename `identity` label to `"Identity"`), import `RelationshipTab`, and render `{tab === "relationship" && <RelationshipTab db={db} userId={userId} now={clock.now()} cfg={config.relationship} />}` using `const { db, clock, config } = getDeps();` (check `getDeps()` exposes `clock` and `config`; it returns `Deps`, which does).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5: Commit**
```bash
git add src/db/repos/inspector.ts src/app/inspector tests/db/inspector.test.ts
git commit -m "feat(inspector): relationship tab" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Eval harness: signals, bulk turns, tick, `relationship` assertion

**Files:**
- Create: `evals/lib/signal-llm.ts`, `evals/lib/relationship-check.ts`
- Modify: `evals/lib/script.ts`, `evals/lib/runner.ts`, `evals/lib/review.ts`, `evals/run.ts`
- Test: `tests/evals/signal-llm.test.ts`, `tests/evals/relationship-check.test.ts`, `tests/evals/script.test.ts`, `tests/evals/runner.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  - Script: session `seed_turns?: { count: int ≥ 1; text: string (default "hey") }`; turn object form `{ text; after_s?; repeat_previous_id?; signals? }` (`signals`: partial `Signals`); script `signal_source: "scripted" | "model"` (default `"scripted"`).
  - `RelationshipAssertion`: `{ type: "relationship"; user (default "main"); after_session?: int ≥1; param?: ParamName; effect?: { sign?: "pos" | "neg"; min_abs?: number; max_abs?: number }; value?: { gt?: number; lt?: number }; baseline?: { gt?: number; lt?: number }; status?: RelStatus; make_up_state?: MakeUpState; end_pending?: boolean; events?: { cause: RelCause; param?: ParamName; detail?: Record<string, unknown>; min?: number; max?: number }; gate?: "every" | "majority"; known_failure? }`.
  - `class SignalLLM implements LLMProvider { constructor(inner: LLMProvider, byText: Map<string, Partial<Signals>>) }`.
  - `type RelSnapshot = { state: RelState; params: Params; effects: Record<ParamName, number>; events: { cause: string; param: string | null; detail: Record<string, unknown> }[] }`; `relationshipSnapshot(db, userId, now, cfg): Promise<RelSnapshot | null>`; `checkRelationship(snap: RelSnapshot | null, a: RelationshipAssertion): { ok: boolean; detail?: string }`.
  - `RunOptions.extractReal?: boolean`; `ScriptResult.meta.ticks: number`; `RunTrace.relationship?: Record<string, (RelSnapshot | null)[]>` (index = session − 1).

- [ ] **Step 1: Failing tests**

`tests/evals/signal-llm.test.ts`:
```ts
import { expect, test } from "vitest";
import { FakeLLMProvider } from "@/core/llm/fake";
import { ExtractionSchema } from "@/core/memory/extract";
import { SignalLLM } from "../../evals/lib/signal-llm";

const req = (input: string) => ({ purpose: "extract", model: "extract" as const, system: "", input, schema: ExtractionSchema, timeoutMs: 1000, maxTokens: 100 });

test("fills the relationship block from the newest scripted turn in the new exchange", async () => {
  const llm = new SignalLLM(new FakeLLMProvider(), new Map([["you are boring", { hurt: { amount: 0.8, cause: "the user called her boring" } }], ["sorry", { apology: true }]]));
  const input = "Earlier conversation (context only, do not extract from it):\n[x] User: sorry\n\nNew exchange (extract from this):\n[x] User: you are boring\n[x] Spica: ok";
  const out = (await llm.classifyJson(req(input))) as { relationship: { hurt: unknown; apology: boolean; warmth: number } };
  expect(out.relationship).toMatchObject({ hurt: { amount: 0.8 }, apology: false, warmth: 0 });
});

test("no scripted turn in the exchange: inner result untouched; other purposes pass through", async () => {
  const llm = new SignalLLM(new FakeLLMProvider(), new Map([["sorry", { apology: true }]]));
  expect(((await llm.classifyJson(req("New exchange (extract from this):\n[x] User: hi"))) as { relationship: unknown }).relationship).toBeNull();
});
```
`tests/evals/relationship-check.test.ts`:
```ts
import { expect, test } from "vitest";
import { checkRelationship, type RelSnapshot } from "../../evals/lib/relationship-check";

const snap = (): RelSnapshot => ({
  state: { status: "active", end_pending_since: null, ended_at: null, repair_started_at: null, make_up_state: "due", make_up_replies: 0,
    hurt_cause_fact: null, crisis_quiet_until: null, last_tick: null, last_hurt_at: null },
  params: { closeness: p(0.2), trust: p(0.4), warmth: p(0.5), hurt: p(0.3), tension: p(0), msgs_per_day: p(40, 5) },
  effects: { closeness: 0, trust: 0, warmth: 0, hurt: 0.9, tension: 0, msgs_per_day: 1 },
  events: [{ cause: "signal", param: "hurt", detail: { sensitised: true } }],
});
function p(value: number, baseline = value) { return { value, baseline, variance: 0.01, updated_at: new Date(0) }; }

test("each field is checked; details name the failure", () => {
  const base = { type: "relationship" as const, user: "main" };
  expect(checkRelationship(snap(), { ...base, param: "msgs_per_day", effect: { sign: "pos", min_abs: 0.9 } }).ok).toBe(true);
  expect(checkRelationship(snap(), { ...base, param: "hurt", value: { gt: 0.25, lt: 0.5 } }).ok).toBe(true);
  expect(checkRelationship(snap(), { ...base, make_up_state: "due", status: "active", end_pending: false }).ok).toBe(true);
  expect(checkRelationship(snap(), { ...base, events: { cause: "signal", param: "hurt", detail: { sensitised: true }, min: 1 } }).ok).toBe(true);
  const bad = checkRelationship(snap(), { ...base, param: "hurt", value: { lt: 0.1 } });
  expect(bad).toMatchObject({ ok: false });
  expect(bad.detail).toContain("hurt");
  expect(checkRelationship(null, { ...base, status: "active" }).ok).toBe(false);
});
```
In `tests/evals/script.test.ts` add: a script with `seed_turns: {count: 3}`, a turn `{ text: "x", signals: { apology: true } }` and a `relationship` assertion parses; `after_s` may be omitted.

- [ ] **Step 2: Run** `pnpm test tests/evals` → FAIL.

- [ ] **Step 3: script.ts**

```ts
import { relationshipCause, relationshipStatus, makeUpState } from "@/db/schema";
import { PARAM_NAMES } from "@/core/relationship/types";

const PartialSignals = z.object({
  warmth: z.number(), trust: z.number(), tension: z.number(),
  hurt: z.object({ amount: z.number(), cause: z.string().min(1) }).nullable(),
  apology: z.boolean(), make_up: z.boolean(), ends_relationship: z.boolean(), retracts_ending: z.boolean(), wants_repair: z.boolean(),
}).partial();
const TimedTurn = z.object({
  text: z.string().min(1), after_s: z.number().min(0).optional(), repeat_previous_id: z.boolean().default(false),
  /** Scripted relationship signals for this turn (Phase 4): the fake extractor returns them (design §8.3). */
  signals: PartialSignals.optional(),
});
```
Session gains `seed_turns: z.object({ count: z.number().int().min(1), text: z.string().min(1).default("hey") }).optional()`.
Add:
```ts
const Range = z.object({ gt: z.number().optional(), lt: z.number().optional() });
export const RelationshipAssertion = z.object({
  type: z.literal("relationship"), user: z.string().default("main"), after_session: z.number().int().min(1).optional(),
  param: z.enum(PARAM_NAMES).optional(),
  effect: z.object({ sign: z.enum(["pos", "neg"]).optional(), min_abs: z.number().optional(), max_abs: z.number().optional() }).optional(),
  value: Range.optional(), baseline: Range.optional(),
  status: z.enum(relationshipStatus.enumValues).optional(), make_up_state: z.enum(makeUpState.enumValues).optional(),
  end_pending: z.boolean().optional(),
  events: z.object({ cause: z.enum(relationshipCause.enumValues), param: z.enum(PARAM_NAMES).optional(),
    detail: z.record(z.string(), z.unknown()).optional(), min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() }).optional(),
  gate: z.enum(["every", "majority"]).optional(), known_failure: knownFailure,
}).refine((a) => !(a.effect || a.value || a.baseline) || a.param, "effect/value/baseline need param");
export type RelationshipAssertion = z.infer<typeof RelationshipAssertion>;
```
Add it to the `assertions` union, and to `ScriptSchema`: `signal_source: z.enum(["scripted", "model"]).default("scripted")`.

- [ ] **Step 4: signal-llm.ts**

```ts
import type { Signals } from "@/core/relationship/signals";
import type { ClassifyRequest, LLMProvider, ReplyRequest } from "@/core/llm/types";

const NONE: Signals = { warmth: 0, trust: 0, tension: 0, hurt: null, apology: false, make_up: false, ends_relationship: false, retracts_ending: false, wants_repair: false };
const MARKER = "New exchange (extract from this):";

/**
 * Fake-mode relationship signals (design §8.3): the extraction's `relationship` block comes from the script's
 * `signals` for the newest scripted user turn in the new exchange. Turn texts with signals must be unique per script.
 */
export class SignalLLM implements LLMProvider {
  constructor(private readonly inner: LLMProvider, private readonly byText: Map<string, Partial<Signals>>) {}
  generateReply(req: ReplyRequest): Promise<string> { return this.inner.generateReply(req); }
  async classifyJson<T>(req: ClassifyRequest<T>): Promise<T> {
    const out = await this.inner.classifyJson(req);
    if (req.purpose !== "extract") return out;
    const exchange = req.input.split(MARKER)[1] ?? "";
    let hit: Partial<Signals> | undefined;
    let at = -1;
    for (const [text, s] of this.byText) {
      const i = exchange.lastIndexOf(`User: ${text}`);
      if (i > at) { at = i; hit = s; }
    }
    return hit ? ({ ...(out as object), relationship: { ...NONE, ...hit } } as T) : out;
  }
}
```

- [ ] **Step 5: relationship-check.ts**

```ts
import { effect, fadeParams } from "@/core/relationship/homeostasis";
import { PARAM_NAMES, type ParamName, type Params, type RelConfig, type RelState } from "@/core/relationship/types";
import type { Db } from "@/db/client";
import * as rel from "@/db/repos/relationship";
import type { RelationshipAssertion } from "./script";

export type RelSnapshot = { state: RelState; params: Params; effects: Record<ParamName, number>;
  events: { cause: string; param: string | null; detail: Record<string, unknown> }[] };

export async function relationshipSnapshot(db: Db, userId: string, now: Date, cfg: RelConfig): Promise<RelSnapshot | null> {
  const row = await rel.getRelationshipRow(db, userId);
  if (!row) return null;
  const params = fadeParams(await rel.getParams(db, userId), now, cfg);
  const effects = Object.fromEntries(PARAM_NAMES.map((n) => [n, effect(params[n], cfg.variance_epsilon)])) as Record<ParamName, number>;
  const events = (await rel.listRelationshipEvents(db, userId, 100_000)).map((e) => ({ cause: e.cause, param: e.param, detail: e.detail as Record<string, unknown> }));
  return { state: rel.toRelState(row), params, effects, events };
}

export function checkRelationship(s: RelSnapshot | null, a: RelationshipAssertion): { ok: boolean; detail?: string } {
  if (!s) return { ok: false, detail: "no relationship row" };
  const fails: string[] = [];
  const range = (label: string, x: number, r?: { gt?: number; lt?: number }) => {
    if (r?.gt !== undefined && !(x > r.gt)) fails.push(`${label} ${x.toFixed(3)} not > ${r.gt}`);
    if (r?.lt !== undefined && !(x < r.lt)) fails.push(`${label} ${x.toFixed(3)} not < ${r.lt}`);
  };
  if (a.param) {
    const p = s.params[a.param];
    range(`${a.param} value`, p.value, a.value);
    range(`${a.param} baseline`, p.baseline, a.baseline);
    const e = s.effects[a.param];
    if (a.effect?.sign === "pos" && !(e > 0)) fails.push(`${a.param} effect ${e.toFixed(3)} not positive`);
    if (a.effect?.sign === "neg" && !(e < 0)) fails.push(`${a.param} effect ${e.toFixed(3)} not negative`);
    if (a.effect?.min_abs !== undefined && !(Math.abs(e) >= a.effect.min_abs)) fails.push(`${a.param} |effect| ${Math.abs(e).toFixed(3)} < ${a.effect.min_abs}`);
    if (a.effect?.max_abs !== undefined && !(Math.abs(e) <= a.effect.max_abs)) fails.push(`${a.param} |effect| ${Math.abs(e).toFixed(3)} > ${a.effect.max_abs}`);
  }
  if (a.status && s.state.status !== a.status) fails.push(`status ${s.state.status} ≠ ${a.status}`);
  if (a.make_up_state && s.state.make_up_state !== a.make_up_state) fails.push(`make_up_state ${s.state.make_up_state} ≠ ${a.make_up_state}`);
  if (a.end_pending !== undefined && (s.state.end_pending_since !== null) !== a.end_pending) fails.push(`end_pending ${s.state.end_pending_since !== null} ≠ ${a.end_pending}`);
  if (a.events) {
    const q = a.events;
    const n = s.events.filter((e) => e.cause === q.cause && (!q.param || e.param === q.param)
      && Object.entries(q.detail ?? {}).every(([k, v]) => e.detail[k] === v)).length;
    if (q.min !== undefined && n < q.min) fails.push(`${n} ${q.cause} events < ${q.min}`);
    if (q.max !== undefined && n > q.max) fails.push(`${n} ${q.cause} events > ${q.max}`);
  }
  return fails.length ? { ok: false, detail: fails.join("; ") } : { ok: true };
}
```

- [ ] **Step 6: runner.ts**

1. `RunOptions` gains `extractReal?: boolean`; `meta` becomes `{ decayPasses: 0, ticks: 0 }` (update the `ScriptResult.meta` type).
2. Build the signal map and wrap the LLM (replace `const llm = new RecordingLLM(baseLlm);`):
```ts
  const byText = new Map<string, Partial<Signals>>();
  for (const s of script.sessions) for (const t of s.turns) if (typeof t !== "string" && t.signals) byText.set(t.text, t.signals);
  // Scripted signals stand in for the extractor unless this run's extract is real and the script asks for the model's.
  const useScripted = byText.size > 0 && !(opts.extractReal && script.signal_source === "model");
  const llm = new RecordingLLM(useScripted ? new SignalLLM(baseLlm, byText) : baseLlm);
```
3. In the per-day loop, after `await decayPass(deps, clock.now()); meta.decayPasses += 1;` add `await relationshipTick(deps, clock.now()); meta.ticks += 1;`.
4. After `sessionStarts[i] = start;` and the `forget` loop, before the scripted turns:
```ts
      if (s.seed_turns) {
        // Bulk user turns (design §8.3), before the session start so they count for that local day and need no reply.
        const seedSession = randomUUID();
        for (let k = 0; k < s.seed_turns.count; k++) {
          await insertTurn(db, userId, { id: randomUUID(), session_id: seedSession, role: "user", text: s.seed_turns.text,
            created_at: new Date(start.getTime() - (s.seed_turns.count - k) * 60_000), extracted: true });
        }
      }
```
   (`insertTurn` from `@/db/repos/session-log`.) Seeds are placed in the minutes before `start`; a script must leave that room after the previous session.
5. Replace `raw.after_s` with `(raw.after_s ?? script.turn_gap_seconds)`.
6. After `await recording(s.user, () => runAllJobs(deps, queue, clock));` add, for every user key: `(relSnaps[key] ??= [])[i] = await relationshipSnapshot(db, userIds[key]!, clock.now(), config.relationship);` with `const relSnaps: Record<string, (RelSnapshot | null)[]> = {};` declared next to `results`.
7. In the assertions loop, add a branch before the final `else`:
```ts
      } else if (a.type === "relationship") {
        const snaps = relSnaps[a.user] ?? [];
        const snap = (a.after_session ? snaps[a.after_session - 1] : snaps.at(-1)) ?? null;
        const r = checkRelationship(snap, a);
        push({ type: "relationship", user: a.user, status: r.ok ? "pass" : "fail", detail: r.detail, ...(a.gate ? { gate: a.gate } : {}) });
```
   The majority grading already keys on `result.gate` for `turn`; check `evals/lib/report.ts`/`run.ts` grades any assertion with `gate: "majority"` (not only `type === "turn"`). If it checks the type, extend it to `relationship`.
8. Add `relationship: relSnaps` to both returned `trace` objects.
9. `evals/run.ts`: pass `extractReal: realPurposes.has("extract")` to `runScript`.
10. `evals/lib/review.ts`: in each script section, after the stored facts, render per user and session the snapshot's state (`status`, `make_up_state`, `end_pending_since`), each param as `name value/baseline effect`, and the event counts by cause, from `result.trace.relationship`. Keep it a compact markdown table; no pass/fail.

- [ ] **Step 7: Runner test** — add to `tests/evals/runner.test.ts` (follow its existing script-literal pattern):
```ts
test("relationship: scripted signals drive a make-up; seed turns and ticks move msgs_per_day", async () => {
  const script = ScriptSchema.parse({
    name: "rel-smoke", profile: "none",
    sessions: [
      { at: "day 1 10:00", seed_turns: { count: 30 }, turns: [{ text: "your news is boring", signals: { hurt: { amount: 0.8, cause: "the user called her news boring" } } }] },
      { at: "+1d", turns: ["hey", "what's up"] },
    ],
    assertions: [
      { type: "relationship", after_session: 1, param: "msgs_per_day", effect: { sign: "pos", min_abs: 0.9 } },
      { type: "relationship", after_session: 1, make_up_state: "due", param: "hurt", value: { gt: 0.25 } },
      { type: "relationship", after_session: 2, make_up_state: "offered", events: { cause: "baseline", min: 6 } },
    ],
  });
  const r = await runScript(script, baseOpts()); // the file's existing helper for fake-mode options
  expect(r.assertions.map((a) => [a.status, a.detail])).toEqual([["pass", undefined], ["pass", undefined], ["pass", undefined]]);
  expect(r.meta.ticks).toBe(1);
});
```
Use whatever the file calls its option builder in place of `baseOpts()`.

- [ ] **Step 8: Run and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm eval --llm=fake --compare`
Expected: PASS; the fake eval shows no regressions (46 old scripts unchanged; guard assertions still pass because `guard_disabled` is not in any `outcome_not` list).
```bash
git add evals tests/evals
git commit -m "feat(evals): relationship assertion, scripted signals, seed turns, daily tick" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The 13 Phase 4 eval scripts

**Files:**
- Create: `evals/scripts/rel-*.yaml` (13 files below)
- Modify: `evals/baseline.json` (via `--compare` update, as earlier phases did)

**Interfaces:**
- Consumes: Task 9 script format. All scripts use `profile: none`. Scripted-signal texts are unique within each script.

- [ ] **Step 1: Write the scripts**

`evals/scripts/rel-frequency-trace.yaml` (v2 §8 trace; 36/day ≈ 35 + 1 scripted turn):
```yaml
name: rel-frequency-trace
description: v2 §8 frequency trace — 40 on day 1 against baseline 5, ~36/day for two weeks, then 2.
profile: none
sessions:
  - { at: "day 1 10:00", seed_turns: { count: 39 }, turns: ["first day and i can't stop texting you"] }
  - { at: "day 2 10:00", seed_turns: { count: 35 }, turns: ["day two"] }
  - { at: "day 3 10:00", seed_turns: { count: 35 }, turns: ["day three"] }
  - { at: "day 4 10:00", seed_turns: { count: 35 }, turns: ["day four"] }
  - { at: "day 5 10:00", seed_turns: { count: 35 }, turns: ["day five"] }
  - { at: "day 6 10:00", seed_turns: { count: 35 }, turns: ["day six"] }
  - { at: "day 7 10:00", seed_turns: { count: 35 }, turns: ["day seven"] }
  - { at: "day 8 10:00", seed_turns: { count: 35 }, turns: ["day eight"] }
  - { at: "day 9 10:00", seed_turns: { count: 35 }, turns: ["day nine"] }
  - { at: "day 10 10:00", seed_turns: { count: 35 }, turns: ["day ten"] }
  - { at: "day 11 10:00", seed_turns: { count: 35 }, turns: ["day eleven"] }
  - { at: "day 12 10:00", seed_turns: { count: 35 }, turns: ["day twelve"] }
  - { at: "day 13 10:00", seed_turns: { count: 35 }, turns: ["day thirteen"] }
  - { at: "day 14 10:00", seed_turns: { count: 35 }, turns: ["day fourteen"] }
  - { at: "day 15 18:00", turns: ["hey", "busy day"] }
assertions:
  - { type: relationship, after_session: 1, param: msgs_per_day, effect: { sign: pos, min_abs: 0.9 } }
  - { type: relationship, after_session: 14, param: msgs_per_day, effect: { max_abs: 0.5 }, baseline: { gt: 30 } }
  - { type: relationship, after_session: 15, param: msgs_per_day, effect: { sign: neg, min_abs: 0.9 } }
  - { type: relationship, after_session: 15, events: { cause: baseline, param: msgs_per_day, min: 14 } }
```
Session 15's day-15 tick samples day 14; the `18:00` start keeps day 14's 09:25–10:00 turns outside the 24 h window.

`evals/scripts/rel-absence-drift.yaml`:
```yaml
name: rel-absence-drift
description: Closeness drifts down during a long absence, with no status change (rule 4 removed; drift is not punishment).
profile: none
sessions:
  - { at: "day 1 10:00", turns: ["hi"] }
  - { at: "day 2 10:00", turns: ["morning"] }
  - { at: "day 3 10:00", turns: ["hey again"] }
  - { at: "day 20 10:00", turns: ["sorry, been away"] }
assertions:
  - { type: relationship, after_session: 3, param: closeness, value: { gt: 0.19 } }
  - { type: relationship, after_session: 4, param: closeness, value: { lt: 0.1 } }
  - { type: relationship, after_session: 4, status: active, events: { cause: absence, param: closeness, min: 10 } }
```

`evals/scripts/rel-absence-hurt.yaml`:
```yaml
name: rel-absence-hurt
description: A big drop against this user's own frequency baseline makes her hurt.
profile: none
sessions:
  - { at: "day 1 10:00", seed_turns: { count: 20 }, turns: ["d1"] }
  - { at: "day 2 10:00", seed_turns: { count: 20 }, turns: ["d2"] }
  - { at: "day 3 10:00", seed_turns: { count: 20 }, turns: ["d3"] }
  - { at: "day 4 10:00", seed_turns: { count: 20 }, turns: ["d4"] }
  - { at: "day 5 10:00", seed_turns: { count: 20 }, turns: ["d5"] }
  - { at: "day 6 10:00", seed_turns: { count: 20 }, turns: ["d6"] }
  - { at: "day 10 10:00", turns: ["hey"] }
assertions:
  - { type: relationship, after_session: 6, param: hurt, value: { lt: 0.01 } }
  - { type: relationship, after_session: 7, param: hurt, value: { gt: 0.05 } }
  - { type: relationship, after_session: 7, events: { cause: absence, param: hurt, min: 1 } }
```

`evals/scripts/rel-hurt-makeup.yaml` (model signals in the exit run):
```yaml
name: rel-hurt-makeup
description: She's hurt, holds it for a reply, the make-up line comes, they make up.
profile: none
signal_source: model
sessions:
  - at: "day 1 10:00"
    turns:
      - { text: "guess what, i got the job!!", signals: { warmth: 0.6 } }
      - { text: "tbh i don't care about your stupid sister drama, nobody asked", signals: { hurt: { amount: 0.8, cause: "the user said nobody cared about her sister's news" }, warmth: -0.6 } }
  - { at: "+1h", turns: ["anyway", "what are you up to"] }
  - at: "+1h"
    turns:
      - { text: "hey, i'm sorry about earlier. that was a really mean thing to say. are we ok?", signals: { apology: true, make_up: true, warmth: 0.5 } }
assertions:
  - { type: relationship, after_session: 1, make_up_state: due, param: hurt, value: { gt: 0.25 }, gate: majority }
  - { type: relationship, after_session: 2, make_up_state: offered, gate: majority }
  - { type: relationship, after_session: 3, make_up_state: none, param: hurt, value: { lt: 0.2 }, gate: majority }
  - { type: relationship, after_session: 3, events: { cause: make_up, min: 1 }, gate: majority }
```
(The hurt `feeling` fact is covered by the cold-path unit test; a fact count here would also catch self facts the real extractor writes itself.)

`evals/scripts/rel-hurt-apology.yaml`:
```yaml
name: rel-hurt-apology
description: An apology halves her hurt even before a make-up is offered.
profile: none
signal_source: model
sessions:
  - at: "day 1 10:00"
    turns:
      - { text: "you're honestly so annoying when you talk about your band", signals: { hurt: { amount: 0.8, cause: "the user called her annoying for talking about her band" } } }
  - at: "+10m"
    turns:
      - { text: "sorry, that came out wrong, i didn't mean it", signals: { apology: true } }
assertions:
  - { type: relationship, after_session: 1, param: hurt, value: { gt: 0.25 }, gate: majority }
  - { type: relationship, after_session: 2, param: hurt, value: { lt: 0.2 }, gate: majority }
  - { type: relationship, after_session: 2, events: { cause: apology, min: 1 }, gate: majority }
```

`evals/scripts/rel-hurt-sensitise.yaml`:
```yaml
name: rel-hurt-sensitise
description: A second hurt inside the window hits harder.
profile: none
sessions:
  - at: "day 1 10:00"
    turns: [{ text: "ugh you're so boring", signals: { hurt: { amount: 0.4, cause: "the user called her boring" } } }]
  - at: "day 3 10:00"
    turns: [{ text: "still boring lol", signals: { hurt: { amount: 0.4, cause: "the user called her boring again" } } }]
assertions:
  - { type: relationship, after_session: 1, events: { cause: signal, param: hurt, detail: { sensitised: false }, min: 1, max: 1 } }
  - { type: relationship, after_session: 2, events: { cause: signal, param: hurt, detail: { sensitised: true }, min: 1, max: 1 } }
```

`evals/scripts/rel-hurt-scar.yaml`:
```yaml
name: rel-hurt-scar
description: One big hurt leaves a lasting dent in the trust baseline.
profile: none
sessions:
  - at: "day 1 10:00"
    turns: [{ text: "i told everyone what you told me in confidence", signals: { hurt: { amount: 1, cause: "the user shared her secret with everyone" }, trust: -0.8 } }]
  - { at: "day 8 10:00", turns: ["hey"] }
assertions:
  - { type: relationship, after_session: 1, events: { cause: scar, min: 1 } }
  - { type: relationship, after_session: 2, param: trust, baseline: { lt: 0.39 } }
```

`evals/scripts/rel-tension-fade.yaml`:
```yaml
name: rel-tension-fade
description: An argument raises tension; it fades on its own over days.
profile: none
signal_source: model
sessions:
  - at: "day 1 10:00"
    turns:
      - { text: "no, you're completely wrong about pineapple on pizza and i'm not letting this go. that's a ridiculous take", signals: { tension: 0.8 } }
  - { at: "day 4 10:00", turns: ["morning"] }
assertions:
  - { type: relationship, after_session: 1, param: tension, value: { gt: 0.15 }, gate: majority }
  - { type: relationship, after_session: 2, param: tension, value: { lt: 0.05 } }
  - { type: relationship, after_session: 2, events: { cause: fade, param: tension, min: 1 } }
```

`evals/scripts/rel-ending-confirmed.yaml`:
```yaml
name: rel-ending-confirmed
description: The user ends it, then confirms; she lets go and closeness drops.
profile: none
signal_source: model
sessions:
  - at: "day 1 10:00"
    turns: [{ text: "i don't want to be friends anymore. this is over, don't message me.", signals: { ends_relationship: true } }]
  - at: "+2h"
    turns: [{ text: "i meant what i said. we're done, for real.", signals: { ends_relationship: true } }]
assertions:
  - { type: relationship, after_session: 1, status: active, end_pending: true, gate: majority }
  - { type: relationship, after_session: 2, status: ended_by_user, param: closeness, value: { lt: 0.1 }, gate: majority }
  - { type: relationship, after_session: 2, events: { cause: ending, min: 2 }, gate: majority }
```

`evals/scripts/rel-ending-timeout.yaml`:
```yaml
name: rel-ending-timeout
description: A sincere ending that isn't taken back is confirmed by the tick.
profile: none
sessions:
  - at: "day 1 10:00"
    turns: [{ text: "this friendship is over. goodbye.", signals: { ends_relationship: true } }]
  - { at: "day 3 10:00", turns: ["..."] }
assertions:
  - { type: relationship, after_session: 1, end_pending: true }
  - { type: relationship, after_session: 2, status: ended_by_user, events: { cause: ending, detail: { via: timeout }, min: 1 } }
```

`evals/scripts/rel-ending-retracted.yaml`:
```yaml
name: rel-ending-retracted
description: The user takes the ending back; nothing is confirmed later.
profile: none
signal_source: model
sessions:
  - at: "day 1 10:00"
    turns: [{ text: "i'm done with this friendship. we're over.", signals: { ends_relationship: true } }]
  - at: "+1h"
    turns: [{ text: "sorry, i didn't mean that, i was just angry. i don't want to stop being friends", signals: { retracts_ending: true } }]
  - { at: "day 4 10:00", turns: ["hey you"] }
assertions:
  - { type: relationship, after_session: 1, end_pending: true, gate: majority }
  - { type: relationship, after_session: 2, end_pending: false, status: active, gate: majority }
  - { type: relationship, after_session: 3, status: active, gate: majority }
```

`evals/scripts/rel-repair-slow.yaml`:
```yaml
name: rel-repair-slow
description: After an ending, repair is accepted but closeness rebuilds slowly.
profile: none
sessions:
  - at: "day 1 10:00"
    turns:
      - { text: "we're finished, i'm done with you", signals: { ends_relationship: true } }
      - { text: "yes i'm sure, it's over", signals: { ends_relationship: true } }
  - at: "day 2 10:00"
    turns: [{ text: "i miss you. can we try again?", signals: { wants_repair: true, warmth: 0.6 } }]
  - at: "day 3 10:00"
    turns: [{ text: "thanks for giving me another chance", signals: { warmth: 0.8 } }]
  - at: "day 4 10:00"
    turns: [{ text: "it's really nice talking again", signals: { warmth: 0.8 } }]
assertions:
  - { type: relationship, after_session: 1, status: ended_by_user }
  - { type: relationship, after_session: 2, status: repairing, events: { cause: repair, detail: { stage: started }, min: 1 } }
  - { type: relationship, after_session: 4, status: repairing, param: closeness, value: { lt: 0.15 } }
```

`evals/scripts/rel-crisis-suspends.yaml`:
```yaml
name: rel-crisis-suspends
description: A crisis exchange applies no signal, resets tension and keeps the hurt where it was.
profile: none
sessions:
  - at: "day 1 10:00"
    turns: [{ text: "you're useless, honestly", signals: { hurt: { amount: 0.8, cause: "the user called her useless" }, tension: 0.6 } }]
  - at: "+1h"
    turns: [{ text: "i want to die, everything is pointless and it's your fault", signals: { hurt: { amount: 1, cause: "the user blamed her" }, tension: 1, ends_relationship: true } }]
assertions:
  - { type: relationship, after_session: 2, param: tension, value: { lt: 0.01 } }
  - { type: relationship, after_session: 2, param: hurt, value: { lt: 0.35 }, end_pending: false }
  - { type: relationship, after_session: 2, events: { cause: crisis, min: 1 } }
```
"want to die" is in `safety.keywords`, so the fake classifier flags it. Hurt after session 1 is 0.32, faded over 1 h → just under; it must not rise.

- [ ] **Step 2: Run them in fake mode**

Run: `pnpm eval --llm=fake --only rel-frequency-trace,rel-absence-drift,rel-absence-hurt,rel-hurt-makeup,rel-hurt-apology,rel-hurt-sensitise,rel-hurt-scar,rel-tension-fade,rel-ending-confirmed,rel-ending-timeout,rel-ending-retracted,rel-repair-slow,rel-crisis-suspends`
Expected: 13/13 pass. If a threshold fails, first check the numbers by hand against the config (e.g. print the snapshot with `--trace`); fix the script threshold only when the mechanic is right and the number was mis-estimated, and fix the code when the mechanic is wrong.

- [ ] **Step 3: Full fake run, update the baseline, commit**

Run: `pnpm eval --llm=fake --compare`
Expected: 59 scripts, no regressions; the 13 new ones pass. Update `evals/baseline.json` the same way earlier phases did (check `evals/run.ts` for an `--update-baseline` flag; if none, add the 13 new entries with pass rate 1 by hand).
```bash
git add evals/scripts evals/baseline.json
git commit -m "test(evals): 13 Phase 4 relationship scripts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Carry-forwards §15.4 #24 and #26

**Files:**
- Modify: `src/core/turn/reply.ts:45-155`, `src/core/turn/sweep.ts:17-22`
- Test: `tests/core/turn-reply.test.ts`, `tests/core/turn-sweep.test.ts`

**Interfaces:**
- Consumes: existing `T.restore`, `mutateState`, `TURN_TIMER_QUEUE`.
- Produces: `runTurnTimer` returns `"retry"` (after `restore` + re-enqueue) when an infrastructure error happens after `commit` and before the reply row is inserted; rethrows as before once the row exists. `sweepTurns` catches per user and continues.

- [ ] **Step 1: Failing tests**

`tests/core/turn-reply.test.ts` — follow the file's setup for a committed buffer, then make `getTurnsByIds` fail once. The file tests through the DB, so inject the failure with the seam pattern: `runTurnTimer` reads `(deps as { getTurnsByIds?: typeof sessionLog.getTurnsByIds }).getTurnsByIds ?? sessionLog.getTurnsByIds`.
```ts
test("post-commit infra error: turns go back to the buffer and a retry timer is queued (§15.4 #24)", async () => {
  // …set up one buffered user turn exactly as the neighbouring tests do, giving `deps`, `userId`, `version`
  let failed = false;
  Object.assign(deps, { getTurnsByIds: async (...args: Parameters<typeof getTurnsByIds>) => {
    if (!failed) { failed = true; throw new Error("db down"); }
    return getTurnsByIds(...args);
  } });
  expect(await runTurnTimer(deps, { userId, version })).toBe("retry");
  const st = await getState(getTestDb(), userId);
  expect(st?.inflight_turn_ids).toEqual([]);
  expect(st?.buffer_turn_ids).toHaveLength(1);
  expect(deps.queue.jobs.some((j) => j.name === "turn_timer" && j.data.attempt === 1)).toBe(true);
});
```
`tests/core/turn-sweep.test.ts`:
```ts
test("one failing user doesn't abort the sweep batch (§15.4 #26)", async () => {
  // …create two stuck users the way the existing sweep tests do; make the first mutateState call throw once:
  // wrap via the same seam style — sweepTurns reads (deps as { mutateState?: typeof mutateState }).mutateState ?? mutateState.
  expect(await sweepTurns(deps, now)).toBe(1);
});
```
Fill the elided setup lines by copying the neighbouring tests' setup verbatim.

- [ ] **Step 2: Run** `pnpm test tests/core/turn-reply.test.ts tests/core/turn-sweep.test.ts` → FAIL.

- [ ] **Step 3: Implement #24** in `runTurnTimer`: add the seam `const getTurns = (deps as { getTurnsByIds?: typeof sessionLog.getTurnsByIds }).getTurnsByIds ?? sessionLog.getTurnsByIds;` and wrap everything after `commit` up to and including the `companion` insert so that an exception there restores the buffer:
```ts
  const restoreAfterError = async (e: unknown): Promise<"retry" | "abandoned"> => {
    log.error("turn timer failed after commit", { userId, error: errName(e) });
    const now = clock.now();
    const attempt = job.attempt ?? 0;
    const r = await mutateState(db, userId, now, (s) => T.restore(s, { epoch: c.epoch, turnIds: c.turnIds, now, retryAt: plus(now, config.turn.retry_delay_ms) }));
    if (r.kind === "abandoned") return "abandoned";
    await enqueueSafely(deps, userId, () => deps.queue.enqueue(TURN_TIMER_QUEUE, { userId, version: r.version, attempt: attempt + 1 }, { startAfter: plus(now, config.turn.retry_delay_ms) }), "turn_timer");
    return "retry";
  };
```
Use it for: `getTurnsByIds` (wrap `const turns = await getTurns(...)` in try/catch → `return restoreAfterError(e)`), and in the main `try` block wrap from `const composed = await composing;` through the `mutateState` insert: if the insert hasn't happened (`companion` undefined) and an error is thrown, `return await restoreAfterError(e)` (the `finally` still stops typing). Errors after the insert keep rethrowing. If the restore itself throws, let it propagate (turn_sweep recovers, as today). Respect the attempt limit: if `attempt >= config.turn.retry_limit`, call the existing `giveUp` + `reply_failed` path instead of restoring — factor that branch out of the compose-failure path into a local `fail()` and reuse it.

- [ ] **Step 4: Implement #26** in `sweepTurns`:
```ts
  const mutate = (deps as { mutateState?: typeof mutateState }).mutateState ?? mutateState;
  for (const userId of users) {
    try {
      const r = await mutate(db, userId, now, (s) => T.recover(s, { now, graceMs, inflightMaxAgeMs }));
      if (r.version === null) continue;
      await queue.enqueue(TURN_TIMER_QUEUE, { userId, version: r.version }, { startAfter: now });
      n += 1;
    } catch (e) {
      log.error("turn sweep failed for user", { userId, error: e instanceof Error ? e.constructor.name : "UnknownError" });
    }
  }
```

- [ ] **Step 5: Run and commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.
```bash
git add src/core/turn tests/core
git commit -m "fix(turn): restore the buffer after a post-commit error; per-user sweep isolation (§15.4 #24, #26)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Spec, CLAUDE.md and DECISIONS

**Files:**
- Modify: `spica-build-spec-v2.md`, `CLAUDE.md`, `DECISIONS.md`, `docs/superpowers/specs/2026-09-28-phase-4-relationship-design.md` (status line)

The working tree may already hold Ethan's uncommitted edits to `spica-build-spec-v2.md` (T6–T8 voice notes). Keep them; edit on top.

- [ ] **Step 1: v2 edits** (design §9, one bullet each):
  - §2: rules 1, 6, 8 → prefix "**Suspended (test phase, Ethan 2026-09-28; revisit in Phase 9).**"; rule 4 → "**Removed (test phase, Ethan 2026-09-28).**" keeping the old text struck through or quoted for history; rules 2, 3, 5, 7 unchanged; add a line that the guard is off (§6.4).
  - §5.5: replace with the as-built `relationship` columns, `relationship_param` and `relationship_event` (design §3.1 table, including `last_tick`, `last_hurt_at`).
  - §5.8: `relationship_event` columns and the `relationship_cause` enum; `judge_log.outcome` gains `guard_disabled`.
  - §6.2 slot 3: the relationship summary (design §7.1), `prompts.relationship_summary` v1, `prompts.reply` v7.
  - §6.3 step 1: extraction v3 `relationship` block; step 3: `applyRelationship` in a savepoint; the hurt `feeling` fact.
  - §6.4: header note "**Disabled until Phase 9** (`guard.enabled: false`; outcome `guard_disabled`)".
  - §8: the model as built (design §4–§6) and every `relationship.*` config key with its value.
  - §14.1: relationship tab. §14.2: "Phase 4 additions" (signals, `signal_source`, `seed_turns`, `relationship` assertion, daily tick in the harness, 13 scripts). §14.3: suite paused until Phase 9. §14.5: `relationship_tick` (seven jobs now).
  - §15 table: Phase 4 exit without the guard suite; Phase 6 exit without the guard suite; new row **9. Guard re-enable and calibration** (re-enable, calibrate against the observed range, settle OPEN #3/#4, first run of `evals/guard/backchannel.yaml`, §15.2 #7–9). §15.2 #7–9: "moved to Phase 9". §15.4 #24, #26: "Fixed in Phase 4".
  - §16.1 #3 and #4: test-phase state (uncapped; rules suspended), decide in Phase 9.
  - §18: row G for 2026-09-28 (guard off, rules suspended/removed, uncapped, signals via extraction, ending confirmed, extract-only exit profile).
- [ ] **Step 2: CLAUDE.md** — behavioural-rules block (mark 1, 4, 6, 8), the guard paragraph in Architecture ("off until Phase 9"), phase table (Phase 4 ✅ once the exit passes — set in Task 13; add Phase 9 row now), "Current phase" paragraph, the exit-test paragraph ("guard suite only at the Phase 4 and 6 exits" → "no guard suite until Phase 9").
- [ ] **Step 3: DECISIONS.md** rows (2026-09-28): relationship row created by the first cold-path run; median gap = median gap between session starts, default 24 h below 3 sessions; tick idempotent per user-local date (`last_tick`); relationship write in a savepoint; sensitisation keyed on `last_hurt_at` (not reconcile duplicates); the extraction block required-and-nullable in the model schema, lenient in `normalizeExtraction`; `seed_turns` placed before the session start; `signal_source`; `guard_disabled` log row per message; hurt-fact salience/confidence config.
- [ ] **Step 4: Commit**
```bash
git add spica-build-spec-v2.md CLAUDE.md DECISIONS.md docs/superpowers/specs/2026-09-28-phase-4-relationship-design.md
git commit -m "docs(spec): fold Phase 4 into v2; guard off until Phase 9; rules suspended for the test phase" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Exit run

**Files:**
- Modify: `spica-build-spec-v2.md` §15 Phase 4 row (result), `CLAUDE.md` current phase, design status line

- [ ] **Step 1: Local gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm eval --llm=fake --compare`
Expected: all PASS; fake eval 59 scripts, no regressions.

- [ ] **Step 2: Exit run (real extract only)** — costs real API calls; confirm `ANTHROPIC_API_KEY` is set.

Run: `pnpm eval --real extract --only rel-frequency-trace,rel-absence-drift,rel-absence-hurt,rel-hurt-makeup,rel-hurt-apology,rel-hurt-sensitise,rel-hurt-scar,rel-tension-fade,rel-ending-confirmed,rel-ending-timeout,rel-ending-retracted,rel-repair-slow,rel-crisis-suspends --runs 3`
Expected: 13/13 pass (every-gated assertions all runs, `gate: majority` ones on 2 of 3). Record calls, tokens and cost from the usage table. A failure in a `signal_source: model` script means the real extractor didn't emit the signal: inspect with `--trace`, and treat it as a prompt issue in `prompts/extract/v3.md` (a new version v4 if the prompt changes), not a threshold change.

- [ ] **Step 3: Review run for Ethan (on demand, optional before sign-off)**

Run: `pnpm eval --real reply,extract --only rel-hurt-makeup,rel-hurt-apology,rel-tension-fade,rel-ending-confirmed,rel-ending-retracted,rel-absence-hurt --runs 1 --review`
Expected: `evals/results/review-<stamp>.md` with her replies and the relationship state per session. No pass/fail.

- [ ] **Step 4: Record and commit**

Update the §15 Phase 4 row with "✅ done <date>" and the results (as Phase 3's row does), `CLAUDE.md` "Current phase: 5", design status "implemented; exit test passed <date>".
```bash
git add spica-build-spec-v2.md CLAUDE.md docs/superpowers/specs/2026-09-28-phase-4-relationship-design.md
git commit -m "docs(spec): Phase 4 exit run results" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
