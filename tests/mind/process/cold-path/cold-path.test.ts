import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { runColdPath, runColdPathJob, LockBusyError } from "@/mind/process/cold-path/cold-path";
import { getState } from "@/db/repos/user/conversation-state";
import { mutateState } from "@/mind/process/turn-taking/state";
import { ScriptedEmbedder } from "@/mind/platform/embedder/scripted";
import { getFact, insertFact } from "@/db/repos/user/facts";
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
import type { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { makeTestDeps } from "../../../helpers/deps";
import { newMessages, scriptedLabels, type ScriptedMemory } from "@/mind/platform/llm/fake-labels";

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

const script = (labels: Parameters<typeof scriptedLabels>[0]) => (deps: { llm: FakeLLMProvider }) =>
  Object.assign(deps.llm.handlers, scriptedLabels(labels));
const biscuit = script({
  memories: [
    {
      said: "Biscuit",
      label: "dog Biscuit",
      kind: "trait",
      salience: 0.8,
      valence: 0.6,
      confidence: 0.95,
      mention: { words: "Biscuit", name: "Biscuit", type: "pet", relation: "dog" },
    },
  ],
});

function depsWith() {
  const deps = { ...makeTestDeps(), embedder: new ScriptedEmbedder(1024) };
  biscuit(deps);
  return deps;
}

test("labels, embeds, reconciles and applies in one go; turns marked extracted", async () => {
  const deps = depsWith();
  const u = await createTestUser();
  const { ut, job } = await exchange(u, "my dog Biscuit ate my headphones", "iconic", 0);
  const out = await runColdPath(deps, job);
  expect(out.status).toBe("done");
  expect(out.applied).toMatchObject({ inserted: 1, entitiesCreated: 1 });
  const facts = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(facts.map((f) => f.content)).toEqual([
    'dog Biscuit — the user said "my dog Biscuit ate my headphones"',
  ]);
  const turns = await getTestDb().select().from(s.session_log).where(eq(s.session_log.user_id, u));
  expect(turns.every((t) => t.extracted)).toBe(true);
  // Both messages got a move, and the memory points back at its fact.
  const labels = await getTestDb()
    .select()
    .from(s.annotation)
    .where(eq(s.annotation.session_id, ut.session_id));
  expect(labels.map((l) => l.layer).sort()).toEqual(["mention", "move", "move", "proposition"]);
  expect(labels.find((l) => l.layer === "proposition")!.fact_id).toBe(facts[0]!.id);
});

test("her reply in the same minute as their message is labelled after it", async () => {
  const deps = depsWith();
  const u = await createTestUser();
  const { job } = await exchange(u, "my dog Biscuit", "cute", 0);
  await runColdPath(deps, job);
  const read = deps.llm.structuredCalls.find((c) => c.purpose === "labels_read")!.input;
  expect(read).toMatch(/\[1\.1\] User[^\n]*my dog Biscuit\n\[2\.1\] Spica[^\n]*cute/);
  expect(read).toContain("Label the new messages (1 to 2).");
});

test("a memory that updates an earlier one supersedes it by id, with no reconcile call", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const first = await exchange(u, "interview is thursday", "good luck", 0);
  script({ memories: [{ id: "p-int", said: "thursday", label: "job interview" }] })(deps);
  await runColdPath(deps, first.job);
  const db = getTestDb();
  const ut = await insertTurn(db, u, {
    id: randomUUID(),
    session_id: first.ut.session_id,
    role: "user",
    text: "they moved it to friday",
    created_at: at(5),
  });
  const ct = await insertTurn(db, u, {
    id: randomUUID(),
    session_id: first.ut.session_id,
    role: "companion",
    text: "oh!",
    created_at: at(5),
    reply_to: ut.id,
  });
  script({
    memories: [
      {
        id: "p-moved",
        said: "moved it",
        label: "job interview",
        updates: "p-int",
        status: "planned",
      },
    ],
  })(deps);
  const reconciles = () => deps.llm.structuredCalls.filter((c) => c.purpose === "reconcile").length;
  const before = reconciles();
  await runColdPath(deps, { userId: u, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] });
  expect(reconciles()).toBe(before);
  // The second call saw what the first labelled.
  const read = deps.llm.structuredCalls.filter((c) => c.purpose === "labels_meaning").at(-1)!;
  expect(read.input).toContain('p-int user event "job interview"');
  const rows = await db.select().from(s.fact).where(eq(s.fact.user_id, u));
  const old = rows.find((r) => r.content.includes("interview is thursday"))!;
  const moved = rows.find((r) => r.content.includes("they moved it to friday"))!;
  expect(old).toMatchObject({ status: "superseded", superseded_by: moved.id });
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
    // The job still throws it, so pg-boss retries: no prompt has run yet.
    await expect(runColdPathJob(deps, job)).rejects.toBeInstanceOf(LockBusyError);
  } finally {
    await holder.query("SELECT pg_advisory_unlock_all()");
    await holder.end();
  }
});

