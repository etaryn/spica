/** The replay's run loop: exchange mode carries labels forward; a failed call is recorded, not retried. */
import { expect, test } from "vitest";
import type { Labels } from "@/mind/memory/user/annotations";
import { conversations, type LayerTurn } from "@/mind/memory/user/layers";
import type { ClassifyRequest, LLMProvider } from "@/mind/platform/llm/types";
import { conversationKey, runUnit } from "../../evals/lib/label-replay";
import type { ReplayConversation } from "../../evals/lib/replay-source";

class ScriptedLLM implements LLMProvider {
  readonly requests: ClassifyRequest<unknown>[] = [];
  constructor(private readonly outputs: (Labels | Error)[]) {}
  async generateReply(): Promise<string> {
    throw new Error("not used");
  }
  async classifyJson<T>(req: ClassifyRequest<T>): Promise<T> {
    this.requests.push(req as ClassifyRequest<unknown>);
    const out = this.outputs.shift() ?? new Error("no output left");
    if (out instanceof Error) throw out;
    return out as T;
  }
}

const turn = (
  id: string,
  role: LayerTurn["role"],
  minute: number,
  text: string,
  reply_to: string | null = null,
): LayerTurn => ({
  id,
  role,
  text,
  created_at: new Date(Date.UTC(2026, 0, 7, 20, minute)),
  session_id: "s1",
  reply_to,
  trigger: null,
});
const [conversation] = conversations([
  turn("u1", "user", 0, "the interview's thursday"),
  turn("c1", "companion", 1, "good luck!!", "u1"),
  turn("u2", "user", 30, "it went well i think"),
  turn("c2", "companion", 31, "yesss", "u2"),
]);
const c: ReplayConversation = {
  run: "test",
  id: conversation!.id,
  zone: "UTC",
  before: [],
  turns: conversation!.turns,
  exchanges: conversation!.exchanges.map((e) => ({ ...e, threads: [], interests: [], v11: null })),
};
const labels = (moves: Labels["moves"]): Labels => ({
  moves,
  mentions: [],
  times: [],
  propositions: [],
  threads: [],
  idiolect: [],
  relationship: null,
  intimacy: null,
  bid_response: null,
});
const opts = { system: "SYSTEM", thinking: false, maxTokens: 100, timeoutMs: 1000 };

test("exchange mode labels each exchange as it ends, with what came before already labelled", async () => {
  const llm = new ScriptedLLM([
    labels([{ id: "m1", pieces: ["1.1"], act: "states", replies_to: null }]),
    labels([{ id: "m3", pieces: ["3.1"], act: "states", replies_to: null }]),
  ]);
  const result = await runUnit(llm, "exchange", [c], opts);
  expect(llm.requests.map((r) => r.purpose)).toEqual([
    "extract_labels_exchange",
    "extract_labels_exchange",
  ]);
  expect(llm.requests[0]!.input).toContain("Label the new messages (1 to 2).");
  expect(llm.requests[1]!.input).toContain("- m1 states [1.1]");
  expect(llm.requests[1]!.input).toContain("Label the new messages (3 to 4).");
  const calls = result.calls.get(conversationKey(c))!;
  expect(calls.map((x) => [x.messages, x.labels?.moves.map((m) => m.id), x.error])).toEqual([
    ["1 to 2", ["m1"], null],
    ["3 to 4", ["m3"], null],
  ]);
});

test("conversation mode labels the whole conversation in one call, and a failed call is kept as failed", async () => {
  const llm = new ScriptedLLM([new Error("act: invalid enum value")]);
  const result = await runUnit(llm, "conversation", [c], { ...opts, thinking: true });
  expect(llm.requests.map((r) => r.purpose)).toEqual(["extract_labels_conversation_thinking"]);
  expect(llm.requests[0]!.input).toContain("Label the new messages (1 to 4).");
  expect(result.calls.get(conversationKey(c))).toEqual([
    { messages: "1 to 4", labels: null, error: "act: invalid enum value" },
  ]);
});

test("a conversation no reply ever ended is still labelled whole", async () => {
  const lonely: ReplayConversation = { ...c, turns: [c.turns[0]!], exchanges: [] };
  const llm = new ScriptedLLM([labels([])]);
  const result = await runUnit(llm, "conversation", [lonely], opts);
  expect(llm.requests[0]!.input).toContain("Open threads: none");
  expect(result.calls.get(conversationKey(lonely))![0]!.error).toBeNull();
});
