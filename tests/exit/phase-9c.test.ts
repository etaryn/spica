/**
 * Phase 9c exit, all fake: a long conversation, a passed crisis and a stale summary before a
 * reach-out each run her user mind exactly once, however often the ticks rerun; an idle user
 * runs nothing; what a crisis told her reaches her summary but never ideate, a reach-out or
 * another user, and core is untouched.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { insertFact } from "@/db/repos/user/facts";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn, listTurns } from "@/db/repos/user/session-log";
import { insertThread } from "@/db/repos/user/threads";
import { relationship } from "@/db/schema";
import { REACH_OUT_SEND_QUEUE, USER_MIND_RUN_QUEUE } from "@/mind/platform/jobs";
import { runReachOutSend } from "@/mind/process/outreach/send";
import { outreachTickUser } from "@/mind/process/outreach/tick";
import { runUserMind } from "@/mind/process/user/run";
import { userMindTick } from "@/mind/process/user/tick";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const TOKEN = "CANARY-9c41d0";
const MIN = 60_000;
const HOUR = 60 * MIN;
// Her clock at a free hour (UTC, no world events), so outreach can schedule.
const now = new Date("2026-01-05T15:25:00Z");

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
async function count(table: string): Promise<number> {
  const res = await getTestDb().execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
  return Number(res.rows[0]!.n);
}

function deps() {
  const d = makeTestDeps({
    life: { timezone: "UTC" },
    core: { world: { events_per_day_max: 0 } },
    user_mind: { triggers: { long_conversation: { min_user_turns: 3, quiet_minutes: 30 } } },
  });
  d.clock.set(now);
  return d;
}
type D = ReturnType<typeof deps>;

async function user(d: D, name: string) {
  const u = await createTestUser(name);
  await ensureRelationship(d.db, u, now, d.config.relationship);
  return u;
}
async function drain(d: D) {
  for (const job of d.queue.drain((j) => j.name === USER_MIND_RUN_QUEUE))
    if (job.name === USER_MIND_RUN_QUEUE) await runUserMind(d, job.data);
}

/** A session of `userTurns` answered user turns, its last turn `endedMinutesAgo`. */
async function session(u: string, userTurns: number, endedMinutesAgo: number) {
  const sessionId = randomUUID();
  const end = now.getTime() - endedMinutesAgo * MIN;
  for (let i = 0; i < userTurns; i++) {
    const at = end - (userTurns - 1 - i) * 2 * MIN - MIN;
    for (const [role, offset] of [
      ["user", 0],
      ["companion", MIN],
    ] as const)
      await insertTurn(getTestDb(), u, {
        id: randomUUID(),
        session_id: sessionId,
        role,
        text: `${role} ${i}`,
        created_at: new Date(at + offset),
      });
  }
}

/** A storyline checkpoint that is due, so outreach has a winner; plus history to write after. */
async function dueThread(d: D, u: string) {
  const t = await insertThread(
    d.db,
    u,
    {
      title: "interview",
      subject: "user",
      stakes: "high",
      next_checkpoint: new Date(now.getTime() - HOUR),
    },
    new Date(now.getTime() - 24 * HOUR),
  );
  await insertFact(d.db, u, {
    subject: "user",
    kind: "event",
    content: "interview at Canva",
    embedding: vec(),
    created_at: now,
    status: "open",
    salience: 0.7,
    valence: 0,
    confidence: 1,
    source: "turn",
    thread_id: t.id,
  });
  await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "talk later",
    created_at: new Date(now.getTime() - 26 * HOUR),
  });
}

test("each new trigger runs its batch exactly once", async () => {
  const d = deps();
  const before = await coreDump();
  const talker = await user(d, "talker");
  const crisis = await user(d, "crisis");
  const writer = await user(d, "writer");

  await session(talker, 3, 45);
  await getTestDb()
    .update(relationship)
    .set({ crisis_quiet_until: new Date(now.getTime() - 10 * MIN) })
    .where(eq(relationship.user_id, crisis));
  await dueThread(d, writer);

  await userMindTick(d, now);
  await userMindTick(d, now);
  expect(await outreachTickUser(d, writer, now)).toBe("scheduled");
  await drain(d);
  await userMindTick(d, now);
  await drain(d);

  const runs = (
    await getTestDb().execute(
      sql`SELECT user_id, source_ref, status FROM user_mind_run ORDER BY source_ref`,
    )
  ).rows;
  expect(runs.map((r) => [r.user_id, String(r.source_ref).split(":")[0], r.status])).toEqual([
    [crisis, "crisis_passed", "done"],
    [talker, "long_conversation", "done"],
    [writer, "stale_summary", "done"],
  ]);
  // The talker's run has new memories (all five loops); the other two have nothing unread, so
  // they take stock without reflect or ideate.
  expect(await count("user_loop_trace")).toBe(11);
  expect(await coreDump()).toBe(before);
});

