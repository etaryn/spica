import { describe, expect, test } from "vitest";
import { parseAt, ScriptSchema } from "../../evals/lib/script";

describe("parseAt", () => {
  test("absolute day/time from a fixed base", () => {
    expect(parseAt("day 0 09:00", null).toISOString()).toBe("2026-01-05T09:00:00.000Z");
    expect(parseAt("day 7 18:30", null).toISOString()).toBe("2026-01-12T18:30:00.000Z");
  });
  test("relative to the previous session", () => {
    const prev = new Date("2026-01-05T09:00:00Z");
    expect(parseAt("+7d", prev).toISOString()).toBe("2026-01-12T09:00:00.000Z");
    expect(parseAt("+2h", prev).toISOString()).toBe("2026-01-05T11:00:00.000Z");
    expect(parseAt("+45m", prev).toISOString()).toBe("2026-01-05T09:45:00.000Z");
  });
  test("errors", () => {
    expect(() => parseAt("+7d", null)).toThrow(/previous session/);
    expect(() => parseAt("next tuesday", null)).toThrow(/unrecognised/);
  });
});

test("ScriptSchema applies defaults and accepts deferred assertion types", () => {
  const s = ScriptSchema.parse({
    name: "x",
    sessions: [{ at: "day 0 09:00", turns: ["hi"] }],
    assertions: [{ type: "state", check: "turn_count", expect: 2 }, { type: "recall", session: 2, fact: "Mia" }],
  });
  expect(s.turn_gap_seconds).toBe(30);
  expect(s.sessions[0]!.user).toBe("main");
});

test("ScriptSchema: mode defaults to any; judged assertions and per-session forget parse", () => {
  const s = ScriptSchema.parse({
    name: "x", mode: "real",
    sessions: [{ at: "day 0 09:00", turns: ["hi"] }, { at: "+7d", forget: ["Biscuit"], turns: ["hey"] }],
    assertions: [
      { type: "recall", session: 2, fact: "the user's dog is called Biscuit" },
      { type: "no_false_recall" }, { type: "consistency" },
    ],
  });
  expect(s.mode).toBe("real");
  expect(s.sessions[1]!.forget).toEqual(["Biscuit"]);
  expect(ScriptSchema.parse({ name: "y", sessions: [{ at: "day 0 09:00", turns: ["a"] }], assertions: [{ type: "no_false_recall" }] }).mode).toBe("any");
});
