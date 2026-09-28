import { expect, test } from "vitest";
import { z } from "zod";
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

test("no scripted turn in the exchange: relationship forced to null; the rest of the inner result is untouched", async () => {
  const inner = new FakeLLMProvider();
  inner.handlers.extract = () => ({ facts: [{ subject: "user", kind: "event", content: "x", occurred_at: null, salience: 0.5, valence: 0, confidence: 0.5, entity_names: [], thread_title: null }], entities: [], threads: [], relationship: { warmth: 1, trust: 0, tension: 0, hurt: null, apology: false, make_up: false, ends_relationship: false, retracts_ending: false, wants_repair: false } });
  const llm = new SignalLLM(inner, new Map([["sorry", { apology: true }]]));
  const out = (await llm.classifyJson(req("New exchange (extract from this):\n[x] User: hi"))) as { relationship: unknown; facts: unknown[] };
  expect(out.relationship).toBeNull();
  expect(out.facts).toHaveLength(1);
});

test("other purposes pass through unchanged", async () => {
  const llm = new SignalLLM(new FakeLLMProvider(), new Map([["sorry", { apology: true }]]));
  const out = await llm.classifyJson({ purpose: "reconcile", model: "cheap" as const, system: "", input: "x", schema: z.object({ relation: z.string(), target_fact_id: z.string().nullable() }), timeoutMs: 1000, maxTokens: 100 });
  expect(out).toEqual({ relation: "new", target_fact_id: null });
});

test("a scripted text that's a prefix of a longer, unscripted line is not a hit (whole-line match, not substring)", async () => {
  const llm = new SignalLLM(new FakeLLMProvider(), new Map([["sorry", { apology: true }]]));
  const input = "New exchange (extract from this):\n[x] User: sorry I was rude";
  expect(((await llm.classifyJson(req(input))) as { relationship: unknown }).relationship).toBeNull();
});

test("the same text also appears as its own exact line: the newest exact line wins over the longer one", async () => {
  const llm = new SignalLLM(new FakeLLMProvider(), new Map([["sorry", { apology: true }], ["sorry I was rude", { hurt: { amount: 0.5, cause: "x" } }]]));
  const input = "New exchange (extract from this):\n[x] User: sorry I was rude\n[y] Spica: ok\n[z] User: sorry";
  const out = (await llm.classifyJson(req(input))) as { relationship: { apology: boolean; hurt: unknown } };
  expect(out.relationship).toMatchObject({ apology: true, hurt: null });
});
