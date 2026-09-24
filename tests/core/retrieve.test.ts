import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { ScriptedEmbedder } from "@/core/embed/scripted";
import { retrieve } from "@/core/memory/retrieve";
import * as facts from "@/db/repos/facts";
import { insertTurn, type Turn } from "@/db/repos/session-log";
import * as threads from "@/db/repos/threads";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const D = 1024;
const now = new Date("2026-01-12T09:00:00Z");
const opened = new Date("2026-01-05T09:00:00Z"); // threads open before their checkpoint passes

async function turn(userId: string, text: string): Promise<Turn> {
  return insertTurn(getTestDb(), userId, { id: randomUUID(), session_id: randomUUID(), role: "user", text, created_at: now });
}

function deps(embedder: ScriptedEmbedder) {
  return { ...makeTestDeps({ retrieval: { top_n: 2 } }), embedder };
}

test("ranks by the scoring formula, groups by subject, forces due threads, and reports recalled factors", async () => {
  const u = await createTestUser();
  const e = new ScriptedEmbedder(D);
  const q = await turn(u, "how's the dog");
  e.set("how's the dog", ScriptedEmbedder.axis(D, 1));
  const base = { kind: "event" as const, created_at: now, status: "open" as const, valence: 0, confidence: 0.9, source: "turn" as const };
  await facts.insertFact(getTestDb(), u, { ...base, subject: "user", content: "The user's dog is called Biscuit.", embedding: ScriptedEmbedder.axis(D, 1), salience: 0.9 });
  await facts.insertFact(getTestDb(), u, { ...base, subject: "self", content: "Spica has a cat called Pesto.", embedding: ScriptedEmbedder.near(D, 1, 2, 0.7), salience: 0.9 });
  await facts.insertFact(getTestDb(), u, { ...base, subject: "user", content: "Low relevance.", embedding: ScriptedEmbedder.near(D, 1, 3, 0.1), salience: 0.9 });
  const t = await threads.insertThread(getTestDb(), u, { title: "job interview at Acme", subject: "user", stakes: "high", next_checkpoint: new Date("2026-01-10T09:00:00Z") }, opened);
  await facts.insertFact(getTestDb(), u, { ...base, subject: "user", content: "The user's interview at Acme was on Friday.", embedding: ScriptedEmbedder.axis(D, 50), salience: 0.7, thread_id: t.id });

  const r = await retrieve(deps(e), u, { answering: [q], context: [], now });
  expect(r.facts.user.map((f) => f.content)).toEqual(["The user's dog is called Biscuit."]);
  expect(r.facts.self.map((f) => f.content)).toEqual(["Spica has a cat called Pesto."]);
  expect(r.dueThreads).toEqual([{ title: "job interview at Acme", detail: "The user's interview at Acme was on Friday." }]);
  expect(r.recalled.filter((x) => x.forced)).toHaveLength(1);
  // salience is a Postgres `real`: 0.9 reads back as 0.8999999…, so never compare it with ===.
  const top = r.recalled.find((x) => !x.forced && x.sim > 0.99)!;
  expect(top.fact_salience).toBeCloseTo(0.9, 5);
  expect(top.score).toBeCloseTo(top.sim * top.fact_salience * 1 * 1, 5);
});

test("embedder failure degrades to forced items only, and never throws", async () => {
  const u = await createTestUser();
  const e = new ScriptedEmbedder(D);
  e.failNext = true;
  const q = await turn(u, "hey");
  const t = await threads.insertThread(getTestDb(), u, { title: "driving test", subject: "user", stakes: "med", next_checkpoint: new Date("2026-01-11T09:00:00Z") }, opened);
  const r = await retrieve(deps(e), u, { answering: [q], context: [], now });
  expect(r.facts.user).toEqual([]);
  expect(r.dueThreads.map((d) => d.title)).toEqual(["driving test"]);
  expect(t.id).toBeTruthy();
});

test("other users' facts are never retrieved", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const e = new ScriptedEmbedder(D);
  const q = await turn(b, "cats");
  e.set("cats", ScriptedEmbedder.axis(D, 9));
  await facts.insertFact(getTestDb(), a, { subject: "user", kind: "trait", content: "Alice's cat is Biscuit.", embedding: ScriptedEmbedder.axis(D, 9), created_at: now, status: "open", salience: 1, valence: 0, confidence: 1, source: "turn" });
  const r = await retrieve(deps(e), b, { answering: [q], context: [], now });
  expect(r.recalled).toEqual([]);
});
