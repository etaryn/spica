import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { SimClock } from "@/mind/platform/clock";
import { RecordingEventBus, type ChatEvent } from "@/mind/platform/events";
import * as guardOutgoingModule from "@/mind/process/guard/outgoing";
import { TURN_TIMER_QUEUE, type TurnTimerJob } from "@/mind/platform/jobs";
import { receiveMessage } from "@/mind/process/turn-taking/receive-message";
import { runBackchannel, runTurnTimer } from "@/mind/process/turn-taking/commit-and-reply";
import { getState } from "@/db/repos/user/conversation-state";
import { getTurnsByIds, insertTurn, listTurns } from "@/db/repos/user/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
type D = ReturnType<typeof makeTestDeps>;
const msg = (text: string) => ({ clientMessageId: randomUUID(), text });

/** Records events like RecordingEventBus, but can run a hook synchronously inside publish — a seam for
 * driving a second, "concurrent" action (e.g. a crisis reply) at an exact point in an in-flight send. */
class HookedEventBus extends RecordingEventBus {
  hook: ((e: ChatEvent) => Promise<void>) | undefined;
  override async publish(userId: string, event: ChatEvent): Promise<void> {
    await super.publish(userId, event);
    if (this.hook) await this.hook(event);
  }
}

/** Like SimClock, but can run a hook on one specific `sleep` call (counted from 1) — a seam for driving a
 * "concurrent" action (e.g. a crisis reply) during a specific pacing wait, not just at an emitted event. */
class HookedClock extends SimClock {
  calls = 0;
  hookAtCall: number | null = null;
  hook: (() => Promise<void>) | undefined;
  override async sleep(ms: number): Promise<void> {
    this.calls += 1;
    if (this.calls === this.hookAtCall && this.hook) {
      const h = this.hook;
      this.hook = undefined;
      this.advance(ms); // the wait itself still elapses...
      await h(); // ...and something else happens during it, before we return
      return;
    }
    await super.sleep(ms);
  }
}
const lastTimer = (deps: D) =>
  deps.queue.jobs.filter((j) => j.name === TURN_TIMER_QUEUE).at(-1)!.data as TurnTimerJob;

