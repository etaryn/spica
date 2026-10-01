import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { retrieveCore } from "@/mind/memory/core/retrieve";
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
  await deps.core.state.ensure(deps.config.core.state.baseline);
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
  await expect(retrieveCore(deps, { queryText: "hi", now })).resolves.toEqual({ memories: [] });
});

test("a preoccupation that hasn't happened yet is not surfaced", async () => {
  const deps = makeTestDeps();
  const later = new Date("2026-01-05T18:00:00Z");
  const pre = await addEpisode(deps, "tonight's meteor shower", later);
  await deps.core.state.ensure(deps.config.core.state.baseline);
  await deps.core.state.update({ preoccupation: pre, preoccupation_since: now });
  const r = await retrieveCore(deps, { queryText: "", now, forceIds: [pre] });
  expect(r.memories).toEqual([]);
});

test("an episode dated later today is not ranked in", async () => {
  const deps = makeTestDeps();
  await addEpisode(deps, "later today", new Date("2026-01-05T18:00:00Z"));
  const done = await addEpisode(deps, "this morning", new Date("2026-01-05T07:00:00Z"));
  const r = await retrieveCore(deps, { queryText: "hi", now });
  expect(r.memories.map((m) => m.id)).toEqual([done]);
});
