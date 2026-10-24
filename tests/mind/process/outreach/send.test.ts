import { afterAll, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { runReachOutSend, winnerLive } from "@/mind/process/outreach/send";
import type { Candidate } from "@/mind/process/outreach/types";
import { COLD_PATH_QUEUE } from "@/mind/platform/jobs";
import { getFact, insertFact } from "@/db/repos/user/facts";
import { getState } from "@/db/repos/user/conversation-state";
import { getReachOutLog, insertReachOutLog, usedTopics } from "@/db/repos/user/reach-out";
import { ensureRelationship, getRelationshipRow } from "@/db/repos/user/relationship";
import { insertTurn, listTurns } from "@/db/repos/user/session-log";
import { conversation_state, fact, reach_out_log, relationship } from "@/db/schema";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { coreDepsOf } from "@/mind/platform/deps";
import { closeTestDb, createTestUser, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T15:30:00Z");
const winner = {
  kind: "thread",
  topic: "thread:t@x",
  text: "interview at Canva",
  strength: 1,
  score: 1,
  factId: null,
  threadId: "t",
  filtered: null,
};

async function setup(
  opts: {
    history?: boolean;
    sendAt?: Date;
    winner?: Record<string, unknown>;
    /** The winner is a user_idea for an open idea created at this time. */
    ideaAt?: Date;
  } = {},
) {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  deps.clock.set(now);
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, now, deps.config.relationship);
  if (opts.history !== false) {
    await insertTurn(deps.db, u, {
      id: randomUUID(),
      session_id: randomUUID(),
      role: "user",
      text: "wish me luck",
      created_at: new Date(now.getTime() - 86_400_000),
    });
  }
  const idea = opts.ideaAt
    ? await insertFact(deps.db, u, {
        subject: "shared",
        kind: "idea",
        content: "send her that old film",
        embedding: vec(),
        created_at: opts.ideaAt,
        stale_after: new Date(
          opts.ideaAt.getTime() + deps.config.user_mind.ideate.ttl_days * 86_400_000,
        ),
        status: "open",
        salience: 0.5,
        valence: 0,
        confidence: 0.6,
        source: "generated",
      })
    : null;
  const w = idea
    ? {
        ...winner,
        kind: "user_idea",
        topic: `idea:${idea.id}`,
        text: idea.content,
        factId: idea.id,
        threadId: null,
      }
    : (opts.winner ?? winner);
  const logId = await insertReachOutLog(deps.db, u, {
    candidates: [w],
    winner: w,
    gate_results: [],
    status: "scheduled",
    topic: w.topic as string,
    send_at: opts.sendAt ?? now,
    created_at: now,
  });
  return { deps, u, logId, ideaId: idea?.id ?? "", topic: w.topic as string };
}

const reachOuts = async (deps: ReturnType<typeof makeTestDeps>, u: string) =>
  (await listTurns(deps.db, u)).filter((t) => t.trigger === "reach_out");

test("sends: a reach_out turn, log sent with turn and time, counter +1, bubbles delivered and pushed, cold path queued", async () => {
  const { deps, u, logId } = await setup();
  deps.llm.replies.push("hey!! how did the interview go");
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("sent");
  const out = (await listTurns(deps.db, u)).filter((t) => t.trigger === "reach_out");
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ role: "companion", reply_to: null });
  const row = await getReachOutLog(deps.db, u, logId);
  expect(row).toMatchObject({ status: "sent", sent: true, turn_id: out[0]!.id });
  expect(row!.send_at!.getTime()).toBe(out[0]!.created_at.getTime());
  expect((await getRelationshipRow(deps.db, u))?.unanswered_reach_outs).toBe(1);
  expect(deps.pusher.pushes.every((p) => p.msg.tag === out[0]!.id)).toBe(true);
  expect(deps.pusher.pushes.length).toBeGreaterThan(0);
  expect(deps.events.events.map((e) => e.event.type)).toEqual(
    expect.arrayContaining(["typing", "message"]),
  );
  expect(deps.queue.jobs.find((j) => j.name === COLD_PATH_QUEUE)?.data).toMatchObject({
    userId: u,
    turnIds: [out[0]!.id],
    replyTurnId: out[0]!.id,
  });
  expect((await getState(deps.db, u))?.sending_since).toBeNull(); // released
});

