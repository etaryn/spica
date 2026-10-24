/**
 * The labelling replay's run loop: each exchange is labelled as it ends, seeing the conversation
 * so far and what is already labelled in it, in two calls: a reading call (moves, mentions, times)
 * and a meaning call that sees what was read. They can run on different models (thinking or not).
 * A call that fails is recorded and the loop moves on: nothing is asked again.
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

/** One labelling: which messages it labelled, its checked labels, or why it failed. */
export type CallResult = { messages: string; labels: CheckedLabels | null; error: string | null };
export type ReplayModels = { read: LLMProvider; meaning: LLMProvider };
export type ReplayOptions = {
  system: string;
  readTokens: number;
  meaningTokens: number;
  timeoutMs: number;
};

export const conversationKey = (c: ReplayConversation) => `${c.run}/${c.id}`;

export async function runReplay(
  models: ReplayModels,
  conversations: ReplayConversation[],
  opts: ReplayOptions,
): Promise<Map<string, CallResult[]>> {
  const calls = new Map<string, CallResult[]>();
  for (const c of conversations) {
    const messages = messagesOf([...c.before, ...c.turns]);
    const results: CallResult[] = [];
    let earlier = emptyLabels();
    let labelledUpTo = c.before.length;
    for (const exchange of c.exchanges) {
      const end = messages.findIndex((m) => m.id === exchange.replyId) + 1;
      const shown = messages.slice(0, end);
      const result = await label(models, opts, c, shown, labelledUpTo, exchange, earlier);
      if (result.labels) earlier = mergeLabels(earlier, result.labels);
      results.push(result);
      labelledUpTo = end;
    }
    calls.set(conversationKey(c), results);
  }
  return calls;
}

async function label(
  models: ReplayModels,
  opts: ReplayOptions,
  c: ReplayConversation,
  messages: Message[],
  firstNew: number,
  shown: ReplayExchange,
  earlier: CheckedLabels,
): Promise<CallResult> {
  const pieces = numberPieces(messages, firstNew);
  const range = `${firstNew + 1} to ${messages.length}`;
  const ctx = { pieces, zone: c.zone, threadIds: shown.threads.map((t) => t.id), earlier };
  const ask = <T>(stage: keyof ReplayModels, schema: z.ZodType<T>, known: CheckedLabels) =>
    models[stage]
      .classifyJson({
        purpose: `extract_labels_${stage}`,
        model: "extract",
        system: opts.system,
        input: buildLabelInput({
          pieces,
          zone: c.zone,
          threads: shown.threads,
          interests: shown.interests,
          earlier: known,
        }),
        schema,
        timeoutMs: opts.timeoutMs,
        maxTokens: stage === "read" ? opts.readTokens : opts.meaningTokens,
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
