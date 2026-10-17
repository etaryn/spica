/** Browsing: one real find a day, in her free time, as an action event that lands like any other. */
import { existsSync } from "node:fs";
import { afterAll, beforeEach, expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import { browseIfDue, browseTime, isFreeLicence } from "@/mind/process/core/browse";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { loadConfig } from "@/mind/platform/config";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { fakeSources, tmpMediaDir, webItem } from "../../../helpers/web";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 0, 5, hour, minute));
const DAY = "2026-01-05";
const FREE = {
  blocks: [{ start: "10:00", end: "13:00", kind: "busy" as const, busy: 0.6, label: "reading" }],
};

async function setup(items: Parameters<typeof fakeSources>[0], over: object = {}) {
  const media = tmpMediaDir();
  const { sources, calls } = fakeSources(items);
  const deps = makeTestDeps(
    {
      life: { timezone: "UTC" },
      posts: { media_dir: media, sources: [{ name: "apod", weight: 1 }], ...over },
    },
    [],
    sources,
  );
  await deps.core.world.insertPlan({
    date: DAY,
    plan: FREE,
    source: "scripted",
    model: "none",
    prompt_version: "none",
    generated_at: at(0),
  });
  return { deps, core: coreDepsOf(deps), calls };
}

test("browse time: inside the window, never inside a busy or quiet block, stable per slot", () => {
  const c = loadConfig({ life: { timezone: "UTC" } });
  const t = browseTime(c.life, c.posts, DAY, FREE, 0)!;
  expect(t.getTime()).toBeGreaterThanOrEqual(at(9).getTime());
  expect(t.getTime()).toBeLessThan(at(23).getTime());
  expect(t.getTime() >= at(10).getTime() && t.getTime() < at(13).getTime()).toBe(false);
  expect(browseTime(c.life, c.posts, DAY, FREE, 0)).toEqual(t);
  const full = {
    blocks: [{ start: "00:00", end: "24:00", kind: "quiet" as const, busy: 0, label: "off" }],
  };
  expect(browseTime(c.life, c.posts, DAY, full, 0)).toBeNull();
});

test("free licences only", () => {
  for (const l of [
    "public domain",
    "Public domain",
    "CC0",
    "CC BY 4.0",
    "CC BY-SA 3.0",
    "cc by-sa 4.0",
  ])
    expect(isFreeLicence(l)).toBe(true);
  for (const l of [
    "copyrighted",
    "unknown",
    "CC BY-NC 4.0",
    "CC BY-ND 4.0",
    "CC BY NC 4.0",
    "CC BY ND 4.0",
    "cc by-nc-sa 4.0",
  ])
    expect(isFreeLicence(l)).toBe(false);
});

test("a browse writes a find, its cached image, an action event and a trace, once a day", async () => {
  const { deps, core } = await setup({ apod: await webItem() });
  expect(await browseIfDue(core, at(8))).toBe(true);
  const [find] = await deps.core.posts.unposted(at(0), 5); // not landed yet
  expect(find).toBeUndefined();
  const f = await deps.core.posts.findByUrl("https://apod.nasa.gov/p.jpg");
  expect(f).toMatchObject({
    source: "apod",
    title: "The Pillars of Creation",
    licence: "public domain",
  });
  expect(existsSync(f!.media_path)).toBe(true);
  const event = await deps.core.world.getEvent(f!.world_event_id);
  expect(event).toMatchObject({
    kind: "action",
    valence: 0,
    stakes: "low",
    life_day: DAY,
    content: 'Spica came across "The Pillars of Creation" on the apod page.',
  });
  expect(event!.at.getTime()).toBe(f!.found_at.getTime());
  expect(await browseIfDue(core, at(9))).toBe(false); // browse_per_day 1
});

test("no plan, no source, a failing source or a non-free licence: nothing written", async () => {
  const none = await setup({});
  expect(await browseIfDue(none.core, at(8))).toBe(false);
  const failing = await setup({ apod: new Error("HTTP 404") });
  expect(await browseIfDue(failing.core, at(8))).toBe(false);
  const paid = await setup({ apod: await webItem({ licence: "copyrighted" }) });
  expect(await browseIfDue(paid.core, at(8))).toBe(false);
  const empty = await setup({ apod: null });
  expect(await browseIfDue(empty.core, at(8))).toBe(false);
  expect(await paid.deps.core.posts.findsOn(DAY)).toBe(0);
});

test("the same item twice in a day is written once", async () => {
  const { deps, core } = await setup({ apod: await webItem() }, { browse_per_day: 2 });
  expect(await browseIfDue(core, at(8))).toBe(true);
  expect(await browseIfDue(core, at(9))).toBe(false);
  expect(await deps.core.posts.findsOn(DAY)).toBe(1);
});

test("a find whose image matches an earlier one is skipped, even under a new URL", async () => {
  const item = await webItem();
  const { deps, core } = await setup({ apod: item }, { browse_per_day: 2 });
  expect(await browseIfDue(core, at(8))).toBe(true);
  item.url = "https://example.org/same-picture-new-url.jpg";
  expect(await browseIfDue(core, at(9))).toBe(false);
  expect(await deps.core.posts.findsOn(DAY)).toBe(1);
});

test("the world tick browses, and a later tick lands the find through appraisal", async () => {
  const { deps, core } = await setup({ apod: await webItem() });
  const first = await coreWorldTick(core, at(8));
  expect(first.browsed).toBe(true);
  await coreWorldTick(core, at(23, 30));
  const [find] = await deps.core.posts.unposted(at(0), 5);
  expect(find).toBeDefined();
  const episode = await deps.core.memory.bySourceRef(
    "episode",
    `world_event:${find!.world_event_id}`,
  );
  expect(episode).not.toBeNull();
});

test("an apod fetch failure inside the world tick doesn't fail the tick", async () => {
  const { core } = await setup({ apod: new Error("HTTP 404") });
  await expect(coreWorldTick(core, at(8))).resolves.toMatchObject({ browsed: false });
});
