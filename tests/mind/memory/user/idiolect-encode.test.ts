/** Idiolect is a candidate until it comes up again in a later exchange. */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { establishIdiolect, insertFact } from "@/db/repos/user/facts";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

type D = ReturnType<typeof makeTestDeps>;
type Established = { idiolect: { established_at: string | null } };

const JOKE = "Spica and the user joke that every cloud is a whale.";
const SESSION = randomUUID();
const idiolectFact = (extra: object = {}) => ({
  subject: "shared",
  kind: "idiolect",
  content: JOKE,
  occurred_at: null,
  salience: 0.6,
  valence: 0.6,
  confidence: 0.9,
  entity_names: [],
  thread_title: null,
  claim_kind: null,
  idiolect_type: "joke",
  started_by: "user",
  ...extra,
});
const extracting = (d: D, fact: object) => {
  d.llm.handlers.extract = () => ({ facts: [fact], entities: [], threads: [], relationship: null });
};

/** One user message and her reply, then the cold path on them. Returns her reply's id. */
async function exchange(d: D, u: string): Promise<string> {
  d.clock.advance(60_000);
  const ut = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: SESSION,
    role: "user",
    text: "whale cloud again",
    created_at: d.clock.now(),
  });
  const ct = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: SESSION,
    role: "companion",
    text: "ha",
    created_at: d.clock.now(),
    reply_to: ut.id,
  });
  await runColdPath(d, { userId: u, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] });
  return ct.id;
}

const idiolects = (u: string) =>
  getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.kind, "idiolect")));

test("a joke starts as a candidate and is established when a later exchange calls it back", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  extracting(d, idiolectFact());
  await exchange(d, u);
  const [first] = await idiolects(u);
  expect(first!.payload).toMatchObject({
    idiolect: { type: "joke", started_by: "user", established_at: null },
  });

  d.llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: first!.id });
  await exchange(d, u);
  const rows = await idiolects(u);
  expect(rows).toHaveLength(1);
  expect((rows[0]!.payload as Established).idiolect.established_at).not.toBeNull();
});

test("a retry of the same exchange never establishes it", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  extracting(d, idiolectFact());
  const replyId = await exchange(d, u);
  const [first] = await idiolects(u);

  // The same exchange again (same source_ref), as a retried job would run it.
  await getTestDb().execute(sql`UPDATE session_log SET extracted = false WHERE user_id = ${u}`);
  d.llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: first!.id });
  const turnIds = (
    await getTestDb()
      .select({ id: s.session_log.id })
      .from(s.session_log)
      .where(eq(s.session_log.user_id, u))
  ).map((t) => t.id);
  await runColdPath(d, { userId: u, turnIds, replyTurnId: replyId, recalled: [] });

  const [row] = await idiolects(u);
  expect((row!.payload as Established).idiolect.established_at).toBeNull();
});

test("a duplicate of a non-idiolect shared fact establishes nothing", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const [embedding] = await d.embedder.embed([JOKE], "document");
  const plain = await insertFact(getTestDb(), u, {
    subject: "shared",
    kind: "event",
    content: JOKE,
    embedding: embedding!,
    entity_refs: [],
    created_at: d.clock.now(),
    salience: 0.5,
    valence: 0,
    confidence: 0.9,
    source: "turn",
    status: "open",
    source_ref: randomUUID(),
  });
  extracting(d, idiolectFact());
  d.llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: plain.id });
  await exchange(d, u);
  const [row] = await getTestDb().select().from(s.fact).where(eq(s.fact.id, plain.id));
  expect(row!.payload).toBeNull();
  // The joke is not swallowed by the plain fact: it starts as its own candidate.
  const [candidate] = await idiolects(u);
  expect(candidate!.payload).toMatchObject({ idiolect: { established_at: null } });
});

test("an idiolect fact is always between them, never her own claim", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  extracting(d, idiolectFact({ subject: "self", claim_kind: "reaction" }));
  await exchange(d, u);
  const [row] = await idiolects(u);
  expect(row!.subject).toBe("shared");
  expect(row!.claim_kind).toBeNull();
});

test("establishIdiolect keeps sensitive and fills a missing idiolect payload", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const [embedding] = await d.embedder.embed([JOKE], "document");
  const f = await insertFact(getTestDb(), u, {
    subject: "shared",
    kind: "idiolect",
    content: JOKE,
    payload: { sensitive: true },
    embedding: embedding!,
    entity_refs: [],
    created_at: d.clock.now(),
    salience: 0.5,
    valence: 0,
    confidence: 0.9,
    source: "turn",
    status: "open",
  });
  await establishIdiolect(getTestDb(), u, f.id, d.clock.now());
  const [row] = await getTestDb().select().from(s.fact).where(eq(s.fact.id, f.id));
  expect(row!.payload).toMatchObject({
    sensitive: true,
    idiolect: {
      type: "reference",
      started_by: "user",
      established_at: d.clock.now().toISOString(),
    },
  });
});

test("missing idiolect fields fall back to a reference the user started", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  extracting(d, idiolectFact({ idiolect_type: null, started_by: null }));
  await exchange(d, u);
  const [row] = await idiolects(u);
  expect(row!.payload).toMatchObject({ idiolect: { type: "reference", started_by: "user" } });
});

test("a fact of another kind carries no idiolect fields", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  extracting(d, idiolectFact({ kind: "event" }));
  await exchange(d, u);
  const [row] = await getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
  expect(row!.payload).toBeNull();
});
