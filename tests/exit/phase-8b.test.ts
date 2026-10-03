/** A short deterministic core day covers thought, changed plans and the shared call budget. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { core_loop_trace, core_memory, world_event } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreMindTick } from "@/mind/process/core/mind-tick";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { closeTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 0, 5, hour, minute));
const FIRST_EVENT = "00000000-0000-4000-8000-000000000001";
const NEXT_EVENT = "00000000-0000-4000-8000-000000000002";

async function plannedEvent(
  deps: ReturnType<typeof makeTestDeps>,
  id: string,
  eventAt: Date,
  content: string,
  fallthrough: boolean | null,
) {
  await deps.db.insert(world_event).values({
    id,
    at: eventAt,
    kind: "planned",
    content,
    valence: 0.8,
    stakes: "high",
    agents: [],
    agent_names: [],
    life_day: "2026-01-05",
    created_at: at(9),
    fallthrough,
  });
  return deps.core.memory.insert({
    kind: "intention",
    content: `Spica expects ${content}`,
    payload: { event_at: eventAt.toISOString() },
    embedding: vec(),
    entity_refs: [],
    occurred_at: at(9),
    created_at: at(9),
    status: "open",
    salience: 0.4,
    valence: 0.8,
    confidence: 1,
    source: "world",
    source_ref: `world_event:${id}`,
  });
}

test("anticipation, changed plan, rumination and downtime wander each apply once before budget runs out", async () => {
  const deps = makeTestDeps({
    life: { timezone: "UTC" },
    core: { daily_call_budget: 5, budget_reserve: 0, world: { events_local_hour: 20 } },
  });
  deps.llm.handlers.core_resolve = () => ({
    content: "Spica saw the observatory close and found another way to study the stars.",
    valence: 0.8,
    stakes: "high",
  });
  const core = coreDepsOf(deps);
  const intentionId = await plannedEvent(
    deps,
    FIRST_EVENT,
    at(10),
    "to collect telescope images.",
    true,
  );

  expect((await coreMindTick(core, at(9))).anticipate).toMatchObject({
    status: "done",
    applied: true,
  });
  expect((await coreWorldTick(core, at(10))).appraised).toBe(1);
  const [original] = await deps.db
    .select()
    .from(world_event)
    .where(eq(world_event.id, FIRST_EVENT));
  const [replacement] = await deps.db
    .select()
    .from(world_event)
    .where(eq(world_event.plan_ref, FIRST_EVENT));
  expect(original).toMatchObject({ outcome: "fell_through" });
  expect(original!.appraised_at).not.toBeNull();
  expect(replacement).toMatchObject({ kind: "resolution", plan_ref: FIRST_EVENT });
  expect(replacement!.appraised_at).toEqual(at(10));
  expect((await deps.core.memory.get(intentionId))!.status).toBe("resolved");
  const episodes = (await deps.db.select().from(core_memory)).filter(
    (row) => row.kind === "episode",
  );
  expect(episodes.map((row) => row.source_ref)).toEqual([`world_event:${replacement!.id}`]);

  await deps.core.world.insertPlan({
    date: "2026-01-05",
    plan: { blocks: [] },
    source: "scripted",
    model: "fake",
    prompt_version: "scripted",
    generated_at: at(12),
  });
  const thinking = await coreMindTick(core, at(12));
  expect(thinking.ruminate).toMatchObject({ status: "done", applied: true });
  expect(thinking.wander).toMatchObject({ status: "done", applied: true });
  expect(thinking.ruminate.ids).toHaveLength(1);
  expect(thinking.wander.ids).toHaveLength(1);
  expect((await deps.core.memory.get(episodes[0]!.id))!.payload).toMatchObject({ ruminated: 1 });
  await plannedEvent(deps, NEXT_EVENT, at(13), "to review another star map.", false);
  expect((await coreMindTick(core, at(12, 1))).anticipate).toMatchObject({
    status: "skipped_budget",
    applied: false,
  });
  const traces = await deps.db.select().from(core_loop_trace);
  for (const loop of [
    "core_anticipate",
    "core_resolve",
    "core_appraise",
    "core_ruminate",
    "core_wander",
  ]) {
    expect(
      traces.filter((trace) => trace.loop === loop && trace.status === "done"),
      loop,
    ).toHaveLength(1);
  }
  for (const loop of ["core_anticipate", "core_ruminate", "core_wander"])
    expect(traces.find((trace) => trace.loop === loop)?.outputs, loop).toMatchObject({
      applied: true,
    });
  expect(traces.find((trace) => trace.loop === "core_resolve")?.outputs).toMatchObject({
    proposed: true,
  });
  expect(traces.find((trace) => trace.loop === "core_appraise")?.outputs).toMatchObject({
    landed: [FIRST_EVENT],
  });
  expect(
    traces.filter((trace) => trace.loop === "core_anticipate" && trace.status === "skipped_budget"),
  ).toHaveLength(1);
  expect(traces.reduce((sum, trace) => sum + trace.calls, 0)).toBe(5);
});
