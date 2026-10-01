import type { CandidateFact } from "@/db/repos/facts";

const DAY_MS = 86_400_000;

export function recencyFactor(ageDays: number, halfLifeDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

export type Scored = CandidateFact & { recency: number; score: number };

/** score = sim × salience × max(entity salience) × recency(max(created_at, last_recalled_at)). */
export function rankCandidates(
  cands: CandidateFact[], now: Date, cfg: { top_n: number; recency_half_life_days: number },
): Scored[] {
  return cands
    .map((c) => {
      const ref = Math.max(c.created_at.getTime(), c.last_recalled_at?.getTime() ?? 0);
      const recency = recencyFactor((now.getTime() - ref) / DAY_MS, cfg.recency_half_life_days);
      const score = Math.max(0, c.sim) * c.salience * c.entity_salience * recency;
      return { ...c, recency, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.top_n);
}
