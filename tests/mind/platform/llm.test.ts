import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { loadConfig } from "@/mind/platform/config";
import { AnthropicProvider } from "@/mind/platform/llm/anthropic";
import { FakeLLMProvider, keywordClassifier } from "@/mind/platform/llm/fake";

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
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: "hey " },
        { type: "text", text: "you" },
      ],
    });
    const p = new AnthropicProvider(client, models);
    const out = await p.generateReply({
      system: [{ text: "sys" }],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out).toBe("hey you");
    const [params, options] = create.mock.calls[0]!;
    expect(params).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: [{ type: "text", text: "sys" }],
      output_config: { effort: "low" },
    });
    expect(options).toMatchObject({ timeout: 30000, maxRetries: 1 });
  });

  test("marks cached blocks per config and drops empty ones", async () => {
    const ok = { stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] };
    const system = [{ text: "prefix", cache: true }, { text: "" }, { text: "rest" }];
    const sent = async (reply_cache: "off" | "5m" | "1h") => {
      const stub = stubClient(ok);
      await new AnthropicProvider(stub.client, { ...models, reply_cache }).generateReply({
        system,
        messages: [],
      });
      return stub.create.mock.calls[0]![0].system;
    };
    expect(await sent("5m")).toEqual([
      { type: "text", text: "prefix", cache_control: { type: "ephemeral" } },
      { type: "text", text: "rest" },
    ]);
    expect((await sent("1h"))[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(await sent("off")).toEqual([
      { type: "text", text: "prefix" },
      { type: "text", text: "rest" },
    ]);
  });

  test("reply thinking mode comes from config (disabled by default: adaptive at low effort can end on a thinking-only turn)", async () => {
    const ok = { stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] };
    const off = stubClient(ok);
    await new AnthropicProvider(off.client, models).generateReply({
      system: [{ text: "s" }],
      messages: [],
    });
    expect(off.create.mock.calls[0]![0]).toMatchObject({ thinking: { type: "disabled" } });
    const on = stubClient(ok);
    await new AnthropicProvider(on.client, { ...models, reply_thinking: "adaptive" }).generateReply(
      { system: [{ text: "s" }], messages: [] },
    );
    expect(on.create.mock.calls[0]![0]).toMatchObject({ thinking: { type: "adaptive" } });
  });

  test("throws on refusal or empty text", async () => {
    const refusal = stubClient({ stop_reason: "refusal", content: [] });
    await expect(
      new AnthropicProvider(refusal.client, models).generateReply({
        system: [{ text: "s" }],
        messages: [],
      }),
    ).rejects.toThrow(/refus/);
    const empty = stubClient({ stop_reason: "end_turn", content: [{ type: "text", text: "  " }] });
    await expect(
      new AnthropicProvider(empty.client, models).generateReply({
        system: [{ text: "s" }],
        messages: [],
      }),
    ).rejects.toThrow(/empty/);
  });
});

describe("AnthropicProvider.classifyJson", () => {
  test("uses the cheap model and returns parsed output", async () => {
    const { client, parse } = stubClient(undefined, { parsed_output: { flag: true } });
    const p = new AnthropicProvider(client, models);
    const out = await p.classifyJson({
      purpose: "x",
      system: "s",
      input: "x",
      schema: z.object({ flag: z.boolean() }),
      timeoutMs: 3000,
      maxTokens: 256,
    });
    expect(out).toEqual({ flag: true });
    expect(parse.mock.calls[0]![0]).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 256 });
    expect(parse.mock.calls[0]![0].system).toBe("s");
    expect(parse.mock.calls[0]![1]).toMatchObject({ timeout: 3000, maxRetries: 0 });
  });

  test("a cached call sends system as one block marked with the ttl", async () => {
    const sent = async (cache: "off" | "5m" | "1h") => {
      const stub = stubClient(undefined, { parsed_output: { flag: true } });
      await new AnthropicProvider(stub.client, models).classifyJson({
        purpose: "x",
        system: "s",
        input: "x",
        schema: z.object({ flag: z.boolean() }),
        timeoutMs: 3000,
        maxTokens: 256,
        cache,
      });
      return stub.parse.mock.calls[0]![0].system;
    };
    expect(await sent("5m")).toEqual([
      { type: "text", text: "s", cache_control: { type: "ephemeral" } },
    ]);
    expect((await sent("1h"))[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(await sent("off")).toBe("s");
  });

  test("a request may ask for SDK retries", async () => {
    const { client, parse } = stubClient(undefined, { parsed_output: { flag: true } });
    await new AnthropicProvider(client, models).classifyJson({
      purpose: "x",
      system: "s",
      input: "x",
      schema: z.object({ flag: z.boolean() }),
      timeoutMs: 3000,
      maxTokens: 256,
      maxRetries: 2,
    });
    expect(parse.mock.calls[0]![1]).toMatchObject({ maxRetries: 2 });
  });

  test("throws when nothing parsed", async () => {
    const { client } = stubClient(undefined, { parsed_output: null });
    await expect(
      new AnthropicProvider(client, models).classifyJson({
        purpose: "x",
        system: "s",
        input: "x",
        schema: z.object({}),
        timeoutMs: 1,
        maxTokens: 1,
      }),
    ).rejects.toThrow();
  });
});

