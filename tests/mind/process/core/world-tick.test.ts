/**
 * `core_world_tick`: one generation per her local day for everyone, all-or-nothing, logged and
 * traced. A planned event is on her mind from the moment it's generated; a spontaneous one leaves
 * no trace until its time. Every hourly run lands the events whose time has come, once each.
 */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { count, eq } from "drizzle-orm";
import { core_loop_trace, core_memory, life_event_log, world_event } from "@/db/schema";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { retrieveCore } from "@/mind/memory/core/retrieve";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { loadCandidateInputs } from "@/mind/process/outreach/inputs";
import { closeTestDb, createTestUser, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { sequence } from "../../../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);
const cfg = { core: { world: { event_probability: 1, events_per_day_max: 1 } } };
const at = new Date("2026-01-05T09:00:00Z"); // 17:00 in Singapore
const H = 3_600_000;
type TestDeps = ReturnType<typeof makeTestDeps>;
const rows = async (deps: TestDeps, table: typeof world_event | typeof core_memory) =>
  (await deps.db.select({ n: count() }).from(table))[0]!.n;
const done = { generated: true, appraised: 0 };
const idle = { generated: false, appraised: 0 };

const spontaneous = {
  content: "She found an old film.",
  at: "15:00",
  valence: 0.3,
  stakes: "low",
  entity_names: [],
  kind: "spontaneous",
  thought: null,
};

// In UTC her day starts at midnight; generation at 01:00 leaves the 15:00 event in the future.
const utc = { ...cfg, life: { timezone: "UTC" } };
const morning = new Date("2026-01-05T01:00:00Z");
const eventTime = new Date("2026-01-05T15:00:00Z");
const planned = (valence: number) => ({
  content: "Spica rewatched Solaris with Alcor.",
  at: "15:00",
  valence,
  stakes: "low",
  entity_names: ["Alcor"],
  kind: "planned",
  thought: "Spica is thinking of rewatching Solaris with Alcor tonight.",
});

async function memories(deps: TestDeps) {
  return deps.db.select().from(core_memory);
}

async function herDay(deps: TestDeps, now: Date) {
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, now, deps.config.relationship);
  return (await loadCandidateInputs(deps, u, now)).herDay;
}

test("generates once per her day, however many users and however many runs", async () => {
  const deps = makeTestDeps(cfg);
  await createTestUser();
  await createTestUser();
  expect(await coreWorldTick(coreDepsOf(deps), at)).toEqual(done);
  // The 15:00 event was generated after its time; it lands on the next run, not this one.
  expect(await coreWorldTick(coreDepsOf(deps), new Date(at.getTime() + H))).toEqual({
    generated: false,
    appraised: 1,
  });
  expect(await coreWorldTick(coreDepsOf(deps), new Date(at.getTime() + 2 * H))).toEqual(idle);
  expect(await rows(deps, world_event)).toBe(1);
  expect(await rows(deps, core_memory)).toBe(1);
  expect((await deps.db.select({ n: count() }).from(life_event_log))[0]!.n).toBe(1);
  const traces = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "life_event"));
  expect(traces).toHaveLength(1);
  expect(traces[0]).toMatchObject({ status: "done", calls: 1 });
});

test("a generation failure writes nothing and the next run retries", async () => {
  const deps = makeTestDeps(cfg);
  deps.llm.handlers.life_event = sequence(new Error("model down"));
  await expect(coreWorldTick(coreDepsOf(deps), at)).rejects.toThrow("model down");
  expect(await rows(deps, world_event)).toBe(0);
  expect((await deps.core.state.get())?.last_event_day ?? null).toBeNull();

  deps.llm.handlers.life_event = sequence(spontaneous);
  expect(await coreWorldTick(coreDepsOf(deps), at)).toEqual(done);
  expect(await rows(deps, world_event)).toBe(1);
});

