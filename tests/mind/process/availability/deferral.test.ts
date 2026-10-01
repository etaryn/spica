import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { availabilityDelay, deferWhileBusy, wantsNote } from "@/mind/process/availability/deferral";
import { insertFact } from "@/db/repos/user/facts";
import * as rel from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import { relationship, relationship_param } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { closeTestDb, createTestUser, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const cfg = makeTestDeps().config.availability;
const MIN = 60_000;
const now = new Date("2026-01-05T10:30:00Z");
const busy = { busy: 0.8, block: "busy" as const, end: new Date("2026-01-05T13:00:00Z") };

test("delay shrinks with closeness and vanishes at the override", () => {
  const low = availabilityDelay(busy, 0.2, now, 0.5, cfg);
  expect(low).toBe(Math.round(0.8 * (1 - 0.2 / 0.8) * cfg.max_delay_ms));
  expect(availabilityDelay(busy, 0.5, now, 0.5, cfg)).toBeLessThan(low);
  expect(availabilityDelay(busy, 0.8, now, 0.5, cfg)).toBe(0);
});

test("quiet blocks use the longer maximum; jitter stays within ±jitter", () => {
  const quiet = { busy: 0.9, block: "quiet" as const, end: new Date("2026-01-06T00:00:00Z") };
  expect(availabilityDelay(quiet, 0, now, 0.5, cfg)).toBe(Math.round(0.9 * cfg.quiet_max_delay_ms)); // 7.2 h, below the 13.5 h to midnight
  expect(availabilityDelay(busy, 0.2, now, 0, cfg)).toBe(
    Math.round(0.8 * 0.75 * cfg.max_delay_ms * (1 - cfg.jitter)),
  );
  expect(availabilityDelay(busy, 0.2, now, 1, cfg)).toBe(
    Math.round(0.8 * 0.75 * cfg.max_delay_ms * (1 + cfg.jitter)),
  );
});

test("never past the block's end (review focus 2)", () => {
  const ending = { ...busy, end: new Date(now.getTime() + 5 * MIN) };
  expect(availabilityDelay(ending, 0, now, 1, cfg)).toBe(5 * MIN);
});

test("the note needs a long delay, enough closeness and no earlier note in the block", () => {
  expect(wantsNote(cfg.note_min_delay_ms, cfg.note_min_closeness, false, cfg)).toBe(true);
  expect(wantsNote(cfg.note_min_delay_ms - 1, 0.5, false, cfg)).toBe(false);
  expect(wantsNote(cfg.note_min_delay_ms, cfg.note_min_closeness - 0.01, false, cfg)).toBe(false);
  expect(wantsNote(cfg.note_min_delay_ms, 0.5, true, cfg)).toBe(false);
});

async function busyUser(closeness: number) {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const u = await createTestUser();
  await rel.ensureRelationship(deps.db, u, now, deps.config.relationship);
  await deps.db
    .update(relationship_param)
    .set({ value: closeness, baseline: closeness })
    .where(and(eq(relationship_param.user_id, u), eq(relationship_param.name, "closeness")));
  const f = await insertFact(deps.db, u, {
    subject: "self",
    kind: "event",
    content: "Spica's morning: rewatching an old film.",
    payload: {
      start: "2026-01-05T10:00:00.000Z",
      end: "2026-01-05T13:00:00.000Z",
      block: "busy",
      busy: 0.8,
      label: "rewatching an old film",
      life_day: "2026-01-05",
      shared: true,
    },
    embedding: vec(),
    created_at: now,
    status: "open",
    salience: 0.2,
    valence: 0,
    confidence: 1,
    source: "generated",
  });
  return { deps, u, f };
}

test("deferWhileBusy: delay + note for a mid-closeness user in a busy block", async () => {
  const { deps, u, f } = await busyUser(0.5);
  const a = await deferWhileBusy(deps, u, now, "seed");
  expect(a.delayMs).toBeGreaterThan(cfg.note_min_delay_ms);
  expect(a).toMatchObject({ blockFactId: f.id, blockKind: "busy", note: true });
  await insertTurn(deps.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "companion",
    text: "busy, later?",
    created_at: new Date("2026-01-05T10:10:00Z"),
    trigger: "availability",
    extracted: true,
  });
  expect((await deferWhileBusy(deps, u, now, "seed")).note).toBe(false);
});

test("deferWhileBusy fails open: no block, crisis quiet, or an error", async () => {
  const { deps, u } = await busyUser(0.2);
  expect((await deferWhileBusy(deps, u, new Date("2026-01-05T14:00:00Z"), "s")).delayMs).toBe(0);
  await deps.db
    .update(relationship)
    .set({ crisis_quiet_until: new Date(now.getTime() + 60 * MIN) })
    .where(eq(relationship.user_id, u));
  expect((await deferWhileBusy(deps, u, now, "s")).delayMs).toBe(0);
  expect((await deferWhileBusy({ ...deps, db: null as never }, u, now, "s")).delayMs).toBe(0);
});
