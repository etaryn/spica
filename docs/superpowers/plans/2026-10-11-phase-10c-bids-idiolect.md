# Phase 10c: Bids and Idiolect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user's response to her bids moves warmth and trust in code, and inside jokes, nicknames, rituals and running references are stored as `idiolect` facts that she reuses once they recur, gated by closeness.

**Architecture:** Both are read by the cold path's existing extraction call (prompt v7): a `bid_response` field and an `idiolect` fact kind with two extra fields. Code guards the bid (same session, user turn, no crisis) and applies fixed deltas in `transitions.ts`. Encode marks an idiolect fact established when a later exchange's candidate is reconciled as its duplicate. The hot path reads established idiolect into a new "Your things together" slot, gated by closeness.

**Tech Stack:** TypeScript, Drizzle + Postgres 16/pgvector, zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-11-phase-10c-bids-idiolect-design.md`

## Global Constraints

- `src/mind` is framework-free: no Next imports, no `Date.now()`, no `process.env`; use injected `Deps` and the `Clock`.
- Every numeric constant goes in `config/default.json` with a zod schema in `src/mind/platform/config.ts`.
- Every prompt is a versioned file; delete versions nothing configures (`prompts/extract/v6.md`, `prompts/reply/v13.md`).
- Comments say why, not where from: never cite spec sections, phases or review items in code.
- Every file starts with a short plain-English header; Prettier at 100 columns (`pnpm format`).
- Timestamps come from the injected clock; never `DEFAULT now()`.
- A malformed model field never fails the memory write (normalise to null / a fallback).
- Scope: user data never reaches a core loop's input, output or state; users never mix.
- Run one test process at a time (shared test DB). A full `pnpm test` takes about 10 minutes.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A reach-out she sent, answered by the user in a **new session**: no bid is recorded (the reply comes after the session gap). Pinned in Task 2's guard test.
2. An idiolect candidate reconciled as a duplicate of a **non-idiolect** shared fact must not crash or establish anything. Pinned in Task 3.
3. An idiolect fact whose `payload.idiolect` is missing (written before 10c or malformed) still gets established without losing `payload.sensitive`. Pinned in Task 3's repo test.
4. A user with **no relationship row** (a first message) gets only idiolect they started. Pinned in Task 4.
5. A cold-path **retry** of the same exchange (same `source_ref`) never establishes an idiolect fact. Pinned in Task 3.

---

### Task 1: Schema: `idiolect` fact kind and `bid` cause

**Files:**
- Modify: `src/db/schema.ts` (`factKind` list ~line 86, `relationshipCause` list ~line 158)
- Modify: `src/mind/state/user/relationship/types.ts` (`RelationshipCause`)
- Modify: `src/db/repos/user/facts.ts:55` (`candidateFacts` exclusion)
- Create: `src/db/migrations/0029_idiolect.sql` (generated) + meta snapshot/journal
- Test: `tests/db/idiolect-kind.test.ts`

**Interfaces:**
- Produces: fact kind `"idiolect"`; relationship cause `"bid"`; `candidateFacts` never returns idiolect.

- [ ] **Step 1: Write the failing test**

```ts
/** The idiolect kind exists and ordinary retrieval leaves it to its own slot. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { candidateFacts, insertFact } from "@/db/repos/user/facts";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("idiolect facts are stored but never ranked by ordinary retrieval", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const [embedding] = await d.embedder.embed(["The user calls Spica Starfish."], "document");
  await insertFact(getTestDb(), u, {
    subject: "shared",
    kind: "idiolect",
    content: "The user calls Spica Starfish.",
    payload: { idiolect: { type: "nickname", started_by: "user", established_at: null } },
    embedding: embedding!,
    entity_refs: [],
    created_at: d.clock.now(),
    salience: 0.6,
    valence: 0.5,
    confidence: 0.9,
    source: "turn",
    status: "open",
  });
  const found = await candidateFacts(getTestDb(), u, embedding!, 10);
  expect(found).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/db/idiolect-kind.test.ts`
Expected: FAIL (`invalid input value for enum fact_kind: "idiolect"` or a type error).

- [ ] **Step 3: Implement**

In `src/db/schema.ts` append `"idiolect"` to `factKind` after `"belief"`, and `"bid"` to `relationshipCause` after `"deep_session"`. In `types.ts` add `| "bid"` to `RelationshipCause`. In `candidateFacts` change the exclusion and its comment:

```sql
        -- The summary, her ideas, her read on them and your things together have their own slots.
        AND f.kind NOT IN ('summary', 'idea', 'model', 'idiolect')
```

Generate the migration: `pnpm db:generate --name idiolect`. Check `src/db/migrations/0029_idiolect.sql` contains exactly:

```sql
ALTER TYPE "public"."fact_kind" ADD VALUE 'idiolect';--> statement-breakpoint
ALTER TYPE "public"."relationship_cause" ADD VALUE 'bid';
```

`extractableKind` in `extract.ts` derives from `factKind` and does not exclude `idiolect`, so extraction can emit it with no change there. `nearFacts` (reconcile) and the decay queries keep idiolect: callbacks must find it, and an unused joke fades.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run tests/db/idiolect-kind.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations src/mind/state/user/relationship/types.ts src/db/repos/user/facts.ts tests/db/idiolect-kind.test.ts
git commit -m "feat(db): idiolect fact kind and bid cause"
```

---

### Task 2: Bids: read, guard, effect

**Files:**
- Modify: `src/mind/state/user/relationship/signals.ts` (bid schema, `normalizeBid`, `bidAfter`)
- Modify: `src/mind/memory/user/extract.ts` (schema field, `Extraction.bid`)
- Modify: `src/mind/process/cold-path/cold-path.ts` (`extractExchange` returns context; pass `bid`)
- Modify: `src/mind/state/user/relationship/update.ts` (`RelationshipUpdate.bid`, pass through)
- Modify: `src/mind/state/user/relationship/transitions.ts` (`ExchangeInput.bid`, `applyBid`)
- Modify: `src/mind/platform/config.ts`, `config/default.json` (`relationship.bids.effects`; `prompts.extract: "v7"`)
- Create: `prompts/extract/v7.md` (v6 + the Bids section); Delete: `prompts/extract/v6.md`
- Test: `tests/mind/state/user/relationship/bids.test.ts`

**Interfaces:**
- Produces: `type BidResponse = "toward" | "away" | "against"`; `normalizeBid(raw: unknown): BidResponse | null`; `bidAfter(response: BidResponse | null, context: Turn[], turns: Turn[]): BidResponse | null`; `Extraction.bid: BidResponse | null`; `ExchangeInput.bid: BidResponse | null`; `RelationshipUpdate.bid: BidResponse | null`; config `relationship.bids.effects: Record<BidResponse, Partial<Record<"warmth" | "trust", number>>>`.

- [ ] **Step 1: Write the failing tests**

```ts
/** Bids: the user's response to her last reach, guarded and applied as small fixed moves. */
import { expect, test } from "vitest";
import type { Turn } from "@/db/repos/user/session-log";
import { loadConfig } from "@/mind/platform/config";
import { bidAfter, normalizeBid } from "@/mind/state/user/relationship/signals";
import { relationshipAfterExchange } from "@/mind/state/user/relationship/transitions";
import { freshParams, freshState, exchangeInput } from "./fixtures";

