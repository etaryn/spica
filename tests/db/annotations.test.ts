/** One user's labels: written per conversation, read back by session and by the turns they sit in. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import {
  insertAnnotations,
  sessionAnnotations,
  timeLabelsOn,
  type NewAnnotation,
} from "@/db/repos/user/annotations";
import { insertTurn } from "@/db/repos/user/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (min: number) => new Date(Date.UTC(2026, 0, 5, 9, min));

async function labelled(userId: string) {
  const session = randomUUID();
  const turn = await insertTurn(getTestDb(), userId, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text: "interview thursday",
    created_at: at(0),
  });
  const row = (layer: NewAnnotation["layer"], local: string, min: number): NewAnnotation => ({
    session_id: session,
    exchange_ref: turn.id,
    layer,
    local_id: local,
    coords: [{ turnId: turn.id, start: layer === "time" ? 10 : 0, end: 18 }],
    data: { id: local },
    created_at: at(min),
  });
  await insertAnnotations(getTestDb(), userId, [row("time", "t1", 2), row("move", "m1", 1)]);
  return { session, turn, row };
}

test("a session's labels come back oldest first, and only the time sits behind a gloss", async () => {
  const a = await createTestUser("a");
  const { session, turn } = await labelled(a);
  const rows = await sessionAnnotations(getTestDb(), a, session);
  expect(rows.map((r) => r.local_id)).toEqual(["m1", "t1"]);
  expect((await timeLabelsOn(getTestDb(), a, [turn.id])).map((r) => r.local_id)).toEqual(["t1"]);
  expect(await timeLabelsOn(getTestDb(), a, [])).toEqual([]);
});

test("another user sees none of them", async () => {
  const a = await createTestUser("a");
  const b = await createTestUser("b");
  const { session, turn } = await labelled(a);
  expect(await sessionAnnotations(getTestDb(), b, session)).toEqual([]);
  expect(await timeLabelsOn(getTestDb(), b, [turn.id])).toEqual([]);
});

test("a local id is used once per conversation", async () => {
  const a = await createTestUser("a");
  const { row } = await labelled(a);
  await expect(insertAnnotations(getTestDb(), a, [row("move", "m1", 3)])).rejects.toThrow();
});
