/** Prepares core thoughts outside write transactions and stores accepted items in one core scope. */
import type { CoreLoopName } from "@/mind/platform/config";
import type { CoreScope } from "@/mind/platform/core";
import type { LoopStatus } from "@/mind/platform/core";
import type { CoreDeps } from "@/mind/platform/deps";
import { fitChars } from "@/mind/platform/llm/fit";
import type { CoreMemoryItem } from "@/mind/memory/core/types";
import type { CoreStateRow } from "@/mind/state/core/types";
import { z } from "zod";

/** Thinking takes the world tick's lock, so a thought never lands beside a half-applied event. */
export const WORLD_LOCK = "core_world_tick";

export type ApplyOutput = {
  applied: boolean;
  ids: string[];
  dropped: ReturnType<typeof traceDrops>;
  reason?: string;
};

/** The world event a memory came from, or null when its source isn't a valid event reference. */
export function worldEventId(item: CoreMemoryItem): string | null {
  const match = /^world_event:(.+)$/.exec(item.source_ref ?? "");
  return match && z.uuid().safeParse(match[1]).success ? match[1]! : null;
}

export function moodLine(state: CoreStateRow | null): string {
  if (!state) return "How she is now: unknown";
  const feeling = state.emotion ? `, feeling ${state.emotion.label}` : "";
  return `How she is now: mood valence ${state.mood_valence.toFixed(2)}, arousal ${state.mood_arousal.toFixed(2)}${feeling}`;
}

export type ThinkingResult = { status: LoopStatus | "not_due"; applied: boolean; ids: string[] };

export type ThoughtInput = {
  kind: "thought" | "idea" | "hypothetical";
  content: string;
  salience: "low" | "medium";
};

export type PreparedThought = { item: ThoughtInput; embedding: number[] };

export const traceDrops = (dropped: string[]) =>
  dropped.map((content) => ({ content, reason: "dedupe" as const }));

function validItem(item: ThoughtInput, maxChars: number): ThoughtInput {
  if (
    !item ||
    !["thought", "idea", "hypothetical"].includes(item.kind) ||
    !["low", "medium"].includes(item.salience) ||
    typeof item.content !== "string"
  ) {
    throw new Error("invalid thought item");
  }
  const content = fitChars(item.content.trim(), maxChars);
  if (!content) throw new Error("invalid thought content");
  return { kind: item.kind, content, salience: item.salience };
}

function validEmbedding(embedding: number[], dimensions: number): number[] {
  if (
    !Array.isArray(embedding) ||
    embedding.length !== dimensions ||
    !embedding.every((value) => typeof value === "number" && Number.isFinite(value)) ||
    !embedding.some((value) => value !== 0)
  ) {
    throw new Error("invalid thought embedding");
  }
  return embedding;
}

export async function prepareThoughts(
  deps: CoreDeps,
  items: ThoughtInput[],
): Promise<PreparedThought[]> {
  const normalized = items.map((item) => validItem(item, deps.config.core.loops.max_chars));
  if (!normalized.length) return [];
  const embeddings = await deps.embedder.embed(
    normalized.map((item) => item.content),
    "document",
  );
  if (embeddings.length !== normalized.length) throw new Error("invalid thought embedding batch");
  return normalized.map((item, index) => ({
    item,
    embedding: validEmbedding(embeddings[index]!, deps.config.embedding.dimensions),
  }));
}

export async function storeThoughts(
  tx: CoreScope,
  deps: Pick<CoreDeps, "config">,
  items: PreparedThought[],
  meta: {
    loop: CoreLoopName;
    traceId: string;
    now: Date;
    valence: number;
    payload: Record<string, unknown>;
    entityRefs: string[];
  },
): Promise<{ ids: string[]; dropped: string[] }> {
  // Validate the complete batch before the first write, including callers that bypass preparation.
  const validated = items.map(({ item, embedding }) => ({
    item: validItem(item, deps.config.core.loops.max_chars),
    embedding: validEmbedding(embedding, deps.config.embedding.dimensions),
  }));
  const ids: string[] = [];
  const dropped: string[] = [];
  for (const { item, embedding } of validated) {
    const [nearest] = await tx.memory.dedupeNear(
      embedding,
      1,
      deps.config.core.loops.dedupe_similarity,
    );
    if (nearest && nearest.sim > deps.config.core.loops.dedupe_similarity) {
      dropped.push(item.content);
      continue;
    }
    ids.push(
      await tx.memory.insert({
        kind: item.kind,
        content: item.content,
        payload: meta.payload,
        embedding,
        entity_refs: meta.entityRefs,
        occurred_at: meta.now,
        created_at: meta.now,
        status: "recurring",
        salience: deps.config.core.loops.salience[item.salience],
        valence: meta.valence,
        confidence: deps.config.core.loops.thought_confidence,
        source: "loop",
        source_ref: `${meta.loop}:${meta.traceId}`,
      }),
    );
  }
  return { ids, dropped };
}
