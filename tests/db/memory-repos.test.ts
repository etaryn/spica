import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { ScriptedEmbedder } from "@/core/embed/scripted";
import { findEntityByName, upsertEntityMention } from "@/db/repos/entities";
import * as facts from "@/db/repos/facts";
import * as threads from "@/db/repos/threads";
import * as s from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const D = 1024;
const T0 = new Date("2026-01-05T09:00:00Z");
const ax = (i: number) => ScriptedEmbedder.axis(D, i);
const db = () => getTestDb();

async function fact(userId: string, content: string, vec: number[], extra: Partial<facts.NewFact> = {}) {
  return facts.insertFact(db(), userId, {
    subject: "user", kind: "event", content, embedding: vec, created_at: T0, status: "open",
    salience: 0.5, valence: 0, confidence: 0.9, source: "turn", ...extra,
  });
}

describe("facts", () => {
  test("candidateFacts: nearest first, excludes other users, superseded, stale and group scope; entity salience joined", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");
    const mia = await upsertEntityMention(db(), a, { name: "Mia", aliases: [], type: "person", subject: "user", relation: "sister" }, T0, { newSalience: 0.9, bump: 0, cap: 0.95 });
    await fact(a, "exact", ax(1), { entity_refs: [mia.id] });
    await fact(a, "near", ScriptedEmbedder.near(D, 1, 2, 0.8));
    await fact(a, "old news", ax(1), { status: "superseded" });
    await fact(a, "faded", ax(1), { status: "stale" });
    await fact(a, "group", ax(1), { scope: "group" });
    await fact(b, "other user", ax(1));
    const got = await facts.candidateFacts(db(), a, ax(1), 10);
    expect(got.map((f) => f.content)).toEqual(["exact", "near"]);
    expect(got[0]!.sim).toBeCloseTo(1, 4);
    expect(got[0]!.entity_salience).toBeCloseTo(0.9, 4);
    expect(got[1]!.entity_salience).toBe(1);
  });

  test("nearFacts: same subject, above threshold only", async () => {
    const u = await createTestUser();
    await fact(u, "close", ScriptedEmbedder.near(D, 5, 6, 0.9));
    await fact(u, "far", ScriptedEmbedder.near(D, 5, 6, 0.5));
    await fact(u, "self close", ScriptedEmbedder.near(D, 5, 7, 0.95), { subject: "self" });
    const got = await facts.nearFacts(db(), u, "user", ax(5), 5, 0.82);
    expect(got.map((n) => n.content)).toEqual(["close"]);
  });

  test("applyRecall bumps salience (capped), counts, writes traces, and skips deleted or foreign facts", async () => {
    const u = await createTestUser("u");
    const other = await createTestUser("o");
    const f1 = await fact(u, "kept", ax(1), { salience: 0.94 });
    const f2 = await fact(u, "forgotten", ax(2));
    const f3 = await fact(other, "not yours", ax(3));
    const turnId = randomUUID();
    await db().insert(s.session_log).values({ id: turnId, user_id: u, session_id: randomUUID(), role: "companion", text: "x", created_at: T0 });
    await facts.forgetFact(db(), u, f2.id);
    const rec = (id: string) => ({ factId: id, sim: 0.9, fact_salience: 0.5, entity_salience: 1, recency: 1, score: 0.45, forced: false });
    const now = new Date("2026-01-06T09:00:00Z");
    const updated = await facts.applyRecall(db(), u, [rec(f1.id), rec(f2.id), rec(f3.id)], now, 0.03, 0.95, turnId);
    expect(updated).toEqual([f1.id]);
    const after = await facts.getFact(db(), u, f1.id);
    expect(after!.salience).toBeCloseTo(0.95, 5);
    expect(after!.recall_count).toBe(1);
    expect(after!.last_recalled_at!.toISOString()).toBe(now.toISOString());
    const traces = await db().select().from(s.retrieval_trace);
    expect(traces.map((t) => t.fact_id)).toEqual([f1.id]);
    expect((await facts.getFact(db(), other, f3.id))!.recall_count).toBe(0);
  });

  test("forgetFact is scoped and malformed-safe", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");
    const fa = await fact(a, "a's", ax(1));
    expect(await facts.forgetFact(db(), b, fa.id)).toBe(false);
    expect(await facts.forgetFact(db(), a, "not-a-uuid")).toBe(false);
    expect(await facts.getFact(db(), a, fa.id)).not.toBeNull();
    expect(await facts.forgetFact(db(), a, fa.id)).toBe(true);
    expect(await facts.getFact(db(), a, fa.id)).toBeNull();
  });

  test("listRememberedFacts: user subject, active, private, newest first", async () => {
    const u = await createTestUser();
    await fact(u, "older", ax(1), { created_at: new Date("2026-01-01T00:00:00Z") });
    await fact(u, "newer", ax(2), { created_at: new Date("2026-01-03T00:00:00Z") });
    await fact(u, "hers", ax(3), { subject: "self" });
    await fact(u, "gone", ax(4), { status: "stale" });
    expect((await facts.listRememberedFacts(db(), u)).map((f) => f.content)).toEqual(["newer", "older"]);
  });
});

