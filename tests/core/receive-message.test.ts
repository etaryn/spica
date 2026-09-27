import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { ConflictError, InputError, ReplyFailedError } from "@/core/errors";
import { TURN_BACKCHANNEL_QUEUE, TURN_TIMER_QUEUE } from "@/core/queue";
import { receiveMessage } from "@/core/turn/receive-message";
import { getState } from "@/db/repos/conversation-state";
import { listJudgeLogs } from "@/db/repos/judge-log";
import { insertTurn, listTurns } from "@/db/repos/session-log";
import { getTimezone } from "@/db/repos/users";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const msg = (text: string, id = randomUUID()) => ({ clientMessageId: id, text });
const timers = (deps: ReturnType<typeof makeTestDeps>) => deps.queue.jobs.filter((j) => j.name === TURN_TIMER_QUEUE);

describe("receiveMessage", () => {
  test("a complete message is buffered, judged once, and a timer is set for the settle window", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const input = msg("what should I cook tonight?");
    expect(await receiveMessage(deps, u, input)).toEqual({ status: "accepted" });
    const s = (await getState(getTestDb(), u))!;
    expect(s.buffer_turn_ids).toEqual([input.clientMessageId]);
    expect(s.open_questions).toEqual([{ turn_id: input.clientMessageId, text: "what should I cook tonight?" }]);
    expect(timers(deps)).toEqual([{ name: TURN_TIMER_QUEUE, data: { userId: u, version: 1 }, startAfter: new Date(deps.clock.now().getTime() + 4000) }]);
    expect(deps.llm.calls).toHaveLength(0); // no reply generated in the POST
    const logs = await listJudgeLogs(getTestDb(), u);
    expect(logs.map((l) => [l.kind, l.turn_id])).toEqual([["turn", input.clientMessageId]]);
  });

  test("an incomplete message waits longer; a burst keeps one buffer with a capped wait", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("ok so today was insane and"));
    expect(timers(deps).at(-1)!.startAfter).toEqual(new Date(deps.clock.now().getTime() + 12000));
    for (let i = 0; i < 5; i++) { deps.clock.advance(10_000); await receiveMessage(deps, u, msg("and then")); }
    const s = (await getState(getTestDb(), u))!;
    expect(s.buffer_turn_ids).toHaveLength(6);
    expect(timers(deps).at(-1)!.startAfter).toEqual(new Date(s.buffer_started_at!.getTime() + 40000));
  });

  test("backchannel: the judge's reaction is scheduled once per buffer, never on a complete verdict, never when silent", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    deps.llm.handlers.turn_judge = () => ({ reasoning: "mid-story", complete: false, open_questions: [], backchannel: "huh" });
    await receiveMessage(deps, u, msg("my boss called me in"));
    await receiveMessage(deps, u, msg("and I thought I was getting fired"));
    const bcs = deps.queue.jobs.filter((j) => j.name === TURN_BACKCHANNEL_QUEUE);
    expect(bcs).toHaveLength(2); // both scheduled; the transition lets only the first send (Task 8)
    expect(bcs[0]).toMatchObject({ data: { userId: u, text: "huh" }, startAfter: new Date(deps.clock.now().getTime() + 1500) });

    const silent = makeTestDeps({ turn: { backchannel_style: "silent" } });
    silent.llm.handlers.turn_judge = deps.llm.handlers.turn_judge;
    const v = await createTestUser("v");
    await receiveMessage(silent, v, msg("my boss called me in"));
    expect(silent.queue.jobs.filter((j) => j.name === TURN_BACKCHANNEL_QUEUE)).toEqual([]);
  });

  test("crisis: reply is sent immediately in the response with the card, the buffer is snapshotted, timers go stale", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("today was rough and"));
    deps.llm.classify = () => ({ flag: true, category: "self_harm" });
    deps.llm.replies.push("I'm really glad you told me.\n\nPlease reach out to 988.");
    const crisisMsg = msg("i want to end my life");
    const r = await receiveMessage(deps, u, crisisMsg);
    expect(r).toMatchObject({ status: "replied", parts: ["I'm really glad you told me.", "Please reach out to 988."] });
    expect((r as { crisisCard: unknown }).crisisCard).not.toBeNull();
    const turns = await listTurns(getTestDb(), u);
    const reply = turns.find((t) => t.role === "companion")!;
    expect(reply.reply_to).toBe(crisisMsg.clientMessageId);
    expect(reply.safety_flag?.flagged).toBe(true);
    const s = (await getState(getTestDb(), u))!;
    expect(s).toMatchObject({ buffer_turn_ids: [], inflight_turn_ids: [], reply_epoch: 1 });
    expect(deps.events.events.map((e) => e.event)).toEqual([{ type: "message", turnId: reply.id, part: 0 }, { type: "message", turnId: reply.id, part: 1 }]);
    expect(deps.queue.jobs.find((j) => j.name === "cold_path")!.data).toMatchObject({ turnIds: [turns[0]!.id, crisisMsg.clientMessageId, reply.id] });
    expect(deps.queue.jobs.filter((j) => j.name === TURN_BACKCHANNEL_QUEUE)).toEqual([]);
  });

  test("a retried crisis message returns the stored reply with its card, not a bare 202 (rule 7 outranks design §5.1's answered → 202)", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    deps.llm.classify = () => ({ flag: true, category: "self_harm" });
    deps.llm.replies.push("I'm really glad you told me.");
    const crisisMsg = msg("i want to end my life");
    const first = await receiveMessage(deps, u, crisisMsg);
    expect(first).toMatchObject({ status: "replied" });
    const structuredCallsBefore = deps.llm.structuredCalls.length;
    const repliesBefore = deps.llm.calls.length;

    const second = await receiveMessage(deps, u, crisisMsg);
    expect(second).toEqual(first); // same turnId/text/parts/crisisCard
    expect((second as { crisisCard: unknown }).crisisCard).not.toBeNull();
    expect(deps.llm.structuredCalls.length).toBe(structuredCallsBefore); // no new crisis/judge/guard call
    expect(deps.llm.calls.length).toBe(repliesBefore); // no new reply generation
  });

  test("concurrent double submit of a crisis message yields exactly one companion reply", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    deps.llm.classify = () => ({ flag: true, category: "self_harm" });
    deps.llm.replyDelayMs = 20;
    const crisisMsg = msg("i want to end my life");
    const [x, y] = await Promise.all([receiveMessage(deps, u, crisisMsg), receiveMessage(deps, u, crisisMsg)]);
    expect(x).toMatchObject({ status: "replied" });
    expect(x).toEqual(y); // same turnId/text/parts/crisisCard
    const turns = await listTurns(getTestDb(), u);
    expect(turns.filter((t) => t.role === "companion")).toHaveLength(1);
    expect(deps.queue.jobs.filter((j) => j.name === "cold_path")).toHaveLength(1);
  });

  test("crisis + generation failure: ReplyFailedError still carries the card", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    deps.llm.classify = () => ({ flag: true, category: "self_harm" });
    deps.llm.failReplies = 1;
    const e = await receiveMessage(deps, u, msg("i want to end my life")).catch((x) => x);
    expect(e).toBeInstanceOf(ReplyFailedError);
    expect((e as ReplyFailedError).crisisCard).not.toBeNull();
  });

  test("retry semantics: buffered, in-flight or answered → accepted with no judge call; failed → re-buffered", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const input = msg("hello there friend");
    await receiveMessage(deps, u, input);
    const judged = () => deps.llm.structuredCalls.filter((c) => c.purpose === "turn_judge").length;
    expect(judged()).toBe(1);
    expect(await receiveMessage(deps, u, input)).toEqual({ status: "accepted" }); // buffered
    expect(judged()).toBe(1);

    // Simulate a failed reply: the turn is neither buffered, in flight nor answered.
    const db = getTestDb();
    await db.execute(sql.raw(`UPDATE conversation_state SET buffer_turn_ids = '{}' WHERE user_id = '${u}'`));
    const before = timers(deps).length;
    expect(await receiveMessage(deps, u, input)).toEqual({ status: "accepted" });
    expect(judged()).toBe(1);
    expect((await getState(db, u))!.buffer_turn_ids).toEqual([input.clientMessageId]);
    expect(timers(deps).length).toBe(before + 1);

    // Answered: a companion reply to it exists.
    await insertTurn(db, u, { id: randomUUID(), session_id: (await listTurns(db, u))[0]!.session_id, role: "companion", text: "hey", created_at: deps.clock.now(), reply_to: input.clientMessageId });
    await db.execute(sql.raw(`UPDATE conversation_state SET buffer_turn_ids = '{}' WHERE user_id = '${u}'`));
    const t = timers(deps).length;
    expect(await receiveMessage(deps, u, input)).toEqual({ status: "accepted" });
    expect(timers(deps).length).toBe(t);
    expect(judged()).toBe(1); // still no new judge call
  });

  test("a rebuffer that races a concurrent process into inflight is not re-buffered (fix 3c)", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const input = msg("hello there friend");
    await receiveMessage(deps, u, input); // first attempt: buffers it, schedules one timer
    const db = getTestDb();
    // Simulate its reply attempt failing (dropped from the buffer, as in the "failed → re-buffered" case above).
    await db.execute(sql.raw(`UPDATE conversation_state SET buffer_turn_ids = '{}' WHERE user_id = '${u}'`));

    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    deps.llm.classify = async () => {
      // The outside buffered/inflight/answered check has already run (and seen none of them) by the time this
      // fires. Move the turn into "inflight" here, as if the (not-yet-built) turn_timer job had picked it up
      // in the gap between that outside check and the append under the lock.
      await db.execute(sql.raw(`UPDATE conversation_state SET inflight_turn_ids = ARRAY['${input.clientMessageId}']::uuid[], inflight_since = now() WHERE user_id = '${u}'`));
      await gate;
      return { flag: false, category: "none" };
    };

    const before = timers(deps).length;
    const p = receiveMessage(deps, u, input);
    await new Promise((r) => setTimeout(r, 20));
    releaseGate();
    expect(await p).toEqual({ status: "accepted" });

    const s = (await getState(db, u))!;
    expect(s.buffer_turn_ids).toEqual([]); // not re-buffered
    expect(s.inflight_turn_ids).toEqual([input.clientMessageId]); // left exactly as the race set it
    expect(timers(deps).length).toBe(before); // no new timer scheduled for an already-inflight turn
  });

  test("input validation, cross-user ids and timezone", async () => {
    const deps = makeTestDeps();
    const [a, b] = [await createTestUser("a"), await createTestUser("b")];
    await expect(receiveMessage(deps, a, msg("   "))).rejects.toBeInstanceOf(InputError);
    await expect(receiveMessage(deps, a, msg("x".repeat(deps.config.chat.max_message_chars + 1)))).rejects.toBeInstanceOf(InputError);
    expect(await listTurns(getTestDb(), a)).toEqual([]); // invalid input stores no turn
    const shared = msg("mine");
    await receiveMessage(deps, a, shared);
    await expect(receiveMessage(deps, b, shared)).rejects.toBeInstanceOf(ConflictError);
    const aTurns = await listTurns(getTestDb(), a);
    expect(aTurns).toHaveLength(1);
    expect(aTurns[0]!.text).toBe("mine"); // a's turn is untouched by b's conflicting attempt
    expect(await listTurns(getTestDb(), b)).toEqual([]); // b has no turns
    await receiveMessage(deps, a, { ...msg("tz"), timezone: "Europe/London" });
    expect(await getTimezone(getTestDb(), a)).toBe("Europe/London");
    await receiveMessage(deps, a, { ...msg("tz2"), timezone: "Not/AZone" });
    expect(await getTimezone(getTestDb(), a)).toBe("Europe/London");
  });

  test("a failed timer enqueue never fails the POST (the turn sweep recovers it)", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    deps.queue.failNext = true;
    expect(await receiveMessage(deps, u, msg("hello there friend"))).toEqual({ status: "accepted" });
    expect((await getState(getTestDb(), u))!.buffer_turn_ids).toHaveLength(1);
  });

  test("a hung timer enqueue cannot delay the POST past queue.enqueue_timeout_ms", async () => {
    const base = makeTestDeps({ queue: { enqueue_timeout_ms: 50 } });
    const deps = { ...base, queue: { enqueue: () => new Promise<void>(() => {}) } };
    const u = await createTestUser();
    const started = Date.now();
    await expect(receiveMessage(deps, u, msg("hi"))).resolves.toEqual({ status: "accepted" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("the crisis classifier sees recent context, not just the latest message", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("everything is falling apart"));
    deps.clock.advance(5000);
    await receiveMessage(deps, u, msg("i can't do this anymore"));
    const crisisInput = deps.llm.structuredCalls.filter((c) => c.purpose === "crisis").at(-1)!.input;
    expect(crisisInput).toContain("everything is falling apart");
  });
});
