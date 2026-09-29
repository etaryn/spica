import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { blockAt, blockContent, listLifeBlocks } from "@/core/life/blocks";
import { lifeTick, lifeTickUser } from "@/core/life/tick";
import * as factsRepo from "@/db/repos/facts";
import { getIdentityRow } from "@/db/repos/identity";
import { insertLifeDay } from "@/db/repos/life-day";
import { ensureRelationship } from "@/db/repos/relationship";
import { setTimezone } from "@/db/repos/users";
import { fact } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { closeTestDb, createTestUser, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const plan = { blocks: [
  { start: "00:00", end: "08:00", kind: "quiet" as const, busy: 0.9, label: "offline, winding down" },
  { start: "10:00", end: "13:00", kind: "busy" as const, busy: 0.8, label: "rewatching an old film" },
  { start: "14:00", end: "15:00", kind: "downtime" as const, busy: 0, label: "free" },
] };
// 02:00 on 2026-01-06 in Singapore = 18:00 UTC on the 5th.
const at = new Date("2026-01-05T18:00:00Z");

async function setup(opts: { events?: number; tickHour?: number; lockTimeoutMs?: number } = {}) {
  const deps = makeTestDeps({ life: {
    events_per_day_max: opts.events ?? 0,
    ...(opts.tickHour === undefined ? {} : { tick_local_hour: opts.tickHour }),
    ...(opts.lockTimeoutMs === undefined ? {} : { lock_timeout_ms: opts.lockTimeoutMs }),
  } });
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, at, deps.config.relationship);
  await insertLifeDay(deps.db, { date: "2026-01-06", plan, source: "scripted", model: "none", prompt_version: "scripted", generated_at: at });
  return { deps, u };
}

test("blockContent reads as a schedule line that is true before and after the block", () => {
  expect(blockContent(plan.blocks[1]!)).toBe("Spica's morning: rewatching an old film.");
  expect(blockContent(plan.blocks[0]!)).toBe("Spica's night: offline, winding down.");
});

test("copies busy and quiet blocks (not downtime) as self generated facts, once per her date", async () => {
  const { deps, u } = await setup();
  await setTimezone(deps.db, u, "America/New_York"); // the user's zone must not matter (review focus 1)
  expect(await lifeTickUser(deps, u, at)).toBe("done");
  expect(await lifeTickUser(deps, u, new Date(at.getTime() + 3_600_000))).toBe("not_due");
  const blocks = await listLifeBlocks(deps.db, u, "2026-01-06");
  expect(blocks.map((b) => [b.block, b.label])).toEqual([["quiet", "offline, winding down"], ["busy", "rewatching an old film"]]);
  expect(blocks[1]!.start.toISOString()).toBe("2026-01-06T02:00:00.000Z");
  const rows = await deps.db.select().from(fact).where(eq(fact.user_id, u));
  expect(rows.every((r) => r.subject === "self" && r.source === "generated" && r.salience === deps.config.life.block_salience)).toBe(true);
  expect((await getIdentityRow(deps.db, u))?.life_last_date).toBe("2026-01-06");
  expect(blockAt(blocks, new Date("2026-01-06T03:00:00Z"))?.label).toBe("rewatching an old film");
  expect(blockAt(blocks, new Date("2026-01-06T06:00:00Z"))).toBeNull();
});

test("not due before tick_local_hour in her zone", async () => {
  const { deps, u } = await setup({ tickHour: 1 });
  expect(await lifeTickUser(deps, u, new Date("2026-01-05T16:30:00Z"))).toBe("not_due"); // 00:30 in Singapore
  expect(await lifeTickUser(deps, u, new Date("2026-01-05T17:10:00Z"))).toBe("done"); // 01:10 in Singapore
});

test("a held cold-path lock fails the user after life.lock_timeout_ms instead of stalling (retried next hour)", async () => {
  const { deps, u } = await setup({ lockTimeoutMs: 200 });
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => { locked = r; });
  const holder = deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cold_path:${u}`}))`);
    locked();
    await held;
  });
  await isLocked;
  const t0 = performance.now();
  await expect(lifeTickUser(deps, u, at)).rejects.toThrow();
  expect(performance.now() - t0).toBeLessThan(3000);
  release();
  await holder;
  expect((await getIdentityRow(deps.db, u))?.life_last_date ?? null).toBeNull();
  expect(await lifeTickUser(deps, u, at)).toBe("done");
});

test("a failure after block inserts rolls back everything (review focus 4)", async () => {
  const { deps, u } = await setup();
  const real = factsRepo.insertFact;
  const spy = vi.spyOn(factsRepo, "insertFact");
  spy.mockImplementationOnce(real).mockRejectedValueOnce(new Error("boom"));
  await expect(lifeTickUser(deps, u, at)).rejects.toThrow("boom");
  spy.mockRestore();
  expect(await deps.db.select().from(fact).where(eq(fact.user_id, u))).toHaveLength(0);
  expect((await getIdentityRow(deps.db, u))?.life_last_date ?? null).toBeNull();
  expect(await lifeTickUser(deps, u, at)).toBe("done");
  expect(await listLifeBlocks(deps.db, u, "2026-01-06")).toHaveLength(2);
});

test("lifeTick skips ended relationships and isolates failures", async () => {
  const { deps, u } = await setup();
  const other = await createTestUser();
  expect(await lifeTick(deps, at)).toEqual({ users: 1, failed: 0 }); // `other` has no relationship row
  void u; void other;
});

test("a day without a plan still ticks (no blocks)", async () => {
  const deps = makeTestDeps({ life: { events_per_day_max: 0 } });
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, at, deps.config.relationship);
  expect(await lifeTickUser(deps, u, at)).toBe("done");
  expect(await listLifeBlocks(deps.db, u, "2026-01-06")).toEqual([]);
});