test("an idle user runs no loop", async () => {
  const d = deps();
  await user(d, "idle");
  await userMindTick(d, now);
  await userMindTick(d, new Date(now.getTime() + HOUR));
  await drain(d);
  expect(await count("user_mind_run")).toBe(0);
  expect(d.llm.structuredCalls).toHaveLength(0);
});

test("once the window has passed, a crisis reaches no note of hers, no reach-out, user or core", async () => {
  const d = deps();
  const before = await coreDump();
  const alice = await user(d, "alice");
  const bob = await user(d, "bob");
  // The fake summary echoes the token when it read it, so a leak downstream would show.
  d.llm.handlers.user_summarise = (input: string) => ({
    where_things_stand: input.includes(TOKEN) ? `They told me ${TOKEN}.` : "Fine.",
    whats_live: "L.",
    how_i_feel: "F.",
  });
  await insertFact(d.db, alice, {
    subject: "user",
    kind: "feeling",
    content: `${TOKEN} they felt hopeless`,
    embedding: vec(),
    created_at: new Date(now.getTime() - 30 * HOUR),
    status: "open",
    salience: 0.9,
    valence: -0.9,
    confidence: 0.9,
    source: "turn",
    payload: { sensitive: true },
  });
  await getTestDb()
    .update(relationship)
    .set({ crisis_quiet_until: new Date(now.getTime() - 10 * MIN) })
    .where(eq(relationship.user_id, alice));
  await session(bob, 3, 45);

  await userMindTick(d, now);
  await drain(d);

  const calls = (p: string) => d.llm.structuredCalls.filter((c) => c.purpose === p);
  // The run after the window is clean: no loop reads the crisis. Neither user has anything else
  // unread (the fake extractor stores nothing), so neither ideates.
  expect(calls("user_summarise")).toHaveLength(2);
  for (const c of calls("user_summarise")) expect(c.input).not.toContain(TOKEN);
  expect(calls("user_ideate")).toHaveLength(0);
  for (const c of calls("user_ideate")) expect(c.input).not.toContain(TOKEN);

  // Alice's reach-out never carries it.
  await dueThread(d, alice);
  const later = new Date(now.getTime() + HOUR);
  d.clock.set(later);
  const seenReplies = d.llm.calls.length;
  const seenStructured = d.llm.structuredCalls.length;
  expect(await outreachTickUser(d, alice, later)).toBe("scheduled");
  for (const job of d.queue.drain((j) => j.name === REACH_OUT_SEND_QUEUE))
    if (job.name === REACH_OUT_SEND_QUEUE) expect(await runReachOutSend(d, job.data)).toBe("sent");
  const sendCalls = [
    ...d.llm.calls.slice(seenReplies),
    ...d.llm.structuredCalls.slice(seenStructured),
  ];
  expect(d.llm.calls.length).toBeGreaterThan(seenReplies);
  for (const c of sendCalls) expect(JSON.stringify(c)).not.toContain(TOKEN);
  const sent = (await listTurns(d.db, alice)).filter((t) => t.trigger === "reach_out");
  expect(sent).toHaveLength(1);
  expect(sent[0]!.text).not.toContain(TOKEN);

  // Bob's stored rows never carry it; core is unchanged.
  for (const table of ["fact", "user_loop_trace", "user_mind_run"]) {
    const rows = (
      await getTestDb().execute(
        sql.raw(`SELECT row_to_json(x)::text AS j FROM ${table} x WHERE x.user_id = '${bob}'`),
      )
    ).rows;
    for (const r of rows) expect(String(r.j), table).not.toContain(TOKEN);
  }
  expect(await coreDump()).toBe(before);
});
