import { describe, expect, test } from "vitest";
import type { ConvState } from "@/db/repos/conversation-state";
import * as T from "@/core/turn/transitions";

const at = (s: number) => new Date(Date.UTC(2026, 0, 5, 9, 0, s));
const empty = (over: Partial<ConvState> = {}): ConvState => ({
  user_id: "u", buffer_turn_ids: [], open_questions: [], wait_until: null, last_backchannel_at: null,
  buffer_version: 0, buffer_started_at: null, backchannel_sent: false, inflight_turn_ids: [], inflight_since: null,
  reply_epoch: 0, updated_at: at(0), ...over,
});
const apply = (s: ConvState, patch: Partial<ConvState> | null): ConvState => ({ ...s, ...(patch ?? {}) });

describe("append", () => {
  test("first message starts the buffer and sets the wait from now", () => {
    const r = T.append(empty(), { turnId: "a", now: at(0), windowMs: 4000, maxWaitMs: 40000, openQuestions: [] });
    expect(r.result.version).toBe(1);
    expect(r.result.waitUntil).toEqual(at(4));
    expect(r.patch).toMatchObject({ buffer_turn_ids: ["a"], buffer_started_at: at(0), buffer_version: 1, wait_until: at(4) });
  });
  test("later messages extend the buffer but the wait is capped from buffer_started_at", () => {
    const s = empty({ buffer_turn_ids: ["a"], buffer_started_at: at(0), buffer_version: 1 });
    const r = T.append(s, { turnId: "b", now: at(35), windowMs: 12000, maxWaitMs: 40000, openQuestions: [] });
    expect(r.result.waitUntil).toEqual(at(40));
    expect(r.patch?.buffer_turn_ids).toEqual(["a", "b"]);
  });
  test("re-appending a turn already in the buffer does not duplicate it", () => {
    const s = empty({ buffer_turn_ids: ["a"], buffer_started_at: at(0), buffer_version: 1 });
    expect(T.append(s, { turnId: "a", now: at(1), windowMs: 4000, maxWaitMs: 40000, openQuestions: [] }).patch?.buffer_turn_ids).toEqual(["a"]);
  });
});

describe("commit", () => {
  const buffered = empty({ buffer_turn_ids: ["a", "b"], buffer_started_at: at(0), buffer_version: 2, open_questions: [{ turn_id: "a", text: "what should I cook?" }] });
  test("a stale version or empty buffer is a no-op", () => {
    expect(T.commit(buffered, { version: 1, now: at(5) })).toEqual({ patch: null, result: { kind: "stale" } });
    expect(T.commit(empty(), { version: 0, now: at(5) }).result.kind).toBe("stale");
  });
  test("a reply already in flight makes the timer wait (append-and-follow-up)", () => {
    expect(T.commit({ ...buffered, inflight_turn_ids: ["z"] }, { version: 2, now: at(5) })).toEqual({ patch: null, result: { kind: "busy" } });
  });
  test("commit moves the buffer in flight and bumps the version", () => {
    const r = T.commit(buffered, { version: 2, now: at(5) });
    expect(r.result).toEqual({ kind: "commit", turnIds: ["a", "b"], epoch: 0, openQuestions: ["what should I cook?"] });
    expect(r.patch).toMatchObject({ buffer_turn_ids: [], inflight_turn_ids: ["a", "b"], inflight_since: at(5), buffer_version: 3, wait_until: null, buffer_started_at: null, backchannel_sent: false });
  });
});