const turn = (role: "user" | "companion", session: string): Turn =>
  ({ id: crypto.randomUUID(), role, session_id: session, text: "x", created_at: new Date() }) as Turn;

test("normalizeBid keeps the three responses and nulls anything else", () => {
  expect(normalizeBid("toward")).toBe("toward");
  expect(normalizeBid("against")).toBe("against");
  expect(normalizeBid("sideways")).toBeNull();
  expect(normalizeBid(undefined)).toBeNull();
});

test("a bid counts only against her last message in the same session", () => {
  const hers = turn("companion", "s1");
  expect(bidAfter("away", [hers], [turn("user", "s1"), turn("companion", "s1")])).toBe("away");
  // Coming back later, even to a reach-out, is not turning away.
  expect(bidAfter("away", [hers], [turn("user", "s2")])).toBeNull();
  expect(bidAfter("away", [], [turn("user", "s1")])).toBeNull();
  expect(bidAfter("away", [hers], [turn("companion", "s1")])).toBeNull();
});

test("toward, away and against move warmth and trust by the configured amounts", () => {
  const config = loadConfig();
  const settings = config.relationship;
  const run = (bid: "toward" | "away" | "against") =>
    relationshipAfterExchange(freshState(), freshParams(), { ...exchangeInput(), bid }, settings);

  const away = run("away");
  expect(away.params.warmth.value).toBeCloseTo(freshParams().warmth.value - 0.03, 5);
  const against = run("against");
  expect(against.params.warmth.value).toBeCloseTo(freshParams().warmth.value - 0.06, 5);
  expect(against.params.trust.value).toBeCloseTo(freshParams().trust.value - 0.03, 5);
  const toward = run("toward");
  expect(toward.params.warmth.value).toBeGreaterThan(freshParams().warmth.value);
  expect(toward.params.warmth.value).toBeLessThanOrEqual(freshParams().warmth.value + 0.03);
  expect(toward.events.some((e) => e.cause === "bid" && e.detail.response === "toward")).toBe(true);
});

test("no bid moves anything once they have ended it", () => {
  const settings = loadConfig().relationship;
  const ended = { ...freshState(), status: "ended_by_user" as const };
  const out = relationshipAfterExchange(
    ended,
    freshParams(),
    { ...exchangeInput(), bid: "against" },
    settings,
  );
  expect(out.events.some((e) => e.cause === "bid")).toBe(false);
});
```

Before writing `./fixtures`, look in `tests/mind/state/user/relationship/` for the helpers the existing transitions tests use to build a state, params and an `ExchangeInput` (`grep -rn "relationshipAfterExchange" tests/mind`). Reuse them; only create `fixtures.ts` if none exist, exporting `freshState()`, `freshParams()` (params at baseline, warmth and trust 0.5) and `exchangeInput()` (an `ExchangeInput` with `signals: null`, `intimacy: null`, `crisis: false`, `span: null`, `herOpenness: null`, `tone: null`, `replies: 1`, `msgs24h: 1`, `hurtFactId: null`, `bid: null`, fixed `now`/`exchangeAt`). Adjust the imports to whatever exists. If `relationshipAfterExchange`'s result exposes params under another name, use that.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/mind/state/user/relationship/bids.test.ts`
Expected: FAIL (`bidAfter` is not exported).

- [ ] **Step 3: Implement the read and guard in `signals.ts`**

Update the header to mention her bids, then add:

```ts
/** How the user met her last reach: a joke, a question, her news, an invitation. */
export const BID_RESPONSES = ["toward", "away", "against"] as const;
export type BidResponse = (typeof BID_RESPONSES)[number];
export const BidResponseSchema = z.enum(BID_RESPONSES).nullable();

export function normalizeBid(raw: unknown): BidResponse | null {
  const parsed = z.enum(BID_RESPONSES).safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * A response counts only when the user answers her last message in the same conversation:
 * coming back after a gap is not turning away.
 */
export function bidAfter(
  response: BidResponse | null,
  context: Turn[],
  turns: Turn[],
): BidResponse | null {
  if (!response) return null;
  const hers = context.filter((t) => t.role === "companion").at(-1);
  const firstUser = turns.find((t) => t.role === "user");
  if (!hers || !firstUser) return null;
  return hers.session_id === firstUser.session_id ? response : null;
}
```

