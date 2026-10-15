import { expect, test } from "vitest";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { RecordingLLM } from "../../evals/lib/recording-llm";

test("records the system prompt and user messages, not Spica's own earlier replies", async () => {
  const llm = new RecordingLLM(new FakeLLMProvider());
  await llm.generateReply({
    system: [{ text: "SYS" }],
    messages: [
      { role: "user", content: "a good cat name?" },
      { role: "assistant", content: "maybe biscuit" },
      { role: "user", content: "more?" },
    ],
  });
  expect(llm.prompts).toEqual(["SYS\na good cat name?\nmore?"]);
});

test("records each reply's system prompt and the draft it came back with", async () => {
  const inner = new FakeLLMProvider();
  inner.replies.push("Hey there.");
  const llm = new RecordingLLM(inner);
  await llm.generateReply({
    system: [{ text: "SYS" }],
    messages: [{ role: "user", content: "hi" }],
  });
  expect(llm.replies).toEqual([{ prompt: "SYS", draft: "Hey there." }]);
});
