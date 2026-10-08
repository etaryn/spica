import { DAY } from "@/mind/platform/time";
/**
 * Memory ranking: scores each candidate memory by similarity × weight × entity weight × recency
 * and keeps the best few. Pure maths with no data access, so both minds can share it.
 */

/** What ranking needs from a candidate memory, from either mind. */
export type RankableMemory = {
  sim: number;
  salience: number;
  entity_salience: number;
  created_at: Date;
  last_recalled_at: Date | null;
};

export type Scored<M extends RankableMemory = RankableMemory> = M & {
  recency: number;
  score: number;
};

/** Halves every `halfLifeDays`; never above 1, even for a memory dated in the future. */
export function recencyFactor(ageDays: number, halfLifeDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

/**
 * score = similarity × salience × entity salience × recency. Recency counts from the later of
 * when the memory was made and when it was last recalled, so recalling a memory keeps it fresh.
 */
export function rankMemories<M extends RankableMemory>(
  candidates: M[],
  now: Date,
  settings: { top_n: number; recency_half_life_days: number },
): Scored<M>[] {
  const scored = candidates.map((candidate): Scored<M> => {
    const lastTouched = Math.max(
      candidate.created_at.getTime(),
      candidate.last_recalled_at?.getTime() ?? 0,
    );
    const ageDays = (now.getTime() - lastTouched) / DAY;
    const recency = recencyFactor(ageDays, settings.recency_half_life_days);

    const similarity = Math.max(0, candidate.sim);
    const score = similarity * candidate.salience * candidate.entity_salience * recency;
    return { ...candidate, recency, score };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, settings.top_n);
}
