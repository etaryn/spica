import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { applyExtraction, type ApplyInput } from "@/core/memory/apply";
import type { ExtractedFact } from "@/core/memory/extract";
import * as facts from "@/db/repos/facts";
import { findEntityByName } from "@/db/repos/entities";
import { insertTurn } from "@/db/repos/session-log";
import * as threads from "@/db/repos/threads";
import * as s from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const config = loadConfig();
const now = new Date("2026-01-12T09:00:00Z");
const db = () => getTestDb();
const f = (content: string, over: Partial<ExtractedFact> = {}): ExtractedFact => ({
  subject: "user", kind: "event", content, occurred_at: null, salience: 0.6, valence: 0, confidence: 0.9,
  entity_names: [], thread_title: null, ...over,
});

async function setup() {
  const u = await createTestUser();
  const ut = await insertTurn(db(), u, { id: randomUUID(), session_id: randomUUID(), role: "user", text: "x", created_at: now });
  const ct = await insertTurn(db(), u, { id: randomUUID(), session_id: ut.session_id, role: "companion", text: "y", created_at: now, reply_to: ut.id });
  const input = (over: Partial<ApplyInput>): ApplyInput => ({
    userId: u, now, exchangeAt: now, entities: [], facts: [], threads: [], sensitive: false, sourceRef: ct.id,
    recalled: [], replyTurnId: ct.id, turnIds: [ut.id, ct.id], ...over,
  });
  return { u, ut, ct, input };
}

async function seed(u: string, content: string, over: Partial<facts.NewFact> = {}) {
  return facts.insertFact(db(), u, { subject: "user", kind: "event", content, embedding: vec(), created_at: new Date("2026-01-01T00:00:00Z"), status: "open", salience: 0.5, valence: 0, confidence: 0.8, source: "turn", ...over });
}

