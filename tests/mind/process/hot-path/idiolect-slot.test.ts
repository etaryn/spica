/** "Your things together": established idiolect only, as close as they are, never in a crisis. */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import type { SafetyFlag } from "@/db/schema";
import { composeReply } from "@/mind/process/hot-path/compose";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

type D = ReturnType<typeof makeTestDeps>;

const HERS = "whale cloud: Spica and the user say every cloud is a whale.";
const CANDIDATE = "whale cloud: Spica and the user once saw a cloud with a top hat.";
const CRISIS: SafetyFlag = { flagged: true, category: "self_harm", source: "classifier" };
const SLOT = "## Your things together";

async function idiolect(d: D, u: string, content: string, established: boolean) {
  const [embedding] = await d.embedder.embed([content], "document");
  const f = await insertFact(getTestDb(), u, {
    subject: "shared",
    kind: "idiolect",
    content,
    payload: {
      idiolect: {
        type: "joke",
        started_by: "spica",
        established_at: established ? d.clock.now().toISOString() : null,
      },
    },
    embedding: embedding!,
    entity_refs: [],
    created_at: d.clock.now(),
    salience: 0.6,
    valence: 0.5,
    confidence: 0.9,
    source: "turn",
    status: "open",
  });
  return f.id;
}

async function user(d: D, closeness: number | null) {
  const u = await createTestUser();
  if (closeness !== null) {
    await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
    await d.db.execute(
      sql`UPDATE relationship_param SET value = ${closeness} WHERE user_id = ${u} AND name = 'closeness'`,
    );
  }
  return u;
}

async function talk(d: D, u: string, flag: SafetyFlag | null = null) {
  d.clock.advance(60_000);
  const ut = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "whale cloud",
    created_at: d.clock.now(),
    safety_flag: flag,
  });
  const r = await composeReply(d, u, { turns: [ut], openQuestions: [], flag });
  return { r, system: d.llm.calls.at(-1)!.system };
}

test("an established joke shows for a friend, never a candidate, never in a crisis", async () => {
  const d = makeTestDeps();
  const friend = await user(d, 0.5);
  await idiolect(d, friend, HERS, true);
  await idiolect(d, friend, CANDIDATE, false);

  const { system } = await talk(d, friend);
  expect(system).toContain(SLOT);
  expect(system).toContain(`- ${HERS} (you started this)`);
  expect(system).not.toContain(CANDIDATE);

  const crisis = await talk(d, friend, CRISIS);
  expect(crisis.system).not.toContain(SLOT);
});

test("a stranger with no relationship yet gets none of hers", async () => {
  const d = makeTestDeps();
  const stranger = await user(d, null);
  await idiolect(d, stranger, HERS, true);
  const { system } = await talk(d, stranger);
  expect(system).not.toContain(SLOT);
});

test("the slot's items go to the cold path as recalls", async () => {
  const d = makeTestDeps();
  const friend = await user(d, 0.5);
  const id = await idiolect(d, friend, HERS, true);
  const { r } = await talk(d, friend);
  expect(r.recalled.some((x) => x.factId === id && !x.forced)).toBe(true);
});
