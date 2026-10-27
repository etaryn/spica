/**
 * Her core events: the pure checks (shape, rules, the generator's input) and every branch of the
 * generator against her core memory.
 */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { coreDepsOf } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";
import { seedCore } from "@/mind/memory/core/seed";
import {
  buildEventInput,
  checkEvent,
  checkRules,
  generateCoreEvents,
  selectEventSubject,
  subjectKey,
} from "@/mind/world/events";
import type { CoreGoal } from "@/mind/state/core/types";
import { closeTestDb, resetDb, vec } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";
import { sequence } from "../../helpers/llm";
import { coreCitables } from "@/mind/memory/core/citables";
import type { CoreMemoryItem } from "@/mind/memory/core/types";

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
  kind: "spontaneous",
  thought: null,
  ...extra,
});
const raw = (extra: object = {}) => ({
  content: "Spica read.",
  at: "10:00",
  valence: 0,
  stakes: "low" as const,
  entity_names: [],
  kind: "spontaneous" as const,
  thought: null,
  ...extra,
});
const always = { core: { world: { event_probability: 1, events_per_day_max: 1 } } };
const episodeItem = (content: string, ms: number): CoreMemoryItem => ({
  id: "ep-1",
  kind: "episode",
  content,
  payload: null,
  entity_refs: [],
  occurred_at: new Date(ms),
  created_at: new Date(ms),
  last_recalled_at: null,
  status: "resolved",
  salience: 0.5,
  valence: 0,
  depth: 2,
  source: "world",
  source_ref: null,
});

test("checkEvent rejects bad times and empty content, clamps valence", () => {
  expect(checkEvent(raw({ content: " " }), 300)).toBeNull();
  expect(checkEvent(raw({ at: "24:00" }), 300)).toBeNull();
  expect(checkEvent(raw({ valence: 3, entity_names: [" Alcor "] }), 300)).toEqual({
    content: "Spica read.",
    at: "10:00",
    valence: 1,
    stakes: "low",
    entity_names: ["Alcor"],
    kind: "spontaneous",
    thought: null,
  });
});

test("checkEvent: a planned event needs a thought; a spontaneous one drops any thought", () => {
  expect(checkEvent(raw({ kind: "planned", thought: null }), 300)).toBeNull();
  expect(checkEvent(raw({ kind: "planned", thought: "  " }), 300)).toBeNull();
  expect(checkEvent(raw({ kind: "planned", thought: "x".repeat(301) }), 300)).toBeNull();
  expect(
    checkEvent(raw({ kind: "planned", thought: " Spica is  thinking of Solaris. " }), 300),
  ).toMatchObject({ kind: "planned", thought: "Spica is thinking of Solaris." });
  expect(checkEvent(raw({ thought: "Spica saw it coming." }), 300)).toMatchObject({
    kind: "spontaneous",
    thought: null,
  });
});

test("checkEvent enforces the configured content cap; config defaults", () => {
  expect(cfg.event_max_chars).toBe(300);
  expect(cfg.injected_event_at).toBe("12:00");
  const c = raw({ content: "Spica read a long book." });
  expect(checkEvent(c, 10)).toBeNull();
  expect(checkEvent(c, cfg.event_max_chars)).not.toBeNull();
});

