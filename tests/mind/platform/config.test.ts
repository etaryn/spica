import { describe, expect, test } from "vitest";
import { EMBEDDING_DIMENSIONS, loadConfig, parseConfigOverrides } from "@/mind/platform/config";
import { isUniqueViolation } from "@/mind/platform/errors";

describe("loadConfig", () => {
  test("loads defaults", () => {
    const c = loadConfig();
    expect(c.models.reply).toBe("claude-sonnet-5");
    expect(c.session.idle_gap_minutes).toBe(30);
    expect(c.safety.resources.default?.lines.length).toBeGreaterThan(0);
  });

  test("deep-merges overrides", () => {
    const c = loadConfig({ chat: { recent_turns: 5 } });
    expect(c.chat.recent_turns).toBe(5);
    expect(c.chat.max_parts).toBe(4);
  });

  test("rejects invalid values", () => {
    expect(() => loadConfig({ chat: { recent_turns: -1 } })).toThrow();
  });

  test("refuses to override the embedding dimension", () => {
    expect(() => loadConfig({ embedding: { dimensions: 1536 } })).toThrow(/dimension/);
  });

  test("exports the schema dimension", () => {
    expect(EMBEDDING_DIMENSIONS).toBe(1024);
  });

  test("parseConfigOverrides handles empty and JSON input", () => {
    expect(parseConfigOverrides(undefined)).toEqual({});
    expect(parseConfigOverrides("")).toEqual({});
    expect(parseConfigOverrides('{"chat":{"max_parts":2}}')).toEqual({ chat: { max_parts: 2 } });
    expect(() => parseConfigOverrides("{nope")).toThrow(/SPICA_CONFIG/);
  });
});

test("phase 1 config groups load with defaults", () => {
  const c = loadConfig();
  expect(c.models.extract).toBe("claude-haiku-5-5");
  expect(c.models.judge).toBe("claude-haiku-5-5");
  expect(c.retrieval).toMatchObject({
    candidate_pool: 200,
    top_n: 12,
    recency_half_life_days: 30,
    max_due_threads: 5,
  });
  expect(c.reconcile.near_match_similarity).toBe(0.82);
  expect(c.decay).toMatchObject({
    grace_days: 3,
    rate: 0.08,
    stale_floor: 0.05,
    dormant_after_days: 14,
  });
  expect(c.prompts.persona).toBe("v7");
});

test("turn, hot_path and events config load with conservative defaults", () => {
  const c = loadConfig();
  expect(c.turn).toMatchObject({
    settle_ms: 4000,
    wait_ms: 12000,
    max_wait_ms: 40000,
    sweep_batch: 500,
    worker_polling_interval_seconds: 0.5,
  });
  expect(c.turn.read_delay_min_ms).toBeLessThanOrEqual(c.turn.read_delay_max_ms);
  expect(c.hot_path.db_timeout_ms).toBe(2000);
  expect(c.events).toEqual({ channel: "spica_events", heartbeat_ms: 25000 });
  expect(c.guard.timeout_ms).toBe(6000);
  expect(() =>
    loadConfig({ turn: { read_delay_min_ms: 5000, read_delay_max_ms: 1000 } }),
  ).toThrow();
  expect(() => loadConfig({ turn: { worker_polling_interval_seconds: 0.1 } })).toThrow();
});

test("isUniqueViolation finds wrapped pg errors", () => {
  expect(isUniqueViolation({ code: "23505" })).toBe(true);
  expect(isUniqueViolation(new Error("x", { cause: { code: "23505" } }))).toBe(true);
  expect(isUniqueViolation(new Error("x", { cause: { code: "23503" } }))).toBe(false);
  expect(isUniqueViolation(null)).toBe(false);
});

test("life, core and availability config load with her fixed zone", () => {
  const c = loadConfig();
  expect(c.life.timezone).toBe("Asia/Singapore");
  expect(c.core.world.events_per_day_max).toBe(1);
  expect(c.core.world.canon_entities).toEqual(["Alcor"]);
  expect(c.outreach.her_day_limit).toBe(5);
  expect(c.core.state.bands.energy).toEqual([0.35, 0.7]);
  expect(c.availability.override_closeness).toBe(0.8);
  expect(c.models.life).toBe("claude-haiku-5-5");
  expect(c.prompts.life_plan).toBe("v5");
  expect(c.prompts.life_event).toBe("v7");
  expect(c.prompts.post_check).toBe("v3");
});

test("life.timezone must be a real IANA zone", () => {
  expect(() => loadConfig({ life: { timezone: "Mars/Olympus" } })).toThrow();
});

test("outreach, push and reach_out prompt defaults", () => {
  const c = loadConfig();
  expect(c.outreach).toMatchObject({
    cap_per_day: 1,
    cap_per_week: 3,
    max_unanswered: 2,
    threshold: 0.2,
    tick_cron: "20 * * * *",
  });
  expect(c.push).toEqual({
    enabled: true,
    timeout_ms: 5000,
    ttl_seconds: 86400,
    body_max_chars: 1000,
    generic_body: "Spica sent you a message",
  });
  expect(c.prompts.reach_out).toBe("v4");
});

test("rejects the removed backchannel style keys", () => {
  expect(() => loadConfig({ turn: { backchannel_style: "judge" } })).toThrow();
  expect(() => loadConfig({ turn: { signals_probability: 0.3 } })).toThrow();
});

test("posts config: defaults load, draft and check are optional loops", () => {
  const c = loadConfig();
  expect(c.posts.capabilities).toEqual(["still"]);
  expect(c.posts.craft_goals.still).toBe("Get better at making posts");
  expect(c.core.loop_priority.optional).toEqual(
    expect.arrayContaining(["post_draft", "post_check"]),
  );
  expect(c.prompts.post_draft).toBe("v2");
  expect(() => loadConfig({ posts: { capabilities: ["video"] } })).toThrow();
});

test("a long-conversation quiet gap shorter than the session gap is rejected", () => {
  expect(() =>
    loadConfig({ user_mind: { triggers: { long_conversation: { quiet_minutes: 10 } } } }),
  ).toThrow(/quiet_minutes/);
});

test("offline.enter must sit below offline.exit", () => {
  expect(() => loadConfig({ core: { state: { offline: { enter: 0.6, exit: 0.6 } } } })).toThrow(
    /offline/,
  );
});

test("the contradiction band sits below the near-match line", () => {
  expect(() => loadConfig({ reconcile: { contradiction_similarity: 0.9 } })).toThrow(
    /contradiction_similarity/,
  );
});

test("time anchors read as distances within a week", () => {
  expect(loadConfig().time.relative_max_days).toBe(6);
});
