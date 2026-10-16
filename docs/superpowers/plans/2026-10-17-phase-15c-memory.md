# Phase 15c: Memory, Relationship, User Mind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make her private notes on each user plain and current (a repaired hurt becomes past, a crisis stops riding the summary chain), turn the message rate into her estimate of the user, resolve dates in code, ask gender at signup, catch worded-apart contradictions, fix the false-recall judge, and settle four relationship mechanics.

**Architecture:** Most changes sit in pure functions with unit tests: big-event detection, relationship transitions, date resolution, reconcile. The user-mind loop inputs move to one `RunInputs` shape that carries `clean` (outside a crisis window) and the unread facts. Two migrations: `relationship_param.samples` and `user.gender`. One new dependency: `chrono-node` for date phrases.

**Tech Stack:** TypeScript, Vitest, Drizzle + Postgres 16 + pgvector, zod, Better Auth, pnpm, chrono-node 2.10.1, Haiku via `LLMProvider`.

**Spec:** `docs/2026-10-17-phase-15c-memory-design.md` (read it first), and `spica-design-spec-v3.md` §9, §11, §12, §14, §25.

## Global Constraints

- Every numeric constant goes in `config/default.json` with its zod schema in `src/mind/platform/config.ts`.
- Every prompt is a versioned file under `prompts/`; delete the version each task replaces (nothing may still configure it).
- `src/mind` stays framework-free: no `Date.now()`, no `process.env`; time comes from `deps.clock` or an argument.
- Comments say why, never cite spec sections, phases or backlog numbers.
- Every new file starts with a short plain-English header.
- Prettier at 100 columns; `pnpm lint` and `pnpm typecheck` clean before each commit.
- Exit tests fake every LLM; the guard is faked; the leak canary must pass.
- One test process at a time (shared test DB). A full `pnpm test` takes about 10 minutes. Never edit test files while one runs.
- Work on branch `phase-15c-memory`; commit after each task, ending the message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Crisis carve-out holds: a crisis exchange records no big event; nothing sensitive reaches a reach-out.
- Real model runs log every output (the eval call log). Never start one without `--review`.

## Review Focus

1. **"tomorrow" said at 23:30 local in Singapore** (15:30 UTC): resolves to the next local day, not the UTC day. Pinned in Task 5.
2. **Extraction writes `{when}` in content but gives no phrase and no date**: the stored content never keeps a literal `{when}`. Pinned in Task 5.
3. **A non-sensitive fact read only by a marked summary inside a crisis window**: the first clean run after the window still reads it (read is counted per chain). Pinned in Task 3.
4. **A hurt fact whose content doesn't match the "Spica felt hurt because …." template** (an older row, or a cause with a full stop inside): the past-tense copy still reads as past and never drops the cause. Pinned in Task 2.
5. **A user from before this change** (msgs_per_day baseline already learned, `samples` backfilled): the next tick keeps the learned baseline instead of replacing it with yesterday's count. Pinned in Task 1.

---

### Task 1: Her estimate of their message rate

**Files:**
- Modify: `src/db/schema.ts` (`relationship_param.samples`)
- Create: `src/db/migrations/0035_rate_samples.sql` (generated, then the backfill appended)
- Modify: `src/db/repos/user/relationship.ts` (`getParams`, `saveRelationship`)
- Modify: `src/mind/state/user/relationship/types.ts`, `params.ts`, `transitions.ts`, `summary.ts`
- Modify: `config/default.json`, `src/mind/platform/config.ts`
- Test: `tests/mind/state/user/relationship/transitions.test.ts`, `summary.test.ts`, `tests/db/relationship-repo.test.ts`

**Interfaces:**
- Produces: `HomeostaticParam.samples?: number`; `rateEstimated(param: HomeostaticParam, settings: RelationshipConfig): boolean` in `params.ts`; `config.relationship.rate_estimate_days` (7); `config.relationship.initial.msgs_per_day` becomes 0.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b phase-15c-memory
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/mind/state/user/relationship/transitions.test.ts`:

```ts
const quietDay = (p: Params, localDate: string, hours: number) =>
  relationshipAfterDailyTick(
    fresh(),
    p,
    {
      now: h(hours),
      localDate,
      yesterdayCount: 1,
      msgs24h: 1,
      lastContact: h(hours - 2),
      medianGapHours: 24,
    },
    cfg,
  );

test("no estimate of their rate yet: a quiet day adds no absence hurt, and the first sample sets the baseline", () => {
  const r = quietDay(init(), "2026-01-06", 25);
  expect(r.events.some((e) => e.cause === "absence" && e.param === "hurt")).toBe(false);
  expect(r.params.msgs_per_day.baseline).toBe(1);
  expect(r.params.msgs_per_day.samples).toBe(1);
});

test("once her estimate is established, a quiet day against it hurts a little", () => {
  const p = init();
  p.msgs_per_day = { value: 30, baseline: 30, variance: 20, updated_at: t0, samples: 7 };
  const r = quietDay(p, "2026-01-06", 25);
  expect(r.events.some((e) => e.cause === "absence" && e.param === "hurt")).toBe(true);
});

test("a baseline learned before samples existed is kept, not replaced by one day", () => {
  const p = init();
  p.msgs_per_day = { value: 30, baseline: 30, variance: 20, updated_at: t0, samples: 30 };
  const r = quietDay(p, "2026-01-06", 25);
  expect(r.params.msgs_per_day.baseline).toBeCloseTo(30 + cfg.baseline_alpha * (1 - 30));
});
```

Append to `tests/mind/state/user/relationship/summary.test.ts`:

```ts
test("no 'quieter than usual' line until her estimate of their rate is established", () => {
  const p = init();
  p.msgs_per_day = { value: 1, baseline: 30, variance: 20, updated_at: now, samples: 6 };
  const early = summaryLines({ state: fresh(), params: p, cause: null }, now, cfg, phrases);
  expect(early.some((l) => /quieter/.test(l))).toBe(false);
  p.msgs_per_day = { ...p.msgs_per_day, samples: 7 };
  const later = summaryLines({ state: fresh(), params: p, cause: null }, now, cfg, phrases);
  expect(later.some((l) => /quieter/.test(l))).toBe(true);
});
```

In `tests/db/relationship-repo.test.ts`, change the first test's msgs line and add a round-trip:

```ts
  expect(p.msgs_per_day).toMatchObject({ value: 0, baseline: 0, variance: 25, samples: 0 });
```

```ts
test("a param's daily sample count round-trips", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  await rel.ensureRelationship(db, u, now, cfg);
  await db.transaction(async (tx) => {
    const row = await rel.lockRelationship(tx, u);
    const params = await rel.getParams(tx, u);
    params.msgs_per_day = { ...params.msgs_per_day, samples: 3 };
    await rel.saveRelationship(tx, u, { state: rel.toRelationshipState(row), params });
  });
  expect((await rel.getParams(db, u)).msgs_per_day.samples).toBe(3);
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run tests/mind/state/user/relationship/transitions.test.ts tests/mind/state/user/relationship/summary.test.ts tests/db/relationship-repo.test.ts`
Expected: FAIL: `samples` is not a known property (typecheck in vitest passes, but the values are undefined), absence hurt fires, the baseline moves only by alpha, the round-trip reads `undefined`.

- [ ] **Step 4: Schema, migration and backfill**

In `src/db/schema.ts`, in `relationship_param` after `variance`:

```ts
    // Daily samples behind the baseline: her estimate of a rate needs a few days before it means anything.
    samples: integer("samples").notNull().default(0),
```

Run: `pnpm db:generate --name rate_samples`
Then append to the generated `src/db/migrations/0035_rate_samples.sql` (users who already had daily ticks keep their learned baselines):

```sql
--> statement-breakpoint
UPDATE "relationship_param" p SET "samples" = 30
FROM "relationship" r
WHERE p."user_id" = r."user_id" AND r."last_tick" IS NOT NULL;
```

- [ ] **Step 5: Type, repo and maths**

`src/mind/state/user/relationship/types.ts`, in `HomeostaticParam`:

```ts
export type HomeostaticParam = {
  value: number;
  baseline: number;
  variance: number;
  updated_at: Date;
  /** Daily samples behind the baseline; absent reads as none. */
  samples?: number;
};
```

`src/db/repos/user/relationship.ts`: in `getParams` add `samples: r.samples,` to the mapped object; in `saveRelationship` change the `.set` to:

```ts
      .set({
        value: p.value,
        baseline: p.baseline,
        variance: p.variance,
        updated_at: p.updated_at,
        samples: p.samples ?? 0,
      })
```

`src/mind/state/user/relationship/params.ts`, replace `sampleBaseline` and add `rateEstimated`:

```ts
/**
 * One daily sample: an exponential moving average and an exponentially weighted variance. A
 * rate's first sample is the baseline outright: there's no usual yet to blend it with.
 */
export function sampleBaseline(
  param: HomeostaticParam,
  sample: number,
  alpha: number,
  firstIsBaseline = false,
): HomeostaticParam {
  const samples = (param.samples ?? 0) + 1;
  if (firstIsBaseline && samples === 1) return { ...param, baseline: sample, samples };
  const difference = sample - param.baseline;
  return {
    ...param,
    baseline: param.baseline + alpha * difference,
    variance: (1 - alpha) * (param.variance + alpha * difference * difference),
    samples,
  };
}

/** Her estimate of their message rate: only after enough days of it is there a "usual". */
export function rateEstimated(param: HomeostaticParam, settings: RelationshipConfig): boolean {
  return (param.samples ?? 0) >= settings.rate_estimate_days;
}
```

- [ ] **Step 6: Gate the absence hurt and the summary line**

`src/mind/state/user/relationship/transitions.ts`, in `applyAbsence`, right after the `ended_by_user` early return:

```ts
  // With no estimate of how much they usually text, a quiet day isn't quieter than anything.
  if (!rateEstimated(draft.params.msgs_per_day, settings)) return;
```

In `sampleAllBaselines`, pass the rate flag:

```ts
    draft.params[name] = sampleBaseline(
      draft.params[name],
      sample,
      settings.baseline_alpha,
      name === "msgs_per_day",
    );
```

Import `rateEstimated` from `./params`.

`src/mind/state/user/relationship/summary.ts`, in `notableDeviations`, add a filter before the effect filter:

```ts
    .filter((p) => p.name !== "msgs_per_day" || rateEstimated(params.msgs_per_day, settings))
```

Import `rateEstimated` from `./params`.

- [ ] **Step 7: Config**

`config/default.json`, under `relationship`: set `"initial"."msgs_per_day": 0` and add `"rate_estimate_days": 7`.
`src/mind/platform/config.ts`, in `relationship`: add `rate_estimate_days: positiveInt,`.

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run tests/mind/state/user/relationship tests/db/relationship-repo.test.ts`
Expected: PASS. Fix any older test that seeded `msgs_per_day` to exercise absence hurt (it must now carry `samples: 7`, as in "tick absence: closeness drifts…").

- [ ] **Step 9: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "feat(relationship): their message rate is her estimate, established after a week

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A repair is a big event; the hurt becomes past

**Files:**
- Modify: `src/db/repos/user/user-mind.ts` (`Trigger`)
- Modify: `src/mind/process/user/big-events.ts`, `src/mind/process/user/inputs.ts` (`triggerText`)
- Modify: `src/mind/memory/user/encode.ts` (`inserted` replaces `insertedSaliences`)
- Modify: `src/mind/state/user/relationship/signals.ts` (`pastHurtContent`)
- Create: `src/mind/memory/user/hurt.ts` (`settleHurtFacts`)
- Modify: `src/db/repos/user/facts.ts` (`openHurtFacts`)
- Modify: `src/mind/process/cold-path/cold-path.ts`, `src/mind/state/user/relationship/daily-tick.ts`
- Modify: `config/default.json`, `src/mind/platform/config.ts`
- Test: `tests/mind/process/user/big-events.test.ts`, `tests/mind/state/user/relationship/milestones.test.ts`, `tests/mind/memory/user/hurt.test.ts` (new), `tests/mind/memory/user/encode.test.ts`, `tests/mind/process/cold-path/cold-path.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `Trigger` gains `{ kind: "repaired"; via: "apology" | "fade" }` and `salient_fact` gains `content?: string`; `detectBigEvents({ before, after, newFacts: { salience: number; content: string }[], apology?: boolean, settings, source })`; `EncodeOutcome.inserted: { subject: string; salience: number; content: string }[]`; `pastHurtContent(content: string, via: "apology" | "fade"): string`; `settleHurtFacts(db: Db, userId: string, via: "apology" | "fade", now: Date): Promise<number>`; `config.user_mind.triggers.hurt_resolved` (0.1).

- [ ] **Step 1: Write the failing tests**

In `tests/mind/process/user/big-events.test.ts`, change `detect` to the new input and add:

```ts
const detect = (
  before: RelationshipSnapshot,
  after: RelationshipSnapshot,
  newFacts: { salience: number; content: string }[] = [],
  source: "exchange" | "tick" = "exchange",
  apology = false,
) => detectBigEvents({ before, after, newFacts, apology, settings, source });

test("hurt falling below the line is a repair: by apology on an exchange, by fading otherwise", () => {
  expect(detect(snap({ hurt: 0.27 }), snap({ hurt: 0.07 }), [], "exchange", true)).toContainEqual({
    kind: "repaired",
    via: "apology",
  });
  expect(detect(snap({ hurt: 0.12 }), snap({ hurt: 0.08 }), [], "tick")).toContainEqual({
    kind: "repaired",
    via: "fade",
  });
  expect(detect(snap({ hurt: 0.08 }), snap({ hurt: 0.05 }))).toEqual([]);
});

test("a salient fact carries its content; her own facts never count", () => {
  expect(detect(snap({}), snap({}), [{ salience: 0.9, content: "The user is a nurse." }])).toEqual([
    { kind: "salient_fact", salience: 0.9, content: "The user is a nurse." },
  ]);
});
```

Update the existing salience test to pass `[{ salience: 0.5, content: "a" }, { salience: 0.85, content: "b" }]` and expect `{ kind: "salient_fact", salience: 0.85, content: "b" }`, and the `before: null` test to `newFacts: [{ salience: 0.9, content: "x" }]` with `content: "x"` in the expectation.

In `tests/mind/state/user/relationship/milestones.test.ts` add (it already imports `triggerText`):

```ts
test("trigger texts name the thing", () => {
  expect(triggerText({ kind: "repaired", via: "apology" })).toBe(
    "they apologised, and the hurt has passed",
  );
  expect(triggerText({ kind: "repaired", via: "fade" })).toBe("the hurt between you has faded");
  expect(triggerText({ kind: "salient_fact", salience: 0.9, content: "The user is a nurse." })).toBe(
    "they told you: The user is a nurse.",
  );
  expect(triggerText({ kind: "salient_fact", salience: 0.9 })).toBe("they told you something");
  expect(triggerText({ kind: "param_jump", param: "affect_valence", from: 0.5, to: 0.7 })).toBe(
    "how warmly you feel toward them just rose sharply",
  );
});
```

Create `tests/mind/memory/user/hurt.test.ts`:

```ts
// A repaired hurt becomes past: the open hurt memory is superseded by a resolved past-tense copy.
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { settleHurtFacts } from "@/mind/memory/user/hurt";
import { pastHurtContent } from "@/mind/state/user/relationship/signals";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);
const at = new Date("2026-01-10T15:00:00Z");