test("the stored reach-out records which snapshot version it was written from", async () => {
  const { deps, u, logId } = await setup();
  await seedSnapshot(coreDepsOf(deps));
  deps.llm.replies.push("hey!!");
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("sent");
  const out = (await listTurns(deps.db, u)).filter((t) => t.trigger === "reach_out");
  expect(out[0]!.snapshot_version).toBe(0);
});

test("stale: a row that isn't scheduled any more is ignored", async () => {
  const { deps, u, logId } = await setup();
  await runReachOutSend(deps, { userId: u, logId });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("stale");
  expect((await listTurns(deps.db, u)).filter((t) => t.trigger === "reach_out")).toHaveLength(1);
});

test("a job that runs far too late is dropped, nothing composed or typed", async () => {
  const { deps, u, logId } = await setup({ sendAt: new Date(now.getTime() - 3 * 3_600_000) });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  const row = await getReachOutLog(deps.db, u, logId);
  expect(row?.status).toBe("dropped");
  expect(row?.gate_results).toMatchObject({ dropped: "late" });
  expect((await listTurns(deps.db, u)).some((t) => t.trigger === "reach_out")).toBe(false);
  expect(deps.events.events).toEqual([]);
});

test("I3: the buffer is non-empty at job start → dropped by the precheck: zero events, no LLM call, nothing sent", async () => {
  const { deps, u, logId } = await setup();
  await deps.db
    .insert(conversation_state)
    .values({ user_id: u, updated_at: now, buffer_turn_ids: [randomUUID()] });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  const row = await getReachOutLog(deps.db, u, logId);
  expect(row?.status).toBe("dropped");
  const g = row!.gate_results as {
    dropped: string;
    recheck: {
      gate: { rule: string; pass: boolean }[];
      topicUsed: boolean;
      epochChanged: boolean;
      newTurn: boolean;
    };
  };
  expect(g.dropped).toBe("precheck");
  expect(g.recheck).toMatchObject({ topicUsed: false, epochChanged: false, newTurn: false });
  expect(g.recheck.gate).toContainEqual(
    expect.objectContaining({ rule: "in_progress", pass: false }),
  );
  expect((await listTurns(deps.db, u)).some((t) => t.trigger === "reach_out")).toBe(false);
  expect(deps.pusher.pushes).toEqual([]);
  expect(deps.events.events).toEqual([]);
  expect(deps.llm.calls).toEqual([]);
});

test("I3: the topic was already sent → dropped by the precheck with topicUsed, zero events", async () => {
  const { deps, u, logId } = await setup();
  await insertReachOutLog(deps.db, u, {
    candidates: [],
    winner: null,
    gate_results: [],
    status: "sent",
    topic: winner.topic,
    send_at: new Date(now.getTime() - 8 * 86_400_000),
    created_at: now,
  });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  const g = (await getReachOutLog(deps.db, u, logId))!.gate_results as {
    dropped: string;
    recheck: { topicUsed: boolean };
  };
  expect(g).toMatchObject({ dropped: "precheck", recheck: { topicUsed: true } });
  expect(deps.events.events).toEqual([]);
  expect(deps.llm.calls).toEqual([]);
});

test("review focus 1: the user wrote during typing (buffer filled) → the locked recheck drops it, nothing sent", async () => {
  const { deps, u, logId } = await setup();
  onFirstSleep(deps, async () => {
    await deps.db
      .insert(conversation_state)
      .values({ user_id: u, updated_at: now, buffer_turn_ids: [randomUUID()] })
      .onConflictDoUpdate({
        target: conversation_state.user_id,
        set: { buffer_turn_ids: [randomUUID()] },
      });
  });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  const row = await getReachOutLog(deps.db, u, logId);
  expect(row?.status).toBe("dropped");
  expect(row!.gate_results).toMatchObject({ dropped: "recheck" });
  expect((await listTurns(deps.db, u)).some((t) => t.trigger === "reach_out")).toBe(false);
  expect(deps.pusher.pushes).toEqual([]);
  expect(deps.events.events.at(-1)?.event).toEqual({ type: "typing", on: false });
});

