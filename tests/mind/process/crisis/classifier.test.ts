import { describe, expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { checkCrisis, crisisCardFor } from "@/mind/process/crisis/classifier";

const config = loadConfig({ safety: { classifier_timeout_ms: 50 } });

describe("checkCrisis", () => {
  test("uses the classifier result when available", async () => {
    const llm = new FakeLLMProvider({ classify: () => ({ flag: true, category: "self_harm" }) });
    expect(await checkCrisis({ llm, config }, "anything")).toEqual({
      flagged: true,
      category: "self_harm",
      source: "classifier",
    });
  });

  test("classifier 'no flag' wins over keywords when the classifier works", async () => {
    const llm = new FakeLLMProvider({ classify: () => ({ flag: false, category: "none" }) });
    expect((await checkCrisis({ llm, config }, "a book about suicide")).flagged).toBe(false);
  });

  test("falls back to keywords when the classifier throws", async () => {
    const llm = new FakeLLMProvider({
      classify: () => {
        throw new Error("down");
      },
    });
    expect(await checkCrisis({ llm, config }, "I want to end my life")).toEqual({
      flagged: true,
      category: "self_harm",
      source: "keyword_fallback",
    });
    expect(await checkCrisis({ llm, config }, "nice weather")).toEqual({
      flagged: false,
      category: "none",
      source: "keyword_fallback",
    });
  });

  test("falls back to keywords when the classifier hangs past the timeout", async () => {
    const llm = new FakeLLMProvider({ classify: () => new Promise(() => {}) });
    const started = Date.now();
    const r = await checkCrisis({ llm, config }, "thinking about suicide");
    expect(r).toEqual({ flagged: true, category: "self_harm", source: "keyword_fallback" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("falls back when the classifier returns malformed output", async () => {
    const llm = new FakeLLMProvider({ classify: () => ({ nonsense: true }) });
    expect((await checkCrisis({ llm, config }, "hello")).source).toBe("keyword_fallback");
  });
});

test("crisisCardFor returns the default card only when flagged", () => {
  expect(crisisCardFor(null, config)).toBeNull();
  expect(
    crisisCardFor({ flagged: false, category: "none", source: "classifier" }, config),
  ).toBeNull();
  expect(
    crisisCardFor({ flagged: true, category: "self_harm", source: "classifier" }, config)?.lines
      .length,
  ).toBeGreaterThan(0);
});
