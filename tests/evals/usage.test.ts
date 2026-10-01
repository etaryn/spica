import { describe, expect, test } from "vitest";
import { UsageTally } from "../../evals/lib/usage";

const call = (purpose: string, model: string, input: number, output: number) => ({
  purpose,
  model,
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
});

describe("UsageTally", () => {
  test("sums per (purpose, model) and sorts by total tokens", () => {
    const t = new UsageTally();
    t.record(call("guard", "haiku", 1000, 50));
    t.record(call("judge_recall", "sonnet", 3000, 900));
    t.record(call("guard", "haiku", 1200, 60));
    expect(t.summary()).toEqual([
      {
        purpose: "judge_recall",
        model: "sonnet",
        calls: 1,
        input_tokens: 3000,
        output_tokens: 900,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      {
        purpose: "guard",
        model: "haiku",
        calls: 2,
        input_tokens: 2200,
        output_tokens: 110,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    ]);
    expect(t.format()).toHaveLength(3);
  });

  test("prints nothing when no calls were made (fake runs)", () => {
    expect(new UsageTally().format()).toEqual([]);
  });
});
