/** Rumination selects landed episodes and commits one thought with its source effects. */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { core_loop_trace, core_memory } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreRuminate } from "@/mind/process/core/ruminate";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T09:00:00Z");
const hour = 3_600_000;
const ago = (hours: number) => new Date(now.getTime() - hours * hour);
const thought = "She keeps thinking about how the film ended.";

function setup(overrides: unknown = {}) {
  const all = makeTestDeps(overrides);
  const deps = coreDepsOf(all);
  all.llm.handlers.core_ruminate = () => ({
    thought: { kind: "thought", content: thought, salience: "low" },
  });
  return { all, deps };
}

type TestDeps = ReturnType<typeof setup>["deps"];

async function ruminate(deps: TestDeps, at = now) {
  return coreRuminate(deps, at);
}

async function seed(
  deps: TestDeps,
  age: number,
  options: {
    valence?: number;
    status?: "open" | "resolved" | "stale" | "superseded";
    payload?: unknown;
    entityRefs?: string[];
    sourceRef?: string | null;
    salience?: number;
  } = {},
) {
  return deps.core.memory.insert({
    kind: "episode",
    content: `The film stayed with her at age ${age}.`,
    payload: options.payload ?? {
      appraisal_emotion: { label: "sad", valence: -0.6, arousal: 0.7, phrase: null },
    },
    embedding: vec(0.02),
    entity_refs: options.entityRefs ?? [],
    occurred_at: ago(age + 48),
    created_at: ago(age),
    status: options.status ?? "resolved",
    salience: options.salience ?? 0.94,
    valence: options.valence ?? -0.6,
    confidence: 0.8,
    source: "world",
    source_ref: options.sourceRef ?? null,
  });
}

async function rows(all: ReturnType<typeof setup>["all"]) {
  return {
    thoughts: (await all.db.select().from(core_memory)).filter((m) => m.kind === "thought"),
    traces: await all.db.select().from(core_loop_trace),
  };
}

test("the inclusive two and twenty-four hour boundaries use landing time and accept resolved history", async () => {
  const { all, deps } = setup();
  await seed(deps, 24.001);
  const oldest = await seed(deps, 24, { valence: 0.5 });
  await seed(deps, 2, { valence: -0.5 });
  await seed(deps, 1.999);
  const result = await ruminate(deps);
  expect(result).toMatchObject({ status: "done", applied: true });
  expect((await rows(all)).thoughts[0]?.payload).toEqual({ ruminates: oldest });
  expect((await deps.core.memory.get(oldest))?.payload).toMatchObject({ ruminated: 1 });
  expect((await deps.core.state.get())?.mood_valence).toBeCloseTo(0.3);
});

test("the youngest inclusive boundary and negative valence threshold are eligible", async () => {
  const { all, deps } = setup();
  const id = await seed(deps, 2, { valence: -0.5 });
  expect(await ruminate(deps)).toMatchObject({ applied: true });
  expect((await rows(all)).thoughts[0]?.payload).toEqual({ ruminates: id });
  expect((await deps.core.state.get())?.mood_valence).toBeCloseTo(0.1);
});

test("no eligible episode returns not_due without a model call or trace", async () => {
  const { all, deps } = setup();
  await seed(deps, 1);
  expect(await ruminate(deps)).toEqual({ status: "not_due", applied: false, ids: [] });
  expect(all.llm.structuredCalls).toHaveLength(0);
  expect((await rows(all)).traces).toHaveLength(0);
});

test("age, strength, status and valid count filters apply before oldest selection", async () => {
  const { all, deps } = setup();
  await seed(deps, 24, { valence: 0.499 });
  await seed(deps, 23, { status: "stale" });
  await seed(deps, 22, { status: "superseded" });
  await seed(deps, 21, { payload: { ruminated: 1 } });
  await seed(deps, 20, { payload: { ruminated: -1 } });
  await seed(deps, 19, { payload: { ruminated: "zero" } });
  const eligible = await seed(deps, 18, { payload: {} });
  expect(await ruminate(deps)).toMatchObject({ applied: true });
  expect((await rows(all)).thoughts[0]?.payload).toEqual({ ruminates: eligible });
  expect((await deps.core.memory.get(eligible))?.payload).toEqual({ ruminated: 1 });
});

