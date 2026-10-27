/** Shared core thought preparation and storage: validation, dedupe, and persisted provenance. */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { core_memory } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { prepareThoughts, storeThoughts, type PreparedThought } from "@/mind/process/core/thoughts";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T09:00:00Z");
const meta = {
  loop: "core_wander" as const,
  traceId: "run-123",
  now,
  valence: -0.4,
  payload: { seed: "a-memory" },
  entityRefs: [] as string[],
};

test("preparation trims content and supplies a correctly sized embedding", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const prepared = await prepareThoughts(deps, [
    { kind: "idea", content: "  Read the old letter  ", salience: "medium" },
  ]);
  expect(prepared).toHaveLength(1);
  expect(prepared[0]!.item).toEqual({
    kind: "idea",
    content: "Read the old letter",
    salience: "medium",
    depth: null,
  });
  expect(prepared[0]!.embedding).toHaveLength(deps.config.embedding.dimensions);
});

test("similarity exactly 0.92 survives; greater similarity drops", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  const prepared: PreparedThought[] = [
    { item: { kind: "thought", content: "At the boundary", salience: "low" }, embedding: vec() },
  ];
  let similarity = 0.92;
  const first = await deps.core.transaction((tx) =>
    storeThoughts(
      {
        ...tx,
        memory: {
          ...tx.memory,
          dedupeNear: async () => [
            { id: "near", content: "near", status: "recurring", sim: similarity },
          ],
        },
      },
      deps,
      prepared,
      meta,
    ),
  );
  similarity = 0.920001;
  const second = await deps.core.transaction((tx) =>
    storeThoughts(
      {
        ...tx,
        memory: {
          ...tx.memory,
          dedupeNear: async () => [
            { id: "near", content: "near", status: "recurring", sim: similarity },
          ],
        },
      },
      deps,
      [
        {
          item: { kind: "idea", content: "Just too similar", salience: "medium" },
          embedding: vec(),
        },
      ],
      meta,
    ),
  );
  expect(first.ids).toHaveLength(1);
  expect(first.dropped).toEqual([]);
  expect(second).toEqual({ ids: [], dropped: ["Just too similar"] });
  expect(await all.db.select().from(core_memory)).toMatchObject([
    {
      id: first.ids[0],
      content: "At the boundary",
      kind: "thought",
      status: "recurring",
      source: "loop",
      source_ref: "core_wander:run-123",
      salience: 0.25,
      confidence: 0.6,
      valence: -0.4,
      payload: { seed: "a-memory" },
      occurred_at: now,
      created_at: now,
    },
  ]);
});

test("an accepted item in the same batch dedupes later items", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  const prepared: PreparedThought[] = [
    {
      item: { kind: "hypothetical", content: "What if she left?", salience: "medium" },
      embedding: vec(),
    },
    { item: { kind: "idea", content: "Maybe she leaves", salience: "low" }, embedding: vec() },
  ];
  const result = await deps.core.transaction((tx) => storeThoughts(tx, deps, prepared, meta));
  expect(result.ids).toHaveLength(1);
  expect(result.dropped).toEqual(["Maybe she leaves"]);
  expect(await all.db.select().from(core_memory)).toMatchObject([
    { id: result.ids[0], kind: "hypothetical", content: "What if she left?", status: "recurring" },
  ]);
});

test("invalid content rejects the whole proposal before embedding or writing", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  const embed = vi.spyOn(deps.embedder, "embed");
  await expect(
    prepareThoughts(deps, [
      { kind: "thought", content: "valid", salience: "low" },
      { kind: "idea", content: "   ", salience: "medium" },
    ]),
  ).rejects.toThrow();
  expect(embed).not.toHaveBeenCalled();
  expect(await all.db.select().from(core_memory)).toHaveLength(0);
});

test("a malformed embedding rejects the batch before the first write", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  vi.spyOn(deps.embedder, "embed").mockResolvedValue([vec(), vec().map(() => 0)]);
  await expect(
    prepareThoughts(deps, [
      { kind: "thought", content: "first", salience: "low" },
      { kind: "idea", content: "second", salience: "medium" },
    ]),
  ).rejects.toThrow();
  const prepared: PreparedThought[] = [
    { item: { kind: "thought", content: "first", salience: "low" }, embedding: vec() },
    { item: { kind: "idea", content: "second", salience: "medium" }, embedding: [Number.NaN] },
  ];
  await expect(
    deps.core.transaction((tx) => storeThoughts(tx, deps, prepared, meta)),
  ).rejects.toThrow();
  expect(await all.db.select().from(core_memory)).toHaveLength(0);
});

test("overlong content is shortened to the line limit instead of rejecting the batch", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const max = deps.config.core.loops.max_chars;
  const [prepared] = await prepareThoughts(deps, [
    { kind: "thought", content: "x".repeat(max + 50), salience: "low" },
  ]);
  expect(prepared!.item.content).toHaveLength(max);
  expect(prepared!.item.content.endsWith("…")).toBe(true);
});

test("a thought keeps its judged depth; without one it takes its kind's default", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  const prepared = await prepareThoughts(deps, [
    { kind: "thought", content: "Alcor never calls first", salience: "low", depth: "intimate" },
    { kind: "thought", content: "The rain sounds like static", salience: "low" },
  ]);
  const { ids } = await deps.core.transaction((tx) => storeThoughts(tx, deps, prepared, meta));
  expect((await deps.core.memory.get(ids[0]!))!.depth).toBe(3);
  expect((await deps.core.memory.get(ids[1]!))!.depth).toBe(all.config.core.depth.by_kind.thought);
});

const tomorrowNight = {
  field: "thought",
  words: "tomorrow night",
  from: "",
  unit: "day" as const,
  shift: 1,
  weekday: null,
  month: null,
  day_of_month: null,
  part: "night" as const,
  clock: "",
  span: "at" as const,
  rough: false,
};

test("a thought's time words and citation become tokens, and a full-length thought is never cut after", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  const max = deps.config.core.loops.max_chars;
  const cited = {
    id: "m1",
    ref: "mem-1",
    kind: "memory" as const,
    text: "⟦2026-01-03|day|UTC⟧",
    owner: null,
    at: new Date("2026-01-03T12:00:00Z"),
  };
  const long = `Solaris [m1] again tomorrow night ${"x".repeat(max)}`;
  const [prepared] = await prepareThoughts(
    deps,
    [{ kind: "thought", content: long, salience: "low" }],
    { times: [tomorrowNight], citables: [cited], now, zone: "UTC", fields: ["thought"] },
  );
  // Monday the 5th: "tomorrow night" said with its words kept is Tuesday's night.
  expect(
    prepared!.item.content.startsWith(
      "Solaris (⟦2026-01-03|day|UTC⟧) again ⟦2026-01-06|night|UTC|tomorrow night⟧",
    ),
  ).toBe(true);
  expect(prepared!.item.content.length).toBeGreaterThan(max);
  expect(prepared!.cites).toEqual(["mem-1"]);
  const { ids } = await deps.core.transaction((tx) => storeThoughts(tx, deps, [prepared!], meta));
  const row = await deps.core.memory.get(ids[0]!);
  expect(row!.content).toBe(prepared!.item.content);
  expect(row!.payload).toEqual({ seed: "a-memory", cites: ["mem-1"] });
});
