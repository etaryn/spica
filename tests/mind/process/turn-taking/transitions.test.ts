import { describe, expect, test } from "vitest";
import type { ConvState } from "@/db/repos/conversation-state";
import * as T from "@/mind/process/turn-taking/transitions";

const at = (s: number) => new Date(Date.UTC(2026, 0, 5, 9, 0, s));
const empty = (over: Partial<ConvState> = {}): ConvState => ({
  user_id: "u",
  buffer_turn_ids: [],
  open_questions: [],
  wait_until: null,
  last_backchannel_at: null,
  buffer_version: 0,
  buffer_started_at: null,
  backchannel_sent: false,
  inflight_turn_ids: [],
  inflight_since: null,
  sending_since: null,
  reply_epoch: 0,
  deferred_until: null,
  deferred_fact: null,
  updated_at: at(0),
  ...over,
});
const apply = (s: ConvState, patch: Partial<ConvState> | null): ConvState => ({
  ...s,
  ...(patch ?? {}),
});

describe("append", () => {
  test("first message starts the buffer and sets the wait from now", () => {
    const r = T.append(empty(), {
      turnId: "a",
      now: at(0),
      windowMs: 4000,
      maxWaitMs: 40000,
      openQuestions: [],
    });
    expect(r.result.version).toBe(1);
    expect(r.result.waitUntil).toEqual(at(4));
    expect(r.patch).toMatchObject({
      buffer_turn_ids: ["a"],
      buffer_started_at: at(0),
      buffer_version: 1,
      wait_until: at(4),
    });
  });
  test("later messages extend the buffer but the wait is capped from buffer_started_at", () => {
    const s = empty({ buffer_turn_ids: ["a"], buffer_started_at: at(0), buffer_version: 1 });
    const r = T.append(s, {
      turnId: "b",
      now: at(35),
      windowMs: 12000,
      maxWaitMs: 40000,
      openQuestions: [],
    });
    expect(r.result.waitUntil).toEqual(at(40));
    expect(r.patch?.buffer_turn_ids).toEqual(["a", "b"]);
  });
  test("re-appending a turn already in the buffer does not duplicate it", () => {
    const s = empty({ buffer_turn_ids: ["a"], buffer_started_at: at(0), buffer_version: 1 });
    expect(
      T.append(s, { turnId: "a", now: at(1), windowMs: 4000, maxWaitMs: 40000, openQuestions: [] })
        .patch?.buffer_turn_ids,
    ).toEqual(["a"]);
  });
  test("normal path reports skipped: false", () => {
    expect(
      T.append(empty(), {
        turnId: "a",
        now: at(0),
        windowMs: 4000,
        maxWaitMs: 40000,
        openQuestions: [],
      }).result.skipped,
    ).toBe(false);
  });
  test("a turn already in flight is a no-op (a race with a committed reply): no patch, current state echoed back, skipped: true", () => {
    const s = empty({
      inflight_turn_ids: ["a"],
      inflight_since: at(0),
      buffer_version: 2,
      wait_until: at(5),
      backchannel_sent: true,
    });
    const r = T.append(s, {
      turnId: "a",
      now: at(9),
      windowMs: 4000,
      maxWaitMs: 40000,
      openQuestions: [],
    });
    expect(r.patch).toBeNull();
    expect(r.result).toEqual({
      version: 2,
      waitUntil: at(5),
      backchannelSent: true,
      lastBackchannelAt: null,
      skipped: true,
      deferredUntil: null,
      deferredNow: false,
    });
  });
  test("in flight with no wait_until set falls back to now", () => {
    const s = empty({ inflight_turn_ids: ["a"], inflight_since: at(0), buffer_version: 2 });
    expect(
      T.append(s, { turnId: "a", now: at(9), windowMs: 4000, maxWaitMs: 40000, openQuestions: [] })
        .result.waitUntil,
    ).toEqual(at(9));
  });
});

describe("commit", () => {
  const buffered = empty({
    buffer_turn_ids: ["a", "b"],
    buffer_started_at: at(0),
    buffer_version: 2,
    open_questions: [{ turn_id: "a", text: "what should I cook?" }],
  });
  test("a stale version or empty buffer is a no-op", () => {
    expect(T.commit(buffered, { version: 1, now: at(5) })).toEqual({
      patch: null,
      result: { kind: "stale" },
    });
    expect(T.commit(empty(), { version: 0, now: at(5) }).result.kind).toBe("stale");
  });
  test("a reply already in flight makes the timer wait (append-and-follow-up)", () => {
    expect(T.commit({ ...buffered, inflight_turn_ids: ["z"] }, { version: 2, now: at(5) })).toEqual(
      { patch: null, result: { kind: "busy" } },
    );
  });
  test("commit moves the buffer in flight and bumps the version", () => {
    const r = T.commit(buffered, { version: 2, now: at(5) });
    expect(r.result).toEqual({
      kind: "commit",
      turnIds: ["a", "b"],
      epoch: 0,
      openQuestions: ["what should I cook?"],
      deferredFact: null,
    });
    expect(r.patch).toMatchObject({
      buffer_turn_ids: [],
      inflight_turn_ids: ["a", "b"],
      inflight_since: at(5),
      buffer_version: 3,
      wait_until: null,
      buffer_started_at: null,
      backchannel_sent: false,
    });
  });
});

