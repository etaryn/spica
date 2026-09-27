import { describe, expect, test } from "vitest";
import { EMBEDDING_DIMENSIONS, loadConfig, parseConfigOverrides } from "@/core/config";
import { isUniqueViolation } from "@/core/errors";

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
  expect(c.models.extract).toBe("claude-haiku-4-5");
  expect(c.models.judge).toBe("claude-haiku-4-5");
  expect(c.retrieval).toMatchObject({ candidate_pool: 200, top_n: 12, recency_half_life_days: 30, max_due_threads: 5 });
  expect(c.reconcile.near_match_similarity).toBe(0.82);
  expect(c.decay).toMatchObject({ grace_days: 3, rate: 0.08, stale_floor: 0.05, dormant_after_days: 14 });
  expect(c.cold_path.max_sweep_attempts).toBe(3);
  expect(c.prompts.persona).toBe("v1");
});

test("turn, hot_path and events config load with conservative defaults", () => {
  const c = loadConfig();
  expect(c.turn).toMatchObject({ settle_ms: 4000, wait_ms: 12000, max_wait_ms: 40000, backchannel_style: "judge" });
  expect(c.turn.read_delay_min_ms).toBeLessThanOrEqual(c.turn.read_delay_max_ms);
  expect(c.hot_path.db_timeout_ms).toBe(2000);
  expect(c.events).toEqual({ channel: "spica_events", heartbeat_ms: 25000 });
  expect(c.guard.timeout_ms).toBe(6000);
  expect(() => loadConfig({ turn: { backchannel_style: "loud" } })).toThrow();
  expect(() => loadConfig({ turn: { read_delay_min_ms: 5000, read_delay_max_ms: 1000 } })).toThrow();
});

test("isUniqueViolation finds wrapped pg errors", () => {
  expect(isUniqueViolation({ code: "23505" })).toBe(true);
  expect(isUniqueViolation(new Error("x", { cause: { code: "23505" } }))).toBe(true);
  expect(isUniqueViolation(new Error("x", { cause: { code: "23503" } }))).toBe(false);
  expect(isUniqueViolation(null)).toBe(false);
});
