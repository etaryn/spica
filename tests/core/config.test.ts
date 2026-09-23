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

test("isUniqueViolation finds wrapped pg errors", () => {
  expect(isUniqueViolation({ code: "23505" })).toBe(true);
  expect(isUniqueViolation(new Error("x", { cause: { code: "23505" } }))).toBe(true);
  expect(isUniqueViolation(new Error("x", { cause: { code: "23503" } }))).toBe(false);
  expect(isUniqueViolation(null)).toBe(false);
});
