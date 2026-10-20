/** Snapshot versions and their retrieval lines advance together from core-only evidence. */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { core_snapshot, core_loop_trace } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { coreRenderSnapshot } from "@/mind/process/core/render-snapshot";
import { snapshotSection } from "@/mind/memory/core/depth";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");
const names = ["Lately", "Opinions", "Interests", "Goals", "People", "Habits of speech"];

test("render writes six sections, embeddings, bullet lines, provenance and N+1 atomically", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await seedSnapshot(deps);
  expect(await coreRenderSnapshot(deps, now)).toBe("done");
  const snapshot = (await deps.core.memory.latestSnapshot())!;
  expect(snapshot.version).toBe(1);
  expect(Object.keys(snapshot.sections).sort()).toEqual([...names].sort());
  for (const name of names) expect(snapshot.content).toContain(`### ${name}\n`);
  expect(snapshot.embedding).toHaveLength(1024);
  expect(snapshot.sections["Habits of speech"]).toContain("okay but");
  const lines = await deps.core.memory.selfLines(1);
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.every((line) => line.embedding.length === 1024)).toBe(true);
  expect(snapshot).toMatchObject({ model: all.config.models.core, prompt_version: "v2" });
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([{ status: "done", calls: 1 }]);
});

test("seed backfills historical v0 and fixed lines once without replacing content", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await all.db.insert(core_snapshot).values({
    version: 0,
    content: "### Lately\n- Historical self.",
    sections: {},
    source_ids: [],
    rendered_at: now,
    model: "seed",
    prompt_version: "v6",
  });
  expect(await seedSnapshot(deps)).toBe(false);
  const before = await deps.core.memory.snapshot(0);
  const fixed = await deps.core.memory.selfLines(null);
  const lines = await deps.core.memory.selfLines(0);
  expect(before?.embedding).toHaveLength(1024);
  expect(lines.map((line) => line.text)).toEqual(["Historical self."]);
  expect(fixed.length).toBeGreaterThan(0);
  await seedSnapshot(deps);
  expect(await deps.core.memory.snapshot(0)).toEqual(before);
  expect(await deps.core.memory.selfLines(null)).toEqual(fixed);
  expect(await deps.core.memory.selfLines(0)).toEqual(lines);
});

test("invalid output and failed embeddings preserve the previous snapshot and lines", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await seedSnapshot(deps);
  const prior = await deps.core.memory.latestSnapshot();
  const lines = await deps.core.memory.selfLines(0);
  const handler = all.llm.handlers.core_render_snapshot;
  all.llm.handlers.core_render_snapshot = () => ({ Lately: ["Incomplete"] });
  await expect(coreRenderSnapshot(deps, now)).rejects.toThrow();
  all.llm.handlers.core_render_snapshot = handler!;
  vi.spyOn(deps.embedder, "embed").mockRejectedValueOnce(new Error("embedding failed"));
  await expect(coreRenderSnapshot(deps, now)).rejects.toThrow("embedding failed");
  expect(await deps.core.memory.latestSnapshot()).toEqual(prior);
  expect(await deps.core.memory.selfLines(0)).toEqual(lines);
});

test("concurrent renders based on the same version write only one successor", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await seedSnapshot(deps);
  const original = all.llm.handlers.core_render_snapshot!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  all.llm.handlers.core_render_snapshot = async (input) => {
    if (++calls === 2) release();
    await gate;
    return original(input);
  };
  const statuses = await Promise.all([
    coreRenderSnapshot(deps, now),
    coreRenderSnapshot(deps, now),
  ]);
  expect(statuses.sort()).toEqual(["done", "fallback"]);
  expect((await deps.core.memory.latestSnapshot())?.version).toBe(1);
});

test("context is bounded and omits transient state", async () => {
  const all = makeTestDeps({ core: { snapshot: { max_items: 1 } } });
  const deps = coreDepsOf(all);
  await seedSnapshot(deps);
  await deps.core.memory.addEntities(["Alcor", "Another"], 0.5, now);
  await coreRenderSnapshot(deps, now);
  const input = JSON.parse(all.llm.structuredCalls[0]!.input);
  expect(input.people).toHaveLength(1);
  expect(input).not.toHaveProperty("state");
  expect(input).not.toHaveProperty("mood");
  expect(input).not.toHaveProperty("energy");
});

test("insights come from since the previous render, newest first regardless of salience", async () => {
  const all = makeTestDeps({ core: { snapshot: { max_items: 1 } } });
  const deps = coreDepsOf(all);
  await seedSnapshot(deps);
  for (const [content, offset, salience] of [
    ["old", -1000, 1],
    ["older new", 1000, 1],
    ["newest", 2000, 0.1],
  ] as const) {
    await deps.core.memory.insert({
      kind: "insight",
      content,
      embedding: Array(1024).fill(0.1),
      occurred_at: now,
      created_at: new Date(now.getTime() + offset),
      status: "recurring",
      salience,
      valence: 0,
      confidence: 0.5,
      source: "loop",
      source_ref: null,
    });
  }
  await coreRenderSnapshot(deps, new Date(now.getTime() + 3000));
  expect(
    JSON.parse(all.llm.structuredCalls[0]!.input).insights.map(
      (item: { content: string }) => item.content,
    ),
  ).toEqual(["newest"]);
});

