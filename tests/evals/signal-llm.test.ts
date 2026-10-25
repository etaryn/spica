import { expect, test } from "vitest";
import { emptyLabels, PropositionsSchema, SignalsSchema } from "@/mind/memory/user/annotations";
import { buildLabelInput } from "@/mind/memory/user/label-input";
import { numberPieces, type Message } from "@/mind/memory/user/pieces";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { SignalLLM } from "../../evals/lib/signal-llm";

const at = new Date("2026-01-05T09:00:00Z");
/** A labelling input whose messages from `firstNew` on are new. */
function input(texts: [Message["speaker"], string][], firstNew: number): string {
  const messages = texts.map(([speaker, text], i) => ({ id: `t${i}`, speaker, text, at }));
  return buildLabelInput({
    pieces: numberPieces(messages, firstNew),
    zone: "UTC",
    threads: [],
    interests: [],
    earlier: emptyLabels(),
  });
}
const req = (text: string) => ({
  purpose: "labels_signals",
  model: "labels" as const,
  system: "",
  input: text,
  schema: SignalsSchema,
  timeoutMs: 1000,
  maxTokens: 100,
});

test("fills the relationship block from the newest scripted user message among the new ones", async () => {
  const llm = new SignalLLM(
    new FakeLLMProvider(),
    new Map([
      ["you are boring", { hurt: { amount: 0.8, cause: "the user called her boring" } }],
      ["sorry", { apology: true }],
    ]),
  );
  const text = input(
    [
      ["user", "sorry"],
      ["user", "you are boring"],
      ["spica", "ok"],
    ],
    1,
  );
  const out = (await llm.classifyJson(req(text))) as {
    relationship: { hurt: unknown; apology: boolean; warmth: number };
  };
  expect(out.relationship).toMatchObject({
    hurt: { amount: 0.8, moves: [] },
    apology: false,
    warmth: 0,
  });
});

test("no scripted message among the new ones: relationship forced to null; the rest is untouched", async () => {
  const inner = new FakeLLMProvider();
  inner.handlers.labels_signals = () => ({
    idiolect: [{ id: "i1", pieces: ["1.1"], type: "joke" }],
    relationship: {
      warmth: 1,
      trust: 0,
      tension: 0,
      hurt: null,
      apology: false,
      make_up: false,
      ends_relationship: false,
      retracts_ending: false,
      wants_repair: false,
      moves: [],
    },
    intimacy: null,
    bid_response: null,
  });
  const llm = new SignalLLM(inner, new Map([["sorry", { apology: true }]]));
  const out = (await llm.classifyJson(req(input([["user", "hi"]], 0)))) as {
    relationship: unknown;
    idiolect: unknown[];
  };
  expect(out.relationship).toBeNull();
  expect(out.idiolect).toHaveLength(1);
});

test("other calls pass through untouched", async () => {
  const llm = new SignalLLM(new FakeLLMProvider(), new Map([["hi", { apology: true }]]));
  const out = (await llm.classifyJson({
    ...req(input([["user", "hi"]], 0)),
    purpose: "labels_meaning",
    schema: PropositionsSchema,
  })) as { relationship?: unknown };
  expect(out.relationship).toBeUndefined();
});
