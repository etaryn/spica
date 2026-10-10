/**
 * Phase 10c exit, all fake: how the user meets her bids moves warmth and trust; a joke becomes
 * theirs once it comes up again and returns only as close as they are; a crisis records and
 * offers nothing; nothing reaches core or another user.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { ensureRelationship, getParams } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import type { SafetyFlag } from "@/db/schema";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { composeReply } from "@/mind/process/hot-path/compose";
import { nudge } from "@/mind/state/user/relationship/params";
import type { BidResponse } from "@/mind/state/user/relationship/signals";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

type D = ReturnType<typeof makeTestDeps>;

const CRISIS: SafetyFlag = { flagged: true, category: "self_harm", source: "classifier" };
const SLOT = "## Your things together";
const JOKE = "whale cloud: Spica and the user say every cloud is a whale in a top hat.";
const NICKNAME = "whale cloud: the user calls Spica whale-spotter.";

const CORE_TABLES = [
  "core_memory",
  "core_entity",
  "core_state",
  "core_goal",
  "core_snapshot",
  "world_event",
  "life_event_log",
  "core_loop_trace",
  "core_budget_day",
  "life_day",
  "drift_log",
  "core_self_line",
];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(
      sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x`),
    );
    parts.push(...res.rows.map((r) => String(r.j)).sort());
  }
  return parts.join("\n");
}

/** What extraction reads off the next exchange. */
type Next = { bid: BidResponse | null; facts: object[] };
function setup() {
  const d = makeTestDeps();
  const next: Next = { bid: null, facts: [] };
  d.llm.handlers.extract = (input: string) => ({
    facts: input.includes("New exchange") ? next.facts : [],
    entities: [],
    threads: [],
    relationship: null,
    bid_response: next.bid,
  });
  return { d, next };
}

const idiolectFact = (content: string, started_by: "user" | "spica") => ({
  subject: "shared",
  kind: "idiolect",
  content,
  occurred_at: null,
  salience: 0.6,
  valence: 0.6,
  confidence: 0.9,
  entity_names: [],
  thread_title: null,
  claim_kind: null,
  idiolect_type: "joke",
  started_by,
});

async function user(d: D, closeness: number) {
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  await d.db.execute(
    sql`UPDATE relationship_param SET value = ${closeness} WHERE user_id = ${u} AND name = 'closeness'`,
  );
  return u;
}

/** One user message and her reply, stored as the hot path's callers store it. */
async function talk(
  d: D,
  u: string,
  session: string,
  text = "whale cloud",
  flag: SafetyFlag | null = null,
) {
  d.clock.advance(60_000);
  const ut = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text,
    created_at: d.clock.now(),
    safety_flag: flag,
  });
  const r = await composeReply(d, u, { turns: [ut], openQuestions: [], flag });
  const ct = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: r.text,
    created_at: d.clock.now(),
    reply_to: ut.id,
  });
  return { r, system: d.llm.calls.at(-1)!.system, ut, ct };
}

/** The cold path for that exchange, reading `next` off it. */
async function settle(d: D, u: string, ex: { ut: { id: string }; ct: { id: string } }) {
  await runColdPath(d, {
    userId: u,
    turnIds: [ex.ut.id, ex.ct.id],
    replyTurnId: ex.ct.id,
    recalled: [],
  });
}

const bidEvents = (u: string) =>
  getTestDb()
    .select()
    .from(s.relationship_event)
    .where(and(eq(s.relationship_event.user_id, u), eq(s.relationship_event.cause, "bid")));

async function seedIdiolect(d: D, u: string, content: string, started_by: "user" | "spica") {
  const [embedding] = await d.embedder.embed([content], "document");
  await insertFact(getTestDb(), u, {
    subject: "shared",
    kind: "idiolect",
    content,
    payload: {
      idiolect: { type: "joke", started_by, established_at: d.clock.now().toISOString() },
    },
    embedding: embedding!,
    entity_refs: [],
    created_at: d.clock.now(),
    salience: 0.6,
    valence: 0.5,
    confidence: 0.9,
    source: "turn",
    status: "open",
  });
}