describe("finish / restore / giveUp / crisis", () => {
  const inflight = empty({
    inflight_turn_ids: ["a"],
    inflight_since: at(5),
    buffer_version: 3,
    reply_epoch: 0,
  });
  test("finish clears inflight and marks the reply sending when the epoch is unchanged and the turns match", () => {
    expect(T.finish(inflight, { epoch: 0, turnIds: ["a"], now: at(9) })).toEqual({
      patch: {
        inflight_turn_ids: [],
        inflight_since: null,
        sending_since: at(9),
        updated_at: at(9),
      },
      result: true,
    });
  });
  test("release clears the sending marker only under the same epoch", () => {
    const sending = empty({ sending_since: at(9), reply_epoch: 2 });
    expect(T.release(sending, { epoch: 2, now: at(20) })).toEqual({
      patch: { sending_since: null, updated_at: at(20) },
      result: true,
    });
    expect(T.release(sending, { epoch: 1, now: at(20) })).toEqual({ patch: null, result: false });
    expect(T.release(empty(), { epoch: 0, now: at(20) })).toEqual({ patch: null, result: false });
  });
  test("commit is busy while a reply is still sending", () => {
    expect(
      T.commit(empty({ buffer_turn_ids: ["b"], buffer_version: 4, sending_since: at(9) }), {
        version: 4,
        now: at(10),
      }).result,
    ).toEqual({ kind: "busy" });
  });
  test("finish is order-independent on which turns it's clearing", () => {
    expect(
      T.finish(
        { ...inflight, inflight_turn_ids: ["b", "a"] },
        { epoch: 0, turnIds: ["a", "b"], now: at(9) },
      ).result,
    ).toBe(true);
  });
  test("finish reports abandonment after a crisis bumped the epoch", () => {
    expect(
      T.finish(
        { ...inflight, reply_epoch: 1, inflight_turn_ids: [] },
        { epoch: 0, turnIds: ["a"], now: at(9) },
      ).result,
    ).toBe(false);
  });
  test("finish reports abandonment (and leaves inflight alone) when the inflight snapshot no longer matches — someone else's commit already owns the slot", () => {
    const r = T.finish(
      { ...inflight, inflight_turn_ids: ["b"] },
      { epoch: 0, turnIds: ["a"], now: at(9) },
    );
    expect(r).toEqual({ patch: null, result: false });
  });
  test("restore puts the turns back in front of newer buffered turns and bumps the version", () => {
    const r = T.restore(
      { ...inflight, buffer_turn_ids: ["b"], buffer_started_at: at(7) },
      { epoch: 0, turnIds: ["a"], now: at(9), retryAt: at(14) },
    );
    expect(r.result).toEqual({ kind: "restored", version: 4 });
    expect(r.patch).toMatchObject({
      buffer_turn_ids: ["a", "b"],
      inflight_turn_ids: [],
      buffer_started_at: at(7),
      wait_until: at(14),
    });
  });
  test("restore after a crisis is abandoned (the crisis reply covered the turns)", () => {
    expect(
      T.restore(
        { ...inflight, reply_epoch: 1 },
        { epoch: 0, turnIds: ["a"], now: at(9), retryAt: at(14) },
      ).result,
    ).toEqual({ kind: "abandoned" });
  });
  test("giveUp clears inflight when the epoch is unchanged, reporting true", () => {
    expect(T.giveUp(inflight, { epoch: 0, now: at(9) })).toEqual({
      patch: { inflight_turn_ids: [], inflight_since: null, updated_at: at(9) },
      result: true,
    });
  });
  test("giveUp is a no-op after a crisis bumped the epoch, reporting false", () => {
    expect(T.giveUp({ ...inflight, reply_epoch: 1 }, { epoch: 0, now: at(9) })).toEqual({
      patch: null,
      result: false,
    });
  });
  test("crisis snapshots inflight + buffer + the turn, clears both and bumps version and epoch", () => {
    const s = { ...inflight, buffer_turn_ids: ["b"] };
    const r = T.crisis(s, { turnId: "c", now: at(10) });
    expect(r.result.turnIds).toEqual(["a", "b", "c"]);
    expect(r.patch).toMatchObject({
      buffer_turn_ids: [],
      inflight_turn_ids: [],
      buffer_version: 4,
      reply_epoch: 1,
      open_questions: [],
    });
  });
});

