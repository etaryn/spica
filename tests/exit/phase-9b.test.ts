/**
 * Phase 9b exit, all fake: a big event runs summarise, reflect and ideate once; her idea is
 * offered in one reply and retired; a loop that has nothing writes nothing, and one that fails
 * doesn't stop the next; an idea or one of her own thoughts can be why she writes first, once
 * per user; a make-up reach-out marks the make-up offered; idle users think nothing; core is
 * untouched.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { getFact, insertFact } from "@/db/repos/user/facts";
import { insertTurn, listTurns } from "@/db/repos/user/session-log";
import { ensureRelationship, getRelationshipRow } from "@/db/repos/user/relationship";
import { reach_out_log } from "@/db/schema";
import { REACH_OUT_SEND_QUEUE, USER_MIND_RUN_QUEUE } from "@/mind/platform/jobs";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { composeReply } from "@/mind/process/hot-path/compose";
import { runReachOutSend } from "@/mind/process/outreach/send";
import { outreachTickUser } from "@/mind/process/outreach/tick";
import { runUserMind } from "@/mind/process/user/run";
import { tickUser } from "@/mind/state/user/relationship/daily-tick";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { sequence } from "../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

const CORE_TABLES = [
  "core_memory",
  "core_state",
  "core_goal",
  "core_snapshot",
  "core_loop_trace",
  "core_budget_day",
];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(
      sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`),
    );
    parts.push(...res.rows.map((r) => String(r.j)));
  }
  return parts.join("\n");
}
async function count(table: string, where = "true"): Promise<number> {
  const res = await getTestDb().execute(
    sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`),
  );
  return Number(res.rows[0]!.n);
}

/** Scripted extraction: "BIG" stores a salient fact. */
function deps(overrides: unknown = {}) {
  const d = makeTestDeps(overrides);
  d.llm.handlers.extract = (input: string) => {
    const latest = input.split("New exchange").at(-1) ?? "";
    return {
      facts: latest.includes("BIG")
        ? [
            {
              subject: "user",
              kind: "event",
              content: `Big news from ${latest.match(/BIG \w+/)?.[0] ?? "BIG"}.`,
              occurred_at: null,
              salience: 0.9,
              valence: 0.6,
              confidence: 0.9,
              entity_names: [],
              thread_title: null,
              claim_kind: null,
            },
          ]
        : [],
      entities: [],
      threads: [],
      relationship: null,
    };
  };
  return d;
}
type D = ReturnType<typeof deps>;

const SLOT = "## Things you want to bring up";
const HOUR = 3_600_000;

async function exchange(d: D, userId: string, text: string) {
  d.clock.advance(60_000);
  const session = randomUUID();
  const ut = await insertTurn(d.db, userId, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text,
    created_at: d.clock.now(),
  });
  const ct = await insertTurn(d.db, userId, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: "ok",
    created_at: d.clock.now(),
    reply_to: ut.id,
  });
  return { userId, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] };
}

async function drainRuns(d: D) {
  for (const job of d.queue.drain((j) => j.name === USER_MIND_RUN_QUEUE))
    if (job.name === USER_MIND_RUN_QUEUE) await runUserMind(d, job.data);
}

async function bigEvent(d: D, u: string, text: string) {
  await runColdPath(d, await exchange(d, u, text));
  await drainRuns(d);
}

async function newUser(d: D, name?: string) {
  const u = await createTestUser(name);
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  return u;
}

/**
 * Outreach runs on her clock at a free hour (UTC, 15:20, no world events). Each user has one
 * earlier exchange so a reach-out has history, and is otherwise quiet: nothing in progress, no
 * caps hit, no crisis, and no last contact, so no check-in competes.
 */
function outreachDeps(outreach: Record<string, unknown> = {}) {
  const d = deps({
    life: { timezone: "UTC" },
    core: { world: { events_per_day_max: 0 } },
    outreach,
  });
  d.clock.set(new Date("2026-01-05T15:20:00Z"));
  return d;
}
async function outreachUser(d: D, name?: string) {
  const u = await newUser(d, name);
  await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "talk later",
    created_at: new Date(d.clock.now().getTime() - 26 * HOUR),
  });
  return u;
}