describe("finish / restore / giveUp / crisis", () => {
  const inflight = empty({ inflight_turn_ids: ["a"], inflight_since: at(5), buffer_version: 3, reply_epoch: 0 });
  test("finish clears inflight when the epoch is unchanged", () => {
    expect(T.finish(inflight, { epoch: 0, now: at(9) })).toEqual({ patch: { inflight_turn_ids: [], inflight_since: null, updated_at: at(9) }, result: true });
  });
  test("finish reports abandonment after a crisis bumped the epoch", () => {
    expect(T.finish({ ...inflight, reply_epoch: 1, inflight_turn_ids: [] }, { epoch: 0, now: at(9) }).result).toBe(false);
  });
  test("restore puts the turns back in front of newer buffered turns and bumps the version", () => {
    const r = T.restore({ ...inflight, buffer_turn_ids: ["b"], buffer_started_at: at(7) }, { epoch: 0, turnIds: ["a"], now: at(9), retryAt: at(14) });
    expect(r.result).toEqual({ kind: "restored", version: 4 });
    expect(r.patch).toMatchObject({ buffer_turn_ids: ["a", "b"], inflight_turn_ids: [], buffer_started_at: at(7), wait_until: at(14) });
  });
  test("restore after a crisis is abandoned (the crisis reply covered the turns)", () => {
    expect(T.restore({ ...inflight, reply_epoch: 1 }, { epoch: 0, turnIds: ["a"], now: at(9), retryAt: at(14) }).result).toEqual({ kind: "abandoned" });
  });
  test("giveUp clears inflight when the epoch is unchanged", () => {
    expect(T.giveUp(inflight, { epoch: 0, now: at(9) })).toEqual({ patch: { inflight_turn_ids: [], inflight_since: null, updated_at: at(9) }, result: undefined });
  });
  test("giveUp is a no-op after a crisis bumped the epoch", () => {
    expect(T.giveUp({ ...inflight, reply_epoch: 1 }, { epoch: 0, now: at(9) })).toEqual({ patch: null, result: undefined });
  });
  test("crisis snapshots inflight + buffer + the turn, clears both and bumps version and epoch", () => {
    const s = { ...inflight, buffer_turn_ids: ["b"] };
    const r = T.crisis(s, { turnId: "c", now: at(10) });
    expect(r.result.turnIds).toEqual(["a", "b", "c"]);
    expect(r.patch).toMatchObject({ buffer_turn_ids: [], inflight_turn_ids: [], buffer_version: 4, reply_epoch: 1, open_questions: [] });
  });
});

describe("backchannel and recover", () => {
  const s = empty({ buffer_turn_ids: ["a"], buffer_version: 1, buffer_started_at: at(0) });
  test("one backchannel per buffer, rate-limited across buffers, only for the current version", () => {
    const r = T.backchannel(s, { version: 1, now: at(2), minIntervalMs: 90000 });
    expect(r.result).toBe(true);
    const after = apply(s, r.patch);
    expect(T.backchannel(after, { version: 1, now: at(3), minIntervalMs: 90000 }).result).toBe(false);
    expect(T.backchannel(s, { version: 0, now: at(2), minIntervalMs: 90000 }).result).toBe(false);
    expect(T.backchannel({ ...s, last_backchannel_at: at(0) }, { version: 1, now: at(30), minIntervalMs: 90000 }).result).toBe(false);
  });
  test("recover requeues an overdue buffer and a stuck in-flight reply; leaves healthy state alone", () => {
    expect(T.recover({ ...s, wait_until: at(5) }, { now: at(10), graceMs: 60000, inflightMaxAgeMs: 180000 }).result.version).toBeNull();
    const overdue = T.recover({ ...s, wait_until: at(5) }, { now: at(70), graceMs: 60000, inflightMaxAgeMs: 180000 });
    expect(overdue.result.version).toBe(2);
    const stuck = T.recover(empty({ inflight_turn_ids: ["a"], inflight_since: at(0), buffer_version: 3 }), { now: new Date(at(0).getTime() + 200_000), graceMs: 60000, inflightMaxAgeMs: 180000 });
    expect(stuck.result.version).toBe(4);
    expect(stuck.patch).toMatchObject({ buffer_turn_ids: ["a"], inflight_turn_ids: [] });
  });
});
