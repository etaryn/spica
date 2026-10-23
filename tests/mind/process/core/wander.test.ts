/** Wandering runs only in free time and records one atomic completion per accepted run. */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { core_loop_trace, core_memory } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { loadConfig } from "@/mind/platform/config";
import type { CoreMemoryItem } from "@/mind/memory/core/types";
import { coreWander, pickCue } from "@/mind/process/core/wander";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T09:00:00Z");
const hour = 3_600_000;
const before = (hours: number) => new Date(now.getTime() - hours * hour);
const item = { kind: "thought", content: "She keeps the old film in mind.", salience: "low" };

function setup(overrides: unknown = {}) {
  const all = makeTestDeps(overrides);
  const deps = coreDepsOf(all);
  all.llm.handlers.core_wander = () => ({ items: [item] });
  return { all, deps };
}

async function plan(deps: ReturnType<typeof setup>["deps"], day = "2026-01-05", free = false) {
  await deps.core.world.insertPlan({
    date: day,
    plan: {
      blocks: free
        ? []
        : [{ start: "10:00", end: "13:00", kind: "busy", busy: 0.6, label: "reading" }],
    },
    source: "scripted",
    model: "fake",
    prompt_version: "v1",
    generated_at: now,
  });
}

async function seed(
  deps: ReturnType<typeof setup>["deps"],
  content = "Spica found an old film.",
  changes: {
    kind?: "episode" | "intention" | "hypothetical";
    status?: "open" | "resolved" | "stale" | "superseded";
    created?: Date;
    salience?: number;
    valence?: number;
    embedding?: number[];
    entities?: string[];
  } = {},
) {
  return deps.core.memory.insert({
    kind: changes.kind ?? "episode",
    content,
    payload: {},
    embedding: changes.embedding ?? vec(),
    entity_refs: changes.entities ?? [],
    occurred_at: changes.created ?? before(1),
    created_at: changes.created ?? before(1),
    status: changes.status ?? "resolved",
    salience: changes.salience ?? 0.4,
    valence: changes.valence ?? 0.5,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
}

async function traces(all: ReturnType<typeof setup>["all"]) {
  return (await all.db.select().from(core_loop_trace)).filter((row) => row.loop === "core_wander");
}

async function thoughts(all: ReturnType<typeof setup>["all"]) {
  return (await all.db.select().from(core_memory)).filter((row) => row.source === "loop");
}

test("missing plan and empty seed pool are not due and make no trace", async () => {
  const { all, deps } = setup();
  await seed(deps);
  expect(await coreWander(deps, now)).toEqual({ status: "not_due", applied: false, ids: [] });
  await plan(deps);
  await resetDb();
  await plan(deps);
  expect(await coreWander(deps, now)).toEqual({ status: "not_due", applied: false, ids: [] });
  expect(all.llm.structuredCalls).toHaveLength(0);
  expect(await traces(all)).toHaveLength(0);
});

test("busy block edges exclude their interval; free time allows wandering, at any hour", async () => {
  const cases = [
    ["2026-01-04T16:00:00Z", true], // 00:00 local: no night any more
    ["2026-01-05T02:00:00Z", false], // 10:00 local: busy begins
    ["2026-01-05T05:00:00Z", true], // 13:00 local: busy ends
  ] as const;
  for (const [instant, due] of cases) {
    await resetDb();
    const { deps } = setup();
    await plan(deps);
    await seed(deps, "before the blocks", { created: before(24) });
    expect((await coreWander(deps, new Date(instant))).applied).toBe(due);
  }
});

test("she doesn't wander while she's offline", async () => {
  const { deps } = setup();
  await plan(deps);
  await seed(deps, "before the blocks", { created: before(24) });
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  await deps.core.state.update({ energy: 0.1, offline_since: now, last_tick: now });
  expect((await coreWander(deps, now)).applied).toBe(false);
});

test("one accepted wander stores seed context and leaves core state and source untouched", async () => {
  const { all, deps } = setup();
  await plan(deps);
  const [person] = await deps.core.memory.addEntities(["Alcor"], 0.8, now);
  const id = await seed(deps, "Spica found an old film.", { valence: -0.6, entities: [person!] });
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.7, competence: 0.3 });
  const state = structuredClone(await deps.core.state.get());
  const source = structuredClone(await deps.core.memory.get(id));
  const result = await coreWander(deps, now);
  const [stored] = await thoughts(all);
  expect(result).toEqual({ status: "done", applied: true, ids: [stored!.id] });
  expect(stored).toMatchObject({
    kind: "thought",
    payload: { seed: id, chain: [] },
    entity_refs: [person],
    valence: -0.6,
    source_ref: `core_wander:${(await traces(all))[0]!.id}`,
  });
  expect(await deps.core.state.get()).toEqual(state);
  expect(await deps.core.memory.get(id)).toEqual(source);
  // The seed reaches the model with its day and how far that is from now.
  const input = all.llm.structuredCalls.find((c) => c.purpose === "core_wander")!.input;
  expect(input).toMatch(/Seed memory: Spica found an old film\. \(⟦\d{4}-\d{2}-\d{2}\|day\|/);
});

test("seed pool omits unreal, stale, superseded and resolved intentions", async () => {
  const { all, deps } = setup();
  await plan(deps);
  await seed(deps, "unreal", { kind: "hypothetical" });
  await seed(deps, "stale", { status: "stale" });
  await seed(deps, "superseded", { status: "superseded" });
  await seed(deps, "completed plan", { kind: "intention" });
  const eligible = await seed(deps, "eligible memory");
  expect(await coreWander(deps, now)).toMatchObject({ applied: true });
  expect((await thoughts(all))[0]?.payload).toMatchObject({ seed: eligible });
});

test("zero weights fall back to a stable uniform pick and tied rows break by ID", async () => {
  const { all, deps } = setup({ core: { wander: { mood_bias: 1 } } });
  await plan(deps, "2026-01-06", true);
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  await deps.core.state.update({ mood_valence: 1 });
  const a = await seed(deps, "alpha", { valence: -1, created: before(1) });
  const b = await seed(deps, "beta", { valence: -1, created: before(1) });
  expect(await coreWander(deps, new Date("2026-01-05T16:00:00Z"))).toMatchObject({ applied: true });
  const first = (await thoughts(all))[0]!.payload as { seed: string };
  expect(first.seed).toBe([a, b].sort()[1]); // fixed day roll 0.538... chooses index one
});

test("mood bias gives a positive-weight memory priority over a zero-weight memory", async () => {
  const { all, deps } = setup({ core: { wander: { mood_bias: 1 } } });
  await plan(deps);
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  await deps.core.state.update({ mood_valence: 1 });
  await seed(deps, "against her mood", { valence: -1, created: before(0.5) });
  const weighted = await seed(deps, "with her mood", { valence: 1, created: before(1) });
  expect((await coreWander(deps, now)).applied).toBe(true);
  expect((await thoughts(all))[0]?.payload).toMatchObject({ seed: weighted });
});

test("the association chain excludes seed and completed plans before taking three", async () => {
  const { all, deps } = setup();
  await plan(deps);
  const picked = await seed(deps, "the central memory", { salience: 1, created: before(0.5) });
  for (let index = 0; index < 6; index++) {
    await seed(deps, `completed plan ${index}`, {
      kind: "intention",
      status: "resolved",
      created: before(2),
    });
  }
  const neighbours = [
    await seed(deps, "the first association", { salience: 0.01, created: before(3) }),
    await seed(deps, "the second association", { salience: 0.01, created: before(4) }),
    await seed(deps, "the third association", { salience: 0.01, created: before(5) }),
    await seed(deps, "the fourth association", { salience: 0.01, created: before(6) }),
  ];
  expect((await coreWander(deps, now)).applied).toBe(true);
  const payload = (await thoughts(all))[0]!.payload as { seed: string; chain: string[] };
  expect(payload.seed).toBe(picked);
  expect(payload.chain).toHaveLength(3);
  expect(payload.chain).not.toContain(picked);
  expect(payload.chain).toEqual([...neighbours].sort().slice(0, 3));
  expect(all.llm.structuredCalls[0]!.input).not.toContain("completed plan");
});

test("two outputs keep distinct real and unreal payloads in one completion", async () => {
  const { all, deps } = setup();
  await plan(deps);
  await seed(deps);
  all.llm.handlers.core_wander = () => ({
    items: [
      item,
      { kind: "hypothetical", content: "What if the film spoke back?", salience: "medium" },
    ],
  });
  expect((await coreWander(deps, now)).ids).toHaveLength(2);
  const stored = await thoughts(all);
  expect(stored.find((row) => row.kind === "thought")?.payload).not.toHaveProperty("unreal");
  expect(stored.find((row) => row.kind === "hypothetical")?.payload).toMatchObject({
    unreal: true,
  });
  expect(await traces(all)).toHaveLength(1);
});

test("a valid all-deduped invocation counts once toward the cap and gap", async () => {
  const { all, deps } = setup();
  await plan(deps);
  await seed(deps);
  const second = { ...item, content: "She keeps another film in mind." };
  all.llm.handlers.core_wander = () => ({ items: [item, second] });
  vi.spyOn(all.embedder, "embed").mockImplementation(async (texts) => texts.map(() => vec()));
  const first = await coreWander(deps, now);
  expect(first).toEqual({ status: "done", applied: true, ids: [] });
  expect((await traces(all))[0]?.outputs).toMatchObject({
    applied: true,
    dropped: [
      { content: item.content, reason: "dedupe" },
      { content: second.content, reason: "dedupe" },
    ],
  });
  expect(await coreWander(deps, new Date(now.getTime() + 2 * hour))).toEqual({
    status: "not_due",
    applied: false,
    ids: [],
  });
  expect(
    await deps.core.traces.appliedSummary("core_wander", before(24), new Date(now.getTime() + 1)),
  ).toMatchObject({
    count: 1,
  });
  expect(await traces(all)).toHaveLength(1);
});

test("exactly three hours permits a second run; daily cap blocks a third", async () => {
  const { all, deps } = setup();
  await plan(deps);
  await seed(deps);
  expect((await coreWander(deps, now)).applied).toBe(true);
  all.llm.handlers.core_wander = () => ({
    items: [{ ...item, content: "She considers the late film again." }],
  });
  expect((await coreWander(deps, new Date(now.getTime() + 3 * hour))).applied).toBe(true);
  expect(await coreWander(deps, new Date(now.getTime() + 4 * hour))).toEqual({
    status: "not_due",
    applied: false,
    ids: [],
  });
  expect(await traces(all)).toHaveLength(2);
});

test("a new local day resets the cap but preserves the prior day's gap", async () => {
  const { all, deps } = setup();
  await plan(deps);
  await plan(deps, "2026-01-06", true);
  await seed(deps);
  const late = new Date("2026-01-05T14:59:59Z"); // 22:59:59 local
  expect((await coreWander(deps, late)).applied).toBe(true);
  expect(await coreWander(deps, new Date("2026-01-05T16:00:00Z"))).toEqual({
    status: "not_due",
    applied: false,
    ids: [],
  });
  expect((await coreWander(deps, new Date("2026-01-05T17:59:59Z"))).applied).toBe(true);
  expect(await traces(all)).toHaveLength(2);
});

test("overlapping invocations consume at most one slot", async () => {
  const { all, deps } = setup();
  await plan(deps);
  await seed(deps);
  let entered = 0;
  let release!: () => void;
  let bothEntered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    bothEntered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  all.llm.handlers.core_wander = async () => {
    if (++entered === 2) bothEntered();
    await gate;
    return { items: [item] };
  };
  const pending = [coreWander(deps, now), coreWander(deps, now)];
  await waiting;
  release();
  const results = await Promise.all(pending);
  expect(results.filter((value) => value.applied)).toHaveLength(1);
  expect(
    (await traces(all)).filter((row) => (row.outputs as { applied: boolean }).applied),
  ).toHaveLength(1);
});

test("hypothetical is marked unreal and excluded from factual near search", async () => {
  const { all, deps } = setup();
  await plan(deps);
  await seed(deps);
  all.llm.handlers.core_wander = () => ({
    items: [
      { kind: "hypothetical", content: "What if the stars could answer?", salience: "medium" },
    ],
  });
  expect((await coreWander(deps, now)).applied).toBe(true);
  const [hypothesis] = await thoughts(all);
  expect(hypothesis).toMatchObject({ kind: "hypothetical", payload: { unreal: true } });
  expect(await deps.core.memory.near(hypothesis!.embedding, 10, 0.99)).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ id: hypothesis!.id })]),
  );
});

