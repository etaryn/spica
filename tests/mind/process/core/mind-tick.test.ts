/** The hourly coordinator preserves loop order and contains each loop's failure. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { core_loop_trace } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreMindTick } from "@/mind/process/core/mind-tick";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T09:00:00Z");
const before = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

async function seedDue(deps: ReturnType<typeof coreDepsOf>) {
  await deps.core.world.insertPlan({
    date: "2026-01-05",
    plan: { blocks: [] },
    source: "scripted",
    model: "fake",
    prompt_version: "v1",
    generated_at: now,
  });
  const eventId = await deps.core.world.recordEvent({
    at: new Date(now.getTime() + 3_600_000),
    kind: "planned",
    content: "Spica will see a film.",
    valence: 0.3,
    stakes: "low",
    agents: [],
    agent_names: [],
    life_day: "2026-01-05",
    created_at: now,
  });
  await deps.core.memory.insert({
    kind: "intention",
    content: "Spica is thinking about the film.",
    payload: { event_at: new Date(now.getTime() + 3_600_000).toISOString() },
    embedding: vec(0.02),
    entity_refs: [],
    occurred_at: now,
    created_at: now,
    status: "open",
    salience: 0.4,
    valence: 0.3,
    confidence: 0.8,
    source: "world",
    source_ref: `world_event:${eventId}`,
  });
  await deps.core.memory.insert({
    kind: "episode",
    content: "The ending of an old film stayed with Spica.",
    payload: {},
    embedding: vec(0.04),
    entity_refs: [],
    occurred_at: before(3),
    created_at: before(3),
    status: "resolved",
    salience: 0.9,
    valence: -0.6,
    confidence: 0.8,
    source: "world",
    source_ref: null,
  });
}

function setup(overrides: unknown = {}) {
  const all = makeTestDeps(overrides);
  const deps = coreDepsOf(all);
  all.llm.handlers.core_anticipate = () => ({
    thought: { kind: "thought", content: "She wonders about tonight's film.", salience: "low" },
    emotion: { label: "hopeful", valence: 0.4, arousal: 0.6, about: "the film" },
  });
  all.llm.handlers.core_ruminate = () => ({
    thought: { kind: "thought", content: "She still thinks about the old film.", salience: "low" },
  });
  all.llm.handlers.core_wander = () => ({
    items: [{ kind: "idea", content: "She might revisit the director's work.", salience: "low" }],
  });
  const lines: unknown[] = [];
  deps.log = { info: () => {}, error: (_msg, meta) => lines.push(meta) };
  return { all, deps, lines };
}

test("due thinking runs anticipate, ruminate, then wander", async () => {
  const { all, deps } = setup();
  await seedDue(deps);
  const result = await coreMindTick(deps, now);
  expect(Object.keys(result)).toEqual(["anticipate", "ruminate", "wander"]);
  expect(Object.values(result).map((part) => part.status)).toEqual(["done", "done", "done"]);
  expect(all.llm.structuredCalls.map((call) => call.purpose)).toEqual([
    "core_anticipate",
    "core_ruminate",
    "core_wander",
  ]);
});

test.each(["core_anticipate", "core_ruminate"] as const)(
  "%s failure is traced by its runner and later loops still run",
  async (purpose) => {
    const { all, deps, lines } = setup();
    await seedDue(deps);
    class PrivateFailure extends Error {}
    all.llm.handlers[purpose] = () => {
      throw new PrivateFailure("private model output");
    };
    const result = await coreMindTick(deps, now);
    expect(result[purpose.slice(5) as "anticipate" | "ruminate"]).toEqual({
      status: "failed",
      applied: false,
      ids: [],
    });
    expect(result.wander.status).toBe("done");
    if (purpose === "core_anticipate") expect(result.ruminate.status).toBe("done");
    expect(all.llm.structuredCalls.map((call) => call.purpose)).toEqual([
      "core_anticipate",
      "core_ruminate",
      "core_wander",
    ]);
    const traces = await all.db.select().from(core_loop_trace);
    expect(traces).toHaveLength(3);
    expect(traces.find((row) => row.loop === purpose)).toMatchObject({
      status: "failed",
      error: "PrivateFailure",
    });
    expect(JSON.stringify(lines)).toContain("PrivateFailure");
    expect(JSON.stringify(lines)).not.toContain("private model output");
  },
);

test("nothing due makes no model calls and no traces", async () => {
  const { all, deps } = setup();
  expect(await coreMindTick(deps, now)).toEqual({
    anticipate: { status: "not_due", applied: false, ids: [] },
    ruminate: { status: "not_due", applied: false, ids: [] },
    wander: { status: "not_due", applied: false, ids: [] },
  });
  expect(all.llm.structuredCalls).toHaveLength(0);
  expect(await all.db.select().from(core_loop_trace)).toHaveLength(0);
});

test("the optional reserve skips all due thinking before model calls", async () => {
  const { all, deps } = setup({ core: { daily_call_budget: 8, budget_reserve: 8 } });
  await seedDue(deps);
  const result = await coreMindTick(deps, now);
  expect(Object.values(result).map((part) => part.status)).toEqual([
    "skipped_budget",
    "skipped_budget",
    "skipped_budget",
  ]);
  expect(all.llm.structuredCalls).toHaveLength(0);
  expect(await all.db.select().from(core_loop_trace)).toMatchObject([
    { loop: "core_anticipate", status: "skipped_budget", calls: 0 },
    { loop: "core_ruminate", status: "skipped_budget", calls: 0 },
    { loop: "core_wander", status: "skipped_budget", calls: 0 },
  ]);
});
