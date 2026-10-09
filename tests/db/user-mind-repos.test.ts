import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { candidateFacts, insertFact, listRememberedFacts, nearFacts } from "@/db/repos/user/facts";
import { setTimezone } from "@/db/repos/user/users";
import {
  claimRun,
  finishRun,
  insertRun,
  liveIdeas,
  liveSummary,
  recentReflections,
  retireIdeas,
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

const T0 = new Date("2026-01-05T12:00:00Z");
const DAY = 86_400_000;

async function put(
  userId: string,
  kind: "reflection" | "idea" | "event",
  at: Date,
  content: string = kind,
) {
  return insertFact(getTestDb(), userId, {
    subject: kind === "event" ? "user" : "shared",
    kind,
    content,
    embedding: vec(),
    created_at: at,
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: kind === "event" ? "turn" : "generated",
  });
}

test("live ideas are open and newer than the cut-off, newest first", async () => {
  const u = await createTestUser();
  const old = await put(u, "idea", new Date(T0.getTime() - 4 * DAY), "old");
  const a = await put(u, "idea", new Date(T0.getTime() - DAY), "a");
  const b = await put(u, "idea", T0, "b");
  const ideas = await liveIdeas(getTestDb(), u, new Date(T0.getTime() - 3 * DAY), 5);
  expect(ideas.map((i) => i.id)).toEqual([b.id, a.id]);
  expect(ideas.some((i) => i.id === old.id)).toBe(false);
});

test("retiring is idempotent and touches only open ideas of this user", async () => {
  const u = await createTestUser();
  const other = await createTestUser();
  const idea = await put(u, "idea", T0);
  const event = await put(u, "event", T0);
  const foreign = await put(other, "idea", T0);
  expect(await retireIdeas(getTestDb(), u, [idea.id, event.id, foreign.id])).toBe(1);
  expect(await retireIdeas(getTestDb(), u, [idea.id])).toBe(0);
  expect(await retireIdeas(getTestDb(), u, [])).toBe(0);
  expect(await liveIdeas(getTestDb(), other, new Date(0), 5)).toHaveLength(1);
});

test("recent reflections, newest first", async () => {
  const u = await createTestUser();
  const r1 = await put(u, "reflection", T0);
  const r2 = await put(u, "reflection", new Date(T0.getTime() + 1000));
  expect((await recentReflections(getTestDb(), u, 5)).map((r) => r.id)).toEqual([r2.id, r1.id]);
});

test("retrieval reads reflections but not ideas; reconcile reads neither", async () => {
  const u = await createTestUser();
  const r = await put(u, "reflection", T0);
  const i = await put(u, "idea", T0);
  const ranked = await candidateFacts(getTestDb(), u, vec(), 10);
  expect(ranked.map((c) => c.id)).toContain(r.id);
  expect(ranked.map((c) => c.id)).not.toContain(i.id);
  expect(await nearFacts(getTestDb(), u, "shared", vec(), 10, -1)).toEqual([]);
});

test("the memory view lists reflections and ideas", async () => {
  const u = await createTestUser();
  await put(u, "reflection", T0);
  await put(u, "idea", T0);
  const kinds = (await listRememberedFacts(getTestDb(), u)).map((f) => f.kind);
  expect(kinds).toEqual(expect.arrayContaining(["reflection", "idea"]));
});