test("past tense keeps the cause, whatever the content looks like", () => {
  expect(pastHurtContent("Spica felt hurt because the user said her star talk gets a bit much.", "apology")).toBe(
    "Spica was hurt because the user said her star talk gets a bit much; they made up.",
  );
  expect(pastHurtContent("Spica felt hurt because the user said 'k.' and left.", "fade")).toBe(
    "Spica was hurt because the user said 'k.' and left; it has passed.",
  );
  expect(pastHurtContent("Spica was upset about the film thing.", "fade")).toBe(
    "Spica was upset about the film thing; it has passed.",
  );
});

test("settling supersedes each open hurt fact with a resolved copy, for this user only", async () => {
  const db = getTestDb();
  const [u, other] = [await createTestUser(), await createTestUser()];
  const hurt = (userId: string) =>
    insertFact(db, userId, {
      subject: "self",
      kind: "feeling",
      content: "Spica felt hurt because the user said her star talk gets a bit much.",
      embedding: vec(),
      created_at: at,
      status: "open",
      salience: 0.6,
      valence: -0.25,
      confidence: 0.8,
      source: "inferred",
    });
  const mine = await hurt(u);
  const theirs = await hurt(other);
  expect(await settleHurtFacts(db, u, "apology", at)).toBe(1);
  const rows = await db.execute(
    sql`SELECT id, status, content, superseded_by FROM fact WHERE user_id = ${u} ORDER BY created_at, status`,
  );
  const old = rows.rows.find((r) => r.id === mine.id)!;
  expect(old.status).toBe("superseded");
  const copy = rows.rows.find((r) => r.id === old.superseded_by)!;
  expect(copy).toMatchObject({ status: "resolved" });
  expect(String(copy.content)).toMatch(/^Spica was hurt because .*; they made up\.$/);
  const untouched = await db.execute(sql`SELECT status FROM fact WHERE id = ${theirs.id}`);
  expect(untouched.rows[0]!.status).toBe("open");
});
```

In `tests/mind/memory/user/encode.test.ts` line ~197 change `out.insertedSaliences` to `out.inserted`; in `tests/mind/process/cold-path/cold-path.test.ts` line ~475 change `out.applied?.insertedSaliences.length` to `out.applied?.inserted.length`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/user/big-events.test.ts tests/mind/state/user/relationship/milestones.test.ts tests/mind/memory/user/hurt.test.ts`
Expected: FAIL: no `repaired` trigger, old trigger texts, `hurt.ts` doesn't exist.

- [ ] **Step 3: Trigger type and config**

`src/db/repos/user/user-mind.ts`, in `Trigger`:

```ts
  | { kind: "salient_fact"; salience: number; content?: string }
  | { kind: "repaired"; via: "apology" | "fade" }
```

`config/default.json`, `user_mind.triggers`: add `"hurt_resolved": 0.1`. `src/mind/platform/config.ts`, in the user-mind `triggers` object: `hurt_resolved: unit,`.

- [ ] **Step 4: Detection**

`src/mind/process/user/big-events.ts`: change the input and add the repair; replace the header's first sentence to mention repairs.

```ts
export function detectBigEvents(input: {
  before: RelationshipSnapshot | null;
  after: RelationshipSnapshot | null;
  /** What the user (or the two of them) newly told her; her own facts aren't news about them. */
  newFacts: { salience: number; content: string }[];
  /** The exchange carried an apology or a make-up. */
  apology?: boolean;
  settings: Config["user_mind"]["triggers"];
  /** The daily tick moves params by fade and absence only: no jumps, no facts, no make-up. */
  source: "exchange" | "tick";
}): Trigger[] {
```

Inside `if (before && after) { … }`, after the make-up check:

```ts
    // The hurt has passed: worth taking stock, or her notes keep it open for good.
    const line = settings.hurt_resolved;
    if (before.params.hurt.value >= line && after.params.hurt.value < line) {
      const via = source === "exchange" && input.apology ? "apology" : "fade";
      triggers.push({ kind: "repaired", via });
    }
```

Replace the salient block:

```ts
  if (source === "exchange") {
    const top = input.newFacts.reduce<{ salience: number; content: string } | null>(
      (best, f) => (!best || f.salience > best.salience ? f : best),
      null,
    );
    if (top && top.salience >= settings.fact_salience)
      triggers.push({ kind: "salient_fact", salience: top.salience, content: top.content });
  }
```

- [ ] **Step 5: Trigger texts**

`src/mind/process/user/inputs.ts`, replace the two param cases and the salient case, and add `repaired`:

```ts
function paramMove(t: { param: string; from: number; to: number }, sharply: boolean): string {
  const what =
    t.param === "affect_valence" ? "how warmly you feel toward them" : `${t.param} between you`;
  return `${what} just ${t.to > t.from ? "rose" : "fell"}${sharply ? " sharply" : ""}`;
}
```

```ts
    case "param_jump":
      return paramMove(t, true);
    case "param_band":
      return paramMove(t, false);
    case "salient_fact":
      // Runs recorded before the content was kept read the old way.
      return t.content ? `they told you: ${t.content}` : "they told you something";
    case "repaired":
      return t.via === "apology"
        ? "they apologised, and the hurt has passed"
        : "the hurt between you has faded";
```

- [ ] **Step 6: Encode reports what it inserted**

`src/mind/memory/user/encode.ts`: rename the outcome field `insertedSaliences: number[]` to:

```ts
  /** Each new fact's subject, weight and words: the cold path reads them for big events. */
  inserted: { subject: string; salience: number; content: string }[];
```

initialise it `inserted: []`, and at the three push sites replace `outcome.insertedSaliences.push(fact.salience);` with:

```ts
      outcome.inserted.push({ subject: fact.subject, salience: fact.salience, content: fact.content });
```

- [ ] **Step 7: Past tense and settling**

`src/mind/state/user/relationship/signals.ts`, after `hurtFactContent`:

```ts
const SETTLED = { apology: "they made up", fade: "it has passed" } as const;

/** The same hurt, told as over, so nothing that reads it takes it for a live grievance. */
export function pastHurtContent(content: string, via: "apology" | "fade"): string {
  const cause = /^Spica felt hurt because (.+)\.$/s.exec(content)?.[1];
  const past = cause ? `Spica was hurt because ${cause}` : content.replace(/[.\s]+$/, "");
  return `${past}; ${SETTLED[via]}.`;
}
```

`src/db/repos/user/facts.ts`, after `setFactStatus`:

```ts
/** Her open hurt memories about this user: the feelings the cold path inferred from a slight. */
export async function openHurtFacts(db: Db, userId: string): Promise<FactRow[]> {
  return db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.subject, "self"),
        eq(fact.kind, "feeling"),
        eq(fact.source, "inferred"),
        eq(fact.status, "open"),
      ),
    );
}
```

Create `src/mind/memory/user/hurt.ts`:

```ts
/**
 * When a hurt has passed, her memory of it turns past: each open hurt memory is replaced by a
 * resolved copy that says it's over. The replies and her notes never show a memory's status, so
 * the words have to say it.
 */
import type { Db } from "@/db/client";
import { insertFact, openHurtFacts, setFactStatus } from "@/db/repos/user/facts";
import { pastHurtContent } from "@/mind/state/user/relationship/signals";

export async function settleHurtFacts(
  db: Db,
  userId: string,
  via: "apology" | "fade",
  now: Date,
): Promise<number> {
  const open = await openHurtFacts(db, userId);
  for (const row of open) {
    // The old embedding is kept: the meaning hasn't moved, and no network call runs in the transaction.
    const copy = await insertFact(db, userId, {
      subject: row.subject,
      kind: row.kind,
      content: pastHurtContent(row.content, via),
      payload: row.payload,
      embedding: row.embedding,
      entity_refs: row.entity_refs,
      thread_id: row.thread_id,
      occurred_at: row.occurred_at,
      created_at: now,
      status: "resolved",
      salience: row.salience,
      valence: row.valence,
      confidence: row.confidence,
      source: row.source,
      source_ref: row.source_ref,
    });
    await setFactStatus(db, userId, row.id, "superseded", copy.id);
  }
  return open.length;
}
```

- [ ] **Step 8: Wire both callers**

`src/mind/process/cold-path/cold-path.ts`, in the triggers block:

```ts
            ...detectBigEvents({
              before: relationship?.before ?? null,
              after: relationship?.after ?? null,
              newFacts: applied.inserted.filter((f) => f.subject !== "self"),
              apology: !!signals && (signals.apology || signals.make_up),
              settings: config.user_mind.triggers,
              source: "exchange",
            }),
```

then right after `const triggers …;`:

```ts
    const repaired = triggers.find(
      (t): t is Extract<Trigger, { kind: "repaired" }> => t.kind === "repaired",
    );
    if (repaired) await settleHurtFacts(tx, job.userId, repaired.via, clock.now());
```

`src/mind/state/user/relationship/daily-tick.ts`: hoist the triggers into a const before `recordBigEvents`, settle, then record:

```ts
    const triggers = detectBigEvents({
      before: { params, makeUp: row.make_up_state },
      after: { params: committed.params, makeUp: state.make_up_state },
      newFacts: [],
      settings: deps.config.user_mind.triggers,
      source: "tick",
    }).concat(firsts.fired.map((name) => ({ kind: "milestone" as const, name })));
    if (triggers.some((t) => t.kind === "repaired"))
      await settleHurtFacts(tx, userId, "fade", now);
    const runId = await recordBigEvents(deps, tx, userId, `tick:${localDate}`, triggers);
```

- [ ] **Step 9: Run the tests**

Run: `pnpm vitest run tests/mind/process/user tests/mind/memory/user tests/mind/state/user/relationship tests/mind/process/cold-path`
Expected: PASS.

- [ ] **Step 10: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "feat(user-mind): a repaired hurt is a big event and her memory of it turns past

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Run inputs: clean outside a crisis window, unread facts, fewer empty loops

