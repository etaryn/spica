/**
 * The core loop runner: one trace per run with the calls actually made, a daily budget that resets
 * at her midnight, a reserve the optional loops can't touch, and failures traced then rethrown.
 */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { asc } from "drizzle-orm";
import { core_loop_trace, core_memory } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { budgetDayStart, runCoreLoop, type LoopContext } from "@/mind/process/core/runner";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T09:00:00Z");
const cfg = { core: { daily_call_budget: 3, budget_reserve: 1 } };

function setup(overrides: unknown = cfg) {
  const all = makeTestDeps(overrides);
  all.llm.handlers.probe = () => ({ ok: true });
  return { all, deps: coreDepsOf(all) };
}

const probe = (ctx: LoopContext) =>
  ctx.deps.llm.classifyJson({
    purpose: "probe",
    model: "core",
    system: "s",
    input: "i",
    schema: z.object({ ok: z.boolean() }),
    timeoutMs: 1000,
    maxTokens: 10,
  });

async function traces(all: ReturnType<typeof makeTestDeps>) {
  return all.db.select().from(core_loop_trace).orderBy(asc(core_loop_trace.created_at));
}

const thought = {
  kind: "thought" as const,
  content: "A trace and a thought land together.",
  embedding: vec(),
  occurred_at: now,
  created_at: now,
  status: "recurring" as const,
  salience: 0.25,
  valence: 0,
  confidence: 0.6,
  source: "loop" as const,
  source_ref: "core_wander:test",
};

test("a run writes one trace with the calls it made", async () => {
  const { all, deps } = setup();
  const out = await runCoreLoop(deps, "core_reflect", now, async (ctx) => {
    await probe(ctx);
    await probe(ctx);
    return { inputs: { a: 1 }, outputs: { b: 2 }, promptVersion: "v1" };
  });
  expect(out).toEqual({ status: "done", outputs: { b: 2 } });
  const [t] = await traces(all);
  expect(t).toMatchObject({
    loop: "core_reflect",
    calls: 2,
    status: "done",
    error: null,
    inputs: { a: 1 },
    outputs: { b: 2 },
    prompt_version: "v1",
    model: "fake",
  });
  expect(t!.created_at.getTime()).toBe(now.getTime());
});

test("an optional loop is skipped once only the reserve is left", async () => {
  const { all, deps } = setup();
  await runCoreLoop(deps, "core_reflect", now, async (ctx) => {
    await probe(ctx);
    await probe(ctx);
    return { inputs: {}, outputs: {} };
  });
  let ran = false;
  const out = await runCoreLoop(deps, "core_wander", now, async () => {
    ran = true;
    return { inputs: {}, outputs: {} };
  });
  expect(out).toEqual({ status: "skipped_budget", outputs: null });
  expect(ran).toBe(false);
  expect((await traces(all)).map((t) => t.status)).toEqual(["done", "skipped_budget"]);
});

