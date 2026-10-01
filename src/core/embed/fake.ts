import type { Embedder } from "./types";

/** Deterministic hash-based vectors for tests/evals. Not semantically meaningful. */
export class FakeEmbedder implements Embedder {
  constructor(readonly dimensions: number) {}

  async embed(texts: string[], _inputType?: "query" | "document"): Promise<number[][]> {
    return texts.map((t) => {
      let h = 2166136261;
      for (const ch of t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      return Array.from(
        { length: this.dimensions },
        (_, i) => (((h ^ (i * 2654435761)) >>> 0) % 1000) / 1000 + 0.001,
      );
    });
  }
}
