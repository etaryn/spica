import { afterAll, beforeEach, expect, test } from "vitest";
import { guardOutcomes, insertJudgeLogs, listJudgeLogs, type NewJudgeLog } from "@/db/repos/judge-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const row = (over: Partial<NewJudgeLog> = {}): NewJudgeLog => ({
  kind: "guard", turn_id: null, attempt: 1, input: { text: "hi" }, output: { violations: [] }, outcome: null,
  source: "model", latency_ms: 5, model: "claude-haiku-4-5", prompt_version: "guard@v1",
  created_at: new Date("2026-01-05T09:00:00Z"), ...over,
});

test("inserts rows scoped to the user; outcomes come back oldest first, nulls skipped", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  await insertJudgeLogs(getTestDb(), a, [
    row({ attempt: 1 }),
    row({ attempt: 2, outcome: "regenerated", created_at: new Date("2026-01-05T09:00:01Z") }),
    row({ outcome: "passed", created_at: new Date("2026-01-05T10:00:00Z") }),
  ]);
  await insertJudgeLogs(getTestDb(), b, [row({ outcome: "fallback" })]);
  expect(await guardOutcomes(getTestDb(), a)).toEqual(["regenerated", "passed"]);
  expect(await guardOutcomes(getTestDb(), b)).toEqual(["fallback"]);
  // newest first: 10:00 (attempt 1), 09:00:01 (attempt 2), 09:00:00 (attempt 1)
  expect((await listJudgeLogs(getTestDb(), a)).map((r) => r.attempt)).toEqual([1, 2, 1]);
});

test("inserting no rows is a no-op", async () => {
  const a = await createTestUser();
  await insertJudgeLogs(getTestDb(), a, []);
  expect(await listJudgeLogs(getTestDb(), a)).toEqual([]);
});