test("a fallback loop still runs over budget, told it can't call", async () => {
  const { deps } = setup({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  const out = await runCoreLoop(deps, "core_appraise", now, async (ctx) => ({
    status: ctx.canCall() ? "done" : "fallback",
    inputs: {},
    outputs: { canCall: ctx.canCall() },
  }));
  expect(out).toEqual({ status: "fallback", outputs: { canCall: false } });
});

test("a skip loop over budget is skipped", async () => {
  const { deps } = setup({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  const out = await runCoreLoop(deps, "core_reflect", now, async () => ({
    inputs: {},
    outputs: {},
  }));
  expect(out.status).toBe("skipped_budget");
});

test("canCall counts calls made inside the run", async () => {
  const { deps } = setup({ core: { daily_call_budget: 1, budget_reserve: 0 } });
  const seen: boolean[] = [];
  await runCoreLoop(deps, "core_appraise", now, async (ctx) => {
    seen.push(ctx.canCall());
    await probe(ctx);
    seen.push(ctx.canCall());
    return { inputs: {}, outputs: {} };
  });
  expect(seen).toEqual([true, false]);
});

test("overlapping runs can't spend past the budget between them", async () => {
  const { all, deps } = setup({ core: { daily_call_budget: 2, budget_reserve: 0 } });
  let release!: () => void;
  const bothStarted = new Promise<void>((resolve) => (release = resolve));
  let started = 0;
  const run = () =>
    runCoreLoop(deps, "core_reflect", now, async (ctx) => {
      if (++started === 2) release();
      await bothStarted;
      await probe(ctx);
      await probe(ctx);
      return { inputs: {}, outputs: {} };
    });
  const results = await Promise.all([run(), run()]);
  expect(results.map((r) => r.status)).toContain("skipped_budget");
  expect((await traces(all)).reduce((sum, t) => sum + t.calls, 0)).toBe(2);
  expect(all.llm.structuredCalls).toHaveLength(2);
});

test("the budget resets at her local midnight", async () => {
  const { deps } = setup({ core: { daily_call_budget: 1, budget_reserve: 0 } });
  await runCoreLoop(deps, "core_reflect", now, async (ctx) => {
    await probe(ctx);
    return { inputs: {}, outputs: {} };
  });
  const tomorrow = new Date("2026-01-05T16:00:00Z");
  expect(budgetDayStart(deps.config, tomorrow).toISOString()).toBe("2026-01-05T16:00:00.000Z");
  const out = await runCoreLoop(deps, "core_reflect", tomorrow, async () => ({
    inputs: {},
    outputs: {},
  }));
  expect(out.status).toBe("done");
});

test("a failure is traced with its class and calls, then rethrown", async () => {
  const { all, deps } = setup();
  class BoomError extends Error {}
  await expect(
    runCoreLoop(deps, "core_reflect", now, async (ctx) => {
      await probe(ctx);
      throw new BoomError("secret content");
    }),
  ).rejects.toThrow("secret content");
  const [t] = await traces(all);
  expect(t).toMatchObject({ status: "failed", error: "BoomError", calls: 1 });
  expect(JSON.stringify(t)).not.toContain("secret content");
});

test("core loop calls ask the provider for core.max_retries retries", async () => {
  const { all, deps } = setup({ ...cfg, core: { ...cfg.core, max_retries: 2 } });
  const seen: (number | undefined)[] = [];
  const classify = all.llm.classifyJson.bind(all.llm);
  vi.spyOn(all.llm, "classifyJson").mockImplementation((request) => {
    seen.push(request.maxRetries);
    return classify(request);
  });
  await runCoreLoop(deps, "core_reflect", now, async (ctx) => {
    await probe(ctx);
    return { inputs: {}, outputs: {} };
  });
  expect(seen).toEqual([2]);
});

test("core loops can't call the reply model", async () => {
  const { deps } = setup();
  await expect(
    runCoreLoop(deps, "core_reflect", now, async (ctx) => {
      await ctx.deps.llm.generateReply({ system: [{ text: "s" }], messages: [] });
      return { inputs: {}, outputs: {} };
    }),
  ).rejects.toThrow("reply model");
});

test("commit and metered success trace succeed together exactly once", async () => {
  const { all, deps } = setup();
  const out = await runCoreLoop(deps, "core_wander", now, async (ctx) => {
    await probe(ctx);
    return ctx.commit(async (tx) => {
      const id = await tx.memory.insert(thought);
      return { inputs: { seed: "memory" }, outputs: { id }, promptVersion: "v1" };
    });
  });
  const memories = await all.db.select().from(core_memory);
  expect(memories).toHaveLength(1);
  expect(out).toEqual({ status: "done", outputs: { id: memories[0]!.id } });
  expect(await traces(all)).toMatchObject([
    { status: "done", calls: 1, outputs: { id: memories[0]!.id }, prompt_version: "v1" },
  ]);
});

test("trace insert failure rolls back the callback's writes and records one failure", async () => {
  const { all, deps } = setup();
  const transaction = deps.core.transaction.bind(deps.core);
  vi.spyOn(deps.core, "transaction").mockImplementation((fn) =>
    transaction((tx) =>
      fn({
        ...tx,
        traces: {
          ...tx.traces,
          insert: async () => {
            throw new Error("trace refused");
          },
        },
      }),
    ),
  );
  await expect(
    runCoreLoop(deps, "core_wander", now, (ctx) =>
      ctx.commit(async (tx) => {
        await tx.memory.insert(thought);
        return { inputs: {}, outputs: { applied: true } };
      }),
    ),
  ).rejects.toThrow("trace refused");
  expect(await all.db.select().from(core_memory)).toHaveLength(0);
  expect(await traces(all)).toMatchObject([{ status: "failed", error: "Error" }]);
});

test("callback failure rolls back its writes, rethrows, and traces once", async () => {
  const { all, deps } = setup();
  class ApplyError extends Error {}
  await expect(
    runCoreLoop(deps, "core_wander", now, (ctx) =>
      ctx.commit(async (tx) => {
        await tx.memory.insert(thought);
        throw new ApplyError("private detail");
      }),
    ),
  ).rejects.toThrow("private detail");
  expect(await all.db.select().from(core_memory)).toHaveLength(0);
  expect(await traces(all)).toMatchObject([{ status: "failed", error: "ApplyError" }]);
});

test("a second commit is rejected before its callback runs", async () => {
  const { all, deps } = setup();
  let called = false;
  await expect(
    runCoreLoop(deps, "core_wander", now, async (ctx) => {
      await ctx.commit(async () => ({ inputs: {}, outputs: { first: true } }));
      return ctx.commit(async () => {
        called = true;
        return { inputs: {}, outputs: { first: false } };
      });
    }),
  ).rejects.toThrow("already committed");
  expect(called).toBe(false);
  expect(await traces(all)).toMatchObject([{ status: "done", outputs: { first: true } }]);
});

const shownInput = (input: string) => (ctx: LoopContext) =>
  ctx.deps.llm.classifyJson({
    purpose: "probe",
    model: "core",
    system: "s",
    input,
    schema: z.object({ ok: z.boolean() }),
    timeoutMs: 1000,
    maxTokens: 10,
  });

test("a loop's memory writes take the dates its input showed (the 16b wander)", async () => {
  const { deps } = setup();
  const thu = new Date("2026-01-08T09:00:00Z");
  const result = await runCoreLoop(deps, "core_wander", thu, async (ctx) => {
    expect(ctx.shown()).toEqual([]);
    await shownInput(
      "The telescope booking ⟦2026-01-06|day|UTC⟧ came through, so Spica gets a real session.",
    )(ctx);
    expect(ctx.shown()).toHaveLength(1);
    return ctx.commit(async (tx) => {
      const id = await tx.memory.insert({
        ...thought,
        content: "the telescope booking came through for tuesday night",
        occurred_at: thu,
        created_at: thu,
      });
      return { inputs: {}, outputs: { id } };
    });
  });
  const row = await deps.core.memory.get(result.outputs!.id);
  expect(row!.content).toContain("⟦2026-01-06|night|UTC⟧");
});

test("a loop shown no dates anchors as before", async () => {
  const { deps } = setup();
  const thu = new Date("2026-01-08T09:00:00Z");
  const result = await runCoreLoop(deps, "core_wander", thu, async (ctx) => {
    await shownInput("no dates here")(ctx);
    return ctx.commit(async (tx) => {
      const id = await tx.memory.insert({
        ...thought,
        content: "watching tonight",
        occurred_at: thu,
        created_at: thu,
      });
      return { inputs: {}, outputs: { id } };
    });
  });
  const row = await deps.core.memory.get(result.outputs!.id);
  expect(row!.content).toBe("watching ⟦2026-01-08|night|UTC⟧");
});
