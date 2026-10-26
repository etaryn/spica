/**
 * The labelling replay's run loop: each exchange is labelled as it ends, seeing the conversation
 * so far and what is already labelled in it, through the live labelling (`labelStretch`), so the
 * replay always runs the code the cold path runs. A labelling that fails is recorded and the loop
 * moves on: nothing is asked again.
 */
import { emptyLabels, mergeLabels, type CheckedLabels } from "@/mind/memory/user/annotations";
import { labelStretch } from "@/mind/memory/user/label";
import { messagesOf } from "@/mind/memory/user/layers";
import { numberPieces } from "@/mind/memory/user/pieces";
import type { Deps } from "@/mind/platform/deps";
import type { ReplayConversation } from "./replay-source";

/** One labelling: which messages it labelled, its checked labels, or why it failed. */
export type CallResult = { messages: string; labels: CheckedLabels | null; error: string | null };

export const conversationKey = (c: ReplayConversation) => `${c.run}/${c.id}`;

export async function runReplay(
  deps: Pick<Deps, "llm" | "config">,
  conversations: ReplayConversation[],
): Promise<Map<string, CallResult[]>> {
  const calls = new Map<string, CallResult[]>();
  for (const c of conversations) {
    const messages = messagesOf([...c.before, ...c.turns]);
    const results: CallResult[] = [];
    let earlier = emptyLabels();
    let labelledUpTo = c.before.length;
    for (const exchange of c.exchanges) {
      const end = messages.findIndex((m) => m.id === exchange.replyId) + 1;
      const range = `${labelledUpTo + 1} to ${end}`;
      try {
        const labels = await labelStretch(deps, {
          pieces: numberPieces(messages.slice(0, end), labelledUpTo),
          zone: c.zone,
          threads: exchange.threads,
          interests: exchange.interests,
          earlier,
        });
        earlier = mergeLabels(earlier, labels);
        results.push({ messages: range, labels, error: null });
      } catch (e) {
        results.push({ messages: range, labels: null, error: (e as Error).message });
      }
      labelledUpTo = end;
    }
    calls.set(conversationKey(c), results);
  }
  return calls;
}
