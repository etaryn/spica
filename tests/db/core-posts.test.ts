/** Her finds and posts in Postgres: core rows only, one post per find, drafts decided once. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { createCoreLayer } from "@/db/repos/core";
import { closeTestDb, getTestDb, resetDb, vec } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (hour: number) => new Date(Date.UTC(2026, 0, 5, hour));

async function find(layer = createCoreLayer(getTestDb()), url = "https://x/1.png", hour = 9) {
  const eventId = await layer.world.recordEvent({
    at: at(hour),
    kind: "action",
    content: 'Spica came across "A" on NASA.',
    valence: 0,
    stakes: "low",
    agents: [],
    life_day: "2026-01-05",
    created_at: at(hour),
  });
  const id = await layer.posts.insertFind({
    source: "apod",
    url,
    title: "A",
    description: null,
    credit: "NASA",
    licence: "public domain",
    media_path: ".data/media/finds/a.png",
    image_sha256: eventId,
    world_event_id: eventId,
    found_at: at(hour),
  });
  return { layer, eventId, id };
}

const draft = (findId: string, hour = 10) => ({
  find_id: findId,
  format: "drift",
  clips: "walk+idle+look_up",
  caption: "look at this",
  media_path: ".data/media/posts/p.mp4",
  skill: 0.1,
  check: "ok" as const,
  check_reason: null,
  created_at: at(hour),
});

test("a find is counted on its day and found by url", async () => {
  const { layer, id } = await find();
  expect(await layer.posts.findsOn("2026-01-05")).toBe(1);
  expect(await layer.posts.findsOn("2026-01-06")).toBe(0);
  expect((await layer.posts.findByUrl("https://x/1.png"))?.id).toBe(id);
  expect(await layer.posts.findByUrl("https://x/2.png")).toBeNull();
});

test("unposted lists landed finds with no post, newest first", async () => {
  const layer = createCoreLayer(getTestDb());
  const a = await find(layer, "https://x/a.png", 8);
  const b = await find(layer, "https://x/b.png", 9);
  expect(await layer.posts.unposted(at(0), 10)).toEqual([]); // nothing landed yet
  await layer.world.markAppraised(a.eventId, at(9));
  await layer.world.markAppraised(b.eventId, at(10));
  expect((await layer.posts.unposted(at(0), 10)).map((f) => f.id)).toEqual([b.id, a.id]);
  expect((await layer.posts.unposted(at(9), 10)).map((f) => f.id)).toEqual([b.id]);
  await layer.posts.insertPost(draft(b.id));
  expect((await layer.posts.unposted(at(0), 10)).map((f) => f.id)).toEqual([a.id]);
});

test("posts are counted, listed and decided", async () => {
  const { layer, id } = await find();
  const postId = await layer.posts.insertPost(draft(id));
  expect(await layer.posts.postsSince(at(10))).toBe(1);
  expect(await layer.posts.postsSince(at(11))).toBe(0);
  expect(await layer.posts.drafts()).toBe(1);
  const locked = await layer.transaction((tx) => tx.posts.lockPost(postId));
  expect(locked).toMatchObject({ id: postId, status: "draft", decided_at: null });
  await layer.posts.decide(postId, {
    status: "rejected",
    decided_at: at(11),
    action_event_id: null,
  });
  expect(await layer.posts.drafts()).toBe(0);
  const [recent] = await layer.posts.recent(5);
  expect(recent).toMatchObject({ id: postId, status: "rejected", title: "A", source: "apod" });
});

test("one post per find", async () => {
  const { layer, id } = await find();
  await layer.posts.insertPost(draft(id));
  await expect(layer.posts.insertPost(draft(id, 11))).rejects.toThrow();
});

test("goals are found by title, whatever their status", async () => {
  const layer = createCoreLayer(getTestDb());
  expect(await layer.goals.byTitle("Find friends and share her life")).toBeNull();
  const id = await layer.goals.insert({
    title: "Find friends and share her life",
    why: "she wants to be known",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: "persona:v6",
    started_at: at(1),
    target_at: null,
    embedding: vec(),
  });
  await layer.goals.setStatus(id, "dropped", at(2));
  expect(await layer.goals.byTitle("Find friends and share her life")).toMatchObject({
    id,
    status: "dropped",
    progress: 0.2,
  });
});
