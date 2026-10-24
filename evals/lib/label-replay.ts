/**
 * The labelling replay's run loop: one processing unit over many conversations. Exchange mode
 * labels each exchange as it ends, seeing the conversation so far and what is already labelled in
 * it; conversation mode labels a whole conversation in one call. A call that fails is recorded and
 * the loop moves on: nothing is asked again.
 */
import type { z } from "zod";
import {
  checkLabels,
  emptyLabels,
  MeaningSchema,
  mergeLabels,
  ReadingSchema,
  type CheckedLabels,
} from "@/mind/memory/user/annotations";
import { buildLabelInput } from "@/mind/memory/user/label-input";
import { messagesOf } from "@/mind/memory/user/layers";
import { numberPieces, type Message } from "@/mind/memory/user/pieces";
import type { LLMProvider } from "@/mind/platform/llm/types";
import type { ReplayConversation, ReplayExchange } from "./replay-source";

export type Unit = "exchange" | "conversation";
/** One call: which messages it labelled, its checked labels, or why it failed. */
export type CallResult = { messages: string; labels: CheckedLabels | null; error: string | null };
export type UnitResult = { unit: Unit; thinking: boolean; calls: Map<string, CallResult[]> };
export type UnitOptions = {
  system: string;
  thinking: boolean;
  maxTokens: number;
  timeoutMs: number;
};

export const conversationKey = (c: ReplayConversation) => `${c.run}/${c.id}`;

export async function runUnit(
  llm: LLMProvider,
  unit: Unit,
  conversations: ReplayConversation[],
  opts: UnitOptions,
): Promise<UnitResult> {
  const calls = new Map<string, CallResult[]>();
  for (const c of conversations) {
    calls.set(
      conversationKey(c),
      unit === "exchange" ? await byExchange(llm, c, opts) : [await whole(llm, c, opts)],
    );
  }
  return { unit, thinking: opts.thinking, calls };
}

async function byExchange(
  llm: LLMProvider,
  c: ReplayConversation,
  opts: UnitOptions,
): Promise<CallResult[]> {
  const messages = messagesOf([...c.before, ...c.turns]);
  const results: CallResult[] = [];
  let earlier = emptyLabels();
  let labelledUpTo = c.before.length;
  for (const exchange of c.exchanges) {
    const end = messages.findIndex((m) => m.id === exchange.replyId) + 1;
    const shown = messages.slice(0, end);
    const result = await label(llm, "exchange", opts, c, shown, labelledUpTo, exchange, earlier);
    if (result.labels) earlier = mergeLabels(earlier, result.labels);
    results.push(result);
    labelledUpTo = end;
  }
  return results;
}

async function whole(
  llm: LLMProvider,
  c: ReplayConversation,
  opts: UnitOptions,
): Promise<CallResult> {
  const messages = messagesOf([...c.before, ...c.turns]);
  // The threads open when the conversation began, as its first exchange was shown them.
  const shown = c.exchanges[0] ?? null;
  return label(llm, "conversation", opts, c, messages, c.before.length, shown, emptyLabels());
}

async function label(
  llm: LLMProvider,
  unit: Unit,
  opts: UnitOptions,
  c: ReplayConversation,
  messages: Message[],
  firstNew: number,
  shown: ReplayExchange | null,
  earlier: CheckedLabels,
): Promise<CallResult> {
  const pieces = numberPieces(messages, firstNew);
  const threads = shown?.threads ?? [];
  const range = `${firstNew + 1} to ${messages.length}`;
  const ctx = { pieces, zone: c.zone, threadIds: threads.map((t) => t.id), earlier };
  const ask = <T>(stage: "read" | "meaning", schema: z.ZodType<T>, known: CheckedLabels) =>
    llm
      .classifyJson({
        purpose: `extract_labels_${unit}${opts.thinking ? "_thinking" : ""}_${stage}`,
        model: "extract",
        system: opts.system,
        input: buildLabelInput({
          pieces,
          zone: c.zone,
          threads,
          interests: shown?.interests ?? [],
          earlier: known,
        }),
        schema,
        timeoutMs: opts.timeoutMs,
        maxTokens: opts.maxTokens,
        cache: "5m",
      })
      .catch((e: unknown) => {
        throw new Error(`${stage}: ${(e as Error).message}`);
      });
  try {
    const read = await ask("read", ReadingSchema, earlier);
    // What was just read counts as already labelled for the meaning call, which points at it.
    const readLabels = checkLabels({ ...read, ...NO_MEANING }, ctx);
    const meant = await ask("meaning", MeaningSchema, mergeLabels(earlier, readLabels));
    return { messages: range, labels: checkLabels({ ...read, ...meant }, ctx), error: null };
  } catch (e) {
    return { messages: range, labels: null, error: (e as Error).message };
  }
}

const NO_MEANING = {
  propositions: [],
  threads: [],
  idiolect: [],
  relationship: null,
  intimacy: null,
  bid_response: null,
} satisfies z.infer<typeof MeaningSchema>;
