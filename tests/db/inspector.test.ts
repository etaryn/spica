import { afterAll, beforeEach, expect, test } from "vitest";
import { listFacts, parseFactFilters } from "@/db/repos/inspector";
import * as s from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

async function addFact(userId: string, content: string, subject: "user" | "self", salience: number, day: number) {
  await getTestDb().insert(s.fact).values({
    user_id: userId, subject, kind: "event", content, embedding: vec(), created_at: new Date(Date.UTC(2026, 0, day)),
    status: "open", salience, valence: 0, confidence: 0.9, source: "turn",
  });
}

test("listFacts filters by subject, sorts, and is user-scoped", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  await addFact(a, "low old", "user", 0.2, 1);
  await addFact(a, "high new", "user", 0.9, 5);
  await addFact(a, "self fact", "self", 0.5, 3);
  await addFact(b, "b's fact", "user", 1, 9);

  const bySalience = await listFacts(getTestDb(), a, parseFactFilters({ subject: "user", sort: "salience" }));
  expect(bySalience.map((f) => f.content)).toEqual(["high new", "low old"]);
  const byRecency = await listFacts(getTestDb(), a, parseFactFilters({}));
  expect(byRecency.map((f) => f.content)).toEqual(["high new", "self fact", "low old"]);
  expect("embedding" in byRecency[0]!).toBe(false);
});

test("parseFactFilters ignores invalid values", () => {
  expect(parseFactFilters({ subject: "bogus", status: "open", entityId: "x", sort: "weird" }))
    .toEqual({ subject: undefined, status: "open", entityId: undefined, threadId: undefined, sort: "recency" });
});