test("any other failure is never retried: the job logs it and counts it on the exchange", async () => {
  const deps = depsWith();
  // The second of the three calls fails, after the first already labelled the exchange.
  deps.llm.handlers.labels_meaning = () => {
    throw new Error("Failed to parse structured output");
  };
  const error = vi.spyOn(deps.log, "error");
  const u = await createTestUser();
  const { ct, job } = await exchange(u, "my dog Biscuit", "cute", 0);
  await expect(runColdPathJob(deps, job)).resolves.toBeUndefined();
  expect(error).toHaveBeenCalledWith("cold_path failed", { userId: u, error: "Error" });
  const row = await getTurn(getTestDb(), u, ct.id);
  expect(row).toMatchObject({ extracted: false, extract_attempts: 1 });
  expect(await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u))).toEqual([]);
  expect(await getTestDb().select().from(s.annotation).where(eq(s.annotation.user_id, u))).toEqual(
    [],
  );
  // Nothing is asked again.
  expect(deps.llm.structuredCalls.map((c) => c.purpose)).toEqual(["labels_read", "labels_meaning"]);
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
  const input = deps.llm.structuredCalls.filter((c) => c.purpose === "labels_read").at(-1)!.input;
  expect(input.indexOf("earlier chat")).toBeGreaterThan(-1);
  expect(input.indexOf("earlier chat")).toBeLessThan(input.indexOf("Biscuit is all I have"));
  expect(input).toContain("Label the new messages (3 to 4).");
  const [f] = await getTestDb()
    .select()
    .from(s.fact)
    .where(sql`${s.fact.content} LIKE 'dog Biscuit%'`);
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
  script({
    memories: [{ said: "Solaris", label: "finished Solaris", status: "happened" }],
    relationship: { warmth: 0.9 },
  })(deps);
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
  // Her words are still labelled and remembered as hers.
  const [memory] = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(memory).toMatchObject({
    subject: "self",
    content: 'finished Solaris, happened — Spica said "finally finished Solaris"',
  });
  const labels = await getTestDb().select().from(s.annotation).where(eq(s.annotation.user_id, u));
  expect(labels.map((l) => l.layer).sort()).toEqual(["move", "proposition"]);
});

test("an emotional exchange moves the user's affect and never touches core state", async () => {
  const deps = depsWith();
  script({
    memories: [
      { said: "promoted", label: "promotion", salience: 0.5, valence: 0.9, confidence: 1 },
    ],
  })(deps);
  const u = await createTestUser();
  const { job } = await exchange(u, "i got promoted!", "that's great", 0);
  const before = await deps.core.state.get();
  await runColdPath(deps, job);
  const params = await getParams(getTestDb(), u);
  expect(params.affect_valence.value).toBeGreaterThan(0.5);
  expect(params.afterglow.value).toBeGreaterThan(0);
  expect(await deps.core.state.get()).toEqual(before);
});

const emotionalFact = (said: string, label: string, valence: number): ScriptedMemory => ({
  said,
  label,
  salience: 0.5,
  valence,
  confidence: 1,
});

