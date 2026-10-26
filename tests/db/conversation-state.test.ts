import { adminFindStuckConversations } from "@/db/repos/admin/turn-taking";
import { afterAll, beforeEach, expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { mutateState } from "@/mind/process/turn-taking/state";
import * as T from "@/mind/process/turn-taking/transitions";
import { getState } from "@/db/repos/user/conversation-state";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");
const ID = "00000000-0000-4000-8000-000000000001";
const sweepBatch = loadConfig().turn.sweep_batch;

test("mutateState creates the row, applies the patch, and is user-scoped", async () => {
  const db = getTestDb();
  const [a, b] = [await createTestUser("a"), await createTestUser("b")];
  const r = await mutateState(db, a, now, (s) =>
    T.append(s, {
      turnId: ID,
      now,
      windowMs: 4000,
      maxWaitMs: 40000,
      openQuestions: [{ coords: [{ turnId: ID, start: 0, end: 2 }] }],
    }),
  );
  expect(r.version).toBe(1);
  expect(await getState(db, a)).toMatchObject({
    buffer_turn_ids: [ID],
    buffer_version: 1,
    open_questions: [{ coords: [{ turnId: ID, start: 0, end: 2 }] }],
  });
  expect(await getState(db, b)).toBeNull();
});

test("concurrent appends serialize on the row lock: both turns kept, versions distinct", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const ids = ["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b"];
  const vs = await Promise.all(
    ids.map((turnId) =>
      mutateState(db, u, now, (s) =>
        T.append(s, { turnId, now, windowMs: 4000, maxWaitMs: 40000, openQuestions: [] }),
      ),
    ),
  );
  expect(new Set(vs.map((v) => v.version))).toEqual(new Set([1, 2]));
  expect((await getState(db, u))!.buffer_turn_ids.sort()).toEqual([...ids].sort());
});

test("adminFindStuckConversations finds overdue buffers and stuck in-flight replies", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  await mutateState(db, u, now, (s) =>
    T.append(s, { turnId: ID, now, windowMs: 1000, maxWaitMs: 40000, openQuestions: [] }),
  );
  expect(await adminFindStuckConversations(db, now, now, sweepBatch)).toEqual([]);
  expect(
    await adminFindStuckConversations(db, new Date(now.getTime() + 120_000), now, sweepBatch),
  ).toEqual([u]);
});
