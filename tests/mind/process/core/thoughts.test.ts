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
