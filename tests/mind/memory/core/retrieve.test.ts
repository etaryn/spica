import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { coreBoost, retrieveCore } from "@/mind/memory/core/retrieve";
import { core_memory } from "@/db/schema";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");

async function addEpisode(
  deps: ReturnType<typeof makeTestDeps>,
  content: string,
  occurred_at: Date = now,
) {
  return deps.core.memory.insert({
    kind: "episode",
    content,
    embedding: vec(0.01),
    occurred_at,
    created_at: now,
    status: "resolved",
    salience: 0.4,
    valence: 0.1,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
}

test("returns at most core_top_n memories", async () => {
  const deps = makeTestDeps({ retrieval: { core_top_n: 2 } });
  for (const c of ["a", "b", "c"]) await addEpisode(deps, c);
  const r = await retrieveCore(deps, { queryText: "hi", now });
  expect(r.memories).toHaveLength(2);
});

test("her preoccupation is always there, marked on her mind", async () => {
  const deps = makeTestDeps({ retrieval: { core_top_n: 1 } });
  await addEpisode(deps, "a");
  const pre = await addEpisode(deps, "telescope");
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  await deps.core.state.update({ preoccupation: pre, preoccupation_since: now });
  const r = await retrieveCore(deps, { queryText: "hi", now });
  expect(r.memories.find((m) => m.id === pre)?.onMind).toBe(true);
});

test("forced ids are included; reading never writes to core memory", async () => {
  const deps = makeTestDeps({ retrieval: { core_top_n: 1 } });
  await addEpisode(deps, "a");
  const forced = await addEpisode(deps, "forced");
  const before = await deps.db.select().from(core_memory);
  const r = await retrieveCore(deps, { queryText: "hi", now, forceIds: [forced] });
  expect(r.memories.map((m) => m.id)).toContain(forced);
  expect(await deps.db.select().from(core_memory)).toEqual(before);
});

test("an embed failure degrades to the preoccupation only, never throws", async () => {
  const deps = makeTestDeps();
  vi.spyOn(deps.embedder, "embed").mockRejectedValue(new Error("down"));
  await expect(retrieveCore(deps, { queryText: "hi", now })).resolves.toEqual({
    memories: [],
    heldBack: null,
  });
});

async function addIntention(deps: ReturnType<typeof makeTestDeps>, status: "open" | "resolved") {
  return deps.core.memory.insert({
    kind: "intention",
    content: `Spica is thinking of rewatching Solaris tonight (${status}).`,
    embedding: vec(0.01),
    occurred_at: now,
    created_at: now,
    status,
    salience: 0.4,
    valence: 0.3,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
}

test("a failed state read still ranks her memories, as if her mood were neutral", async () => {
  const deps = makeTestDeps();
  await addEpisode(deps, "a");
  vi.spyOn(deps.core.state, "get").mockRejectedValueOnce(new Error("down"));
  const r = await retrieveCore(deps, { queryText: "hi", now });
  expect(r.memories.map((m) => m.content)).toEqual(["a"]);
});

test("an open intention is recalled: a plan is on her mind before it happens", async () => {
  const deps = makeTestDeps();
  const open = await addIntention(deps, "open");
  const r = await retrieveCore(deps, { queryText: "tonight?", now });
  expect(r.memories.map((m) => m.id)).toEqual([open]);
});

test("a resolved intention is never recalled: ranked, forced or as her preoccupation", async () => {
  const deps = makeTestDeps();
  const done = await addIntention(deps, "resolved");
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  await deps.core.state.update({ preoccupation: done, preoccupation_since: now });
  const r = await retrieveCore(deps, { queryText: "Solaris", now, forceIds: [done] });
  expect(r.memories).toEqual([]);
});

test("coreBoost: congruent mood lifts, incongruent damps, goals lift, neutral is 1", () => {
  const r = { core_mood_bias: 0.3, core_goal_bias: 0.3 };
  expect(coreBoost({ valence: 0, goal_sim: 0 }, 0.8, r)).toBe(1);
  expect(coreBoost({ valence: -0.5, goal_sim: 0 }, -0.6, r)).toBeCloseTo(1.09);
  expect(coreBoost({ valence: -0.5, goal_sim: 0 }, 0.6, r)).toBeCloseTo(0.91);
  expect(coreBoost({ valence: 0, goal_sim: 1 }, 0, r)).toBeCloseTo(1.3);
  expect(coreBoost({ valence: -1, goal_sim: 0 }, 1, r)).toBeGreaterThan(0);
});

test("a memory near an active goal outranks an equally close one that isn't", async () => {
  const deps = makeTestDeps({ retrieval: { core_top_n: 1 } });
  const axes = (...on: number[]) =>
    Array.from({ length: 1024 }, (_, i) => (on.includes(i) ? 1 : 0));
  await deps.core.goals.insert({
    title: "Finish the star atlas",
    why: "it matters to her",
    status: "active",
    progress: 0,
    embedding: axes(0),
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
  });
  const episode = (content: string, embedding: number[]) =>
    deps.core.memory.insert({
      kind: "episode",
      content,
      embedding,
      occurred_at: now,
      created_at: now,
      status: "resolved",
      salience: 0.4,
      valence: 0.1,
      confidence: 1,
      source: "world",
      source_ref: null,
    });
  // Both sit at the same angle to the query; only the first leans toward the goal.
  const id = await episode("atlas work", axes(0, 2));
  await episode("unrelated", axes(1, 2));
  const r = await retrieveCore(deps, {
    queryText: "x",
    queryVector: Promise.resolve(axes(2)),
    now,
  });
  expect(r.memories.map((m) => m.id)).toEqual([id]);
});

async function addAt(deps: ReturnType<typeof makeTestDeps>, content: string, depth: number) {
  const [embedding] = await deps.embedder.embed([content], "document");
  return deps.core.memory.insert({
    kind: "episode",
    content,
    embedding: embedding!,
    occurred_at: now,
    created_at: now,
    status: "resolved",
    salience: 0.4,
    valence: 0,
    confidence: 1,
    source: "world",
    source_ref: null,
    depth,
  });
}

test("nothing deeper than the limit comes back, forced or on her mind; each carries its depth", async () => {
  const deps = makeTestDeps({ retrieval: { core_top_n: 12 } });
  await addAt(deps, "toast", 1);
  await addAt(deps, "a worry", 2);
  const secret = await addAt(deps, "a secret", 3);
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  await deps.core.state.update({ preoccupation: secret, preoccupation_since: now });
  const r = await retrieveCore(deps, { queryText: "hi", now, maxDepth: 2, forceIds: [secret] });
  expect(r.memories.map((m) => [m.content, m.depth]).sort()).toEqual([
    ["a worry", 2],
    ["toast", 1],
  ]);
});

test("a strong match beyond the limit is named as held back; a weak one isn't", async () => {
  const deps = makeTestDeps({
    retrieval: { core_top_n: 12 },
    relationship: { depth: { held_back_similarity: 0.99 } },
  });
  await addAt(deps, "toast", 1);
  const secret = await addAt(deps, "a secret", 3);
  const strong = await retrieveCore(deps, { queryText: "a secret", now, maxDepth: 1 });
  expect(strong.heldBack?.id).toBe(secret);
  const weak = await retrieveCore(deps, { queryText: "the weather", now, maxDepth: 1 });
  expect(weak.heldBack).toBeNull();
  const within = await retrieveCore(deps, { queryText: "a secret", now, maxDepth: 3 });
  expect(within.heldBack).toBeNull();
});