test("M1: a duplicate delivery whose row was sent meanwhile never turns sent into dropped", async () => {
  const { deps, u, logId } = await setup();
  onFirstSleep(deps, async () => {
    await deps.db
      .update(reach_out_log)
      .set({ status: "sent", sent: true, send_at: now })
      .where(eq(reach_out_log.id, logId));
  });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("stale");
  expect(await getReachOutLog(deps.db, u, logId)).toMatchObject({
    status: "sent",
    sent: true,
    gate_results: [],
  });
  expect((await listTurns(deps.db, u)).some((t) => t.trigger === "reach_out")).toBe(false);
});

test("a cap filled or a crisis started since scheduling → dropped", async () => {
  const { deps, u, logId } = await setup();
  await deps.db
    .update(relationship)
    .set({ crisis_quiet_until: new Date(now.getTime() + 3_600_000) })
    .where(eq(relationship.user_id, u));
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
});

test("review focus 2: a crisis mid-send stops later bubbles and releases sending_since", async () => {
  const { deps, u, logId } = await setup();
  deps.llm.replies.push("hey\n\nhow did it go?\n\nwas thinking of you");
  let bumped = false;
  const orig = deps.clock.sleep.bind(deps.clock);
  deps.clock.sleep = async (ms: number) => {
    await orig(ms);
    const s = await getState(deps.db, u);
    if (!bumped && s?.sending_since) {
      bumped = true;
      await deps.db
        .update(conversation_state)
        .set({ reply_epoch: s.reply_epoch + 1, sending_since: null })
        .where(eq(conversation_state.user_id, u));
    }
  };
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("abandoned");
  const parts = deps.events.events.filter((e) => e.event.type === "message");
  expect(parts.length).toBeLessThan(3);
  expect(deps.events.events.at(-1)?.event).toEqual({ type: "typing", on: false });
});

function onFirstSleep(deps: ReturnType<typeof makeTestDeps>, act: () => Promise<void>) {
  let done = false;
  const orig = deps.clock.sleep.bind(deps.clock);
  deps.clock.sleep = async (ms: number) => {
    await orig(ms);
    if (!done) {
      done = true;
      await act();
    }
  };
}

test("R7a: a crisis epoch bump during the typing sleep (before insert) → dropped, epochChanged", async () => {
  const { deps, u, logId } = await setup();
  onFirstSleep(deps, async () => {
    await deps.db
      .insert(conversation_state)
      .values({ user_id: u, updated_at: now, reply_epoch: 1 })
      .onConflictDoUpdate({ target: conversation_state.user_id, set: { reply_epoch: 1 } });
  });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  const row = await getReachOutLog(deps.db, u, logId);
  expect((row!.gate_results as { recheck: { epochChanged: boolean } }).recheck.epochChanged).toBe(
    true,
  );
  expect((await listTurns(deps.db, u)).some((t) => t.trigger === "reach_out")).toBe(false);
  expect(deps.pusher.pushes).toEqual([]);
  expect(deps.events.events.at(-1)?.event).toEqual({ type: "typing", on: false });
});

test("R7b: a user turn stored (not yet buffered) during the typing sleep → dropped, newTurn", async () => {
  const { deps, u, logId } = await setup();
  onFirstSleep(deps, async () => {
    await insertTurn(deps.db, u, {
      id: randomUUID(),
      session_id: randomUUID(),
      role: "user",
      text: "hi",
      created_at: new Date(now.getTime() + 1000),
    });
  });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  const row = await getReachOutLog(deps.db, u, logId);
  expect((row!.gate_results as { recheck: { newTurn: boolean } }).recheck.newTurn).toBe(true);
  expect((await listTurns(deps.db, u)).some((t) => t.trigger === "reach_out")).toBe(false);
  expect(deps.pusher.pushes).toEqual([]);
});

