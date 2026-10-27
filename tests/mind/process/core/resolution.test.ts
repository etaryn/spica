/** Plan outcomes and target memories change only when a due world event lands. */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { core_loop_trace, core_memory, world_event } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T09:00:00Z");
const earlier = new Date("2026-01-05T08:00:00Z");
const quietGeneration = { core: { world: { events_local_hour: 20 } } };
type TestDeps = ReturnType<typeof makeTestDeps>;

async function plan(
  deps: TestDeps,
  fallthrough: boolean | null,
  resolvesMemoryId: string | null = null,
  fixedId?: string,
  goalRef?: string,
) {
  const event = {
    at: earlier,
    kind: "planned" as const,
    content: "Spica planned to see Solaris with Alcor.",
    valence: 0.6,
    stakes: "high" as const,
    agents: [],
    agent_names: ["Alcor"],
    life_day: "2026-01-05",
    created_at: earlier,
    fallthrough,
    resolves_memory_id: resolvesMemoryId,
    goal_ref: goalRef,
  };
  const id = fixedId
    ? (
        await deps.db
          .insert(world_event)
          .values({ ...event, id: fixedId })
          .returning({ id: world_event.id })
      )[0]!.id
    : await deps.core.world.recordEvent(event);
  const intention = await deps.core.memory.insert({
    kind: "intention",
    content: "Spica expects to see Solaris with Alcor.",
    embedding: vec(),
    occurred_at: earlier,
    created_at: earlier,
    status: "open",
    salience: 0.4,
    valence: 0.6,
    confidence: 1,
    source: "world",
    source_ref: `world_event:${id}`,
  });
  return { id, intention };
}