test("a generation failure doesn't hold back events already due", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence(spontaneous, new Error("model down"));
  await coreWorldTick(coreDepsOf(deps), morning);
  // The next day's generation fails, but yesterday's 15:00 event still lands.
  const next = new Date("2026-01-06T01:00:00Z");
  await expect(coreWorldTick(coreDepsOf(deps), next)).rejects.toThrow("model down");
  expect((await memories(deps)).map((m) => m.kind)).toEqual(["episode"]);
});

test("a failure inside the apply rolls back every write and leaves the day due", async () => {
  const deps = makeTestDeps(cfg);
  const begin = deps.core.transaction.bind(deps.core);
  vi.spyOn(deps.core, "transaction").mockImplementation((fn) =>
    begin(async (tx) => {
      vi.spyOn(tx.state, "update").mockRejectedValue(new Error("disk full"));
      return fn(tx);
    }),
  );
  await expect(coreWorldTick(coreDepsOf(deps), at)).rejects.toThrow("disk full");
  expect(await rows(deps, world_event)).toBe(0);
  expect(await rows(deps, core_memory)).toBe(0);
  expect((await deps.db.select({ n: count() }).from(life_event_log))[0]!.n).toBe(0);
  expect((await deps.core.state.get())?.last_event_day ?? null).toBeNull();

  vi.mocked(deps.core.transaction).mockRestore();
  expect(await coreWorldTick(coreDepsOf(deps), at)).toEqual(done);
  expect(await rows(deps, world_event)).toBe(1);
});

test("over budget the day is marked done with no event and no model call", async () => {
  const deps = makeTestDeps({
    ...cfg,
    core: { ...cfg.core, daily_call_budget: 0, budget_reserve: 0 },
  });
  expect(await coreWorldTick(coreDepsOf(deps), at)).toEqual(done);
  expect(await rows(deps, world_event)).toBe(0);
  expect((await deps.core.state.get())!.last_event_day).toBe("2026-01-05");
  expect(deps.llm.structuredCalls.filter((c) => c.purpose === "life_event")).toEqual([]);
  const [trace] = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "life_event"));
  expect(trace).toMatchObject({ status: "fallback", calls: 0 });
  // The next run doesn't try again.
  expect(await coreWorldTick(coreDepsOf(deps), new Date(at.getTime() + H))).toEqual({
    generated: false,
    appraised: 0,
  });
});

test("one remaining call cannot accept an event needing reconciliation", async () => {
  const deps = makeTestDeps({
    ...utc,
    core: { ...utc.core, daily_call_budget: 1, budget_reserve: 0 },
  });
  await deps.core.memory.insert({
    kind: "episode",
    content: "Spica found an old film.",
    embedding: Array(1024).fill(0.01),
    occurred_at: morning,
    created_at: morning,
    status: "resolved",
    salience: 0.4,
    valence: 0,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
  vi.spyOn(deps.embedder, "embed").mockImplementation(async (xs) =>
    xs.map(() => Array(1024).fill(0.01)),
  );
  deps.llm.handlers.life_event = sequence(spontaneous);
  expect(await coreWorldTick(coreDepsOf(deps), morning)).toEqual(done);
  expect(
    deps.llm.structuredCalls.filter((c) => c.purpose === "life_event" || c.purpose === "reconcile"),
  ).toHaveLength(1);
  expect(await rows(deps, world_event)).toBe(0);
  expect((await deps.core.state.get())!.last_event_day).toBe("2026-01-05");
  const [trace] = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "life_event"));
  expect(trace).toMatchObject({ status: "fallback", calls: 1 });
});

