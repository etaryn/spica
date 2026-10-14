/**
 * Phase 10d exit, all fake: a friendship climbs Knapp's stages and each first makes her think about
 * them once; a bad patch narrows what she shares and an absence reads warm; commitment softens a
 * hurt; a crisis marks nothing; nothing reaches core or another user.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { ensureRelationship, getParams } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import type { SafetyFlag } from "@/db/schema";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { composeReply } from "@/mind/process/hot-path/compose";
import { tickUser } from "@/mind/state/user/relationship/daily-tick";
import { loadStagePhrases } from "@/mind/state/user/relationship/stages";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

type D = ReturnType<typeof makeTestDeps>;

const CRISIS: SafetyFlag = { flagged: true, category: "self_harm", source: "classifier" };
const DAY = 24 * 3_600_000;

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
type Next = { relationship: object | null; disclosure: number };
function setup() {
  const d = makeTestDeps();
  const next: Next = { relationship: null, disclosure: 0 };
  d.llm.handlers.extract = () => ({
    facts: [],
    entities: [],
    threads: [],
    relationship: next.relationship,
    intimacy: { user_disclosure: next.disclosure, user_responsiveness: null },
    bid_response: null,
  });
  return { d, next };
}

/** A user whose params and peak stage are seeded, as if the friendship had got there. */
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

/** One user message and her reply, stored as the hot path's callers store it. */
async function talk(d: D, u: string, session: string, text = "hi", flag: SafetyFlag | null = null) {
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
    openness: r.openness,
    depth: r.depth,
  });
  return { r, system: d.llm.calls.at(-1)!.system, ut, ct };
}

async function settle(d: D, u: string, ex: { ut: { id: string }; ct: { id: string } }) {
  await runColdPath(d, {
    userId: u,
    turnIds: [ex.ut.id, ex.ct.id],
    replyTurnId: ex.ct.id,
    recalled: [],
  });
}

