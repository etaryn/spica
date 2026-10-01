import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { sweepUnfinishedColdPaths } from "@/mind/process/cold-path/sweep";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T12:00:00Z");

async function exchange(
  userId: string,
  createdAt: Date,
  opts: { extracted?: boolean; attempts?: number } = {},
) {
  const db = getTestDb();
  const ut = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "x",
    created_at: createdAt,
    extracted: opts.extracted ?? false,
  });
  const ct = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: ut.session_id,
    role: "companion",
    text: "y",
    created_at: createdAt,
    reply_to: ut.id,
    extracted: opts.extracted ?? false,
    extract_attempts: opts.attempts ?? 0,
  });
  return { ut, ct };
}

test("re-enqueues old unextracted exchanges, bumps attempts, skips fresh/extracted/exhausted ones", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const old = new Date("2026-01-05T10:00:00Z");
  const due = await exchange(u, old);
  await exchange(u, new Date("2026-01-05T11:55:00Z")); // too fresh (min age 10 min)
  await exchange(u, old, { extracted: true }); // done
  await exchange(u, old, { attempts: 3 }); // exhausted (max 3)
  const n = await sweepUnfinishedColdPaths(deps, now);
  expect(n).toBe(1);
  expect(deps.queue.jobs).toEqual([
    {
      name: "cold_path",
      data: { userId: u, turnIds: [due.ut.id, due.ct.id], replyTurnId: due.ct.id, recalled: [] },
    },
  ]);
  const [row] = await getTestDb()
    .select()
    .from(s.session_log)
    .where(eq(s.session_log.id, due.ct.id));
  expect(row!.extract_attempts).toBe(1);
});

test("an exchange that answered several buffered turns is swept with all of them", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const db = getTestDb();
  const S = randomUUID();
  const t0 = new Date("2026-01-01T09:00:00Z");
  const a = await insertTurn(db, u, {
    id: randomUUID(),
    session_id: S,
    role: "user",
    text: "one",
    created_at: t0,
  });
  const b = await insertTurn(db, u, {
    id: randomUUID(),
    session_id: S,
    role: "user",
    text: "two",
    created_at: new Date(t0.getTime() + 2000),
  });
  const c = await insertTurn(db, u, {
    id: randomUUID(),
    session_id: S,
    role: "companion",
    text: "reply",
    created_at: new Date(t0.getTime() + 9000),
    reply_to: b.id,
  });
  await sweepUnfinishedColdPaths(deps, new Date(t0.getTime() + 3_600_000));
  expect(deps.queue.jobs).toEqual([
    {
      name: "cold_path",
      data: { userId: u, turnIds: [a.id, b.id, c.id], replyTurnId: c.id, recalled: [] },
    },
  ]);
});
