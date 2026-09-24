import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { FakeLLMProvider } from "@/core/llm/fake";
import type { ExtractedFact } from "@/core/memory/extract";
import { decide } from "@/core/memory/reconcile";

const config = loadConfig();
const cand: ExtractedFact = {
  subject: "user", kind: "event", content: "Mia starts university in November.", occurred_at: null,
  salience: 0.7, valence: 0.3, confidence: 0.95, entity_names: ["Mia"], thread_title: null,
};
const n = (id: string) => ({ id, content: "Mia starts university in October.", status: "open", sim: 0.9 });

test("no neighbors → new, without an LLM call", async () => {
  const llm = new FakeLLMProvider();
  expect(await decide({ llm, config }, cand, [])).toEqual({ relation: "new", targetId: null });
  expect(llm.structuredCalls).toEqual([]);
});

test("classifier decision is applied when the target is one of the neighbors", async () => {
  const llm = new FakeLLMProvider();
  const id = "11111111-1111-4111-8111-111111111111";
  llm.handlers.reconcile = () => ({ relation: "contradicts", target_fact_id: id });
  expect(await decide({ llm, config }, cand, [n(id)])).toEqual({ relation: "contradicts", targetId: id });
  expect(llm.structuredCalls[0]!.input).toContain(`id=${id}`);
});

test("foreign target id → new; non-new relation without target → new", async () => {
  const llm = new FakeLLMProvider();
  llm.handlers.reconcile = () => ({ relation: "duplicate", target_fact_id: "22222222-2222-4222-8222-222222222222" });
  expect(await decide({ llm, config }, cand, [n("11111111-1111-4111-8111-111111111111")])).toEqual({ relation: "new", targetId: null });
  llm.handlers.reconcile = () => ({ relation: "resolves", target_fact_id: null });
  expect(await decide({ llm, config }, cand, [n("11111111-1111-4111-8111-111111111111")])).toEqual({ relation: "new", targetId: null });
});
