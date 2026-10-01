import { expect, test } from "vitest";
import { FakeLLMProvider } from "@/core/llm/fake";
import { RecordingLLM } from "../../evals/lib/recording-llm";

test("records the system prompt and user messages, not Spica's own earlier replies", async () => {
  const llm = new RecordingLLM(new FakeLLMProvider());
  await llm.generateReply({
    system: "SYS",
    messages: [
      { role: "user", content: "a good cat name?" },
      { role: "assistant", content: "maybe biscuit" },
      { role: "user", content: "more?" },
    ],
  });
  expect(llm.prompts).toEqual(["SYS\na good cat name?\nmore?"]);
});
