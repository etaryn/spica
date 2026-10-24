import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { fact, user } from "@/db/schema";
import { renderTimes, tokenDates } from "@/mind/platform/time-anchors";
import {
  candidateFacts,
  getFact,
  insertFact,
  listUnreadFacts,
  nearFacts,
} from "@/db/repos/user/facts";
import { adminDecayFacts } from "@/db/repos/admin/decay";
import { setTimezone } from "@/db/repos/user/users";
import {
  latestNonSensitiveSummary,
  latestNonSensitiveModel,
  liveBeliefs,
  liveModel,
  nearestBeliefSimilarity,
  supersedeBelief,
  claimRun,
  finishRun,
  insertRun,
  liveIdeas,
  liveSummary,
  recentReflections,
  retireIdeas,
  userLocalDate,
  type Trigger,
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
  kind: "reflection" | "idea" | "event" | "summary",
  at: Date,
  content: string = kind,
  payload: object | null = null,
) {
  return insertFact(getTestDb(), userId, {
    payload,
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

test("live ideas are open and not yet stale, newest first", async () => {
  const u = await createTestUser();
  const old = await put(u, "idea", new Date(T0.getTime() - 4 * DAY), "old");
  await getTestDb()
    .update(fact)
    .set({ stale_after: new Date(T0.getTime() - DAY) })
    .where(eq(fact.id, old.id));
  const a = await put(u, "idea", new Date(T0.getTime() - DAY), "a");
  const b = await put(u, "idea", T0, "b");
  const ideas = await liveIdeas(getTestDb(), u, T0, 5);
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
  expect(await liveIdeas(getTestDb(), other, T0, 5)).toHaveLength(1);
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
  const control = await insertFact(getTestDb(), u, {
    subject: "shared",
    kind: "event",
    content: "they watched a film together",
    embedding: vec(),
    created_at: T0,
    status: "open",
    salience: 0.5,
    valence: 0,
    confidence: 0.8,
    source: "turn",
  });
  const near = (await nearFacts(getTestDb(), u, "shared", vec(), 10, -1)).map((n) => n.id);
  expect(near).toEqual([control.id]);
});

test("group-scoped reflections, ideas and summaries are never read as hers", async () => {
  const u = await createTestUser();
  for (const kind of ["reflection", "idea", "summary"] as const) {
    await insertFact(getTestDb(), u, {
      subject: "shared",
      kind,
      content: kind,
      embedding: vec(),
      created_at: T0,
      status: "open",
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: "generated",
      scope: "group",
    });
  }
  expect(await recentReflections(getTestDb(), u, 5)).toEqual([]);
  expect(await liveIdeas(getTestDb(), u, T0, 5)).toEqual([]);
  expect(await liveSummary(getTestDb(), u)).toBeNull();
});

test("latestNonSensitiveSummary skips sensitive summaries, live or not", async () => {
  const u = await createTestUser();
  const plain = await put(u, "summary", T0, "plain");
  await getTestDb().update(fact).set({ status: "superseded" }).where(eq(fact.id, plain.id));
  await put(u, "summary", new Date(T0.getTime() + 60_000), "crisis", { sensitive: true });
  expect((await latestNonSensitiveSummary(getTestDb(), u))?.id).toBe(plain.id);
  expect(await latestNonSensitiveSummary(getTestDb(), await createTestUser("other"))).toBeNull();
});

test("her model stays out of retrieval and decay; gists, models and beliefs are never reconcile neighbours or new memories", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const old = new Date("2025-12-01T09:00:00Z");
  const add = (kind: "episode" | "model" | "belief") =>
    insertFact(db, u, {
      subject: kind === "episode" ? "shared" : "user",
      kind,
      content: `A ${kind}.`,
      embedding: vec(),
      created_at: old,
      status: kind === "episode" ? "recurring" : "open",
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: "generated",
    });
  const episode = await add("episode");
  const model = await add("model");
  const belief = await add("belief");

  const retrieved = (await candidateFacts(db, u, vec(), 10)).map((f) => f.id);
  expect(retrieved).toContain(episode.id);
  expect(retrieved).toContain(belief.id);
  expect(retrieved).not.toContain(model.id);
  expect(await nearFacts(db, u, "user", vec(), 10, 0)).toEqual([]);
  expect(await nearFacts(db, u, "shared", vec(), 10, 0)).toEqual([]);
  expect(await listUnreadFacts(db, u, { since: new Date(0), clean: false, limit: 10 })).toEqual([]);

  await adminDecayFacts(db, new Date("2026-01-05T09:00:00Z"), {
    grace_days: 3,
    rate: 0.5,
    stale_floor: 0.05,
    dormant_after_days: 30,
  });
  expect((await getFact(db, u, model.id))!.salience).toBe(0.5);
  expect((await getFact(db, u, belief.id))!.salience).toBeLessThan(0.5);
  expect((await getFact(db, u, episode.id))!.salience).toBeLessThan(0.5);
});

test("the live model, the newest non-sensitive model, beliefs by weight, and belief supersede", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const other = await createTestUser();
  const at = (ms: number) => new Date(Date.UTC(2026, 0, 5, 9, 0, 0, ms));
  const add = (
    userId: string,
    kind: "model" | "belief",
    content: string,
    extra: Partial<Parameters<typeof insertFact>[2]> = {},
  ) =>
    insertFact(db, userId, {
      subject: "user",
      kind,
      content,
      embedding: vec(),
      created_at: at(0),
      status: "open",
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: "generated",
      ...extra,
    });
  const plain = await add(u, "model", "Plain read.", { status: "superseded" });
  const heavy = await add(u, "model", "Heavy read.", {
    payload: { sensitive: true },
    created_at: at(1),
  });
  expect((await liveModel(db, u))!.id).toBe(heavy.id);
  expect((await latestNonSensitiveModel(db, u))!.id).toBe(plain.id);

  const low = await add(u, "belief", "Low.", { salience: 0.2 });
  const high = await add(u, "belief", "High.", { salience: 0.9 });
  await add(u, "belief", "Gone.", { status: "superseded" });
  const theirs = await add(other, "belief", "Theirs.");
  expect((await liveBeliefs(db, u, 10)).map((b) => b.id)).toEqual([high.id, low.id]);
  expect(await nearestBeliefSimilarity(db, u, vec())).toBeCloseTo(1);
  expect(await nearestBeliefSimilarity(db, await createTestUser(), vec())).toBeNull();

  expect(await supersedeBelief(db, u, low.id, high.id)).toBe(true);
  expect(await supersedeBelief(db, u, low.id, high.id)).toBe(false);
  expect(await supersedeBelief(db, u, theirs.id, high.id)).toBe(false);
  expect(await supersedeBelief(db, u, "not-a-uuid", high.id)).toBe(false);
});

test("a milestone run is recorded past the daily cap; others are capped", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const at = new Date("2026-01-05T09:00:00Z");
  const add = (ref: string, triggers: Trigger[]) =>
    insertRun(db, u, { sourceRef: ref, triggers, localDate: "2026-01-05", now: at, cap: 1 });
  await add("a", [{ kind: "salient_fact", salience: 0.9 }]);
  expect((await add("b", [{ kind: "salient_fact", salience: 0.9 }]))?.status).toBe("capped");
  expect((await add("c", [{ kind: "milestone", name: "first_inside_joke" }]))?.status).toBe(
    "pending",
  );
});

