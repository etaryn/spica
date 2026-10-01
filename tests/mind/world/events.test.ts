/**
 * Her core events: the pure checks (shape, rules, the generator's input) and every branch of the
 * generator against her core memory.
 */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { coreDepsOf } from "@/mind/platform/deps";
import { buildEventInput, checkEvent, checkRules, generateCoreEvents } from "@/mind/world/events";
import { closeTestDb, resetDb, vec } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";
import { sequence } from "../../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");
const day = "2026-01-05";
const DAY = 86_400_000;
const cfg = loadConfig().core.world;
const ev = (content: string, extra: object = {}) => ({
  content,
  at: "15:00",
  valence: 0.3,
  stakes: "low",
  entity_names: [],
  ...extra,
});
const always = { core: { world: { event_probability: 1, events_per_day_max: 1 } } };

test("checkEvent rejects bad times and empty content, clamps valence", () => {
  expect(
    checkEvent({ content: " ", at: "10:00", valence: 0, stakes: "low", entity_names: [] }, 300),
  ).toBeNull();
  expect(
    checkEvent(
      { content: "Spica read.", at: "24:00", valence: 0, stakes: "low", entity_names: [] },
      300,
    ),
  ).toBeNull();
  expect(
    checkEvent(
      { content: "Spica read.", at: "10:00", valence: 3, stakes: "low", entity_names: [" Alcor "] },
      300,
    ),
  ).toEqual({
    content: "Spica read.",
    at: "10:00",
    valence: 1,
    stakes: "low",
    entity_names: ["Alcor"],
  });
});

test("checkEvent enforces the configured content cap; config defaults", () => {
  expect(cfg.event_max_chars).toBe(300);
  expect(cfg.injected_event_at).toBe("12:00");
  const c = {
    content: "Spica read a long book.",
    at: "10:00",
    valence: 0,
    stakes: "low" as const,
    entity_names: [],
  };
  expect(checkEvent(c, 10)).toBeNull();
  expect(checkEvent(c, cfg.event_max_chars)).not.toBeNull();
});

test("checkRules: one new entity a week, one high-stakes event per window, canon is known", () => {
  const known = new Set(["alcor"]);
  const c = (names: string[], stakes: "low" | "high" = "low") => ({
    content: "x",
    at: "10:00",
    valence: 0,
    stakes,
    entity_names: names,
  });
  const none = { known, lastNewEntityAt: null, lastHighStakesAt: null };
  expect(checkRules(c(["Alcor"]), { ...none, lastNewEntityAt: now }, now, cfg)).toBeNull();
  expect(checkRules(c(["Mira"]), none, now, cfg)).toBeNull();
  expect(
    checkRules(c(["Mira"]), { ...none, lastNewEntityAt: new Date(now.getTime() - DAY) }, now, cfg),
  ).toBe("rule:new_entity");
  expect(checkRules(c(["Mira", "Oren"]), none, now, cfg)).toBe("rule:new_entity");
  expect(
    checkRules(
      c([], "high"),
      { ...none, lastHighStakesAt: new Date(now.getTime() - DAY) },
      now,
      cfg,
    ),
  ).toBe("rule:high_stakes");
});

test("buildEventInput shows her plan, her recent life, her people and the rejected attempts", () => {
  const input = buildEventInput(
    {
      plan: {
        blocks: [{ start: "09:00", end: "12:00", kind: "busy", label: "reading", busy: 0.6 }],
      },
      episodes: [{ content: "She rewatched Solaris.", when: new Date(now.getTime() - DAY) }],
      people: ["Alcor"],
    },
    day,
    [{ candidate: { content: "x" }, reason: "it repeats something" }],
    now,
  );
  expect(input).toContain("09:00-12:00 busy: reading");
  expect(input).toContain("What has happened in her life lately (never contradict):");
  expect(input).toContain("She rewatched Solaris.");
  expect(input).toContain("People she knows: Alcor.");
  expect(input).toContain("Rejected attempts");

  const empty = buildEventInput({ plan: null, episodes: [], people: [] }, day, [], now);
  expect(empty).toContain("unknown, keep the event generic");
  expect(empty).toContain("What has happened in her life lately: nothing yet.");
});

