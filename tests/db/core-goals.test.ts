/** Her goals in Postgres: active ones are oldest first and updates are caller-stamped. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { closeTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const t0 = new Date("2026-01-05T00:00:00Z");
const t1 = new Date("2026-01-06T00:00:00Z");
const goal = (title: string) => ({
  title,
  why: "because",
  status: "active" as const,
  progress: 0,
  source: "seed" as const,
  source_ref: null,
  started_at: t0,
  target_at: null,
  embedding: vec(),
});

test("insert, read, progress and status", async () => {
  const { core } = makeTestDeps();
  const a = await core.goals.insert(goal("A"));
  const b = await core.goals.insert({ ...goal("B"), started_at: t1 });
  expect((await core.goals.active()).map((g) => g.title)).toEqual(["A", "B"]);
  await core.goals.setProgress(a, 0.4, t1);
  await core.goals.setStatus(b, "dropped", t1);
  expect(await core.goals.get(a)).toMatchObject({ progress: 0.4, status: "active" });
  expect((await core.goals.get(a))!.updated_at.getTime()).toBe(t1.getTime());
  expect((await core.goals.active()).map((g) => g.title)).toEqual(["A"]);
  expect(await core.goals.count()).toBe(2);
  expect(await core.goals.get("00000000-0000-0000-0000-000000000000")).toBeNull();
});
