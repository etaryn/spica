import type { Embedder } from "./types";

/** Test embedder: exact vectors for registered texts, near-orthogonal hashed axes for everything else. */
export class ScriptedEmbedder implements Embedder {
  private readonly vectors = new Map<string, number[]>();
  calls = 0;
  failNext = false;

  constructor(readonly dimensions: number) {}

  static axis(dim: number, i: number): number[] {
    const v = new Array<number>(dim).fill(0);
    v[i % dim] = 1;
    return v;
  }

  /** Unit vector with cosine `sim` to axis(i), built from axes i and j. */
  static near(dim: number, i: number, j: number, sim: number): number[] {
    const v = new Array<number>(dim).fill(0);
    v[i % dim] = sim;
    v[j % dim] = Math.sqrt(1 - sim * sim);
    return v;
  }

  set(text: string, vector: number[]): this {
    this.vectors.set(text, vector);
    return this;
  }

  async embed(texts: string[], _inputType: "query" | "document"): Promise<number[][]> {
    this.calls += 1;
    if (this.failNext) {
      this.failNext = false;
      throw new Error("scripted embedder failure");
    }
    return texts.map((t) => this.vectors.get(t) ?? ScriptedEmbedder.axis(this.dimensions, 100 + (hash(t) % (this.dimensions - 100))));
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