test("failure while writing self lines rolls back the snapshot and success trace", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await seedSnapshot(deps);
  const original = deps.core.transaction.bind(deps.core);
  vi.spyOn(deps.core, "transaction").mockImplementation((fn) =>
    original(async (tx) => {
      tx.memory.insertSelfLines = async () => {
        throw new Error("line write failed");
      };
      return fn(tx);
    }),
  );
  await expect(coreRenderSnapshot(deps, now)).rejects.toThrow("line write failed");
  expect((await deps.core.memory.latestSnapshot())?.version).toBe(0);
  expect(await deps.core.memory.selfLines(1)).toHaveLength(0);
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([{ status: "failed" }]);
});

test("an overfilled section is trimmed to its bounds instead of failing the night", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await seedSnapshot(deps);
  const { max_items } = all.config.core.snapshot;
  const maxChars = all.config.core.loops.max_chars;
  const handler = all.llm.handlers.core_render_snapshot!;
  all.llm.handlers.core_render_snapshot = (input) => ({
    ...(handler(input) as object),
    Opinions: Array.from({ length: max_items + 2 }, (_, i) => ({
      text: `Opinion ${i}.`,
      depth: null,
    })),
    Lately: [{ text: `${"long ".repeat(maxChars)}\nsecond line`, depth: null }],
  });
  expect(await coreRenderSnapshot(deps, now)).toBe("done");
  const snapshot = (await deps.core.memory.latestSnapshot())!;
  expect(snapshot.sections.Opinions!.split("\n")).toHaveLength(max_items);
  expect(snapshot.sections.Lately!.length).toBeLessThanOrEqual(maxChars + 2);
  expect(snapshot.sections.Lately).not.toContain("\nsecond");
});

test("each rendered line keeps its depth; an untagged line takes its section's default", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await seedSnapshot(deps);
  all.llm.handlers.core_render_snapshot = () => ({
    Lately: [{ text: "misses Alcor more than she says", depth: "intimate" }],
    Opinions: [{ text: "Solaris is overrated", depth: null }],
    Interests: [],
    Goals: [],
    People: [],
    "Habits of speech": [],
  });
  expect(await coreRenderSnapshot(deps, now)).toBe("done");
  const snapshot = (await deps.core.memory.latestSnapshot())!;
  const lines = await deps.core.memory.selfLines(snapshot.version);
  expect(lines.find((l) => l.text.startsWith("misses"))!.depth).toBe(3);
  expect(lines.find((l) => l.text.startsWith("Solaris"))!.depth).toBe(
    all.config.core.depth.by_section.Opinions,
  );
  expect(snapshot.content).toContain("### Lately\n- misses Alcor more than she says");
});

test("an emptied section keeps last night's lines, here the seed self on night 1", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await seedSnapshot(deps);
  const content = (await deps.core.memory.latestSnapshot())!.content;
  const seed = {
    Lately: snapshotSection(content, "Lately"),
    Goals: snapshotSection(content, "Goals"),
  };
  expect(seed.Lately?.length).toBeGreaterThan(0);
  all.llm.handlers.core_render_snapshot = () => ({
    Lately: [],
    Opinions: [{ text: "Solaris is overrated", depth: null }],
    Interests: [],
    Goals: [],
    People: [],
    "Habits of speech": [],
  });
  expect(await coreRenderSnapshot(deps, now)).toBe("done");
  const snap = (await deps.core.memory.latestSnapshot())!;
  expect(snapshotSection(snap.content, "Lately")).toEqual(seed.Lately);
  expect(snapshotSection(snap.content, "Goals")).toEqual(seed.Goals);
  expect(snap.sections.Opinions).toBe("- Solaris is overrated");
  expect(snap.sections.People).toBe("");
  const lines = (await deps.core.memory.selfLines(snap.version)).map((l) => l.text);
  for (const kept of seed.Lately!) expect(lines).toContain(kept);
});

test("a kept line keeps the depth it had, so an intimate line never widens", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await seedSnapshot(deps);
  const empty = {
    Lately: [],
    Opinions: [],
    Interests: [],
    Goals: [],
    People: [],
    "Habits of speech": [],
  };
  all.llm.handlers.core_render_snapshot = () => ({
    ...empty,
    Opinions: [{ text: "she trusts Alcor more than anyone", depth: "intimate" }],
  });
  await coreRenderSnapshot(deps, now);
  all.llm.handlers.core_render_snapshot = () => ({
    ...empty,
    Lately: [{ text: "new", depth: null }],
  });
  await coreRenderSnapshot(deps, new Date(now.getTime() + 86_400_000));
  const snap = (await deps.core.memory.latestSnapshot())!;
  expect(snap.version).toBe(2);
  const kept = (await deps.core.memory.selfLines(2)).find((l) => l.text.startsWith("she trusts"));
  expect(kept?.depth).toBe(3);
});
