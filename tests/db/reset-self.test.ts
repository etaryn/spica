import { afterAll, beforeEach, expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { insertFact } from "@/db/repos/facts";
import { ensureIdentity, getIdentityRow, updateIdentity } from "@/db/repos/identity";
import { adminResetSelf, assertLocalDatabase } from "@/db/reset-self";
import { entity, fact, thread } from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";

const t0 = new Date("2026-01-05T10:00:00Z");
beforeEach(resetDb);
afterAll(closeTestDb);

test("refuses a non-local database", () => {
  expect(() => assertLocalDatabase("postgres://u:p@db.example.com:5432/spica")).toThrow(/non-local/);
  expect(() => assertLocalDatabase("postgres://u:p@localhost:5432/spica")).not.toThrow();
  expect(() => assertLocalDatabase("postgres://u:p@127.0.0.1:5432/spica")).not.toThrow();
});

test("deletes self facts, entities and threads for every user and keeps user facts", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const base = { kind: "event" as const, embedding: vec(), created_at: t0, status: "open" as const, salience: 0.5, valence: 0, confidence: 1, source: "turn" as const };
  const self = await insertFact(db, u, { ...base, subject: "self", content: "Spica has a cat called Pesto." });
  await insertFact(db, u, { ...base, subject: "user", content: "The user likes tea." });
  await db.insert(entity).values({ user_id: u, name: "Theo", type: "person", subject: "self", salience: 0.5, first_seen: t0, last_mentioned: t0 });
  await db.insert(thread).values({ user_id: u, title: "Theo's move", subject: "self", status: "open", stakes: "low", opened_at: t0, last_touched: t0 });
  await ensureIdentity(db, u, loadConfig().ego.baseline);
  await updateIdentity(db, u, { preoccupation: self.id, preoccupation_since: t0 });
  expect(await adminResetSelf(db)).toEqual({ facts: 1, entities: 1, threads: 1 });
  expect((await db.select().from(fact)).map((f) => f.content)).toEqual(["The user likes tea."]);
  expect((await getIdentityRow(db, u))?.preoccupation).toBeNull();
});
