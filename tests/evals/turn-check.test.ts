import { expect, test } from "vitest";
import type { Turn } from "@/db/repos/session-log";
import { checkTurn } from "../../evals/lib/turn-check";

const t0 = Date.UTC(2026, 0, 5, 9);
let n = 0;
const turn = (role: "user" | "companion", s: number, extra: Partial<Turn> = {}): Turn => ({
  id: `t${++n}`, user_id: "u", session_id: "s", role, text: role, created_at: new Date(t0 + s * 1000),
  trigger: null, extracted: false, safety_flag: null, reply_to: null, extract_attempts: 0, ...extra,
} as Turn);

test("counts replies and backchannels, derives coverage from reply_to, checks reply delay", () => {
  const u1 = turn("user", 0), u2 = turn("user", 5), bc = turn("companion", 7, { trigger: "backchannel" }), u3 = turn("user", 10);
  const r1 = turn("companion", 20, { reply_to: u3.id });
  const u4 = turn("user", 100), r2 = turn("companion", 110, { reply_to: u4.id });
  const turns = [u1, u2, bc, u3, r1, u4, r2];
  const range = { start: new Date(t0), end: new Date(t0 + 3600_000) };
  expect(checkTurn(turns, range, { type: "turn", session: 1, user: "main", replies: 2, backchannels: { max: 1 }, reply_covers: [[1, 2, 3], [4]], max_reply_delay_s: 25 })).toEqual({ ok: true });
  const bad = checkTurn(turns, range, { type: "turn", session: 1, user: "main", replies: 1, reply_covers: [[1, 2, 3, 4]], max_reply_delay_s: 5 });
  expect(bad.ok).toBe(false);
  expect(bad.detail).toMatch(/replies: expected 1, got 2/);
});

test("max_reply_delay_s skips a reply that covers no user turn in the session (no fallback to turn 1)", () => {
  // A reply landing in session 2 whose reply_to is session 1's last turn covers nothing in this range; its delay
  // must not be measured from session 2's first user turn (that would read 20 s here, over the 15 s max).
  const s1last = turn("user", 0);
  const u1 = turn("user", 3700), r1 = turn("companion", 3710, { reply_to: u1.id });
  const late = turn("companion", 3720, { reply_to: s1last.id });
  const range = { start: new Date(t0 + 3600_000), end: new Date(t0 + 7200_000) };
  const r = checkTurn([s1last, u1, r1, late], range, { type: "turn", session: 2, user: "main", reply_covers: [[1], []], max_reply_delay_s: 15 });
  expect(r).toEqual({ ok: true });
});