async function episode(deps: TestDeps) {
  return deps.core.memory.insert({
    kind: "episode",
    content: "An old disappointment.",
    embedding: vec(),
    occurred_at: earlier,
    created_at: earlier,
    status: "open",
    salience: 0.6,
    valence: -0.8,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
}

test("forced fallthrough appraises its replacement in the same tick and resolves the original intention", async () => {
  const deps = makeTestDeps(quietGeneration);
  const goal = await deps.core.goals.insert({
    title: "See the film",
    why: "To share it with Alcor",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: null,
    started_at: earlier,
    target_at: null,
    embedding: vec(),
  });
  const { id, intention } = await plan(deps, true, null, undefined, goal);
  deps.llm.handlers.core_resolve = () => ({
    content: "The screening was cancelled, so Spica and Alcor walked home.",
    valence: -0.4,
    stakes: "low",
  });
  expect((await coreWorldTick(coreDepsOf(deps), now)).appraised).toBe(1);
  const events = await deps.db.select().from(world_event);
  const original = events.find((e) => e.id === id)!;
  const replacement = events.find((e) => e.plan_ref === id)!;
  expect(original).toMatchObject({ outcome: "fell_through" });
  expect(original.appraised_at).not.toBeNull();
  expect(replacement).toMatchObject({
    kind: "resolution",
    content: "The screening was cancelled, so Spica and Alcor walked home.",
    plan_ref: id,
    at: earlier,
    life_day: original.life_day,
    agent_names: original.agent_names,
    goal_ref: original.goal_ref,
  });
  expect(replacement.goal_ref).toBe(goal);
  expect(replacement.appraised_at).not.toBeNull();
  const memories = await deps.db.select().from(core_memory);
  expect(memories.filter((m) => m.kind === "episode").map((m) => m.source_ref)).toEqual([
    `world_event:${replacement.id}`,
  ]);
  expect((await deps.core.memory.get(intention))!.status).toBe("resolved");
  expect(deps.llm.structuredCalls.find((c) => c.purpose === "core_appraise")!.input).toContain(
    "Spica expects to see Solaris",
  );
  expect((await coreWorldTick(coreDepsOf(deps), now)).appraised).toBe(0);
  expect(
    (await deps.db.select().from(core_memory)).filter((m) => m.kind === "episode"),
  ).toHaveLength(1);
});

test("a resolution keeps an unplanned goal reference null while appraisal advances an active goal", async () => {
  const deps = makeTestDeps(quietGeneration);
  const goal = await deps.core.goals.insert({
    title: "See the film",
    why: "To share it with Alcor",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: null,
    started_at: earlier,
    target_at: null,
    embedding: vec(),
  });
  const { id } = await plan(deps, true);
  deps.llm.handlers.core_resolve = () => ({
    content: "The screening was cancelled, so Spica found another film.",
    valence: 0.4,
    stakes: "low",
  });
  deps.llm.handlers.core_appraise = () => ({
    episode: "Spica found another film after the cancellation.",
    emotion: { label: "pleased", valence: 0.4, arousal: 0.3, about: "the new film" },
    salience: "medium",
    goal_effects: [{ goal_id: goal, effect: "advance", size: "small" }],
    need_effects: { autonomy: 0, competence: 0 },
  });
  await coreWorldTick(coreDepsOf(deps), now);
  const original = await deps.core.world.getEvent(id);
  const replacement = (await deps.db.select().from(world_event)).find(
    (row) => row.plan_ref === id,
  )!;
  expect(original?.goal_ref).toBeNull();
  expect(replacement.goal_ref).toBeNull();
  expect((await deps.core.goals.get(goal))!.progress).toBeGreaterThan(0.2);
});

test("a valid resolution clamps surface valence before landing", async () => {
  const deps = makeTestDeps(quietGeneration);
  const { id } = await plan(deps, true);
  deps.llm.handlers.core_resolve = () => ({
    content: "Spica went home instead.",
    valence: -4,
    stakes: "high",
  });
  await coreWorldTick(coreDepsOf(deps), now);
  const replacement = (await deps.db.select().from(world_event)).find((e) => e.plan_ref === id)!;
  expect(replacement).toMatchObject({
    content: "Spica went home instead.",
    valence: -1,
    stakes: "high",
  });
});

test("an overlong resolution is shortened, not thrown away for the plan to happen", async () => {
  const deps = makeTestDeps(quietGeneration);
  const { id } = await plan(deps, true);
  const max = deps.config.core.world.event_max_chars;
  deps.llm.handlers.core_resolve = () => ({
    content: "Spica stayed home instead. ".repeat(20),
    valence: -0.2,
    stakes: "low",
  });
  await coreWorldTick(coreDepsOf(deps), now);
  const replacement = (await deps.db.select().from(world_event)).find((e) => e.plan_ref === id)!;
  expect(replacement.content).toHaveLength(max);
  expect(replacement.content.startsWith("Spica stayed home instead.")).toBe(true);
});

test("forced no-fallthrough records happened and does not request a resolution", async () => {
  const deps = makeTestDeps(quietGeneration);
  const { id } = await plan(deps, false);
  expect((await coreWorldTick(coreDepsOf(deps), now)).appraised).toBe(1);
  expect(await deps.core.world.getEvent(id)).toMatchObject({ outcome: "happened" });
  expect(deps.llm.structuredCalls.map((c) => c.purpose)).not.toContain("core_resolve");
});

test("a target episode closes at landing and an unrelated preoccupation survives a mild outcome", async () => {
  const deps = makeTestDeps(quietGeneration);
  const target = await episode(deps);
  const unrelated = await episode(deps);
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  await deps.core.state.update({ preoccupation: unrelated, preoccupation_since: earlier });
  const { id } = await plan(deps, false, target);
  deps.llm.handlers.core_appraise = () => ({
    episode: "The plan ended quietly.",
    emotion: { label: "calm", valence: 0.1, arousal: 0.1, about: "" },
    salience: "low",
    goal_effects: [],
    need_effects: { autonomy: 0, competence: 0 },
  });
  expect((await deps.core.memory.get(target))!.status).toBe("open");
  await coreWorldTick(coreDepsOf(deps), now);
  expect((await deps.core.memory.get(target))!.status).toBe("resolved");
  expect((await deps.core.state.get())!.preoccupation).toBe(unrelated);
  expect(await deps.core.world.getEvent(id)).toMatchObject({ outcome: "happened" });
});

test("a failed landing rolls back replacement, intention and target changes, then retries", async () => {
  const deps = makeTestDeps(quietGeneration);
  const target = await episode(deps);
  const { id, intention } = await plan(deps, true, target);
  deps.llm.handlers.core_resolve = () => ({
    content: "The film was cancelled.",
    valence: -0.4,
    stakes: "low",
  });
  const transaction = deps.core.transaction.bind(deps.core);
  vi.spyOn(deps.core, "transaction").mockImplementation((fn) =>
    transaction(async (tx) => {
      vi.spyOn(tx.world, "markAppraised").mockRejectedValue(new Error("write failed"));
      return fn(tx);
    }),
  );
  await expect(coreWorldTick(coreDepsOf(deps), now)).rejects.toThrow("write failed");
  expect(await deps.db.select().from(world_event)).toHaveLength(1);
  expect(await deps.core.world.getEvent(id)).toMatchObject({ outcome: null, appraised_at: null });
  expect((await deps.core.memory.get(intention))!.status).toBe("open");
  expect((await deps.core.memory.get(target))!.status).toBe("open");
  vi.mocked(deps.core.transaction).mockRestore();
  expect((await coreWorldTick(coreDepsOf(deps), now)).appraised).toBe(1);
  expect(await deps.db.select().from(world_event)).toHaveLength(2);
  expect(
    (await deps.db.select().from(core_loop_trace)).some(
      (t) => t.loop === "core_appraise" && t.status === "failed",
    ),
  ).toBe(true);
});

test("an unforced plan uses its stable ID roll", async () => {
  const deps = makeTestDeps(quietGeneration);
  const falls = await plan(deps, null, null, "00000000-0000-0000-0000-000000000000");
  const happens = await plan(deps, null, null, "00000000-0000-0000-0000-000000000001");
  await coreWorldTick(coreDepsOf(deps), now);
  expect(await deps.core.world.getEvent(falls.id)).toMatchObject({ outcome: "fell_through" });
  expect(await deps.core.world.getEvent(happens.id)).toMatchObject({ outcome: "happened" });
  expect(deps.llm.structuredCalls.filter((c) => c.purpose === "core_resolve")).toHaveLength(1);
});

test.each([
  [
    "model error",
    () => {
      throw new Error("model down");
    },
  ],
  ["empty output", () => ({ content: " ", valence: 0, stakes: "low" })],
  [
    "nonfinite valence",
    () => ({ content: "A different night.", valence: Infinity, stakes: "low" }),
  ],
])("%s falls back to the original plan", async (_name, handler) => {
  const deps = makeTestDeps(quietGeneration);
  const { id } = await plan(deps, true);
  deps.llm.handlers.core_resolve = handler;
  await coreWorldTick(coreDepsOf(deps), now);
  expect(await deps.core.world.getEvent(id)).toMatchObject({ outcome: "happened" });
  expect(await deps.db.select().from(world_event)).toHaveLength(1);
  expect(
    (await deps.db.select().from(core_loop_trace)).find((t) => t.loop === "core_resolve"),
  ).toMatchObject({ status: "fallback", calls: 1 });
});

test("no resolution budget lands the original without a resolution model call", async () => {
  const deps = makeTestDeps({
    ...quietGeneration,
    core: { daily_call_budget: 0, budget_reserve: 0, world: { events_local_hour: 20 } },
  });
  const { id } = await plan(deps, true);
  await coreWorldTick(coreDepsOf(deps), now);
  expect(await deps.core.world.getEvent(id)).toMatchObject({ outcome: "happened" });
  expect(deps.llm.structuredCalls).toEqual([]);
  expect(
    (await deps.db.select().from(core_loop_trace)).find((t) => t.loop === "core_resolve"),
  ).toMatchObject({ status: "fallback", calls: 0 });
});

test("a context read failure rethrows and leaves the plan pending", async () => {
  const deps = makeTestDeps(quietGeneration);
  const { id } = await plan(deps, true);
  vi.spyOn(deps.core.memory, "latestSnapshot").mockRejectedValueOnce(
    new Error("database unavailable"),
  );
  await expect(coreWorldTick(coreDepsOf(deps), now)).rejects.toThrow("database unavailable");
  expect(await deps.core.world.getEvent(id)).toMatchObject({ outcome: null, appraised_at: null });
  expect(
    (await deps.db.select().from(core_loop_trace)).find((t) => t.loop === "core_resolve"),
  ).toMatchObject({ status: "failed", error: "Error", calls: 0 });
});

test("a deleted target is harmless when its plan lands", async () => {
  const deps = makeTestDeps(quietGeneration);
  const target = await episode(deps);
  const { id } = await plan(deps, false, target);
  await deps.db.delete(core_memory).where(eq(core_memory.id, target));
  await coreWorldTick(coreDepsOf(deps), now);
  expect(await deps.core.world.getEvent(id)).toMatchObject({
    outcome: "happened",
    resolves_memory_id: null,
  });
});

test("a target preoccupation clears for a mild landing and a strong landing takes precedence", async () => {
  const deps = makeTestDeps(quietGeneration);
  const target = await episode(deps);
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  await deps.core.state.update({ preoccupation: target, preoccupation_since: earlier });
  const { id } = await plan(deps, true, target);
  deps.llm.handlers.core_resolve = () => ({
    content: "The screening was cancelled.",
    valence: -0.8,
    stakes: "high",
  });
  await coreWorldTick(coreDepsOf(deps), now);
  const replacement = (await deps.db.select().from(world_event)).find((e) => e.plan_ref === id)!;
  const newEpisode = (await deps.db.select().from(core_memory)).find(
    (m) => m.source_ref === `world_event:${replacement.id}`,
  )!;
  expect((await deps.core.memory.get(target))!.status).toBe("resolved");
  expect((await deps.core.state.get())!.preoccupation).toBe(newEpisode.id);
  expect(replacement.resolves_memory_id).toBe(target);
});

test("overlapping ticks apply one replacement and one episode", async () => {
  const deps = makeTestDeps(quietGeneration);
  const { id } = await plan(deps, true);
  await Promise.all([coreWorldTick(coreDepsOf(deps), now), coreWorldTick(coreDepsOf(deps), now)]);
  expect((await deps.db.select().from(world_event)).filter((e) => e.plan_ref === id)).toHaveLength(
    1,
  );
  expect(
    (await deps.db.select().from(core_memory)).filter((m) => m.kind === "episode"),
  ).toHaveLength(1);
});

test("a resolution labels its own time words, counted from the plan it replaces", async () => {
  const deps = makeTestDeps({ ...quietGeneration, life: { timezone: "UTC" } });
  const { id } = await plan(deps, true);
  deps.llm.handlers.core_resolve = () => ({
    content: "Spica moved Solaris [m1] to the next day.",
    valence: -0.2,
    stakes: "low",
    times: [
      {
        field: "content",
        words: "the next day",
        from: "m1",
        unit: "day",
        shift: 1,
        weekday: null,
        month: null,
        day_of_month: null,
        part: null,
        clock: "",
        span: "at",
        rough: false,
      },
    ],
  });
  await coreWorldTick(coreDepsOf(deps), now);
  const [replacement] = await deps.db
    .select()
    .from(world_event)
    .where(eq(world_event.plan_ref, id));
  expect(replacement!.content).toBe(
    "Spica moved Solaris (⟦2026-01-05|day|UTC⟧) to ⟦2026-01-06|day|UTC|the next day⟧.",
  );
  const input = deps.llm.structuredCalls.find((c) => c.purpose === "core_resolve")!.input;
  expect(input).toContain("What she expected: [m1] Spica expects to see Solaris with Alcor.");
});
