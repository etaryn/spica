import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import * as log from "@/db/repos/session-log";
import { deleteUser } from "@/db/repos/users";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (min: number) => new Date(Date.UTC(2026, 0, 5, 9, min));

async function turn(userId: string, role: "user" | "companion", text: string, created_at: Date, extra: Partial<log.NewTurn> = {}) {
  return log.insertTurn(getTestDb(), userId, { id: randomUUID(), session_id: extra.session_id ?? randomUUID(), role, text, created_at, ...extra });
}

test("recentTurns returns the last N oldest-first, user before companion on ties", async () => {
  const u = await createTestUser();
  const sid = randomUUID();
  const t1 = await turn(u, "user", "one", at(0), { session_id: sid });
  await turn(u, "companion", "reply one", at(0), { session_id: sid, reply_to: t1.id });
  const t2 = await turn(u, "user", "two", at(1), { session_id: sid });
  await turn(u, "companion", "reply two", at(1), { session_id: sid, reply_to: t2.id });
  const recent = await log.recentTurns(getTestDb(), u, 3);
  expect(recent.map((t) => t.text)).toEqual(["reply one", "two", "reply two"]);
});

test("turnsAfter is deterministic on ties and falls back to the latest page for an unknown id", async () => {
  const u = await createTestUser();
  const sid = randomUUID();
  const same = at(0);
  // Three turns share one created_at (and role); only `id` breaks the tie, so the ORDER BY id
  // tiebreaker (and the exact WHERE it enables) must be exercised, not just lucky insert order.
  const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
  await turn(u, "user", "a", same, { id: ids[0]!, session_id: sid });
  await turn(u, "user", "b", same, { id: ids[1]!, session_id: sid });
  await turn(u, "user", "c", same, { id: ids[2]!, session_id: sid });

  const after = await log.turnsAfter(getTestDb(), u, ids[0]!, 10);
  expect(after.map((t) => t.id)).toEqual([ids[1], ids[2]]);

  // A well-formed uuid that isn't a real turn id falls back to the latest page (recentTurns).
  const fallback = await log.turnsAfter(getTestDb(), u, randomUUID(), 10);
  expect(fallback.map((t) => t.id).sort()).toEqual([...ids].sort());
});

test("getReplyTo and lastUserTurn", async () => {
  const u = await createTestUser();
  const t1 = await turn(u, "user", "one", at(0));
  const r1 = await turn(u, "companion", "r", at(0), { reply_to: t1.id });
  expect((await log.getReplyTo(getTestDb(), u, t1.id))?.id).toBe(r1.id);
  expect((await log.lastUserTurn(getTestDb(), u))?.id).toBe(t1.id);
});

test("reply_to is unique", async () => {
  const u = await createTestUser();
  const t1 = await turn(u, "user", "one", at(0));
  await turn(u, "companion", "r1", at(0), { reply_to: t1.id });
  await expect(turn(u, "companion", "r2", at(0), { reply_to: t1.id })).rejects.toThrow();
});

test("insertReplyIfAbsent reports a reply_to collision as null instead of throwing", async () => {
  const u = await createTestUser();
  const t1 = await turn(u, "user", "one", at(0));
  const r1 = await log.insertReplyIfAbsent(getTestDb(), u, { id: randomUUID(), session_id: t1.session_id, role: "companion", text: "r1", created_at: at(1), reply_to: t1.id });
  expect(r1?.text).toBe("r1");
  const r2 = await log.insertReplyIfAbsent(getTestDb(), u, { id: randomUUID(), session_id: t1.session_id, role: "companion", text: "r2", created_at: at(2), reply_to: t1.id });
  expect(r2).toBeNull();
  expect((await log.getReplyTo(getTestDb(), u, t1.id))?.text).toBe("r1");
});

test("every read is scoped by user", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const ta = await turn(a, "user", "secret of a", at(0));
  expect(await log.getTurn(getTestDb(), b, ta.id)).toBeNull();
  expect(await log.recentTurns(getTestDb(), b, 50)).toEqual([]);
  expect(await log.listTurns(getTestDb(), b)).toEqual([]);
  expect(await log.lastUserTurn(getTestDb(), b)).toBeNull();
});

test("deleteUser removes the transcript", async () => {
  const u = await createTestUser();
  await turn(u, "user", "hi", at(0));
  await deleteUser(getTestDb(), u);
  expect(await log.listTurns(getTestDb(), u)).toEqual([]);
});

test("userTurnStats counts sessions and local days of user turns up to a time", async () => {
  const u = await createTestUser();
  const s1 = randomUUID();
  const s2 = randomUUID();
  const turn = (session_id: string, at: string, role: "user" | "companion" = "user") =>
    log.insertTurn(getTestDb(), u, { id: randomUUID(), session_id, role, text: "x", created_at: new Date(at) });
  await turn(s1, "2026-01-05T23:30:00Z");                 // 5 Jan UTC, 6 Jan in Auckland (+13)
  await turn(s1, "2026-01-05T23:31:00Z", "companion");
  await turn(s2, "2026-01-06T20:00:00Z");                 // 6 Jan UTC, 7 Jan in Auckland
  await turn(s2, "2026-01-09T10:00:00Z");                 // after the cut-off
  const upTo = new Date("2026-01-07T00:00:00Z");
  expect(await log.userTurnStats(getTestDb(), u, upTo, "UTC")).toEqual({ sessions: 2, days: 2, first: new Date("2026-01-05T23:30:00Z") });
  expect((await log.userTurnStats(getTestDb(), u, upTo, "Pacific/Auckland")).days).toBe(2);
  expect((await log.userTurnStats(getTestDb(), u, new Date("2026-01-06T00:00:00Z"), "UTC")).sessions).toBe(1);
});

test("answeringReply returns the earliest reply covering the turn, not whichever row the scan finds first", async () => {
  const u = await createTestUser();
  const sid = randomUUID();
  const t1 = await turn(u, "user", "i can't do this anymore", at(0), { session_id: sid });
  const t2 = await turn(u, "user", "anyway, pizza?", at(5), { session_id: sid });
  // Insert the later reply first so an unordered LIMIT 1 would find it before the crisis reply.
  await turn(u, "companion", "pizza!", at(6), { session_id: sid, reply_to: t2.id });
  const crisisReply = await turn(u, "companion", "i'm here", at(1), { session_id: sid, reply_to: t1.id, safety_flag: { flagged: true, category: "self_harm", source: "model" } as never });
  expect((await log.answeringReply(getTestDb(), u, t1))?.id).toBe(crisisReply.id);
});
