import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { markReachOutAnswered } from "@/core/outreach/answered";
import { receiveMessage } from "@/core/turn/receive-message";
import { getReachOutLog, insertReachOutLog } from "@/db/repos/reach-out";
import { ensureRelationship, getRelationshipRow } from "@/db/repos/relationship";
import { relationship } from "@/db/schema";
import { closeTestDb, createTestUser, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("any user message resets the counter and marks the latest sent reach-out answered", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const now = deps.clock.now();
  await ensureRelationship(deps.db, u, now, deps.config.relationship);
  await deps.db
    .update(relationship)
    .set({ unanswered_reach_outs: 2 })
    .where(eq(relationship.user_id, u));
  const id = await insertReachOutLog(deps.db, u, {
    candidates: [],
    winner: null,
    gate_results: [],
    status: "sent",
    topic: "x",
    send_at: new Date(now.getTime() - 1000),
    created_at: now,
  });
  await receiveMessage(deps, u, { clientMessageId: randomUUID(), text: "haha yes" });
  expect((await getRelationshipRow(deps.db, u))?.unanswered_reach_outs).toBe(0);
  expect((await getReachOutLog(deps.db, u, id))?.answered_at).toEqual(now);
});

test("a retry of an existing turn does not re-mark", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const now = deps.clock.now();
  await ensureRelationship(deps.db, u, now, deps.config.relationship);
  const x = randomUUID();
  await receiveMessage(deps, u, { clientMessageId: x, text: "hi" });
  const id = await insertReachOutLog(deps.db, u, {
    candidates: [],
    winner: null,
    gate_results: [],
    status: "sent",
    topic: "y",
    send_at: new Date(now.getTime() + 1000),
    created_at: now,
  });
  await deps.db
    .update(relationship)
    .set({ unanswered_reach_outs: 1 })
    .where(eq(relationship.user_id, u));
  await receiveMessage(deps, u, { clientMessageId: x, text: "hi" });
  expect((await getReachOutLog(deps.db, u, id))?.answered_at).toBeNull();
  expect((await getRelationshipRow(deps.db, u))?.unanswered_reach_outs).toBe(1);
});

test("a crisis message also answers", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const now = deps.clock.now();
  await ensureRelationship(deps.db, u, now, deps.config.relationship);
  await deps.db
    .update(relationship)
    .set({ unanswered_reach_outs: 2 })
    .where(eq(relationship.user_id, u));
  deps.llm.classify = () => ({ flag: true, category: "self_harm" });
  expect(
    await receiveMessage(deps, u, { clientMessageId: randomUUID(), text: "I want to kill myself" }),
  ).toMatchObject({ status: "replied" });
  expect((await getRelationshipRow(deps.db, u))?.unanswered_reach_outs).toBe(0);
});

test("M2: a lock wait on the answered update never holds up the crisis reply or its POST (rule 7); it still answers", async () => {
  const deps = makeTestDeps({ hot_path: { db_timeout_ms: 200 } });
  deps.llm.classify = () => ({ flag: true, category: "self_harm" });
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, deps.clock.now(), deps.config.relationship);
  await deps.db
    .update(relationship)
    .set({ unanswered_reach_outs: 2 })
    .where(eq(relationship.user_id, u));
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => {
    locked = r;
  });
  const holder = deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM relationship WHERE user_id = ${u} FOR UPDATE`);
    locked();
    await gate;
  });
  await isLocked;
  const pending = receiveMessage(deps, u, {
    clientMessageId: randomUUID(),
    text: "I want to kill myself",
  });
  let returned = false;
  void pending.then(
    () => {
      returned = true;
    },
    () => undefined,
  );
  try {
    // While the row is still locked: the reply is delivered and the POST (with the card) has returned.
    await vi.waitFor(() => expect(returned).toBe(true), { timeout: 5000, interval: 20 });
    expect(deps.events.events.some((e) => e.event.type === "message")).toBe(true);
  } finally {
    release();
    await holder;
    await pending.catch(() => undefined); // never leak the request into the next test
  }
  expect(await pending).toMatchObject({ status: "replied" });
  // The timed-out update commits in the background once the lock is released.
  await vi.waitFor(
    async () => expect((await getRelationshipRow(deps.db, u))?.unanswered_reach_outs).toBe(0),
    { timeout: 5000, interval: 20 },
  );
});

test("a DB failure is swallowed", async () => {
  const deps = makeTestDeps();
  const failing = {
    ...deps,
    db: { transaction: vi.fn().mockRejectedValue(new Error("down")) },
  } as never;
  await expect(markReachOutAnswered(failing, "u", new Date())).resolves.toBeUndefined();
});
