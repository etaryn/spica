import { expect, test } from "vitest";
import { FakeLLMProvider } from "@/core/llm/fake";
import { ExtractionSchema } from "@/core/memory/extract";
import { SignalLLM } from "../../evals/lib/signal-llm";

const req = (input: string) => ({ purpose: "extract", model: "extract" as const, system: "", input, schema: ExtractionSchema, timeoutMs: 1000, maxTokens: 100 });

test("fills the relationship block from the newest scripted turn in the new exchange", async () => {
  const llm = new SignalLLM(new FakeLLMProvider(), new Map([["you are boring", { hurt: { amount: 0.8, cause: "the user called her boring" } }], ["sorry", { apology: true }]]));
  const input = "Earlier conversation (context only, do not extract from it):\n[x] User: sorry\n\nNew exchange (extract from this):\n[x] User: you are boring\n[x] Spica: ok";
  const out = (await llm.classifyJson(req(input))) as { relationship: { hurt: unknown; apology: boolean; warmth: number } };
  expect(out.relationship).toMatchObject({ hurt: { amount: 0.8 }, apology: false, warmth: 0 });
});

test("no scripted turn in the exchange: inner result untouched; other purposes pass through", async () => {
  const llm = new SignalLLM(new FakeLLMProvider(), new Map([["sorry", { apology: true }]]));
  expect(((await llm.classifyJson(req("New exchange (extract from this):\n[x] User: hi"))) as { relationship: unknown }).relationship).toBeNull();
});
