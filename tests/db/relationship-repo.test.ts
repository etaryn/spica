import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import * as rel from "@/db/repos/relationship";
import { insertTurn } from "@/db/repos/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);
const cfg = loadConfig().relationship;
const now = new Date("2026-01-05T09:00:00Z");

test("ensureRelationship creates the row and every param at the initial values, idempotently", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  await rel.ensureRelationship(db, u, now, cfg);
  await rel.ensureRelationship(db, u, now, cfg);
  const row = await rel.getRelationshipRow(db, u);
  expect(row?.status).toBe("active");
  expect(row?.make_up_state).toBe("none");
  const p = await rel.getParams(db, u);
  expect(p.msgs_per_day).toMatchObject({ value: 5, baseline: 5, variance: 25 });
  expect(p.hurt.value).toBe(0);
});

test("save + events round-trip, user-scoped", async () => {
  const db = getTestDb();
  const [a, b] = [await createTestUser(), await createTestUser()];
  for (const u of [a, b]) await rel.ensureRelationship(db, u, now, cfg);
  await db.transaction(async (tx) => {
    const row = await rel.lockRelationship(tx, a);
    const params = await rel.getParams(tx, a);
    params.hurt = { ...params.hurt, value: 0.4, updated_at: now };
    await rel.saveRelationship(tx, a, {
      state: { ...rel.toRelState(row), make_up_state: "due" },
      params,
    });
    await rel.insertRelationshipEvents(
      tx,
      a,
      [{ param: "hurt", before: 0, after: 0.4, cause: "signal", deviation: 0.9, detail: {} }],
      { turnId: null, now },
    );
  });
  expect((await rel.getParams(db, a)).hurt.value).toBeCloseTo(0.4);
  expect((await rel.getParams(db, b)).hurt.value).toBe(0);
  expect((await rel.getRelationshipRow(db, a))?.make_up_state).toBe("due");
  expect(await rel.listRelationshipEvents(db, a, 10)).toHaveLength(1);
  expect(await rel.listRelationshipEvents(db, b, 10)).toHaveLength(0);
});

test("turn counts: window, local date, session starts", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const s1 = randomUUID(),
    s2 = randomUUID();
  const mk = (session: string, iso: string, role: "user" | "companion" = "user") =>
    insertTurn(db, u, {
      id: randomUUID(),
      session_id: session,
      role,
      text: "x",
      created_at: new Date(iso),
    });
  await mk(s1, "2026-01-05T23:30:00Z");
  await mk(s1, "2026-01-05T23:40:00Z", "companion");
  await mk(s2, "2026-01-06T10:00:00Z");
  const since = new Date("2020-01-01T00:00:00Z");
  expect(
    await rel.countUserTurnsBetween(
      db,
      u,
      new Date("2026-01-05T12:00:00Z"),
      new Date("2026-01-06T12:00:00Z"),
    ),
  ).toBe(2);
  expect(await rel.countUserTurnsOnLocalDate(db, u, "2026-01-05", "UTC")).toBe(1);
  expect(await rel.countUserTurnsOnLocalDate(db, u, "2026-01-06", "Asia/Tokyo")).toBe(2); // 23:30Z = 08:30 JST on the 6th
  expect((await rel.userSessionStarts(db, u, 10, since)).map((d) => d.toISOString())).toEqual([
    "2026-01-06T10:00:00.000Z",
    "2026-01-05T23:30:00.000Z",
  ]);
  expect((await rel.userActiveHours(db, u, "UTC", since))[23]).toBe(1);
});

test("countUserTurnsOnLocalDate is DST-correct across America/New_York's spring-forward", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const s = randomUUID();
  const mk = (iso: string) =>
    insertTurn(db, u, {
      id: randomUUID(),
      session_id: s,
      role: "user",
      text: "x",
      created_at: new Date(iso),
    });
  // Local midnight 2026-03-08 America/New_York is 05:00Z (still EST); local midnight 2026-03-09 is 04:00Z (EDT).
  await mk("2026-03-08T04:59:00Z"); // 2026-03-07 23:59 EST: previous local day
  await mk("2026-03-08T05:01:00Z"); // 2026-03-08 00:01 EST: this local day
  await mk("2026-03-09T03:59:00Z"); // 2026-03-08 23:59 EST: still this local day (23h day)
  await mk("2026-03-09T04:01:00Z"); // 2026-03-09 00:01 EDT: next local day
  expect(await rel.countUserTurnsOnLocalDate(db, u, "2026-03-08", "America/New_York")).toBe(2);
});

test("userSessionStarts / userActiveHours ignore turns older than `since`", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const old = randomUUID(),
    recent = randomUUID();
  await insertTurn(db, u, {
    id: randomUUID(),
    session_id: old,
    role: "user",
    text: "old",
    created_at: new Date("2025-01-01T05:00:00Z"),
  });
  await insertTurn(db, u, {
    id: randomUUID(),
    session_id: recent,
    role: "user",
    text: "new",
    created_at: new Date("2026-01-05T09:00:00Z"),
  });
  const since = new Date("2025-12-01T00:00:00Z");
  const starts = await rel.userSessionStarts(db, u, 10, since);
  expect(starts.map((d) => d.toISOString())).toEqual(["2026-01-05T09:00:00.000Z"]);
  const hours = await rel.userActiveHours(db, u, "UTC", since);
  expect(hours[9]).toBe(1);
  expect(hours[5]).toBe(0);
});

test("adminListRelationshipUsers lists every user with a row", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  await rel.ensureRelationship(db, u, now, cfg);
  expect(await rel.adminListRelationshipUsers(db)).toEqual([u]);
});
