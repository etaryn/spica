import { afterAll, beforeEach, expect, test } from "vitest";
import { insertTurn } from "@/db/repos/user/session-log";
import { openAfter, overlaps, sameQuestion, withWords } from "@/mind/process/turn-taking/questions";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const q = (turnId: string, start: number, end: number) => ({ coords: [{ turnId, start, end }] });
const A = q("a", 0, 10);
const B = q("b", 0, 5);
const C = q("c", 3, 9);

test("coordinates overlap only within one message", () => {
  expect(overlaps({ turnId: "a", start: 0, end: 5 }, { turnId: "a", start: 4, end: 9 })).toBe(true);
  expect(overlaps({ turnId: "a", start: 0, end: 5 }, { turnId: "a", start: 5, end: 9 })).toBe(
    false,
  );
  expect(overlaps({ turnId: "a", start: 0, end: 5 }, { turnId: "b", start: 0, end: 5 })).toBe(
    false,
  );
  expect(sameQuestion(A, q("a", 0, 10))).toBe(true);
});

test("the judge drops only what it was shown, and adds only what isn't already open", () => {
  // Shown A and B, kept A: B goes. C was never shown (another message's judge added it): it stays.
  const v = { shown: [A, B], kept: [A], asked: [q("d", 0, 4), q("a", 2, 4)] };
  expect(openAfter([A, B, C], v, 5)).toEqual([A, C, q("d", 0, 4)]);
});

test("a question closed while the judge ran never comes back", () => {
  const v = { shown: [A], kept: [A], asked: [] };
  expect(openAfter([], v, 5)).toEqual([]);
});

test("no verdict keeps what is open; the cap keeps the oldest", () => {
  expect(openAfter([A, B], null, 5)).toEqual([A, B]);
  const v = { shown: [], kept: [], asked: [C] };
  expect(openAfter([A, B], v, 2)).toEqual([A, B]);
});

test("withWords slices the user's words back out, joining pieces, and leaves out a lost message", async () => {
  const db = getTestDb();
  const u = await createTestUser();
  const at = new Date("2026-01-05T09:00:00Z");
  const session = "00000000-0000-4000-8000-0000000000aa";
  const t1 = await insertTurn(db, u, {
    id: "00000000-0000-4000-8000-000000000001",
    session_id: session,
    role: "user",
    text: "so did you",
    created_at: at,
  });
  const t2 = await insertTurn(db, u, {
    id: "00000000-0000-4000-8000-000000000002",
    session_id: session,
    role: "user",
    text: "end up going? lol",
    created_at: at,
  });
  const spread = {
    coords: [
      { turnId: t1.id, start: 0, end: 10 },
      { turnId: t2.id, start: 0, end: 13 },
    ],
  };
  const lost = q("00000000-0000-4000-8000-000000000009", 0, 3);
  const outside = q(t1.id, 5, 40);
  expect(await withWords(db, u, [spread, lost, outside])).toEqual([
    { question: spread, text: "so did you / end up going?" },
  ]);
  expect(await withWords(db, u, [])).toEqual([]);
});
