import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { runColdPath, LockBusyError } from "@/mind/process/cold-path/cold-path";
import { ScriptedEmbedder } from "@/mind/platform/embedder/scripted";
import { getParams } from "@/db/repos/user/relationship";
import { getTurn, insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import {
  closeTestDb,
  createTestUser,
  getTestDb,
  resetDb,
  testDbUrl,
  vec,
} from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (min: number) => new Date(Date.UTC(2026, 0, 5, 9, min));

async function exchange(
  userId: string,
  userText: string,
  reply: string,
  min: number,
  flagged = false,
) {
  const db = getTestDb();
  const ut = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: userText,
    created_at: at(min),
  });
  const ct = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: ut.session_id,
    role: "companion",
    text: reply,
    created_at: at(min),
    reply_to: ut.id,
    safety_flag: flagged ? { flagged: true, category: "self_harm", source: "classifier" } : null,
  });
  return { ut, ct, job: { userId, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] } };
}

function depsWith() {
  const deps = { ...makeTestDeps(), embedder: new ScriptedEmbedder(1024) };
  deps.llm.handlers.extract = (input: string) => ({
    facts:
      input.includes("New exchange") && input.includes("Biscuit")
        ? [
            {
              subject: "user",
              kind: "trait",
              content: "The user's dog is called Biscuit.",
              occurred_at: null,
              salience: 0.8,
              valence: 0.6,
              confidence: 0.95,
              entity_names: ["Biscuit"],
              thread_title: null,
            },
          ]
        : [],
    entities: [{ name: "Biscuit", aliases: [], type: "pet", subject: "user", relation: "dog" }],
    threads: [],
    relationship: null,
  });
  return deps;
}

test("extracts, embeds, reconciles and applies in one go; turns marked extracted", async () => {
  const deps = depsWith();
  const u = await createTestUser();
  const { job } = await exchange(u, "my dog Biscuit ate my headphones", "iconic", 0);
  const out = await runColdPath(deps, job);
  expect(out.status).toBe("done");
  expect(out.applied).toMatchObject({ inserted: 1, entitiesCreated: 1 });
  const facts = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(facts.map((f) => f.content)).toEqual(["The user's dog is called Biscuit."]);
  const turns = await getTestDb().select().from(s.session_log).where(eq(s.session_log.user_id, u));
  expect(turns.every((t) => t.extracted)).toBe(true);
});

test("idempotent: a second run is skipped and makes no LLM call", async () => {
  const deps = depsWith();
  const u = await createTestUser();
  const { job } = await exchange(u, "my dog Biscuit", "cute", 0);
  await runColdPath(deps, job);
  const calls = deps.llm.structuredCalls.length;
  expect((await runColdPath(deps, job)).status).toBe("skipped");
  expect(deps.llm.structuredCalls.length).toBe(calls);
});

test("atomic: an embedder failure writes nothing and leaves turns unextracted", async () => {
  const deps = depsWith();
  deps.embedder.failNext = true;
  const u = await createTestUser();
  const { job } = await exchange(u, "my dog Biscuit", "cute", 0);
  await expect(runColdPath(deps, job)).rejects.toThrow();
  expect(await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u))).toEqual([]);
  expect(await getTestDb().select().from(s.entity).where(eq(s.entity.user_id, u))).toEqual([]);
  const turns = await getTestDb().select().from(s.session_log).where(eq(s.session_log.user_id, u));
  expect(turns.some((t) => t.extracted)).toBe(false);
});

