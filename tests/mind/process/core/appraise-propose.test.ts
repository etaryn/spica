/**
 * Proposing an appraisal: the model's reading of an event, bounded in code. Bad numbers are
 * clamped, unknown goals dropped, an unusable answer or a failed call falls back to the code
 * appraisal, and over budget the model isn't called at all.
 */
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { core_loop_trace } from "@/db/schema";
import { loadConfig } from "@/mind/platform/config";
import { coreDepsOf } from "@/mind/platform/deps";
import {
  boundAppraisal,
  codeAppraisal,
  proposeAppraisal,
  type LandingEvent,
  type RawAppraisal,
} from "@/mind/process/core/appraise";
import { runCoreLoop } from "@/mind/process/core/runner";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { sequence } from "../../../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

const cfg = loadConfig().core;
const now = new Date("2026-01-05T09:00:00Z");
const event: LandingEvent = {
  worldEventId: "00000000-0000-0000-0000-000000000001",
  kind: "planned",
  content: "Spica got the telescope images.",
  valence: 0.6,
  stakes: "low",
  at: now,
  agents: [],
  goalRef: null,
};
const raw = (over: Partial<RawAppraisal> = {}): RawAppraisal => ({
  episode: "Spica finally got the telescope images and grinned at them for an hour.",
  emotion: { label: "giddy", valence: 0.7, arousal: 0.8, about: "the images" },
  salience: "high",
  goal_effects: [],
  need_effects: { autonomy: 1, competence: 0 },
  ...over,
});

test("bounds every number and maps words to config values", () => {
  const goal = "11111111-1111-1111-1111-111111111111";
  const a = boundAppraisal(
    raw({
      emotion: { label: "  Giddy ", valence: 3, arousal: -2, about: "" },
      goal_effects: [
        { goal_id: goal, effect: "block", size: "large" },
        { goal_id: goal, effect: "advance", size: "small" },
        { goal_id: "not-a-goal", effect: "advance", size: "small" },
      ],
      need_effects: { autonomy: 5, competence: -0.2 },
    }),
    new Set([goal]),
    cfg,
  )!;
  expect(a.source).toBe("model");
  expect(a.emotion).toEqual({ label: "giddy", valence: 1, arousal: 0, phrase: null });
  expect(a.salience).toBe(cfg.appraise.salience.high);
  expect(a.goalEffects).toEqual([{ goalId: goal, delta: -cfg.goals.step.large }]);
  expect(a.needEffects).toEqual({
    autonomy: cfg.appraise.need_gain,
    competence: -cfg.appraise.need_gain,
  });
});

test("an overlong episode is shortened to its limit", () => {
  const bounded = boundAppraisal(
    raw({ episode: "x".repeat(cfg.appraise.episode_max_chars + 1) }),
    new Set(),
    cfg,
  );
  expect(bounded?.episode).toHaveLength(cfg.appraise.episode_max_chars);
});

test("an empty episode or a NaN valence is unusable", () => {
  expect(boundAppraisal(raw({ episode: "  " }), new Set(), cfg)).toBeNull();
  expect(
    boundAppraisal(
      raw({ emotion: { label: "x", valence: Number.NaN, arousal: 0.5, about: "" } }),
      new Set(),
      cfg,
    ),
  ).toBeNull();
});

test("the code appraisal keeps the event's own words and valence", () => {
  const a = codeAppraisal({ ...event, valence: -0.5 }, cfg);
  expect(a).toMatchObject({
    source: "fallback",
    episode: event.content,
    emotion: {
      label: cfg.appraise.fallback_labels.negative,
      valence: -0.5,
      arousal: 0.5,
      phrase: null,
    },
    salience: cfg.world.event_salience,
    goalEffects: [],
    needEffects: { autonomy: 0, competence: 0 },
  });
});

async function propose(deps: ReturnType<typeof makeTestDeps>) {
  let out: Awaited<ReturnType<typeof proposeAppraisal>> | null = null;
  await runCoreLoop(coreDepsOf(deps), "core_appraise", now, async (ctx) => {
    out = await proposeAppraisal(ctx, event);
    return { inputs: {}, outputs: {} };
  });
  return out!;
}

test("the model's appraisal is used; its prompt holds her goals and what she expected", async () => {
  const deps = makeTestDeps();
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  const goal = await deps.core.goals.insert({
    title: "Learn the winter constellations",
    why: "Orion",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    embedding: vec(),
  });
  await deps.core.memory.insert({
    kind: "intention",
    content: "Spica is counting the hours until the telescope images.",
    embedding: vec(),
    occurred_at: now,
    created_at: now,
    status: "open",
    salience: 0.4,
    valence: 0.6,
    confidence: 1,
    source: "world",
    source_ref: `world_event:${event.worldEventId}`,
  });
  deps.llm.handlers.core_appraise = sequence(
    raw({ goal_effects: [{ goal_id: goal, effect: "advance", size: "medium" }] }),
  );
  const a = await propose(deps);
  expect(a.source).toBe("model");
  expect(a.goalEffects).toEqual([{ goalId: goal, delta: deps.config.core.goals.step.medium }]);
  const call = deps.llm.structuredCalls.find((c) => c.purpose === "core_appraise")!;
  expect(call.input).toContain(goal);
  expect(call.input).toContain("Learn the winter constellations");
  expect(call.input).toContain("counting the hours until the telescope images");
});

test("a failed or unusable model answer falls back to the code appraisal", async () => {
  const deps = makeTestDeps();
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  deps.llm.handlers.core_appraise = sequence(new Error("timeout"));
  expect((await propose(deps)).source).toBe("fallback");
  deps.llm.handlers.core_appraise = sequence(raw({ episode: "" }));
  expect((await propose(deps)).source).toBe("fallback");
});

test("over budget the model isn't called", async () => {
  const deps = makeTestDeps({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  expect((await propose(deps)).source).toBe("fallback");
  expect(deps.llm.structuredCalls.filter((c) => c.purpose === "core_appraise")).toEqual([]);
});

test("a context read failure is traced and rethrown, not used as appraisal fallback", async () => {
  const deps = makeTestDeps();
  vi.spyOn(deps.core.memory, "latestSnapshot").mockRejectedValueOnce(
    new Error("database unavailable"),
  );
  await expect(propose(deps)).rejects.toThrow("database unavailable");
  const [trace] = await deps.db
    .select()
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "core_appraise"));
  expect(trace).toMatchObject({ status: "failed", error: "Error", calls: 0 });
});
