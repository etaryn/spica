/**
 * The core loop runner: one trace per run with the calls actually made, a daily budget that resets
 * at her midnight, a reserve the optional loops can't touch, and failures traced then rethrown.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { asc } from "drizzle-orm";
import { core_loop_trace } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { budgetDayStart, runCoreLoop, type LoopContext } from "@/mind/process/core/runner";
import { closeTestDb, resetDb } from "../../../helpers/db";
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

test("core loops can't call the reply model", async () => {
  const { deps } = setup();
  await expect(
    runCoreLoop(deps, "core_reflect", now, async (ctx) => {
      await ctx.deps.llm.generateReply({ system: "s", messages: [] });
      return { inputs: {}, outputs: {} };
    }),
  ).rejects.toThrow("reply model");
});
