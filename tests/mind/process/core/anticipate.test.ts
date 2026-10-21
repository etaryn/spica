/** Anticipation selects a live plan and commits its thought, marker and feeling together. */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { core_loop_trace, core_memory } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { coreAnticipate } from "@/mind/process/core/anticipate";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T09:00:00Z");
const hour = 3_600_000;
const at = (hours: number) => new Date(now.getTime() + hours * hour);

function setup(overrides: unknown = {}) {
  const all = makeTestDeps(overrides);
  const deps = coreDepsOf(all);
  all.llm.handlers.core_anticipate = () => ({
    thought: {
      kind: "thought",
      content: "She wonders how the screening will go.",
      salience: "low",
    },
    emotion: { label: "hopeful", valence: 0.6, arousal: 0.8, about: "the screening" },
  });
  return { all, deps };
}

async function seed(
  deps: ReturnType<typeof setup>["deps"],
  hours: number,
  payload = {},
  agents: string[] = [],
  content = "Spica will see a film with Alcor.",
) {
  const eventId = await deps.core.world.recordEvent({
    at: at(hours),
    kind: "planned",
    content,
    valence: 0.3,
    stakes: "low",
    agents,
    agent_names: ["Alcor"],
    life_day: "2026-01-05",
    created_at: now,
  });
  const id = await deps.core.memory.insert({
    kind: "intention",
    content: "Spica is thinking about the film.",
    payload: { event_at: at(hours).toISOString(), ...payload },
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
  return { id, eventId };
}

async function rows(all: ReturnType<typeof setup>["all"]) {
  return {
    thoughts: (await all.db.select().from(core_memory)).filter((m) => m.kind === "thought"),
    traces: await all.db.select().from(core_loop_trace),
  };
}

test("now is excluded, twelve hours included, and the accepted thought moves only arousal", async () => {
  const { all, deps } = setup();
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  const [alcor] = await deps.core.memory.addEntities(["Alcor"], 0.8, now);
  await seed(deps, 0);
  const eligible = await seed(deps, 12, {}, [alcor!]);
  const result = await coreAnticipate(deps, now);
  const { thoughts, traces } = await rows(all);
  expect(result).toMatchObject({ status: "done", applied: true, ids: [thoughts[0]!.id] });
  expect(thoughts).toHaveLength(1);
  expect(thoughts[0]).toMatchObject({
    source: "loop",
    source_ref: `core_anticipate:${traces[0]!.id}`,
    payload: { anticipates: eligible.id },
    valence: 0.6,
    confidence: 0.6,
    salience: 0.25,
    entity_refs: [alcor],
  });
  expect((await deps.core.memory.get(eligible.id))?.payload).toEqual({
    event_at: at(12).toISOString(),
    anticipated_at: now.toISOString(),
  });
  expect(await deps.core.state.get()).toMatchObject({
    mood_valence: 0.2,
    mood_arousal: 0.52,
    emotion: {
      label: "hopeful",
      valence: 0.6,
      arousal: 0.8,
      phrase: "the screening",
      about: eligible.id,
      since: now.toISOString(),
    },
  });
  expect(traces).toMatchObject([{ loop: "core_anticipate", status: "done", calls: 1 }]);
  // The plan's time reaches the model as her local day and clock, never as ISO.
  const input = all.llm.structuredCalls.find((c) => c.purpose === "core_anticipate")!.input;
  expect(input).not.toMatch(/When: \d{4}-\d{2}-\d{2}T/);
  expect(input).toMatch(/When: \w+day \d+ \w+, (today|in \d+ days?) at \d{2}:\d{2}/);
});

test("already anticipated plans are skipped and same-time plans break ties by ID", async () => {
  const { all, deps } = setup();
  await seed(deps, 1, { anticipated_at: at(-1).toISOString() });
  const a = await seed(deps, 2);
  const b = await seed(deps, 2);
  const first = [a.id, b.id].sort()[0]!;
  const result = await coreAnticipate(deps, now);
  expect((await deps.core.memory.get(first))?.payload).toMatchObject({
    anticipated_at: now.toISOString(),
  });
  expect(result.ids).toHaveLength(1);
  expect((await rows(all)).thoughts[0]?.payload).toEqual({ anticipates: first });
});

test("malformed and missing event links are ignored without a trace", async () => {
  for (const sourceRef of [
    "world_event:missing",
    "world_event:00000000-0000-4000-8000-000000000000",
  ]) {
    await resetDb();
    const { all, deps } = setup();
    const broken = await deps.core.memory.insert({
      kind: "intention",
      content: "Missing event",
      payload: { event_at: at(2).toISOString() },
      embedding: vec(),
      occurred_at: now,
      created_at: now,
      status: "open",
      salience: 0.4,
      valence: 0,
      confidence: 1,
      source: "world",
      source_ref: sourceRef,
    });
    expect(await coreAnticipate(deps, now)).toEqual({ status: "not_due", applied: false, ids: [] });
    expect((await deps.core.memory.get(broken))?.payload).toEqual({
      event_at: at(2).toISOString(),
    });
    expect((await rows(all)).traces).toHaveLength(0);
  }
});

test("invalid emotion or failed embedding leaves no thought, marker or state change", async () => {
  for (const failure of ["emotion", "embedding"] as const) {
    await resetDb();
    const { all, deps } = setup();
    await deps.core.state.ensure(deps.config.core.state.baseline, {
      autonomy: 0.6,
      competence: 0.6,
    });
    const { id } = await seed(deps, 1);
    if (failure === "emotion")
      all.llm.handlers.core_anticipate = () => ({
        thought: { kind: "thought", content: "A thought", salience: "low" },
        emotion: { label: " ", valence: 0.2, arousal: 0.6, about: "the film" },
      });
    else vi.spyOn(deps.embedder, "embed").mockRejectedValue(new Error("embedding unavailable"));
    await expect(coreAnticipate(deps, now)).rejects.toThrow();
    expect((await rows(all)).thoughts).toHaveLength(0);
    expect((await deps.core.memory.get(id))?.payload).toEqual({ event_at: at(1).toISOString() });
    expect(await deps.core.state.get()).toMatchObject({
      mood_valence: 0.2,
      mood_arousal: 0.4,
      emotion: null,
    });
    expect((await rows(all)).traces).toMatchObject([{ status: "failed" }]);
  }
});

test("dedupe records the drop but leaves marker and state untouched", async () => {
  const { all, deps } = setup();
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  const { id } = await seed(deps, 1);
  const [embedding] = await deps.embedder.embed(
    ["She wonders how the screening will go."],
    "document",
  );
  await deps.core.memory.insert({
    kind: "thought",
    content: "She wonders how the screening will go.",
    embedding: embedding!,
    occurred_at: now,
    created_at: now,
    status: "recurring",
    salience: 0.25,
    valence: 0.6,
    confidence: 0.6,
    source: "loop",
    source_ref: "other:prior",
  });
  const result = await coreAnticipate(deps, now);
  expect(result).toEqual({ status: "done", applied: false, ids: [] });
  expect((await rows(all)).thoughts).toHaveLength(1);
  expect((await deps.core.memory.get(id))?.payload).toEqual({ event_at: at(1).toISOString() });
  expect(await deps.core.state.get()).toMatchObject({
    mood_valence: 0.2,
    mood_arousal: 0.4,
    emotion: null,
  });
  expect((await rows(all)).traces[0]?.outputs).toMatchObject({
    dropped: [{ content: "She wonders how the screening will go.", reason: "dedupe" }],
  });
});

test("the optional reserve skips a due plan without invoking the model", async () => {
  const { all, deps } = setup({ core: { daily_call_budget: 8, budget_reserve: 8 } });
  await seed(deps, 1);
  expect(await coreAnticipate(deps, now)).toEqual({
    status: "skipped_budget",
    applied: false,
    ids: [],
  });
  expect(all.llm.structuredCalls).toHaveLength(0);
  expect((await rows(all)).traces).toMatchObject([{ status: "skipped_budget", calls: 0 }]);
});

test("the deterministic anticipation fake stays within the thought limit for a long event", async () => {
  const all = makeTestDeps();
  const deps = coreDepsOf(all);
  await seed(deps, 1, {}, [], "x".repeat(deps.config.core.world.event_max_chars));
  expect(await coreAnticipate(deps, now)).toMatchObject({ status: "done", applied: true });
  expect((await rows(all)).thoughts[0]!.content.length).toBeLessThanOrEqual(
    deps.config.core.loops.max_chars,
  );
});

test("landing while the model is in flight wins and prevents all anticipation writes", async () => {
  const { all, deps } = setup();
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  const { id, eventId } = await seed(deps, 1);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  all.llm.handlers.core_anticipate = async () => {
    entered();
    await gate;
    return {
      thought: {
        kind: "thought",
        content: "She wonders how the screening will go.",
        salience: "low",
      },
      emotion: { label: "hopeful", valence: 0.6, arousal: 0.8, about: "the screening" },
    };
  };
  const pending = coreAnticipate(deps, now);
  await waiting;
  await deps.core.transaction(async (tx) => {
    await tx.lock("core_world_tick");
    await tx.world.markAppraised(eventId, now);
    await tx.memory.setStatus(id, "resolved");
  });
  release();
  expect(await pending).toEqual({ status: "done", applied: false, ids: [] });
  expect((await rows(all)).thoughts).toHaveLength(0);
  expect((await deps.core.memory.get(id))?.payload).toEqual({ event_at: at(1).toISOString() });
  expect(await deps.core.state.get()).toMatchObject({
    mood_valence: 0.2,
    mood_arousal: 0.4,
    emotion: null,
  });
});