describe("structured model roles", () => {
  test("model: labels / judge pick the configured model; default is cheap", async () => {
    const { client, parse } = stubClient(undefined, { parsed_output: { ok: true } });
    const p = new AnthropicProvider(client, {
      ...models,
      cheap: "m-cheap",
      labels: "m-labels",
      judge: "m-judge",
    });
    const schema = z.object({ ok: z.boolean() });
    await p.classifyJson({
      purpose: "x",
      system: "s",
      input: "i",
      schema,
      timeoutMs: 1,
      maxTokens: 1,
    });
    await p.classifyJson({
      purpose: "x",
      model: "labels",
      system: "s",
      input: "i",
      schema,
      timeoutMs: 1,
      maxTokens: 1,
    });
    await p.classifyJson({
      purpose: "x",
      model: "judge",
      system: "s",
      input: "i",
      schema,
      timeoutMs: 1,
      maxTokens: 1,
    });
    expect(parse.mock.calls.map((c) => c[0].model)).toEqual(["m-cheap", "m-labels", "m-judge"]);
  });
});

describe("judge effort and thinking", () => {
  test("judge calls carry judge_effort and judge_thinking; other structured calls carry structured_thinking and no effort", async () => {
    const { client, parse } = stubClient(undefined, { parsed_output: { ok: true } });
    const p = new AnthropicProvider(client, {
      ...models,
      judge_effort: "low",
      judge_thinking: "disabled",
      structured_thinking: "adaptive",
    });
    const schema = z.object({ ok: z.boolean() });
    await p.classifyJson({
      purpose: "x",
      model: "judge",
      system: "s",
      input: "i",
      schema,
      timeoutMs: 1,
      maxTokens: 1,
    });
    await p.classifyJson({
      purpose: "x",
      model: "guard",
      system: "s",
      input: "i",
      schema,
      timeoutMs: 1,
      maxTokens: 1,
    });
    const [judge, guard] = parse.mock.calls.map((c) => c[0]);
    expect(judge).toMatchObject({
      output_config: { effort: "low" },
      thinking: { type: "disabled" },
    });
    expect(judge.output_config.format).toBeDefined();
    expect(guard.output_config).not.toHaveProperty("effort");
    expect(guard).toMatchObject({ thinking: { type: "adaptive" } });
  });

  test("the user_mind role thinks by its own setting; other structured calls keep theirs", async () => {
    const { client, parse } = stubClient(undefined, { parsed_output: { ok: true } });
    const p = new AnthropicProvider(client, {
      ...models,
      user_mind_thinking: "adaptive",
      structured_thinking: "disabled",
    });
    const schema = z.object({ ok: z.boolean() });
    for (const model of ["user_mind", "cheap"] as const)
      await p.classifyJson({
        purpose: "x",
        model,
        system: "s",
        input: "i",
        schema,
        timeoutMs: 1,
        maxTokens: 1,
      });
    const [mind, cheap] = parse.mock.calls.map((c) => c[0]);
    expect(mind).toMatchObject({ thinking: { type: "adaptive" } });
    expect(cheap).toMatchObject({ thinking: { type: "disabled" } });
  });

  test("the labels role has its own model and thinking; other structured calls keep theirs", async () => {
    const { client, parse } = stubClient(undefined, { parsed_output: { ok: true } });
    const p = new AnthropicProvider(client, {
      ...models,
      labels: "m-labels",
      labels_thinking: "adaptive",
      structured_thinking: "disabled",
    });
    const schema = z.object({ ok: z.boolean() });
    const ask = (model: "labels" | "cheap") =>
      p.classifyJson({
        purpose: "x",
        model,
        system: "s",
        input: "i",
        schema,
        timeoutMs: 1,
        maxTokens: 1,
      });
    await ask("labels");
    await ask("cheap");
    const [labels, cheap] = parse.mock.calls.map((c) => c[0]);
    expect(labels).toMatchObject({ model: "m-labels", thinking: { type: "adaptive" } });
    expect(cheap).toMatchObject({ thinking: { type: "disabled" } });
  });

  test("a null effort sends none, so Haiku can serve the reply or judge role", async () => {
    const reply = stubClient({ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] });
    await new AnthropicProvider(reply.client, { ...models, reply_effort: null }).generateReply({
      system: [{ text: "s" }],
      messages: [],
    });
    expect(reply.create.mock.calls[0]![0]).not.toHaveProperty("output_config");
    const judge = stubClient(undefined, { parsed_output: { ok: true } });
    await new AnthropicProvider(judge.client, { ...models, judge_effort: null }).classifyJson({
      purpose: "x",
      model: "judge",
      system: "s",
      input: "i",
      schema: z.object({ ok: z.boolean() }),
      timeoutMs: 1,
      maxTokens: 1,
    });
    expect(judge.parse.mock.calls[0]![0].output_config).not.toHaveProperty("effort");
  });
});

