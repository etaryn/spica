import { expect, test } from "vitest";
import { z } from "zod";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { RoutingLLM } from "../../evals/lib/routing-llm";

test("routes the reply and each structured purpose to real or fake", async () => {
  const real = new FakeLLMProvider(),
    fake = new FakeLLMProvider();
  real.replies.push("REAL");
  real.handlers.turn_judge = () => ({ which: "real" });
  fake.handlers.turn_judge = () => ({ which: "fake" });
  const schema = z.object({ which: z.string() });
  const onlyJudge = new RoutingLLM(real, fake, new Set(["turn_judge"]));
  expect(
    await onlyJudge.generateReply({ system: "", messages: [{ role: "user", content: "hi" }] }),
  ).toBe("(fake reply to: hi)");
  expect(
    await onlyJudge.classifyJson({
      purpose: "turn_judge",
      system: "",
      input: "",
      schema,
      timeoutMs: 1,
      maxTokens: 1,
    }),
  ).toEqual({ which: "real" });
  expect(
    await onlyJudge.classifyJson({
      purpose: "extract",
      system: "",
      input: "",
      schema: z.any(),
      timeoutMs: 1,
      maxTokens: 1,
    }),
  ).toEqual({ facts: [], entities: [], threads: [], relationship: null });
  expect(
    await new RoutingLLM(real, fake, new Set(["reply"])).generateReply({
      system: "",
      messages: [],
    }),
  ).toBe("REAL");
});
