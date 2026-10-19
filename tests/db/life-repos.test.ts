import { afterAll, beforeEach, expect, test } from "vitest";
import { truncateAll } from "@/db/admin";
import { adminListOutreachUsers } from "@/db/repos/admin/relationship";
import { getLifeDay, insertLifeDay, listLifeDaysBefore } from "@/db/repos/world/life-day";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { loadConfig } from "@/mind/platform/config";
import { closeTestDb, createTestUser, getTestDb, resetDb, testDbUrl } from "../helpers/db";

const cfg = loadConfig();
const t0 = new Date("2026-01-05T10:00:00Z");
const plan = {
  blocks: [{ start: "00:00", end: "08:00", kind: "busy" as const, busy: 0.9, label: "reading" }],
};

beforeEach(resetDb);
afterAll(closeTestDb);

test("adminListOutreachUsers lists active and repairing relationships only", async () => {
  const db = getTestDb();
  const [a, b] = [await createTestUser(), await createTestUser()];
  await ensureRelationship(db, a, t0, cfg.relationship);
  expect(await adminListOutreachUsers(db)).toEqual([a]);
  void b;
});

test("life_day insert is idempotent and lists earlier days oldest first", async () => {
  const db = getTestDb();
  const row = (date: string) => ({
    date,
    plan,
    source: "model",
    model: "m",
    prompt_version: "v1",
    generated_at: t0,
  });
  expect(await insertLifeDay(db, row("2026-01-05"))).toBe(true);
  expect(await insertLifeDay(db, row("2026-01-05"))).toBe(false);
  await insertLifeDay(db, row("2026-01-03"));
  await insertLifeDay(db, row("2026-01-04"));
  expect((await getLifeDay(db, "2026-01-05"))?.plan).toEqual(plan);
  expect((await listLifeDaysBefore(db, "2026-01-05", 2)).map((r) => r.date)).toEqual([
    "2026-01-03",
    "2026-01-04",
  ]);
  await truncateAll(db, testDbUrl);
  expect(await getLifeDay(db, "2026-01-05")).toBeNull();
});