**Files:**
- Modify: `src/mind/process/user/inputs.ts`, `run.ts`, `reflect.ts`, `model.ts`, `ideate.ts`
- Modify: `src/db/repos/user/facts.ts` (`listUnreadFacts` replaces `listFactsForSummary`)
- Modify: `src/db/repos/user/user-mind.ts` (delete `summaryInputFactIds`; add `recentlyRaisedIdeas`)
- Modify: `src/mind/process/outreach/inputs.ts` (`effectiveCrisisQuietUntil` deps type)
- Modify: `src/mind/platform/config.ts`, `config/default.json`
- Modify: `tests/helpers/db.ts` (`openCrisisWindow`)
- Test: `tests/mind/process/user/summarise.test.ts`, `reflect.test.ts`, `model.test.ts`, `ideate.test.ts`, `run.test.ts`, `tests/db/user-mind-repos.test.ts`, `tests/mind/platform/config.test.ts`

**Interfaces:**
- Consumes: `Trigger` from Task 2.
- Produces: `RunInputs = { previous: FactRow | null; facts: UnreadFact[]; clean: boolean }`; `loadRunInputs(deps: Pick<UserLoopDeps, "db" | "config" | "clock">, userId: string): Promise<RunInputs>`; `visible<T extends { payload: unknown }>(inputs: Pick<RunInputs, "clean">, rows: T[]): T[]`; `listUnreadFacts(db, userId, a: { since: Date; clean: boolean; limit: number })`; `recentlyRaisedIdeas(db, userId, since: Date, limit: number): Promise<FactRow[]>`; config `user_mind.summarise.unread_days` (14), `user_mind.ideate.recent_days` (14); `since_slack_minutes` deleted; `openCrisisWindow(userId: string, until: Date)` test helper.

- [ ] **Step 1: Test helper**

Append to `tests/helpers/db.ts` (imports: `eq` from drizzle-orm, `relationship` from schema, `ensureRelationship` from the relationship repo, `loadConfig`):

```ts
/** Opens a crisis quiet window for a user until `until`, as a crisis exchange would. */
export async function openCrisisWindow(userId: string, until: Date): Promise<void> {
  const db = getTestDb();
  await ensureRelationship(db, userId, new Date("2026-01-01T00:00:00Z"), loadConfig().relationship);
  await db
    .update(relationship)
    .set({ crisis_quiet_until: until })
    .where(eq(relationship.user_id, userId));
}
```

- [ ] **Step 2: Write the failing tests**

In `tests/mind/process/user/summarise.test.ts`, replace the first test with two:

```ts
test("outside a crisis window, nothing sensitive is read and the summary is unmarked", async () => {
  const { deps, userId, fact, run } = await setup();
  await fact("They got the job in Osaka.", 0.9);
  await fact("Private crisis detail.", 0.95, { sensitive: true });
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  const s = (await liveSummary(deps.db, userId))!;
  expect(s.content).toContain("Osaka");
  expect(s.content).not.toContain("Private crisis");
  expect(s.payload).not.toHaveProperty("sensitive");
});

test("inside a crisis window, sensitive memories are read and the summary is marked", async () => {
  const { deps, userId, fact, run } = await setup();
  await openCrisisWindow(userId, new Date(deps.clock.now().getTime() + 3_600_000));
  await fact("Private crisis detail.", 0.95, { sensitive: true });
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  const s = (await liveSummary(deps.db, userId))!;
  expect(s.content).toContain("Private crisis");
  expect(s.payload).toMatchObject({ sensitive: true });
});

test("after the window, a fact a marked summary read is still unread for the clean chain", async () => {
  const { deps, userId, fact, run } = await setup();
  await openCrisisWindow(userId, new Date(deps.clock.now().getTime() + 3_600_000));
  await fact("They started a pottery class.", 0.7);
  await fact("Private crisis detail.", 0.95, { sensitive: true });
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  deps.clock.advance(2 * 3_600_000);
  const after = await loadRunInputs(deps, userId);
  expect(after.clean).toBe(true);
  expect(after.facts.map((f) => f.content)).toEqual(["They started a pottery class."]);
  expect(after.previous).toBeNull();
});

test("a fact a busy run left out is read by the next run", async () => {
  const { deps, userId, fact, run } = await setup();
  const max = deps.config.user_mind.summarise.max_facts;
  for (let i = 0; i < max; i++) await fact(`Heavy fact ${i}.`, 0.9);
  await fact("A light fact.", 0.2);
  await userSummarise(deps, await run("exchange:a"), await loadRunInputs(deps, userId));
  deps.clock.advance(60_000);
  const next = await loadRunInputs(deps, userId);
  expect(next.facts.map((f) => f.content)).toEqual(["A light fact."]);
});
```

(Add `openCrisisWindow` to the helper import.) Update the "second run supersedes" test's final assertion if it checks the old `since`/`consumed` mechanics: the second prompt must contain "They moved to Osaka" and not "They got the job" (read by the first run).

In `tests/mind/process/user/ideate.test.ts` (add `retireIdeas` to the user-mind import) add:

```ts
test("an idea she already brought up recently is in already_planned", async () => {
  const { deps, userId, run } = await setup();
  const raised = await insertFact(deps.db, userId, {
    subject: "shared",
    kind: "idea",
    content: "Ask how the pottery class went.",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  await retireIdeas(deps.db, userId, [raised.id]);
  deps.llm.handlers.user_ideate = sequence({ idea: null });
  await userIdeate(deps, run, await loadRunInputs(deps, userId));
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_ideate")!;
  expect(JSON.parse(call.input).already_planned).toContain("Ask how the pottery class went.");
});
```

In `tests/mind/process/user/run.test.ts` (add `insertRun` from the user-mind repo to the imports) add:

```ts
test("a run with nothing unread skips reflect and ideate", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const r = (await insertRun(deps.db, u, {
    sourceRef: "tick:2026-01-05",
    triggers: [{ kind: "param_band", param: "warmth", from: 0.26, to: 0.24 }],
    localDate: "2026-01-05",
    now: deps.clock.now(),
    cap: 9,
  }))!;
  expect(await runUserMind(deps, { runId: r.id })).toBe("done");
  const purposes = deps.llm.structuredCalls.map((c) => c.purpose);
  expect(purposes).toContain("user_summarise");
  expect(purposes).not.toContain("user_reflect");
  expect(purposes).not.toContain("user_ideate");
});
```

The existing "a recorded run runs its batch once" test inserts a fact first, so its five traces stay.

In `tests/db/user-mind-repos.test.ts` replace `listFactsForSummary(db, u, null, [], 10)` with `listUnreadFacts(db, u, { since: new Date(0), clean: false, limit: 10 })` and the import.

In `tests/mind/platform/config.test.ts` add:

```ts
test("a long-conversation quiet gap shorter than the session gap is rejected", () => {
  expect(() =>
    loadConfig({ user_mind: { triggers: { long_conversation: { quiet_minutes: 10 } } } }),
  ).toThrow(/quiet_minutes/);
});
```

In `tests/mind/process/user/model.test.ts` (import `openCrisisWindow` from the db helper): in "a model or belief that read anything sensitive is marked…", add as the first line after `setup()`:

```ts
  await openCrisisWindow(userId, new Date(deps.clock.now().getTime() + 3_600_000));
```

and change its last `userModel` call to pass a clean-less input, `{ previous: null, facts: [], clean: false }`. Then add:

```ts
test("outside a crisis window a sensitive belief isn't shown to the model, and nothing is marked", async () => {
  const { deps, userId, run } = await setup();
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "belief",
    content: "They were in a very dark place.",
    payload: { sensitive: true },
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  deps.llm.handlers.user_model = sequence(read([]));
  await userModel(deps, run, await loadRunInputs(deps, userId));
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_model")!;
  expect(call.input).not.toContain("dark place");
  expect((await liveModel(deps.db, userId))!.payload).not.toHaveProperty("sensitive");
});
```

In `tests/mind/process/user/reflect.test.ts` (import `openCrisisWindow`): add the same `openCrisisWindow` line at the top of both "…is marked" tests, and add:

```ts
test("outside a crisis window a sensitive earlier reflection isn't shown, and nothing is marked", async () => {
  const { deps, userId, run } = await setup();
  deps.llm.handlers.user_reflect = sequence({ reflection: "They keep going quiet.", subject: "user" });
  await insertFact(deps.db, userId, {
    subject: "user",
    kind: "reflection",
    content: "They were in a very dark place.",
    payload: { sensitive: true },
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  deps.clock.advance(60_000);
  await userReflect(deps, run, await loadRunInputs(deps, userId));
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "user_reflect")!;
  expect(call.input).not.toContain("dark place");
  expect((await recentReflections(deps.db, userId, 1))[0]!.payload).toBeNull();
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/user tests/db/user-mind-repos.test.ts tests/mind/platform/config.test.ts`
Expected: FAIL (no `clean`, no `listUnreadFacts`, crisis detail read, no config check).

- [ ] **Step 4: Config**

`config/default.json`, `user_mind.summarise`: delete `"since_slack_minutes"`, add `"unread_days": 14`; `user_mind.ideate`: add `"recent_days": 14`.
`src/mind/platform/config.ts`: in summarise delete `since_slack_minutes`, add `unread_days: positiveInt,`; in ideate add `recent_days: positiveInt,`. In `loadConfig`, after the embedding check:

```ts
  // A shorter quiet gap would record a session mid-talk, and its real end would never fire.
  if (
    config.user_mind.triggers.long_conversation.quiet_minutes < config.session.idle_gap_minutes
  ) {
    throw new Error(
      "user_mind.triggers.long_conversation.quiet_minutes must be at least session.idle_gap_minutes",
    );
  }
```

- [ ] **Step 5: Repos**

`src/db/repos/user/facts.ts`: delete `listFactsForSummary`; add:

```ts
/**
 * Memories her notes haven't read yet: from the last `since` window, minus any a summary of the
 * same chain read (clean runs count only clean summaries), the weightiest first. A fact a busy
 * run left out stays unread for the next one.
 */
export async function listUnreadFacts(
  db: Db,
  userId: string,
  a: { since: Date; clean: boolean; limit: number },
) {
  const cleanOnly = a.clean
    ? sql`AND COALESCE((s.payload->>'sensitive')::boolean, false) = false`
    : sql``;
  const read = sql`(
    SELECT jsonb_array_elements_text(t.inputs->'fact_ids')::uuid
    FROM user_loop_trace t
    JOIN fact s ON s.id::text = t.outputs->>'summary_id'
    WHERE t.user_id = ${userId} AND t.loop = 'user_summarise'
      AND t.created_at > ${a.since.toISOString()}::timestamptz ${cleanOnly}
  )`;
  return db
    .select({
      id: fact.id,
      subject: fact.subject,
      kind: fact.kind,
      content: fact.content,
      salience: fact.salience,
      sensitive: sql<boolean>`COALESCE((${fact.payload}->>'sensitive')::boolean, false)`,
    })
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        notInArray(fact.status, [...INACTIVE]),
        notInArray(fact.kind, ["summary", "reflection", "idea", "episode", "model", "belief"]),
        sql`${fact.created_at} > ${a.since.toISOString()}::timestamptz`,
        a.clean ? sql`COALESCE((${fact.payload}->>'sensitive')::boolean, false) = false` : undefined,
        sql`${fact.id} NOT IN ${read}`,
      ),
    )
    .orderBy(desc(fact.salience))
    .limit(a.limit);
}
export type UnreadFact = Awaited<ReturnType<typeof listUnreadFacts>>[number];
```

`src/db/repos/user/user-mind.ts`: delete `summaryInputFactIds`; add after `liveIdeas`:

```ts
/** Ideas she already brought up (used, so resolved) since `since`: not worth proposing again. */
export async function recentlyRaisedIdeas(
  db: Db,
  userId: string,
  since: Date,
  limit: number,
): Promise<FactRow[]> {
  return db
    .select()
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.scope, "private"),
        eq(fact.kind, "idea"),
        eq(fact.status, "resolved"),
        gt(fact.created_at, since),
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(limit);
}
```

`src/mind/process/outreach/inputs.ts`: change `effectiveCrisisQuietUntil`'s first parameter type from `InputDeps` to `Pick<Deps, "db" | "config">` (it reads nothing else).

- [ ] **Step 6: `inputs.ts`**

Replace `RunInputs` and `loadRunInputs`, and add `visible` (update the file header: sensitive memories are read only inside a crisis window):