describe("runTurnTimer", () => {
  test("the reply sees an open question in the user's own words", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("should I take the job in leeds?"));
    await runTurnTimer(deps, lastTimer(deps));
    expect(deps.llm.calls.at(-1)!.system).toContain("- should I take the job in leeds?");
  });

  test("one reply answers the whole buffer: paced timeline, typing events, reply_to = last turn, cold path gets every turn", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const ids = [];
    for (const t of [
      "ok so today was insane",
      "my boss called me in",
      "turns out it was a promotion lol",
    ]) {
      const m = msg(t);
      ids.push(m.clientMessageId);
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
    expect(deps.pusher.pushes.filter((p) => p.msg.tag === reply.id)).toHaveLength(2);
    expect(deps.queue.jobs.find((j) => j.name === "cold_path")!.data).toMatchObject({
      turnIds: [...ids, reply.id],
      replyTurnId: reply.id,
    });
    expect((await getState(getTestDb(), u))!).toMatchObject({
      buffer_turn_ids: [],
      inflight_turn_ids: [],
    });
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
    deps.llm.replyHook = async () => {
      await receiveMessage(deps, u, late);
    };
    expect(await runTurnTimer(deps, timer)).toBe("sent");
    deps.llm.replyHook = undefined;
    // Its timer runs; the first reply is done, so it commits and follows up.
    expect(await runTurnTimer(deps, lastTimer(deps))).toBe("sent");
    const replies = (await listTurns(getTestDb(), u)).filter((t) => t.role === "companion");
    expect(replies).toHaveLength(2);
    expect(replies[0]!.reply_to).not.toBe(late.clientMessageId);
    expect(replies[1]!.reply_to).toBe(late.clientMessageId);
  });

  test("a message during the later bubbles of a reply waits until its last bubble is out", async () => {
    const deps = makeTestDeps();
    const clock = new HookedClock(deps.clock.now());
    deps.clock = clock;
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("tell me about your week"));
    const first = lastTimer(deps);
    deps.llm.replies.push("part one here\n\npart two here");
    const late = msg("haha same honestly");
    let lateResult: string | undefined;
    // Sleep 3 is the part-gap + typing wait before bubble 1: the first reply is inserted and bubble 0 is out.
    clock.hookAtCall = 3;
    clock.hook = async () => {
      await receiveMessage(deps, u, late);
      deps.clock.advance(deps.config.turn.settle_ms);
      lateResult = await runTurnTimer(deps, lastTimer(deps));
    };
    expect(await runTurnTimer(deps, first)).toBe("sent");
    expect(lateResult).toBe("busy");
    expect((await getState(getTestDb(), u))!.sending_since).toBeNull();

    // The rescheduled timer now commits and follows up, after every bubble of the first reply.
    deps.llm.replies.push("same energy");
    expect(await runTurnTimer(deps, lastTimer(deps))).toBe("sent");
    const [r1, r2] = (await listTurns(getTestDb(), u)).filter((t) => t.role === "companion");
    const events = deps.events.events.map((x) => x.event);
    const lastOfFirst = events.findIndex(
      (e) => e.type === "message" && e.turnId === r1!.id && e.part === 1,
    );
    const firstOfSecond = events.findIndex((e) => e.type === "message" && e.turnId === r2!.id);
    expect(r2!.reply_to).toBe(late.clientMessageId);
    expect(lastOfFirst).toBeGreaterThan(-1);
    expect(firstOfSecond).toBeGreaterThan(lastOfFirst);
  });

  test("a reply still sending blocks a commit; a crisis clears the marker", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("first thing here"));
    await getTestDb().execute(
      sql.raw(
        `UPDATE conversation_state SET sending_since = '2026-01-05T09:00:00Z' WHERE user_id = '${u}'`,
      ),
    );
    expect(await runTurnTimer(deps, lastTimer(deps))).toBe("busy");
    deps.llm.classify = () => ({ flag: true, category: "self_harm" });
    await receiveMessage(deps, u, msg("actually i want to end my life"));
    expect((await getState(getTestDb(), u))!.sending_since).toBeNull();
    expect(deps.events.events.map((x) => x.event).at(-1)).toEqual({ type: "typing", on: false });
  });

  test("a timer that finds a reply still in flight reschedules itself instead of racing it", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await receiveMessage(deps, u, msg("first thing here"));
    const db = getTestDb();
    await db.execute(
      sql.raw(
        `UPDATE conversation_state SET inflight_turn_ids = ARRAY['${randomUUID()}']::uuid[], inflight_since = '2026-01-05T09:00:00Z' WHERE user_id = '${u}'`,
      ),
    );
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

  test("generation failure is never retried: reply_failed is emitted at once", async () => {
    const deps = makeTestDeps({ turn: { retry_limit: 1 } });
    const u = await createTestUser();
    const m = msg("hello there friend");
    await receiveMessage(deps, u, m);
    const timers = deps.queue.jobs.filter((j) => j.name === "turn_timer").length;
    deps.llm.failReplies = 5;
    expect(await runTurnTimer(deps, lastTimer(deps))).toBe("failed");
    expect(deps.queue.jobs.filter((j) => j.name === "turn_timer")).toHaveLength(timers);
    expect((await getState(getTestDb(), u))!).toMatchObject({
      buffer_turn_ids: [],
      inflight_turn_ids: [],
    });
    expect(deps.events.events.map((e) => e.event)).toContainEqual({
      type: "reply_failed",
      turnIds: [m.clientMessageId],
    });
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

  test("round 1 fix: a crisis landing after the first bubble stops further bubbles; the inserted reply stays", async () => {
    const deps = makeTestDeps();
    const hooked = new HookedEventBus();
    deps.events = hooked;
    const u = await createTestUser();
    const first = msg("tell me a long story about your day please");
    await receiveMessage(deps, u, first);
    const timer = lastTimer(deps);
    deps.llm.replies.push("part one here\n\npart two here");
    const crisisMsg = msg("actually i want to end my life");
    hooked.hook = async (e) => {
      if (e.type === "message" && e.part === 0) {
        hooked.hook = undefined;
        deps.llm.classify = () => ({ flag: true, category: "self_harm" });
        await receiveMessage(deps, u, crisisMsg);
      }
    };
    expect(await runTurnTimer(deps, timer)).toBe("abandoned");

    const companions = (await listTurns(getTestDb(), u)).filter((t) => t.role === "companion");
    expect(companions).toHaveLength(2); // the paced reply's first (only) bubble, and the crisis reply
    const pacedReply = companions.find((t) => t.reply_to === first.clientMessageId)!;
    expect(pacedReply).toBeDefined();

    const events = hooked.events.map((x) => x.event);
    expect(events.filter((e) => e.type === "message" && e.turnId === pacedReply.id)).toEqual([
      { type: "message", turnId: pacedReply.id, part: 0 },
    ]);
    expect(events.at(-1)).toEqual({ type: "typing", on: false });
  });

  test("round 2 fix: a crisis arriving during the part-gap + typing wait (not just at the previous bubble's publish) still stops the next bubble", async () => {
    const deps = makeTestDeps();
    const clock = new HookedClock(deps.clock.now());
    deps.clock = clock;
    const u = await createTestUser();
    const first = msg("tell me a long story about your day please");
    await receiveMessage(deps, u, first);
    const timer = lastTimer(deps);
    deps.llm.replies.push("part one here\n\npart two here");
    // Sleep calls in order: (1) the read delay, (2) the first bubble's typing wait, (3) the part-gap + typing
    // wait before bubble 1 — the crisis lands inside that third sleep, well before bubble 1's post-sleep check.
    clock.hookAtCall = 3;
    clock.hook = async () => {
      deps.llm.classify = () => ({ flag: true, category: "self_harm" });
      await receiveMessage(deps, u, msg("actually i want to end my life"));
    };
    expect(await runTurnTimer(deps, timer)).toBe("abandoned");

    const companions = (await listTurns(getTestDb(), u)).filter((t) => t.role === "companion");
    const pacedReply = companions.find((t) => t.reply_to === first.clientMessageId)!;
    expect(pacedReply).toBeDefined();

    const events = deps.events.events.map((x) => x.event);
    expect(
      events.filter((e) => e.type === "message" && e.turnId === pacedReply.id && e.part >= 1),
    ).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "typing", on: false });
  });

  test("round 1 fix: a crisis during a failed reply suppresses reply_failed (the crisis reply already covers the turns)", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const m = msg("hello there friend");
    await receiveMessage(deps, u, m);
    const timer = lastTimer(deps);
    deps.llm.failReplies = 1;
    deps.llm.replyHook = async () => {
      deps.llm.replyHook = undefined;
      deps.llm.classify = () => ({ flag: true, category: "self_harm" });
      await receiveMessage(deps, u, msg("actually i want to end my life"));
    };
    expect(await runTurnTimer(deps, timer)).toBe("abandoned");
    expect(deps.events.events.map((e) => e.event)).not.toContainEqual(
      expect.objectContaining({ type: "reply_failed" }),
    );
    expect(deps.events.events.at(-1)!.event).toEqual({ type: "typing", on: false });
  });

  test("round 1 fix: a reply already inserted for the last turn (a concurrent duplicate job) abandons instead of throwing", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const m = msg("hello there friend");
    await receiveMessage(deps, u, m);
    const timer = lastTimer(deps);
    const userTurn = (await listTurns(getTestDb(), u))[0]!;
    await insertTurn(getTestDb(), u, {
      id: randomUUID(),
      session_id: userTurn.session_id,
      role: "companion",
      text: "already answered",
      created_at: deps.clock.now(),
      reply_to: userTurn.id,
    });
    expect(await runTurnTimer(deps, timer)).toBe("abandoned");
    expect((await getState(getTestDb(), u))!).toMatchObject({ inflight_turn_ids: [] });
    expect(deps.events.events.at(-1)!.event).toEqual({ type: "typing", on: false });
    expect((await listTurns(getTestDb(), u)).filter((t) => t.role === "companion")).toHaveLength(1);
  });

  test("post-commit infra error: turns go back to the buffer and a retry timer is queued", async () => {
    const deps = makeTestDeps();
    const userId = await createTestUser();
    const m = msg("hello there friend");
    await receiveMessage(deps, userId, m);
    const { version } = lastTimer(deps);
    let failed = false;
    Object.assign(deps, {
      getTurnsByIds: async (...args: Parameters<typeof getTurnsByIds>) => {
        if (!failed) {
          failed = true;
          throw new Error("db down");
        }
        return getTurnsByIds(...args);
      },
    });
    expect(await runTurnTimer(deps, { userId, version })).toBe("retry");
    const st = await getState(getTestDb(), userId);
    expect(st?.inflight_turn_ids).toEqual([]);
    expect(st?.buffer_turn_ids).toHaveLength(1);
    expect(deps.queue.jobs.some((j) => j.name === "turn_timer" && j.data.attempt === 1)).toBe(true);
  });
});