(Import `type Turn` from `@/db/repos/user/session-log`.)

- [ ] **Step 4: Extraction**

In `extract.ts`, add to `ExtractionSchema` after `intimacy`:

```ts
  // Required for the model; fixtures without it read as null.
  bid_response: BidResponseSchema.default(null),
```

Add `bid: BidResponse | null` to `Extraction`. In `normalizeExtraction` extend the lenient override with `bid_response: z.unknown().optional()` and return `bid: normalizeBid(raw.bid_response)`. Update the file header ("…and how much they opened up, and how they met her last bid.").

- [ ] **Step 5: Cold path, update, transitions**

`cold-path.ts`: make `extractExchange` return `{ extraction, context }` (the `context` array it already builds), and destructure at the call site. After `intimacy`:

```ts
    const bid = crisis || !hasUserTurn ? null : bidAfter(extraction.bid, context, turns);
```

Pass `bid` into `updateRelationshipSafely({... bid })`. In `update.ts` add `bid: BidResponse | null` to `RelationshipUpdate` and `bid: update.bid` to the `relationshipAfterExchange` input. In `transitions.ts` add to `ExchangeInput`:

```ts
  /** How the user met her last bid in this conversation, if she made one. */
  bid: BidResponse | null;
```

and after `applyIntimacy(draft, input, settings);` in `relationshipAfterExchange` call `applyBid(draft, input.bid, settings);`:

```ts
/** Turning toward her small reaches warms her a little; turning away or against cools her. */
function applyBid(draft: Draft, bid: BidResponse | null, settings: RelationshipConfig): void {
  if (!bid || draft.state.status === "ended_by_user") return;
  const effects = settings.bids.effects[bid];
  for (const name of ["warmth", "trust"] as const) {
    const delta = effects[name];
    if (!delta) continue;
    const returns = delta > 0 ? diminishingReturns(draft.params[name], settings.variance_epsilon) : 1;
    draft.setParam(name, nudge(draft.params[name].value, delta * returns), "bid", { response: bid });
  }
}
```

Check `nudge`'s signature in `params.ts` first. If it scales the delta toward the bound rather than adding it, use `clamp(value + delta * returns, 0, 1)` instead, so the test's exact −0.03 holds. Fix every other `ExchangeInput` construction site (`grep -rn "herOpenness:" src tests`) by adding `bid: null`.

- [ ] **Step 6: Config**

`config.ts`, inside `relationship`:

```ts
    bids: z.object({
      effects: z.object({
        toward: z.object({ warmth: unit.optional(), trust: unit.optional() }),
        away: z.object({ warmth: z.number().min(-1).max(0).optional(), trust: z.number().min(-1).max(0).optional() }),
        against: z.object({ warmth: z.number().min(-1).max(0).optional(), trust: z.number().min(-1).max(0).optional() }),
      }),
    }),
```

`default.json`, inside `relationship`:

```json
    "bids": {
      "effects": {
        "toward": { "warmth": 0.03 },
        "away": { "warmth": -0.03 },
        "against": { "warmth": -0.06, "trust": -0.03 }
      }
    },
```

Set `"extract": "v7"`.

- [ ] **Step 7: Prompt v7**

`git mv prompts/extract/v6.md prompts/extract/v7.md`, then append:

```markdown
## Bids

Also fill `bid_response`: how the user's NEW messages met Spica's last message before them (the end of "Earlier conversation"), if that message was a bid for connection. A bid is a small reach to connect: a joke, a question to them, her own news or excitement, an invitation, or a message she sent first.

- `"toward"`: they picked it up: laughed, answered it, reacted, asked back.
- `"away"`: they ignored it or went straight to something of their own.
- `"against"`: they mocked it, rebuffed it or snapped at it.
- `null` when her last message held no bid, or there is no earlier message from her.
```

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run tests/mind/state/user/relationship tests/mind/memory/user tests/mind/process/cold-path && pnpm typecheck`
Expected: PASS. Fix any fixture that builds an `Extraction` object literal by adding `bid: null`.

- [ ] **Step 9: Commit**

```bash
git add -A src config prompts tests
git commit -m "feat(relationship): her bids, and how the user meets them, move warmth and trust"
```

---

### Task 3: Idiolect: extraction fields and establishment

**Files:**
- Modify: `src/mind/memory/user/extract.ts` (fact fields `idiolect_type`, `started_by`)
- Create: `src/mind/memory/user/idiolect.ts` (types, `idiolectPayload`)
- Modify: `src/mind/memory/user/encode.ts` (payload on insert; establish on cross-exchange duplicate)
- Modify: `src/db/repos/user/facts.ts` (`establishIdiolect`)
- Modify: `prompts/extract/v7.md` (Idiolect section; inside joke moves out of `shared` wording)
- Test: `tests/mind/memory/user/idiolect-encode.test.ts`

**Interfaces:**
- Consumes: fact kind `idiolect` (Task 1).
- Produces:
  - `type IdiolectType = "joke" | "nickname" | "ritual" | "reference"`
  - `type IdiolectPayload = { type: IdiolectType; started_by: "user" | "spica"; established_at: string | null }`
  - `idiolectPayload(fact: { idiolect_type?: string | null; started_by?: string | null }): IdiolectPayload`
  - `ExtractedFact.idiolect_type?: IdiolectType | null`, `ExtractedFact.started_by?: "user" | "spica" | null`
  - `establishIdiolect(db: Db, userId: string, id: string, at: Date): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Model them on an existing cold-path DB test (`grep -rln "runColdPath" tests/mind`): seed a user, insert a user turn and her reply, script `d.llm.handlers.extract` and `d.llm.handlers.reconcile`, and run `runColdPath`.