describe("backchannel and recover", () => {
  const s = empty({ buffer_turn_ids: ["a"], buffer_version: 1, buffer_started_at: at(0) });
  test("one backchannel per buffer, rate-limited across buffers, only for the current version", () => {
    const r = T.backchannel(s, { version: 1, now: at(2), minIntervalMs: 90000 });
    expect(r.result).toBe(true);
    const after = apply(s, r.patch);
    expect(T.backchannel(after, { version: 1, now: at(3), minIntervalMs: 90000 }).result).toBe(
      false,
    );
    expect(T.backchannel(s, { version: 0, now: at(2), minIntervalMs: 90000 }).result).toBe(false);
    expect(
      T.backchannel(
        { ...s, last_backchannel_at: at(0) },
        { version: 1, now: at(30), minIntervalMs: 90000 },
      ).result,
    ).toBe(false);
  });
  test("recover clears a stale sending marker without re-buffering, and requeues a buffer that waited behind it", () => {
    const later = new Date(at(0).getTime() + 200_000);
    const alone = T.recover(empty({ sending_since: at(0), buffer_version: 3 }), {
      now: later,
      graceMs: 60000,
      inflightMaxAgeMs: 180000,
    });
    expect(alone).toEqual({
      patch: { sending_since: null, updated_at: later },
      result: { version: null },
    });
    const waiting = T.recover(
      empty({
        sending_since: at(0),
        buffer_turn_ids: ["b"],
        wait_until: new Date(later.getTime() - 1000),
        buffer_version: 3,
      }),
      { now: later, graceMs: 60000, inflightMaxAgeMs: 180000 },
    );
    expect(waiting.result.version).toBe(4);
    expect(waiting.patch).toMatchObject({
      sending_since: null,
      buffer_turn_ids: ["b"],
      wait_until: later,
    });
    expect(
      T.recover(empty({ sending_since: at(0) }), {
        now: at(1),
        graceMs: 60000,
        inflightMaxAgeMs: 180000,
      }).patch,
    ).toBeNull();
  });
  test("recover requeues an overdue buffer and a stuck in-flight reply; leaves healthy state alone", () => {
    expect(
      T.recover(
        { ...s, wait_until: at(5) },
        { now: at(10), graceMs: 60000, inflightMaxAgeMs: 180000 },
      ).result.version,
    ).toBeNull();
    const overdue = T.recover(
      { ...s, wait_until: at(5) },
      { now: at(70), graceMs: 60000, inflightMaxAgeMs: 180000 },
    );
    expect(overdue.result.version).toBe(2);
    const stuck = T.recover(
      empty({ inflight_turn_ids: ["a"], inflight_since: at(0), buffer_version: 3 }),
      { now: new Date(at(0).getTime() + 200_000), graceMs: 60000, inflightMaxAgeMs: 180000 },
    );
    expect(stuck.result.version).toBe(4);
    expect(stuck.patch).toMatchObject({ buffer_turn_ids: ["a"], inflight_turn_ids: [] });
  });
});

describe("availability deferral", () => {
  test("a deferred first turn holds wait_until past max_wait; later turns keep it", () => {
    const now = new Date("2026-01-05T10:30:00Z");
    const until = new Date(now.getTime() + 20 * 60_000);
    const a = T.append(empty(), {
      turnId: "t1",
      now,
      windowMs: 4000,
      maxWaitMs: 40_000,
      openQuestions: [],
      defer: { until, factId: "f1" },
    });
    expect(a.result).toMatchObject({ waitUntil: until, deferredUntil: until, deferredNow: true });
    expect(a.patch).toMatchObject({ deferred_until: until, deferred_fact: "f1" });
    const s2 = { ...empty(), ...a.patch } as ConvState;
    const b = T.append(s2, {
      turnId: "t2",
      now: new Date(now.getTime() + 20_000),
      windowMs: 4000,
      maxWaitMs: 40_000,
      openQuestions: [],
    });
    expect(b.result).toMatchObject({ waitUntil: until, deferredNow: false });
    expect(b.patch).not.toHaveProperty("deferred_until");
  });

  test("commit clears the deferral and reports its block fact", () => {
    const s = {
      ...empty(),
      buffer_turn_ids: ["t1"],
      buffer_version: 3,
      deferred_until: new Date(),
      deferred_fact: "f1",
    } as ConvState;
    const c = T.commit(s, { version: 3, now: new Date() });
    expect(c.result).toMatchObject({ kind: "commit", deferredFact: "f1" });
    expect(c.patch).toMatchObject({ deferred_until: null, deferred_fact: null });
  });

  test("crisis clears the deferral; the next buffer computes a fresh one (review focus 3)", () => {
    const until = new Date("2026-01-05T11:00:00Z");
    const s = {
      ...empty(),
      buffer_turn_ids: ["t1"],
      deferred_until: until,
      deferred_fact: "f1",
    } as ConvState;
    const c = T.crisis(s, { turnId: "t2", now: new Date("2026-01-05T10:31:00Z") });
    expect(c.patch).toMatchObject({ deferred_until: null, deferred_fact: null });
    const after = { ...s, ...c.patch } as ConvState;
    const next = T.append(after, {
      turnId: "t3",
      now: new Date("2026-01-05T10:32:00Z"),
      windowMs: 4000,
      maxWaitMs: 40_000,
      openQuestions: [],
    });
    expect(next.result.deferredUntil).toBeNull();
    expect(next.result.waitUntil.toISOString()).toBe("2026-01-05T10:32:04.000Z");
  });
});
