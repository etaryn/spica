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
  await expect(retrieveCore(deps, { queryText: "hi", now })).resolves.toEqual({ memories: [] });
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
