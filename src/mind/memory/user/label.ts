/**
 * Labelling one stretch of conversation: three calls, each thinking, each seeing what the calls
 * before it labelled. The first reads what the text holds (moves, mentions, times), the second
 * what it means (memories, threads), the third what it says about them (idiolect, how the user
 * treated her). Code checks every label against the transcript; a call that fails fails the
 * labelling, and nothing is asked again.
 */
import type { z } from "zod";
import type { Deps } from "@/mind/platform/deps";
import { loadPrompt } from "@/mind/platform/prompts";
import {
  checkLabels,
  loosen,
  mergeLabels,
  PropositionsSchema,
  ReadingSchema,
  SignalsSchema,
  sieve,
  type CheckedLabels,
  type Drop,
  type Labels,
} from "./annotations";
import { buildLabelInput, type ShownThread } from "./label-input";
import type { Piece } from "./pieces";

export const LABEL_PURPOSES = ["labels_read", "labels_meaning", "labels_signals"] as const;
type Purpose = (typeof LABEL_PURPOSES)[number];

export type Stretch = {
  pieces: Piece[];
  zone: string;
  threads: ShownThread[];
  interests: string[];
  /** What earlier calls labelled in this conversation. */
  earlier: CheckedLabels;
};

const NO_MEANING = { propositions: [], threads: [] } satisfies Pick<
  Labels,
  "propositions" | "threads"
>;
const NO_SIGNALS = {
  idiolect: [],
  relationship: null,
  intimacy: null,
  bid_response: null,
} satisfies Pick<Labels, "idiolect" | "relationship" | "intimacy" | "bid_response">;

/** The new messages' labels, checked; `earlier` is not repeated in them. */
export async function labelStretch(
  deps: Pick<Deps, "llm" | "config">,
  s: Stretch,
): Promise<CheckedLabels> {
  const { config } = deps;
  const ctx = {
    pieces: s.pieces,
    zone: s.zone,
    threadIds: s.threads.map((t) => t.id),
    earlier: s.earlier,
  };
  const drops: Drop[] = [];
  const ask = async <S extends z.ZodObject>(
    purpose: Purpose,
    schema: S,
    known: CheckedLabels,
  ): Promise<z.infer<S>> => {
    const raw = await deps.llm
      .classifyJson({
        purpose,
        model: "labels",
        system: loadPrompt("labels", config.prompts.labels),
        input: buildLabelInput({ ...s, earlier: known }),
        schema: loosen(schema),
        timeoutMs: config.models.labels_timeout_ms,
        maxTokens: config.models.labels_max_tokens,
        cache: config.models.labels_cache,
      })
      .catch((e: unknown) => {
        throw new Error(`${purpose}: ${(e as Error).message}`, { cause: e });
      });
    const { labels, drops: bad } = sieve(raw, schema);
    drops.push(...bad);
    return labels;
  };

  const read = await ask("labels_read", ReadingSchema, s.earlier);
  const afterRead = checkLabels({ ...read, ...NO_MEANING, ...NO_SIGNALS }, ctx);
  const meant = await ask("labels_meaning", PropositionsSchema, mergeLabels(s.earlier, afterRead));
  const afterMeaning = checkLabels({ ...read, ...meant, ...NO_SIGNALS }, ctx);
  const signals = await ask("labels_signals", SignalsSchema, mergeLabels(s.earlier, afterMeaning));
  const out = checkLabels({ ...read, ...meant, ...signals }, ctx);
  return { ...out, drops: [...drops, ...out.drops] };
}
