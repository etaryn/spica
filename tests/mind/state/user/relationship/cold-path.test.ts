import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import type { Db } from "@/db/client";
import {
  ensureRelationship,
  getParams,
  getRelationshipRow,
  listRelationshipEvents,
} from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../../helpers/db";
import { scriptedLabels, type ScriptedSignals } from "@/mind/platform/llm/fake-labels";
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

/** The labelling reads `rel` from their message; the hurt's words are code's, from their message. */
function withSignals(
  rel:
    (Omit<ScriptedSignals, "hurt"> & { hurt?: { amount: number; cause?: string } | null }) | null,
) {
  const deps = makeTestDeps();
  const relationship = rel && { ...rel, hurt: rel.hurt ? { amount: rel.hurt.amount } : null };
  Object.assign(deps.llm.handlers, scriptedLabels({ relationship }));
  return deps;
}

test("a hurt signal stores the cause as a self feeling fact, raises hurt, makes a make-up due, logs events", async () => {
  const deps = withSignals({
    ...none,
    hurt: { amount: 0.8, cause: "the user called her news stupid" },
  });
  const u = await createTestUser();
  await runColdPath(deps, await exchange(deps, u, "your news is stupid"));
  const facts = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({
    subject: "self",
    kind: "feeling",
    source: "inferred",
    content: 'Spica felt hurt because the user said "your news is stupid".',
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
  await runColdPath(deps, await exchange(deps, u, "meh"));
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
  await runColdPath(deps, await exchange(deps, u, "meh"));
  const facts = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(facts.map((f) => f.kind)).toEqual(["feeling"]);
  expect((await getParams(getTestDb(), u)).hurt.value).toBeGreaterThan(0);
});

test("null block: memory commits, relationship row created, no signal events", async () => {
  const deps = withSignals(null);
  const u = await createTestUser();
  expect((await runColdPath(deps, await exchange(deps, u, "hi"))).status).toBe("done");
  expect(await getRelationshipRow(getTestDb(), u)).not.toBeNull();
  expect(
    (await listRelationshipEvents(getTestDb(), u, 50)).filter((e) => e.cause === "signal"),
  ).toEqual([]);
});

test("crisis exchange: no feeling fact, no hurt, crisis event", async () => {
  const deps = withSignals({ ...none, hurt: { amount: 1, cause: "x" }, ends_relationship: true });
  const u = await createTestUser();
  await runColdPath(deps, await exchange(deps, u, "i want to die", true));
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
  await runColdPath(deps, job);
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
  Object.assign(
    deps.llm.handlers,
    scriptedLabels({
      memories: [{ said: "tea", label: "likes tea", kind: "trait", salience: 0.5 }],
    }),
  );
  const u = await createTestUser();
  const job = await exchange(deps, u, "i like tea");
  expect((await runColdPath(deps, job)).status).toBe("done");
  expect(await getRelationshipRow(getTestDb(), u)).toBeNull();
  expect(
    (await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u))).map((f) => f.content),
  ).toEqual(['likes tea — the user said "i like tea"']);
  const turns = await getTestDb().select().from(s.session_log).where(eq(s.session_log.user_id, u));
  expect(turns.every((t) => t.extracted)).toBe(true);
});

test("crisis exchange leaves her feelings toward them (affect, afterglow) untouched", async () => {
  const warmFact = { said: "the job", label: "got the job", salience: 0.9, valence: 0.9 };
  const feelings = async (u: string) => {
    const p = await getParams(getTestDb(), u);
    return { affect: p.affect_valence.value, afterglow: p.afterglow.value };
  };
  const extractWarm = (deps: ReturnType<typeof makeTestDeps>) => {
    Object.assign(deps.llm.handlers, scriptedLabels({ memories: [warmFact] }));
  };

  // Precondition: the same warm exchange outside a crisis does move them.
  const control = makeTestDeps();
  extractWarm(control);
  const c = await createTestUser();
  await ensureRelationship(getTestDb(), c, control.clock.now(), control.config.relationship);
  const controlBefore = await feelings(c);
  await runColdPath(control, await exchange(control, c, "i got the job!!"));
  expect(await feelings(c)).not.toEqual(controlBefore);

  const deps = makeTestDeps();
  extractWarm(deps);
  const u = await createTestUser();
  await ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
  const before = await feelings(u);
  await runColdPath(deps, await exchange(deps, u, "i got the job but i want to die", true));
  expect(await feelings(u)).toEqual(before);
});

function withIntimacy(intimacy: { user_disclosure: number; user_responsiveness: number | null }) {
  const deps = makeTestDeps();
  Object.assign(deps.llm.handlers, scriptedLabels({ intimacy }));
  return deps;
}

/**
 * Her message first (a reach-out or an earlier reply), the user's answer 20 minutes later, then
 * her reply a minute after that: the exchange is the answer and her reply.
 */
async function exchangeWithOpenness(
  deps: ReturnType<typeof makeTestDeps>,
  userId: string,
  openness: { disclosure: number; responsiveness: number } | null,
  trigger: "reach_out" | null = null,
) {
  const db = getTestDb();
  const session = randomUUID();
  await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: "i had the strangest week",
    created_at: deps.clock.now(),
    trigger,
  });
  deps.clock.advance(20 * 60_000);
  const ut = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text: "honestly i've been scared about my dad's health",
    created_at: deps.clock.now(),
  });
  deps.clock.advance(60_000);
  const reply = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: "oh no. what's going on with him?",
    created_at: deps.clock.now(),
    reply_to: ut.id,
    openness,
  });
  return { userId, turnIds: [ut.id, reply.id], replyTurnId: reply.id, recalled: [] };
}

test("an answered reach-out adds its time and credits the moment from its stored openness", async () => {
  const deps = withIntimacy({ user_disclosure: 0.9, user_responsiveness: 0.8 });
  const u = await createTestUser();
  await ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
  const before = (await getParams(getTestDb(), u)).closeness.value;
  await runColdPath(
    deps,
    await exchangeWithOpenness(deps, u, { disclosure: 0.7, responsiveness: 0.9 }, "reach_out"),
  );
  const row = (await getRelationshipRow(getTestDb(), u))!;
  // Waiting for the answer isn't time together.
  expect(row.hours_together).toBeCloseTo(
    Math.max(deps.config.relationship.hours.session_min_minutes, 1) / 60,
  );
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
