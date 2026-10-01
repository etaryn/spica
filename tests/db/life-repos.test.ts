import { afterAll, beforeEach, expect, test } from "vitest";
import { truncateAll } from "@/db/admin";
import { insertFact } from "@/db/repos/facts";
import * as idn from "@/db/repos/identity";
import { getLifeDay, insertLifeDay, listLifeDaysBefore } from "@/db/repos/life-day";
import {
  insertLifeEventLogs,
  lastAcceptedHighStakes,
  listLifeEventLogs,
} from "@/db/repos/life-event-log";
import { ensureRelationship } from "@/db/repos/relationship";
import { getState, lockState, updateState } from "@/db/repos/conversation-state";
import { fact } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadConfig } from "@/core/config";
import { closeTestDb, createTestUser, getTestDb, resetDb, testDbUrl, vec } from "../helpers/db";

const cfg = loadConfig();
const t0 = new Date("2026-01-05T10:00:00Z");
const plan = {
  blocks: [{ start: "00:00", end: "08:00", kind: "quiet" as const, busy: 0.9, label: "offline" }],
};

beforeEach(resetDb);
afterAll(closeTestDb);

test("ensureIdentity creates the row from the baseline once", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  await idn.ensureIdentity(db, u, cfg.ego.baseline);
  await idn.updateIdentity(db, u, { energy: 0.1 });
  await idn.ensureIdentity(db, u, cfg.ego.baseline); // no-op
  const row = await idn.getIdentityRow(db, u);
  expect(row?.energy).toBeCloseTo(0.1);
  expect(row?.baseline).toEqual(cfg.ego.baseline);
  expect(row?.life_last_date).toBeNull();
});

test("adminListLifeUsers lists active and repairing relationships only", async () => {
  const db = getTestDb();
  const [a, b] = [await createTestUser(), await createTestUser()];
  await ensureRelationship(db, a, t0, cfg.relationship);
  expect(await idn.adminListLifeUsers(db)).toEqual([a]);
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

test("life_event_log is user-scoped and finds the last accepted high-stakes event", async () => {
  const db = getTestDb();
  const [a, b] = [await createTestUser(), await createTestUser()];
  const base = {
    life_day: "2026-01-05",
    attempt: 1,
    target_fact_id: null,
    fact_id: null,
    model: "m",
    prompt_version: "v1",
  };
  await insertLifeEventLogs(db, a, [
    { ...base, candidate: { stakes: "high" }, decision: "contradicts", created_at: t0 },
    {
      ...base,
      candidate: { stakes: "high" },
      decision: "accepted",
      created_at: new Date(t0.getTime() + 1000),
    },
    {
      ...base,
      candidate: { stakes: "low" },
      decision: "accepted",
      created_at: new Date(t0.getTime() + 2000),
    },
  ]);
  expect((await lastAcceptedHighStakes(db, a))?.toISOString()).toBe(
    new Date(t0.getTime() + 1000).toISOString(),
  );
  expect(await lastAcceptedHighStakes(db, b)).toBeNull();
  expect(await listLifeEventLogs(db, b, 10)).toEqual([]);
  expect((await listLifeEventLogs(db, a, 10))[0]?.decision).toBe("accepted");
});

test("deleting the deferred block fact nulls conversation_state.deferred_fact", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const f = await insertFact(db, u, {
    subject: "self",
    kind: "event",
    content: "x",
    embedding: vec(),
    created_at: t0,
    status: "open",
    salience: 0.2,
    valence: 0,
    confidence: 1,
    source: "generated",
  });
  await db.transaction(async (tx) => {
    await lockState(tx, u, t0);
    await updateState(tx, u, { deferred_until: t0, deferred_fact: f.id });
  });
  await db.delete(fact).where(eq(fact.id, f.id));
  expect((await getState(db, u))?.deferred_fact).toBeNull();
});