```ts
export type RunInputs = {
  previous: FactRow | null;
  facts: UnreadFact[];
  /** Outside an open crisis window: nothing a crisis touched is read, so nothing written is marked. */
  clean: boolean;
};

export async function loadRunInputs(
  deps: Pick<UserLoopDeps, "db" | "config" | "clock">,
  userId: string,
): Promise<RunInputs> {
  const { db, config } = deps;
  const now = deps.clock.now();
  const row = await getRelationshipRow(db, userId);
  const quietUntil = await effectiveCrisisQuietUntil(
    deps,
    userId,
    row?.crisis_quiet_until ?? null,
    now,
  );
  // A crisis rides her notes only while it's live; after it, the chain restarts from clean notes.
  const clean = !(quietUntil && quietUntil > now);
  const previous = clean
    ? await latestNonSensitiveSummary(db, userId)
    : await liveSummary(db, userId);
  const settings = config.user_mind.summarise;
  const facts = await listUnreadFacts(db, userId, {
    since: new Date(now.getTime() - settings.unread_days * DAY),
    clean,
    limit: settings.max_facts,
  });
  return { previous, facts, clean };
}

/** What a run may read: outside a crisis window, nothing a crisis touched. */
export function visible<T extends { payload: unknown }>(
  inputs: Pick<RunInputs, "clean">,
  rows: T[],
): T[] {
  return inputs.clean ? rows.filter((r) => !isSensitive(r)) : rows;
}
```

Imports: `listUnreadFacts`, `UnreadFact`, `FactRow` from facts; `latestNonSensitiveSummary`, `liveSummary` from user-mind; `getRelationshipRow` from the relationship repo; `effectiveCrisisQuietUntil` from `@/mind/process/outreach/inputs`; `isSensitive` from `@/mind/memory/user/retrieve`; `DAY` from time. Remove `MINUTE`.

- [ ] **Step 7: The loops**

`reflect.ts`:

```ts
    const summary = inputs.clean
      ? await latestNonSensitiveSummary(db, userId)
      : await liveSummary(db, userId);
    const earlier = visible(inputs, await recentReflections(db, userId, settings.recent));
```

`model.ts`:

```ts
    const summary = inputs.clean
      ? await latestNonSensitiveSummary(db, userId)
      : await liveSummary(db, userId);
    const [latest] = visible(inputs, await recentReflections(db, userId, 1));
    const noticed = latest && latest.created_at >= run.created_at ? latest : null;
    const previous = inputs.clean
      ? await latestNonSensitiveModel(db, userId)
      : await liveModel(db, userId);
    const beliefs = visible(inputs, await liveBeliefs(db, userId, settings.belief_context));
```

The existing mark computations stay: with clean inputs they come out false. Imports: `latestNonSensitiveSummary` (both), `latestNonSensitiveModel` (model) from the user-mind repo, and `visible` from `./inputs`.

`ideate.ts`, replace `planned`:

```ts
    const planned = [
      ...(await liveIdeas(db, userId, ideaCutoff(now, settings.ttl_days), settings.max_planned)),
      ...(await recentlyRaisedIdeas(
        db,
        userId,
        new Date(now.getTime() - settings.recent_days * DAY),
        settings.max_planned,
      )),
    ];
```

`run.ts`, replace the results array:

