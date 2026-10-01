/**
 * The embedding model, behind an interface so tests and evals can use deterministic vectors.
 */

export interface Embedder {
  readonly dimensions: number;
  embed(texts: string[], inputType: "query" | "document"): Promise<number[][]>;
}

/** Fails at startup if the model's vectors wouldn't fit the database column. */
export function assertEmbedderMatchesSchema(embedder: Embedder, schemaDimensions: number): void {
  if (embedder.dimensions === schemaDimensions) return;

  throw new Error(
    `embedder produces ${embedder.dimensions}-dim vectors but fact.embedding is ${schemaDimensions}-dim`,
  );
}