test("her own emotional news doesn't colour how she feels about them", async () => {
  const deps = depsWith();
  script({ memories: [emotionalFact("telescope images", "telescope images arrived", 0.9)] })(deps);
  const u = await createTestUser();
  const { job } = await exchange(u, "how's your day?", "my telescope images came!!", 0);
  await runColdPath(deps, job);
  const params = await getParams(getTestDb(), u);
  expect(params.affect_valence.value).toBe(0.5);
  expect(params.afterglow.value).toBe(0);
});

test("her own reaction to what they did isn't counted on top of it", async () => {
  const run = async (memories: ScriptedMemory[]) => {
    const deps = depsWith();
    script({ memories })(deps);
    const u = await createTestUser();
    const { job } = await exchange(u, "your films are pretentious", "ha, fair", 0);
    await runColdPath(deps, job);
    return (await getParams(getTestDb(), u)).affect_valence.value;
  };
  const one = await run([emotionalFact("pretentious", "mocked her taste in films", -0.8)]);
  const withHerReaction = await run([
    emotionalFact("pretentious", "mocked her taste in films", -0.8),
    emotionalFact("fair", "laughed it off", 0.4),
  ]);
  expect(withHerReaction).toBe(one);
  expect(one).toBeLessThan(0.5);
});

/** Her three claim kinds in one exchange, with core grounding scripted to `sim` (or failing). */
function selfClaimDeps(sim: number | Error) {
  const deps = { ...makeTestDeps(), embedder: new ScriptedEmbedder(1024) };
  script((input) => {
    const hers = newMessages(input).find((m) => m.speaker === "spica");
    return {
      memories: hers
        ? (["life", "opinion", "reaction"] as const).map((claim_kind) => ({
            said: hers.text,
            label: `claim ${claim_kind}`,
            salience: 0.5,
            claim_kind,
          }))
        : [],
    };
  })(deps);
  deps.core.memory.groundingMatch = async () => {
    if (sim instanceof Error) throw sim;
    return {
      similarity: sim,
      ref: { kind: "memory", id: "00000000-0000-4000-8000-000000000001", depth: 1 },
    };
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
  deps.core.memory.groundingMatch = async () => ({ similarity: 0.1, ref: null });
  deps.llm.handlers.reconcile = (input: string) => ({
    relation: "duplicate",
    target_fact_id: /id=([0-9a-f-]{36})/.exec(input)?.[1] ?? null,
  });
  // The same claim said again, in the same words.
  await runColdPath(deps, (await exchange(u, "c", "b", 5)).job);
  const rows = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(rows.filter((r) => r.claim_kind === "life").map((r) => r.grounded)).toEqual([true]);
});

test("a salient new fact records one user mind run and enqueues it after commit", async () => {
  const deps = depsWith();
  const userId = await createTestUser();
  const { job, ct } = await exchange(userId, "my dog is called Biscuit", "cute!", 1);
  const out = await runColdPath(deps, job);
  expect(out.userMindRunId).toBeTruthy();
  const runs = await getTestDb().execute(
    sql`SELECT source_ref, status, triggers FROM user_mind_run`,
  );
  expect(runs.rows).toEqual([
    expect.objectContaining({ source_ref: `exchange:${ct.id}`, status: "pending" }),
  ]);
  expect(deps.queue.jobs.filter((j) => j.name === "user_mind_run")).toHaveLength(1);
});

test("a reach-out on its own records no run, even with a salient fact of hers", async () => {
  const deps = depsWith();
  const userId = await createTestUser();
  const c = await insertTurn(getTestDb(), userId, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "companion",
    text: "my dog Biscuit did a trick",
    created_at: at(0),
    trigger: "reach_out",
  });
  const out = await runColdPath(deps, {
    userId,
    turnIds: [c.id],
    replyTurnId: c.id,
    recalled: [],
  });
  expect(out.applied?.insertedFacts.length).toBeGreaterThan(0);
  expect(out.userMindRunId).toBeNull();
  const runs = await getTestDb().execute(sql`SELECT count(*)::int AS n FROM user_mind_run`);
  expect(runs.rows[0]!.n).toBe(0);
});

