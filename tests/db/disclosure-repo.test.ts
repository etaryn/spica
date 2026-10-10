/** The disclosure ledger: levels per item, recent depths and the held-back check, per user. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import {
  disclosureLevels,
  heldBackInSession,
  insertDisclosures,
  recentDisclosureDepths,
} from "@/db/repos/user/disclosure";
import { insertTurn } from "@/db/repos/user/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);
const at = (m: number) => new Date(Date.UTC(2026, 0, 5, 9, m));
const row = (ref: string, depth: number, level: "open" | "peek", m: number) => ({
  ref_kind: "memory" as const,
  ref_id: ref,
  depth,
  level,
  fact_id: null,
  turn_id: null,
  created_at: at(m),
});

test("told openly at any point wins over a hint; other users see nothing", async () => {
  const db = getTestDb();
  const [a, b] = [await createTestUser(), await createTestUser()];
  const [x, y] = [randomUUID(), randomUUID()];
  await insertDisclosures(db, a, [
    row(x, 3, "open", 0),
    row(x, 3, "peek", 1),
    row(y, 2, "peek", 2),
  ]);
  const levels = await disclosureLevels(db, a, [x, y, randomUUID()]);
  expect(Object.fromEntries(levels)).toEqual({ [x]: "open", [y]: "peek" });
  expect((await disclosureLevels(db, b, [x, y])).size).toBe(0);
  expect(await recentDisclosureDepths(db, a, 2)).toEqual([2, 3]);
  expect(await recentDisclosureDepths(db, b, 2)).toEqual([]);
});

test("held back is true only for a reply in that session that held that item", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const [session, other, ref] = [randomUUID(), randomUUID(), randomUUID()];
  await insertTurn(db, u, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: "mm",
    created_at: at(0),
    depth: { open: 1, peek: 1, held_back: ref },
  });
  expect(await heldBackInSession(db, u, session, ref)).toBe(true);
  expect(await heldBackInSession(db, u, other, ref)).toBe(false);
  expect(await heldBackInSession(db, u, session, randomUUID())).toBe(false);
});
