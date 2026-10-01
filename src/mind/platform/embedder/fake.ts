/**
 * Deterministic, hash-based vectors for tests and evals. The same text always gets the same
 * vector; the vectors carry no meaning.
 */
import type { Embedder } from "./types";

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const SPREAD = 2654435761;

export class FakeEmbedder implements Embedder {
  constructor(readonly dimensions: number) {}

  async embed(texts: string[], _inputType?: "query" | "document"): Promise<number[][]> {
    return texts.map((text) => this.vectorFor(text));
  }

  private vectorFor(text: string): number[] {
    let hash = FNV_OFFSET;
    for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), FNV_PRIME);

    return Array.from(
      { length: this.dimensions },
      (_, i) => (((hash ^ (i * SPREAD)) >>> 0) % 1000) / 1000 + 0.001,
    );
  }
}
