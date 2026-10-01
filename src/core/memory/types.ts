/** One fact included in a reply prompt, with the factor breakdown the inspector shows. */
export type RecalledFact = {
  factId: string;
  sim: number;
  fact_salience: number;
  entity_salience: number;
  recency: number;
  score: number;
  forced: boolean;
};
