import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { CallLog } from "../../evals/lib/call-log";

test("logs every call's prompt and output, and a failed call's error", async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "call-log-")), "calls", "x.jsonl");
  const inner = new FakeLLMProvider({
    classify: (input) => {
      if (input === "boom") throw new Error("overloaded");
      return { flag: true };
    },
  });
  inner.replies.push("hey");
  const llm = new CallLog(inner, file);
  const req = { system: "S", schema: z.object({ flag: z.boolean() }), timeoutMs: 1, maxTokens: 1 };

  await llm.generateReply({
    system: [{ text: "SYS" }],
    messages: [{ role: "user", content: "hi" }],
  });
  await llm.classifyJson({ ...req, purpose: "crisis", input: "in" });
  await expect(llm.classifyJson({ ...req, purpose: "crisis", input: "boom" })).rejects.toThrow();

  const lines = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  expect(lines).toMatchObject([
    { purpose: "reply", system: "SYS", messages: [{ content: "hi" }], output: "hey" },
    { purpose: "crisis", system: "S", input: "in", output: { flag: true } },
    { purpose: "crisis", input: "boom", error: "overloaded" },
  ]);
});
