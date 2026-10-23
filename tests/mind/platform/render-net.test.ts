/** Every prompt reaches the model with its dates read on the clock's day. */
import { expect, test } from "vitest";
import { z } from "zod";
import { SimClock } from "@/mind/platform/clock";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { withTimeRendering } from "@/mind/platform/llm/render-net";
import { anchorTimes } from "@/mind/platform/time-anchors";

test("reply and structured prompts are rendered at the clock's now; the inner provider records them", async () => {
  const fake = new FakeLLMProvider();
  const llm = withTimeRendering(fake, new SimClock(new Date("2026-01-13T09:00:00Z")), 6);
  const note = anchorTimes("the race was yesterday", {
    at: new Date("2026-01-12T09:00:00Z"),
    zone: "UTC",
  });
  fake.replies.push("ok");
  await llm.generateReply({
    system: [{ text: note, cache: true }],
    messages: [{ role: "user", content: note }],
  });
  expect(fake.calls[0]!.system).toBe("the race was 2 days ago, Sunday 11 January");
  expect(fake.calls[0]!.messages[0]!.content).toBe("the race was 2 days ago, Sunday 11 January");
  fake.handlers.probe = () => ({ ok: true });
  await llm.classifyJson({
    purpose: "probe",
    system: note,
    input: JSON.stringify({ note }),
    schema: z.object({ ok: z.boolean() }),
    timeoutMs: 1000,
    maxTokens: 10,
  });
  expect(fake.structuredCalls.at(-1)!.input).toContain("2 days ago, Sunday 11 January");
  expect(fake.structuredCalls.at(-1)!.input).not.toContain("⟦");
});