test("world events persist the code-selected goal and reconcile target without landing a surprise", async () => {
  const deps = makeTestDeps({
    core: { world: { event_probability: 1, goal_driven_share: 1 } },
    life: { timezone: "UTC" },
  });
  const goal = await deps.core.goals.insert({
    title: "Finish her film list",
    why: "Old films matter to her",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: null,
    started_at: morning,
    target_at: null,
    embedding: Array(1024).fill(0.01),
  });
  const target = await deps.core.memory.insert({
    kind: "episode",
    content: "Spica started a film list.",
    embedding: Array(1024).fill(0.01),
    occurred_at: morning,
    created_at: morning,
    status: "open",
    salience: 0.4,
    valence: 0,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
  vi.spyOn(deps.embedder, "embed").mockImplementation(async (xs) =>
    xs.map(() => Array(1024).fill(0.01)),
  );
  deps.llm.handlers.life_event = sequence({ ...spontaneous, goal_ref: "model-invented-id" });
  deps.llm.handlers.reconcile = sequence({ relation: "resolves", target_fact_id: target });
  await coreWorldTick(coreDepsOf(deps), morning);
  const [event] = await deps.db.select().from(world_event);
  expect(event).toMatchObject({ goal_ref: goal, resolves_memory_id: target, fallthrough: null });
  expect((await memories(deps)).map((memory) => memory.id)).toEqual([target]);
  expect((await deps.core.state.get())!.preoccupation).toBeNull();
});

test("a goal completed during generation leaves no stale event, intention or entity", async () => {
  const deps = makeTestDeps({
    core: { world: { event_probability: 1, goal_driven_share: 1 } },
    life: { timezone: "UTC" },
  });
  const goal = await deps.core.goals.insert({
    title: "Finish her film list",
    why: "Old films matter to her",
    status: "active",
    progress: 0.8,
    source: "seed",
    source_ref: null,
    started_at: morning,
    target_at: null,
    embedding: Array(1024).fill(0.01),
  });
  let generationStarted!: () => void;
  const started = new Promise<void>((resolve) => (generationStarted = resolve));
  let finishGeneration!: () => void;
  const pendingGeneration = new Promise<void>((resolve) => (finishGeneration = resolve));
  deps.llm.handlers.life_event = async () => {
    generationStarted();
    await pendingGeneration;
    return { ...planned(0.7), entity_names: ["Mira"] };
  };

  const tick = coreWorldTick(coreDepsOf(deps), morning);
  await started;
  try {
    await deps.core.goals.setProgress(goal, 1, morning);
    await deps.core.goals.setStatus(goal, "done", morning);
  } finally {
    finishGeneration();
  }
  expect(await tick).toEqual(done);
  expect(await deps.db.select().from(world_event)).toEqual([]);
  expect(await memories(deps)).toEqual([]);
  expect((await deps.core.memory.entities()).map((entity) => entity.name)).not.toContain("Mira");
  expect((await deps.core.state.get())!.preoccupation).toBeNull();
  expect((await deps.core.state.get())!.last_event_day).toBe("2026-01-05");
  const [attempt] = await deps.db.select().from(life_event_log);
  expect(attempt).toMatchObject({ decision: "stale_goal", world_event_id: null });
  const [trace] = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "life_event"));
  expect(trace).toMatchObject({ status: "done", calls: 1 });
  expect(trace!.outputs).toMatchObject({ applied: true, world_events: [], intentions: [] });
  expect(await coreWorldTick(coreDepsOf(deps), new Date(morning.getTime() + H))).toEqual(idle);
});

test.each([true, false])("injected fallthrough %s is stored explicitly", async (fallthrough) => {
  const deps = makeTestDeps(utc);
  await coreWorldTick(coreDepsOf(deps), morning, {
    inject: () => ({
      content: "Spica planned to read.",
      valence: 0.2,
      kind: "planned",
      thought: "Spica is looking forward to reading.",
      fallthrough,
    }),
  });
  const [event] = await deps.db.select().from(world_event);
  expect(event).toMatchObject({ fallthrough, goal_ref: null });
});

test("a generation failure is traced as failed", async () => {
  const deps = makeTestDeps(cfg);
  deps.llm.handlers.life_event = sequence(new Error("model down"));
  await expect(coreWorldTick(coreDepsOf(deps), at)).rejects.toThrow("model down");
  const [trace] = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "life_event"));
  expect(trace).toMatchObject({ status: "failed", error: "Error" });
});

