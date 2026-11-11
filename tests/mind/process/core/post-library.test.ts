/** Her posts' goal: made from her persona when missing, kept active, never reset by reading it. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import { postGoal } from "@/mind/process/core/post-library";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("the goal is created once from the persona, then found", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const first = await postGoal(deps);
  expect(await deps.core.goals.get(first!)).toMatchObject({
    title: deps.config.posts.goal,
    status: "active",
    progress: 0,
    source: "seed",
  });
  expect(await postGoal(deps)).toBe(first);
});

test("reading it leaves the progress her appraisals gave it", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const id = await postGoal(deps);
  await deps.core.goals.setProgress(id!, 0.6, deps.clock.now());
  await postGoal(deps);
  expect((await deps.core.goals.get(id!))?.progress).toBe(0.6);
});

test("a dropped goal comes back active, even with the active goals full", async () => {
  const deps = coreDepsOf(makeTestDeps({ core: { goals: { max_active: 1 } } }));
  const id = await postGoal(deps);
  await deps.core.goals.setStatus(id!, "dropped", deps.clock.now());
  await deps.core.goals.insert({
    title: "Something else",
    why: "x",
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: null,
    started_at: deps.clock.now(),
    target_at: null,
    embedding: vec(),
  });
  const back = await postGoal(deps);
  expect(back).not.toBeNull();
  expect(back).not.toBe(id);
  expect((await deps.core.goals.byTitle(deps.config.posts.goal))?.id).toBe(back);
});

test("a goal the persona doesn't have is logged, not invented", async () => {
  const deps = coreDepsOf(makeTestDeps({ posts: { goal: "Not in the persona" } }));
  expect(await postGoal(deps)).toBeNull();
});
