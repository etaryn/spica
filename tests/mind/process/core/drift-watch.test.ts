/** Drift diagnostics survive budget and judge failures without changing the snapshot. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { core_loop_trace, core_snapshot } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreDriftWatch } from "@/mind/process/core/drift-watch";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");
const axis = (i: number) => Array.from({ length: 1024 }, (_, n) => Number(n === i));

async function snapshot(
  all: ReturnType<typeof makeTestDeps>,
  version: number,
  embedding: number[] | null,
  sections: Record<string, string>,
) {
  await all.db.insert(core_snapshot).values({
    version,
    content: Object.entries(sections)
      .map(([name, text]) => `### ${name}\n${text}`)
      .join("\n\n"),
    sections,
    embedding,
    source_ids: [],
    rendered_at: now,
    model: "test",
    prompt_version: "v1",
  });
}

async function pair(all: ReturnType<typeof makeTestDeps>, oldEmbedding: number[] | null = axis(0)) {
  await snapshot(all, 0, oldEmbedding, { Lately: "before", Opinions: "steady" });
  await snapshot(all, 1, axis(1), { Lately: "after", Opinions: "steady" });
}

test("writes an ok value verdict, cosine diff and trend, and changed-section share", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await pair(all);
  expect(await coreDriftWatch(deps, now, 1)).toBe("done");
  const rows = await deps.core.drift.forVersion(1);
  expect(rows).toHaveLength(3);
  expect(rows.find((row) => row.check === "values")).toMatchObject({ verdict: "ok" });
  expect(rows.find((row) => row.check === "diff")).toMatchObject({
    score: 1,
    excerpt: "1/2 sections changed (50%)",
  });
  expect(rows.find((row) => row.check === "trend")?.score).toBeCloseTo(1);
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([
    { loop: "core_drift_watch", status: "done", calls: 1 },
  ]);
  expect(all.llm.structuredCalls[0]).toMatchObject({ purpose: "core_drift_watch" });
});

test("writes one values row per finding and leaves the snapshot available", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await pair(all);
  all.llm.handlers.core_drift_watch = () => ({
    findings: [
      { value: "Honesty", excerpt: "a quoted claim", verdict: "contradicts" },
      { value: "Curiosity", excerpt: "a narrow habit", verdict: "strains" },
    ],
  });
  expect(await coreDriftWatch(deps, now, 1)).toBe("done");
  expect((await deps.core.drift.forVersion(1)).filter((row) => row.check === "values")).toEqual(
    expect.arrayContaining(
      [
        { value: "Honesty", excerpt: "a quoted claim", verdict: "contradicts" },
        { value: "Curiosity", excerpt: "a narrow habit", verdict: "strains" },
      ].map((finding) => expect.objectContaining(finding)),
    ),
  );
  expect((await deps.core.memory.latestSnapshot())?.version).toBe(1);
});

test("omits distance rows when a historical embedding is null", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await pair(all, null);
  expect(await coreDriftWatch(deps, now, 1)).toBe("done");
  expect((await deps.core.drift.forVersion(1)).map((row) => row.check)).toEqual(["values"]);
});

test("trend compares with v0 rather than the immediately previous snapshot", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await pair(all);
  await snapshot(all, 2, axis(0), { Lately: "back", Opinions: "steady" });
  expect(await coreDriftWatch(deps, now, 2)).toBe("done");
  const rows = await deps.core.drift.forVersion(2);
  expect(rows.find((row) => row.check === "diff")?.score).toBeCloseTo(1);
  expect(rows.find((row) => row.check === "trend")?.score).toBeCloseTo(0);
});

test("persists code diagnostics even when the budget skips the judge", async () => {
  const all = makeTestDeps({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  const deps = coreDepsOf(all);
  await pair(all);
  expect(await coreDriftWatch(deps, now, 1)).toBe("skipped_budget");
  expect((await deps.core.drift.forVersion(1)).map((row) => row.check).sort()).toEqual([
    "diff",
    "trend",
  ]);
  expect(all.llm.structuredCalls).toHaveLength(0);
});

test("invalid judge output leaves code diagnostics, no verdict and a failed trace", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await pair(all);
  all.llm.handlers.core_drift_watch = () => ({ findings: [{ verdict: "ok" }] });
  await expect(coreDriftWatch(deps, now, 1)).rejects.toThrow();
  expect((await deps.core.drift.forVersion(1)).map((row) => row.check).sort()).toEqual([
    "diff",
    "trend",
  ]);
  expect((await deps.core.memory.latestSnapshot())?.version).toBe(1);
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([
    { loop: "core_drift_watch", status: "failed", calls: 1 },
  ]);
});

test("judge failure leaves code diagnostics and a failed trace", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await pair(all);
  all.llm.handlers.core_drift_watch = () => {
    throw new Error("judge unavailable");
  };
  await expect(coreDriftWatch(deps, now, 1)).rejects.toThrow("judge unavailable");
  expect((await deps.core.drift.forVersion(1)).map((row) => row.check).sort()).toEqual([
    "diff",
    "trend",
  ]);
  expect((await deps.core.memory.latestSnapshot())?.version).toBe(1);
});

test("does not run without a new version or duplicate checks on repeated calls", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await snapshot(all, 0, axis(0), { Lately: "seed" });
  expect(await coreDriftWatch(deps, now, 0)).toBe("done");
  expect(await coreDriftWatch(deps, now, 1)).toBe("done");
  expect(await deps.core.drift.forVersion(0)).toEqual([]);
  expect(all.llm.structuredCalls).toHaveLength(0);
  await snapshot(all, 1, axis(1), { Lately: "new" });
  await coreDriftWatch(deps, now, 1);
  await coreDriftWatch(deps, now, 1);
  expect(await deps.core.drift.forVersion(1)).toHaveLength(3);
  expect(all.llm.structuredCalls).toHaveLength(1);
});
