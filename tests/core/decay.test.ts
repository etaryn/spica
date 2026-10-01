import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { decayedSalience, decayPass } from "@/core/memory/decay";
import * as facts from "@/db/repos/facts";
import * as threads from "@/db/repos/threads";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

describe("decayedSalience", () => {
  test("important facts fade slowly, trivia fast", () => {
    expect(decayedSalience(0.9, 0.08)).toBeCloseTo(0.9 * (1 - 0.08 * 0.1), 10);
    expect(decayedSalience(0.2, 0.08)).toBeCloseTo(0.2 * (1 - 0.08 * 0.8), 10);
    expect(1 - decayedSalience(0.9, 0.08) / 0.9).toBeLessThan(1 - decayedSalience(0.2, 0.08) / 0.2);
  });
});

test("decays only facts past the grace period, stales below the floor, leaves superseded/group untouched, dormants threads", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const T = new Date("2026-01-01T00:00:00Z");
  const base = {
    subject: "user" as const,
    kind: "event" as const,
    embedding: vec(),
    valence: 0,
    confidence: 1,
    source: "turn" as const,
    status: "open" as const,
  };
  // 0.052 × (1 − 0.08 × 0.948) ≈ 0.048 < 0.05 floor → stale after one pass.
  const old = await facts.insertFact(getTestDb(), u, {
    ...base,
    content: "old trivia",
    created_at: T,
    salience: 0.052,
  });
  const fresh = await facts.insertFact(getTestDb(), u, {
    ...base,
    content: "fresh",
    created_at: new Date("2026-01-09T00:00:00Z"),
    salience: 0.5,
  });
  const recalled = await facts.insertFact(getTestDb(), u, {
    ...base,
    content: "recalled",
    created_at: T,
    last_recalled_at: new Date("2026-01-09T00:00:00Z"),
    salience: 0.5,
  });
  const sup = await facts.insertFact(getTestDb(), u, {
    ...base,
    content: "superseded",
    created_at: T,
    salience: 0.06,
    status: "superseded",
  });
  const grp = await facts.insertFact(getTestDb(), u, {
    ...base,
    content: "group",
    created_at: T,
    salience: 0.06,
    scope: "group",
  });
  const t = await threads.insertThread(
    getTestDb(),
    u,
    {
      title: "dentist",
      subject: "user",
      stakes: "low",
      next_checkpoint: new Date("2025-12-10T00:00:00Z"),
    },
    new Date("2025-12-01T00:00:00Z"),
  );

  const out = await decayPass(deps, new Date("2026-01-10T00:00:00Z"));
  expect(out).toMatchObject({ decayed: 1, staled: 1, dormant: 1 });
  expect((await facts.getFact(getTestDb(), u, old.id))!.status).toBe("stale");
  expect((await facts.getFact(getTestDb(), u, fresh.id))!.salience).toBeCloseTo(0.5, 6);
  expect((await facts.getFact(getTestDb(), u, recalled.id))!.salience).toBeCloseTo(0.5, 6);
  expect((await facts.getFact(getTestDb(), u, sup.id))!.status).toBe("superseded");
  // facts.getFact filters scope='private' by design (group is a post-MVP hook), so read the
  // group-scoped row directly to confirm decay left it untouched.
  const grpRow = (await getTestDb().execute(sql`SELECT salience FROM fact WHERE id = ${grp.id}`))
    .rows[0]!;
  expect(Number(grpRow.salience)).toBeCloseTo(0.06, 6);
  expect((await threads.getOwnedThread(getTestDb(), u, t.id))!.status).toBe("dormant");
});
