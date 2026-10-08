/** Nightly core consolidation decays memory and condenses old episodes once. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { core_loop_trace, core_memory } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreConsolidate } from "@/mind/process/core/consolidate";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-20T03:00:00Z");
const old = new Date("2026-01-05T09:00:00Z");

function setup(overrides: unknown = {}) {
  const all = makeTestDeps(overrides);
  const deps = coreDepsOf(all);
  all.llm.handlers.core_consolidate = () => ({ gist: "She kept returning to those films." });
  return { all, deps };
}

async function item(
  deps: ReturnType<typeof setup>["deps"],
  content: string,
  options: Partial<{
    kind: "episode" | "intention" | "narrative";
    status: "resolved" | "open" | "recurring";
    at: Date;
    salience: number;
  }> = {},
) {
  return deps.core.memory.insert({
    kind: options.kind ?? "episode",
    content,
    embedding: vec(),
    occurred_at: options.at ?? old,
    created_at: options.at ?? old,
    status: options.status ?? "resolved",
    salience: options.salience ?? 0.5,
    valence: 0,
    confidence: 0.6,
    source: "loop",
    source_ref: null,
  });
}

test("decays untouched memory even with no gist and traces zero calls", async () => {
  const { all, deps } = setup();
  const id = await item(deps, "A solitary old episode.");
  expect(await coreConsolidate(deps, now)).toBe("done");
  expect((await deps.core.memory.get(id))?.salience).toBeCloseTo(0.48);
  expect(all.llm.structuredCalls).toHaveLength(0);
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([{ status: "done", calls: 0 }]);
});

test("decay uses the exact three-day grace interval, not local midnight", async () => {
  const { deps } = setup();
  const before = await item(deps, "Before the exact cutoff.", {
    at: new Date("2026-01-16T21:00:00Z"), // Jan 17, 05:00 in Singapore.
  });
  const after = await item(deps, "After the exact cutoff.", {
    at: new Date("2026-01-17T04:00:00Z"), // Jan 17, 12:00 in Singapore.
  });
  await coreConsolidate(deps, now); // Jan 20, 11:00 in Singapore.
  expect((await deps.core.memory.get(before))?.salience).toBeCloseTo(0.48);
  expect((await deps.core.memory.get(after))?.salience).toBe(0.5);
});

test("a decay error writes one failed zero-call trace", async () => {
  const { all, deps } = setup();
  deps.core.memory.decay = async () => {
    throw new Error("decay unavailable");
  };
  await expect(coreConsolidate(deps, now)).rejects.toThrow("decay unavailable");
  expect(all.llm.structuredCalls).toHaveLength(0);
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([
    { loop: "core_consolidate", status: "failed", calls: 0, error: "Error" },
  ]);
});

test("exhausted budget still applies decay and traces skipped_budget", async () => {
  const { all, deps } = setup({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  const id = await item(deps, "An old episode.");
  expect(await coreConsolidate(deps, now)).toBe("skipped_budget");
  expect((await deps.core.memory.get(id))?.salience).toBeCloseTo(0.48);
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([
    { status: "skipped_budget", calls: 0 },
  ]);
});

test("open intention and latest narrative are exempt from decay", async () => {
  const { deps } = setup();
  const intention = await item(deps, "A plan.", { kind: "intention", status: "open" });
  const narrative = await item(deps, "Latest story.", { kind: "narrative", status: "recurring" });
  await coreConsolidate(deps, now);
  expect((await deps.core.memory.get(intention))?.salience).toBe(0.5);
  expect((await deps.core.memory.get(narrative))?.salience).toBe(0.5);
});

test("current preoccupation is exempt from decay", async () => {
  const { deps } = setup();
  const id = await item(deps, "An absorbing memory.");
  await deps.core.state.ensure(
    { mood_valence: 0, mood_arousal: 0, energy: 0.5 },
    { autonomy: 0.5, competence: 0.5 },
  );
  await deps.core.state.update({ preoccupation: id, preoccupation_since: now });
  await coreConsolidate(deps, now);
  expect((await deps.core.memory.get(id))?.salience).toBe(0.5);
});

test("fewer than three resolved old episodes in one local week need no gist", async () => {
  const { all, deps } = setup();
  await item(deps, "First episode.");
  await item(deps, "Second episode.");
  await item(deps, "Different week.", { at: new Date("2025-12-29T09:00:00Z") });
  await item(deps, "Unresolved.", { status: "open" });
  await item(deps, "Too recent.", { at: new Date("2026-01-18T09:00:00Z") });
  expect(await coreConsolidate(deps, now)).toBe("done");
  expect(all.llm.structuredCalls).toHaveLength(0);
});

test("only the oldest eligible week is gisted in one run", async () => {
  const { all, deps } = setup();
  for (let i = 0; i < 3; i++) {
    await item(deps, `First week ${i}`, { at: new Date("2025-12-29T09:00:00Z") });
    await item(deps, `Second week ${i}`);
  }
  expect(await coreConsolidate(deps, now)).toBe("done");
  expect(all.llm.structuredCalls).toHaveLength(1);
  const gists = (await all.db.select().from(core_memory)).filter((row) =>
    row.source_ref?.startsWith("core_consolidate:"),
  );
  expect(gists).toHaveLength(1);
  expect(gists[0]?.occurred_at).toEqual(new Date("2025-12-29T09:00:00Z"));
});

test("one qualifying local-week group yields a gist and damps each source once", async () => {
  const { all, deps } = setup();
  const ids = [
    await item(deps, "First film.", { salience: 0.4 }),
    await item(deps, "Second film.", { salience: 0.8 }),
    await item(deps, "Third film.", { salience: 0.6 }),
  ];
  expect(await coreConsolidate(deps, now)).toBe("done");
  const rows = await all.db.select().from(core_memory);
  const gist = rows.find((row) => row.source_ref?.startsWith("core_consolidate:"))!;
  expect(gist).toMatchObject({
    content: "She kept returning to those films.",
    kind: "episode",
    status: "recurring",
    valence: 0,
    confidence: 0.6,
    occurred_at: old,
    created_at: now,
  });
  expect(gist.salience).toBeCloseTo(0.7872);
  expect((gist.payload as { gist_of: string[] }).gist_of).toEqual(expect.arrayContaining(ids));
  expect(all.llm.structuredCalls).toHaveLength(1);
  expect(all.llm.structuredCalls[0]?.purpose).toBe("core_consolidate");
  for (const [index, id] of ids.entries()) {
    const source = await deps.core.memory.get(id);
    expect(source?.payload).toMatchObject({ gisted_into: gist.id });
    expect(source?.salience).toBeCloseTo([0.1904, 0.3936, 0.2904][index]!);
  }
  expect(await coreConsolidate(deps, now)).toBe("done");
  expect(
    (await all.db.select().from(core_memory)).filter(
      (row) => row.payload && (row.payload as { gist_of?: unknown }).gist_of,
    ),
  ).toHaveLength(1);
  expect((await deps.core.memory.get(ids[0]!))?.salience).toBeCloseTo(
    0.1904 * (1 - 0.08 * (1 - 0.1904)),
  );
});

test("invalid gist output keeps decay and records fallback", async () => {
  const { all, deps } = setup();
  for (let i = 0; i < 3; i++) await item(deps, `Film ${i}`);
  all.llm.handlers.core_consolidate = () => ({ gist: "" });
  expect(await coreConsolidate(deps, now)).toBe("fallback");
  expect(await all.db.select().from(core_memory)).toHaveLength(3);
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([{ status: "fallback" }]);
});

test("a loop failure after source damping rolls back gist and markers but retains decay", async () => {
  const { all, deps } = setup();
  const ids = [await item(deps, "One"), await item(deps, "Two"), await item(deps, "Three")];
  const transaction = deps.core.transaction;
  deps.core.transaction = (apply) =>
    transaction(async (tx) =>
      apply({
        ...tx,
        memory: {
          ...tx.memory,
          gistSources: async (...args) => {
            const updated = await tx.memory.gistSources(...args);
            if (updated) throw new Error("after source update");
            return updated;
          },
        },
      }),
    );
  await expect(coreConsolidate(deps, now)).rejects.toThrow("after source update");
  expect(await all.db.select().from(core_memory)).toHaveLength(3);
  for (const id of ids) {
    expect(await deps.core.memory.get(id)).toMatchObject({ payload: null });
    expect((await deps.core.memory.get(id))?.salience).toBeCloseTo(0.48);
  }
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([
    { loop: "core_consolidate", status: "failed", calls: 1 },
  ]);
});

test("an overlong gist is shortened instead of failing consolidation", async () => {
  const { all, deps } = setup();
  for (let i = 0; i < 3; i++) await item(deps, `Episode ${i}`);
  all.llm.handlers.core_consolidate = () => ({ gist: "word ".repeat(200) });
  expect(await coreConsolidate(deps, now)).toBe("done");
  const [gist] = (await all.db.select().from(core_memory)).filter((row) => row.payload !== null);
  expect(gist!.content.length).toBe(all.config.core.loops.max_chars);
  expect(gist!.content.endsWith("…")).toBe(true);
});