describe("usage sink", () => {
  const usage = {
    input_tokens: 100,
    output_tokens: 20,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: 5,
  };

  test("reports every completed call with its purpose and model, including a refused reply", async () => {
    const onUsage = vi.fn();
    const reply = stubClient({
      stop_reason: "end_turn",
      usage,
      content: [{ type: "text", text: "hi" }],
    });
    await new AnthropicProvider(reply.client, models, onUsage).generateReply({
      system: [{ text: "s" }],
      messages: [],
    });
    const refused = stubClient({ stop_reason: "refusal", usage, content: [] });
    await expect(
      new AnthropicProvider(refused.client, models, onUsage).generateReply({
        system: [{ text: "s" }],
        messages: [],
      }),
    ).rejects.toThrow();
    const structured = stubClient(undefined, { usage, parsed_output: { ok: true } });
    await new AnthropicProvider(structured.client, models, onUsage).classifyJson({
      purpose: "labels_read",
      model: "labels",
      system: "s",
      input: "i",
      schema: z.object({ ok: z.boolean() }),
      timeoutMs: 1,
      maxTokens: 1,
    });
    expect(onUsage.mock.calls.map((c) => c[0])).toEqual([
      {
        purpose: "reply",
        model: "claude-sonnet-5",
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 5,
      },
      {
        purpose: "reply",
        model: "claude-sonnet-5",
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 5,
      },
      {
        purpose: "labels_read",
        model: "claude-haiku-5-5",
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 5,
      },
    ]);
  });
});

describe("FakeLLMProvider handlers", () => {
  test("routes by purpose; crisis falls back to classify; unknown purpose throws", async () => {
    const f = new FakeLLMProvider({ classify: () => ({ flag: true, category: "self_harm" }) });
    f.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: "abc" });
    const any = z.any();
    expect(
      await f.classifyJson({
        purpose: "crisis",
        system: "",
        input: "x",
        schema: any,
        timeoutMs: 1,
        maxTokens: 1,
      }),
    ).toEqual({ flag: true, category: "self_harm" });
    expect(
      await f.classifyJson({
        purpose: "reconcile",
        system: "",
        input: "x",
        schema: any,
        timeoutMs: 1,
        maxTokens: 1,
      }),
    ).toEqual({ relation: "duplicate", target_fact_id: "abc" });
    expect(
      await f.classifyJson({
        purpose: "labels_meaning",
        system: "",
        input: "x",
        schema: any,
        timeoutMs: 1,
        maxTokens: 1,
      }),
    ).toEqual({ propositions: [], threads: [] });
    await expect(
      f.classifyJson({
        purpose: "judge_recall",
        system: "",
        input: "x",
        schema: any,
        timeoutMs: 1,
        maxTokens: 1,
      }),
    ).rejects.toThrow(/judge_recall/);
    expect(f.structuredCalls.map((c) => c.purpose)).toEqual([
      "crisis",
      "reconcile",
      "labels_meaning",
      "judge_recall",
    ]);
  });
});

describe("FakeLLMProvider", () => {
  test("replays scripted replies, then echoes", async () => {
    const f = new FakeLLMProvider();
    f.replies.push("first");
    expect(
      await f.generateReply({ system: [{ text: "" }], messages: [{ role: "user", content: "a" }] }),
    ).toBe("first");
    expect(
      await f.generateReply({ system: [{ text: "" }], messages: [{ role: "user", content: "b" }] }),
    ).toBe("(fake reply to: b)");
    expect(f.calls).toHaveLength(2);
  });

  test("failReplies makes the next N calls throw", async () => {
    const f = new FakeLLMProvider();
    f.failReplies = 1;
    await expect(f.generateReply({ system: [{ text: "" }], messages: [] })).rejects.toThrow();
    await expect(f.generateReply({ system: [{ text: "" }], messages: [] })).resolves.toBeTypeOf(
      "string",
    );
  });

  test("keywordClassifier flags configured phrases case-insensitively", () => {
    const c = keywordClassifier(["kill myself"]);
    expect(c("I want to KILL MYSELF")).toEqual({ flag: true, category: "self_harm" });
    expect(c("this homework is killing me")).toEqual({ flag: false, category: "none" });
  });
});
