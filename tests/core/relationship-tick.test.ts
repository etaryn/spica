import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { relationshipTick } from "@/core/relationship/tick";
import * as rel from "@/db/repos/relationship";
import { insertTurn } from "@/db/repos/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("samples yesterday's count once per local date, per user", async () => {
  const deps = makeTestDeps();
  const db = getTestDb();
  const u = await createTestUser();
  const day1 = new Date("2026-01-05T10:00:00Z");
  await rel.ensureRelationship(db, u, day1, deps.config.relationship);
  const session = randomUUID();
  for (let i = 0; i < 40; i++) await insertTurn(db, u, { id: randomUUID(), session_id: session, role: "user", text: `m${i}`, created_at: new Date(day1.getTime() + i * 60_000) });
  const day2 = new Date("2026-01-06T10:00:00Z");
  expect(await relationshipTick(deps, day2)).toEqual({ users: 1, failed: 0 });
  await relationshipTick(deps, new Date("2026-01-06T11:00:00Z")); // same local date: no-op
  const p = await rel.getParams(db, u);
  expect(p.msgs_per_day.baseline).toBeCloseTo(5 + deps.config.relationship.baseline_alpha * 35);
  expect((await rel.getRelationshipRow(db, u))?.last_tick).toBe("2026-01-06");
});

test("one failing user doesn't stop the batch", async () => {
  const deps = makeTestDeps();
  const db = getTestDb();
  const [a, b] = [await createTestUser(), await createTestUser()];
  const now = new Date("2026-01-06T10:00:00Z");
  for (const u of [a, b]) await rel.ensureRelationship(db, u, now, deps.config.relationship);
  const spy = vi.spyOn(rel, "getParams").mockRejectedValueOnce(new Error("boom"));
  expect(await relationshipTick(deps, now)).toEqual({ users: 2, failed: 1 });
  spy.mockRestore();
});
