import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { assertDisposableDatabase } from "@/db/admin";
import * as s from "@/db/schema";
import { core_goal, core_loop_trace, core_state } from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";

const T = new Date("2026-01-05T09:00:00Z");

beforeEach(resetDb);
afterAll(closeTestDb);

async function seedEverything(userId: string) {
  const db = getTestDb();
  const [th] = await db
    .insert(s.thread)
    .values({
      user_id: userId,
      title: "job interview",
      subject: "user",
      status: "open",
      opened_at: T,
      last_touched: T,
      stakes: "high",
    })
    .returning();
  const [en] = await db
    .insert(s.entity)
    .values({
      user_id: userId,
      name: "Mia",
      type: "person",
      subject: "user",
      relation: "sister",
      salience: 0.8,
      first_seen: T,
      last_mentioned: T,
    })
    .returning();
  const [f] = await db
    .insert(s.fact)
    .values({
      user_id: userId,
      subject: "user",
      kind: "event",
      content: "Mia starts university in October",
      embedding: vec(),
      entity_refs: [en!.id],
      thread_id: th!.id,
      created_at: T,
      status: "open",
      salience: 0.7,
      valence: 0.5,
      confidence: 0.95,
      source: "turn",
    })
    .returning();
  await db.insert(s.relationship).values({ user_id: userId, cadence: {} });
  const turnId = crypto.randomUUID();
  await db.insert(s.session_log).values({
    id: turnId,
    user_id: userId,
    session_id: crypto.randomUUID(),
    role: "user",
    text: "hi",
    created_at: T,
  });
  await db.insert(s.relationship_param).values({
    user_id: userId,
    name: "hurt",
    value: 0,
    baseline: 0,
    variance: 0.01,
    updated_at: T,
  });
  await db
    .insert(s.relationship_event)
    .values({ user_id: userId, cause: "signal", detail: {}, created_at: T });
  await db.insert(s.retrieval_trace).values({
    user_id: userId,
    turn_id: turnId,
    fact_id: f!.id,
    sim: 0.9,
    fact_salience: 0.7,
    entity_salience: 0.8,
    recency: 1,
    score: 0.5,
    forced: false,
    created_at: T,
  });
  await db
    .insert(s.reach_out_log)
    .values({ user_id: userId, candidates: [], gate_results: {}, sent: false, created_at: T });
  await db.insert(s.judge_log).values({
    user_id: userId,
    kind: "guard",
    turn_id: turnId,
    attempt: 1,
    input: {},
    output: {},
    outcome: "passed",
    source: "model",
    latency_ms: 1,
    model: "m",
    prompt_version: "guard@v1",
    created_at: T,
  });
  await db.insert(s.conversation_state).values({ user_id: userId, updated_at: T });
}

const domainTables = [
  s.fact,
  s.entity,
  s.thread,
  s.relationship,
  s.relationship_param,
  s.relationship_event,
  s.session_log,
  s.retrieval_trace,
  s.reach_out_log,
  s.judge_log,
  s.conversation_state,
] as const;

