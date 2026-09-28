import { expect, test } from "vitest";
import { applyPart, catchUpAnchor, markFailed, mergeHistory, type UiMessage } from "@/app/chat/merge";

const user = (id: string, status: UiMessage["status"] = "sent"): UiMessage => ({ id, role: "user", parts: ["hi"], crisisCard: null, status });

test("SSE parts build a companion message in order and ignore duplicates", () => {
  let m: UiMessage[] = [user("u1")];
  m = applyPart(m, { turnId: "c1", part: 0, of: 2, text: "WAIT.", crisisCard: null });
  m = applyPart(m, { turnId: "c1", part: 0, of: 2, text: "WAIT.", crisisCard: null });
  m = applyPart(m, { turnId: "c1", part: 1, of: 2, text: "promotion??", crisisCard: null });
  expect(m).toEqual([user("u1"), { id: "c1", role: "companion", parts: ["WAIT.", "promotion??"], crisisCard: null, status: "sent", of: 2, trigger: null }]);
});

test("history and SSE parts for the same turn never duplicate", () => {
  let m: UiMessage[] = [user("u1")];
  m = applyPart(m, { turnId: "c1", part: 0, of: 2, text: "WAIT.", crisisCard: null });
  m = mergeHistory(m, [
    { id: "u1", role: "user", parts: ["hi"], crisisCard: null, trigger: null },
    { id: "c1", role: "companion", parts: ["WAIT.", "promotion??"], crisisCard: null, trigger: null },
  ]);
  m = applyPart(m, { turnId: "c1", part: 1, of: 2, text: "promotion??", crisisCard: null });
  expect(m.map((x) => [x.id, x.parts.length])).toEqual([["u1", 1], ["c1", 2]]);
});

test("history appends missing turns, keeps pending local messages, and marks sent", () => {
  const m = mergeHistory([user("u1"), user("u2", "pending")], [
    { id: "u1", role: "user", parts: ["hi"], crisisCard: null, trigger: null },
    { id: "c9", role: "companion", parts: ["huh"], crisisCard: null, trigger: "backchannel" },
  ]);
  // Server order: c9 follows u1; u2 isn't on the server yet, so it stays after.
  expect(m.map((x) => [x.id, x.status])).toEqual([["u1", "sent"], ["c9", "sent"], ["u2", "pending"]]);
});

test("reply_failed marks those user bubbles failed", () => {
  expect(markFailed([user("u1"), user("u2")], ["u2"]).map((x) => x.status)).toEqual(["sent", "failed"]);
});

test("catch-up anchor sits before an in-progress companion reply", () => {
  let m: UiMessage[] = [user("u1")];
  m = applyPart(m, { turnId: "c1", part: 0, of: 2, text: "WAIT.", crisisCard: null });
  expect(catchUpAnchor(m)).toBe("u1");
});

test("catch-up anchor advances once history supplies the full reply", () => {
  let m: UiMessage[] = [user("u1")];
  m = applyPart(m, { turnId: "c1", part: 0, of: 2, text: "WAIT.", crisisCard: null });
  m = mergeHistory(m, [
    { id: "u1", role: "user", parts: ["hi"], crisisCard: null, trigger: null },
    { id: "c1", role: "companion", parts: ["WAIT.", "promotion??"], crisisCard: null, trigger: null },
  ]);
  expect(catchUpAnchor(m)).toBe("c1");
});

test("a pending local message is never the catch-up anchor", () => {
  const done: UiMessage = { id: "c1", role: "companion", parts: ["hi"], crisisCard: null, status: "sent", of: 1 };
  expect(catchUpAnchor([done, user("u2", "pending")])).toBe("c1");
});

test("catch-up anchor is null when nothing usable has landed yet", () => {
  expect(catchUpAnchor([user("u1", "pending")])).toBeNull();
});

test("backchannel trigger is carried through applyPart and mergeHistory", () => {
  let m: UiMessage[] = [];
  m = applyPart(m, { turnId: "c1", part: 0, of: 1, text: "huh?", crisisCard: null, trigger: "backchannel" });
  expect(m[0]!.trigger).toBe("backchannel");
  const h = mergeHistory([], [{ id: "c2", role: "companion", parts: ["ok"], crisisCard: null, trigger: "backchannel" }]);
  expect(h[0]!.trigger).toBe("backchannel");
});

const local = (id: string): UiMessage => ({ ...user(id), local: true });
const reply = (id: string): UiMessage => ({ id, role: "companion", parts: ["ok"], crisisCard: null, status: "sent", of: 1, trigger: null });

test("a reply missed while SSE was down is recovered even if the user sent more meanwhile", () => {
  // c0 came from the server; u1 and u2 were sent from this tab (POST 202 → sent). The reply to u1 (r1)
  // was emitted while the stream was down, and landed on the server before u2.
  const m: UiMessage[] = [reply("c0"), local("u1"), local("u2")];
  expect(catchUpAnchor(m)).toBe("c0");
  const merged = mergeHistory(m, [
    { id: "u1", role: "user", parts: ["hi"], crisisCard: null, trigger: null },
    { id: "r1", role: "companion", parts: ["ok"], crisisCard: null, trigger: null },
    { id: "u2", role: "user", parts: ["hi"], crisisCard: null, trigger: null },
  ]);
  expect(merged.map((x) => x.id)).toEqual(["c0", "u1", "r1", "u2"]);
  // Once history has confirmed them, they're server-delivered and valid anchors.
  expect(catchUpAnchor(merged)).toBe("u2");
});
