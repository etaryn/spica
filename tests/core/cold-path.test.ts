import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeEach, expect, test } from "vitest";
import { handleColdPath, LockBusyError } from "@/core/cold-path";
import { ScriptedEmbedder } from "@/core/embed/scripted";
import { insertTurn } from "@/db/repos/session-log";
import * as s from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb, testDbUrl, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (min: number) => new Date(Date.UTC(2026, 0, 5, 9, min));

async function exchange(userId: string, userText: string, reply: string, min: number, flagged = false) {
  const db = getTestDb();
  const ut = await insertTurn(db, userId, { id: randomUUID(), session_id: randomUUID(), role: "user", text: userText, created_at: at(min) });
  const ct = await insertTurn(db, userId, {
    id: randomUUID(), session_id: ut.session_id, role: "companion", text: reply, created_at: at(min), reply_to: ut.id,
    safety_flag: flagged ? { flagged: true, category: "self_harm", source: "classifier" } : null,
  });
  return { ut, ct, job: { userId, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] } };
}

function depsWith() {
  const deps = { ...makeTestDeps(), embedder: new ScriptedEmbedder(1024) };
  deps.llm.handlers.extract = (input: string) => ({
    facts: input.includes("New exchange") && input.includes("Biscuit")
      ? [{ subject: "user", kind: "trait", content: "The user's dog is called Biscuit.", occurred_at: null, salience: 0.8, valence: 0.6, confidence: 0.95, entity_names: ["Biscuit"], thread_title: null }]
      : [],
    entities: [{ name: "Biscuit", aliases: [], type: "pet", subject: "user", relation: "dog" }],
    threads: [],
  });
  return deps;
}

test("extracts, embeds, reconciles and applies in one go; turns marked extracted", async () => {
  const deps = depsWith();
  const u = await createTestUser();
  const { job } = await exchange(u, "my dog Biscuit ate my headphones", "iconic", 0);
  const out = await handleColdPath(deps, job);
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
  await handleColdPath(deps, job);
  const calls = deps.llm.structuredCalls.length;
  expect((await handleColdPath(deps, job)).status).toBe("skipped");
  expect(deps.llm.structuredCalls.length).toBe(calls);
});

test("atomic: an embedder failure writes nothing and leaves turns unextracted", async () => {
  const deps = depsWith();
  deps.embedder.failNext = true;
  const u = await createTestUser();
  const { job } = await exchange(u, "my dog Biscuit", "cute", 0);
  await expect(handleColdPath(deps, job)).rejects.toThrow();
  expect(await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u))).toEqual([]);
  expect(await getTestDb().select().from(s.entity).where(eq(s.entity.user_id, u))).toEqual([]);
  const turns = await getTestDb().select().from(s.session_log).where(eq(s.session_log.user_id, u));
  expect(turns.some((t) => t.extracted)).toBe(false);
});

test("a busy per-user lock rejects with LockBusyError", async () => {
  const deps = depsWith();
  const u = await createTestUser();
  const { job } = await exchange(u, "my dog Biscuit", "cute", 0);
  const holder = new Client({ connectionString: testDbUrl });
  await holder.connect();
  await holder.query("SELECT pg_advisory_lock(hashtext($1))", [`cold_path:${u}`]);
  try {
    await expect(handleColdPath(deps, job)).rejects.toBeInstanceOf(LockBusyError);
  } finally {
    await holder.query("SELECT pg_advisory_unlock_all()");
    await holder.end();
  }
});

test("context turns are passed as context; crisis exchange marks facts sensitive; recall write-back applied", async () => {
  const deps = depsWith();
  const u = await createTestUser();
  await exchange(u, "earlier chat", "sure", 0);
  const recalledFact = await getTestDb().insert(s.fact).values({
    user_id: u, subject: "user", kind: "trait", content: "Old memory.", embedding: vec(), created_at: at(0),
    status: "open", salience: 0.5, valence: 0, confidence: 1, source: "turn",
  }).returning();
  const { job } = await exchange(u, "Biscuit is all I have right now, i want to end it", "i'm here", 1, true);
  const out = await handleColdPath(deps, { ...job, recalled: [{ factId: recalledFact[0]!.id, sim: 0.5, fact_salience: 0.5, entity_salience: 1, recency: 1, score: 0.25, forced: false }] });
  expect(out.applied!.recalledUpdated).toBe(1);
  const input = deps.llm.structuredCalls.find((c) => c.purpose === "extract")!.input;
  expect(input.indexOf("earlier chat")).toBeLessThan(input.indexOf("New exchange"));
  const [f] = await getTestDb().select().from(s.fact).where(sql`${s.fact.content} LIKE 'The user''s dog%'`);
  expect(f!.payload).toEqual({ sensitive: true });
});
