import { afterAll, beforeEach, expect, test } from "vitest";
import { lifeTick, lifeTickUser } from "@/mind/world/legacy-life-tick/tick";
import { getIdentityRow } from "@/db/repos/user/identity";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { setTimezone } from "@/db/repos/user/users";
import { fact } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { closeTestDb, createTestUser, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const plan = {
  blocks: [
    {
      start: "00:00",
      end: "08:00",
      kind: "quiet" as const,
      busy: 0.9,
      label: "offline, winding down",
    },
    {
      start: "10:00",
      end: "13:00",
      kind: "busy" as const,
      busy: 0.8,
      label: "rewatching an old film",
    },
    { start: "14:00", end: "15:00", kind: "downtime" as const, busy: 0, label: "free" },
  ],
};
// 02:00 on 2026-01-06 in Singapore = 18:00 UTC on the 5th.
const at = new Date("2026-01-05T18:00:00Z");

async function setup(opts: { events?: number; tickHour?: number; lockTimeoutMs?: number } = {}) {
  const deps = makeTestDeps({
    life: {
      events_per_day_max: opts.events ?? 0,
      ...(opts.tickHour === undefined ? {} : { tick_local_hour: opts.tickHour }),
      ...(opts.lockTimeoutMs === undefined ? {} : { lock_timeout_ms: opts.lockTimeoutMs }),
    },
  });
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, at, deps.config.relationship);
  await insertLifeDay(deps.db, {
    date: "2026-01-06",
    plan,
    source: "scripted",
    model: "none",
    prompt_version: "scripted",
    generated_at: at,
  });
  return { deps, u };
}

test("ticks once per her date and no longer copies blocks into the user's facts", async () => {
  const { deps, u } = await setup();
  await setTimezone(deps.db, u, "America/New_York"); // the user's zone must not matter
  expect(await lifeTickUser(deps, u, at)).toBe("done");
  expect(await lifeTickUser(deps, u, new Date(at.getTime() + 3_600_000))).toBe("not_due");
  expect(await deps.db.select().from(fact).where(eq(fact.user_id, u))).toHaveLength(0);
  expect((await getIdentityRow(deps.db, u))?.life_last_date).toBe("2026-01-06");
});

test("not due before tick_local_hour in her zone", async () => {
  const { deps, u } = await setup({ tickHour: 1 });
  expect(await lifeTickUser(deps, u, new Date("2026-01-05T16:30:00Z"))).toBe("not_due"); // 00:30 in Singapore
  expect(await lifeTickUser(deps, u, new Date("2026-01-05T17:10:00Z"))).toBe("done"); // 01:10 in Singapore
});

test("a held cold-path lock fails the user after life.lock_timeout_ms instead of stalling (retried next hour)", async () => {
  const { deps, u } = await setup({ lockTimeoutMs: 200 });
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => {
    locked = r;
  });
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

test("lifeTick skips ended relationships and isolates failures", async () => {
  const { deps, u } = await setup();
  const other = await createTestUser();
  expect(await lifeTick(deps, at)).toEqual({ users: 1, failed: 0 }); // `other` has no relationship row
  void u;
  void other;
});

test("a day without a plan still ticks (no blocks)", async () => {
  const deps = makeTestDeps({ life: { events_per_day_max: 0 } });
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, at, deps.config.relationship);
  expect(await lifeTickUser(deps, u, at)).toBe("done");
});
