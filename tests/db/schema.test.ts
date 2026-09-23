import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { assertDisposableDatabase } from "@/db/admin";
import * as s from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";

const T = new Date("2026-01-05T09:00:00Z");

beforeEach(resetDb);
afterAll(closeTestDb);

async function seedEverything(userId: string) {
  const db = getTestDb();
  const [th] = await db.insert(s.thread).values({
    user_id: userId, title: "job interview", subject: "user", status: "open",
    opened_at: T, last_touched: T, stakes: "high",
  }).returning();
  const [en] = await db.insert(s.entity).values({
    user_id: userId, name: "Mia", type: "person", subject: "user", relation: "sister",
    salience: 0.8, first_seen: T, last_mentioned: T,
  }).returning();
  const [f] = await db.insert(s.fact).values({
    user_id: userId, subject: "user", kind: "event", content: "Mia starts university in October",
    embedding: vec(), entity_refs: [en!.id], thread_id: th!.id, created_at: T, status: "open",
    salience: 0.7, valence: 0.5, confidence: 0.95, source: "turn",
  }).returning();
  await db.insert(s.identity).values({
    user_id: userId, traits: {}, stances: {}, boundaries: [], humor_style: "dry", verbal_tics: [],
    speech_rules: [], mood_valence: 0, mood_arousal: 0.5, energy: 0.5, preoccupation: f!.id, baseline: {},
  });
  await db.insert(s.relationship).values({ user_id: userId, closeness: 0.1, trust: 0.1, tension: 0, cadence: {} });
  const turnId = crypto.randomUUID();
  await db.insert(s.session_log).values({
    id: turnId, user_id: userId, session_id: crypto.randomUUID(), role: "user", text: "hi", created_at: T,
  });
  await db.insert(s.retrieval_trace).values({
    user_id: userId, turn_id: turnId, fact_id: f!.id, sim: 0.9, fact_salience: 0.7,
    entity_salience: 0.8, recency: 1, score: 0.5, forced: false, created_at: T,
  });
  await db.insert(s.ego_tick).values({ user_id: userId, mood_valence: 0, mood_arousal: 0.5, energy: 0.5, reason: "test", created_at: T });
  await db.insert(s.reach_out_log).values({ user_id: userId, candidates: [], gate_results: {}, sent: false, created_at: T });
}

const domainTables = [
  s.fact, s.entity, s.thread, s.identity, s.relationship, s.session_log, s.retrieval_trace, s.ego_tick, s.reach_out_log,
] as const;

describe("schema", () => {
  test("every table accepts a row", async () => {
    const u = await createTestUser();
    await seedEverything(u);
    for (const table of domainTables) {
      const rows = await getTestDb().select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.user_id, u));
      expect(rows[0]!.n).toBeGreaterThan(0);
    }
  });

  test("deleting a user cascades to every table and leaves other users intact", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");
    await seedEverything(a);
    await seedEverything(b);
    await getTestDb().delete(s.user).where(eq(s.user.id, a));
    for (const table of domainTables) {
      const [ra] = await getTestDb().select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.user_id, a));
      const [rb] = await getTestDb().select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.user_id, b));
      expect(ra!.n).toBe(0);
      expect(rb!.n).toBeGreaterThan(0);
    }
  });

  test("CHECK constraints reject out-of-range salience", async () => {
    const u = await createTestUser();
    await expect(getTestDb().insert(s.entity).values({
      user_id: u, name: "x", type: "other", subject: "user", salience: 1.5, first_seen: T, last_mentioned: T,
    })).rejects.toThrow();
  });

  test("embedding dimension is enforced", async () => {
    const u = await createTestUser();
    await expect(getTestDb().insert(s.fact).values({
      user_id: u, subject: "user", kind: "trait", content: "x", embedding: [0.1, 0.2], created_at: T,
      status: "open", salience: 0.5, valence: 0, confidence: 0.9, source: "turn",
    })).rejects.toThrow();
  });

  test("no domain timestamp has a DEFAULT", async () => {
    const res = await getTestDb().execute(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type LIKE 'timestamp%' AND column_default IS NOT NULL`);
    expect(res.rows).toEqual([]);
  });
});

describe("assertDisposableDatabase", () => {
  test("allows _test and _eval, refuses anything else", () => {
    expect(() => assertDisposableDatabase("postgres://u:p@h:5432/spica_test")).not.toThrow();
    expect(() => assertDisposableDatabase("postgres://u:p@h:5432/spica_eval")).not.toThrow();
    expect(() => assertDisposableDatabase("postgres://u:p@h:5432/spica")).toThrow(/refusing/);
    expect(() => assertDisposableDatabase("postgres://u:p@h:5432/prod_test_backup")).toThrow(/refusing/);
  });
});
