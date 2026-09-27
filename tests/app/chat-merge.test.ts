import { expect, test } from "vitest";
import { applyPart, markFailed, mergeHistory, type UiMessage } from "@/app/chat/merge";

const user = (id: string, status: UiMessage["status"] = "sent"): UiMessage => ({ id, role: "user", parts: ["hi"], crisisCard: null, status });

test("SSE parts build a companion message in order and ignore duplicates", () => {
  let m: UiMessage[] = [user("u1")];
  m = applyPart(m, { turnId: "c1", part: 0, of: 2, text: "WAIT.", crisisCard: null });
  m = applyPart(m, { turnId: "c1", part: 0, of: 2, text: "WAIT.", crisisCard: null });
  m = applyPart(m, { turnId: "c1", part: 1, of: 2, text: "promotion??", crisisCard: null });
  expect(m).toEqual([user("u1"), { id: "c1", role: "companion", parts: ["WAIT.", "promotion??"], crisisCard: null, status: "sent" }]);
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
  expect(m.map((x) => [x.id, x.status])).toEqual([["u1", "sent"], ["u2", "pending"], ["c9", "sent"]]);
});

test("reply_failed marks those user bubbles failed", () => {
  expect(markFailed([user("u1"), user("u2")], ["u2"]).map((x) => x.status)).toEqual(["sent", "failed"]);
});
