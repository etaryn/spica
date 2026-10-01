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

export type RetrievedFact = { id: string; content: string; when: Date; onMind?: boolean };

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
