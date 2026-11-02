/** Per-user usage rows sum per purpose and model, scoped to the user. */
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { user } from "@/db/schema";
import { insertLlmUsage, llmUsageSince, type NewLlmUsage } from "@/db/repos/user/llm-usage";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const row = (over: Partial<NewLlmUsage> = {}): NewLlmUsage => ({
  purpose: "reply",
  model: "claude-sonnet-5",
  input_tokens: 100,
  output_tokens: 10,
  cache_read_input_tokens: 5,
  cache_creation_input_tokens: 7,
  cache_creation_1h_input_tokens: 7,
  created_at: new Date("2026-01-05T09:00:00Z"),
  ...over,
});

test("sums per purpose and model for one user since a time, never another user's", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const db = getTestDb();
  await insertLlmUsage(db, a, row());
  await insertLlmUsage(db, a, row({ input_tokens: 50 }));
  await insertLlmUsage(
    db,
    a,
    row({ purpose: "guard", model: "claude-haiku-5-5", input_tokens: 1 }),
  );
  await insertLlmUsage(db, a, row({ created_at: new Date("2025-12-01T00:00:00Z") }));
  await insertLlmUsage(db, b, row({ input_tokens: 9999 }));

  const out = await llmUsageSince(db, a, new Date("2026-01-01T00:00:00Z"));
  expect(out.map((r) => [r.purpose, r.calls, r.input_tokens])).toEqual([
    ["reply", 2, 150],
    ["guard", 1, 1],
  ]);
  expect(out[0]).toMatchObject({
    output_tokens: 20,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 14,
    cache_creation_1h_input_tokens: 14,
  });
});

test("deleting a user deletes their usage and leaves another user's", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const db = getTestDb();
  await insertLlmUsage(db, a, row());
  await insertLlmUsage(db, b, row());

  await db.delete(user).where(eq(user.id, a));

  const since = new Date("2026-01-01T00:00:00Z");
  expect(await llmUsageSince(db, a, since)).toEqual([]);
  expect(await llmUsageSince(db, b, since)).toHaveLength(1);
});
