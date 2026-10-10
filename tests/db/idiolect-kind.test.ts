/** The idiolect kind exists and ordinary retrieval leaves it to its own slot. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { candidateFacts, insertFact } from "@/db/repos/user/facts";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("idiolect facts are stored but never ranked by ordinary retrieval", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const [embedding] = await d.embedder.embed(["The user calls Spica Starfish."], "document");
  await insertFact(getTestDb(), u, {
    subject: "shared",
    kind: "idiolect",
    content: "The user calls Spica Starfish.",
    payload: { idiolect: { type: "nickname", started_by: "user", established_at: null } },
    embedding: embedding!,
    entity_refs: [],
    created_at: d.clock.now(),
    salience: 0.6,
    valence: 0.5,
    confidence: 0.9,
    source: "turn",
    status: "open",
  });
  const found = await candidateFacts(getTestDb(), u, embedding!, 10);
  expect(found).toEqual([]);
});