const summaryRow = (content: string, at: Date) => ({
  subject: "shared" as const,
  kind: "summary" as const,
  content,
  payload: { whats_live: content, sensitive: true },
  embedding: vec(),
  created_at: at,
  status: "open" as const,
  salience: 0.5,
  valence: 0,
  confidence: 0.6,
  source: "generated" as const,
});

test("insertFact anchors content and payload strings in the user's zone; no or a bad zone is UTC", async () => {
  const u = await createTestUser();
  const at = new Date("2026-01-12T23:30:00Z"); // Monday 23:30 UTC, Tuesday 07:30 in Singapore
  const utc = await insertFact(getTestDb(), u, summaryRow("Sister visits tomorrow.", at));
  expect(tokenDates(utc.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-13");
  expect((utc.payload as { whats_live: string }).whats_live).toBe(utc.content);
  expect((utc.payload as { sensitive: boolean }).sensitive).toBe(true);
  await setTimezone(getTestDb(), u, "Asia/Singapore");
  const sg = await insertFact(getTestDb(), u, summaryRow("Sister visits tomorrow.", at));
  expect(renderTimes(sg.content, at, 6)).toBe("Sister visits tomorrow, Wednesday 14 January.");
  await getTestDb().update(user).set({ timezone: "Mars/Olympus" }).where(eq(user.id, u));
  const bad = await insertFact(getTestDb(), u, summaryRow("Sister visits tomorrow.", at));
  expect(tokenDates(bad.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-13");
});

test("insertFact takes hints: a weekday matches a shown date", async () => {
  const u = await createTestUser();
  const row = await insertFact(
    getTestDb(),
    u,
    summaryRow("Race Sunday.", new Date("2026-01-14T09:00:00Z")), // Wednesday
    { known: [new Date("2026-01-11T08:00:00Z")] },
  );
  expect(tokenDates(row.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-11");
});

test("an inside joke or ritual is stored as said, never dated", async () => {
  const u = await createTestUser();
  const content = "Their goodnight ritual is saying see you tomorrow, same time.";
  const row = await insertFact(getTestDb(), u, {
    ...summaryRow(content, new Date("2026-01-12T09:00:00Z")),
    kind: "idiolect",
    payload: null,
  });
  expect(row.content).toBe(content);
});

test("a row's own date is a date its words were shown (the 16b seed)", async () => {
  const u = await createTestUser();
  const sunday = new Date("2026-01-04T10:00:00Z");
  const race = await insertFact(getTestDb(), u, {
    ...summaryRow("The user is running a half marathon on Sunday morning.", sunday),
    kind: "event",
    occurred_at: new Date("2026-01-11T09:00:00Z"),
  });
  expect(tokenDates(race.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-11");
  const sister = await insertFact(getTestDb(), u, {
    ...summaryRow("The user's sister is visiting on the weekend.", sunday),
    kind: "event",
    occurred_at: new Date("2026-01-17T12:00:00Z"),
  });
  expect(tokenDates(sister.content)[0]!.toISOString().slice(0, 10)).toBe("2026-01-17");
});
