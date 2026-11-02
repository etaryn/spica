/** What calls cost: every token kind at its own rate, and an unpriced model makes the cost unknown. */
import { describe, expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { spend } from "@/mind/platform/llm/meter";
import type { LlmUsage } from "@/mind/platform/llm/types";

const { prices } = loadConfig();

const call = (over: Partial<LlmUsage>): LlmUsage => ({
  purpose: "x",
  model: "claude-haiku-5-5",
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_creation_1h_input_tokens: 0,
  ...over,
});

describe("spend", () => {
  test("prices input, output, cache reads and both write durations at their own rates", () => {
    const h = prices["claude-haiku-5-5"]!;
    const out = spend(
      [
        call({
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          cache_read_input_tokens: 1_000_000,
          // 2M written in all, 1M of it at the 1h rate and the rest at the 5m rate
          cache_creation_input_tokens: 2_000_000,
          cache_creation_1h_input_tokens: 1_000_000,
        }),
      ],
      prices,
    );
    expect(out.cost).toBeCloseTo(
      h.input + h.output + h.cache_read + h.cache_write_5m + h.cache_write_1h,
      9,
    );
    expect(out.tokens_in).toBe(1_000_000);
  });

  test("a model with no price makes the whole cost unknown, never a partial sum", () => {
    expect(spend([call({}), call({ model: "mystery", input_tokens: 5 })], prices).cost).toBeNull();
  });

  test("the reply model is priced", () => {
    expect(prices["claude-sonnet-5"]).toBeDefined();
    expect(spend([call({ model: "claude-sonnet-5", input_tokens: 1_000_000 })], prices).cost).toBe(
      prices["claude-sonnet-5"]!.input,
    );
  });
});
