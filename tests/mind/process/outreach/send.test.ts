import { afterAll, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runReachOutSend } from "@/mind/process/outreach/send";
import { COLD_PATH_QUEUE } from "@/mind/platform/jobs";
import { getState } from "@/db/repos/user/conversation-state";
import { getReachOutLog, insertReachOutLog } from "@/db/repos/user/reach-out";
import { ensureRelationship, getRelationshipRow } from "@/db/repos/user/relationship";
import { insertTurn, listTurns } from "@/db/repos/user/session-log";
import { conversation_state, reach_out_log, relationship } from "@/db/schema";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { coreDepsOf } from "@/mind/platform/deps";
import { closeTestDb, createTestUser, resetDb } from "../../../helpers/db";
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

async function setup(opts: { history?: boolean; sendAt?: Date } = {}) {
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
  const logId = await insertReachOutLog(deps.db, u, {
    candidates: [winner],
    winner,
    gate_results: [],
    status: "scheduled",
    topic: winner.topic,
    send_at: opts.sendAt ?? now,
    created_at: now,
  });
  return { deps, u, logId };
}

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
