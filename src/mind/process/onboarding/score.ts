/**
 * How the user and Spica compare on their profile cards: where each sits on the friend
 * dimensions, which lines the gaps earn, and what they have in common. All code, no model call,
 * so the page is free and the same answers always give the same card.
 */
import type { Embedder } from "@/mind/platform/embedder/types";
import { cosine } from "@/mind/platform/math";
import { normalizeAnswer, type Answers, type Quiz } from "./quiz";

export type DimensionScore = {
  id: string;
  left: string;
  right: string;
  basis: string;
  her: number;
  you: number;
  gap: number;
  line: string | null;
};
export type Topic = { yours: string; hers: string };
export type CardView = {
  dimensions: DimensionScore[];
  topics: Topic[];
  noCommon: string | null;
  hers: { prompt: string; answer: string }[];
  yours: { prompt: string; answer: string }[];
};
type Gaps = { click_gap: number; clash_gap: number };

/** 0 fully left, 100 fully right; a pick with no weight for the dimension counts as the middle. */
export function positionOf(quiz: Quiz, answers: Answers, dimensionId: string): number {
  const weights: number[] = [];
  for (const q of quiz.questions) {
    if (q.kind !== "choice") continue;
    if (!q.options.some((o) => dimensionId in o.weights)) continue;
    const picked = q.options[answers[q.id] as number];
    weights.push(picked?.weights[dimensionId] ?? 0);
  }
  if (weights.length === 0) return 50;
  const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
  return Math.round(50 + 50 * mean);
}

export function scoreCard(quiz: Quiz, answers: Answers, cfg: Gaps): DimensionScore[] {
  return quiz.dimensions.map((d) => {
    const you = positionOf(quiz, answers, d.id);
    const gap = Math.abs(you - d.her);
    const line = gap < cfg.click_gap ? d.click : gap > cfg.clash_gap ? d.clash : null;
    return { id: d.id, left: d.left, right: d.right, basis: d.basis, her: d.her, you, gap, line };
  });
}

const key = (s: string) => normalizeAnswer(s).toLowerCase();

/** Each of their open answers against each of hers: an exact match, or close enough in meaning. */
export async function commonTopics(
  quiz: Quiz,
  answers: Answers,
  embedder: Embedder,
  threshold: number,
): Promise<Topic[]> {
  const opens = quiz.questions.filter((q) => q.kind === "open");
  const typed = opens.map((q) => String(answers[q.id] ?? "")).filter((s) => s !== "");
  // The same word in two answers is one topic, not two rows.
  const yours = typed.filter((s, i) => typed.findIndex((t) => key(t) === key(s)) === i);
  const hers = opens.map((q) => q.her);
  if (yours.length === 0) return [];
  // Embedded as queries: as documents, any two short words sit close together and everything matches.
  const vectors = await embedder.embed([...yours, ...hers], "query");
  const topics: Topic[] = [];
  for (const [i, mine] of yours.entries()) {
    let best: Topic | null = null;
    let bestSim = threshold;
    for (const [j, theirs] of hers.entries()) {
      const sim = key(mine) === key(theirs) ? 1 : cosine(vectors[i]!, vectors[yours.length + j]!);
      if (sim >= bestSim) {
        best = { yours: mine, hers: theirs };
        bestSim = sim;
      }
    }
    if (best) topics.push(best);
  }
  return topics;
}

export function cardView(quiz: Quiz, answers: Answers, topics: Topic[], cfg: Gaps): CardView {
  const opens = quiz.questions.filter((q) => q.kind === "open");
  return {
    dimensions: scoreCard(quiz, answers, cfg),
    topics,
    noCommon: topics.length === 0 ? quiz.no_common : null,
    hers: opens.map((q) => ({ prompt: q.prompt, answer: q.her })),
    yours: opens.map((q) => ({ prompt: q.prompt, answer: String(answers[q.id] ?? "") })),
  };
}