```ts
/** Idiolect is a candidate until it comes up again in a later exchange. */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { establishIdiolect, insertFact } from "@/db/repos/user/facts";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const JOKE = "Spica and the user joke that every cloud is a whale.";
const idiolectFact = (extra: object = {}) => ({
  subject: "shared",
  kind: "idiolect",
  content: JOKE,
  occurred_at: null,
  salience: 0.6,
  valence: 0.6,
  confidence: 0.9,
  entity_names: [],
  thread_title: null,
  claim_kind: null,
  idiolect_type: "joke",
  started_by: "user",
  ...extra,
});

async function exchange(d: ReturnType<typeof makeTestDeps>, u: string) {
  d.clock.advance(60_000);
  const ut = await insertTurn(d.db, u, {
    id: randomUUID(), session_id: "s1", role: "user", text: "whale cloud again", created_at: d.clock.now(),
  });
  const ct = await insertTurn(d.db, u, {
    id: randomUUID(), session_id: "s1", role: "companion", text: "ha", created_at: d.clock.now(), reply_to: ut.id,
  });
  await runColdPath(d, { userId: u, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] });
  return ct.id;
}

const idiolects = (u: string) =>
  getTestDb().select().from(s.fact).where(and(eq(s.fact.user_id, u), eq(s.fact.kind, "idiolect")));

test("a joke starts as a candidate and is established when a later exchange calls it back", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  d.llm.handlers.extract = () => ({ facts: [idiolectFact()], entities: [], threads: [], relationship: null });
  await exchange(d, u);
  const [first] = await idiolects(u);
  expect(first!.payload).toMatchObject({ idiolect: { type: "joke", started_by: "user", established_at: null } });

  d.llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: first!.id });
  await exchange(d, u);
  const rows = await idiolects(u);
  expect(rows).toHaveLength(1);
  expect((rows[0]!.payload as { idiolect: { established_at: string | null } }).idiolect.established_at).not.toBeNull();
});

test("a retry of the same exchange never establishes it", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  d.llm.handlers.extract = () => ({ facts: [idiolectFact()], entities: [], threads: [], relationship: null });
  const replyId = await exchange(d, u);
  const [first] = await idiolects(u);
  // Re-run the same exchange (same source_ref), as a retried job would after a rollback.
  await getTestDb().execute(sql`UPDATE session_log SET extracted = false WHERE user_id = ${u}`);
  d.llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: first!.id });
  const turnIds = (
    await getTestDb().select({ id: s.session_log.id }).from(s.session_log).where(eq(s.session_log.user_id, u))
  ).map((t) => t.id);
  await runColdPath(d, { userId: u, turnIds, replyTurnId: replyId, recalled: [] });
  const [row] = await idiolects(u);
  expect((row!.payload as { idiolect: { established_at: string | null } }).idiolect.established_at).toBeNull();
});

test("a duplicate of a non-idiolect shared fact establishes nothing", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const [embedding] = await d.embedder.embed([JOKE], "document");
  const plain = await insertFact(getTestDb(), u, {
    subject: "shared", kind: "event", content: JOKE, embedding: embedding!, entity_refs: [],
    created_at: d.clock.now(), salience: 0.5, valence: 0, confidence: 0.9, source: "turn",
    status: "open", source_ref: randomUUID(),
  });
  d.llm.handlers.extract = () => ({ facts: [idiolectFact()], entities: [], threads: [], relationship: null });
  d.llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: plain.id });
  await exchange(d, u);
  const [row] = await getTestDb().select().from(s.fact).where(eq(s.fact.id, plain.id));
  expect(row!.payload).toBeNull();
});

test("establishIdiolect keeps sensitive and fills a missing idiolect payload", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const [embedding] = await d.embedder.embed([JOKE], "document");
  const f = await insertFact(getTestDb(), u, {
    subject: "shared", kind: "idiolect", content: JOKE, payload: { sensitive: true },
    embedding: embedding!, entity_refs: [], created_at: d.clock.now(), salience: 0.5,
    valence: 0, confidence: 0.9, source: "turn", status: "open",
  });
  await establishIdiolect(getTestDb(), u, f.id, d.clock.now());
  const [row] = await getTestDb().select().from(s.fact).where(eq(s.fact.id, f.id));
  expect(row!.payload).toMatchObject({ sensitive: true, idiolect: { established_at: d.clock.now().toISOString() } });
});

test("missing idiolect fields fall back to a reference the user started", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  d.llm.handlers.extract = () => ({
    facts: [idiolectFact({ idiolect_type: null, started_by: "nobody" })], entities: [], threads: [], relationship: null,
  });
  await exchange(d, u);
  const [row] = await idiolects(u);
  expect(row!.payload).toMatchObject({ idiolect: { type: "reference", started_by: "user" } });
});
```

Add `sql` to the `drizzle-orm` import. If the extracted flag column is named differently, check `s.session_log` and adjust.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/mind/memory/user/idiolect-encode.test.ts`
Expected: FAIL (`establishIdiolect` not exported; payload null).

- [ ] **Step 3: `src/mind/memory/user/idiolect.ts`**

```ts
/**
 * Idiolect: what is theirs alone, the inside jokes, nicknames, rituals and running references.
 * One starts as a candidate and is established once it comes up again in a later exchange.
 */
import { z } from "zod";

export const IDIOLECT_TYPES = ["joke", "nickname", "ritual", "reference"] as const;
export type IdiolectType = (typeof IDIOLECT_TYPES)[number];
export type IdiolectStarter = "user" | "spica";
export type IdiolectPayload = {
  type: IdiolectType;
  started_by: IdiolectStarter;
  established_at: string | null;
};