test("a run that finds the day already applied under the lock writes nothing", async () => {
  const deps = makeTestDeps(cfg);
  // Another run applies today while this one is still generating.
  deps.llm.handlers.life_event = async () => {
    await deps.core.state.update({ last_event_day: "2026-01-05" });
    return spontaneous;
  };
  expect(await coreWorldTick(coreDepsOf(deps), at)).toEqual(idle);
  expect(await rows(deps, world_event)).toBe(0);
  expect((await deps.db.select({ n: count() }).from(life_event_log))[0]!.n).toBe(0);
});

test("no plan for today still makes a generic event", async () => {
  const deps = makeTestDeps(cfg);
  await coreWorldTick(coreDepsOf(deps), at);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!;
  expect(call.input).toContain("unknown, keep the event generic");
  expect(await rows(deps, world_event)).toBe(1);
});

test("waits for her events hour", async () => {
  const deps = makeTestDeps({ core: { world: { events_local_hour: 20 } } });
  expect(await coreWorldTick(coreDepsOf(deps), at)).toEqual(idle);
});

test("a surprise's new person only joins her entities when it happens", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence({
    ...spontaneous,
    content: "She met Mira at the observatory.",
    entity_names: ["Mira"],
  });
  await coreWorldTick(coreDepsOf(deps), morning);
  expect((await deps.core.memory.entities()).map((e) => e.name)).not.toContain("Mira");
  const [pending] = await deps.db.select().from(world_event);
  expect(pending!.agents).toEqual([]);

  await coreWorldTick(coreDepsOf(deps), new Date(eventTime.getTime() + H));
  const mira = (await deps.core.memory.entities()).find((e) => e.name === "Mira");
  expect(mira).toBeDefined();
  const [episode] = await memories(deps);
  expect(episode!.entity_refs).toEqual([mira!.id]);
  const [landed] = await deps.db.select().from(world_event);
  expect(landed!.agents).toEqual([mira!.id]);
});

test("a planned event's people join her entities at once: the plan is known", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence({ ...planned(0.3), entity_names: ["Mira"] });
  await coreWorldTick(coreDepsOf(deps), morning);
  const mira = (await deps.core.memory.entities()).find((e) => e.name === "Mira");
  expect(mira).toBeDefined();
  await coreWorldTick(coreDepsOf(deps), new Date(eventTime.getTime() + H));
  const episode = (await memories(deps)).find((m) => m.kind === "episode")!;
  expect(episode.entity_refs).toEqual([mira!.id]);
  expect((await deps.core.memory.entities()).filter((e) => e.name === "Mira")).toHaveLength(1);
});

test("events that landed overnight are episodes before today's generation reads her life", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence(
    { ...spontaneous, content: "Spica found a comet in an old photo.", at: "23:30" },
    spontaneous,
  );
  await coreWorldTick(coreDepsOf(deps), morning);
  // The first run of the next day lands last night's event, then generates.
  expect(await coreWorldTick(coreDepsOf(deps), new Date("2026-01-06T00:10:00Z"))).toEqual({
    generated: true,
    appraised: 1,
  });
  const calls = deps.llm.structuredCalls.filter((c) => c.purpose === "life_event");
  expect(calls[1]!.input).toContain("Spica found a comet in an old photo.");
});

test("when appraisal and generation both fail, the appraisal error is thrown and the generation error logged", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence(new Error("model down"));
  vi.spyOn(deps.core.world, "dueUnappraised").mockRejectedValue(new TypeError("db gone"));
  const logged = vi.spyOn(deps.log, "error");
  try {
    await expect(coreWorldTick(coreDepsOf(deps), morning)).rejects.toThrow("db gone");
    expect(logged).toHaveBeenCalledWith(expect.any(String), { error: "Error" });
  } finally {
    logged.mockRestore();
  }
});

test("an appraisal failure doesn't stop today's generation", async () => {
  const deps = makeTestDeps(utc);
  vi.spyOn(deps.core.world, "dueUnappraised").mockRejectedValue(new TypeError("db gone"));
  await expect(coreWorldTick(coreDepsOf(deps), morning)).rejects.toThrow("db gone");
  expect(await rows(deps, world_event)).toBe(1);
});

