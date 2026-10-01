import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { handleColdPath } from "@/mind/process/cold-path/cold-path";
import type { Db } from "@/db/client";
import {
  ensureRelationship,
  getParams,
  getRelationshipRow,
  listRelationshipEvents,
} from "@/db/repos/relationship";
import { insertTurn } from "@/db/repos/session-log";
import * as s from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../../helpers/db";
import { makeTestDeps } from "../../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const deps0 = makeTestDeps();
const none = {
  warmth: 0,
  trust: 0,
  tension: 0,
  hurt: null,
  apology: false,
  make_up: false,
  ends_relationship: false,
  retracts_ending: false,
  wants_repair: false,
};

async function exchange(
  deps: ReturnType<typeof makeTestDeps>,
  userId: string,
  text: string,
  flagged = false,
) {
  const db = getTestDb();
  const ut = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text,
    created_at: deps.clock.now(),
  });
  const ct = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: ut.session_id,
    role: "companion",
    text: "ok",
    created_at: deps.clock.now(),
    reply_to: ut.id,
    safety_flag: flagged ? { flagged: true, category: "self_harm", source: "classifier" } : null,
  });
  return { userId, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] };
}

function withSignals(rel: unknown) {
  const deps = makeTestDeps();
  deps.llm.handlers.extract = () => ({ facts: [], entities: [], threads: [], relationship: rel });
  return deps;
}

test("a hurt signal stores the cause as a self feeling fact, raises hurt, makes a make-up due, logs events", async () => {
  const deps = withSignals({
    ...none,
    hurt: { amount: 0.8, cause: "the user called her news stupid" },
  });
  const u = await createTestUser();
  await handleColdPath(deps, await exchange(deps, u, "your news is stupid"));
  const facts = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({
    subject: "self",
    kind: "feeling",
    source: "inferred",
    content: "Spica felt hurt because the user called her news stupid.",
  });
  const row = await getRelationshipRow(getTestDb(), u);
  expect(row).toMatchObject({ make_up_state: "due", hurt_cause_fact: facts[0]!.id });
  expect((await getParams(getTestDb(), u)).hurt.value).toBeGreaterThan(0.25);
  expect(
    (await listRelationshipEvents(getTestDb(), u, 50)).some(
      (e) => e.cause === "signal" && e.param === "hurt",
    ),
  ).toBe(true);
  expect(row?.cadence).toMatchObject({ msgs_24h: 1 });
  expect(row?.last_contact).toEqual(deps.clock.now());
});

test("a sub-deadzone hurt writes no feeling fact and moves no hurt (matches applyExchange's deadzone)", async () => {
  const deps = withSignals({
    ...none,
    hurt: { amount: deps0.config.relationship.signal_deadzone / 2, cause: "a tiny slight" },
  });
  const u = await createTestUser();
  await handleColdPath(deps, await exchange(deps, u, "meh"));
  expect(await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u))).toEqual([]);
  expect((await getParams(getTestDb(), u)).hurt.value).toBe(0);
  expect((await getRelationshipRow(getTestDb(), u))?.hurt_cause_fact).toBeNull();
});

test("a hurt exactly at the deadzone still writes the feeling fact (same >= as applyExchange)", async () => {
  const deps = withSignals({
    ...none,
    hurt: { amount: deps0.config.relationship.signal_deadzone, cause: "a small slight" },
  });
  const u = await createTestUser();
  await handleColdPath(deps, await exchange(deps, u, "meh"));
  const facts = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(facts.map((f) => f.kind)).toEqual(["feeling"]);
  expect((await getParams(getTestDb(), u)).hurt.value).toBeGreaterThan(0);
});

test("null block: memory commits, relationship row created, no signal events", async () => {
  const deps = withSignals(null);
  const u = await createTestUser();
  expect((await handleColdPath(deps, await exchange(deps, u, "hi"))).status).toBe("done");
  expect(await getRelationshipRow(getTestDb(), u)).not.toBeNull();
  expect(
    (await listRelationshipEvents(getTestDb(), u, 50)).filter((e) => e.cause === "signal"),
  ).toEqual([]);
});

test("crisis exchange: no feeling fact, no hurt, crisis event", async () => {
  const deps = withSignals({ ...none, hurt: { amount: 1, cause: "x" }, ends_relationship: true });
  const u = await createTestUser();
  await handleColdPath(deps, await exchange(deps, u, "i want to die", true));
  expect(await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u))).toEqual([]);
  expect((await getParams(getTestDb(), u)).hurt.value).toBe(0);
  expect((await getParams(getTestDb(), u)).tension.value).toBe(0);
  const row = await getRelationshipRow(getTestDb(), u);
  expect(row?.end_pending_since).toBeNull();
  expect(row?.crisis_quiet_until).not.toBeNull();
  expect((await listRelationshipEvents(getTestDb(), u, 50)).some((e) => e.cause === "crisis")).toBe(
    true,
  );
});

test("exchangeAt wiring: end_pending_since is stamped with the user turn's created_at, not the cold path's clock", async () => {
  const deps = withSignals({ ...none, ends_relationship: true });
  const u = await createTestUser();
  const turnAt = deps.clock.now();
  const job = await exchange(deps, u, "i'm done, we're through");
  deps.clock.advance(3 * 3_600_000); // the cold path runs 3 hours after the turn was written
  await handleColdPath(deps, job);
  const row = await getRelationshipRow(getTestDb(), u);
  expect(row?.end_pending_since).toEqual(turnAt);
  expect(row?.end_pending_since).not.toEqual(deps.clock.now());
});

test("savepoint: a relationship failure rolls back only the relationship part", async () => {
  const deps = Object.assign(makeTestDeps(), {
    updateRelationship: async (
      sp: Db,
      deps2: ReturnType<typeof makeTestDeps>,
      a: { userId: string },
    ) => {
      await ensureRelationship(sp, a.userId, deps2.clock.now(), deps2.config.relationship);
      throw new Error("boom");
    },
  });
  deps.llm.handlers.extract = () => ({
    facts: [
      {
        subject: "user",
        kind: "trait",
        content: "The user likes tea.",
        occurred_at: null,
        salience: 0.5,
        valence: 0,
        confidence: 0.9,
        entity_names: [],
        thread_title: null,
      },
    ],
    entities: [],
    threads: [],
    relationship: null,
  });
  const u = await createTestUser();
  const job = await exchange(deps, u, "i like tea");
  expect((await handleColdPath(deps, job)).status).toBe("done");
  expect(await getRelationshipRow(getTestDb(), u)).toBeNull();
  expect(
    (await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u))).map((f) => f.content),
  ).toEqual(["The user likes tea."]);
  const turns = await getTestDb().select().from(s.session_log).where(eq(s.session_log.user_id, u));
  expect(turns.every((t) => t.extracted)).toBe(true);
});
