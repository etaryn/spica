import { describe, expect, test } from "vitest";
import path from "node:path";
import { parseAt, ScriptSchema, loadScripts } from "../../evals/lib/script";

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
    assertions: [
      { type: "state", check: "turn_count", expect: 2 },
      { type: "recall", session: 2, fact: "Mia" },
    ],
  });
  expect(s.turn_gap_seconds).toBe(30);
  expect(s.sessions[0]!.user).toBe("main");
});

test("ScriptSchema: mode defaults to any; judged assertions and per-session forget parse", () => {
  const s = ScriptSchema.parse({
    name: "x",
    mode: "real",
    sessions: [
      { at: "day 0 09:00", turns: ["hi"] },
      { at: "+7d", turns: ["hey"] },
    ],
    assertions: [
      { type: "recall", session: 2, fact: "the user's dog is called Biscuit" },
      { type: "no_false_recall" },
      { type: "consistency" },
    ],
  });
  expect(s.mode).toBe("real");
  expect(
    ScriptSchema.parse({
      name: "y",
      sessions: [{ at: "day 0 09:00", turns: ["a"] }],
      assertions: [{ type: "no_false_recall" }],
    }).mode,
  ).toBe("any");
});

test("guard assertion parses with defaults and rejects unknown outcomes", () => {
  const base = { name: "g", sessions: [{ at: "day 0 09:00", turns: ["hi"] }] };
  const s = ScriptSchema.parse({
    ...base,
    assertions: [{ type: "guard", outcome_not: ["fallback"], max: { sent_with_violation: 1 } }],
  });
  expect(s.assertions[0]).toMatchObject({
    type: "guard",
    user: "main",
    outcome_not: ["fallback"],
    max: { sent_with_violation: 1 },
  });
  expect(() =>
    ScriptSchema.parse({ ...base, assertions: [{ type: "guard", outcome_not: ["nope"] }] }),
  ).toThrow();
});

describe("onboarding profiles", () => {
  const base = { confidence: 0.6, salience: 0.5 };
  test("feeling and promise facts are rejected: they happen in the relationship, not upfront", async () => {
    const { ProfileSchema } = await import("../../evals/lib/script");
    expect(
      ProfileSchema.safeParse({ ...base, facts: [{ kind: "trait", content: "x" }] }).success,
    ).toBe(true);
    expect(
      ProfileSchema.safeParse({ ...base, facts: [{ kind: "feeling", content: "x" }] }).success,
    ).toBe(false);
    expect(
      ProfileSchema.safeParse({ ...base, facts: [{ kind: "promise", content: "x" }] }).success,
    ).toBe(false);
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

test("every eval script parses; the guard-era honesty scripts carry a guard assertion", () => {
  const scripts = loadScripts(path.join(process.cwd(), "evals", "scripts"));
  for (const n of [
    "first-contact-job",
    "first-contact-interview",
    "first-contact-move",
    "first-contact-climbing",
    "first-contact-visit",
    "first-contact-big-day",
    "onboarding-coffee",
    "onboarding-music",
    "second-week-job",
    "absence-return",
  ]) {
    const s = scripts.find((x) => x.name === n);
    expect(s, n).toBeDefined();
    expect(
      s!.assertions.some((a) => a.type === "guard"),
      n,
    ).toBe(true);
  }
});

test("turns may be timed objects; scripts may override config; turn and reply_about entries parse", () => {
  const s = ScriptSchema.parse({
    name: "x",
    config: { turn: { settle_ms: 1000 } },
    sessions: [{ at: "day 0 09:00", turns: ["hi", { text: "and then", after_s: 2 }] }],
    assertions: [
      { type: "turn", session: 1, replies: 1, reply_covers: [[1, 2]] },
      { type: "reply_about", session: 1, reply: 1, about: "pizza", not_about: "recipes" },
    ],
  });
  expect(s.sessions[0]!.turns[1]).toEqual({
    text: "and then",
    after_s: 2,
    repeat_previous_id: false,
  });
});

test("seed_turns, scripted signals on a turn, and a relationship assertion parse; after_s may be omitted", () => {
  const s = ScriptSchema.parse({
    name: "rel",
    sessions: [
      {
        at: "day 0 09:00",
        seed_turns: { count: 3 },
        turns: [{ text: "x", signals: { apology: true } }],
      },
    ],
    assertions: [{ type: "relationship", param: "hurt", value: { lt: 0.5 } }],
  });
  expect(s.sessions[0]!.seed_turns).toEqual({ count: 3, text: "hey" });
  expect(s.sessions[0]!.turns[0]).toMatchObject({ text: "x", signals: { apology: true } });
  expect(s.assertions[0]).toMatchObject({
    type: "relationship",
    user: "main",
    param: "hurt",
    value: { lt: 0.5 },
  });
  expect(s.signal_source).toBe("scripted");
});

test("phase 5 script keys parse", () => {
  const s = ScriptSchema.parse({
    name: "x",
    sessions: [{ at: "day 0 10:00", turns: ["hi"] }],
    relationship_seed: { closeness: 0.5 },
    life: {
      plan: "scripted",
      plans: { "*": [{ start: "10:00", end: "13:00", kind: "busy", label: "reading" }] },
      inject: [{ day: 1, content: "Spica read." }],
    },
    assertions: [
      { type: "life", plans: { min: 1 } },
      { type: "core", lower_energy: { at: "day 1 19:00", than: "day 0 19:00" } },
      { type: "turn", session: 1, min_reply_delay_s: 5, notes: { max: 0 } },
    ],
  });
  expect(s.life?.plans["*"]![0]!.busy).toBe(0.5);
  expect(() =>
    ScriptSchema.parse({
      name: "y",
      sessions: [{ at: "day 0 10:00", turns: ["hi"] }],
      life: { plan: "scripted" },
      assertions: [{ type: "life" }],
    }),
  ).toThrow();
});

test("an injected event is spontaneous by default; a planned one needs its thought", () => {
  const parse = (inject: unknown[]) =>
    ScriptSchema.parse({
      name: "x",
      sessions: [{ at: "day 0 10:00", turns: ["hi"] }],
      life: { inject },
      assertions: [{ type: "life" }],
    });
  expect(parse([{ day: 1, content: "Spica read." }]).life!.inject[0]).toMatchObject({
    kind: "spontaneous",
    thought: null,
  });
  const planned = { day: 1, content: "Spica read.", kind: "planned" };
  expect(parse([{ ...planned, thought: "Spica means to read." }]).life!.inject[0]).toMatchObject({
    kind: "planned",
    thought: "Spica means to read.",
  });
  expect(() => parse([planned])).toThrow();
});

test("a script can seed hours together", () => {
  const s = ScriptSchema.parse({
    name: "x",
    relationship_seed: {},
    seed_hours_together: 24,
    sessions: [{ at: "day 0 10:00", turns: ["hi"] }],
    assertions: [{ type: "state", check: "turn_count", expect: 2 }],
  });
  expect(s.seed_hours_together).toBe(24);
});
