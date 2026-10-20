/** Approving a draft makes it part of her life; rejecting it leaves no trace; each decides once. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { createCoreLayer } from "@/db/repos/core";
import { coreDepsOf } from "@/mind/platform/deps";
import { decidePost } from "@/mind/process/core/post";
import { closeTestDb, getTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (hour: number) => new Date(Date.UTC(2026, 0, 5, hour));

async function draft(deps: ReturnType<typeof makeTestDeps>) {
  const eventId = await deps.core.world.recordEvent({
    at: at(8),
    kind: "action",
    content: 'Spica came across "The Pillars" on NASA.',
    valence: 0,
    stakes: "low",
    agents: [],
    life_day: "2026-01-05",
    created_at: at(8),
  });
  const findId = await deps.core.posts.insertFind({
    source: "apod",
    url: "https://x/a.png",
    title: "The Pillars",
    description: null,
    credit: "NASA",
    licence: "public domain",
    media_path: "a.png",
    image_sha256: eventId,
    world_event_id: eventId,
    found_at: at(8),
  });
  return deps.core.posts.insertPost({
    find_id: findId,
    medium: "still",
    format: "plain",
    pose: "walk-01",
    caption: "came across the pillars today",
    overlay_text: null,
    media_path: "p.png",
    skill: 0,
    check: "ok",
    check_reason: null,
    created_at: at(9),
  });
}

async function craftGoal(deps: ReturnType<typeof makeTestDeps>) {
  return deps.core.goals.insert({
    title: deps.config.posts.craft_goals.still,
    why: "early posts look rough",
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: null,
    started_at: at(1),
    target_at: null,
    embedding: vec(),
  });
}

test("approve records an action event now, tied to the craft goal", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const goal = await craftGoal(deps);
  const postId = await draft(deps);
  expect(await decidePost(coreDepsOf(deps), postId, "approve")).toBe(true);
  const post = await deps.core.posts.getPost(postId);
  expect(post).toMatchObject({ status: "approved", decided_at: deps.clock.now() });
  const event = await deps.core.world.getEvent(post!.action_event_id!);
  expect(event).toMatchObject({
    kind: "action",
    goal_ref: goal,
    stakes: "low",
    content: 'Spica posted "came across the pillars today" about "The Pillars".',
  });
  expect(event!.at).toEqual(deps.clock.now());
});

test("approve without a craft goal still records the event, untied", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const postId = await draft(deps);
  await decidePost(coreDepsOf(deps), postId, "approve");
  const post = await deps.core.posts.getPost(postId);
  expect((await deps.core.world.getEvent(post!.action_event_id!))!.goal_ref).toBeNull();
});

test("reject writes no event", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const postId = await draft(deps);
  expect(await decidePost(coreDepsOf(deps), postId, "reject")).toBe(true);
  expect(await deps.core.posts.getPost(postId)).toMatchObject({
    status: "rejected",
    action_event_id: null,
  });
  expect(await deps.core.world.events("2026-01-05")).toHaveLength(1); // only the find's
});

test("a second decision, or two at once, changes nothing", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const postId = await draft(deps);
  const core = coreDepsOf(deps);
  const results = await Promise.all([
    decidePost(core, postId, "approve"),
    decidePost({ ...core, core: createCoreLayer(getTestDb()) }, postId, "approve"),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await decidePost(core, postId, "reject")).toBe(false);
  expect(await deps.core.world.events("2026-01-05")).toHaveLength(2);
  expect(await decidePost(core, "00000000-0000-4000-8000-000000000000", "approve")).toBe(false);
});
