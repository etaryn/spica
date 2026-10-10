/** Nightly reflection turns new core experience into bounded core memory and goal changes. */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
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

test("no new inputs completes with zero calls and no memory marks", async () => {
  const { all, deps } = setup();
  expect(await coreReflect(deps, now)).toBe("done");
  expect(all.llm.structuredCalls).toHaveLength(0);
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([{ status: "done", calls: 0 }]);
  expect(await all.db.select().from(core_memory)).toEqual([]);
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

test("overflow drains in stable timestamp and ID order across nights without duplicates", async () => {
  const { all, deps } = setup({ core: { reflect: { max_inputs: 2 } } });
  const created = new Date(now.getTime() - 1000);
  const ids: string[] = [];
  for (const content of ["a", "b", "c", "d", "e"])
    ids.push(await memory(deps, "episode", content, created));
  for (let day = 0; day < 4; day++) {
    const night = new Date(now.getTime() + day * 86_400_000);
    expect(await coreReflect(deps, night)).toBe("done");
  }
  expect(all.llm.structuredCalls).toHaveLength(3);
  expect(
    all.llm.structuredCalls.flatMap((call) =>
      JSON.parse(call.input).inputs.map((item: { id: string }) => item.id),
    ),
  ).toEqual(ids.sort());
  expect((await all.db.select().from(core_loop_trace)).map((trace) => trace.calls)).toEqual([
    1, 1, 1, 0,
  ]);
  expect(
    (await all.db.select().from(core_memory))
      .filter((row) => ids.includes(row.id))
      .every((row) => row.reflected_at !== null),
  ).toBe(true);
});

test("zero-input success still reflects late backfill while failed runs leave inputs due", async () => {
  const { all, deps } = setup();
  expect(await coreReflect(deps, now)).toBe("done");
  const backfill = await memory(deps, "episode", "older backfill", new Date(now.getTime() - 1000));
  const fresh = await memory(deps, "episode", "new event", new Date(now.getTime() + 1000));
  const next = new Date(now.getTime() + 86_400_000);
  all.llm.handlers.core_reflect = () => {
    throw new Error("model failure");
  };
  await expect(coreReflect(deps, next)).rejects.toThrow("model failure");
  expect((await all.db.select().from(core_memory)).every((row) => row.reflected_at === null)).toBe(
    true,
  );
  all.llm.handlers.core_reflect = () => ({
    insights: [],
    opinions: [],
    interests: [],
    goals: { add: [], drop: [] },
    narrative: null,
  });
  expect(await coreReflect(deps, new Date(next.getTime() + 86_400_000))).toBe("done");
  const calls = all.llm.structuredCalls.map((call) =>
    JSON.parse(call.input).inputs.map((item: { id: string }) => item.id),
  );
  expect(calls).toEqual([
    [backfill, fresh],
    [backfill, fresh],
  ]);
});

test("late insert with earlier created_at remains due after the selected batch commits", async () => {
  const { all, deps } = setup();
  const selected = await memory(deps, "episode", "selected", new Date(now.getTime() - 1000));
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  all.llm.handlers.core_reflect = async () => {
    entered();
    await gate;
    return {
      insights: [],
      opinions: [],
      interests: [],
      goals: { add: [], drop: [] },
      narrative: null,
    };
  };
  const first = coreReflect(deps, now);
  await waiting;
  const late = await memory(deps, "episode", "late", new Date(now.getTime() - 2000));
  release();
  expect(await first).toBe("done");
  const afterCommit = await memory(deps, "episode", "after commit", new Date(now.getTime() - 3000));
  expect(
    (await all.db.select().from(core_memory)).find((row) => row.id === selected)?.reflected_at,
  ).toEqual(now);
  expect(
    (await all.db.select().from(core_memory)).find((row) => row.id === late)?.reflected_at,
  ).toBeNull();
  expect(
    (await all.db.select().from(core_memory)).find((row) => row.id === afterCommit)?.reflected_at,
  ).toBeNull();
  expect(await coreReflect(deps, new Date(now.getTime() + 86_400_000))).toBe("done");
  expect(
    all.llm.structuredCalls.map((call) =>
      JSON.parse(call.input).inputs.map((item: { id: string }) => item.id),
    ),
  ).toEqual([[selected], [afterCommit, late]]);
});

test("transaction failure after marking rolls the marker and success trace back", async () => {
  const { all, deps } = setup();
  const id = await memory(deps, "episode", "A day.");
  const original = deps.core.transaction.bind(deps.core);
  deps.core.transaction = async (fn) =>
    original(async (tx) => {
      await fn(tx);
      throw new Error("commit failure");
    });
  await expect(coreReflect(deps, now)).rejects.toThrow("commit failure");
  expect(
    (await all.db.select().from(core_memory)).find((row) => row.id === id)?.reflected_at,
  ).toBeNull();
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([{ status: "failed" }]);
  deps.core.transaction = original;
  expect(await coreReflect(deps, new Date(now.getTime() + 86_400_000))).toBe("done");
  expect(
    (await all.db.select().from(core_memory)).find((row) => row.id === id)?.reflected_at,
  ).not.toBeNull();
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
    insights: [{ content: "A film can change her mind.", depth: null }],
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
  for (const bad of [{ insights: ["", "", ""] }, new Error("model unavailable")]) {
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

test("overfilled output is trimmed to its bounds instead of failing the night", async () => {
  const { all, deps } = setup();
  await memory(deps, "episode", "An experience.");
  const bounds = all.config.core.reflect;
  all.llm.handlers.core_reflect = () => ({
    insights: ["one", "two", "three"].map((content) => ({ content, depth: null })),
    opinions: Array.from({ length: bounds.max_opinions + 1 }, (_, i) => ({
      subject: `films ${i}`,
      stance: "good",
      confidence: "medium",
    })),
    interests: Array.from({ length: bounds.max_interests + 1 }, (_, i) => ({
      status: "new",
      content: `interest ${i}`,
    })),
    goals: { add: [], drop: [] },
    narrative: "First paragraph.\n\nSecond paragraph.",
  });
  expect(await coreReflect(deps, now)).toBe("done");
  const rows = await all.db.select().from(core_memory);
  const count = (kind: string) => rows.filter((row) => row.kind === kind).length;
  expect(count("insight")).toBe(bounds.max_insights);
  expect(count("opinion")).toBe(bounds.max_opinions);
  expect(count("interest")).toBe(bounds.max_interests);
  expect(rows.find((row) => row.kind === "narrative")?.content).toBe(
    "First paragraph. Second paragraph.",
  );
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

test("fade and drop only needs no document embeddings and traces both accepted IDs", async () => {
  const { all, deps } = setup({ core: { goals: { min_active: 0 } } });
  await memory(deps, "episode", "A day.");
  const interest = await memory(deps, "interest", "Films.");
  const goal = await deps.core.goals.insert({
    title: "Watch",
    why: "Curiosity",
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    embedding: vec(),
  });
  const embed = deps.embedder.embed.bind(deps.embedder);
  vi.spyOn(deps.embedder, "embed").mockImplementation((texts, kind) => {
    if (texts.length === 0) throw new Error("empty embedding batch");
    return embed(texts, kind);
  });
  all.llm.handlers.core_reflect = () => ({
    insights: [],
    opinions: [],
    interests: [{ status: "fading", target_id: interest }],
    goals: { add: [], drop: [goal] },
    narrative: null,
  });
  expect(await coreReflect(deps, now)).toBe("done");
  expect((await deps.core.memory.get(interest))?.salience).toBeCloseTo(0.25);
  expect((await deps.core.goals.get(goal))?.status).toBe("dropped");
  expect((await all.db.select().from(core_loop_trace))[0]?.outputs).toMatchObject({
    memory_ids: [],
    goal_ids: [],
    faded_interest_ids: [interest],
    dropped_goal_ids: [goal],
  });
});

test("drops never leave her fewer active goals than the floor unless she adds replacements", async () => {
  const { all, deps } = setup();
  await memory(deps, "episode", "A day.");
  const goal = (title: string) =>
    deps.core.goals.insert({
      title,
      why: "Curiosity",
      status: "active",
      progress: 0,
      source: "seed",
      source_ref: null,
      started_at: now,
      target_at: null,
      embedding: vec(),
    });
  const first = await goal("Learn the constellations");
  const second = await goal("Finish the film list");
  all.llm.handlers.core_reflect = () => ({
    insights: [],
    opinions: [],
    interests: [],
    goals: { add: [], drop: [first, second] },
    narrative: null,
  });
  expect(await coreReflect(deps, now)).toBe("done");
  expect((await deps.core.goals.active()).map((g) => g.id)).toEqual([second]);

  await memory(deps, "episode", "Another day.", new Date(now.getTime() + 1000));
  all.llm.handlers.core_reflect = () => ({
    insights: [],
    opinions: [],
    interests: [],
    goals: { add: [{ title: "Read more", why: "Books" }], drop: [second] },
    narrative: null,
  });
  expect(await coreReflect(deps, new Date(now.getTime() + 2000))).toBe("done");
  expect((await deps.core.goals.active()).map((g) => g.title)).toEqual(["Read more"]);
});

test("each new memory keeps its judged depth, or its kind's default", async () => {
  const { all, deps } = setup();
  await memory(deps, "episode", "An experience.");
  all.llm.handlers.core_reflect = () => ({
    insights: [{ content: "She hides how much Alcor matters.", depth: "intimate" }],
    opinions: [{ subject: "musicals", stance: "too loud", confidence: "medium" }],
    interests: [{ status: "new", content: "Radio dramas.", depth: "surface" }],
    goals: { add: [], drop: [] },
    narrative: "She is quieter lately.",
  });
  expect(await coreReflect(deps, now)).toBe("done");
  const rows = await all.db.select().from(core_memory);
  const depth = (kind: string) => rows.find((r) => r.kind === kind)!.depth;
  const byKind = all.config.core.depth.by_kind;
  expect(depth("insight")).toBe(3);
  expect(depth("opinion")).toBe(byKind.opinion);
  expect(depth("interest")).toBe(1);
  expect(depth("narrative")).toBe(byKind.narrative);
});
