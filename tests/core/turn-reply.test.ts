import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { TURN_TIMER_QUEUE, type TurnTimerJob } from "@/core/queue";
import { receiveMessage } from "@/core/turn/receive-message";
import { runBackchannel, runTurnTimer } from "@/core/turn/reply";
import { getState } from "@/db/repos/conversation-state";
import { listTurns } from "@/db/repos/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
type D = ReturnType<typeof makeTestDeps>;
const msg = (text: string) => ({ clientMessageId: randomUUID(), text });
const lastTimer = (deps: D) => deps.queue.jobs.filter((j) => j.name === TURN_TIMER_QUEUE).at(-1)!.data as TurnTimerJob;

describe("runTurnTimer", () => {
  test("one reply answers the whole buffer: paced timeline, typing events, reply_to = last turn, cold path gets every turn", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const ids = [];
    for (const t of ["ok so today was insane", "my boss called me in", "turns out it was a promotion lol"]) {
      const m = msg(t); ids.push(m.clientMessageId);
      await receiveMessage(deps, u, m);
      deps.clock.advance(2000);
    }
    deps.llm.replies.push("WAIT.\n\npromotion?? tell me everything");
    const commitAt = deps.clock.now().getTime();
    expect(await runTurnTimer(deps, lastTimer(deps))).toBe("sent");

    const turns = await listTurns(getTestDb(), u);
    const reply = turns.find((t) => t.role === "companion")!;
    expect(reply.reply_to).toBe(ids[2]);
    expect(reply.trigger).toBeNull();
    // read delay (≥ 1500) + typing for the first bubble ("WAIT." = 5 chars × 40ms)
    expect(reply.created_at.getTime() - commitAt).toBeGreaterThanOrEqual(1500 + 200);
    expect(deps.events.events.map((e) => e.event)).toEqual([
      { type: "typing", on: true },
      { type: "message", turnId: reply.id, part: 0 },
      { type: "message", turnId: reply.id, part: 1 },
      { type: "typing", on: false },
    ]);
    expect(deps.queue.jobs.find((j) => j.name === "cold_path")!.data).toMatchObject({ turnIds: [...ids, reply.id], replyTurnId: reply.id });
    expect((await getState(getTestDb(), u))!).toMatchObject({ buffer_turn_ids: [], inflight_turn_ids: [] });
  });

  test("a stale timer (a newer message arrived) does nothing", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("what should I cook tonight?"));
    const first = lastTimer(deps);
    deps.clock.advance(2000);
    await receiveMessage(deps, u, msg("nvm I'll just order pizza"));
    expect(await runTurnTimer(deps, first)).toBe("stale");
    expect(deps.llm.calls).toHaveLength(0);
    expect(await runTurnTimer(deps, lastTimer(deps))).toBe("sent");
    expect((await listTurns(getTestDb(), u)).filter((t) => t.role === "companion")).toHaveLength(1);
  });

  test("a late message follows up after the in-flight reply (append-and-follow-up)", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("what should I cook tonight?"));
    const timer = lastTimer(deps);
    // While the first reply is generating, the user sends another message.
    const late = msg("nvm I'll just order pizza");
    deps.llm.replyHook = async () => { await receiveMessage(deps, u, late); };
    expect(await runTurnTimer(deps, timer)).toBe("sent");
    deps.llm.replyHook = undefined;
    // Its timer runs; the first reply is done, so it commits and follows up.
    expect(await runTurnTimer(deps, lastTimer(deps))).toBe("sent");
    const replies = (await listTurns(getTestDb(), u)).filter((t) => t.role === "companion");
    expect(replies).toHaveLength(2);
    expect(replies[0]!.reply_to).not.toBe(late.clientMessageId);
    expect(replies[1]!.reply_to).toBe(late.clientMessageId);
  });

  test("a timer that finds a reply still in flight reschedules itself instead of racing it", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("first thing here"));
    const db = getTestDb();
    await db.execute(sql.raw(`UPDATE conversation_state SET inflight_turn_ids = ARRAY['${randomUUID()}']::uuid[], inflight_since = '2026-01-05T09:00:00Z' WHERE user_id = '${u}'`));
    const job = lastTimer(deps);
    expect(await runTurnTimer(deps, job)).toBe("busy");
    const again = deps.queue.jobs.filter((j) => j.name === TURN_TIMER_QUEUE).at(-1)!;
    expect(again.data).toEqual(job);
    expect(again.startAfter).toEqual(new Date(deps.clock.now().getTime() + 1000));
  });

  test("a crisis reply abandons an in-flight paced reply: no further bubbles, no insert", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("lol nice pizza day"));
    const timer = lastTimer(deps);
    deps.llm.replyHook = async () => {
      deps.llm.replyHook = undefined;
      deps.llm.classify = () => ({ flag: true, category: "self_harm" });
      await receiveMessage(deps, u, msg("actually i want to end my life"));
    };
    expect(await runTurnTimer(deps, timer)).toBe("abandoned");
    const companions = (await listTurns(getTestDb(), u)).filter((t) => t.role === "companion");
    expect(companions).toHaveLength(1);
    expect(companions[0]!.safety_flag?.flagged).toBe(true);
  });

  test("generation failure: turns go back to the buffer and retry; after retry_limit, reply_failed is emitted", async () => {
    const deps = makeTestDeps({ turn: { retry_limit: 1 } });
    const u = await createTestUser();
    const m = msg("hello there friend");
    await receiveMessage(deps, u, m);
    deps.llm.failReplies = 5;
    expect(await runTurnTimer(deps, lastTimer(deps))).toBe("retry");
    expect((await getState(getTestDb(), u))!.buffer_turn_ids).toEqual([m.clientMessageId]);
    const retry = lastTimer(deps);
    expect(retry.attempt).toBe(1);
    expect(await runTurnTimer(deps, retry)).toBe("failed");
    expect((await getState(getTestDb(), u))!).toMatchObject({ buffer_turn_ids: [], inflight_turn_ids: [] });
    expect(deps.events.events.map((e) => e.event)).toContainEqual({ type: "reply_failed", turnIds: [m.clientMessageId] });
    // A client retry re-buffers it and it can then be answered.
    deps.llm.failReplies = 0;
    await receiveMessage(deps, u, m);
    expect(await runTurnTimer(deps, lastTimer(deps))).toBe("sent");
  });

  test("a failed cold-path enqueue never fails the reply", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("hello there friend"));
    const job = lastTimer(deps);
    const enqueue = deps.queue.enqueue.bind(deps.queue);
    deps.queue.enqueue = (async (name: string, ...rest: unknown[]) => {
      if (name === "cold_path") throw new Error("down");
      return (enqueue as (...a: unknown[]) => Promise<void>)(name, ...rest);
    }) as typeof deps.queue.enqueue;
    expect(await runTurnTimer(deps, job)).toBe("sent");
  });
});

