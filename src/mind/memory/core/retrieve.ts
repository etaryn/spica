/**
 * Reply-time recall from her own life: the core memories closest to the conversation, her current
 * preoccupation, and anything a reach-out is about. Read-only on purpose: how often users bring up
 * something of hers must not change how much it matters to her. Memories that haven't happened yet
 * (her day is planned ahead) are never surfaced. Never throws.
 */
import type { RetrievedFact } from "@/mind/memory/shared/types";
import { embedQuery } from "@/mind/memory/shared/embed-query";
import { rankMemories } from "@/mind/memory/shared/ranking";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";

export type CoreRetrieval = { memories: RetrievedFact[] };

type CoreRetrieveDeps = Pick<Deps, "core" | "embedder" | "config" | "log">;

type Datable = { occurred_at: Date | null; created_at: Date };

function happened(m: Datable, now: Date): boolean {
  return (m.occurred_at ?? m.created_at).getTime() <= now.getTime();
}

export async function retrieveCore(
  deps: CoreRetrieveDeps,
  input: {
    queryText: string;
    /** The query already embedded by the caller; null when there's nothing to rank against. */
    queryVector?: Promise<number[] | null>;
    now: Date;
    forceIds?: string[];
  },
): Promise<CoreRetrieval> {
  const { core, embedder, config, log } = deps;
  const memories: RetrievedFact[] = [];
  const seen = new Set<string>();

  try {
    const vector = await (input.queryVector ?? embedQuery({ embedder, config }, input.queryText));
    if (vector) {
      const candidates = (
        await core.memory.candidates(vector, config.retrieval.candidate_pool)
      ).filter((m) => happened(m, input.now));
      const ranked = rankMemories(candidates, input.now, {
        top_n: config.retrieval.core_top_n,
        recency_half_life_days: config.retrieval.recency_half_life_days,
      });
      for (const m of ranked) {
        seen.add(m.id);
        memories.push({ id: m.id, content: m.content, when: m.occurred_at ?? m.created_at });
      }
    }
  } catch (e) {
    log.error("core retrieval degraded", { error: errorName(e) });
  }

  try {
    for (const id of input.forceIds ?? []) {
      if (seen.has(id)) continue;
      const m = await core.memory.get(id);
      if (!m || m.status === "superseded" || m.status === "stale" || !happened(m, input.now)) {
        continue;
      }
      seen.add(id);
      memories.push({ id, content: m.content, when: m.occurred_at ?? m.created_at });
    }
    const state = await core.state.get();
    const pre = state?.preoccupation ? await core.memory.get(state.preoccupation) : null;
    if (pre && pre.status !== "superseded" && pre.status !== "stale" && happened(pre, input.now)) {
      const existing = memories.find((m) => m.id === pre.id);
      if (existing) existing.onMind = true;
      else {
        memories.push({
          id: pre.id,
          content: pre.content,
          when: pre.occurred_at ?? pre.created_at,
          onMind: true,
        });
      }
    }
  } catch (e) {
    log.error("core forced recall failed", { error: errorName(e) });
  }

  return { memories };
}
