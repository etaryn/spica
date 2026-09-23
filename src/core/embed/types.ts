export interface Embedder {
  readonly dimensions: number;
  embed(texts: string[], inputType: "query" | "document"): Promise<number[][]>;
}

export function assertEmbedderMatchesSchema(embedder: Embedder, schemaDimensions: number): void {
  if (embedder.dimensions !== schemaDimensions) {
    throw new Error(`embedder produces ${embedder.dimensions}-dim vectors but fact.embedding is ${schemaDimensions}-dim`);
  }
}