describe("runBackchannel", () => {
  test("sends once per buffer, stored as a backchannel turn that is never extracted", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    deps.llm.handlers.turn_judge = () => ({ reasoning: "r", complete: false, open_questions: [], backchannel: "huh" });
    const m = msg("my boss called me in");
    await receiveMessage(deps, u, m);
    const version = (await getState(getTestDb(), u))!.buffer_version;
    expect(await runBackchannel(deps, { userId: u, version, text: "huh", turnId: m.clientMessageId })).toBe("sent");
    expect(await runBackchannel(deps, { userId: u, version, text: "huh", turnId: m.clientMessageId })).toBe("skipped");
    const bc = (await listTurns(getTestDb(), u)).find((t) => t.trigger === "backchannel")!;
    expect(bc).toMatchObject({ role: "companion", text: "huh", reply_to: null, extracted: true });
    expect(deps.events.events.at(-1)!.event).toEqual({ type: "message", turnId: bc.id, part: 0 });
  });

  test("a newer message makes it stale; a keyword hit drops it", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const m = msg("my boss called me in");
    await receiveMessage(deps, u, m);
    const version = (await getState(getTestDb(), u))!.buffer_version;
    await receiveMessage(deps, u, msg("and I thought I was getting fired"));
    expect(await runBackchannel(deps, { userId: u, version, text: "huh", turnId: m.clientMessageId })).toBe("skipped");
    const v2 = (await getState(getTestDb(), u))!.buffer_version;
    expect(await runBackchannel(deps, { userId: u, version: v2, text: "you owe me", turnId: m.clientMessageId })).toBe("dropped");
    expect((await listTurns(getTestDb(), u)).filter((t) => t.trigger === "backchannel")).toEqual([]);
  });
});