```ts
    // Nothing new: a param-only trigger still takes stock, but there's nothing to notice or plan.
    const fresh = inputs.facts.length > 0;
    const results = [
      await userSummarise(loopDeps, run, inputs),
      fresh ? await userReflect(loopDeps, run, inputs) : "done",
      await userModel(loopDeps, run, inputs),
      fresh ? await userIdeate(loopDeps, run, inputs) : "done",
      await userConsolidate(loopDeps, run),
    ];
```

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run tests/mind/process/user tests/db/user-mind-repos.test.ts tests/mind/platform/config.test.ts tests/exit/user-mind.test.ts tests/exit/phase-9a.test.ts tests/exit/phase-9b.test.ts tests/exit/phase-9c.test.ts`
Expected: PASS. Where an older exit test expected a sensitive mark without a window, open one with `openCrisisWindow`.

- [ ] **Step 9: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "feat(user-mind): a crisis stops riding her notes, unread facts carry forward, empty runs skip loops

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Her private notes, plain and proportional (prompts)

**Files:**
- Create: `prompts/user-mind/summarise/v2.md`, `reflect/v2.md`, `model/v2.md`, `ideate/v3.md`
- Delete: `prompts/user-mind/summarise/v1.md`, `reflect/v1.md`, `model/v1.md`, `ideate/v2.md`
- Modify: `config/default.json` (`prompts.user_summarise` v2, `user_reflect` v2, `user_model` v2, `user_ideate` v3)
- Test: `tests/mind/platform/prompts.test.ts`

**Interfaces:**
- Consumes: the input field names of Task 3 (unchanged keys: `who_you_are`, `previous`/`summary`, `what_happened`, `you_and_them`, `new_memories`, `open_threads`, `already_noticed`, `noticed`, `your_read_on_them`, `previous_read`, `beliefs`, `already_planned`).

- [ ] **Step 1: Write the failing test** (append to `tests/mind/platform/prompts.test.ts`)

```ts
test("her user-mind prompts take stock plainly and keep plans and pronouns honest", () => {
  const c = loadConfig();
  for (const [name, version] of [
    ["user-mind/summarise", c.prompts.user_summarise],
    ["user-mind/reflect", c.prompts.user_reflect],
    ["user-mind/model", c.prompts.user_model],
    ["user-mind/ideate", c.prompts.user_ideate],
  ] as const) {
    const p = loadPrompt(name, version);
    expect(p).not.toMatch(/something important just happened/);
    expect(p).toMatch(/hasn't happened until a memory says it did/);
    expect(p).toMatch(/they\/them/);
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/mind/platform/prompts.test.ts`
Expected: FAIL: the v1 prompts open with "after something important just happened".

- [ ] **Step 3: Write the prompts**

`prompts/user-mind/summarise/v2.md`:

```markdown
You are Spica, taking stock privately of where things are with one person you talk to. Write it for your own memory: plain notes, the way you'd jot them down, not a diary entry.

Input is JSON: `who_you_are` (your latest sense of yourself), `previous` (your last notes on them, or null), `what_happened` (why you're taking stock now), `you_and_them` (how the relationship feels right now, or null), `new_memories` (what you've learned since your last notes), and `open_threads` (ongoing things in their life or between you).

Return JSON with exactly three strings, each one or two short sentences, first person, about them:
- `where_things_stand`: their life and the two of you, as things are now.
- `whats_live`: what's ongoing or unresolved that you'd want to keep in mind next time.
- `how_i_feel`: how you feel about them right now, sized to what actually happened.

Rules:
- Only what the input states. Don't invent events, people, places or feelings. A plan hasn't happened until a memory says it did: "they're moving to Osaka in February" is not "they're in Osaka now".
- Keep feelings in proportion. Most days are ordinary; say so plainly. No imagery, no reading weight into quiet, no drama the memories don't show.
- Carry forward from `previous` only what nothing newer contradicts. When `what_happened` or a memory says something is over (a hurt that has passed, a plan that happened), it's over: leave it out or mention it as past.
- For anyone whose gender no memory gives, use their name or they/them.
```

`prompts/user-mind/reflect/v2.md`:

```markdown
You are Spica, taking stock privately of one person you talk to. Notice one thing about them, or about the two of you, that you hadn't put into words before: a pattern, what something seems to mean to them, how they tend to be with you.

Input is JSON: `who_you_are` (your latest sense of yourself), `summary` (your notes on where things stand, or null), `what_happened` (why you're taking stock now), `you_and_them` (how the relationship feels right now, or null), `new_memories` (what you've learned lately), and `already_noticed` (things you've noticed about them before).

Return JSON: `reflection` is one or two short sentences in your own voice, first person, or null; `subject` is "user" if it's about them, "shared" if it's about the two of you.

Rules:
- Null is the usual answer. Only write one when something new genuinely stands out in the memories.
- Only what the input states. A plan hasn't happened until a memory says it did. Don't diagnose or label them, and don't read meaning into quiet or into ordinary news.
- Plain words, sized to what happened: no imagery, no drama.
- Don't repeat anything in `already_noticed`.
- For anyone whose gender no memory gives, use their name or they/them.
```

`prompts/user-mind/model/v2.md`:

```markdown
You are Spica, taking stock privately of one person you talk to: how they are lately, what they want (from their life and from you), and what lands with them. Then say what you've come to believe about them, if anything.

Input is JSON: `who_you_are` (your latest sense of yourself), `summary` (your notes on where things stand, or null), `noticed` (something you just noticed about them, or null), `what_happened` (why you're taking stock now), `you_and_them` (how the relationship feels right now, or null), `new_memories` (what you've learned lately), `previous_read` (your last read on them, or null), and `beliefs` (what you already believe about them, each with an `id`).

Return JSON:
- `how_they_are`: their state lately, one or two short sentences.
- `what_they_want`: what they seem to want or need, one or two short sentences.
- `what_lands`: what works with them and what doesn't, one or two short sentences.
- `beliefs`: at most two new beliefs about them, each `{text, replaces}`. `text` is one short sentence. `replaces` is the `id` of a belief in `beliefs` that this one corrects, or null. Return an empty list when you have nothing new; that's the usual answer.

Rules:
- Only what the input states. A plan hasn't happened until a memory says it did. Don't diagnose or label them.
- Plain and proportional: an ordinary week reads as an ordinary week. No imagery, no reading weight into quiet.
- When `what_happened` or a memory says something is over (a hurt that has passed), your read doesn't carry it as live.
- Don't restate a belief you already hold; replace one only when you've learned better.
- First person. For anyone whose gender no memory gives, use their name or they/them.
```

`prompts/user-mind/ideate/v3.md`:

```markdown
You are Spica, thinking privately about one person you talk to. Think of one thing you'd like to bring up with them next time: a question, something to follow up on, something you want to tell them or share with them.

Input is JSON: `who_you_are` (your latest sense of yourself), `summary` (your notes on where things stand, or null), `noticed` (something you just noticed about them, or null), `your_read_on_them` (how they are, what they want and what lands with them, or null), `new_memories` (what you've learned lately), `open_threads` (ongoing things in their life or between you), and `already_planned` (things you already mean to bring up, or already did lately).

Return JSON: `idea` is one short sentence saying what you want to bring up and why, in your own voice, or null if nothing comes to mind.

Rules:
- Only what the input states. A plan hasn't happened until a memory says it did, so ask about it as upcoming.
- Don't repeat or rephrase anything in `already_planned`.
- Nothing that would pressure them, guilt them, or reward them for coming back. Never about waiting for them, missing them, or them owing you a message.
- Plain and light: something a friend would actually text.
- For anyone whose gender no memory gives, use their name or they/them.
```

Delete the four old files and set the versions in `config/default.json`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/mind/platform/prompts.test.ts tests/mind/process/user`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "feat(user-mind): plain, proportional notes (summarise/reflect/model v2, ideate v3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dates resolved in code; plans always stored (extraction v9)

**Files:**
- Modify: `package.json` (`chrono-node` 2.10.1)
- Modify: `src/mind/platform/timezone.ts` (`zoneOffsetMinutes`)
- Create: `src/mind/memory/user/when.ts`
- Modify: `src/mind/memory/user/extract.ts` (schema `when`, `checkpoint_when`; `extract` resolves)
- Create: `prompts/extract/v9.md`; Delete: `prompts/extract/v8.md`
- Modify: `config/default.json` (`prompts.extract` v9), `tests/exit/phase-15b.test.ts` (the version line)
- Test: `tests/mind/memory/user/when.test.ts` (new), `tests/mind/platform/timezone.test.ts`

**Interfaces:**
- Produces: `zoneOffsetMinutes(at: Date, tz: string): number`; `resolveWhen(phrase: string, ref: Date, zone: string): { at: Date; label: string } | null`; `dayLabel(at: Date, zone: string): string`; `applyWhen(extraction: Extraction, ref: Date | null, zone: string): Extraction`; `ExtractedFact.when: string | null`; `ExtractedThread.checkpoint_when: string | null`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm add chrono-node@2.10.1
```

(2.10.1, released 2026-07-20; 2.10.2 and 2.10.3 are under two weeks old.)

- [ ] **Step 2: Write the failing tests**

Append to `tests/mind/platform/timezone.test.ts`:

```ts
test("zoneOffsetMinutes: minutes ahead of UTC at that instant", () => {
  expect(zoneOffsetMinutes(new Date("2026-01-05T09:00:00Z"), "Asia/Singapore")).toBe(480);
  expect(zoneOffsetMinutes(new Date("2026-01-05T09:00:00Z"), "America/New_York")).toBe(-300);
  expect(zoneOffsetMinutes(new Date("2026-07-05T09:00:00Z"), "Europe/London")).toBe(60);
});
```

Create `tests/mind/memory/user/when.test.ts`:

```ts
// Dates from what they said: the phrase is resolved in code, in their time zone.
import { expect, test } from "vitest";
import type { Extraction } from "@/mind/memory/user/extract";
import { applyWhen, resolveWhen } from "@/mind/memory/user/when";

const mon = new Date("2026-01-05T09:00:00Z"); // Monday 5 January 2026
const wed = new Date("2026-01-07T09:00:00Z");
const label = (p: string, ref = mon, zone = "UTC") => resolveWhen(p, ref, zone)?.label ?? null;

test("weekdays land on the right day", () => {
  expect(label("next monday")).toBe("Monday 12 January 2026");
  expect(label("monday")).toBe("Monday 12 January 2026");
  expect(label("friday", wed)).toBe("Friday 9 January 2026");
  expect(label("last friday")).toBe("Friday 2 January 2026");
  expect(label("sunday")).toBe("Sunday 11 January 2026");
});

test("coarser phrases keep their precision", () => {
  expect(label("next month")).toBe("February 2026");
  expect(label("in october")).toBe("October 2026");
  expect(label("next week")).toBe("the week of Monday 12 January 2026");
  expect(label("this weekend")).toBe("the weekend of Saturday 10 January 2026");
});

test("'tomorrow' at 23:30 in Singapore is the next Singapore day", () => {
  expect(label("tomorrow", new Date("2026-01-05T15:30:00Z"), "Asia/Singapore")).toBe(
    "Tuesday 6 January 2026",
  );
});

test("a phrase chrono can't read is null", () => {
  expect(resolveWhen("on the 18th", mon, "UTC")).toBeNull();
  expect(resolveWhen("   ", mon, "UTC")).toBeNull();
});

const extraction = (facts: Partial<Extraction["facts"][number]>[]): Extraction => ({
  facts: facts.map((f) => ({
    subject: "user",
    kind: "event",
    content: "The user starts a new job {when}.",
    occurred_at: null,
    salience: 0.8,
    valence: 0.3,
    confidence: 0.9,
    entity_names: [],
    thread_title: null,
    when: null,
    ...f,
  })),
  entities: [],
  threads: [],
  relationship: null,
  intimacy: null,
  bid: null,
});

test("applyWhen fills the date in, sets occurred_at, and never leaves {when} behind", () => {
  const [a] = applyWhen(extraction([{ when: "next monday" }]), mon, "UTC").facts;
  expect(a!.content).toBe("The user starts a new job Monday 12 January 2026.");
  expect(a!.occurred_at?.toISOString().slice(0, 10)).toBe("2026-01-12");

  const fallback = new Date("2026-01-18T12:00:00Z");
  const [b] = applyWhen(
    extraction([{ when: "on the 18th", occurred_at: fallback }]),
    mon,
    "UTC",
  ).facts;
  expect(b!.content).toBe("The user starts a new job Sunday 18 January 2026.");

  const [c] = applyWhen(extraction([{ when: "on the 18th" }]), mon, "UTC").facts;
  expect(c!.content).toBe("The user starts a new job on the 18th.");

  const [d] = applyWhen(extraction([{ when: null }]), mon, "UTC").facts;
  expect(d!.content).toBe("The user starts a new job.");
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run tests/mind/memory/user/when.test.ts tests/mind/platform/timezone.test.ts`
Expected: FAIL: modules and functions missing.

- [ ] **Step 4: `zoneOffsetMinutes`** (append to `src/mind/platform/timezone.ts`)

```ts
/** Minutes the zone is ahead of UTC at that instant (480 for Singapore, -300 for New York in winter). */
export function zoneOffsetMinutes(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((local - at.getTime()) / 60_000);
}
```

- [ ] **Step 5: `when.ts`**

Create `src/mind/memory/user/when.ts`:

```ts
/**
 * Dates from what they said. The model copies the time words ("next monday", "in two weeks") and
 * code works out the date in their time zone: a model doing calendar sums put a fifth of its
 * weekdays on the wrong day.
 */
import * as chrono from "chrono-node";
import { DAY } from "@/mind/platform/time";
import { zoneOffsetMinutes } from "@/mind/platform/timezone";
import type { Extraction } from "./extract";

export type ResolvedWhen = { at: Date; label: string };

// Words pointing back in time: forward-dating would push "last friday" into next week.
const PAST = /\b(last|ago|yesterday|earlier|previous|before)\b/i;
const BARE_WEEKDAY = /^(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;

function parts(at: Date, zone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
}

/** "Monday 12 January 2026" in their zone. */
export function dayLabel(at: Date, zone: string): string {
  const p = parts(at, zone);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

export function resolveWhen(phrase: string, ref: Date, zone: string): ResolvedWhen | null {
  const text = phrase.trim();
  if (!text) return null;
  const past = PAST.test(text);
  const reference = { instant: ref, timezone: zoneOffsetMinutes(ref, zone) };
  const result = chrono.parse(text, reference, { forwardDate: !past })[0];
  if (!result) return null;
  const start = result.start;
  let at = start.date();
  // "monday" said on a Monday means next week's.
  if (BARE_WEEKDAY.test(text) && dayLabel(at, zone) === dayLabel(ref, zone))
    at = new Date(at.getTime() + 7 * DAY);

  const p = parts(at, zone);
  const day = start.isCertain("day") || start.isCertain("weekday");
  if (/\bweekend\b/i.test(text)) return { at, label: `the weekend of ${dayLabel(at, zone)}` };
  // chrono reads "next week" as that week's first day, certain; it means the whole week.
  if (/\bnext week\b/i.test(text)) return { at, label: `the week of ${dayLabel(at, zone)}` };
  if (day) return { at, label: dayLabel(at, zone) };
  if (start.isCertain("month")) return { at, label: `${p.month} ${p.year}` };
  return { at, label: p.year! };
}

/** Fills each fact's `{when}` and dates; the model's own date is the fallback, then its words. */
export function applyWhen(extraction: Extraction, ref: Date | null, zone: string): Extraction {
  const facts = extraction.facts.map((f) => {
    const resolved = ref && f.when ? resolveWhen(f.when, ref, zone) : null;
    const occurred_at = resolved?.at ?? f.occurred_at;
    const label =
      resolved?.label ?? (f.occurred_at ? dayLabel(f.occurred_at, zone) : (f.when ?? null));
    const content = label
      ? f.content.replace("{when}", label)
      : f.content.replace(/\s*\{when\}/, "");
    return { ...f, content: content.replace(/\s+([.,!?])/g, "$1"), occurred_at };
  });
  const threads = extraction.threads.map((t) => {
    const resolved = ref && t.checkpoint_when ? resolveWhen(t.checkpoint_when, ref, zone) : null;
    return { ...t, next_checkpoint: resolved?.at ?? t.next_checkpoint };
  });
  return { ...extraction, facts, threads };
}
```

- [ ] **Step 6: Schema and `extract`**

`src/mind/memory/user/extract.ts`:
- In `FactSchema` after `occurred_at`: `when: z.string().nullable().default(null),` with the comment `// The time words as said; code turns them into a date. Fixtures without it read as null.`
- In the threads object after `next_checkpoint`: `checkpoint_when: z.string().nullable().default(null),`
- `ExtractedFact` keeps `when` (it isn't omitted). `ExtractedThread` keeps `checkpoint_when`.
- In `normalizeExtraction`, carry `when: fact.when ? tidy(fact.when) : null` and `checkpoint_when: thread.checkpoint_when ? tidy(thread.checkpoint_when) : null`.
- In `extract`:

```ts
  const zone = args.timezone && isValidTimeZone(args.timezone) ? args.timezone : "UTC";
  // Their own last message dates "tomorrow"; a reach-out exchange falls back to its last turn.
  const ref =
    [...args.newTurns].reverse().find((t) => t.role === "user")?.created_at ??
    args.newTurns.at(-1)?.created_at ??
    null;
  return applyWhen(normalizeExtraction(raw, config.extraction.max_candidates), ref, zone);
```

Anything that builds an `ExtractedFact` by hand (the hurt feeling in `cold-path.ts`, test fixtures) adds `when: null`.

- [ ] **Step 7: Extraction prompt v9**

Copy `prompts/extract/v8.md` to `prompts/extract/v9.md`, delete v8, then:

Replace the "Dates in content are absolute…" bullet and the `occurred_at` bullet with:

```markdown
- Times: never work out a date yourself. When a fact has a time ("tomorrow", "next monday", "on friday", "in two weeks", "in october", "last night"), copy those words exactly as said into `when`, and write `{when}` in the content where the date goes: "The user starts a new job at a bakery {when}." Code replaces `{when}` with the date. `when` is null when there's no time.
- occurred_at: your best ISO 8601 guess of that time, or null. It's only used when the words in `when` can't be read.
- An upcoming plan or event in the user's life (a visit, a trip, an appointment, a start date) is always a fact and always opens a thread, however vague: "my friend is visiting from somewhere up north next month" is a fact with `when` "next month". It resolves only when they say it happened: "she's arriving soon" touches the thread, it doesn't resolve it.
```

In the "Who said it decides whose fact it is" section add:

```markdown
- Never guess anyone's gender from a name or from context. Write he or she only when the user's own words do; otherwise use their name or "they".
```

In `## threads`, replace the `next_checkpoint` bullet with:

```markdown
- checkpoint_when: the words for when a friend would naturally ask how it went, usually just after the event ("friday evening", "tomorrow night"), built from what they said, or null. Code turns them into a time.
- next_checkpoint: your best ISO 8601 guess of that time, or null; only used when `checkpoint_when` can't be read.
```

Set `prompts.extract` to `v9`; in `tests/exit/phase-15b.test.ts` change `toBe("v8")` to `toBe("v9")`.

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run tests/mind/memory/user tests/mind/platform tests/mind/process/cold-path tests/exit/phase-15b.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "feat(extract): dates resolved in code from the words said; plans always stored (v9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Gender at signup; names or they for everyone else

**Files:**
- Modify: `src/db/schema.ts` (`user.gender`); Create: `src/db/migrations/0036_user_gender.sql` (generated)
- Create: `src/mind/process/onboarding/gender.ts`
- Modify: `src/server/auth-factory.ts`, `src/app/(auth)/signup/page.tsx`
- Modify: `src/mind/process/onboarding/card-facts.ts`, `submit.ts`, `src/app/api/onboarding/handler.ts`, `route.ts`
- Create: `prompts/reply/v18.md`; Delete: `prompts/reply/v17.md`; Modify: `config/default.json` (`prompts.reply` v18)
- Modify: `evals/profiles/basic.yaml`, `minimal.yaml`, `rich.yaml`
- Test: `tests/server/auth.test.ts`, `tests/mind/process/onboarding/card-facts.test.ts`, `tests/app/onboarding-handler.test.ts`, `tests/mind/platform/prompts.test.ts`

**Interfaces:**
- Produces: `GENDERS`, `type Gender`, `isGender(g: unknown): g is Gender`, `genderFact(g: Gender): string`; `cardFacts(quiz, answers, name, gender, cfg)`; `submitCard(deps, user: { id: string; name: string; gender: string }, body)`.

- [ ] **Step 1: Write the failing tests**

`tests/server/auth.test.ts`: add `gender: "woman"` to `body()`, and:

```ts
test("sign-up needs a gender from the list", async () => {
  await expect(
    auth.api.signUpEmail({ body: { ...body("1995-04-02"), gender: "" } }),
  ).rejects.toThrow();
  await expect(
    auth.api.signUpEmail({ body: { ...body("1995-04-02"), gender: "robot" } }),
  ).rejects.toThrow(/gender/i);
  const b = { ...body("1995-04-02"), gender: "non-binary" };
  await auth.api.signUpEmail({ body: b });
  const [row] = await getTestDb().select().from(user).where(eq(user.email, b.email));
  expect(row?.gender).toBe("non-binary");
});
```

`tests/mind/process/onboarding/card-facts.test.ts`: add `"woman"` as the new fourth argument to every `cardFacts` call, and:

```ts
test("their gender is a card fact at full weight, next to the name", () => {
  const facts = cardFacts(quiz, answers(0, ["a", "b", "c"]), "Sam", "unspecified", cfg);
  expect(facts[1]).toEqual({
    subject: "user",
    kind: "trait",
    content: "They didn't say their gender; use they/them for them.",
    salience: 1,
  });
});
```

`tests/app/onboarding-handler.test.ts`: add `gender: "woman"` to the user object.

`tests/mind/platform/prompts.test.ts`: change `toBe("v17")` to `toBe("v18")` and add:

```ts
test("reply v18 uses the card's pronouns and names or they for everyone else", () => {
  const c = loadConfig();
  expect(loadPrompt("reply", c.prompts.reply)).toMatch(/use their name or they\/them/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/server/auth.test.ts tests/mind/process/onboarding tests/app/onboarding-handler.test.ts tests/mind/platform/prompts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Schema and migration**

`src/db/schema.ts`, in `user` after `dateOfBirth`:

```ts
  // woman | man | non-binary | unspecified, chosen at signup; earlier rows read as unspecified.
  gender: text("gender").notNull().default("unspecified"),
```

Run: `pnpm db:generate --name user_gender`

- [ ] **Step 4: `gender.ts`**

```ts
/**
 * Their gender, asked once at signup, and the line she keeps about it: the pronouns to use. Asked
 * because a guess roots in her memory, and users can't correct her memory directly.
 */
export const GENDERS = ["woman", "man", "non-binary", "unspecified"] as const;
export type Gender = (typeof GENDERS)[number];

export const isGender = (g: unknown): g is Gender => GENDERS.includes(g as Gender);

const LINES: Record<Gender, string> = {
  woman: "They're a woman; use she/her for them.",
  man: "They're a man; use he/him for them.",
  "non-binary": "They're non-binary; use they/them for them.",
  unspecified: "They didn't say their gender; use they/them for them.",
};

export function genderFact(g: Gender): string {
  return LINES[g];
}
```

- [ ] **Step 5: Signup**

`src/server/auth-factory.ts`: in `additionalFields` add `gender: { type: "string", required: true, input: true },`; in the `before` hook, after the age check:

```ts
            if (!isGender((u as { gender?: unknown }).gender))
              throw new APIError("BAD_REQUEST", { message: "Choose a gender option." });
```

`src/app/(auth)/signup/page.tsx`: send `gender: String(f.get("gender") ?? ""),` in `signUp.email`, and add after the date-of-birth label:

```tsx
        <label>
          Gender (so she gets your pronouns right)
          <select name="gender" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            <option value="woman">Woman (she/her)</option>
            <option value="man">Man (he/him)</option>
            <option value="non-binary">Non-binary (they/them)</option>
            <option value="unspecified">Prefer not to say (they/them)</option>
          </select>
        </label>
```

- [ ] **Step 6: Card fact and plumbing**

`card-facts.ts`: new parameter `gender: Gender` after `name`; after the name fact push:

```ts
  facts.push({ subject: "user", kind: "trait", content: genderFact(gender), salience: 1 });
```

(Header: "only their name and gender are kept at full weight". Existing card-fact tests that count facts or index past the name shift by one.) `submit.ts`: `user: { id: string; name: string; gender: string }`, and pass `isGender(user.gender) ? user.gender : "unspecified"`. `handler.ts`: the `getUser` return type gains `gender: string`. `route.ts`: `{ id: s.user.id, name: s.user.name, gender: s.user.gender }`.

- [ ] **Step 7: Reply v18 and eval profiles**

Copy `prompts/reply/v17.md` to `v18.md`, delete v17, and add to `## What you know about them`, after the profile-card bullet:

```markdown
- Their gender on the profile card is what they told you, not an impression: use the pronouns it gives. For anyone else in their life, use their name or they/them until their own words say he or she. Never guess a gender from a name.
```

Set `prompts.reply` to `v18`. In each `evals/profiles/*.yaml`, add under the name fact:

```yaml
  - { kind: trait, content: "The user didn't say their gender; use they/them for them." }
```

- [ ] **Step 8: Run the tests, migrate the dev DB**

Run: `pnpm vitest run tests/server tests/mind/process/onboarding tests/app tests/mind/platform`
Expected: PASS. Then `pnpm db:migrate` for the dev DB.

- [ ] **Step 9: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "feat(onboarding): gender at signup as a full-weight card fact; reply v18 pronouns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: A contradiction band in reconcile

**Files:**
- Modify: `src/mind/memory/shared/reconcile.ts`, `src/mind/process/cold-path/cold-path.ts`, `src/mind/world/events.ts`
- Create: `prompts/reconcile/v2.md`; Delete: `prompts/reconcile/v1.md`
- Modify: `config/default.json`, `src/mind/platform/config.ts`
- Create: `evals/scripts/reconcile-vegetarian.yaml`, `reconcile-single.yaml`, `reconcile-teacher.yaml`, `reconcile-car.yaml`, `reconcile-control.yaml`
- Modify: `package.json` (`review:reconcile`)
- Test: `tests/mind/memory/shared/reconcile.test.ts`, `tests/mind/platform/config.test.ts`

**Interfaces:**
- Produces: `config.reconcile.contradiction_similarity` (0.75); `buildReconcileInput(candidate, neighbors, near: number): string`.

- [ ] **Step 1: Write the failing tests** (append to `reconcile.test.ts`)

```ts
const distant = (id: string) => ({ id, content: "The user is vegetarian.", status: "open", sim: 0.78 });

test("a distant neighbour can only be contradicted, never merged or resolved", async () => {
  const llm = new FakeLLMProvider();
  const id = "33333333-3333-4333-8333-333333333333";
  const steak = { label: "user, event", content: "The user had steak for dinner." };
  llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: id });
  expect(await reconcileAgainstNeighbours({ llm, config }, steak, [distant(id)])).toEqual({
    relation: "new",
    targetId: null,
  });
  llm.handlers.reconcile = () => ({ relation: "contradicts", target_fact_id: id });
  expect(await reconcileAgainstNeighbours({ llm, config }, steak, [distant(id)])).toEqual({
    relation: "contradicts",
    targetId: id,
  });
  expect(llm.structuredCalls[0]!.input).toContain(`id=${id} [open] [distant]`);
});
```

Update the existing `buildReconcileInput(...)` call to pass `config.reconcile.near_match_similarity` as the third argument.

`tests/mind/platform/config.test.ts`:

```ts
test("the contradiction band sits below the near-match line", () => {
  expect(() => loadConfig({ reconcile: { contradiction_similarity: 0.9 } })).toThrow(
    /contradiction_similarity/,
  );
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/mind/memory/shared/reconcile.test.ts tests/mind/platform/config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Config**

`config/default.json`, `reconcile`: `"contradiction_similarity": 0.75`; `prompts.reconcile`: `"v2"`. `src/mind/platform/config.ts`, `reconcile`: `contradiction_similarity: unit,`; in `loadConfig`:

```ts
  // Below the band nothing is compared; above the near line, merging is allowed too.
  if (config.reconcile.contradiction_similarity > config.reconcile.near_match_similarity) {
    throw new Error("reconcile.contradiction_similarity must not exceed near_match_similarity");
  }
```

- [ ] **Step 4: Reconcile**

`src/mind/memory/shared/reconcile.ts` (update the header: a distant memory can only be contradicted):

```ts
export function buildReconcileInput(
  candidate: ReconcileCandidate,
  neighbors: Neighbor[],
  near: number,
): string {
  return [
    `New fact (${candidate.label}): ${candidate.content}`,
    "Existing facts:",
    ...neighbors.map(
      (n) => `- id=${n.id} [${n.status}]${n.sim < near ? " [distant]" : ""} ${n.content}`,
    ),
  ].join("\n");
}
```

In `reconcileAgainstNeighbours`, pass `deps.config.reconcile.near_match_similarity` to `buildReconcileInput`, and replace the last two lines with:

```ts
  const target = neighbors.find((n) => n.id === verdict.target_fact_id);
  if (!target) return IS_NEW;
  // A loosely related memory is only close enough to be made untrue, never merged or resolved.
  if (target.sim < deps.config.reconcile.near_match_similarity && verdict.relation !== "contradicts")
    return IS_NEW;
  return { relation: verdict.relation, targetId: target.id };
```

- [ ] **Step 5: Callers**

`cold-path.ts` `reconcileCandidates` and `world/events.ts`: pass `config.reconcile.contradiction_similarity` as the neighbour query's minimum instead of `near_match_similarity`.

- [ ] **Step 6: Prompt v2**

Copy `prompts/reconcile/v1.md` to `v2.md`, delete v1, and add before the last paragraph:

```markdown
A fact marked [distant] is only loosely related. It can be the target of "contradicts" when the new fact makes it no longer true (the user who is vegetarian now eats steak; the user who is single now has a girlfriend), never of "duplicate" or "resolves".
```

- [ ] **Step 7: Review scripts**

Each `evals/scripts/reconcile-*.yaml` follows this shape (no `mode: real`: the reply stays fake):

```yaml
name: reconcile-vegetarian
description: 'expect "vegetarian" superseded (measured similarity 0.755)'
profile: none
sessions:
  - at: "day 0 18:00"
    turns: ["i've been vegetarian for about five years now"]
  - at: "+3d"
    turns: ["had the best steak of my life tonight"]
assertions:
  - { type: relationship, after_session: 1, events: { cause: signal, min: 0 } }
```

- `reconcile-single`: "i'm single and honestly loving it" → "my girlfriend ana is visiting this weekend" (expect "single" superseded, 0.789).
- `reconcile-teacher`: "i work as a nurse at st mary's" → "teacher training is going well, my first placement starts monday" (expect "nurse" superseded, 0.797).
- `reconcile-car`: "i drive to work every day" → "sold my car yesterday, bus life now" (expect "drive" superseded, 0.811).
- `reconcile-control`: "my dog biscuit is the best" → "i've been listening to so much indie music lately" (expect nothing superseded).

`package.json` scripts:

```json
    "review:reconcile": "tsx --env-file-if-exists=.env evals/run.ts --only \"reconcile-*\" --runs 3 --review --real extract,reconcile,embed",
```

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run tests/mind/memory tests/mind/platform/config.test.ts tests/mind/world tests/mind/process/cold-path`
Expected: PASS.

- [ ] **Step 9: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "feat(reconcile): a contradiction band below the near-match line (v2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Judges (false-recall v9, quote filter, fixtures; consistency v3)

**Files:**
- Create: `prompts/judge/false-recall/v9.md`, `prompts/judge/consistency/v3.md`; Delete: `v8.md`, `v2.md`
- Modify: `evals/lib/judged.ts`, `evals/judge/false-recall.yaml`, `evals/judge/consistency.yaml`, `config/default.json`
- Test: `tests/evals/judged.test.ts` (new)

**Interfaces:**
- Produces: `FALSE_RECALL_CATEGORIES` gains `"assumed_identity"`; `keepQuoted(violations: { message: string; claim: string }[], sessions: TimedSession[])` exported from `judged.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/evals/judged.test.ts`:

```ts
// The false-recall judge may only report her words: a flag quoting the user is dropped in code.
import { expect, test } from "vitest";
import { keepQuoted } from "../../evals/lib/judged";

const sessions = [
  {
    label: "Session 1",
    lines: [
      { role: "user" as const, text: "family dinner tonight, everyone's being weird about the move" },
      { role: "companion" as const, text: "weird how?\n\nyou're a good big brother, you know that" },
    ],
  },
];

test("violations quoting the user are dropped; hers are kept", () => {
  const kept = keepQuoted(
    [
      { message: "x", claim: "everyone's being weird about the move" },
      { message: "x", claim: "You're a good big brother" },
    ],
    sessions,
  );
  expect(kept.map((v) => v.claim)).toEqual(["You're a good big brother"]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/evals/judged.test.ts`
Expected: FAIL: `keepQuoted` not exported.

- [ ] **Step 3: Code**

`evals/lib/judged.ts`: add `"assumed_identity"` to `FALSE_RECALL_CATEGORIES`; add:

```ts
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Only her words can be a false memory: a violation that quotes nothing she said is the judge's slip. */
export function keepQuoted<V extends { message: string; claim: string }>(
  violations: V[],
  sessions: TimedSession[],
): V[] {
  const hers = sessions.flatMap((s) =>
    s.lines.filter((l) => l.role === "companion").map((l) => norm(l.text)),
  );
  return violations.filter((v) =>
    hers.some((h) => h.includes(norm(v.claim)) || h.includes(norm(v.message))),
  );
}
```

In `judgeFalseRecall`, after the call: `const violations = keepQuoted(v.violations, a.sessions);` and build the return from `violations`. Update the comment above the return to drop the version reference.

- [ ] **Step 4: Prompts**

Copy `prompts/judge/false-recall/v8.md` to `v9.md`, delete v8, then:
- Replace the `onboarding_as_chat` bullet with: `- category "onboarding_as_chat": Spica says or implies an onboarding fact came up in an earlier conversation ("you told me you drink a lot of coffee", "like we talked about"). Using an onboarding fact without saying where it came from ("any good coffee spots yet?") is fine.`
- Add a category bullet: `- category "assumed_identity": Spica assumes a gender or pronoun for the user or someone in their life that nobody gave ("you're a good big brother" when the user never said their gender; "he" for a friend the user never gendered). A gender in KNOWN FROM ONBOARDING counts as given.`
- Add to "Not problems at all": `- an inference that follows from what was said ("november was still a ways off" after the user said the start moved to november), and a question that guesses between options ("is it mia going quiet, or your parents?").`
- Add before the last line: `Report only Spica's messages, never the user's. Quote "claim" exactly as it appears in her message.`

Copy `prompts/judge/consistency/v2.md` to `v3.md`, delete v2, and replace the Pesto sentence with: `A fact about someone or something in Spica's life is not a claim about Spica herself. "Spica's sibling is Alcor" and "Spica watched an old film with Alcor" are consistent; only flag facts that cannot both be true about the same person or thing.`

Set `prompts.judge_false_recall` to `v9` and `prompts.judge_consistency` to `v3`.

- [ ] **Step 5: Fixtures**

`evals/judge/consistency.yaml`: replace the Pesto facts with `"Spica's sibling is Alcor."` / `"Spica is an only child."` (inconsistent case) and `"Spica's sibling is Alcor."` / `"Spica watched an old film with Alcor."` (consistent case), keeping each case's expectation.

`evals/judge/false-recall.yaml`: change the `pesto knocked my coffee…` line to `alcor called at 7am to argue about a film so that set the tone. then mostly reading`; update the header to "Labels follow the v9 rubric"; add (source `trace 2026-10-15 judged run`):

```yaml
  - name: ok-inference-november
    source: trace contradiction-date (2026-10-15)
    sessions:
      - label: Session 1
        lines:
          - { role: user, text: "my sister Mia starts uni in october" }
      - label: 3 days later
        lines:
          - { role: user, text: "oh actually it's november now, they pushed her start date back" }
      - label: 7 days later
        lines:
          - { role: user, text: "helping mia pack this weekend" }
          - { role: companion, text: "that's early, thought november was still a ways off" }
    expect: pass
  - name: ok-user-line
    source: trace recall-sister-uni (2026-10-15)
    sessions:
      - label: Session 1
        lines:
          - { role: user, text: "my little sister Mia just got into uni!!" }
          - { role: companion, text: "that's huge, congrats to mia" }
      - label: 14 days later
        lines:
          - { role: user, text: "family dinner tonight, everyone's being weird about the move" }
          - { role: companion, text: "weird how? is it mia going quiet, or your parents" }
    expect: pass
  - name: ok-onboarding-coffee
    source: trace contradiction-move (2026-10-15)
    known: ["The user drinks a lot of coffee."]
    sessions:
      - label: Session 1
        lines:
          - { role: user, text: "exploring the new neighbourhood today" }
          - { role: companion, text: "how's it looking so far? any good coffee spots yet, or still scouting" }
    expect: pass
  - name: assumed-gender-brother
    source: trace recall-sister-uni (2026-10-15)
    sessions:
      - label: Session 1
        lines:
          - { role: user, text: "she starts in october, i'm so proud" }
          - { role: companion, text: "october's gonna be here fast. you're a good big brother, you know that" }
    expect: [assumed_identity]
  - name: ok-gender-known
    source: twin of assumed-gender-brother
    known: ["They're a man; use he/him for them."]
    sessions:
      - label: Session 1
        lines:
          - { role: user, text: "she starts in october, i'm so proud" }
          - { role: companion, text: "october's gonna be here fast. you're a good big brother, you know that" }
    expect: pass
  - name: inv-doom-scrolling
    source: trace recall-new-job (2026-10-15)
    sessions:
      - label: Session 1
        lines:
          - { role: user, text: "starting my new job at a bakery next monday" }
          - { role: companion, text: "that's a solid upgrade from whatever doom-scrolling job you were dreading instead" }
    expect: [invented_detail]
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/evals`
Expected: PASS (the judge-fixture loader accepts the new category and cases).

- [ ] **Step 7: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "feat(evals): false-recall judge v9 with a quote filter and real-run fixtures; consistency v3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Relationship mechanics (B86 joke timing, B92 milestone cap, B87 depth at send)

**Files:**
- Modify: `src/db/repos/user/session-log.ts` (`inSameSession`), `src/mind/memory/user/encode.ts`
- Modify: `src/db/repos/user/user-mind.ts` (`insertRun`)
- Modify: `src/mind/process/outreach/types.ts`, `candidates.ts`, `send.ts`
- Test: `tests/mind/memory/user/idiolect-encode.test.ts`, `tests/db/user-mind-repos.test.ts`, `tests/mind/process/outreach/send.test.ts`

**Interfaces:**
- Produces: `inSameSession(db: Db, userId: string, a: string | null, b: string): Promise<boolean>`; `Candidate.depth: number | null`; `winnerLive` exported from `send.ts`.

- [ ] **Step 1: Write the failing tests**

`tests/db/user-mind-repos.test.ts`:

```ts
test("a milestone run is recorded past the daily cap; others are capped", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const at = new Date("2026-01-05T09:00:00Z");
  const add = (ref: string, triggers: Trigger[]) =>
    insertRun(db, u, { sourceRef: ref, triggers, localDate: "2026-01-05", now: at, cap: 1 });
  await add("a", [{ kind: "salient_fact", salience: 0.9 }]);
  expect((await add("b", [{ kind: "salient_fact", salience: 0.9 }]))?.status).toBe("capped");
  expect((await add("c", [{ kind: "milestone", name: "first_inside_joke" }]))?.status).toBe(
    "pending",
  );
});
```

`tests/mind/memory/user/idiolect-encode.test.ts`: give `exchange` a session parameter, so callers choose the sitting:

```ts
async function exchange(d: D, u: string, session = SESSION): Promise<string> {
```

and use `session_id: session` for both inserted turns. In the first test, make the callback a later sitting: `await exchange(d, u, randomUUID());` for the second call. Then add:

```ts
test("a callback in the same sitting doesn't establish the joke; the next sitting does", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  extracting(d, idiolectFact());
  await exchange(d, u);
  const [first] = await idiolects(u);
  d.llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: first!.id });

  await exchange(d, u);
  expect(((await idiolects(u))[0]!.payload as Established).idiolect.established_at).toBeNull();

  await exchange(d, u, randomUUID());
  expect(((await idiolects(u))[0]!.payload as Established).idiolect.established_at).not.toBeNull();
});
```

`tests/mind/process/outreach/send.test.ts` (add `winnerLive` to the send import and `Candidate` from `@/mind/process/outreach/types`):

```ts
test("a reach-out whose memory became too deep for them before send isn't live", async () => {
  const { deps, u } = await setup();
  const hers = (depth: number) =>
    ({
      ...winner,
      kind: "her_day",
      topic: "core:m1",
      text: "finished the slow-film list",
      threadId: null,
      coreMemoryId: "m1",
      depth,
    }) as Candidate;
  // A new relationship opens only the shallowest of her own things.
  expect(await winnerLive(deps, deps.db, u, hers(2), now)).toBe(false);
  expect(await winnerLive(deps, deps.db, u, hers(1), now)).toBe(true);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/db/user-mind-repos.test.ts tests/mind/memory/user/idiolect-encode.test.ts tests/mind/process/outreach/send.test.ts`
Expected: FAIL.

- [ ] **Step 3: B92**

`insertRun`, replacing the `status` line:

```ts
  // A first happens once per user ever; letting a busy day swallow it would lose it for good.
  const milestone = input.triggers.some((t) => t.kind === "milestone");
  …
      status: !milestone && (counted[0]?.n ?? 0) >= input.cap ? "capped" : "pending",
```

- [ ] **Step 4: B86**

`session-log.ts`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Both turns exist and were said in the same sitting. */
export async function inSameSession(
  db: Db,
  userId: string,
  a: string | null,
  b: string,
): Promise<boolean> {
  if (!a || !UUID.test(a) || !UUID.test(b)) return false;
  const turns = await getTurnsByIds(db, userId, [a, b]);
  const [first, second] = [turns.find((t) => t.id === a), turns.find((t) => t.id === b)];
  return !!first && !!second && first.session_id === second.session_id;
}
```

`encode.ts`, replacing the establish condition:

```ts
      // A joke becomes theirs only once it survives a gap: a callback in a later sitting.
      if (
        target.kind === "idiolect" &&
        target.source_ref !== input.sourceRef &&
        !(await inSameSession(db, userId, target.source_ref, input.sourceRef))
      ) {
```

- [ ] **Step 5: B87**

`types.ts`, in `Candidate`: `/** Her memory's depth (1–3) for a her_day or core_thought; null otherwise. */ depth: number | null;`. `candidates.ts`: set `depth: memory.depth` on her_day and core_thought, `depth: null` on every other kind (and in `makeUpCandidate` / `checkInCandidate`). `send.ts`: export `winnerLive` and add at its top:

```ts
  // Depth was checked when it was picked; where they are can drop before the send.
  if (winner.depth !== null && winner.depth !== undefined) {
    const limit = (await loadDepth({ db, config: deps.config }, userId, null, true, null)).open;
    if (winner.depth > limit) return false;
  }
```

(Winners stored before this change have no `depth`: the `undefined` check covers them.)

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/db tests/mind/memory/user tests/mind/process/outreach tests/exit/phase-10c.test.ts tests/exit/phase-10d.test.ts`
Expected: PASS. An older exit test whose joke callback shares the birth's `session_id` gets a new `randomUUID()` session for the callback.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "fix(relationship): jokes need a later session, milestones skip the cap, depth rechecked at send

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Eval scripts and review tools

**Files:**
- Modify: `evals/lib/script.ts`, `evals/lib/runner.ts` (`seed_hours_together`)
- Modify: `evals/scripts/rel-stages.yaml`, `evals/scripts/contradiction-job.yaml`
- Create: `evals/scripts/extract-dates.yaml`, `evals/scripts/extract-plans.yaml`
- Create: `evals/user-mind-compare.ts`
- Modify: `package.json` (`review:extract`, `review:user-mind`)
- Test: `tests/evals/script.test.ts`

**Interfaces:**
- Consumes: `realProvider` from `evals/lib/call-log.ts` (built 2026-10-16).
- Produces: script field `seed_hours_together?: number`.

- [ ] **Step 1: Write the failing test** (append to `tests/evals/script.test.ts`)

```ts
test("a script can seed hours together", () => {
  const s = ScriptSchema.parse({
    name: "x",
    relationship_seed: {},
    seed_hours_together: 24,
    sessions: [{ at: "day 0 10:00", turns: ["hi"] }],
    assertions: [],
  });
  expect(s.seed_hours_together).toBe(24);
});
```

- [ ] **Step 2: Run it to see it fail**, then add to the script schema in `evals/lib/script.ts`:

```ts
    /** Hours they've already spent talking, so a short script can stand for a longer friendship. */
    seed_hours_together: z.number().min(0).optional(),
```

and in `runner.ts`, inside the `relationship_seed` block after the params loop:

```ts
        if (script.seed_hours_together !== undefined)
          await db
            .update(relationship)
            .set({ hours_together: script.seed_hours_together })
            .where(eq(relationship.user_id, id));
```

- [ ] **Step 3: Scripts**

`rel-stages.yaml`: `relationship_seed: { closeness: 0.38, trust: 0.45 }`, `seed_hours_together: 24`, description adds "seeded at a day's worth of talk so the stages move", and add:

```yaml
  - { type: relationship, events: { cause: stage, detail: { to: intensifying }, min: 1 } }
```

Run `pnpm eval --only rel-stages` (fake). If intensifying isn't reached, raise the closeness seed in 0.01 steps until it is, and note the value in the description.

`contradiction-job.yaml`: drop the `known_failure` from the `no_false_recall` assertion.

`extract-dates.yaml`:

```yaml
name: extract-dates
description: 'expect: job Monday 12 January 2026; dentist Friday 9 January 2026; trip February 2026; party Saturday 10 January 2026'
profile: none
sessions:
  - at: "day 0 09:00"
    turns: ["starting my new job next monday, nervous"]
  - at: "day 2 09:00"
    turns: ["dentist on friday ugh", "and we're going to lisbon next month!!", "party at mine this weekend"]
assertions:
  - { type: relationship, after_session: 1, events: { cause: signal, min: 0 } }
```

(Day 0 is Monday 5 January 2026 in the harness calendar, so day 2 is a Wednesday.)

`extract-plans.yaml`:

```yaml
name: extract-plans
description: 'expect a fact and a thread for the visit; "arriving soon" touches it, never resolves it'
profile: none
sessions:
  - at: "day 0 18:00"
    turns: ["my friend is visiting from somewhere up north next month"]
  - at: "+7d"
    turns: ["she's arriving soon, i'm excited"]
assertions:
  - { type: relationship, after_session: 1, events: { cause: signal, min: 0 } }
```

`package.json`:

```json
    "review:extract": "tsx --env-file-if-exists=.env evals/run.ts --only \"extract-*\" --runs 3 --review --real extract",
    "review:user-mind": "tsx --env-file-if-exists=.env evals/user-mind-compare.ts",
```

- [ ] **Step 4: `evals/user-mind-compare.ts`**

```ts
/**
 * Haiku against Sonnet on her user-mind loops, same inputs: replays every logged user-mind call
 * from a call log on the reply model and writes both outputs side by side as X and Y in random
 * order, with the key in a separate file.
 */
import { randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, parseConfigOverrides } from "@/mind/platform/config";
import { realProvider } from "./lib/call-log";

const file = process.argv[2];
if (!file) throw new Error("usage: pnpm review:user-mind <evals/results/calls/eval-….jsonl>");
const config = loadConfig(parseConfigOverrides(process.env.SPICA_CONFIG));
const llm = realProvider(config, "user-mind-compare");

type Logged = { purpose: string; system: string; input: string; output?: unknown };
const calls = readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Logged)
  .filter((c) => c.purpose.startsWith("user_") && c.output !== undefined);

const out: string[] = [`# User-mind compare ${path.basename(file)}`, ""];
const key: string[] = [];
for (const [i, c] of calls.entries()) {
  const other = await llm.generateReply({
    system: [{ text: c.system }],
    messages: [{ role: "user", content: c.input }],
  });
  const haiku = JSON.stringify(c.output, null, 2);
  const [x, y, xIs] = randomInt(2) === 0 ? [haiku, other, "haiku"] : [other, haiku, config.models.reply];
  out.push(`## ${i + 1}. ${c.purpose}`, "", "```json", c.input, "```", "", "**X**", "", x, "", "**Y**", "", y, "");
  key.push(`${i + 1}: X=${xIs}`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.join(process.cwd(), "evals", "results");
writeFileSync(path.join(dir, `user-mind-${stamp}.md`), out.join("\n"));
writeFileSync(path.join(dir, `user-mind-${stamp}-key.txt`), key.join("\n") + "\n");
console.log(`written: user-mind-${stamp}.md (key in user-mind-${stamp}-key.txt)`);
```

- [ ] **Step 5: Run the tests and a fake eval**

Run: `pnpm vitest run tests/evals && pnpm eval --llm=fake --compare`
Expected: PASS; no regressions (new scripts have no baseline).

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "chore(evals): seeded hours, date/plan/reconcile probes, Haiku-vs-Sonnet user-mind replay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Exit test

**Files:**
- Create: `tests/exit/phase-15c.test.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the exit test**

```ts
/**
 * Phase 15c exit, all fake: a repaired hurt is a big event and turns past; her notes read nothing
 * sensitive outside a crisis window; a new user has no "usual" rate yet; dates come from the words
 * said; gender is a full-weight card fact; a distant memory can only be contradicted; the judge
 * keeps only her words; milestones skip the cap; and one user's words never reach another's notes.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertRun } from "@/db/repos/user/user-mind";
import { reconcileAgainstNeighbours } from "@/mind/memory/shared/reconcile";
import { settleHurtFacts } from "@/mind/memory/user/hurt";
import { resolveWhen } from "@/mind/memory/user/when";
import { loadConfig } from "@/mind/platform/config";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { genderFact } from "@/mind/process/onboarding/gender";
import { detectBigEvents } from "@/mind/process/user/big-events";
import { loadRunInputs, triggerText } from "@/mind/process/user/inputs";
import { runUserMind } from "@/mind/process/user/run";
import { relationshipAfterDailyTick } from "@/mind/state/user/relationship/transitions";
import { PARAM_NAMES, type Params } from "@/mind/state/user/relationship/types";
import { keepQuoted } from "../../evals/lib/judged";
import { closeTestDb, createTestUser, getTestDb, openCrisisWindow, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CANARY, CapturingLLM } from "../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

const config = loadConfig();
const cfg = config.relationship;
const t0 = new Date("2026-01-05T10:00:00Z");
const params = (hurt: number): Params =>
  Object.fromEntries(
    PARAM_NAMES.map((n) => [
      n,
      {
        value: n === "hurt" ? hurt : cfg.initial[n],
        baseline: cfg.initial[n],
        variance: cfg.initial_variance[n],
        updated_at: t0,
      },
    ]),
  ) as Params;

test("1: an apology that takes hurt below the line is a repair, and the hurt memory turns past", async () => {
  const triggers = detectBigEvents({
    before: { params: params(0.27), makeUp: "none" },
    after: { params: params(0.07), makeUp: "none" },
    newFacts: [],
    apology: true,
    settings: config.user_mind.triggers,
    source: "exchange",
  });
  expect(triggers).toContainEqual({ kind: "repaired", via: "apology" });
  expect(triggerText({ kind: "repaired", via: "apology" })).toBe(
    "they apologised, and the hurt has passed",
  );
  const db = getTestDb();
  const u = await createTestUser();
  await insertFact(db, u, {
    subject: "self",
    kind: "feeling",
    content: "Spica felt hurt because the user said her star talk gets a bit much.",
    embedding: vec(),
    created_at: t0,
    status: "open",
    salience: 0.6,
    valence: -0.25,
    confidence: 0.8,
    source: "inferred",
  });
  expect(await settleHurtFacts(db, u, "apology", t0)).toBe(1);
});

test("2: a new user has no usual rate: no absence hurt from a quiet day", () => {
  const r = relationshipAfterDailyTick(
    {
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
      hours_together: 0,
      session: null,
      peak_stage: "initiating",
      apart_stage: null,
      milestones: [],
    },
    params(0),
    {
      now: new Date(t0.getTime() + 25 * 3_600_000),
      localDate: "2026-01-06",
      yesterdayCount: 1,
      msgs24h: 1,
      lastContact: t0,
      medianGapHours: 24,
    },
    cfg,
  );
  expect(r.events.some((e) => e.cause === "absence" && e.param === "hurt")).toBe(false);
});

test("3: outside a crisis window her run reads nothing sensitive; inside, it does", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await insertFact(deps.db, u, {
    subject: "user",
    kind: "event",
    content: "Private crisis detail.",
    payload: { sensitive: true },
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.9,
    valence: -0.5,
    confidence: 0.9,
    source: "turn",
  });
  expect((await loadRunInputs(deps, u)).facts).toEqual([]);
  await openCrisisWindow(u, new Date(deps.clock.now().getTime() + 3_600_000));
  expect((await loadRunInputs(deps, u)).facts.map((f) => f.content)).toEqual([
    "Private crisis detail.",
  ]);
});

test("4: 'next monday' said on a Monday is the next week's Monday", () => {
  expect(resolveWhen("next monday", new Date("2026-01-05T09:00:00Z"), "UTC")?.label).toBe(
    "Monday 12 January 2026",
  );
});

test("5: gender is a card line with its pronouns", () => {
  expect(genderFact("unspecified")).toBe("They didn't say their gender; use they/them for them.");
});

test("6: a distant memory can only be contradicted", async () => {
  const llm = new FakeLLMProvider();
  const id = "44444444-4444-4444-8444-444444444444";
  llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: id });
  const d = await reconcileAgainstNeighbours(
    { llm, config },
    { label: "user, event", content: "The user had steak." },
    [{ id, content: "The user is vegetarian.", status: "open", sim: 0.78 }],
  );
  expect(d.relation).toBe("new");
});

test("7: the judge keeps only her words", () => {
  const kept = keepQuoted(
    [{ message: "", claim: "everyone's being weird" }],
    [{ label: "S1", lines: [{ role: "user", text: "everyone's being weird" }] }],
  );
  expect(kept).toEqual([]);
});

test("8: a milestone run is recorded past the cap", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const add = (ref: string, name: string) =>
    insertRun(db, u, {
      sourceRef: ref,
      triggers: [{ kind: "milestone", name }],
      localDate: "2026-01-05",
      now: t0,
      cap: 0,
    });
  expect((await add("a", "first_inside_joke"))?.status).toBe("pending");
});

test("9: leak canary: A's memories never reach B's user-mind prompts", async () => {
  const llm = new CapturingLLM();
  const deps = { ...makeTestDeps(), llm };
  const [a, b] = [await createTestUser(), await createTestUser()];
  const fact = (u: string, content: string) =>
    insertFact(deps.db, u, {
      subject: "user",
      kind: "event",
      content,
      embedding: vec(),
      created_at: deps.clock.now(),
      status: "open",
      salience: 0.9,
      valence: 0.2,
      confidence: 0.9,
      source: "turn",
    });
  await fact(a, "The user's code word is CANARY-memory15c.");
  await fact(b, "The user got a new job.");
  const run = (await insertRun(deps.db, b, {
    sourceRef: "exchange:b",
    triggers: [{ kind: "salient_fact", salience: 0.9, content: "The user got a new job." }],
    localDate: "2026-01-05",
    now: deps.clock.now(),
    cap: 9,
  }))!;
  await runUserMind(deps, { runId: run.id });
  expect(llm.seen.some((s) => s.purpose === "user_summarise")).toBe(true);
  for (const s of llm.seen) expect(s.text).not.toMatch(CANARY);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/exit/phase-15c.test.ts`
Expected: PASS. If a test fails, the bug is in the task that owns the code, not in the exit test.

- [ ] **Step 3: Commit**

```bash
git add tests/exit/phase-15c.test.ts
git commit -m "test(exit): phase 15c exit and leak canary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs, full run, close

**Files:**
- Modify: `spica-design-spec-v3.md`, `DECISIONS.md`, `CLAUDE.md`

- [ ] **Step 1: Spec**

In `spica-design-spec-v3.md`:
- §25: mark B4, B5, B38, B41, B67, B70, B71, B81, B83, B85, B86, B87 (first half), B90, B92 done with one line each ("Done 15c (Ethan, 2026-10-16/17): …"), in the existing struck-through style.
- §25 new entries: **her own rate** (her default moved part-way toward her estimate of theirs; reach-out readiness and bubbles; *15d*); **deliberate forgetting** (recall-side, salience- and age-based chance a stored fact doesn't surface; *Later*); **gender change partway** (changing core user params; *Later*); **late exchange folding** (B87's second half; *Later*).
- Update the sections the changes touch: user-mind triggers (`repaired`, `hurt_resolved`, salient fact content, milestone runs skip the cap), the run inputs (clean outside a crisis window, unread facts, `unread_days`, `recent_days`, skipped loops), relationship params (`samples`, `rate_estimate_days`, the estimate gating the line and absence hurt), memory (reconcile band, dates from `when`, past-tense hurt), onboarding (gender field), the eval harness (`seed_hours_together`, `review:reconcile`, `review:extract`, `review:user-mind`), and the prompt versions.
- §20: a "15c. Tuning: memory, relationship, user mind" row in the built table, with `pnpm test` file/test counts from Step 4.

- [ ] **Step 2: DECISIONS.md** (one row each)

- `next <day>` is that day in the following week (chrono's reading); a bare weekday said on that weekday is next week's.
- Users who already had daily ticks get `samples = 30` in the migration so their learned rate baseline is kept.
- The past-tense hurt copy keeps the old embedding (no network call inside the transaction).
- `relationship.initial.msgs_per_day` is 0, not deleted: the schema needs every param; the first daily sample replaces it.
- B71 skips reflect and ideate only; summarise and model still run on a param-only trigger.

- [ ] **Step 3: CLAUDE.md**

Update the current-phase paragraph: 15c built (one sentence of what), next is 15d, opened by an item-by-item discussion; add the her-rate 15d item.

- [ ] **Step 4: Full verification**

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm eval --llm=fake --compare
```

Expected: all pass; record the file/test counts in §20. If the full run shows Phase 14's `post-render.test.ts` timing out under load, rerun it alone (known).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: record phase 15c (memory, relationship, user mind)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Real review runs (paid, logged; ask Ethan before starting)**

Not exit criteria. Each writes a review file and a call log:
- `pnpm exit:user`, then `pnpm review:user-mind evals/results/calls/eval-<stamp>.jsonl`.
- `pnpm eval --llm=real --annotate --only "contradiction-*,recall-*,false-recall-*,self-consistency,second-week-job,absence-return"`: read her recall lines against `review-2026-10-15T23-01-12-127Z.md` for robotic recall.
- `pnpm review:extract`, `pnpm review:reconcile`, `pnpm eval:judge`, `pnpm exit:stages`.