test("atomic: a failure mid-write (after facts/entities/recall write-back) leaves nothing changed", async () => {
  const deps = depsWith();
  const u = await createTestUser();
  const recalledFact = await getTestDb()
    .insert(s.fact)
    .values({
      user_id: u,
      subject: "user",
      kind: "trait",
      content: "Old memory.",
      embedding: vec(),
      created_at: at(0),
      status: "open",
      salience: 0.5,
      valence: 0,
      confidence: 1,
      source: "turn",
    })
    .returning();
  const { job } = await exchange(u, "my dog Biscuit", "cute", 0);
  // markExtracted's UPDATE on session_log is encodeExtraction's last write. A trigger that
  // raises there fires only after entities, facts and the recall write-back have already
  // run in the same (still-open) transaction, so this proves the whole write is atomic and
  // not just that a failure before any write leaves nothing behind.
  const trigger = new Client({ connectionString: testDbUrl });
  await trigger.connect();
  try {
    await trigger.query(`
      CREATE OR REPLACE FUNCTION cold_path_test_fail() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'cold_path_test_fail: forced mid-write failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await trigger.query(`
      CREATE TRIGGER cold_path_test_fail_trigger
      BEFORE UPDATE ON session_log
      FOR EACH ROW EXECUTE FUNCTION cold_path_test_fail();
    `);
    await expect(
      runColdPath(deps, {
        ...job,
        recalled: [
          {
            factId: recalledFact[0]!.id,
            sim: 0.6,
            fact_salience: 0.5,
            entity_salience: 1,
            recency: 1,
            score: 0.25,
            forced: false,
          },
        ],
      }),
    ).rejects.toThrow();

    const facts = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
    expect(facts.map((f) => f.content)).toEqual(["Old memory."]);
    expect(await getTestDb().select().from(s.entity).where(eq(s.entity.user_id, u))).toEqual([]);
    const turns = await getTestDb()
      .select()
      .from(s.session_log)
      .where(eq(s.session_log.user_id, u));
    expect(turns.every((t) => !t.extracted)).toBe(true);
    const [reloaded] = await getTestDb()
      .select()
      .from(s.fact)
      .where(eq(s.fact.id, recalledFact[0]!.id));
    expect(reloaded!.recall_count).toBe(recalledFact[0]!.recall_count);
    expect(reloaded!.salience).toBe(recalledFact[0]!.salience);
    expect(reloaded!.last_recalled_at).toEqual(recalledFact[0]!.last_recalled_at);
  } finally {
    await trigger.query("DROP TRIGGER IF EXISTS cold_path_test_fail_trigger ON session_log");
    await trigger.query("DROP FUNCTION IF EXISTS cold_path_test_fail()");
    await trigger.end();
  }
});

test("a busy per-user lock rejects with LockBusyError", async () => {
  const deps = depsWith();
  const u = await createTestUser();
  const { job } = await exchange(u, "my dog Biscuit", "cute", 0);
  const holder = new Client({ connectionString: testDbUrl });
  await holder.connect();
  await holder.query("SELECT pg_advisory_lock(hashtext($1))", [`cold_path:${u}`]);
  try {
    await expect(runColdPath(deps, job)).rejects.toBeInstanceOf(LockBusyError);
  } finally {
    await holder.query("SELECT pg_advisory_unlock_all()");
    await holder.end();
  }
});

test("context turns are passed as context; crisis exchange marks facts sensitive; recall write-back applied", async () => {
  const deps = depsWith();
  const u = await createTestUser();
  await exchange(u, "earlier chat", "sure", 0);
  const recalledFact = await getTestDb()
    .insert(s.fact)
    .values({
      user_id: u,
      subject: "user",
      kind: "trait",
      content: "Old memory.",
      embedding: vec(),
      created_at: at(0),
      status: "open",
      salience: 0.5,
      valence: 0,
      confidence: 1,
      source: "turn",
    })
    .returning();
  const { job } = await exchange(
    u,
    "Biscuit is all I have right now, i want to end it",
    "i'm here",
    1,
    true,
  );
  const out = await runColdPath(deps, {
    ...job,
    recalled: [
      {
        factId: recalledFact[0]!.id,
        sim: 0.6,
        fact_salience: 0.5,
        entity_salience: 1,
        recency: 1,
        score: 0.25,
        forced: false,
      },
    ],
  });
  expect(out.applied!.recalledUpdated).toBe(1);
  const input = deps.llm.structuredCalls.find((c) => c.purpose === "extract")!.input;
  expect(input.indexOf("earlier chat")).toBeLessThan(input.indexOf("New exchange"));
  const [f] = await getTestDb()
    .select()
    .from(s.fact)
    .where(sql`${s.fact.content} LIKE 'The user''s dog%'`);
  expect(f!.payload).toEqual({ sensitive: true });
});

test("an exchange with no user turn (a reach-out) extracts but touches neither relationship nor her core state", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const c = await insertTurn(getTestDb(), u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "companion",
    text: "finally finished Solaris",
    created_at: at(0),
    trigger: "reach_out",
  });
  const updateRelationship = vi.fn();
  deps.llm.handlers.extract = () => ({
    facts: [],
    entities: [],
    threads: [],
    relationship: {
      warmth: 0.9,
      trust: 0,
      tension: 0,
      hurt: null,
      apology: false,
      make_up: false,
      ends_relationship: false,
      retracts_ending: false,
      wants_repair: false,
    },
  });
  const out = await runColdPath({ ...deps, updateRelationship } as never, {
    userId: u,
    turnIds: [c.id],
    replyTurnId: c.id,
    recalled: [],
  });
  expect(out.status).toBe("done");
  expect(updateRelationship).not.toHaveBeenCalled();
  expect(await deps.core.state.get()).toBeNull();
  expect((await getTurn(getTestDb(), u, c.id))?.extracted).toBe(true);
});

test("an emotional exchange moves the user's affect and never touches core state", async () => {
  const deps = depsWith();
  deps.llm.handlers.extract = () => ({
    facts: [
      {
        subject: "user",
        kind: "event",
        content: "The user got a promotion.",
        occurred_at: null,
        salience: 0.5,
        valence: 0.9,
        confidence: 1,
        entity_names: [],
        thread_title: null,
      },
    ],
    entities: [],
    threads: [],
    relationship: null,
  });
  const u = await createTestUser();
  const { job } = await exchange(u, "i got promoted!", "that's great", 0);
  const before = await deps.core.state.get();
  await runColdPath(deps, job);
  const params = await getParams(getTestDb(), u);
  expect(params.affect_valence.value).toBeGreaterThan(0.5);
  expect(params.afterglow.value).toBeGreaterThan(0);
  expect(await deps.core.state.get()).toEqual(before);
});

const emotionalFact = (subject: "user" | "self" | "shared", content: string, valence: number) => ({
  subject,
  kind: "event" as const,
  content,
  occurred_at: null,
  salience: 0.5,
  valence,
  confidence: 1,
  entity_names: [],
  thread_title: null,
});

test("her own emotional news doesn't colour how she feels about them", async () => {
  const deps = depsWith();
  deps.llm.handlers.extract = () => ({
    facts: [emotionalFact("self", "Spica's telescope images finally arrived.", 0.9)],
    entities: [],
    threads: [],
    relationship: null,
  });
  const u = await createTestUser();
  const { job } = await exchange(u, "how's your day?", "my telescope images came!!", 0);
  await runColdPath(deps, job);
  const params = await getParams(getTestDb(), u);
  expect(params.affect_valence.value).toBe(0.5);
  expect(params.afterglow.value).toBe(0);
});

test("her own reaction to what they did isn't counted on top of it", async () => {
  const run = async (facts: ReturnType<typeof emotionalFact>[]) => {
    const deps = depsWith();
    deps.llm.handlers.extract = () => ({ facts, entities: [], threads: [], relationship: null });
    const u = await createTestUser();
    const { job } = await exchange(u, "whatever", "ok", 0);
    await runColdPath(deps, job);
    return (await getParams(getTestDb(), u)).affect_valence.value;
  };
  const one = await run([emotionalFact("user", "The user mocked her taste in films.", -0.8)]);
  const withHerReaction = await run([
    emotionalFact("user", "The user mocked her taste in films.", -0.8),
    emotionalFact("self", "Spica laughed it off.", 0.4),
  ]);
  expect(withHerReaction).toBe(one);
  expect(one).toBeLessThan(0.5);
});

/** Her three claim kinds in one exchange, with core grounding scripted to `sim` (or failing). */
function selfClaimDeps(sim: number | Error) {
  const deps = { ...makeTestDeps(), embedder: new ScriptedEmbedder(1024) };
  deps.llm.handlers.extract = (input: string) => ({
    facts: input.includes("New exchange")
      ? (["life", "opinion", "reaction"] as const).map((claim_kind) => ({
          subject: "self",
          kind: "event",
          content: `Spica claim ${claim_kind}.`,
          occurred_at: null,
          salience: 0.5,
          valence: 0,
          confidence: 0.9,
          entity_names: [],
          thread_title: null,
          claim_kind,
        }))
      : [],
    entities: [],
    threads: [],
    relationship: null,
  });
  deps.core.memory.groundingSimilarity = async () => {
    if (sim instanceof Error) throw sim;
    return sim;
  };
  return deps;
}

test("life and opinion claims are graded against core; reactions aren't", async () => {
  const u = await createTestUser();
  await runColdPath(selfClaimDeps(0.9), (await exchange(u, "what did you do?", "stars", 0)).job);
  const rows = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  const by = Object.fromEntries(rows.map((r) => [r.claim_kind, r.grounded]));
  expect(by).toEqual({ life: true, opinion: true, reaction: null });
});

test("an ungrounded claim is marked false; a grounding error leaves null and still writes", async () => {
  const u1 = await createTestUser();
  await runColdPath(selfClaimDeps(0.1), (await exchange(u1, "a", "b", 0)).job);
  const r1 = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u1));
  expect(r1.find((r) => r.claim_kind === "life")?.grounded).toBe(false);

  const u2 = await createTestUser();
  const broken = selfClaimDeps(new Error("db down"));
  const out = await runColdPath(broken, (await exchange(u2, "a", "b", 1)).job);
  expect(out.status).toBe("done");
  const r2 = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u2));
  expect(r2).toHaveLength(3);
  expect(r2.every((r) => r.grounded === null)).toBe(true);
});

test("a duplicate claim leaves the existing fact's grading alone", async () => {
  const deps = selfClaimDeps(0.9);
  const u = await createTestUser();
  await runColdPath(deps, (await exchange(u, "a", "b", 0)).job);
  deps.core.memory.groundingSimilarity = async () => 0.1;
  deps.llm.handlers.reconcile = (input: string) => ({
    relation: "duplicate",
    target_fact_id: /id=([0-9a-f-]{36})/.exec(input)?.[1] ?? null,
  });
  await runColdPath(deps, (await exchange(u, "c", "d", 5)).job);
  const rows = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(rows.filter((r) => r.claim_kind === "life").map((r) => r.grounded)).toEqual([true]);
});
