import { afterAll, beforeEach, expect, test } from "vitest";
import * as ro from "@/db/repos/reach-out";
import * as push from "@/db/repos/push";
import {
  ensureRelationship,
  getRelationshipRow,
  incrementUnanswered,
  resetUnanswered,
} from "@/db/repos/relationship";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const t0 = new Date("2026-01-05T09:00:00Z");
const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);
const base = { candidates: [], winner: null, gate_results: [], topic: null, send_at: null };

test("sent times, used topics and pending scheduled are per user and per status", async () => {
  const db = getTestDb();
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  await ro.insertReachOutLog(db, a, {
    ...base,
    status: "sent",
    topic: "thread:1@x",
    send_at: h(1),
    created_at: h(1),
  });
  await ro.insertReachOutLog(db, a, {
    ...base,
    status: "blocked",
    topic: "fact:2",
    created_at: h(2),
  });
  const sched = await ro.insertReachOutLog(db, a, {
    ...base,
    status: "scheduled",
    topic: "fact:3",
    send_at: h(3),
    created_at: h(3),
  });
  await ro.insertReachOutLog(db, b, {
    ...base,
    status: "sent",
    topic: "fact:9",
    send_at: h(1),
    created_at: h(1),
  });

  expect(await ro.sentReachOutTimes(db, a, h(0))).toEqual([h(1)]);
  expect(await ro.sentReachOutTimes(db, a, h(2))).toEqual([]);
  expect(await ro.usedTopics(db, a)).toEqual(["thread:1@x"]);
  expect(await ro.hasPendingScheduled(db, a, h(2))).toBe(true);
  expect(await ro.hasPendingScheduled(db, a, h(4))).toBe(false); // older than `since`: stale, ignored
  expect(await ro.hasPendingScheduled(db, b, h(0))).toBe(false);
  expect(await ro.getReachOutLog(db, b, sched)).toBeNull(); // user-scoped
});

test("markLatestAnswered marks only the most recent unanswered sent row", async () => {
  const db = getTestDb();
  const a = await createTestUser();
  const first = await ro.insertReachOutLog(db, a, {
    ...base,
    status: "sent",
    topic: "a",
    send_at: h(1),
    created_at: h(1),
  });
  const second = await ro.insertReachOutLog(db, a, {
    ...base,
    status: "sent",
    topic: "b",
    send_at: h(30),
    created_at: h(30),
  });
  expect(await ro.markLatestAnswered(db, a, h(40))).toBe(second);
  expect((await ro.getReachOutLog(db, a, first))?.answered_at).toBeNull();
  expect((await ro.getReachOutLog(db, a, second))?.answered_at).toEqual(h(40));
  expect(await ro.markLatestAnswered(db, a, h(41))).toBeNull(); // nothing left unanswered after the latest
});

test("M1: dropScheduled drops only a row that is still scheduled", async () => {
  const db = getTestDb();
  const a = await createTestUser("a");
  const sched = await ro.insertReachOutLog(db, a, {
    ...base,
    status: "scheduled",
    topic: "t:1",
    send_at: h(1),
    created_at: h(0),
  });
  const sent = await ro.insertReachOutLog(db, a, {
    ...base,
    status: "sent",
    topic: "t:2",
    send_at: h(1),
    created_at: h(0),
  });
  expect(await ro.dropScheduled(db, a, sched, { dropped: "x" })).toBe(true);
  expect(await ro.getReachOutLog(db, a, sched)).toMatchObject({
    status: "dropped",
    sent: false,
    gate_results: { dropped: "x" },
  });
  expect(await ro.dropScheduled(db, a, sent, { dropped: "x" })).toBe(false);
  expect(await ro.getReachOutLog(db, a, sent)).toMatchObject({
    status: "sent",
    sent: true,
    gate_results: [],
  });
});

test("unanswered counter increments and resets", async () => {
  const deps = makeTestDeps();
  const a = await createTestUser();
  await ensureRelationship(deps.db, a, t0, deps.config.relationship);
  expect(await incrementUnanswered(deps.db, a)).toBe(1);
  expect(await incrementUnanswered(deps.db, a)).toBe(2);
  await resetUnanswered(deps.db, a);
  expect((await getRelationshipRow(deps.db, a))?.unanswered_reach_outs).toBe(0);
});

test("push subscriptions upsert by endpoint and reassign to the caller", async () => {
  const db = getTestDb();
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const s = { endpoint: "https://push.example/1", p256dh: "k1", auth: "a1" };
  await push.upsertPushSubscription(db, a, s, t0);
  await push.upsertPushSubscription(db, a, { ...s, p256dh: "k2" }, h(1));
  expect((await push.listPushSubscriptions(db, a)).map((r) => r.p256dh)).toEqual(["k2"]);
  await push.upsertPushSubscription(db, b, s, h(2)); // same browser, other account
  expect(await push.listPushSubscriptions(db, a)).toEqual([]);
  expect(await push.listPushSubscriptions(db, b)).toHaveLength(1);
  expect(await push.deletePushSubscription(db, a, s.endpoint)).toBe(false); // not a's any more
  expect(await push.deletePushSubscription(db, b, s.endpoint)).toBe(true);
});