test("the kind is stored: planned stays planned, spontaneous is a surprise", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence(planned(0.3), spontaneous);
  await coreWorldTick(coreDepsOf(deps), morning);
  await coreWorldTick(coreDepsOf(deps), new Date("2026-01-06T01:00:00Z"));
  const kinds = await deps.db
    .select({ kind: world_event.kind })
    .from(world_event)
    .orderBy(world_event.at);
  expect(kinds.map((k) => k.kind)).toEqual(["planned", "surprise"]);
});

test("a planned event's thought is on her mind at once: retrievable and outreach-eligible", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence(planned(0.3));
  const before = (await deps.core.state.get()) ?? null;
  expect(await coreWorldTick(coreDepsOf(deps), morning)).toEqual({
    generated: true,
    appraised: 0,
  });
  const [event] = await deps.db.select().from(world_event);
  expect(event!.appraised_at).toBeNull();
  const [intention] = await memories(deps);
  expect(intention).toMatchObject({
    kind: "intention",
    content: "Spica is thinking of rewatching Solaris with Alcor tonight.",
    status: "open",
    valence: 0.3,
    salience: deps.config.core.world.event_salience,
    source: "world",
    source_ref: `world_event:${event!.id}`,
    payload: { event_at: eventTime.toISOString() },
  });
  expect(intention!.occurred_at?.getTime()).toBe(morning.getTime());
  expect(intention!.created_at.getTime()).toBe(morning.getTime());
  expect(intention!.entity_refs).toHaveLength(1);
  // No mood nudge before it happens; a mild plan doesn't take over her mind.
  const state = (await deps.core.state.get())!;
  expect(before).toBeNull();
  expect(state.mood_valence).toBe(deps.config.core.state.baseline.mood_valence);
  expect(state.preoccupation).toBeNull();

  const recalled = await retrieveCore(deps, { queryText: "what's up tonight?", now: morning });
  expect(recalled.memories.map((m) => m.id)).toEqual([intention!.id]);
  expect((await herDay(deps, morning)).map((m) => m.id)).toEqual([intention!.id]);
});

test("a strong planned event's thought takes over her mind before it happens", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence(planned(-0.7));
  await coreWorldTick(coreDepsOf(deps), morning);
  const [intention] = await memories(deps);
  const state = (await deps.core.state.get())!;
  expect(state.preoccupation).toBe(intention!.id);
  expect(state.preoccupation_since?.getTime()).toBe(morning.getTime());
  expect(state.mood_valence).toBe(deps.config.core.state.baseline.mood_valence);
});

test("a spontaneous event leaves no memory, no state change and nothing to recall before its time", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence({ ...spontaneous, valence: 0.9 });
  await coreWorldTick(coreDepsOf(deps), morning);
  expect(await rows(deps, world_event)).toBe(1);
  expect(await memories(deps)).toEqual([]);
  const state = (await deps.core.state.get())!;
  expect(state).toMatchObject({ ...deps.config.core.state.baseline, preoccupation: null });
  expect((await retrieveCore(deps, { queryText: "film", now: morning })).memories).toEqual([]);
  expect(await herDay(deps, morning)).toEqual([]);
});

