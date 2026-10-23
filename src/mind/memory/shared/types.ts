/**
 * What retrieval hands to a reply: the memories it found, grouped by who they're about, the
 * threads due a check-in, and a record of everything recalled so the cold path can reinforce it.
 */

/** One memory included in a reply prompt, with the score breakdown the inspector shows. */
export type RecalledFact = {
  factId: string;
  sim: number;
  fact_salience: number;
  entity_salience: number;
  recency: number;
  score: number;
  forced: boolean;
};

export type RetrievedFact = {
  id: string;
  content: string;
  when: Date;
  onMind?: boolean;
  /** Hers only: how much of herself it reveals, 1–3. */
  depth?: number;
  /** Hers only: hint at it, or they already know it (told, or only hinted before). */
  share?: "hint" | "known" | "hinted";
  /** Theirs only: from the profile cards you swapped when you met, or her own guess rather than something they said. */
  origin?: "onboarding" | "guess";
};

export type DueThread = { id: string; title: string; detail?: string | null };

export interface RetrievalResult {
  facts: { user: RetrievedFact[]; self: RetrievedFact[]; shared: RetrievedFact[] };
  dueThreads: DueThread[];
  /** Everything included in the prompt, for the cold path's recall write-back and the trace. */
  recalled: RecalledFact[];
}

/** Retrieval with nothing found; also what a reply gets when retrieval is degraded. */
export function emptyRetrieval(): RetrievalResult {
  return { facts: { user: [], self: [], shared: [] }, dueThreads: [], recalled: [] };
}

/** A stored memory close to a new one, for reconcile. Either mind. */
export type Neighbor = { id: string; content: string; status: string; sim: number };
