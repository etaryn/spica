/** Nightly reflection turns new core experience into bounded core memory and goal changes. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { core_loop_trace, core_memory, core_goal } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreReflect } from "@/mind/process/core/reflect";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");

function setup(overrides: unknown = {}) {
  const all = makeTestDeps(overrides);
  const deps = coreDepsOf(all);
  all.llm.handlers.core_reflect = () => ({
    insights: [],
    opinions: [],
    interests: [],
    goals: { add: [], drop: [] },
    narrative: null,
  });
  return { all, deps };
}

async function memory(
  deps: ReturnType<typeof setup>["deps"],
  kind: "episode" | "opinion" | "interest" | "narrative",
  content: string,
  created_at = now,
) {
  return deps.core.memory.insert({
    kind,
    content,
    embedding: vec(),
    occurred_at: created_at,
    created_at,
    status: "recurring",
    salience: 0.5,
    valence: 0,
    confidence: 0.6,
    source: "loop",
    source_ref: null,
  });
}

test("no new inputs completes with zero calls and advances the successful boundary", async () => {
  const { all, deps } = setup();
  expect(await coreReflect(deps, now)).toBe("done");
  expect(all.llm.structuredCalls).toHaveLength(0);
  expect(await deps.core.traces.latestDone("core_reflect", new Date(now.getTime() + 1))).toEqual(
    now,
  );
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([{ status: "done", calls: 0 }]);
});

test("model input caps new experience and active context independently", async () => {
  const { all, deps } = setup({ core: { reflect: { max_inputs: 2, context_items: 1 } } });
  for (const content of ["first", "second", "third"]) await memory(deps, "episode", content);
  await memory(deps, "opinion", "one view");
  await memory(deps, "interest", "one interest");
  const narrativeId = await memory(deps, "narrative", "She remembers her changing taste.");
  expect(await coreReflect(deps, now)).toBe("done");
  const input = JSON.parse(all.llm.structuredCalls[0]!.input);
  expect(input.inputs).toHaveLength(2);
  expect(input.context).toHaveLength(1);
  expect(input.inputs.every((item: { kind: string }) => item.kind === "episode")).toBe(true);
  expect(input.narrative).toMatchObject({
    id: narrativeId,
    content: "She remembers her changing taste.",
  });
});

test("bounded proposals supersede opinions and narrative, fade interests, and change goals", async () => {
  const { all, deps } = setup();
  await memory(deps, "episode", "Saw an old film.");
  const opinion = await memory(deps, "opinion", "Old films are dull.");
  const interest = await memory(deps, "interest", "Old films.");
  const narrative = await memory(deps, "narrative", "I avoid old films.");
  const dropped = await deps.core.goals.insert({
    title: "Watch films",
    why: "Learn",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    embedding: vec(),
  });
  all.llm.handlers.core_reflect = () => ({
    insights: ["A film can change her mind."],
    opinions: [
      {
        subject: "old films",
        stance: "They can surprise her.",
        confidence: "high",
        supersedes: opinion,
      },
    ],
    interests: [
      { status: "fading", target_id: interest },
      { status: "new", content: "Restored films." },
    ],
    goals: { add: [{ title: "Find more films", why: "Stay curious" }], drop: [dropped] },
    narrative: "She is curious about films again.",
  });
  expect(await coreReflect(deps, now)).toBe("done");
  const memories = await all.db.select().from(core_memory);
  const traces = await all.db.select().from(core_loop_trace);
  const replacement = memories.find((m) => m.kind === "opinion" && m.id !== opinion)!;
  expect(await deps.core.memory.get(opinion)).toMatchObject({ status: "superseded" });
  expect(memories.find((m) => m.id === opinion)?.superseded_by).toBe(replacement.id);
  expect(replacement).toMatchObject({
    confidence: 0.9,
    salience: 0.5,
    valence: 0,
    source_ref: `core_reflect:${traces[0]!.id}`,
  });
  expect((await deps.core.memory.get(interest))?.salience).toBeCloseTo(0.25);
  expect(memories.find((m) => m.kind === "interest" && m.id !== interest)).toMatchObject({
    content: "Restored films.",
    salience: 0.4,
  });
  expect((await deps.core.memory.get(narrative))?.status).toBe("superseded");
  expect((await deps.core.goals.get(dropped))?.status).toBe("dropped");
  expect(
    (await all.db.select().from(core_goal)).find((g) => g.title === "Find more films"),
  ).toMatchObject({ source: "reflect", progress: 0 });
  expect(traces[0]?.outputs).toMatchObject({
    memory_ids: expect.arrayContaining([replacement.id]),
    goal_ids: expect.any(Array),
  });
});

test("stale and unknown targets are ignored and active goal additions stop at the cap", async () => {
  const { all, deps } = setup({ core: { goals: { max_active: 1 } } });
  await memory(deps, "episode", "A new thought.");
  const old = await memory(deps, "opinion", "An old view.");
  await deps.core.memory.setStatus(old, "stale");
  all.llm.handlers.core_reflect = () => ({
    insights: [],
    opinions: [{ subject: "films", stance: "Interesting", confidence: "low", supersedes: old }],
    interests: [{ status: "fading", target_id: old }],
    goals: {
      add: [
        { title: "First", why: "Reason" },
        { title: "Second", why: "Reason" },
      ],
      drop: ["00000000-0000-4000-8000-000000000000"],
    },
    narrative: null,
  });
  expect(await coreReflect(deps, now)).toBe("done");
  expect((await deps.core.memory.get(old))?.status).toBe("stale");
  expect((await deps.core.memory.get(old))?.salience).toBe(0.5);
  expect(await deps.core.goals.active()).toHaveLength(1);
  expect(
    (await all.db.select().from(core_memory)).filter((m) => m.kind === "opinion"),
  ).toHaveLength(2);
});

test("invalid output and model failure trace failure without writes", async () => {
  for (const bad of [
    { insights: ["", "", ""] },
    {
      insights: ["one", "two", "three"],
      opinions: [],
      interests: [],
      goals: { add: [], drop: [] },
      narrative: null,
    },
    {
      insights: [],
      opinions: [],
      interests: [],
      goals: { add: [], drop: [] },
      narrative: "First paragraph.\n\nSecond paragraph.",
    },
    {
      insights: [],
      opinions: Array.from({ length: 4 }, () => ({
        subject: "films",
        stance: "good",
        confidence: "medium",
      })),
      interests: [],
      goals: { add: [], drop: [] },
      narrative: null,
    },
    {
      insights: [],
      opinions: [],
      interests: Array.from({ length: 3 }, () => ({ status: "new", content: "films" })),
      goals: { add: [], drop: [] },
      narrative: null,
    },
    new Error("model unavailable"),
  ]) {
    await resetDb();
    const { all, deps } = setup();
    await memory(deps, "episode", "An experience.");
    all.llm.handlers.core_reflect = () => {
      if (bad instanceof Error) throw bad;
      return bad;
    };
    await expect(coreReflect(deps, now)).rejects.toThrow();
    expect(await all.db.select().from(core_memory)).toHaveLength(1);
    expect(await all.db.select().from(core_loop_trace)).toMatchObject([{ status: "failed" }]);
  }
});

test("a target becoming stale during generation cannot be superseded", async () => {
  const { all, deps } = setup();
  await memory(deps, "episode", "A day.");
  const target = await memory(deps, "opinion", "A view.");
  all.llm.handlers.core_reflect = async () => {
    await deps.core.memory.setStatus(target, "stale");
    return {
      insights: [],
      opinions: [{ subject: "view", stance: "Changed", confidence: "medium", supersedes: target }],
      interests: [],
      goals: { add: [], drop: [] },
      narrative: null,
    };
  };
  expect(await coreReflect(deps, now)).toBe("done");
  expect((await deps.core.memory.get(target))?.status).toBe("stale");
  expect(
    (await all.db.select().from(core_memory)).filter((m) => m.kind === "opinion"),
  ).toHaveLength(2);
});