describe("schema", () => {
  test("every table accepts a row", async () => {
    const u = await createTestUser();
    await seedEverything(u);
    for (const table of domainTables) {
      const rows = await getTestDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.user_id, u));
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
      const [ra] = await getTestDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.user_id, a));
      const [rb] = await getTestDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.user_id, b));
      expect(ra!.n).toBe(0);
      expect(rb!.n).toBeGreaterThan(0);
    }
  });

  test("CHECK constraints reject out-of-range salience", async () => {
    const u = await createTestUser();
    await expect(
      getTestDb().insert(s.entity).values({
        user_id: u,
        name: "x",
        type: "other",
        subject: "user",
        salience: 1.5,
        first_seen: T,
        last_mentioned: T,
      }),
    ).rejects.toThrow();
  });

  test("embedding dimension is enforced", async () => {
    const u = await createTestUser();
    await expect(
      getTestDb()
        .insert(s.fact)
        .values({
          user_id: u,
          subject: "user",
          kind: "trait",
          content: "x",
          embedding: [0.1, 0.2],
          created_at: T,
          status: "open",
          salience: 0.5,
          valence: 0,
          confidence: 0.9,
          source: "turn",
        }),
    ).rejects.toThrow();
  });

  test("no domain timestamp has a DEFAULT", async () => {
    const res = await getTestDb().execute(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type LIKE 'timestamp%' AND column_default IS NOT NULL`);
    expect(res.rows).toEqual([]);
  });
});

describe("phase 1 schema", () => {
  test("fact gains kinds, inferred source, scope/recall_count defaults", async () => {
    const u = await createTestUser();
    const [f] = await getTestDb()
      .insert(s.fact)
      .values({
        user_id: u,
        subject: "user",
        kind: "promise",
        content: "The user promised to call Mia on Sunday.",
        embedding: vec(),
        created_at: T,
        status: "open",
        salience: 0.5,
        valence: 0.2,
        confidence: 0.9,
        source: "inferred",
      })
      .returning();
    expect(f!.scope).toBe("private");
    expect(f!.recall_count).toBe(0);
    expect(f!.space_id).toBeNull();
    await getTestDb().insert(s.fact).values({
      user_id: u,
      subject: "user",
      kind: "feeling",
      content: "The user feels nervous about the interview.",
      embedding: vec(),
      created_at: T,
      status: "open",
      salience: 0.6,
      valence: -0.4,
      confidence: 0.8,
      source: "turn",
    });
  });

  test("session_log.extract_attempts defaults to 0; user.timezone is settable", async () => {
    const u = await createTestUser();
    const [t] = await getTestDb()
      .insert(s.session_log)
      .values({
        id: crypto.randomUUID(),
        user_id: u,
        session_id: crypto.randomUUID(),
        role: "user",
        text: "hi",
        created_at: T,
      })
      .returning();
    expect(t!.extract_attempts).toBe(0);
    await getTestDb().update(s.user).set({ timezone: "Europe/London" }).where(eq(s.user.id, u));
    const [row] = await getTestDb()
      .select({ tz: s.user.timezone })
      .from(s.user)
      .where(eq(s.user.id, u));
    expect(row!.tz).toBe("Europe/London");
  });
});

describe("assertDisposableDatabase", () => {
  test("allows _test and _eval, refuses anything else", () => {
    expect(() => assertDisposableDatabase("postgres://u:p@h:5432/spica_test")).not.toThrow();
    expect(() => assertDisposableDatabase("postgres://u:p@h:5432/spica_eval")).not.toThrow();
    expect(() => assertDisposableDatabase("postgres://u:p@h:5432/spica")).toThrow(/refusing/);
    expect(() => assertDisposableDatabase("postgres://u:p@h:5432/prod_test_backup")).toThrow(
      /refusing/,
    );
  });
});

const CORE_TABLES = [
  "core_memory",
  "core_entity",
  "core_state",
  "core_goal",
  "core_snapshot",
  "world_event",
  "life_event_log",
  "core_loop_trace",
];

test("core tables exist and none has a user_id column", async () => {
  const db = getTestDb();
  const tables = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN (${sql.join(
      CORE_TABLES.map((n) => sql`${n}`),
      sql`, `,
    )})`);
  expect(tables.rows.map((r) => r.table_name).sort()).toEqual([...CORE_TABLES].sort());

  const userCols = await db.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'user_id' AND table_name IN (${sql.join(
      CORE_TABLES.map((n) => sql`${n}`),
      sql`, `,
    )})`);
  expect(userCols.rows).toEqual([]);
});

test("core_state holds exactly one row", async () => {
  const db = getTestDb();
  await resetDb();
  const insert = (id: number) =>
    db.execute(sql`
      INSERT INTO core_state (id, emotion, mood_valence, mood_arousal, energy, needs, baseline)
      VALUES (${id}, '{}'::jsonb, 0, 0.4, 0.6, '{}'::jsonb, '{}'::jsonb)`);
  await insert(1);
  await expect(insert(2)).rejects.toThrow();
});

test("core_goal stores a goal with progress in [0, 1]", async () => {
  const db = getTestDb();
  const now = new Date("2026-01-05T00:00:00Z");
  const [row] = await db
    .insert(core_goal)
    .values({
      title: "Learn the winter constellations",
      why: "She keeps pointing at Orion and getting it wrong.",
      status: "active",
      progress: 0.2,
      embedding: vec(),
      source: "seed",
      source_ref: null,
      started_at: now,
      target_at: null,
      updated_at: now,
    })
    .returning();
  expect(row).toMatchObject({ status: "active", progress: 0.2, source: "seed" });
  await expect(
    db.update(core_goal).set({ progress: 1.5 }).where(eq(core_goal.id, row!.id)),
  ).rejects.toThrow();
});

test("core_loop_trace records calls, status and error", async () => {
  const db = getTestDb();
  const [row] = await db
    .insert(core_loop_trace)
    .values({
      loop: "core_appraise",
      inputs: {},
      outputs: {},
      model: null,
      prompt_version: null,
      tokens_in: null,
      tokens_out: null,
      cost: null,
      calls: 2,
      status: "fallback",
      error: "TimeoutError",
      created_at: new Date("2026-01-05T00:00:00Z"),
    })
    .returning();
  expect(row).toMatchObject({ calls: 2, status: "fallback", error: "TimeoutError" });
});

test("core_state.emotion may be null", async () => {
  const db = getTestDb();
  await db.insert(core_state).values({
    id: 1,
    emotion: null,
    mood_valence: 0,
    mood_arousal: 0.4,
    energy: 0.6,
    needs: { autonomy: 0.6, competence: 0.6 },
    baseline: { mood_valence: 0, mood_arousal: 0.4, energy: 0.6 },
  });
  expect((await db.select().from(core_state))[0]!.emotion).toBeNull();
});
