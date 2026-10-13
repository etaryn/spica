/** The hourly post tick: every gate on its own, then a draft with an image, words and a check. */
import { existsSync } from "node:fs";
import sharp from "sharp";
import { afterAll, beforeEach, expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import { postTick } from "@/mind/process/core/post";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { fixturePng, tmpMediaDir } from "../../../helpers/web";

beforeEach(resetDb);
afterAll(closeTestDb);

const DAY = "2026-01-05";
const at = (hour: number, day = 5) => new Date(Date.UTC(2026, 0, day, hour));

/** A find whose event has landed, with an episode of the given valence. */
async function landedFind(
  deps: ReturnType<typeof makeTestDeps>,
  valence = 0.6,
  hour = 8,
  url = "https://x/a.png",
) {
  const media = `${deps.config.posts.media_dir}/finds/${hour}.png`;
  const { saveMedia } = await import("@/mind/platform/media");
  await saveMedia(deps.config.posts.media_dir, `finds/${hour}.png`, await fixturePng());
  const eventId = await deps.core.world.recordEvent({
    at: at(hour),
    kind: "action",
    content: 'Spica came across "The Pillars" on NASA.',
    valence: 0,
    stakes: "low",
    agents: [],
    life_day: DAY,
    created_at: at(hour),
  });
  await deps.core.world.markAppraised(eventId, at(hour));
  await deps.core.memory.insert({
    kind: "episode",
    content: "PRIVATE-TAKE she felt small and happy",
    payload: {},
    embedding: Array.from({ length: 1024 }, () => 0.01),
    entity_refs: [],
    occurred_at: at(hour),
    created_at: at(hour),
    status: "resolved",
    salience: 0.5,
    valence,
    confidence: 1,
    depth: 2,
    source: "world",
    source_ref: `world_event:${eventId}`,
  });
  return deps.core.posts.insertFind({
    source: "apod",
    url,
    title: "The Pillars",
    credit: "NASA",
    licence: "public domain",
    media_path: media,
    world_event_id: eventId,
    found_at: at(hour),
  });
}

function setup(over: object = {}) {
  return makeTestDeps({ life: { timezone: "UTC" }, posts: { media_dir: tmpMediaDir() }, ...over });
}

test("drafts a post from a landed find: image, words, check and skill", async () => {
  const deps = setup();
  const findId = await landedFind(deps);
  const out = await postTick(coreDepsOf(deps), at(9));
  expect(out.status).toBe("drafted");
  const post = await deps.core.posts.getPost((out as { postId: string }).postId);
  expect(post).toMatchObject({
    find_id: findId,
    medium: "still",
    status: "draft",
    check: "ok",
    caption: "came across The Pillars today",
    skill: 0,
  });
  expect(["plain", "polaroid"]).toContain(post!.format); // screenshot needs skill 0.2
  expect(existsSync(post!.media_path)).toBe(true);
  expect((await sharp(post!.media_path).metadata()).format).toBe("png");
  const draftCall = deps.llm.structuredCalls.find((c) => c.purpose === "post_draft")!;
  expect(`${draftCall.system}${draftCall.input}`).not.toContain("PRIVATE-TAKE");
});

test("gate: one post per her local day", async () => {
  const deps = setup();
  await landedFind(deps, 0.6, 7, "https://x/1.png");
  await landedFind(deps, 0.6, 8, "https://x/2.png");
  expect((await postTick(coreDepsOf(deps), at(9))).status).toBe("drafted");
  const [first] = await deps.core.posts.recent(1);
  await deps.core.posts.decide(first!.id, {
    status: "rejected",
    decided_at: at(9),
    action_event_id: null,
  });
  expect(await postTick(coreDepsOf(deps), at(10))).toEqual({ status: "skipped", reason: "today" });
});

test("gate: the weekly cap", async () => {
  const deps = setup({ posts: { media_dir: tmpMediaDir(), max_per_week: 1 } });
  await landedFind(deps, 0.6, 8, "https://x/1.png");
  expect((await postTick(coreDepsOf(deps), at(9))).status).toBe("drafted");
  const [first] = await deps.core.posts.recent(1);
  await deps.core.posts.decide(first!.id, {
    status: "rejected",
    decided_at: at(9),
    action_event_id: null,
  });
  expect(await postTick(coreDepsOf(deps), at(9, 6))).toEqual({ status: "skipped", reason: "week" });
});

test("gate: a draft still waiting", async () => {
  const deps = setup();
  await landedFind(deps, 0.6, 8, "https://x/1.png");
  expect((await postTick(coreDepsOf(deps), at(9))).status).toBe("drafted");
  expect(await postTick(coreDepsOf(deps), at(9, 6))).toEqual({
    status: "skipped",
    reason: "pending",
  });
});

test("gate: busy or quiet", async () => {
  const deps = setup();
  await deps.core.world.insertPlan({
    date: DAY,
    plan: { blocks: [{ start: "08:00", end: "12:00", kind: "busy", busy: 0.8, label: "work" }] },
    source: "scripted",
    model: "none",
    prompt_version: "none",
    generated_at: at(0),
  });
  await landedFind(deps);
  expect(await postTick(coreDepsOf(deps), at(9))).toEqual({ status: "skipped", reason: "busy" });
});

test("gate: no find that moved her enough", async () => {
  const deps = setup();
  await landedFind(deps, 0.1);
  expect(await postTick(coreDepsOf(deps), at(9))).toEqual({ status: "skipped", reason: "no_find" });
});

test("gate: only stale finds", async () => {
  const old = setup();
  await landedFind(old, 0.9, 8);
  expect(await postTick(coreDepsOf(old), at(9, 8))).toEqual({
    status: "skipped",
    reason: "no_find",
  });
});

test("gate: nothing she can make yet", async () => {
  const deps = setup({
    posts: { media_dir: tmpMediaDir(), formats_dir: "tests/fixtures/no-formats" },
  });
  await landedFind(deps);
  expect(await postTick(coreDepsOf(deps), at(9))).toEqual({
    status: "skipped",
    reason: "no_format",
  });
});

test("gate: budget spent", async () => {
  const deps = setup({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  await landedFind(deps);
  expect(await postTick(coreDepsOf(deps), at(9))).toEqual({ status: "skipped", reason: "budget" });
  expect(await deps.core.posts.drafts()).toBe(0);
});

test("a failing check still stores the draft, unchecked", async () => {
  const deps = setup();
  deps.llm.handlers.post_check = () => {
    throw new Error("timeout");
  };
  await landedFind(deps, 0.6, 8, "https://x/1.png");
  const out = await postTick(coreDepsOf(deps), at(9));
  expect(await deps.core.posts.getPost((out as { postId: string }).postId)).toMatchObject({
    check: "unchecked",
    check_reason: null,
  });
});

test("a flagged check keeps its reason", async () => {
  const flagged = setup();
  flagged.llm.handlers.post_check = () => ({ ok: false, reason: "mood" });
  await landedFind(flagged);
  const f = await postTick(coreDepsOf(flagged), at(9));
  expect(await flagged.core.posts.getPost((f as { postId: string }).postId)).toMatchObject({
    check: "flagged",
    check_reason: "mood",
  });
});

test("an unreadable find image skips before any draft call is spent", async () => {
  const deps = setup();
  const findId = await landedFind(deps);
  const find = (await deps.core.posts.getFind(findId))!;
  await (await import("node:fs/promises")).rm(find.media_path);
  const out = await postTick(coreDepsOf(deps), at(9));
  expect(out).toEqual({ status: "skipped", reason: "render_failed" });
  expect(deps.llm.structuredCalls.some((c) => c.purpose === "post_draft")).toBe(false);
});