test("toward, away and against move warmth and trust as configured", async () => {
  const { d, next } = setup();
  const effects = d.config.relationship.bids.effects;
  for (const bid of ["toward", "away", "against"] as const) {
    const u = await user(d, 0.5);
    const session = randomUUID();
    const before = await getParams(d.db, u);
    await talk(d, u, session, "hey");
    const second = await talk(d, u, session, "and then?");
    next.bid = bid;
    await settle(d, u, second);
    next.bid = null;

    const after = await getParams(d.db, u);
    const events = await bidEvents(u);
    expect(events.length).toBeGreaterThan(0);
    if (bid === "toward") {
      expect(after.warmth.value).toBeGreaterThan(before.warmth.value);
      expect(after.warmth.value).toBeLessThanOrEqual(
        nudge(before.warmth.value, effects.toward.warmth!) + 1e-9,
      );
    } else {
      expect(after.warmth.value).toBeCloseTo(nudge(before.warmth.value, effects[bid].warmth!), 6);
    }
    const trust = bid === "against" ? nudge(before.trust.value, effects.against.trust!) : null;
    expect(after.trust.value).toBeCloseTo(trust ?? before.trust.value, 6);
  }
});

test("a return in a new session records no bid", async () => {
  const { d, next } = setup();
  const u = await user(d, 0.5);
  await talk(d, u, randomUUID(), "hey");
  const later = await talk(d, u, randomUUID(), "back");
  next.bid = "away";
  await settle(d, u, later);
  expect(await bidEvents(u)).toEqual([]);
});

test("a joke seen once is not offered; called back in a later exchange, it is", async () => {
  const { d, next } = setup();
  const u = await user(d, 0.5);
  const session = randomUUID();

  next.facts = [idiolectFact(JOKE, "spica")];
  await settle(d, u, await talk(d, u, session));
  next.facts = [];
  expect((await talk(d, u, session)).system).not.toContain(SLOT);

  const [born] = await getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.kind, "idiolect")));
  next.facts = [idiolectFact(JOKE, "spica")];
  d.llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: born!.id });
  await settle(d, u, await talk(d, u, session));
  next.facts = [];

  expect((await talk(d, u, session)).system).toContain(`- ${JOKE} (you started this)`);
});

test("a new user gets only the idiolect they started; a close friend gets hers too", async () => {
  const { d } = setup();
  const stranger = await user(d, 0.2);
  const friend = await user(d, 0.5);
  for (const u of [stranger, friend]) {
    await seedIdiolect(d, u, JOKE, "spica");
    await seedIdiolect(d, u, NICKNAME, "user");
  }

  const strangers = (await talk(d, stranger, randomUUID())).system;
  expect(strangers).toContain(`- ${NICKNAME} (they started this)`);
  expect(strangers).not.toContain(JOKE);

  const friends = (await talk(d, friend, randomUUID())).system;
  expect(friends).toContain(`- ${NICKNAME} (they started this)`);
  expect(friends).toContain(`- ${JOKE} (you started this)`);
});

test("a crisis exchange records no bid and offers no idiolect", async () => {
  const { d, next } = setup();
  const u = await user(d, 0.5);
  await seedIdiolect(d, u, NICKNAME, "user");
  const session = randomUUID();
  await talk(d, u, session, "hey");
  const crisis = await talk(d, u, session, "whale cloud", CRISIS);
  expect(crisis.system).not.toContain(SLOT);
  next.bid = "against";
  await settle(d, u, crisis);
  expect(await bidEvents(u)).toEqual([]);
});

test("leak canary and side channel: one user's idiolect never reaches another user or core", async () => {
  const { d, next } = setup();
  const canary = `CANARY-${randomUUID().slice(0, 8)}`;
  const a = await user(d, 0.5);
  const b = await user(d, 0.5);
  const coreBefore = await coreDump();

  const session = randomUUID();
  const secret = idiolectFact(`whale cloud: the user calls Spica ${canary}.`, "user");
  next.facts = [secret];
  await settle(d, a, await talk(d, a, session));
  const [born] = await getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, a), eq(s.fact.kind, "idiolect")));
  d.llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: born!.id });
  next.bid = "toward";
  await settle(d, a, await talk(d, a, session));
  next.facts = [];
  next.bid = null;
  expect((await talk(d, a, session)).system).toContain(canary);

  const callsBefore = d.llm.calls.length;
  await talk(d, b, randomUUID());
  for (const call of d.llm.calls.slice(callsBefore)) {
    expect(JSON.stringify(call)).not.toContain(canary);
  }
  const coreAfter = await coreDump();
  expect(coreAfter).not.toContain(canary);
  expect(coreAfter).toBe(coreBefore);
});