test("checkRules: one new entity a week, one high-stakes event per window, canon is known", () => {
  const known = new Set(["alcor"]);
  const c = (names: string[], stakes: "low" | "high" = "low") =>
    raw({ content: "x", stakes, entity_names: names });
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

test("buildEventInput shows her plan, her recent life and her people", () => {
  const input = buildEventInput(
    {
      plan: {
        blocks: [{ start: "09:00", end: "12:00", kind: "busy", label: "reading", busy: 0.6 }],
      },
      recent: coreCitables([episodeItem("She rewatched Solaris.", now.getTime() - DAY)], "UTC"),
      people: ["Alcor"],
      subject: { kind: "everyday" },
      needs: { autonomy: 0.3, competence: 0.7 },
    },
    day,
    now,
    "UTC",
    140,
  );
  expect(input).toContain("09:00-12:00 busy: reading");
  expect(input).toContain("What has happened in her life lately (never contradict):");
  expect(input).toContain("- [m1] She rewatched Solaris. (⟦2026-01-04|day|UTC⟧)");
  expect(input.startsWith("It's Monday 5 January, 09:00. Today is 2026-01-05")).toBe(true);
  expect(input).toContain("People she knows: Alcor.");

  const empty = buildEventInput(
    {
      plan: null,
      recent: { lines: [], items: [] },
      people: [],
      subject: { kind: "everyday" },
      needs: { autonomy: 0.6, competence: 0.6 },
    },
    day,
    now,
    "UTC",
    140,
  );
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
  const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  expect(out.accepted).toHaveLength(1);
  expect(out.attempts.map((a) => a.decision)).toEqual(["accepted"]);
  expect(deps.llm.structuredCalls.filter((c) => c.purpose === "reconcile")).toHaveLength(0);
});

test.each(["duplicate", "contradicts"] as const)(
  "a %s is logged and never regenerated",
  async (relation) => {
    const deps = makeTestDeps(always);
    // Every text embeds to the stored episode's vector, so it is always a near neighbour.
    vi.spyOn(deps.embedder, "embed").mockImplementation(async (xs) => xs.map(() => vec(0.01)));
    await withEpisode(deps, "She rewatched Solaris.");
    const near = await deps.core.memory.near(vec(0.01), 1, 0);
    deps.llm.handlers.life_event = sequence(ev("She rewatched Solaris."), ev("She baked bread."));
    deps.llm.handlers.reconcile = sequence({ relation, target_fact_id: near[0]!.id });
    const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
    expect(out.accepted).toHaveLength(0);
    expect(out.attempts.map((a) => a.decision)).toEqual([relation]);
    expect(out.attempts[0]!.targetMemoryId).toBe(near[0]!.id);
    expect(deps.llm.structuredCalls.filter((c) => c.purpose === "life_event")).toHaveLength(1);
  },
);

test("two new people at once breaks the new-entity rule", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(
    ev("She met Ana and Bo.", { entity_names: ["Ana", "Bo"] }),
    ev("She read alone."),
  );
  const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  expect(out.accepted).toHaveLength(0);
  expect(out.attempts.map((a) => a.decision)).toEqual(["rule:new_entity"]);
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
  const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  expect(out.attempts[0]!.decision).toBe("rule:high_stakes");
});

test("an invalid event (bad time) is logged once and never retried", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(ev("x", { at: "25:99" }));
  const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  expect(out.accepted).toHaveLength(0);
  expect(out.attempts.map((a) => a.decision)).toEqual(["invalid"]);
});

test("a model error or timeout propagates (the tick retries next hour)", async () => {
  const deps = makeTestDeps(always);
  deps.llm.handlers.life_event = sequence(new Error("timeout"));
  await expect(generateCoreEvents(coreDepsOf(deps), day, now, () => true)).rejects.toThrow(
    "timeout",
  );
});

test("draws are seeded by day only: the same day gives the same draws", async () => {
  const cfg = { core: { world: { event_probability: 0.5, events_per_day_max: 3 } } };
  const a = makeTestDeps(cfg);
  const b = makeTestDeps(cfg);
  const ra = await generateCoreEvents(coreDepsOf(a), day, now, () => true);
  const rb = await generateCoreEvents(coreDepsOf(b), day, now, () => true);
  expect(ra.attempts.length).toBe(rb.attempts.length);
});

test("an injected event is the first attempt, spontaneous unless it says otherwise", async () => {
  const deps = makeTestDeps({ core: { world: { event_probability: 0 } } });
  const out = await generateCoreEvents(
    coreDepsOf(deps),
    day,
    now,
    () => true,
    () => ({
      content: "Spica got the telescope images.",
      valence: 0.8,
    }),
  );
  expect(out.accepted[0]!.candidate).toMatchObject({
    content: "Spica got the telescope images.",
    kind: "spontaneous",
    thought: null,
  });
  expect(out.accepted[0]!.thoughtEmbedding).toBeNull();
  expect(out.attempts[0]!.source).toBe("injected");

  const planned = await generateCoreEvents(
    coreDepsOf(deps),
    day,
    now,
    () => true,
    () => ({
      content: "Spica got the telescope images.",
      valence: 0.8,
      kind: "planned",
      thought: "Spica is counting the hours until the telescope images arrive.",
    }),
  );
  expect(planned.accepted[0]!.candidate).toMatchObject({
    kind: "planned",
    thought: "Spica is counting the hours until the telescope images arrive.",
  });
});

