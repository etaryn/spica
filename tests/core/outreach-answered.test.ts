import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  await deps.db.update(relationship).set({ unanswered_reach_outs: 2 }).where(eq(relationship.user_id, u));
  const id = await insertReachOutLog(deps.db, u, { candidates: [], winner: null, gate_results: [], status: "sent", topic: "x", send_at: new Date(now.getTime() - 1000), created_at: now });
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
  const id = await insertReachOutLog(deps.db, u, { candidates: [], winner: null, gate_results: [], status: "sent", topic: "y", send_at: new Date(now.getTime() + 1000), created_at: now });
  await deps.db.update(relationship).set({ unanswered_reach_outs: 1 }).where(eq(relationship.user_id, u));
  await receiveMessage(deps, u, { clientMessageId: x, text: "hi" });
  expect((await getReachOutLog(deps.db, u, id))?.answered_at).toBeNull();
  expect((await getRelationshipRow(deps.db, u))?.unanswered_reach_outs).toBe(1);
});

test("a crisis message also answers", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const now = deps.clock.now();
  await ensureRelationship(deps.db, u, now, deps.config.relationship);
  await deps.db.update(relationship).set({ unanswered_reach_outs: 2 }).where(eq(relationship.user_id, u));
  await receiveMessage(deps, u, { clientMessageId: randomUUID(), text: "I want to kill myself" });
  expect((await getRelationshipRow(deps.db, u))?.unanswered_reach_outs).toBe(0);
});

test("a DB failure is swallowed", async () => {
  const deps = makeTestDeps();
  const failing = { ...deps, db: { transaction: vi.fn().mockRejectedValue(new Error("down")) } } as never;
  await expect(markReachOutAnswered(failing, "u", new Date())).resolves.toBeUndefined();
});
