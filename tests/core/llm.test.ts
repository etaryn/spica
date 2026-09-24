import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { loadConfig } from "@/core/config";
import { AnthropicProvider } from "@/core/llm/anthropic";
import { FakeLLMProvider, keywordClassifier } from "@/core/llm/fake";

const models = loadConfig().models;

function stubClient(createResult: unknown, parseResult?: unknown) {
  const create = vi.fn().mockResolvedValue(createResult);
  const parse = vi.fn().mockResolvedValue(parseResult);
  return { client: { messages: { create, parse } } as unknown as Anthropic, create, parse };
}

describe("AnthropicProvider.generateReply", () => {
  test("sends model, effort and timeout from config and joins text blocks, ignoring thinking", async () => {
    const { client, create } = stubClient({
      stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "" }, { type: "text", text: "hey " }, { type: "text", text: "you" }],
    });
    const p = new AnthropicProvider(client, models);
    const out = await p.generateReply({ system: "sys", messages: [{ role: "user", content: "hi" }] });
    expect(out).toBe("hey you");
    const [params, options] = create.mock.calls[0]!;
    expect(params).toMatchObject({ model: "claude-sonnet-5", max_tokens: 4096, system: "sys", output_config: { effort: "low" } });
    expect(options).toMatchObject({ timeout: 30000, maxRetries: 1 });
  });

  test("throws on refusal or empty text", async () => {
    const refusal = stubClient({ stop_reason: "refusal", content: [] });
    await expect(new AnthropicProvider(refusal.client, models).generateReply({ system: "s", messages: [] })).rejects.toThrow(/refus/);
    const empty = stubClient({ stop_reason: "end_turn", content: [{ type: "text", text: "  " }] });
    await expect(new AnthropicProvider(empty.client, models).generateReply({ system: "s", messages: [] })).rejects.toThrow(/empty/);
  });
});

describe("AnthropicProvider.classifyJson", () => {
  test("uses the cheap model and returns parsed output", async () => {
    const { client, parse } = stubClient(undefined, { parsed_output: { flag: true } });
    const p = new AnthropicProvider(client, models);
    const out = await p.classifyJson({ purpose: "x", system: "s", input: "x", schema: z.object({ flag: z.boolean() }), timeoutMs: 3000, maxTokens: 256 });
    expect(out).toEqual({ flag: true });
    expect(parse.mock.calls[0]![0]).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 256 });
    expect(parse.mock.calls[0]![1]).toMatchObject({ timeout: 3000, maxRetries: 0 });
  });

  test("throws when nothing parsed", async () => {
    const { client } = stubClient(undefined, { parsed_output: null });
    await expect(new AnthropicProvider(client, models).classifyJson({ purpose: "x", system: "s", input: "x", schema: z.object({}), timeoutMs: 1, maxTokens: 1 })).rejects.toThrow();
  });
});

describe("structured model roles", () => {
  test("model: extract / judge pick the configured model; default is cheap", async () => {
    const { client, parse } = stubClient(undefined, { parsed_output: { ok: true } });
    const p = new AnthropicProvider(client, models);
    const schema = z.object({ ok: z.boolean() });
    await p.classifyJson({ purpose: "x", system: "s", input: "i", schema, timeoutMs: 1, maxTokens: 1 });
    await p.classifyJson({ purpose: "x", model: "extract", system: "s", input: "i", schema, timeoutMs: 1, maxTokens: 1 });
    await p.classifyJson({ purpose: "x", model: "judge", system: "s", input: "i", schema, timeoutMs: 1, maxTokens: 1 });
    expect(parse.mock.calls.map((c) => c[0].model)).toEqual(["claude-haiku-4-5", "claude-haiku-4-5", "claude-sonnet-5"]);
  });
});

describe("FakeLLMProvider handlers", () => {
  test("routes by purpose; crisis falls back to classify; unknown purpose throws", async () => {
    const f = new FakeLLMProvider({ classify: () => ({ flag: true, category: "self_harm" }) });
    f.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: "abc" });
    const any = z.any();
    expect(await f.classifyJson({ purpose: "crisis", system: "", input: "x", schema: any, timeoutMs: 1, maxTokens: 1 }))
      .toEqual({ flag: true, category: "self_harm" });
    expect(await f.classifyJson({ purpose: "reconcile", system: "", input: "x", schema: any, timeoutMs: 1, maxTokens: 1 }))
      .toEqual({ relation: "duplicate", target_fact_id: "abc" });
    expect(await f.classifyJson({ purpose: "extract", system: "", input: "x", schema: any, timeoutMs: 1, maxTokens: 1 }))
      .toEqual({ facts: [], entities: [], threads: [] });
    await expect(f.classifyJson({ purpose: "judge_recall", system: "", input: "x", schema: any, timeoutMs: 1, maxTokens: 1 }))
      .rejects.toThrow(/judge_recall/);
    expect(f.structuredCalls.map((c) => c.purpose)).toEqual(["crisis", "reconcile", "extract", "judge_recall"]);
  });
});

describe("FakeLLMProvider", () => {
  test("replays scripted replies, then echoes", async () => {
    const f = new FakeLLMProvider();
    f.replies.push("first");
    expect(await f.generateReply({ system: "", messages: [{ role: "user", content: "a" }] })).toBe("first");
    expect(await f.generateReply({ system: "", messages: [{ role: "user", content: "b" }] })).toBe("(fake reply to: b)");
    expect(f.calls).toHaveLength(2);
  });

  test("failReplies makes the next N calls throw", async () => {
    const f = new FakeLLMProvider();
    f.failReplies = 1;
    await expect(f.generateReply({ system: "", messages: [] })).rejects.toThrow();
    await expect(f.generateReply({ system: "", messages: [] })).resolves.toBeTypeOf("string");
  });

  test("keywordClassifier flags configured phrases case-insensitively", () => {
    const c = keywordClassifier(["kill myself"]);
    expect(c("I want to KILL MYSELF")).toEqual({ flag: true, category: "self_harm" });
    expect(c("this homework is killing me")).toEqual({ flag: false, category: "none" });
  });
});