/** One tick for the user, then the send it scheduled; returns the tick's log row. */
async function reachOut(d: D, u: string) {
  const outcome = await outreachTickUser(d, u, d.clock.now());
  for (const job of d.queue.drain((j) => j.name === REACH_OUT_SEND_QUEUE))
    if (job.name === REACH_OUT_SEND_QUEUE) expect(await runReachOutSend(d, job.data)).toBe("sent");
  const [row] = await d.db
    .select()
    .from(reach_out_log)
    .where(eq(reach_out_log.user_id, u))
    .orderBy(desc(reach_out_log.created_at))
    .limit(1);
  return { outcome, row: row! };
}

async function sentTopics(d: D, u: string) {
  const rows = await d.db
    .select({ topic: reach_out_log.topic })
    .from(reach_out_log)
    .where(and(eq(reach_out_log.user_id, u), eq(reach_out_log.status, "sent")));
  return rows.map((r) => r.topic);
}

test("one big event: three traces, a summary, a reflection, an idea", async () => {
  const d = deps();
  const u = await newUser(d);
  const before = await coreDump();
  await bigEvent(d, u, "BIG audition friday");
  expect(await count("user_mind_run")).toBe(1);
  expect(await count("user_loop_trace", "status = 'done'")).toBe(3);
  for (const kind of ["summary", "reflection", "idea"])
    expect(await count("fact", `kind = '${kind}'`), kind).toBe(1);
  expect(await coreDump()).toBe(before);
});

test("the idea is offered in one reply, then retired", async () => {
  const d = deps();
  const u = await newUser(d);
  const before = await coreDump();
  await bigEvent(d, u, "BIG audition friday");
  const ideaId = String(
    (await getTestDb().execute(sql`SELECT id FROM fact WHERE kind = 'idea'`)).rows[0]!.id,
  );

  d.clock.advance(60_000);
  const session = randomUUID();
  const ask = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text: "so what's new?",
    created_at: d.clock.now(),
  });
  const composed = await composeReply(d, u, { turns: [ask], openQuestions: [], flag: null });
  expect(d.llm.calls.at(-1)!.system).toContain(SLOT);
  expect(composed.offeredIdeas).toEqual([ideaId]);
  const reply = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: composed.text,
    created_at: d.clock.now(),
    reply_to: ask.id,
  });
  await runColdPath(d, {
    userId: u,
    turnIds: [ask.id, reply.id],
    replyTurnId: reply.id,
    recalled: [],
    offeredIdeas: composed.offeredIdeas,
  });
  expect((await getFact(d.db, u, ideaId))!.status).toBe("resolved");

  d.clock.advance(60_000);
  const again = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text: "anything else?",
    created_at: d.clock.now(),
  });
  await composeReply(d, u, { turns: [again], openQuestions: [], flag: null });
  expect(d.llm.calls.at(-1)!.system).not.toContain(SLOT);
  expect(await coreDump()).toBe(before);
});

test("null writes nothing; a failing reflect still runs ideate", async () => {
  const d = deps();
  d.llm.handlers.user_reflect = sequence({ reflection: null, subject: "user" }, new Error("boom"));
  const u = await newUser(d);
  const before = await coreDump();

  await bigEvent(d, u, "BIG audition friday");
  expect(await count("user_mind_run", "status = 'done'")).toBe(1);
  expect(await count("user_loop_trace", "loop = 'user_reflect' AND status = 'done'")).toBe(1);
  expect(await count("fact", "kind = 'reflection'")).toBe(0);

  await bigEvent(d, u, "BIG callback monday");
  expect(await count("user_mind_run", "status = 'failed'")).toBe(1);
  expect(await count("user_loop_trace", "loop = 'user_reflect' AND status = 'failed'")).toBe(1);
  expect(await count("user_loop_trace", "loop = 'user_ideate' AND status = 'done'")).toBe(2);
  expect(await count("fact", "kind = 'reflection'")).toBe(0);
  expect(await coreDump()).toBe(before);
});