test("at its time a later hourly run writes the episode and the mood nudge, and resolves the plan", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence(planned(0.3));
  await coreWorldTick(coreDepsOf(deps), morning);
  // Still in the future: nothing lands.
  expect(await coreWorldTick(coreDepsOf(deps), new Date(eventTime.getTime() - H))).toEqual(idle);

  const landed = new Date(eventTime.getTime() + 10 * 60_000);
  expect(await coreWorldTick(coreDepsOf(deps), landed)).toEqual({
    generated: false,
    appraised: 1,
  });
  const all = await memories(deps);
  const episode = all.find((m) => m.kind === "episode")!;
  const intention = all.find((m) => m.kind === "intention")!;
  expect(episode.content).toBe("Spica rewatched Solaris with Alcor.");
  expect(episode.occurred_at?.getTime()).toBe(eventTime.getTime());
  expect(episode.created_at.getTime()).toBe(landed.getTime());
  expect(intention.status).toBe("resolved");
  const state = (await deps.core.state.get())!;
  expect(state.mood_valence).toBeGreaterThan(deps.config.core.state.baseline.mood_valence);
  const [event] = await deps.db.select().from(world_event);
  expect(event!.appraised_at?.getTime()).toBe(landed.getTime());
  const traces = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "core_appraise"));
  expect(traces).toHaveLength(1);
  expect(traces[0]!.outputs).toMatchObject({
    episodes: [episode.id],
    resolved_intentions: [intention.id],
  });

  // A resolved plan is history: neither recall nor her day offers it again.
  const recalled = await retrieveCore(deps, { queryText: "Solaris", now: landed });
  expect(recalled.memories.map((m) => m.id)).toEqual([episode.id]);
  expect((await herDay(deps, landed)).map((m) => m.id)).toEqual([episode.id]);
});

test("each event is appraised once, however many runs follow", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence(spontaneous);
  await coreWorldTick(coreDepsOf(deps), morning);
  const landed = new Date(eventTime.getTime() + H);
  expect(await coreWorldTick(coreDepsOf(deps), landed)).toEqual({
    generated: false,
    appraised: 1,
  });
  expect(await coreWorldTick(coreDepsOf(deps), new Date(landed.getTime() + H))).toEqual(idle);
  expect((await memories(deps)).filter((m) => m.kind === "episode")).toHaveLength(1);
});

test("an appraisal failure writes nothing and the next run lands the event", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence(planned(0.3));
  await coreWorldTick(coreDepsOf(deps), morning);
  const landed = new Date(eventTime.getTime() + H);

  const begin = deps.core.transaction.bind(deps.core);
  vi.spyOn(deps.core, "transaction").mockImplementation((fn) =>
    begin(async (tx) => {
      // Landing the event is the transaction's last write, so everything before it must roll back.
      vi.spyOn(tx.world, "markAppraised").mockRejectedValue(new Error("disk full"));
      return fn(tx);
    }),
  );
  await expect(coreWorldTick(coreDepsOf(deps), landed)).rejects.toThrow("disk full");
  expect((await memories(deps)).map((m) => [m.kind, m.status])).toEqual([["intention", "open"]]);
  expect((await deps.db.select().from(world_event))[0]!.appraised_at).toBeNull();
  expect((await deps.core.state.get())!.mood_valence).toBe(
    deps.config.core.state.baseline.mood_valence,
  );

  vi.mocked(deps.core.transaction).mockRestore();
  expect(await coreWorldTick(coreDepsOf(deps), landed)).toEqual({
    generated: false,
    appraised: 1,
  });
});

test("appraisal runs every hour, whether or not today's generation is due", async () => {
  const deps = makeTestDeps({ ...utc, core: { world: { events_local_hour: 20 } } });
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  await deps.core.world.recordEvent({
    at: new Date(at.getTime() - H),
    kind: "surprise",
    content: "A comet showed up in her feed.",
    valence: 0.2,
    stakes: "low",
    agents: [],
    life_day: "2026-01-05",
    created_at: morning,
  });
  expect(await coreWorldTick(coreDepsOf(deps), at)).toEqual({ generated: false, appraised: 1 });
});

test("a failed appraisal call still lands the event and traces fallback", async () => {
  const deps = makeTestDeps(utc);
  deps.llm.handlers.life_event = sequence(planned(0.3));
  deps.llm.handlers.core_appraise = sequence(new Error("model down"));
  await coreWorldTick(coreDepsOf(deps), morning);
  const landed = new Date(eventTime.getTime() + 10 * 60_000);
  expect((await coreWorldTick(coreDepsOf(deps), landed)).appraised).toBe(1);
  expect((await memories(deps)).find((m) => m.kind === "episode")!.content).toBe(
    "Spica rewatched Solaris with Alcor.",
  );
  const [trace] = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "core_appraise"));
  expect(trace).toMatchObject({ status: "fallback", calls: 1 });
});