async function seedIdiolect(d: D, u: string, content: string) {
  const [embedding] = await d.embedder.embed([content], "document");
  await insertFact(getTestDb(), u, {
    subject: "shared",
    kind: "idiolect",
    content,
    payload: {
      idiolect: {
        type: "joke",
        started_by: "user",
        established_at: d.clock.now().toISOString(),
      },
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

const row = async (u: string) =>
  (await getTestDb().select().from(s.relationship).where(eq(s.relationship.user_id, u)))[0]!;
const milestoneRuns = async (u: string) =>
  (await getTestDb().select().from(s.user_mind_run).where(eq(s.user_mind_run.user_id, u)))
    .flatMap((r) => r.triggers as { kind: string; name?: string }[])
    .filter((t) => t.kind === "milestone")
    .map((t) => t.name);
const sore = (amount: number) => ({
  warmth: 0,
  trust: 0,
  tension: 0,
  hurt: { amount, cause: "they snapped at her" },
  apology: false,
  make_up: false,
  ends_relationship: false,
  retracts_ending: false,
  wants_repair: false,
});
const JOKE = "whale cloud: a whale in a top hat.";

test("a friendship climbs the stages; each first fires once", async () => {
  const { d } = setup();
  const u = await user(d);
  const session = randomUUID();
  await settle(d, u, await talk(d, u, session));
  expect(await milestoneRuns(u)).toEqual([]);

  await d.db.execute(sql`UPDATE relationship SET hours_together = 5 WHERE user_id = ${u}`);
  await d.db.execute(
    sql`UPDATE relationship_param SET value = 0.7 WHERE user_id = ${u} AND name = 'closeness'`,
  );
  await d.db.execute(
    sql`UPDATE relationship_param SET value = 0.6 WHERE user_id = ${u} AND name = 'trust'`,
  );
  await seedIdiolect(d, u, JOKE);
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
  await d.db.execute(
    sql`UPDATE relationship_param SET baseline = 0.5 WHERE user_id = ${brief} AND name = 'commitment'`,
  );
  const lasting = await user(d, { closeness: 0.7, trust: 0.6, commitment: 0.75 }, "integrating");
  d.clock.advance(DAY);
  await tickUser(d, brief, d.clock.now());
  await tickUser(d, lasting, d.clock.now());
  expect((await row(brief)).peak_stage).toBe("integrating");
  expect((await row(lasting)).peak_stage).toBe("bonding");
  expect(await milestoneRuns(lasting)).toContain("stage:bonding");
});

test("a bad patch narrows depth and their things; clearing it restores the peak", async () => {
  const { d } = setup();
  const u = await user(d, { closeness: 0.7, trust: 0.6 }, "integrating");
  await seedIdiolect(d, u, JOKE);
  const session = randomUUID();
  await d.db.execute(
    sql`UPDATE relationship_param SET value = 0.85 WHERE user_id = ${u} AND name = 'tension'`,
  );
  await settle(d, u, await talk(d, u, session, "whatever"));
  expect((await row(u)).apart_stage).toBe("circumscribing");
  expect(await milestoneRuns(u)).toContain("first_conflict");

  const cooled = await talk(d, u, session, "whale cloud");
  expect(cooled.system).not.toContain("## Your things together");
  expect(cooled.system).toContain(loadStagePhrases(d.config).circumscribing![0]!);
  expect(cooled.r.depth.open).toBe(1);

  await d.db.execute(
    sql`UPDATE relationship_param SET value = 0 WHERE user_id = ${u} AND name IN ('tension', 'hurt')`,
  );
  await settle(d, u, cooled);
  expect((await row(u)).apart_stage).toBeNull();
  const warm = await talk(d, u, session, "whale cloud");
  expect(warm.system).toContain("## Your things together");
  expect(warm.r.depth.open).toBe(3);
});

test("an absence reads as avoiding, warm, and clears when they come back", async () => {
  const { d } = setup();
  const u = await user(d, { closeness: 0.5 }, "intensifying");
  await settle(d, u, await talk(d, u, randomUUID()));
  d.clock.advance(20 * DAY);
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
    next.relationship = sore(0.25);
    await settle(d, u, await talk(d, u, randomUUID(), "you're useless"));
    next.relationship = null;
    return (await getParams(d.db, u)).hurt.value;
  };
  const committed = await hurtAfter(1);
  const casual = await hurtAfter(0);
  expect(committed).toBeGreaterThan(0);
  expect(committed).toBeLessThan(casual);
});

test("a crisis marks no first; the next ordinary exchange does", async () => {
  const { d, next } = setup();
  const u = await user(d);
  const session = randomUUID();
  await settle(d, u, await talk(d, u, session));
  next.disclosure = 0.9;
  await settle(d, u, await talk(d, u, session, "i can't do this", CRISIS));
  expect(await milestoneRuns(u)).not.toContain("first_their_depth");
  await settle(d, u, await talk(d, u, session, "i've never told anyone this"));
  expect(await milestoneRuns(u)).toContain("first_their_depth");
});

test("a relationship from before stages fires no burst of firsts", async () => {
  const { d } = setup();
  const u = await user(d, { closeness: 0.7, trust: 0.6 });
  await d.db.execute(
    sql`UPDATE relationship SET milestones = NULL, hours_together = 20 WHERE user_id = ${u}`,
  );
  const first = await talk(d, u, randomUUID());
  expect(first.r.depth.open).toBe(2);
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
  await seedIdiolect(d, a, `whale cloud: the user calls Spica ${canary}.`);
  next.relationship = sore(0.6);
  const ex = await talk(d, a, randomUUID(), "whale cloud");
  expect(ex.system).toContain(canary);
  await settle(d, a, ex);
  next.relationship = null;
  d.clock.advance(DAY);
  await tickUser(d, a, d.clock.now());

  const callsBefore = d.llm.calls.length;
  await talk(d, b, randomUUID());
  for (const call of d.llm.calls.slice(callsBefore)) {
    expect(JSON.stringify(call)).not.toContain(canary);
  }
  const coreAfter = await coreDump();
  expect(coreAfter).not.toContain(canary);
  expect(coreAfter).toBe(coreBefore);
});

test("inside a crisis window the tick leaves the stage and firsts alone", async () => {
  const { d } = setup();
  const u = await user(d, { closeness: 0.7, trust: 0.6 }, "intensifying");
  await seedIdiolect(d, u, JOKE);
  await settle(d, u, await talk(d, u, randomUUID()));
  const runsBefore = (await milestoneRuns(u)).length;
  d.clock.advance(20 * DAY);
  const quietUntil = new Date(d.clock.now().getTime() + DAY);
  await d.db.execute(
    sql`UPDATE relationship SET crisis_quiet_until = ${quietUntil.toISOString()}::timestamptz,
        milestones = '{}', peak_stage = 'intensifying' WHERE user_id = ${u}`,
  );
  await tickUser(d, u, d.clock.now());
  expect((await row(u)).apart_stage).toBeNull();
  expect((await row(u)).peak_stage).toBe("intensifying");
  expect((await milestoneRuns(u)).length).toBe(runsBefore);

  d.clock.advance(2 * DAY);
  await tickUser(d, u, d.clock.now());
  expect((await row(u)).apart_stage).toBe("avoiding");
  expect(await milestoneRuns(u)).toContain("stage:integrating");
});