test("an injected first event does not suppress the selected goal for a later model event", async () => {
  const deps = makeTestDeps({
    core: {
      world: {
        event_probability: 1,
        events_per_day_max: 2,
        subject_weights: { goal: 1, interest: 0, person: 0, everyday: 0 },
      },
    },
  });
  const goal = await deps.core.goals.insert({
    title: "Finish her film list",
    why: "She cares about old films",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    embedding: vec(),
  });
  deps.llm.handlers.life_event = sequence(ev("Spica found a forgotten film."));
  const out = await generateCoreEvents(
    coreDepsOf(deps),
    day,
    now,
    () => true,
    () => ({
      content: "Spica received the telescope images.",
      valence: 0.4,
    }),
  );
  expect(out.accepted).toHaveLength(2);
  expect(out.accepted.map((event) => event.goalRef)).toEqual([null, goal]);
  expect(deps.llm.structuredCalls.find((call) => call.purpose === "life_event")!.input).toContain(
    "Finish her film list",
  );
});

test("a planned event carries its thought's embedding; a planned one without a thought is invalid", async () => {
  const bare = makeTestDeps(always);
  bare.llm.handlers.life_event = sequence(
    ev("Spica rewatched Solaris.", { kind: "planned", thought: null }),
  );
  const invalid = await generateCoreEvents(coreDepsOf(bare), day, now, () => true);
  expect(invalid.attempts.map((a) => a.decision)).toEqual(["invalid"]);

  const deps = makeTestDeps(always);
  const embed = vi.spyOn(deps.embedder, "embed");
  deps.llm.handlers.life_event = sequence(
    ev("Spica rewatched Solaris.", {
      kind: "planned",
      thought: "Spica is thinking of rewatching Solaris tonight.",
    }),
  );
  const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  expect(out.attempts.map((a) => a.decision)).toEqual(["accepted"]);
  const [accepted] = out.accepted;
  expect(accepted!.thoughtEmbedding).toHaveLength(accepted!.embedding.length);
  expect(embed.mock.calls.flatMap((c) => c[0])).toContain(
    "Spica is thinking of rewatching Solaris tonight.",
  );
});

test("the generator's prompt is life/event v7: both kinds, the subject, and she lives online", async () => {
  const deps = makeTestDeps(always);
  expect(deps.config.prompts.life_event).toBe("v8");
  await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!;
  expect(call.system).toContain("planned");
  expect(call.system).toContain("spontaneous");
  expect(call.system).toContain("one plain sentence");
  expect(call.system).toContain("She lives online");
});

test("the generator sees only core context: her episodes, her people, her plan", async () => {
  const deps = makeTestDeps(always);
  await withEpisode(deps, "She rewatched Solaris.");
  await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!;
  expect(call.input).toContain("She rewatched Solaris.");
  expect(call.input).toContain("Alcor");
  expect(call.input).not.toContain("with this friend");
});

test("seeding her canon people doesn't hold back the first new person", async () => {
  const deps = makeTestDeps(always);
  await seedCore(coreDepsOf(deps));
  deps.llm.handlers.life_event = sequence(
    ev("She met Mira at the planetarium.", { entity_names: ["Mira"] }),
  );
  const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  expect(out.attempts.map((a) => a.decision)).toEqual(["accepted"]);
});

