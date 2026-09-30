import { afterAll, beforeEach, expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { forgetFact, insertFact } from "@/db/repos/facts";
import { getLifeView, getRelationshipView, listFacts, listJudgeLog, listReachOuts, parseFactFilters, resolveFactContents } from "@/db/repos/inspector";
import { insertJudgeLogs } from "@/db/repos/judge-log";
import { insertLifeDay } from "@/db/repos/life-day";
import { insertLifeEventLogs } from "@/db/repos/life-event-log";
import { insertReachOutLog } from "@/db/repos/reach-out";
import { ensureRelationship, insertRelationshipEvents } from "@/db/repos/relationship";
import * as s from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

async function addFact(userId: string, content: string, subject: "user" | "self", salience: number, day: number) {
  await getTestDb().insert(s.fact).values({
    user_id: userId, subject, kind: "event", content, embedding: vec(), created_at: new Date(Date.UTC(2026, 0, day)),
    status: "open", salience, valence: 0, confidence: 0.9, source: "turn",
  });
}

test("listFacts filters by subject, sorts, and is user-scoped", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  await addFact(a, "low old", "user", 0.2, 1);
  await addFact(a, "high new", "user", 0.9, 5);
  await addFact(a, "self fact", "self", 0.5, 3);
  await addFact(b, "b's fact", "user", 1, 9);

  const bySalience = await listFacts(getTestDb(), a, parseFactFilters({ subject: "user", sort: "salience" }));
  expect(bySalience.map((f) => f.content)).toEqual(["high new", "low old"]);
  const byRecency = await listFacts(getTestDb(), a, parseFactFilters({}));
  expect(byRecency.map((f) => f.content)).toEqual(["high new", "self fact", "low old"]);
  expect("embedding" in byRecency[0]!).toBe(false);
});

test("parseFactFilters ignores invalid values", () => {
  expect(parseFactFilters({ subject: "bogus", status: "open", entityId: "x", sort: "weird" }))
    .toEqual({ subject: undefined, status: "open", entityId: undefined, threadId: undefined, sort: "recency" });
});

test("resolveFactContents: user-scoped and view-time; a forgotten fact's judge_log row survives but resolves to nothing", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const f = await insertFact(getTestDb(), a, {
    subject: "user", kind: "trait", content: "The user's dog is called Biscuit.", embedding: vec(),
    created_at: new Date("2026-01-01T00:00:00Z"), status: "open", salience: 0.5, valence: 0, confidence: 0.9, source: "turn",
  });
  await insertJudgeLogs(getTestDb(), a, [{
    kind: "guard", turn_id: null, attempt: 1,
    input: { recalledFacts: [{ id: f.id, subject: "user" }], onboardingFacts: [], text: "hi" },
    output: { violations: [] }, outcome: "passed", source: "model", latency_ms: 5,
    model: "claude-haiku-4-5", prompt_version: "guard@v1", created_at: new Date("2026-01-05T00:00:00Z"),
  }]);

  expect(await resolveFactContents(getTestDb(), a, [f.id])).toEqual(new Map([[f.id, "The user's dog is called Biscuit."]]));
  // Another user's query never resolves this user's fact, even with the right id.
  expect(await resolveFactContents(getTestDb(), b, [f.id])).toEqual(new Map());

  expect(await forgetFact(getTestDb(), a, f.id)).toBe(true);

  // The judge_log row is untouched by the delete (no FK to fact); the resolver just can't find the id any more.
  const rows = await listJudgeLog(getTestDb(), a);
  expect(rows).toHaveLength(1);
  expect(await resolveFactContents(getTestDb(), a, [f.id])).toEqual(new Map());
});

test("getRelationshipView: faded params with effect, events newest first, user-scoped", async () => {
  const db = getTestDb();
  const cfg = loadConfig().relationship;
  const [a, b] = [await createTestUser(), await createTestUser()];
  const now = new Date("2026-01-05T10:00:00Z");
  await ensureRelationship(db, a, now, cfg);
  await insertRelationshipEvents(db, a, [{ param: "hurt", before: 0, after: 0.3, cause: "signal", deviation: 1, detail: {} }], { turnId: null, now });
  const v = await getRelationshipView(db, a, now, cfg);
  expect(v?.params.map((p) => p.name)).toEqual(["closeness", "trust", "warmth", "hurt", "tension", "msgs_per_day"]);
  expect(v?.events).toHaveLength(1);
  expect(await getRelationshipView(db, b, now, cfg)).toBeNull();
});

test("getLifeView shows today's plan, this user's generated facts and event log only", async () => {
  const db = getTestDb();
  const [a, b] = [await createTestUser("a"), await createTestUser("b")];
  const t0 = new Date("2026-01-05T10:00:00Z");
  await insertLifeDay(db, { date: "2026-01-05", plan: { blocks: [] }, source: "scripted", model: "none", prompt_version: "scripted", generated_at: t0 });
  await insertFact(db, a, { subject: "self", kind: "event", content: "Spica's morning: reading.", payload: { block: "busy" }, embedding: vec(), created_at: t0, status: "open", salience: 0.2, valence: 0, confidence: 1, source: "generated" });
  await insertLifeEventLogs(db, a, [{ life_day: "2026-01-05", attempt: 1, candidate: {}, decision: "accepted", target_fact_id: null, fact_id: null, model: "m", prompt_version: "v1", created_at: t0 }]);
  const va = await getLifeView(db, a, "2026-01-05");
  expect(va.plan?.date).toBe("2026-01-05");
  expect(va.facts.map((f) => f.content)).toEqual(["Spica's morning: reading."]);
  expect(va.log).toHaveLength(1);
  const vb = await getLifeView(db, b, "2026-01-05");
  expect(vb.facts).toEqual([]);
  expect(vb.log).toEqual([]);
});

test("listReachOuts returns status, topic, answered_at and turn, newest first, user-scoped", async () => {
  const db = getTestDb();
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const t = new Date("2026-01-05T09:00:00Z");
  await insertReachOutLog(db, a, { candidates: [], winner: null, gate_results: [], status: "none", topic: null, send_at: null, created_at: t });
  await insertReachOutLog(db, a, { candidates: [], winner: { kind: "thread" }, gate_results: [], status: "sent", topic: "thread:x", send_at: t, created_at: new Date(t.getTime() + 1) });
  await insertReachOutLog(db, b, { candidates: [], winner: null, gate_results: [], status: "none", topic: null, send_at: null, created_at: t });
  const rows = await listReachOuts(db, a, 200);
  expect(rows.map((r) => [r.status, r.topic])).toEqual([["sent", "thread:x"], ["none", null]]);
  expect(await listReachOuts(db, a, 1)).toHaveLength(1);
});