describe("entities", () => {
  test("case/whitespace variants and aliases resolve to one entity; salience bumps and caps", async () => {
    const u = await createTestUser();
    const opts = { newSalience: 0.5, bump: 0.3, cap: 0.95 };
    const first = await upsertEntityMention(db(), u, { name: "Mia", aliases: ["my sis"], type: "person", subject: "user", relation: "sister" }, T0, opts);
    expect(first.created).toBe(true);
    const again = await upsertEntityMention(db(), u, { name: "  MIA ", aliases: [], type: "person", subject: "user", relation: null }, T0, opts);
    const byAlias = await upsertEntityMention(db(), u, { name: "My Sis", aliases: [], type: "person", subject: "user", relation: null }, T0, opts);
    expect(again).toEqual({ id: first.id, created: false });
    expect(byAlias.id).toBe(first.id);
    const row = await findEntityByName(db(), u, "user", "mia");
    expect(row!.salience).toBeCloseTo(0.95, 5);
    expect(await findEntityByName(db(), u, "self", "mia")).toBeNull();
  });
});

describe("threads", () => {
  test("title match is case/space-insensitive; due threads carry their latest active fact", async () => {
    const u = await createTestUser();
    const t = await threads.insertThread(db(), u, { title: "Job interview at Acme", subject: "user", stakes: "high", next_checkpoint: new Date("2026-01-10T09:00:00Z") }, T0);
    expect((await threads.findOpenThreadByTitle(db(), u, "  job INTERVIEW at acme"))!.id).toBe(t.id);
    await fact(u, "older detail", ax(1), { thread_id: t.id, created_at: new Date("2026-01-05T09:00:00Z") });
    await fact(u, "Interview is on Friday at 10am", ax(2), { thread_id: t.id, created_at: new Date("2026-01-06T09:00:00Z"), salience: 0.8 });
    expect(await threads.dueThreads(db(), u, new Date("2026-01-09T09:00:00Z"), 5)).toEqual([]);
    const due = await threads.dueThreads(db(), u, new Date("2026-01-12T09:00:00Z"), 5);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ id: t.id, title: "Job interview at Acme", content: "Interview is on Friday at 10am" });
    expect(due[0]!.salience).toBeCloseTo(0.8, 5);
    await threads.resolveThread(db(), u, t.id, new Date("2026-01-12T10:00:00Z"));
    expect(await threads.dueThreads(db(), u, new Date("2026-01-12T11:00:00Z"), 5)).toEqual([]);
    expect(await threads.getOwnedThread(db(), u, "not-a-uuid")).toBeNull();
  });
});