test("invalid batch or failed embedding writes nothing and traces failure", async () => {
  for (const failure of ["batch", "embedding"] as const) {
    await resetDb();
    const { all, deps } = setup();
    await plan(deps);
    await seed(deps);
    if (failure === "batch")
      all.llm.handlers.core_wander = () => ({ items: [item, { ...item, content: " " }] });
    else vi.spyOn(deps.embedder, "embed").mockRejectedValue(new Error("embed failed"));
    await expect(coreWander(deps, now)).rejects.toThrow();
    expect(await thoughts(all)).toHaveLength(0);
    expect(await traces(all)).toMatchObject([{ status: "failed" }]);
  }
});

test("extra wander items beyond the limit are dropped, not a failed run", async () => {
  const { all, deps } = setup();
  await plan(deps);
  await seed(deps);
  const max = deps.config.core.wander.max_items;
  all.llm.handlers.core_wander = () => ({
    items: Array.from({ length: max + 1 }, (_, i) => ({
      ...item,
      content: `Thought number ${i}.`,
    })),
  });
  const result = await coreWander(deps, now);
  expect(result.applied).toBe(true);
  expect(result.ids).toHaveLength(max);
});

const cfg = loadConfig().core.wander;
const baseItem: CoreMemoryItem = {
  id: "x",
  kind: "episode",
  content: "Spica found an old film.",
  payload: {},
  entity_refs: [],
  occurred_at: now,
  created_at: now,
  last_recalled_at: null,
  status: "resolved",
  salience: 0.5,
  valence: 0,
  depth: 1,
  source: "world",
  source_ref: null,
};

