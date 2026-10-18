import { afterAll, beforeEach, expect, test } from "vitest";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { loadConfig } from "@/mind/platform/config";
import { blockAt, blockByKey, blocksForDay, joinNight, todaysBlocks } from "@/mind/world/blocks";
import { closeTestDb, resetDb } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const cfg = loadConfig({ life: { timezone: "UTC" } }).life;
const plan = {
  blocks: [
    { start: "00:00", end: "08:00", kind: "quiet" as const, busy: 0.9, label: "offline" },
    { start: "08:00", end: "10:00", kind: "downtime" as const, busy: 0, label: "coffee" },
    { start: "10:00", end: "13:00", kind: "busy" as const, busy: 0.6, label: "reading" },
  ],
};

test("downtime is free time, not a block", () => {
  const blocks = blocksForDay(cfg, "2026-01-05", plan);
  expect(blocks.map((b) => b.key)).toEqual(["2026-01-05#00:00", "2026-01-05#10:00"]);
  expect(blocks[1]).toMatchObject({ block: "busy", busy: 0.6, label: "reading" });
  expect(blocks[1]!.start.toISOString()).toBe("2026-01-05T10:00:00.000Z");
});

test("no plan means no blocks", () => {
  expect(blocksForDay(cfg, "2026-01-05", null)).toEqual([]);
});

test("blockAt is start-inclusive, end-exclusive", () => {
  const blocks = blocksForDay(cfg, "2026-01-05", plan);
  expect(blockAt(blocks, new Date("2026-01-05T10:00:00Z"))?.label).toBe("reading");
  expect(blockAt(blocks, new Date("2026-01-05T13:00:00Z"))).toBeNull();
});

test("reads today's plan and finds a block by key; an unknown key is null", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const now = new Date("2026-01-05T11:00:00Z");
  await insertLifeDay(deps.db, {
    date: "2026-01-05",
    plan,
    source: "scripted",
    model: "none",
    prompt_version: "scripted",
    generated_at: now,
  });
  expect((await todaysBlocks(deps, now)).length).toBe(2);
  expect((await blockByKey(deps, "2026-01-05#10:00"))?.label).toBe("reading");
  expect(await blockByKey(deps, "2026-01-05#11:11")).toBeNull();
  expect(await blockByKey(deps, "not-a-key")).toBeNull();
});

const night = (start: string, end: string) => ({
  start,
  end,
  kind: "quiet" as const,
  busy: 0.9,
  label: "offline, winding down",
});

test("a quiet block ending at midnight runs on into tomorrow's from 00:00", () => {
  const today = blocksForDay(cfg, "2026-01-05", { blocks: [night("22:00", "24:00")] });
  const tomorrow = blocksForDay(cfg, "2026-01-06", { blocks: [night("00:00", "07:30")] });
  const [b] = joinNight(today, tomorrow);
  expect(b!.key).toBe("2026-01-05#22:00");
  expect(b!.end.toISOString()).toBe("2026-01-06T07:30:00.000Z");
});

test("no plan for tomorrow leaves midnight as the end", () => {
  const today = blocksForDay(cfg, "2026-01-05", { blocks: [night("22:00", "24:00")] });
  expect(joinNight(today, [])[0]!.end.toISOString()).toBe("2026-01-06T00:00:00.000Z");
});

test("todaysBlocks reads tomorrow to join the night", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const at = new Date("2026-01-05T23:50:00Z");
  for (const [date, blocks] of [
    ["2026-01-05", [night("22:00", "24:00")]],
    ["2026-01-06", [night("00:00", "07:30")]],
  ] as const) {
    await insertLifeDay(deps.db, {
      date,
      plan: { blocks: [...blocks] },
      source: "scripted",
      model: "none",
      prompt_version: "scripted",
      generated_at: at,
    });
  }
  const b = blockAt(await todaysBlocks(deps, at), at);
  expect(b!.end.toISOString()).toBe("2026-01-06T07:30:00.000Z");
});

test("after midnight the night is still last night's block: same key, same start", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const at = new Date("2026-01-06T00:30:00Z");
  for (const [date, blocks] of [
    ["2026-01-05", [night("22:00", "24:00")]],
    ["2026-01-06", [night("00:00", "07:30")]],
  ] as const) {
    await insertLifeDay(deps.db, {
      date,
      plan: { blocks: [...blocks] },
      source: "scripted",
      model: "none",
      prompt_version: "scripted",
      generated_at: at,
    });
  }
  const b = blockAt(await todaysBlocks(deps, at), at);
  expect(b!.key).toBe("2026-01-05#22:00");
  expect(b!.start.toISOString()).toBe("2026-01-05T22:00:00.000Z");
  expect(b!.end.toISOString()).toBe("2026-01-06T07:30:00.000Z");
});