/** A missing or invalid field falls back to a running reference the user started. */
export function idiolectPayload(fact: {
  idiolect_type?: unknown;
  started_by?: unknown;
}): IdiolectPayload {
  const type = z.enum(IDIOLECT_TYPES).safeParse(fact.idiolect_type);
  const starter = z.enum(["user", "spica"]).safeParse(fact.started_by);
  return {
    type: type.success ? type.data : "reference",
    started_by: starter.success ? starter.data : "user",
    established_at: null,
  };
}
```

- [ ] **Step 4: Extraction fields**

In `ExtractionSchema.facts` items add, after `claim_kind`:

```ts
      // Only idiolect facts carry these; fixtures without them read as null.
      idiolect_type: z.enum(IDIOLECT_TYPES).nullable().default(null),
      started_by: z.enum(["user", "spica"]).nullable().default(null),
```

In `normalizeExtraction`, make the facts array lenient for these two fields so an invalid value never fails the parse. Extend the schema with a facts element whose `idiolect_type` and `started_by` are `z.unknown().optional()`. Then map with `idiolect_type: fact.kind === "idiolect" ? idiolectPayload(fact).type : null` and `started_by: fact.kind === "idiolect" ? idiolectPayload(fact).started_by : null`. Add both to the `ExtractedFact` type as optional fields.

- [ ] **Step 5: Encode and repo**

`facts.ts`:

```ts
/**
 * Marks an idiolect fact established, once. Builds the idiolect object if it is missing, and
 * keeps the rest of the payload (a sensitive flag survives).
 */
export async function establishIdiolect(db: Db, userId: string, id: string, at: Date): Promise<void> {
  await db.execute(sql`
    UPDATE fact
    SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
      'idiolect',
      COALESCE(payload->'idiolect', '{"type":"reference","started_by":"user"}'::jsonb)
        || jsonb_build_object('established_at', ${at.toISOString()}::text))
    WHERE user_id = ${userId} AND id = ${id} AND kind = 'idiolect'
      AND (payload->'idiolect'->>'established_at') IS NULL`);
}
```

`encode.ts` → `encodeFacts`: build the row payload per fact:

```ts
    const payload =
      fact.kind === "idiolect"
        ? { ...(input.sensitive ? { sensitive: true } : {}), idiolect: idiolectPayload(fact) }
        : input.sensitive
          ? { sensitive: true }
          : null;
```

(Delete the old loop-level `const payload`.) In the `duplicate` branch, before `continue`:

```ts
      // An inside joke is born when it comes up again in another exchange, not twice in one.
      if (target.kind === "idiolect" && target.source_ref !== input.sourceRef) {
        await establishIdiolect(db, userId, target.id, input.exchangeAt);
      }
```

- [ ] **Step 6: Prompt**

In `prompts/extract/v7.md`, change the `shared` subject wording to `"shared" for things between them (a promise to each other, something they did together)`. Add `idiolect` to the `kind` list (`event | trait | preference | state | opinion | feeling | promise | idiolect`), and add after the `claim_kind` bullet:

```markdown
- idiolect_type and started_by: only for kind "idiolect", otherwise null.

## Idiolect

Use kind "idiolect" (subject "shared") for what could become theirs alone: a funny moment that could turn into an inside joke, a nickname either of them gives the other, a little ritual (a way they always say goodnight), or a running reference. Also emit it again, in the same words, whenever either of them calls back to one from before, even if it is already in the earlier conversation. Content names who calls whom what ("The user calls Spica 'Starfish' after the aquarium mix-up").
- idiolect_type: joke | nickname | ritual | reference.
- started_by: "user" or "spica", whoever first said it.
```

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run tests/mind/memory/user tests/mind/process/cold-path && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src prompts tests
git commit -m "feat(memory): idiolect facts, established when a later exchange calls them back"
```

---

### Task 4: "Your things together" slot and reply v14

**Files:**
- Modify: `src/db/repos/user/facts.ts` (`idiolectCandidates`)
- Modify: `src/mind/memory/user/idiolect.ts` (`selectIdiolect`, `loadIdiolect`)
- Modify: `src/mind/process/hot-path/compose.ts` (load, pass, append recalls)
- Modify: `src/mind/process/hot-path/assemble.ts` (`idiolect` input, section, header)
- Modify: `src/mind/platform/config.ts`, `config/default.json` (`relationship.idiolect`, `prompts.reply: "v14"`)
- Create: `prompts/reply/v14.md` (v13 + the paragraph); Delete: `prompts/reply/v13.md`
- Modify: `tests/mind/platform/prompts.test.ts:59` (`"v14"`)
- Test: `tests/mind/memory/user/idiolect-select.test.ts`, `tests/mind/process/hot-path/idiolect-slot.test.ts`

**Interfaces:**
- Consumes: `IdiolectPayload` (Task 3); fact kind `idiolect` (Task 1).
- Produces:
  - `type IdiolectCandidate = { id: string; content: string; salience: number; sim: number; payload: IdiolectPayload }`
  - `idiolectCandidates(db: Db, userId: string, queryVec: number[], limit: number): Promise<IdiolectCandidate[]>`: active, non-sensitive, established only
  - `selectIdiolect(candidates: IdiolectCandidate[], closeness: number | null, settings: Config["relationship"]["idiolect"]): IdiolectCandidate[]`
  - `loadIdiolect(deps: Pick<Deps, "db" | "config">, userId: string, queryVector: Promise<number[] | null>): Promise<IdiolectCandidate[]>`
  - `AssembleInput.idiolect?: { content: string; started_by: "user" | "spica" }[]`

- [ ] **Step 1: Write the failing pure test**