test("a memory her recent wanderings already used is drawn less", () => {
  const m = (id: string) => ({ ...baseItem, id });
  const cues = [{ kind: "memory" as const, items: [m("a"), m("b")] }];
  const rolls = Array.from({ length: 200 }, (_, i) => i / 200);
  const picks = (used: string[]) =>
    rolls.filter((r) => pickCue(cues, new Set(used), r, cfg)?.id === "a").length;
  expect(picks(["a"])).toBeLessThan(picks([]));
});

test("no cue at all → null (wander skips)", () => {
  expect(pickCue([], new Set(), 0.5, cfg)).toBeNull();
});

test("an old memory can start a wandering, and a thought never does", async () => {
  const { all, deps } = setup();
  await plan(deps);
  const old = await seed(deps, "Spica watched Stalker last month.", { created: before(24 * 30) });
  await deps.core.memory.insert({
    kind: "thought",
    content: "the wanting does the work",
    payload: {},
    embedding: vec(),
    entity_refs: [],
    occurred_at: before(1),
    created_at: before(1),
    status: "open",
    salience: 1,
    valence: 0.5,
    confidence: 1,
    source: "loop",
    source_ref: "core_wander:t",
  });
  expect(await coreWander(deps, now)).toMatchObject({ applied: true });
  const mine = (await thoughts(all)).filter((t) => t.content !== "the wanting does the work");
  expect(mine[0]?.payload).toMatchObject({ seed: old });
});

