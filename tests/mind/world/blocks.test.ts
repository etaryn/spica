import { afterAll, beforeEach, expect, test } from "vitest";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { loadConfig } from "@/mind/platform/config";
import { blockAt, blockByKey, blocksForDay, todaysBlocks } from "@/mind/world/blocks";
import { closeTestDb, resetDb } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const cfg = loadConfig({ life: { timezone: "UTC" } }).life;
const plan = {
  blocks: [
    { start: "06:00", end: "08:00", kind: "busy" as const, busy: 0.9, label: "sorting photos" },
    { start: "08:00", end: "10:00", kind: "downtime" as const, busy: 0, label: "coffee" },
    { start: "10:00", end: "13:00", kind: "busy" as const, busy: 0.6, label: "reading" },
  ],
};

test("downtime is free time, not a block", () => {
  const blocks = blocksForDay(cfg, "2026-01-05", plan);
  expect(blocks.map((b) => b.key)).toEqual(["2026-01-05#06:00", "2026-01-05#10:00"]);
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

test("a stored quiet block from before reads as free time", () => {
  const legacy = {
    blocks: [{ start: "00:00", end: "08:00", kind: "quiet", busy: 0.9, label: "offline" }],
  } as unknown as Parameters<typeof blocksForDay>[2];
  expect(blocksForDay(cfg, "2026-01-05", legacy)).toEqual([]);
});

test("while she's offline her block is the offline one, ending when she should be back", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const tick = new Date("2026-01-05T14:45:00Z");
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  await deps.core.state.update({ energy: 0.15, offline_since: tick, last_tick: tick });
  const at = new Date("2026-01-05T14:50:00Z");
  const b = blockAt(await todaysBlocks(deps, at), at)!;
  expect(b).toMatchObject({
    block: "offline",
    key: `offline#${tick.toISOString()}`,
    label: deps.config.core.state.offline.label,
    busy: deps.config.core.state.offline.busy,
  });
  expect(b.end.getTime()).toBeGreaterThan(at.getTime());
  expect((await blockByKey(deps, b.key))?.label).toBe(deps.config.core.state.offline.label);
  await deps.core.state.update({ offline_since: null });
  expect(blockAt(await todaysBlocks(deps, at), at)).toBeNull();
});

test("an old night block key yields nothing rather than failing", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  expect(await blockByKey(deps, "2026-01-05#00:00")).toBeNull();
  expect(await blockByKey(deps, "offline#not-a-date")).toBeNull();
});