const crisisFlag = { flagged: true, category: "self_harm" as const, source: "classifier" as const };

test("I2: a flagged crisis reply with no cold path yet (crisis_quiet_until null) → dropped, crisis failing", async () => {
  const { deps, u, logId } = await setup();
  await insertTurn(deps.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "companion",
    text: "I'm here",
    created_at: new Date(now.getTime() - 600_000),
    safety_flag: crisisFlag,
  });
  expect((await getRelationshipRow(deps.db, u))?.crisis_quiet_until).toBeNull();
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  const row = await getReachOutLog(deps.db, u, logId);
  const g = row!.gate_results as { recheck: { gate: { rule: string; pass: boolean }[] } };
  expect(g.recheck.gate).toContainEqual(expect.objectContaining({ rule: "crisis", pass: false }));
  expect((await listTurns(deps.db, u)).some((t) => t.trigger === "reach_out")).toBe(false);
});

test("I2: a crisis reply stored during the typing sleep → the locked recheck fails crisis", async () => {
  const { deps, u, logId } = await setup();
  onFirstSleep(deps, async () => {
    await insertTurn(deps.db, u, {
      id: randomUUID(),
      session_id: randomUUID(),
      role: "companion",
      text: "I'm here",
      created_at: new Date(now.getTime() + 1000),
      safety_flag: crisisFlag,
    });
  });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  const row = await getReachOutLog(deps.db, u, logId);
  const g = row!.gate_results as {
    dropped: string;
    recheck: { gate: { rule: string; pass: boolean }[] };
  };
  expect(g.dropped).toBe("recheck");
  expect(g.recheck.gate).toContainEqual(expect.objectContaining({ rule: "crisis", pass: false }));
  expect(deps.pusher.pushes).toEqual([]);
});

test("review focus 5: no stored turns → dropped no_history", async () => {
  const { deps, u, logId } = await setup({ history: false });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  expect((await getReachOutLog(deps.db, u, logId))?.gate_results).toMatchObject({
    dropped: "no_history",
  });
});

test("compose failure → dropped compose_failed, nothing sent", async () => {
  const { deps, u, logId } = await setup();
  deps.llm.failReplies = 1;
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  expect((await getReachOutLog(deps.db, u, logId))?.gate_results).toMatchObject({
    dropped: "compose_failed",
  });
});

test("the guard finds the day wrong → dropped wrong_day, guard logged, nothing sent", async () => {
  const { deps, u, logId } = await setup();
  deps.llm.handlers.guard = () => ({
    reasoning: "asks how it went before it happened",
    violations: [{ category: "wrong_day", claim: "how'd it go" }],
  });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  expect((await getReachOutLog(deps.db, u, logId))?.gate_results).toMatchObject({
    dropped: "wrong_day",
  });
  expect(await reachOuts(deps, u)).toHaveLength(0);
  const logged = await deps.db.execute(sql`SELECT outcome FROM judge_log`);
  expect(logged.rows).toEqual([{ outcome: "dropped" }]);
});

test("a winning idea is resolved with the send, and its topic is used", async () => {
  const { deps, u, logId, ideaId, topic } = await setup({ ideaAt: now });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("sent");
  expect((await getFact(deps.db, u, ideaId))!.status).toBe("resolved");
  expect(await usedTopics(deps.db, u)).toContain(topic);
});

test("a dropped reach-out leaves the idea live", async () => {
  const { deps, u, logId, ideaId } = await setup({ ideaAt: now, history: false });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped"); // no history
  expect((await getFact(deps.db, u, ideaId))!.status).toBe("open");
});

test("an idea a reply offered during typing → the locked recheck drops it, nothing sent", async () => {
  const { deps, u, logId, ideaId } = await setup({ ideaAt: now });
  onFirstSleep(deps, async () => {
    await deps.db.update(fact).set({ status: "resolved" }).where(eq(fact.id, ideaId));
  });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  expect((await getReachOutLog(deps.db, u, logId))!.gate_results).toMatchObject({
    dropped: "recheck",
    recheck: { topicUsed: true },
  });
  expect(await reachOuts(deps, u)).toEqual([]);
  expect(deps.pusher.pushes).toEqual([]);
});