test("the chain is lived memory only: her thoughts and opinions never join it", async () => {
  const { all, deps } = setup();
  await plan(deps);
  const picked = await seed(deps, "the central memory", { salience: 1, created: before(0.5) });
  const loop = (kind: "thought" | "idea" | "opinion" | "insight", content: string) =>
    deps.core.memory.insert({
      kind,
      content,
      payload: {},
      embedding: vec(),
      entity_refs: [],
      occurred_at: before(2),
      created_at: before(2),
      status: "recurring",
      salience: 0.01,
      valence: 0.5,
      confidence: 1,
      source: "loop",
      source_ref: "core_reflect:t",
    });
  await loop("thought", "the anger was never about orion");
  await loop("idea", "maybe the posts just need to exist");
  await loop("opinion", "impatience with learning: grinding yourself down");
  await loop("insight", "she treats her beginning like a failure");
  const lived = [
    await seed(deps, "lived one", { salience: 0.01, created: before(3) }),
    await seed(deps, "lived two", { salience: 0.01, created: before(4) }),
    await seed(deps, "lived three", { salience: 0.01, created: before(5) }),
  ];
  expect((await coreWander(deps, now)).applied).toBe(true);
  const payload = (await thoughts(all)).find((t) => t.source_ref?.startsWith("core_wander:"))!
    .payload as { seed: string; chain: string[] };
  expect(payload.seed).toBe(picked);
  expect([...payload.chain].sort()).toEqual([...lived].sort());
  const input = all.llm.structuredCalls[0]!.input;
  for (const text of ["orion", "posts just need", "impatience", "beginning like a failure"])
    expect(input).not.toContain(text);
});

test("an opinion never starts a wandering", async () => {
  const { all, deps } = setup();
  await plan(deps);
  const episode = await seed(deps, "Spica watched Stalker last month.", {
    created: before(24 * 30),
  });
  await deps.core.memory.insert({
    kind: "opinion",
    content: "impatience with learning is grinding yourself down",
    payload: {},
    embedding: vec(),
    entity_refs: [],
    occurred_at: before(1),
    created_at: before(1),
    status: "recurring",
    salience: 1,
    valence: 0.5,
    confidence: 1,
    source: "loop",
    source_ref: "core_reflect:t",
  });
  expect(await coreWander(deps, now)).toMatchObject({ applied: true });
  const mine = (await thoughts(all)).filter((t) => t.source_ref?.startsWith("core_wander:"));
  expect(mine[0]?.payload).toMatchObject({ seed: episode });
});