test("a retried cold path for the same exchange records no second run", async () => {
  const deps = depsWith();
  const userId = await createTestUser();
  const { job } = await exchange(userId, "my dog is called Biscuit", "cute!", 1);
  await runColdPath(deps, job);
  await getTestDb().update(s.session_log).set({ extracted: false });
  await runColdPath(deps, job);
  const runs = await getTestDb().execute(sql`SELECT count(*)::int AS n FROM user_mind_run`);
  expect(runs.rows[0]!.n).toBe(1);
  expect(deps.queue.jobs.filter((j) => j.name === "user_mind_run")).toHaveLength(1);
});

test("a crisis exchange records no run", async () => {
  const deps = depsWith();
  const userId = await createTestUser();
  const { job } = await exchange(userId, "my dog is called Biscuit", "here for you", 1, true);
  await runColdPath(deps, job);
  const runs = await getTestDb().execute(sql`SELECT count(*)::int AS n FROM user_mind_run`);
  expect(runs.rows[0]!.n).toBe(0);
});

test("an ordinary exchange records no run", async () => {
  const deps = depsWith();
  const userId = await createTestUser();
  const { job } = await exchange(userId, "hey", "hey you", 1);
  await runColdPath(deps, job);
  const runs = await getTestDb().execute(sql`SELECT count(*)::int AS n FROM user_mind_run`);
  expect(runs.rows[0]!.n).toBe(0);
});

test("ideas the reply offered are resolved, once, even when the job is retried", async () => {
  const deps = depsWith();
  const u = await createTestUser();
  const idea = await insertFact(getTestDb(), u, {
    subject: "shared",
    kind: "idea",
    content: "Ask how the audition went.",
    embedding: vec(),
    created_at: at(0),
    status: "open",
    salience: 0.6,
    valence: 0,
    confidence: 0.7,
    source: "generated",
  });
  const { job } = await exchange(u, "hi", "hey", 1);
  const withIdeas = { ...job, offeredIdeas: [idea.id] };
  await runColdPath(deps, withIdeas);
  await getTestDb().execute(sql`UPDATE session_log SET extracted = false`);
  await runColdPath(deps, withIdeas);
  expect((await getFact(getTestDb(), u, idea.id))!.status).toBe("resolved");
});

const SECRET = "Spica is scared Alcor will outgrow her.";

/** A reply written under `limits`, then the cold path for it; her claim is the core memory's text. */
async function tell(
  deps: ReturnType<typeof makeTestDeps>,
  u: string,
  limits: { open: number; peek: number } | null,
  min: number,
  flagged = false,
) {
  const db = getTestDb();
  const ut = await insertTurn(db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "do you ever feel left behind?",
    created_at: at(min),
    safety_flag: flagged ? { flagged: true, category: "self_harm", source: "classifier" } : null,
  });
  const ct = await insertTurn(db, u, {
    id: randomUUID(),
    session_id: ut.session_id,
    role: "companion",
    text: "honestly? about alcor, yeah",
    created_at: at(min),
    reply_to: ut.id,
    depth: limits ? { ...limits, held_back: null } : null,
  });
  await runColdPath(deps, { userId: u, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] });
  return ct;
}

function ledgerDeps() {
  const deps = makeTestDeps();
  script({
    memories: [
      {
        said: "about alcor",
        label: "scared Alcor will outgrow her",
        kind: "feeling",
        salience: 0.6,
        valence: -0.4,
        claim_kind: "life",
      },
    ],
  })(deps);
  deps.llm.handlers.reconcile = (input: string) => ({
    relation: /id=([0-9a-f-]{36})/.test(input) ? "duplicate" : "new",
    target_fact_id: /id=([0-9a-f-]{36})/.exec(input)?.[1] ?? null,
  });
  return deps;
}