test("configured maximum count and threshold control eligibility", async () => {
  const { all, deps } = setup({ core: { ruminate: { min_valence: 0.7, max_per_episode: 2 } } });
  await seed(deps, 6, { valence: 0.6 });
  const id = await seed(deps, 4, { valence: 0.7, payload: { ruminated: 1 } });
  expect(await ruminate(deps)).toMatchObject({ applied: true });
  expect((await rows(all)).thoughts[0]?.payload).toEqual({ ruminates: id });
  expect((await deps.core.memory.get(id))?.payload).toEqual({ ruminated: 2 });
});

test("historical emotion and related people and goal are shown without inventing context", async () => {
  const { all, deps } = setup();
  const [person] = await deps.core.memory.addEntities(["Alcor"], 0.8, now);
  const goal = await deps.core.goals.insert({
    title: "Watch more old films",
    why: "They mean something to her",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: null,
    started_at: ago(48),
    target_at: null,
    embedding: vec(0.04),
  });
  const eventId = await deps.core.world.recordEvent({
    at: ago(50),
    kind: "planned",
    content: "Film with Alcor",
    valence: -0.6,
    stakes: "high",
    agents: [person!],
    agent_names: ["Alcor"],
    life_day: "2026-01-03",
    created_at: ago(60),
    goal_ref: goal,
  });
  const id = await seed(deps, 3, {
    payload: {
      appraisal_emotion: { label: "wistful", valence: -0.6, arousal: 0.4, phrase: "film" },
    },
    entityRefs: [person!],
    sourceRef: `world_event:${eventId}`,
  });
  expect(await ruminate(deps)).toMatchObject({ applied: true });
  const call = all.llm.structuredCalls[0]!;
  expect(call.input).toContain("wistful");
  expect(call.input).toContain("Alcor");
  expect(call.input).toContain("Watch more old films");
  expect(call.input).toContain("They mean something to her");
  expect(call.system).toContain("You are Spica.");
  expect((await rows(all)).thoughts[0]).toMatchObject({
    entity_refs: [person],
    valence: -0.6,
    payload: { ruminates: id },
  });
});

test("missing and corrupt historical emotion are explicitly absent", async () => {
  for (const payload of [{}, { appraisal_emotion: { label: "false memory" } }]) {
    await resetDb();
    const { all, deps } = setup();
    await seed(deps, 3, { payload });
    expect(await ruminate(deps)).toMatchObject({ applied: true });
    expect(all.llm.structuredCalls[0]!.input).toContain("Historical emotion: absent");
    expect(all.llm.structuredCalls[0]!.input).not.toContain("false memory");
  }
});

test("accepted thought reinforces once using configured bump and cap and only refreshes matching emotion", async () => {
  const { all, deps } = setup({ retrieval: { recall_bump: 0.04, recall_cap: 0.96 } });
  const id = await seed(deps, 3, { salience: 0.94 });
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  const emotion = {
    label: "sad",
    valence: -0.6,
    arousal: 0.7,
    phrase: null,
    about: id,
    since: ago(3).toISOString(),
  };
  await deps.core.state.update({ emotion });
  expect(await ruminate(deps)).toMatchObject({ applied: true });
  const [episode] = await all.db.select().from(core_memory).where(eq(core_memory.id, id));
  expect(episode).toMatchObject({ recall_count: 1, last_recalled_at: now });
  expect(episode!.salience).toBeCloseTo(0.96);
  expect(episode!.payload).toMatchObject({ ruminated: 1 });
  expect(await deps.core.state.get()).toMatchObject({
    mood_valence: expect.closeTo(0.1),
    mood_arousal: 0.4,
    emotion: { ...emotion, since: now.toISOString() },
  });
  expect((await rows(all)).traces).toMatchObject([{ status: "done", calls: 1 }]);
});