test("a live idea wins a reach-out, once", async () => {
  const d = outreachDeps();
  const u = await outreachUser(d);
  const idea = await insertFact(d.db, u, {
    subject: "shared",
    kind: "idea",
    content: "Ask how the audition went.",
    embedding: vec(),
    created_at: d.clock.now(),
    status: "open",
    salience: 0.6,
    valence: 0,
    confidence: 0.6,
    source: "generated",
  });
  const before = await coreDump();

  const { outcome, row } = await reachOut(d, u);
  expect(outcome).toBe("scheduled");
  expect(row).toMatchObject({ status: "sent", topic: `idea:${idea.id}` });
  const sent = (await listTurns(d.db, u)).filter((t) => t.trigger === "reach_out");
  expect(sent.map((t) => t.id)).toEqual([row.turn_id]);
  expect((await getFact(d.db, u, idea.id))!.status).toBe("resolved");
  expect(await coreDump()).toBe(before);
});

test("her own thought reaches each user once", async () => {
  // A long lookback keeps the thought a candidate past the daily cap, so the second tick shows
  // that the used topic, not the cap or the window, is what stops a repeat.
  const d = outreachDeps({ core_thought_lookback_hours: 72 });
  const users = [await outreachUser(d, "a"), await outreachUser(d, "b")];
  const thought = await d.core.memory.insert({
    kind: "thought",
    content: "Spica keeps thinking about how old starlight is.",
    embedding: vec(),
    occurred_at: null,
    created_at: new Date(d.clock.now().getTime() - HOUR),
    status: "open",
    salience: 0.6,
    valence: 0.3,
    confidence: 1,
    source: "loop",
    source_ref: null,
  });
  const before = await coreDump();
  const topic = `core:${thought}`;

  for (const u of users) {
    const { row } = await reachOut(d, u);
    expect(row).toMatchObject({ status: "sent", topic });
    expect((row.winner as { kind: string }).kind).toBe("core_thought");
  }

  d.clock.advance(25 * HOUR);
  for (const u of users) {
    const { row } = await reachOut(d, u);
    expect(row.gate_results).toContainEqual(expect.objectContaining({ rule: "caps", pass: true }));
    expect(row.candidates).toContainEqual(
      expect.objectContaining({ topic, filtered: "topic_used" }),
    );
    expect(row.topic).not.toBe(topic);
    expect((await sentTopics(d, u)).filter((t) => t === topic)).toHaveLength(1);
  }
  expect(await coreDump()).toBe(before);
});

test("a make-up reach-out marks the make-up offered", async () => {
  const d = outreachDeps();
  const u = await outreachUser(d);
  await d.db.execute(sql`UPDATE relationship SET make_up_state = 'due' WHERE user_id = ${u}`);
  await d.db.execute(
    sql`UPDATE relationship_param SET value = 0.6, updated_at = ${d.clock.now()}
        WHERE user_id = ${u} AND name = 'hurt'`,
  );
  const before = await coreDump();

  const { row } = await reachOut(d, u);
  expect(row.status).toBe("sent");
  expect((row.winner as { kind: string }).kind).toBe("make_up");
  expect((await getRelationshipRow(d.db, u))!.make_up_state).toBe("offered");
  expect(await coreDump()).toBe(before);
});

test("idle users think nothing", async () => {
  const d = deps();
  const u = await newUser(d);
  const before = await coreDump();
  for (let day = 0; day < 7; day++) {
    d.clock.advance(24 * HOUR);
    await tickUser(d, u, d.clock.now());
    await drainRuns(d);
  }
  expect(await count("user_loop_trace")).toBe(0);
  expect(await coreDump()).toBe(before);
});
