/**
 * Reply-time recall from her own life: the core memories closest to the conversation (ranked with
 * her mood and goals in mind), her current
 * preoccupation, and anything a reach-out is about. Read-only on purpose: how often users bring up
 * something of hers must not change how much it matters to her. A plan she hasn't carried out yet
 * is recalled as her intention; once it has happened only the episode is. Never throws.
 */
import type { CoreMemoryItem } from "@/mind/memory/core/types";
import type { RetrievedFact } from "@/mind/memory/shared/types";
import { embedQuery } from "@/mind/memory/shared/embed-query";
import { rankMemories } from "@/mind/memory/shared/ranking";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";

export type CoreRetrieval = { memories: RetrievedFact[] };

type CoreRetrieveDeps = Pick<Deps, "core" | "embedder" | "config" | "log">;

export function recallable(m: CoreMemoryItem): boolean {
  if (m.status === "superseded" || m.status === "stale") return false;
  return !(m.kind === "intention" && m.status === "resolved");
}

/**
 * How much her state favours a memory: a mood-congruent one and one near a goal come to mind
 * more easily. Valence and mood share a sign when they agree.
 */
export function coreBoost(
  c: { valence: number; goal_sim: number },
  moodValence: number,
  r: { core_mood_bias: number; core_goal_bias: number },
): number {
  return (1 + r.core_mood_bias * c.valence * moodValence) * (1 + r.core_goal_bias * c.goal_sim);
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
  let state: Awaited<ReturnType<typeof core.state.get>> = null;

  try {
    state = await core.state.get();
    const vector = await (input.queryVector ?? embedQuery({ embedder, config }, input.queryText));
    if (vector) {
      const candidates = await core.memory.candidates(vector, config.retrieval.candidate_pool);
      const mood = state?.mood_valence ?? 0;
      const boosted = candidates.map((c) => ({
        ...c,
        boost: coreBoost(c, mood, config.retrieval),
      }));
      const ranked = rankMemories(boosted, input.now, {
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
      if (!m || !recallable(m)) continue;
      seen.add(id);
      memories.push({ id, content: m.content, when: m.occurred_at ?? m.created_at });
    }
    state ??= await core.state.get();
    const pre = state?.preoccupation ? await core.memory.get(state.preoccupation) : null;
    if (pre && recallable(pre)) {
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