test("an idea the user deleted since the tick → dropped by the precheck, no typing", async () => {
  const { deps, u, logId, ideaId } = await setup({ ideaAt: now });
  await deps.db.delete(fact).where(eq(fact.id, ideaId));
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  expect((await getReachOutLog(deps.db, u, logId))!.gate_results).toMatchObject({
    dropped: "precheck",
    recheck: { topicUsed: true },
  });
  expect(await reachOuts(deps, u)).toEqual([]);
  expect(deps.events.events).toEqual([]);
  expect(deps.llm.calls).toEqual([]);
});

test("an idea past its chance → dropped, left as it was", async () => {
  const ttl = makeTestDeps().config.user_mind.ideate.ttl_days;
  const { deps, u, logId, ideaId } = await setup({
    ideaAt: new Date(now.getTime() - (ttl + 1) * 86_400_000),
  });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  expect(await reachOuts(deps, u)).toEqual([]);
  expect((await getFact(deps.db, u, ideaId))!.status).toBe("open");
});

test("a drop at the locked recheck for another reason leaves the idea open", async () => {
  const { deps, u, logId, ideaId } = await setup({ ideaAt: now });
  onFirstSleep(deps, async () => {
    await insertTurn(deps.db, u, {
      id: randomUUID(),
      session_id: randomUUID(),
      role: "user",
      text: "hi",
      created_at: new Date(now.getTime() + 1000),
    });
  });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  expect((await getReachOutLog(deps.db, u, logId))!.gate_results).toMatchObject({
    dropped: "recheck",
    recheck: { newTurn: true, topicUsed: false },
  });
  expect((await getFact(deps.db, u, ideaId))!.status).toBe("open");
});

const makeUp = { ...winner, kind: "make_up", topic: "make_up:x", text: "sorry", threadId: null };

test("a make-up reach-out moves the make-up from due to offered", async () => {
  const { deps, u, logId } = await setup({ winner: makeUp });
  await deps.db.execute(sql`UPDATE relationship SET make_up_state = 'due' WHERE user_id = ${u}`);
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("sent");
  expect((await getRelationshipRow(deps.db, u))!.make_up_state).toBe("offered");
});

test("a make-up a reply already offered → dropped, nothing sent", async () => {
  const { deps, u, logId } = await setup({ winner: makeUp });
  await deps.db.execute(
    sql`UPDATE relationship SET make_up_state = 'offered' WHERE user_id = ${u}`,
  );
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  expect((await getReachOutLog(deps.db, u, logId))!.gate_results).toMatchObject({
    dropped: "precheck",
    recheck: { topicUsed: true },
  });
  expect(await reachOuts(deps, u)).toEqual([]);
  expect(deps.events.events).toEqual([]);
});

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

test("an anticipation whose plan has started by send time is dropped", async () => {
  const core = makeTestDeps().core.memory;
  const memory = (kind: "intention" | "thought", content: string, payload: unknown) =>
    core.insert({
      kind,
      content,
      payload,
      embedding: vec(),
      occurred_at: new Date(now.getTime() - 3_600_000),
      created_at: new Date(now.getTime() - 3_600_000),
      status: "open",
      salience: 0.4,
      valence: 0,
      confidence: 1,
      source: "loop",
      source_ref: null,
    });
  const plan = await memory("intention", "Gig at 15:00.", {
    event_at: new Date(now.getTime() - 30 * 60_000).toISOString(),
  });
  const thought = await memory("thought", "Can't wait for the gig.", { anticipates: plan });
  const { deps, u, logId } = await setup({
    winner: {
      ...winner,
      kind: "core_thought",
      topic: `core:${thought}`,
      text: "Can't wait for the gig.",
      threadId: null,
      coreMemoryId: thought,
    },
  });
  expect(await runReachOutSend(deps, { userId: u, logId })).toBe("dropped");
  expect(await reachOuts(deps, u)).toEqual([]);
});