test("unrelated current emotion survives and mood valence is clamped", async () => {
  const { deps } = setup();
  await seed(deps, 3, { valence: 0.8 });
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  const emotion = {
    label: "calm",
    valence: 0.1,
    arousal: 0.2,
    phrase: null,
    about: null,
    since: ago(1).toISOString(),
  };
  await deps.core.state.update({ mood_valence: 0.97, emotion });
  expect(await ruminate(deps)).toMatchObject({ applied: true });
  expect(await deps.core.state.get()).toMatchObject({ mood_valence: 1, emotion });
});

test("deduped thought leaves marker, recall and state untouched", async () => {
  const { all, deps } = setup();
  const id = await seed(deps, 3);
  const [embedding] = await deps.embedder.embed([thought], "document");
  await deps.core.memory.insert({
    kind: "thought",
    content: thought,
    embedding: embedding!,
    occurred_at: now,
    created_at: now,
    status: "recurring",
    salience: 0.25,
    valence: 0,
    confidence: 0.6,
    source: "loop",
    source_ref: "other:prior",
  });
  expect(await ruminate(deps)).toEqual({ status: "done", applied: false, ids: [] });
  expect((await rows(all)).thoughts).toHaveLength(1);
  expect((await deps.core.memory.get(id))?.payload).not.toHaveProperty("ruminated");
  const [episode] = await all.db.select().from(core_memory).where(eq(core_memory.id, id));
  expect(episode).toMatchObject({ recall_count: 0, last_recalled_at: null });
  expect(await deps.core.state.get()).toBeNull();
  expect((await rows(all)).traces[0]?.outputs).toMatchObject({
    applied: false,
    dropped: [thought],
  });
});

test("two in-flight runs apply once and the loser records no effects", async () => {
  const { all, deps } = setup();
  const id = await seed(deps, 3);
  let entered = 0;
  let release!: () => void;
  let bothEntered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    bothEntered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  all.llm.handlers.core_ruminate = async () => {
    if (++entered === 2) bothEntered();
    await gate;
    return { thought: { kind: "thought", content: thought, salience: "low" } };
  };
  const first = ruminate(deps);
  const second = ruminate(deps);
  await waiting;
  release();
  const results = await Promise.all([first, second]);
  expect(results.filter((r) => r.applied)).toHaveLength(1);
  expect((await rows(all)).thoughts).toHaveLength(1);
  expect((await deps.core.memory.get(id))?.payload).toMatchObject({ ruminated: 1 });
  const [episode] = await all.db.select().from(core_memory).where(eq(core_memory.id, id));
  expect(episode?.recall_count).toBe(1);
  expect((await rows(all)).traces).toHaveLength(2);
});

test("invalid output and embedding failure leave no effects and trace failures", async () => {
  for (const failure of ["output", "embedding"] as const) {
    await resetDb();
    const { all, deps } = setup();
    const id = await seed(deps, 3);
    if (failure === "output")
      all.llm.handlers.core_ruminate = () => ({
        thought: { kind: "idea", content: thought, salience: "low" },
      });
    else vi.spyOn(deps.embedder, "embed").mockRejectedValue(new Error("embedding failed"));
    await expect(ruminate(deps)).rejects.toThrow();
    expect((await rows(all)).thoughts).toHaveLength(0);
    expect((await deps.core.memory.get(id))?.payload).not.toHaveProperty("ruminated");
    expect((await rows(all)).traces).toMatchObject([{ status: "failed" }]);
  }
});

test("the deterministic rumination fake bounds a long episode", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await deps.core.memory.insert({
    kind: "episode",
    content: "x".repeat(deps.config.core.appraise.episode_max_chars),
    payload: {},
    embedding: vec(0.02),
    occurred_at: ago(50),
    created_at: ago(3),
    status: "resolved",
    salience: 0.4,
    valence: 0.7,
    confidence: 0.8,
    source: "world",
    source_ref: null,
  });
  expect(await ruminate(deps)).toMatchObject({ status: "done", applied: true });
  expect((await rows(all)).thoughts[0]!.content.length).toBeLessThanOrEqual(
    deps.config.core.loops.max_chars,
  );
});
