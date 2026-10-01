import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import type { Logger } from "@/mind/platform/log";
import { relationshipTick, tickUser } from "@/mind/state/user/relationship/daily-tick";
import { localMidnight } from "@/mind/platform/timezone";
import * as rel from "@/db/repos/relationship";
import { insertTurn } from "@/db/repos/session-log";
import { setTimezone } from "@/db/repos/users";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../../helpers/db";
import { makeTestDeps } from "../../../../helpers/deps";

function captureLog() {
  const lines: { msg: string; meta?: Record<string, unknown> }[] = [];
  const log: Logger = {
    info: (msg, meta) => lines.push({ msg, meta }),
    error: (msg, meta) => lines.push({ msg, meta }),
  };
  return { log, lines };
}

const HOUR = 3_600_000;

/** Runs `tickUser` once per hour, `count` hourly cron steps starting at `start`. Returns
 * the sequence of `last_tick` values read back after each step, so a test can count how many times it changed. */
async function hourlySteps(
  deps: ReturnType<typeof makeTestDeps>,
  userId: string,
  start: Date,
  count: number,
): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (let k = 0; k < count; k++) {
    await tickUser(deps, userId, new Date(start.getTime() + k * HOUR));
    out.push((await rel.getRelationshipRow(deps.db, userId))?.last_tick ?? null);
  }
  return out;
}

beforeEach(resetDb);
afterAll(closeTestDb);

test("samples yesterday's count once per local date, per user", async () => {
  const deps = makeTestDeps();
  const db = getTestDb();
  const u = await createTestUser();
  const day1 = new Date("2026-01-05T10:00:00Z");
  await rel.ensureRelationship(db, u, day1, deps.config.relationship);
  const session = randomUUID();
  for (let i = 0; i < 40; i++)
    await insertTurn(db, u, {
      id: randomUUID(),
      session_id: session,
      role: "user",
      text: `m${i}`,
      created_at: new Date(day1.getTime() + i * 60_000),
    });
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

test("a failure wrapped by an infrastructure error still logs the innermost cause's class name", async () => {
  const { log, lines } = captureLog();
  const deps = { ...makeTestDeps(), log };
  const db = getTestDb();
  const u = await createTestUser();
  const now = new Date("2026-01-06T10:00:00Z");
  await rel.ensureRelationship(db, u, now, deps.config.relationship);
  class DrizzleQueryError extends Error {}
  const spy = vi
    .spyOn(rel, "getParams")
    .mockRejectedValueOnce(new DrizzleQueryError("wrapped", { cause: new TypeError("boom") }));
  expect(await relationshipTick(deps, now)).toEqual({ users: 1, failed: 1 });
  spy.mockRestore();
  expect(lines).toEqual([
    { msg: "relationship tick failed", meta: { userId: u, error: "TypeError" } },
    { msg: "relationship tick", meta: { users: 1, failed: 1 } },
  ]);
});

test("hour < tick_local_hour is a no-op: no events, no last_tick write", async () => {
  const deps = makeTestDeps();
  const db = getTestDb();
  const u = await createTestUser();
  const day1 = new Date("2026-01-05T00:00:00Z"); // UTC user (no timezone set)
  await rel.ensureRelationship(db, u, day1, deps.config.relationship);
  expect(deps.config.relationship.tick_local_hour).toBe(4);
  await tickUser(deps, u, new Date("2026-01-06T03:00:00Z")); // hour 3 local (UTC): before the gate
  expect((await rel.getRelationshipRow(db, u))?.last_tick).toBeNull();
  expect(await rel.listRelationshipEvents(db, u, 10)).toHaveLength(0);
});

test("a second run on the same local date is a no-op", async () => {
  const deps = makeTestDeps();
  const db = getTestDb();
  const u = await createTestUser();
  const day1 = new Date("2026-01-05T00:00:00Z");
  await rel.ensureRelationship(db, u, day1, deps.config.relationship);
  await tickUser(deps, u, new Date("2026-01-06T10:00:00Z"));
  expect((await rel.getRelationshipRow(db, u))?.last_tick).toBe("2026-01-06");
  const eventsAfterFirst = (await rel.listRelationshipEvents(db, u, 100)).length;
  await tickUser(deps, u, new Date("2026-01-06T15:00:00Z")); // same local date, later hour
  expect((await rel.getRelationshipRow(db, u))?.last_tick).toBe("2026-01-06");
  expect(await rel.listRelationshipEvents(db, u, 100)).toHaveLength(eventsAfterFirst);
});

test("DST spring-forward date (America/New_York) gets exactly one tick across 24 hourly runs", async () => {
  const deps = makeTestDeps();
  const db = getTestDb();
  const u = await createTestUser();
  const day0 = new Date("2026-01-05T00:00:00Z");
  await rel.ensureRelationship(db, u, day0, deps.config.relationship);
  await setTimezone(db, u, "America/New_York");
  // Seed last_tick to the day before the transition date, as if ticked normally the previous local day.
  await tickUser(
    deps,
    u,
    new Date(localMidnight("2026-03-07", "America/New_York").getTime() + 4 * HOUR),
  );
  expect((await rel.getRelationshipRow(db, u))?.last_tick).toBe("2026-03-07");

  const start = localMidnight("2026-03-08", "America/New_York"); // the spring-forward date itself
  const sequence = await hourlySteps(deps, u, start, 24);
  const ticks = sequence.filter((v, i) => v !== (i === 0 ? "2026-03-07" : sequence[i - 1]));
  expect(ticks).toEqual(["2026-03-08"]);
  expect(sequence.at(-1)).toBe("2026-03-08");
});

test("DST fall-back date (America/New_York) gets exactly one tick across 24 hourly runs", async () => {
  const deps = makeTestDeps();
  const db = getTestDb();
  const u = await createTestUser();
  const day0 = new Date("2026-01-05T00:00:00Z");
  await rel.ensureRelationship(db, u, day0, deps.config.relationship);
  await setTimezone(db, u, "America/New_York");
  await tickUser(
    deps,
    u,
    new Date(localMidnight("2026-10-31", "America/New_York").getTime() + 4 * HOUR),
  );
  expect((await rel.getRelationshipRow(db, u))?.last_tick).toBe("2026-10-31");

  const start = localMidnight("2026-11-01", "America/New_York"); // the fall-back date itself
  const sequence = await hourlySteps(deps, u, start, 24);
  const ticks = sequence.filter((v, i) => v !== (i === 0 ? "2026-10-31" : sequence[i - 1]));
  expect(ticks).toEqual(["2026-11-01"]);
  expect(sequence.at(-1)).toBe("2026-11-01");
});
