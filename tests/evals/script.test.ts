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

test("guard assertion parses with defaults and rejects unknown outcomes", () => {
  const base = { name: "g", sessions: [{ at: "day 0 09:00", turns: ["hi"] }] };
  const s = ScriptSchema.parse({ ...base, assertions: [{ type: "guard", outcome_not: ["fallback"], max: { sent_with_violation: 1 } }] });
  expect(s.assertions[0]).toMatchObject({ type: "guard", user: "main", outcome_not: ["fallback"], max: { sent_with_violation: 1 } });
  expect(() => ScriptSchema.parse({ ...base, assertions: [{ type: "guard", outcome_not: ["nope"] }] })).toThrow();
});

describe("onboarding profiles", () => {
  const base = { confidence: 0.6, salience: 0.5 };
  test("feeling and promise facts are rejected: they happen in the relationship, not upfront", async () => {
    const { ProfileSchema } = await import("../../evals/lib/script");
    expect(ProfileSchema.safeParse({ ...base, facts: [{ kind: "trait", content: "x" }] }).success).toBe(true);
    expect(ProfileSchema.safeParse({ ...base, facts: [{ kind: "feeling", content: "x" }] }).success).toBe(false);
    expect(ProfileSchema.safeParse({ ...base, facts: [{ kind: "promise", content: "x" }] }).success).toBe(false);
  });
  test("every profile file in evals/profiles loads, including minimal < basic < rich", async () => {
    const path = await import("node:path");
    const { loadProfiles } = await import("../../evals/lib/script");
    const p = loadProfiles(path.join(process.cwd(), "evals", "profiles"));
    expect(Object.keys(p).sort()).toEqual(["basic", "minimal", "rich"]);
    expect(p.minimal!.facts.length).toBeLessThan(p.basic!.facts.length);
    expect(p.basic!.facts.length).toBeLessThan(p.rich!.facts.length);
  });
});