describe("runBackchannel", () => {
  test("sends once per buffer, stored as a backchannel turn that is never extracted", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    deps.llm.handlers.turn_judge = () => ({
      reasoning: "r",
      complete: false,
      still_open: [],
      asked: [],
      backchannel: "huh",
    });
    const m = msg("my boss called me in");
    await receiveMessage(deps, u, m);
    const version = (await getState(getTestDb(), u))!.buffer_version;
    expect(
      await runBackchannel(deps, { userId: u, version, text: "huh", turnId: m.clientMessageId }),
    ).toBe("sent");
    expect(
      await runBackchannel(deps, { userId: u, version, text: "huh", turnId: m.clientMessageId }),
    ).toBe("skipped");
    const bc = (await listTurns(getTestDb(), u)).find((t) => t.trigger === "backchannel")!;
    expect(bc).toMatchObject({ role: "companion", text: "huh", reply_to: null, extracted: true });
    expect(deps.events.events.at(-1)!.event).toEqual({ type: "message", turnId: bc.id, part: 0 });
    expect(deps.pusher.pushes.filter((p) => p.msg.tag === bc.id)).toHaveLength(1);
  });

  test("a newer message makes it stale; a keyword hit drops it", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } });
    const u = await createTestUser();
    const m = msg("my boss called me in");
    await receiveMessage(deps, u, m);
    const version = (await getState(getTestDb(), u))!.buffer_version;
    await receiveMessage(deps, u, msg("and I thought I was getting fired"));
    expect(
      await runBackchannel(deps, { userId: u, version, text: "huh", turnId: m.clientMessageId }),
    ).toBe("skipped");
    const v2 = (await getState(getTestDb(), u))!.buffer_version;
    expect(
      await runBackchannel(deps, {
        userId: u,
        version: v2,
        text: "you owe me",
        turnId: m.clientMessageId,
      }),
    ).toBe("dropped");
    expect((await listTurns(getTestDb(), u)).filter((t) => t.trigger === "backchannel")).toEqual(
      [],
    );
  });

  test("round 1 fix: a missing anchor turn returns skipped instead of inventing a session id", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const m = msg("my boss called me in");
    await receiveMessage(deps, u, m);
    const version = (await getState(getTestDb(), u))!.buffer_version;
    expect(
      await runBackchannel(deps, { userId: u, version, text: "huh", turnId: randomUUID() }),
    ).toBe("skipped");
    expect((await listTurns(getTestDb(), u)).filter((t) => t.trigger === "backchannel")).toEqual(
      [],
    );
  });

  test("round 1 fix: a version bump during the (unlocked) guard check makes the insert-time recheck skip it", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const m = msg("my boss called me in");
    await receiveMessage(deps, u, m);
    const version = (await getState(getTestDb(), u))!.buffer_version;
    const real = guardOutgoingModule.guardOutgoing;
    const spy = vi.spyOn(guardOutgoingModule, "guardOutgoing").mockImplementation(async (d, a) => {
      // Simulate a new message starting a fresh buffer while the (unlocked) guard check is in flight.
      await receiveMessage(deps, u, msg("and I thought I was getting fired"));
      return real(d, a);
    });
    try {
      expect(
        await runBackchannel(deps, { userId: u, version, text: "huh", turnId: m.clientMessageId }),
      ).toBe("skipped");
    } finally {
      spy.mockRestore();
    }
    expect((await listTurns(getTestDb(), u)).filter((t) => t.trigger === "backchannel")).toEqual(
      [],
    );
  });
});