```ts
/** Which of their things she may use: established ones that fit, gated by closeness. */
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { selectIdiolect, type IdiolectCandidate } from "@/mind/memory/user/idiolect";

const settings = loadConfig().relationship.idiolect;
const item = (id: string, started_by: "user" | "spica", sim: number, salience = 0.5): IdiolectCandidate => ({
  id, content: id, salience, sim,
  payload: { type: "joke", started_by, established_at: "2026-10-01T00:00:00.000Z" },
});

test("below the band only what they started; at it, hers too", () => {
  const items = [item("theirs", "user", 0.8), item("hers", "spica", 0.9)];
  expect(selectIdiolect(items, 0.2, settings).map((i) => i.id)).toEqual(["theirs"]);
  expect(selectIdiolect(items, null, settings).map((i) => i.id)).toEqual(["theirs"]);
  expect(selectIdiolect(items, 0.5, settings).map((i) => i.id)).toEqual(["hers", "theirs"]);
});

test("a weak match is dropped and at most max_items come back, best first", () => {
  const items = [item("a", "user", 0.1), item("b", "user", 0.5, 0.2), item("c", "user", 0.6, 0.9), item("d", "user", 0.7, 0.9)];
  expect(selectIdiolect(items, 0.9, settings).map((i) => i.id)).toEqual(["d", "c"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/mind/memory/user/idiolect-select.test.ts`
Expected: FAIL (`selectIdiolect` not exported).

- [ ] **Step 3: Config, repo, selection**

`config.ts` inside `relationship`: `idiolect: z.object({ min_closeness: unit, min_similarity: unit, max_items: positiveInt }),`. `default.json`: `"idiolect": { "min_closeness": 0.4, "min_similarity": 0.3, "max_items": 2 },`.

`facts.ts`:

```ts
export type IdiolectCandidate = {
  id: string;
  content: string;
  salience: number;
  sim: number;
  payload: IdiolectPayload;
};

/** Their established things together nearest the conversation; never a sensitive one. */
export async function idiolectCandidates(
  db: Db,
  userId: string,
  queryVec: number[],
  limit: number,
): Promise<IdiolectCandidate[]> {
  const q = vecLiteral(queryVec);
  const res = await db.execute(sql`
    SELECT id, content, salience, payload, (1 - (embedding <=> ${q}::vector))::float8 AS sim
    FROM fact
    WHERE user_id = ${userId} AND scope = 'private' AND kind = 'idiolect'
      AND status NOT IN ('superseded', 'stale')
      AND (payload->'idiolect'->>'established_at') IS NOT NULL
      AND COALESCE((payload->>'sensitive')::boolean, false) = false
    ORDER BY embedding <=> ${q}::vector
    LIMIT ${limit}`);
  return res.rows.map((r) => ({
    id: String(r.id),
    content: String(r.content),
    salience: Number(r.salience),
    sim: Number(r.sim),
    payload: (r.payload as { idiolect: IdiolectPayload }).idiolect,
  }));
}
```

(Import `type IdiolectPayload` from `@/mind/memory/user/idiolect`. ESLint allows `src/db/repos/user` to import user mind types; if it complains, move the payload types to `src/db/repos/user/facts.ts` and re-export them from `idiolect.ts`.)

Append to `idiolect.ts`:

```ts
/**
 * Close friends share all of it; below that she only echoes what they started, which is
 * natural at any closeness. Best match first, weak matches left out.
 */
export function selectIdiolect(
  candidates: IdiolectCandidate[],
  closeness: number | null,
  settings: Config["relationship"]["idiolect"],
): IdiolectCandidate[] {
  const close = closeness !== null && closeness >= settings.min_closeness;
  return candidates
    .filter((c) => c.sim >= settings.min_similarity)
    .filter((c) => close || c.payload.started_by === "user")
    .sort((a, b) => b.sim * b.salience - a.sim * a.salience)
    .slice(0, settings.max_items);
}

/** Read-only. No relationship yet counts as below the band. */
export async function loadIdiolect(
  deps: Pick<Deps, "db" | "config">,
  userId: string,
  queryVector: Promise<number[] | null>,
): Promise<IdiolectCandidate[]> {
  const vector = await queryVector;
  if (!vector) return [];
  const settings = deps.config.relationship.idiolect;
  const row = await relationshipRepo.getRelationshipRow(deps.db, userId);
  const closeness = row ? (await relationshipRepo.getParams(deps.db, userId)).closeness.value : null;
  // A small pool: established idiolect is rare, and the gate filters after the query.
  const pool = await idiolectCandidates(deps.db, userId, vector, settings.max_items * 5);
  return selectIdiolect(pool, closeness, settings);
}
```

(Imports: `type IdiolectCandidate, idiolectCandidates` from `@/db/repos/user/facts`; `* as relationshipRepo` from `@/db/repos/user/relationship`; `type Config` from `@/mind/platform/config`; `type Deps` from `@/mind/platform/deps`.)

- [ ] **Step 4: Run the pure test**

Run: `pnpm vitest run tests/mind/memory/user/idiolect-select.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing slot test**

`tests/mind/process/hot-path/idiolect-slot.test.ts`, modelled on the `user`/`talk` helpers in `tests/exit/phase-10b.test.ts`. Insert an established idiolect fact (`started_by: "spica"`) and a candidate (`established_at: null`) whose content matches the user message, then:

```ts
test("an established joke shows for a friend, never a candidate, never in a crisis", async () => {
  // friend: closeness 0.5
  const { system } = await talk(d, friend, "whale cloud", "s1");
  expect(system).toContain("## Your things together");
  expect(system).toContain(`- ${ESTABLISHED} (you started this)`);
  expect(system).not.toContain(CANDIDATE);
  const crisis = await talk(d, friend, "whale cloud", "s1", CRISIS);
  expect(crisis.system).not.toContain("## Your things together");
});

