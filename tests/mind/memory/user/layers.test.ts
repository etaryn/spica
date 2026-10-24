/** Code-made layers: conversations and exchanges come from the transcript alone. */
import { expect, test } from "vitest";
import { conversations, messagesOf, type LayerTurn } from "@/mind/memory/user/layers";

const turn = (
  id: string,
  role: LayerTurn["role"],
  minute: number,
  extra: Partial<LayerTurn> = {},
): LayerTurn => ({
  id,
  role,
  text: id,
  created_at: new Date(Date.UTC(2026, 0, 7, 20, minute)),
  session_id: "s1",
  reply_to: null,
  trigger: null,
  ...extra,
});

test("a reply ends an exchange with the user turns it answers; a reach-out is an exchange alone", () => {
  const result = conversations([
    turn("c3", "companion", 36, { reply_to: "u4" }),
    turn("r1", "companion", 0, { trigger: "reach_out", session_id: "s0" }),
    turn("u1", "user", 30),
    turn("b1", "companion", 30, { trigger: "backchannel" }),
    turn("u2", "user", 31),
    turn("c1", "companion", 32, { reply_to: "u2" }),
    turn("u3", "user", 33),
    turn("u4", "user", 34),
    turn("c2", "companion", 35, { reply_to: "u3" }),
  ]);
  expect(result.map((c) => [c.id, c.turns.map((t) => t.id)])).toEqual([
    ["s0", ["r1"]],
    ["s1", ["u1", "b1", "u2", "c1", "u3", "u4", "c2", "c3"]],
  ]);
  expect(result[0]!.exchanges).toEqual([{ burst: [], replyId: "r1" }]);
  expect(result[1]!.exchanges).toEqual([
    { burst: ["u1", "u2"], replyId: "c1" },
    { burst: ["u3"], replyId: "c2" },
    { burst: ["u4"], replyId: "c3" },
  ]);
});

test("turns become messages with a speaker", () => {
  expect(messagesOf([turn("u1", "user", 0), turn("c1", "companion", 1)])).toEqual([
    { id: "u1", speaker: "user", text: "u1", at: new Date(Date.UTC(2026, 0, 7, 20, 0)) },
    { id: "c1", speaker: "spica", text: "c1", at: new Date(Date.UTC(2026, 0, 7, 20, 1)) },
  ]);
});