test("the generator writes as who she is lately: core values plus her latest snapshot", async () => {
  const deps = makeTestDeps(always);
  await deps.core.memory.insertSnapshot({
    version: 3,
    embedding: vec(),
    content: "Lately she can't stop thinking about comets.",
    sections: {},
    source_ids: [],
    rendered_at: now,
    model: "m",
    prompt_version: "v1",
  });
  await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!;
  expect(call.system).toContain(loadPersona(deps.config).coreValues);
  expect(call.system).toContain("Lately she can't stop thinking about comets.");
});

test("with no snapshot yet the generator falls back to the seed self", async () => {
  const deps = makeTestDeps(always);
  await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!;
  expect(call.system).toContain(loadPersona(deps.config).seedSelf);
});

test("a selected active goal is assigned by code and shown with current needs", async () => {
  const deps = makeTestDeps({
    core: {
      world: {
        event_probability: 1,
        subject_weights: { goal: 1, interest: 0, person: 0, everyday: 0 },
      },
    },
  });
  const id = await deps.core.goals.insert({
    title: "Finish her film list",
    why: "She cares about old films",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    embedding: vec(),
  });
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.3, competence: 0.7 });
  deps.llm.handlers.life_event = sequence({
    ...ev("Spica found a forgotten film."),
    goal_ref: "model-id",
  });
  const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  expect(out.accepted[0]).toMatchObject({ goalRef: id });
  const input = deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!.input;
  expect(input).toContain("Finish her film list");
  expect(input).toContain("autonomy: 0.3");
  expect(input).toContain("competence: 0.7");
});

test("the deterministic fake keeps event content stable across selected goals", async () => {
  const deps = makeTestDeps({
    core: {
      world: {
        event_probability: 1,
        subject_weights: { goal: 1, interest: 0, person: 0, everyday: 0 },
      },
    },
  });
  const firstGoal = await deps.core.goals.insert({
    title: "Learn the winter constellations",
    why: "She loves stars",
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    embedding: vec(),
  });
  const first = await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  await deps.core.goals.setStatus(firstGoal, "done", now);
  const secondGoal = await deps.core.goals.insert({
    title: "Finish her film list",
    why: "She loves old films",
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    embedding: vec(),
  });
  const second = await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  expect(first.accepted[0]!.goalRef).toBe(firstGoal);
  expect(second.accepted[0]!.goalRef).toBe(secondGoal);
  expect(first.accepted[0]!.candidate.content).toBe(
    "Spica found an old film she'd forgotten she loved.",
  );
  expect(second.accepted[0]!.candidate.content).toBe(
    "Spica found an old film she'd forgotten she loved.",
  );
});

test("a reconcile resolution target stays on the accepted event", async () => {
  const deps = makeTestDeps(always);
  vi.spyOn(deps.embedder, "embed").mockImplementation(async (xs) => xs.map(() => vec(0.01)));
  await withEpisode(deps, "Spica began reading Solaris.");
  const [near] = await deps.core.memory.near(vec(0.01), 1, 0);
  deps.llm.handlers.life_event = sequence(ev("Spica finished Solaris."));
  deps.llm.handlers.reconcile = sequence({ relation: "resolves", target_fact_id: near!.id });
  const out = await generateCoreEvents(coreDepsOf(deps), day, now, () => true);
  expect(out.accepted[0]).toMatchObject({ resolvesMemoryId: near!.id });
});

test("goal subjects are seeded, weighted and independent of repository order", () => {
  const goal = (id: string, progress: number): CoreGoal => ({
    id,
    title: id,
    why: id,
    status: "active",
    progress,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    updated_at: now,
  });
  const a = goal("a", 0.99);
  const b = goal("b", 0);
  const force = { ...cfg, subject_weights: { goal: 1, interest: 0, person: 0, everyday: 0 } };
  const pick = (goals: CoreGoal[], d = day) =>
    selectEventSubject({ goals, interests: [], people: [] }, [], d, force);
  const days = Array.from({ length: 200 }, (_, i) => `${day}#${i}`);
  const bs = days.filter((d) => subjectKey(pick([a, b], d)) === "goal:b").length;
  expect(bs).toBeGreaterThan(150); // 1.1 vs 0.11 of the weight
  expect(days.every((d) => subjectKey(pick([a, b], d)) === subjectKey(pick([b, a], d)))).toBe(true);
  expect(pick([])).toEqual({ kind: "everyday" });
  expect(pick([{ ...a, status: "done" }])).toEqual({ kind: "everyday" });
});