async function withEpisode(deps: ReturnType<typeof makeTestDeps>, content: string) {
  await deps.core.memory.insert({
    kind: "episode",
    content,
    embedding: vec(0.01),
    occurred_at: now,
    created_at: now,
    status: "resolved",
    salience: 0.4,
    valence: 0,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
}

test("accepts a valid event with no near memory, without asking reconcile", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(ev("She found an old film."));
  const out = await generateCoreEvents(coreDepsOf(deps), day, now);
  expect(out.accepted).toHaveLength(1);
  expect(out.attempts.map((a) => a.decision)).toEqual(["accepted"]);
  expect(deps.llm.structuredCalls.filter((c) => c.purpose === "reconcile")).toHaveLength(0);
});

test.each(["duplicate", "contradicts"] as const)(
  "a %s is regenerated with the reason",
  async (relation) => {
    const deps = makeTestDeps(always);
    // Every text embeds to the stored episode's vector, so it is always a near neighbour.
    vi.spyOn(deps.embedder, "embed").mockImplementation(async (xs) => xs.map(() => vec(0.01)));
    await withEpisode(deps, "She rewatched Solaris.");
    const near = await deps.core.memory.near(vec(0.01), 1, 0);
    deps.llm.handlers.life_event = sequence(ev("She rewatched Solaris."), ev("She baked bread."));
    deps.llm.handlers.reconcile = sequence(
      { relation, target_fact_id: near[0]!.id },
      { relation: "new", target_fact_id: null },
    );
    const out = await generateCoreEvents(coreDepsOf(deps), day, now);
    expect(out.attempts.map((a) => a.decision)).toEqual([relation, "accepted"]);
    expect(out.attempts[0]!.targetMemoryId).toBe(near[0]!.id);
    const second = deps.llm.structuredCalls.filter((c) => c.purpose === "life_event")[1]!;
    expect(second.input).toContain("Rejected attempts");
  },
);

test("two new people at once breaks the new-entity rule", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(
    ev("She met Ana and Bo.", { entity_names: ["Ana", "Bo"] }),
    ev("She read alone."),
  );
  const out = await generateCoreEvents(coreDepsOf(deps), day, now);
  expect(out.attempts.map((a) => a.decision)).toEqual(["rule:new_entity", "accepted"]);
});

test("high stakes too soon after the last one is refused", async () => {
  const deps = makeTestDeps(always);
  await deps.core.world.recordEvent({
    at: now,
    kind: "planned",
    content: "big",
    valence: 0.5,
    stakes: "high",
    agents: [],
    life_day: "2026-01-04",
    created_at: now,
  });
  deps.llm.handlers.life_event = sequence(
    ev("Another big thing.", { stakes: "high" }),
    ev("small"),
  );
  const out = await generateCoreEvents(coreDepsOf(deps), day, now);
  expect(out.attempts[0]!.decision).toBe("rule:high_stakes");
});

test("an invalid event (bad time) is retried, and gives up after regen_attempts", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(ev("x", { at: "25:99" }));
  const out = await generateCoreEvents(coreDepsOf(deps), day, now);
  expect(out.accepted).toHaveLength(0);
  expect(out.attempts).toHaveLength(1 + deps.config.core.world.regen_attempts);
  expect(new Set(out.attempts.map((a) => a.decision))).toEqual(new Set(["invalid"]));
});

test("a model error or timeout propagates (the tick retries next hour)", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(new Error("timeout"));
  await expect(generateCoreEvents(coreDepsOf(deps), day, now)).rejects.toThrow("timeout");
});

test("draws are seeded by day only: the same day gives the same draws", async () => {
  const cfg = { core: { world: { event_probability: 0.5, events_per_day_max: 3 } } };
  const a = makeTestDeps(cfg);
  const b = makeTestDeps(cfg);
  const ra = await generateCoreEvents(coreDepsOf(a), day, now);
  const rb = await generateCoreEvents(coreDepsOf(b), day, now);
  expect(ra.attempts.length).toBe(rb.attempts.length);
});

test("an injected event is the first attempt", async () => {
  const deps = makeTestDeps({ core: { world: { event_probability: 0 } } });
  const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => ({
    content: "Spica got the telescope images.",
    valence: 0.8,
  }));
  expect(out.accepted[0]!.candidate.content).toBe("Spica got the telescope images.");
  expect(out.attempts[0]!.source).toBe("injected");
});

test("the generator sees only core context: her episodes, her people, her plan", async () => {
  const deps = makeTestDeps(always);
  await withEpisode(deps, "She rewatched Solaris.");
  await generateCoreEvents(coreDepsOf(deps), day, now);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!;
  expect(call.input).toContain("She rewatched Solaris.");
  expect(call.input).toContain("Alcor");
  expect(call.input).not.toContain("with this friend");
});