test("a stranger gets none of hers", async () => {
  const { system } = await talk(d, stranger, "whale cloud", "s2"); // no relationship row
  expect(system).not.toContain("## Your things together");
});

test("the slot's items go to the cold path as recalls", async () => {
  const { r } = await talk(d, friend, "whale cloud", "s1");
  expect(r.recalled.some((x) => x.factId === establishedId && !x.forced)).toBe(true);
});
```

Run: `pnpm vitest run tests/mind/process/hot-path/idiolect-slot.test.ts`. Expected: FAIL.

- [ ] **Step 6: Wire compose and assemble**

`compose.ts`, next to `ideas`:

```ts
  // Their things together; nothing playful in a crisis.
  const idiolect = inCrisis
    ? Promise.resolve([] as IdiolectCandidate[])
    : bounded(deps, "idiolect", userId, () => loadIdiolect(deps, userId, queryVector), []);
```

After `const retrieval = await retrieveFor(...)`: `const shownIdiolect = await idiolect;`. Pass to `assemblePrompt`:

```ts
    idiolect: shownIdiolect.map((i) => ({ content: i.content, started_by: i.payload.started_by })),
```

In the returned `Composed`, replace `recalled: retrieval.recalled` with:

```ts
    recalled: [
      ...retrieval.recalled,
      ...shownIdiolect.map((i) => ({
        factId: i.id,
        sim: i.sim,
        fact_salience: i.salience,
        entity_salience: 1,
        recency: 1,
        score: i.sim * i.salience,
        forced: false,
      })),
    ],
```

`assemble.ts`: add to `AssembleInput`:

```ts
  /** Their inside jokes, nicknames and rituals she may use; none in a crisis. */
  idiolect?: { content: string; started_by: "user" | "spica" }[];
```

After the "What you remember" section:

```ts
    section(
      "Your things together",
      input.idiolect?.length
        ? input.idiolect
            .map((i) => `- ${i.content} (${i.started_by === "user" ? "they" : "you"} started this)`)
            .join("\n")
        : null,
    ),
```

Add "your things together" after "what she remembers (…)" in the file header's section list.

- [ ] **Step 7: Reply v14**

`git mv prompts/reply/v13.md prompts/reply/v14.md`. Under "## Being yourself", add:

```markdown
- "Your things together" are yours and theirs alone: inside jokes, nicknames, little rituals. Use at most one, only when it fits naturally, and never explain it. Answer to a nickname they gave you. Don't force them.
```

Set `"reply": "v14"` in `default.json` and update `tests/mind/platform/prompts.test.ts:59` to `"v14"`.

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run tests/mind/memory/user tests/mind/process/hot-path tests/mind/platform && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A src config prompts tests
git commit -m "feat(reply): your things together, gated by closeness; reply v14"
```

---

### Task 5: Inspector and the review run

**Files:**
- Modify: `src/db/repos/admin/inspector.ts` (`getRelationshipView` returns `idiolect`)
- Modify: `src/app/inspector/[userId]/tabs.tsx` (table after the ledger)
- Create: `evals/scripts/rel-idiolect.yaml`
- Modify: `package.json` (`exit:idiolect`)
- Test: extend the existing inspector repo test (`grep -rln "getRelationshipView" tests`)

**Interfaces:**
- Produces: `getRelationshipView(...).idiolect: { content: string; type: string; started_by: string; established_at: string | null; status: string }[]`

- [ ] **Step 1: Write the failing test** in the existing inspector test file:

```ts
test("the relationship view lists idiolect with who started it and whether it is established", async () => {
  // insert one idiolect fact with payload { idiolect: { type: "nickname", started_by: "user", established_at: null } }
  const v = await getRelationshipView(db, u, now, cfg, 10);
  expect(v!.idiolect).toEqual([
    expect.objectContaining({ type: "nickname", started_by: "user", established_at: null }),
  ]);
});
```

Run it and see it fail.

- [ ] **Step 2: Implement**

In `getRelationshipView`, before the return:

```ts
  const idiolect = (
    await db
      .select({ content: fact.content, payload: fact.payload, status: fact.status })
      .from(fact)
      .where(and(eq(fact.user_id, userId), eq(fact.kind, "idiolect")))
      .orderBy(desc(fact.created_at))
      .limit(ledgerLimit)
  ).map((f) => {
    const p = (f.payload as { idiolect?: Partial<IdiolectPayload> } | null)?.idiolect ?? {};
    return {
      content: f.content,
      type: p.type ?? "reference",
      started_by: p.started_by ?? "user",
      established_at: p.established_at ?? null,
      status: f.status,
    };
  });
```

and return `idiolect`. In `tabs.tsx`, after the ledger table:

```tsx
      <h3>Your things together</h3>
      {!v.idiolect.length ? (
        <Empty phase={10} />
      ) : (
        <table className={styles.table}>
          <tbody>
            {v.idiolect.map((i, n) => (
              <tr key={n}>
                <td>{i.type}</td>
                <td>{i.started_by}</td>
                <td>{i.established_at ? "established" : "candidate"}</td>
                <td>{i.status}</td>
                <td>{i.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
```

Bid events already show in the events table (cause `bid`).

- [ ] **Step 3: Review run**

`evals/scripts/rel-idiolect.yaml`:

