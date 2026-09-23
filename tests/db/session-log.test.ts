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
