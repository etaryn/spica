import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { insertFact } from "@/db/repos/user/facts";
import { setTimezone } from "@/db/repos/user/users";
import {
  claimRun,
  finishRun,
  insertRun,
  liveSummary,
  userLocalDate,
} from "@/db/repos/user/user-mind";
import { adminStalePendingRuns } from "@/db/repos/admin/user-mind";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T09:00:00Z");
const trig = [{ kind: "make_up_done" as const }];
const run = (userId: string, sourceRef: string, cap = 3) =>
  insertRun(getTestDb(), userId, { sourceRef, triggers: trig, localDate: "2026-01-05", now, cap });

test("a source_ref records one run; a repeat records nothing", async () => {
  const u = await createTestUser();
  expect((await run(u, "exchange:a"))?.status).toBe("pending");
  expect(await run(u, "exchange:a")).toBeNull();
});

test("past the daily cap a run is recorded capped", async () => {
  const u = await createTestUser();
  for (const ref of ["a", "b"]) await run(u, `exchange:${ref}`, 2);
  expect((await run(u, "exchange:c", 2))?.status).toBe("capped");
  // Capped rows don't count toward the cap.
  expect((await run(u, "exchange:d", 2))?.status).toBe("capped");
});

test("the cap is per user", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  await run(a, "exchange:a", 1);
  expect((await run(b, "exchange:b", 1))?.status).toBe("pending");
});

test("claim moves pending to running once", async () => {
  const u = await createTestUser();
  const row = (await run(u, "exchange:a"))!;
  expect((await claimRun(getTestDb(), row.id))?.status).toBe("running");
  expect(await claimRun(getTestDb(), row.id)).toBeNull();
  await finishRun(getTestDb(), row.id, "done", now);
  const res = await getTestDb().execute(sql`SELECT status, finished_at FROM user_mind_run`);
  expect(res.rows[0]).toMatchObject({ status: "done" });
  expect(res.rows[0]!.finished_at).not.toBeNull();
});

test("stale pending runs are found across users, newer ones are not", async () => {
  const u = await createTestUser();
  const row = (await run(u, "exchange:a"))!;
  expect(await adminStalePendingRuns(getTestDb(), new Date(now.getTime() + 1), 10)).toEqual([
    { id: row.id, user_id: u },
  ]);
  expect(await adminStalePendingRuns(getTestDb(), now, 10)).toEqual([]);
});

test("the live summary is the newest active summary fact", async () => {
  const u = await createTestUser();
  expect(await liveSummary(getTestDb(), u)).toBeNull();
  const base = {
    subject: "shared" as const,
    kind: "summary" as const,
    embedding: vec(),
    created_at: now,
    status: "open" as const,
    salience: 0.6,
    valence: 0,
    confidence: 0.7,
    source: "generated" as const,
  };
  await insertFact(getTestDb(), u, { ...base, content: "old", status: "superseded" });
  await insertFact(getTestDb(), u, { ...base, content: "live" });
  expect((await liveSummary(getTestDb(), u))?.content).toBe("live");
});

test("a missing or invalid timezone falls back to UTC for the local date", async () => {
  const u = await createTestUser();
  await setTimezone(getTestDb(), u, "Not/AZone");
  expect(await userLocalDate(getTestDb(), u, new Date("2026-01-05T23:30:00Z"))).toBe("2026-01-05");
  await setTimezone(getTestDb(), u, "Asia/Singapore");
  expect(await userLocalDate(getTestDb(), u, new Date("2026-01-05T23:30:00Z"))).toBe("2026-01-06");
});