async function seedSecret(deps: ReturnType<typeof makeTestDeps>) {
  const [embedding] = await deps.embedder.embed([SECRET], "document");
  const id = await deps.core.memory.insert({
    kind: "reflection",
    content: SECRET,
    embedding: embedding!,
    occurred_at: at(0),
    created_at: at(0),
    status: "recurring",
    salience: 0.6,
    valence: -0.4,
    confidence: 0.8,
    source: "loop",
    source_ref: null,
    depth: 3,
  });
  // Her claim is quoted in her own words, not the memory's, so it grounds on the secret by script.
  deps.core.memory.groundingMatch = async () => ({
    similarity: 1,
    ref: { kind: "memory", id, depth: 3 },
  });
  return id;
}

const ledgerOf = (u: string) =>
  getTestDb()
    .select()
    .from(s.disclosure)
    .where(eq(s.disclosure.user_id, u))
    .orderBy(s.disclosure.created_at);

test("a hint beyond her usual limit is recorded as a peek; telling it again, merged, makes it open", async () => {
  const deps = ledgerDeps();
  const id = await seedSecret(deps);
  const u = await createTestUser();
  const first = await tell(deps, u, { open: 1, peek: 3 }, 0);
  const rows = await ledgerOf(u);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    ref_kind: "memory",
    ref_id: id,
    depth: 3,
    level: "peek",
    turn_id: first.id,
  });
  expect(rows[0]!.fact_id).not.toBeNull();

  deps.clock.advance(60_000);
  await tell(deps, u, { open: 1, peek: 3 }, 5);
  const again = await ledgerOf(u);
  expect(again.map((r) => r.level)).toEqual(["peek", "open"]);
  expect(again[1]!.fact_id).toBe(rows[0]!.fact_id);
});

test("within her limit it is open; a reply with no stored limits counts as open", async () => {
  const deps = ledgerDeps();
  await seedSecret(deps);
  const [a, b] = [await createTestUser(), await createTestUser()];
  await tell(deps, a, { open: 3, peek: 3 }, 0);
  await tell(deps, b, null, 0);
  expect((await ledgerOf(a)).map((r) => r.level)).toEqual(["open"]);
  expect((await ledgerOf(b)).map((r) => r.level)).toEqual(["open"]);
});

test("a crisis exchange records nothing in the ledger", async () => {
  const deps = ledgerDeps();
  await seedSecret(deps);
  const u = await createTestUser();
  await tell(deps, u, { open: 1, peek: 1 }, 0, true);
  expect(await ledgerOf(u)).toEqual([]);
});

test("a claim that grounds on something deeper than she was shown records nothing", async () => {
  const deps = ledgerDeps();
  await seedSecret(deps);
  const u = await createTestUser();
  await tell(deps, u, { open: 1, peek: 1 }, 0);
  expect(await ledgerOf(u)).toEqual([]);
});

test("her reply's move to their question closes it; nothing else open changes", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const { ut, job } = await exchange(u, "did you finish the book?", "yes finally, last night", 0);
  const other = { coords: [{ turnId: randomUUID(), start: 0, end: 4 }] };
  await mutateState(deps.db, u, at(0), () => ({
    patch: { open_questions: [{ coords: [{ turnId: ut.id, start: 0, end: 24 }] }, other] },
    result: null,
  }));
  script({ replies: [{ said: "yes finally", to: "did you finish the book" }] })(deps);
  expect((await runColdPath(deps, job)).status).toBe("done");
  expect((await getState(getTestDb(), u))!.open_questions).toEqual([other]);
});

test("her reply that points at nothing leaves their question open", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const { ut, job } = await exchange(u, "did you finish the book?", "anyway, guess what", 0);
  const open = [{ coords: [{ turnId: ut.id, start: 0, end: 24 }] }];
  await mutateState(deps.db, u, at(0), () => ({ patch: { open_questions: open }, result: null }));
  script({})(deps);
  await runColdPath(deps, job);
  expect((await getState(getTestDb(), u))!.open_questions).toEqual(open);
});