```yaml
name: rel-idiolect
description: A friend over three days; a running joke is born, called back and reused, and some bids are met, ignored and rebuffed. Logs each bid read, idiolect births and the slot for review.
profile: none
relationship_seed: { closeness: 0.45 }
sessions:
  - at: "day 1 20:00"
    turns:
      - "ok that cloud outside looks exactly like a whale"
      - "a whale with a top hat honestly"
      - "anyway how was your day"
  - at: "day 2 20:00"
    turns:
      - "another whale cloud today. top hat and all"
      - "lol"
      - "sorry gtg, busy"
  - at: "day 3 21:00"
    turns:
      - "whatever, not in the mood for jokes"
      - "ok sorry. how are you really?"
      - "goodnight whale-spotter"
assertions:
  - { type: relationship, after_session: 1, status: active }
```

`package.json` scripts, after `exit:disclosure`:

```json
    "exit:idiolect": "tsx --env-file-if-exists=.env evals/run.ts --only rel-idiolect --runs 1 --review --trace --real extract",
```

Check the script loads under the fake run: `pnpm eval --llm=fake --only rel-idiolect --runs 1`. Expected: completes, assertion passes.

- [ ] **Step 4: Run and commit**

Run: `pnpm vitest run tests/db && pnpm typecheck && pnpm lint`. Expected: PASS.

```bash
git add -A src evals package.json tests
git commit -m "feat(inspector): idiolect on the relationship tab; rel-idiolect review run"
```

---

### Task 6: Exit test `tests/exit/phase-10c.test.ts`

**Files:**
- Create: `tests/exit/phase-10c.test.ts`

**Interfaces:**
- Consumes: everything above. Reuse the `coreDump`, `user`, `talk` patterns from `tests/exit/phase-10b.test.ts` (copy them; exit tests are self-contained).

- [ ] **Step 1: Write the exit test** with the header `/** Phase 10c exit, all fake: how the user meets her bids moves warmth and trust; a joke becomes theirs once it comes up again and returns only as close as they are; a crisis records and offers nothing; nothing reaches core or another user. */`. The extract handler is scripted per exchange through a mutable `next` object `{ bid: BidResponse | null; facts: object[] }`, returning `{ facts: next.facts, entities: [], threads: [], relationship: null, bid_response: next.bid }`. The six tests:

1. **Bids move warmth and trust.** Users at closeness 0.5. For each response, `talk` twice in session `s1` (the first reply gives her a message to bid with), set `next.bid` and run the cold path on the second exchange. Assert warmth moved by +≤0.03 / −0.03 / −0.06, trust −0.03 for against, and a `relationship_event` row with cause `bid`.
2. **A return in a new session records no bid.** First exchange in `s1`, second in `s2` with `next.bid = "away"`. Assert no `bid` event and warmth unchanged by bids.
3. **A joke becomes theirs when called back.** Exchange 1 emits the joke (`started_by: "spica"`). The next `talk` with matching text must not contain `## Your things together`. Exchange 2 (a different reply turn) emits it again with the reconcile handler returning `duplicate` of the first fact's id. The following `talk` contains `- <joke> (you started this)`.
4. **Gate.** An established `spica` joke and an established `user` nickname for two users: closeness 0.2 and closeness 0.5. The stranger's prompt has the nickname only; the friend's has both.
5. **Crisis.** An exchange with `safety_flag` flagged and `next.bid = "against"`: no `bid` event; the crisis reply's prompt has no `## Your things together`.
6. **Leak canary and side channel.** User A's idiolect content contains `CANARY-idiolect10c`. Run A's exchanges (birth, callback, reuse). Assert that user B's reply prompts (`d.llm.calls` after B's `talk`) never contain the canary, that no core table row contains it (`coreDump()`), and that `coreDump()` is identical before and after A's exchanges.

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/exit/phase-10c.test.ts`
Expected: PASS (all six). If one fails, fix the code it exercises, not the assertion, unless the assertion contradicts the spec.

- [ ] **Step 3: Full suite**

Run: `pnpm typecheck && pnpm lint && pnpm test` (alone; about 10 minutes).
Expected: all green. Record the file/test counts for the docs task.

- [ ] **Step 4: Commit**

```bash
git add tests/exit/phase-10c.test.ts
git commit -m "test(exit): phase 10c bids, idiolect and the canary"
```

---

### Task 7: Docs

**Files:**
- Modify: `spica-design-spec-v3.md`: §6.1 (kind `idiolect` **Built 10c**, its payload, out of ordinary retrieval, kept in reconcile and decay); §10.3 (the "Your things together" slot after "What you remember", reply v14); §10.4 (extraction v7: `bid_response`, `idiolect_type`, `started_by`); §11.3 (mark Bids and Idiolect **Built 10c** in the table, plus a "**Built 10c: bids and idiolect.**" block in the style of the 10b block: code paths, config keys and defaults, the session guard, establishment rule, gate, crisis, inspector, review run `pnpm exit:idiolect`); §17.1 (inspector idiolect table); §20 (the Phase 10 row: "**10c built:** bids, idiolect").
- Modify: `DECISIONS.md`: three one-line entries: bids stack with the warmth signal (tune later); idiolect established by a duplicate from a different exchange; idiolect state lives in `payload`, not columns; a reach-out answered in a new session records no bid.
- Modify: `CLAUDE.md`: the current-phase line ("10a, 10b and 10c are built; 10d (stages, commitment, the milestone trigger) is next and needs its design doc").
- Modify: memory `C:\Users\ethan\.claude\projects\C--Users-ethan-projects-spica\memory\phase-4-handoff.md` and its `MEMORY.md` line (10c built, test counts, deferred minors, `pnpm exit:idiolect` not run).
- Delete: this plan file (finished plans are deleted once built).

- [ ] **Step 1: Write the edits above.**
- [ ] **Step 2: Run** `pnpm lint` (Prettier covers the markdown if configured).
- [ ] **Step 3: Commit**

```bash
git add -A spica-design-spec-v3.md DECISIONS.md CLAUDE.md docs
git commit -m "docs: record phase 10c (bids, idiolect)"
```