describe("applyExtraction", () => {
  test("new fact: inserted with entities, thread, source_ref; turns marked extracted", async () => {
    const { u, ct, input } = await setup();
    const out = await applyExtraction(db(), config, input({
      entities: [{ name: "Mia", aliases: ["my sis"], type: "person", subject: "user", relation: "sister" }],
      threads: [{ action: "open", title: "Mia starting uni", subject: "user", stakes: "med", next_checkpoint: new Date("2026-10-02T09:00:00Z"), thread_id: null }],
      facts: [{ fact: f("The user's sister Mia starts university in October.", { entity_names: ["my sis"], thread_title: "mia starting UNI" }), embedding: vec(), decision: { relation: "new", targetId: null } }],
    }));
    expect(out).toMatchObject({ inserted: 1, entitiesCreated: 1, threadsOpened: 1 });
    const [row] = await db().select().from(s.fact).where(eq(s.fact.user_id, u));
    const mia = await findEntityByName(db(), u, "user", "Mia");
    const [t] = await threads.listOpenThreads(db(), u, 5);
    expect(row).toMatchObject({ entity_refs: [mia!.id], thread_id: t!.id, source: "turn", source_ref: ct.id, status: "open", payload: null });
    const turns = await db().select().from(s.session_log).where(eq(s.session_log.user_id, u));
    expect(turns.every((x) => x.extracted)).toBe(true);
  });

  test("duplicate bumps the target (capped), contradicts supersedes, resolves resolves", async () => {
    const { u, input } = await setup();
    const dup = await seed(u, "The user is allergic to cats.", { salience: 0.93 });
    const old = await seed(u, "Mia starts in October.");
    const plan = await seed(u, "The user has a driving test on Thursday.");
    const out = await applyExtraction(db(), config, input({ facts: [
      { fact: f("The user is allergic to cats.", { confidence: 0.99 }), embedding: vec(), decision: { relation: "duplicate", targetId: dup.id } },
      { fact: f("Mia starts in November."), embedding: vec(), decision: { relation: "contradicts", targetId: old.id } },
      { fact: f("The user passed their driving test."), embedding: vec(), decision: { relation: "resolves", targetId: plan.id } },
    ] }));
    expect(out).toMatchObject({ duplicates: 1, superseded: 1, resolved: 1, inserted: 2 });
    const d = await facts.getFact(db(), u, dup.id);
    expect(d!.salience).toBeCloseTo(0.95, 5);
    expect(d!.confidence).toBeCloseTo(0.99, 5);
    const o = await facts.getFact(db(), u, old.id);
    expect(o!.status).toBe("superseded");
    const replacement = await facts.getFact(db(), u, o!.superseded_by!);
    expect(replacement!.content).toBe("Mia starts in November.");
    expect((await facts.getFact(db(), u, plan.id))!.status).toBe("resolved");
  });

  test("inserted facts carry the exchange time; a contradiction older than its target is stored superseded by it", async () => {
    const { u, input } = await setup();
    const exchangeAt = new Date("2026-01-10T08:00:00Z");
    const newer = await seed(u, "Mia starts in December.", { created_at: new Date("2026-01-11T00:00:00Z") });
    const out = await applyExtraction(db(), config, input({ exchangeAt, facts: [
      { fact: f("Mia starts in November."), embedding: vec(), decision: { relation: "contradicts", targetId: newer.id } },
      { fact: f("The user likes tea."), embedding: vec(), decision: { relation: "new", targetId: null } },
    ] }));
    expect(out).toMatchObject({ inserted: 2, superseded: 1 });
    expect((await facts.getFact(db(), u, newer.id))!).toMatchObject({ status: "open", superseded_by: null });
    const rows = await db().select().from(s.fact).where(eq(s.fact.user_id, u));
    const late = rows.find((r) => r.content === "Mia starts in November.")!;
    expect(late).toMatchObject({ status: "superseded", superseded_by: newer.id });
    const tea = rows.find((r) => r.content === "The user likes tea.")!;
    expect(late.created_at.toISOString()).toBe(exchangeAt.toISOString());
    expect(tea.created_at.toISOString()).toBe(exchangeAt.toISOString());
  });

  test("recall write-back via apply: low-sim and forced recalls are traced but not reinforced", async () => {
    const { u, input } = await setup();
    const hi = await seed(u, "High.");
    const lo = await seed(u, "Low.");
    const fo = await seed(u, "Forced.");
    const rec = (id: string, sim: number, forced = false) => ({ factId: id, sim, fact_salience: 0.5, entity_salience: 1, recency: 1, score: 0.4, forced });
    const out = await applyExtraction(db(), config, input({
      recalled: [rec(hi.id, config.retrieval.reinforce_min_sim), rec(lo.id, config.retrieval.reinforce_min_sim - 0.01), rec(fo.id, 0.95, true)],
    }));
    expect(out.recalledUpdated).toBe(1);
    expect((await facts.getFact(db(), u, hi.id))!.recall_count).toBe(1);
    expect((await facts.getFact(db(), u, lo.id))!.recall_count).toBe(0);
    expect((await facts.getFact(db(), u, fo.id))!.recall_count).toBe(0);
    expect(await db().select().from(s.retrieval_trace)).toHaveLength(3);
  });

  test("foreign target id → inserted as new; foreign thread_id ignored", async () => {
    const { u, input } = await setup();
    const other = await createTestUser("other");
    const foreign = await seed(other, "Someone else's fact.");
    const foreignThread = await threads.insertThread(db(), other, { title: "their thing", subject: "user", stakes: "low", next_checkpoint: null }, now);
    const out = await applyExtraction(db(), config, input({
      threads: [{ action: "resolve", title: "their thing", subject: "user", stakes: "low", next_checkpoint: null, thread_id: foreignThread.id }],
      facts: [{ fact: f("A fact."), embedding: vec(), decision: { relation: "contradicts", targetId: foreign.id } }],
    }));
    expect(out).toMatchObject({ inserted: 1, superseded: 0 });
    expect((await facts.getFact(db(), other, foreign.id))!.status).toBe("open");
    expect((await threads.getOwnedThread(db(), other, foreignThread.id))!.status).toBe("open");
    expect(await threads.listOpenThreads(db(), u, 5)).toEqual([]);
  });

  test("case/alias variants link one entity; sensitive flag; recall write-back skips forgotten facts", async () => {
    const { u, ct, input } = await setup();
    const kept = await seed(u, "Kept memory.");
    const gone = await seed(u, "Forgotten memory.");
    await facts.forgetFact(db(), u, gone.id);
    const rec = (id: string) => ({ factId: id, sim: 0.9, fact_salience: 0.5, entity_salience: 1, recency: 1, score: 0.4, forced: false });
    const out = await applyExtraction(db(), config, input({
      sensitive: true,
      entities: [{ name: "MIA ", aliases: [], type: "person", subject: "user", relation: null }],
      facts: [{ fact: f("The user said Mia is struggling.", { entity_names: ["mia", "Mia"] }), embedding: vec(), decision: { relation: "new", targetId: null } }],
      recalled: [rec(kept.id), rec(gone.id)],
    }));
    expect(out.entitiesCreated).toBe(1);
    expect(out.recalledUpdated).toBe(1);
    const inserted = (await db().select().from(s.fact).where(eq(s.fact.source_ref, ct.id)))[0]!;
    expect(inserted.entity_refs).toHaveLength(1);
    expect(inserted.payload).toEqual({ sensitive: true });
  });

  test("touch updates the checkpoint of an owned thread; resolve by title", async () => {
    const { u, input } = await setup();
    const t = await threads.insertThread(db(), u, { title: "thesis deadline", subject: "user", stakes: "high", next_checkpoint: null }, new Date("2026-01-01T00:00:00Z"));
    const cp = new Date("2026-02-01T09:00:00Z");
    await applyExtraction(db(), config, input({ threads: [{ action: "touch", title: "thesis deadline", subject: "user", stakes: "high", next_checkpoint: cp, thread_id: t.id }] }));
    expect((await threads.getOwnedThread(db(), u, t.id))!.next_checkpoint!.toISOString()).toBe(cp.toISOString());
    await applyExtraction(db(), config, input({ threads: [{ action: "resolve", title: "Thesis Deadline", subject: "user", stakes: "high", next_checkpoint: null, thread_id: null }] }));
    expect((await threads.getOwnedThread(db(), u, t.id))!.status).toBe("resolved");
  });
});
