/** `forUser` books every call to one user without any call site passing the id. */
import { expect, test } from "vitest";
import { z } from "zod";
import { forUser } from "@/mind/platform/llm/for-user";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";

test("every call carries the user; a call that already names one keeps it", async () => {
  const seen: (string | undefined)[] = [];
  const inner = new FakeLLMProvider();
  inner.handlers.crisis = () => ({ ok: true });
  const spy = {
    generateReply: (r: Parameters<typeof inner.generateReply>[0]) => {
      seen.push(r.userId);
      return inner.generateReply(r);
    },
    classifyJson: ((r: { userId?: string }) => {
      seen.push(r.userId);
      return inner.classifyJson(r as never);
    }) as typeof inner.classifyJson,
  };
  const llm = forUser(spy, "u1");
  const base = {
    purpose: "crisis",
    system: "s",
    input: "i",
    schema: z.object({ ok: z.boolean() }),
    timeoutMs: 1,
    maxTokens: 1,
  };
  await llm.generateReply({ system: [{ text: "s" }], messages: [] });
  await llm.classifyJson(base);
  await llm.classifyJson({ ...base, userId: "other" });
  expect(seen).toEqual(["u1", "u1", "other"]);
});
