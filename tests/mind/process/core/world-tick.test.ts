/**
 * `core_world_tick`: one generation per her local day for everyone, all-or-nothing, logged and traced.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { count, eq } from "drizzle-orm";
import { core_loop_trace, core_memory, life_event_log, world_event } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { closeTestDb, createTestUser, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { sequence } from "../../../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);
const cfg = { core: { world: { event_probability: 1, events_per_day_max: 1 } } };
const at = new Date("2026-01-05T09:00:00Z"); // 17:00 in Singapore
const rows = async (deps: ReturnType<typeof makeTestDeps>, table: typeof world_event) =>
  (await deps.db.select({ n: count() }).from(table))[0]!.n;

test("generates once per her day, however many users and however many runs", async () => {
  const deps = makeTestDeps(cfg);
  await createTestUser();
  await createTestUser();
  expect(await coreWorldTick(coreDepsOf(deps), at)).toBe("done");
  expect(await coreWorldTick(coreDepsOf(deps), new Date(at.getTime() + 3_600_000))).toBe("not_due");
  expect(await rows(deps, world_event)).toBe(1);
  expect((await deps.db.select({ n: count() }).from(core_memory))[0]!.n).toBe(1);
  expect((await deps.db.select({ n: count() }).from(life_event_log))[0]!.n).toBe(1);
  const traces = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "core_world_tick"));
  expect(traces).toHaveLength(1);
});

test("a failure mid-apply writes nothing and the next run retries", async () => {
  const deps = makeTestDeps(cfg);
  deps.llm.handlers.life_event = sequence(new Error("model down"));
  await expect(coreWorldTick(coreDepsOf(deps), at)).rejects.toThrow("model down");
  expect(await rows(deps, world_event)).toBe(0);
  expect((await deps.core.state.get())?.last_event_day ?? null).toBeNull();

  deps.llm.handlers.life_event = sequence({
    content: "She found an old film.",
    at: "15:00",
    valence: 0.3,
    stakes: "low",
    entity_names: [],
  });
  expect(await coreWorldTick(coreDepsOf(deps), at)).toBe("done");
  expect(await rows(deps, world_event)).toBe(1);
});

test("no plan for today still makes a generic event", async () => {
  const deps = makeTestDeps(cfg);
  await coreWorldTick(coreDepsOf(deps), at);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "life_event")!;
  expect(call.input).toContain("unknown, keep the event generic");
  expect(await rows(deps, world_event)).toBe(1);
});

test("waits for her events hour", async () => {
  const deps = makeTestDeps({ core: { world: { events_local_hour: 20 } } });
  expect(await coreWorldTick(coreDepsOf(deps), at)).toBe("not_due");
});

test("new people in an event join her entities", async () => {
  const deps = makeTestDeps(cfg);
  deps.llm.handlers.life_event = sequence({
    content: "She met Mira at the observatory.",
    at: "15:00",
    valence: 0.4,
    stakes: "low",
    entity_names: ["Mira"],
  });
  await coreWorldTick(coreDepsOf(deps), at);
  expect((await deps.core.memory.entities()).map((e) => e.name)).toContain("Mira");
});