test("a subject used recently is drawn less", () => {
  const options = { goals: [], interests: [{ id: "i1", content: "old films" }], people: ["Alcor"] };
  const days = Array.from({ length: 400 }, (_, d) => `2026-01-05#${d}`);
  const count = (recent: string[]) =>
    days.filter(
      (key) => subjectKey(selectEventSubject(options, recent, key, cfg)) === "person:Alcor",
    ).length;
  expect(count(["person:Alcor"])).toBeLessThan(count([]));
});

test("no goals, interests or people still yields an everyday subject", () => {
  expect(
    selectEventSubject({ goals: [], interests: [], people: [] }, [], "2026-01-05", cfg),
  ).toEqual({ kind: "everyday" });
});

test("the input names the subject and the target length", () => {
  const input = buildEventInput(
    {
      plan: null,
      recent: { lines: [], items: [] },
      people: ["Alcor"],
      subject: { kind: "person", name: "Alcor" },
      needs: { autonomy: 0.6, competence: 0.6 },
    },
    day,
    now,
    "UTC",
    140,
  );
  expect(input).toContain("Today's event is about: Alcor");
  expect(input).toContain("one plain sentence, under 140 characters");
});

test("injected events have no implicit goal and retain explicit fallthrough overrides", async () => {
  const deps = makeTestDeps({
    core: {
      world: {
        subject_weights: { goal: 1, interest: 0, person: 0, everyday: 0 },
        event_probability: 0,
      },
    },
  });
  await deps.core.goals.insert({
    title: "Read more",
    why: "She loves books",
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    embedding: vec(),
  });
  for (const fallthrough of [true, false] as const) {
    const out = await generateCoreEvents(
      coreDepsOf(deps),
      day,
      now,
      () => false,
      () => ({
        content: "Spica read a book.",
        valence: 0.2,
        fallthrough,
      }),
    );
    expect(out.accepted[0]).toMatchObject({ goalRef: null, fallthrough });
    expect(out.budgetExhausted).toBe(false);
  }
});

test("budget exhaustion before a later event retains the earlier accepted ones", async () => {
  const deps = makeTestDeps({ core: { world: { event_probability: 1, events_per_day_max: 2 } } });
  deps.llm.handlers.life_event = sequence(ev("Spica found a film."), ev("Spica read."));
  const out = await generateCoreEvents(
    coreDepsOf(deps),
    day,
    now,
    () => deps.llm.structuredCalls.filter((call) => call.purpose === "life_event").length < 1,
  );
  expect(out.accepted.map((event) => event.candidate.content)).toEqual(["Spica found a film."]);
  expect(out.attempts.map((attempt) => attempt.decision)).toEqual(["accepted"]);
  expect(out.budgetExhausted).toBe(true);
});

test("a planned event's thought labels its own time words; its content keeps its words", async () => {
  const all = makeTestDeps({ ...always, life: { timezone: "UTC" } });
  all.llm.handlers.life_event = () =>
    ev("Spica rewatched Solaris.", {
      kind: "planned",
      at: "20:00",
      thought: "Spica is thinking of rewatching Solaris tonight.",
      times: [
        {
          field: "thought",
          words: "tonight",
          from: "",
          unit: "day",
          shift: 0,
          weekday: null,
          month: null,
          day_of_month: null,
          part: "night",
          clock: "",
          span: "at",
          rough: false,
        },
      ],
    });
  const out = await generateCoreEvents(coreDepsOf(all), day, now, () => true);
  expect(out.accepted).toHaveLength(1);
  expect(out.accepted[0]!.candidate.thought).toBe(
    "Spica is thinking of rewatching Solaris ⟦2026-01-05|night|UTC|tonight⟧.",
  );
  expect(out.accepted[0]!.candidate.content).toBe("Spica rewatched Solaris.");
  expect(out.dropped).toEqual([]);
});
